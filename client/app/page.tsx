'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Circle,
  Copy,
  Download,
  FileAudio,
  FileText,
  Languages,
  List,
  Loader2,
  Mic,
  Pause,
  Pencil,
  Play,
  RefreshCw,
  Send,
  ShieldCheck,
  Square,
  Settings,
  Trash2,
  UploadCloud,
  Video,
  ImageIcon,
  MessageSquare,
  X,
} from 'lucide-react';
import {
  clearAllRecordings,
  createRecording,
  deleteRecordingById,
  fetchManifest,
  usesLocalRecordings,
  fetchRecordingBlob,
  getRecordingFileUrl,
  updateRecordingName,
  readResponseJson,
  resolveUiStateUrl,
  type RecordingEntry,
} from '@/lib/recordings';
import { RecordingList } from '@/components/RecordingList';
import { RecordingPickerModal } from '@/components/RecordingPickerModal';
import { AppSidebar, type AppPageKey } from '@/components/AppSidebar';
import { SettingsDialog } from '@/components/SettingsDialog';
import { ImageGen } from '@/components/ImageGen';
import { KnowledgeChat } from '@/components/KnowledgeChat';
import { VideoGen } from '@/components/VideoGen';
import type { RecordingClip } from '@/types/recording';
import type {
  AutomaticSpeechRecognitionOutput,
  AutomaticSpeechRecognitionPipeline,
  ProgressInfo,
} from '@huggingface/transformers';

type PageKey = AppPageKey;
type RecorderStatus = 'idle' | 'requesting' | 'ready' | 'recording' | 'paused' | 'stopped' | 'error';
type UploadStatus = 'idle' | 'uploading' | 'success' | 'error';
type TranscriptionStatus = 'idle' | 'loading-model' | 'transcribing' | 'success' | 'error';
type AudioSourceKind = 'file' | 'recording';
type WebAudioWindow = Window &
  typeof globalThis & {
    webkitAudioContext?: typeof AudioContext;
  };

const isPageKey = (value: string | null): value is PageKey =>
  value === 'capture' || value === 'convert' || value === 'video' || value === 'image' || value === 'chat';

const noStoreFetchInit: RequestInit = {
  cache: 'no-store',
  headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
};

const UI_STATE_FETCH_MS = 12_000;

/** 仅从服务端读取当前页签，不使用 localStorage / sessionStorage */
const fetchActivePageMemory = async (): Promise<PageKey | null> => {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), UI_STATE_FETCH_MS);
  try {
    const response = await fetch(resolveUiStateUrl(), {
      ...noStoreFetchInit,
      signal: controller.signal,
    });
    const text = await response.text();
    const data = await readResponseJson<{ activePage?: unknown }>(response, text);
    if (!response.ok) {
      throw new Error(`读取页签记忆失败：HTTP ${response.status}`);
    }
    return typeof data.activePage === 'string' && isPageKey(data.activePage) ? data.activePage : null;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('读取页签记忆超时，请确认当前预览地址下的 /api/ui-state 可访问');
    }
    throw err;
  } finally {
    window.clearTimeout(timer);
  }
};

const saveActivePageMemory = async (activePage: PageKey) => {
  const url = resolveUiStateUrl();
  const init: RequestInit = {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ activePage }),
    keepalive: true,
  };

  let response = await fetch(url, { ...init, method: 'PUT' });
  let text = await response.text();
  if (!response.ok && [401, 403, 405].includes(response.status)) {
    response = await fetch(url, { ...init, method: 'POST' });
    text = await response.text();
  }
  await readResponseJson(response, text);
  if (!response.ok) throw new Error(`保存页签记忆失败：HTTP ${response.status}`);
};

const entryToClip = (entry: RecordingEntry, blob: Blob | null = null): RecordingClip => ({
  id: entry.id,
  displayName: entry.displayName,
  fileName: entry.fileName,
  blob,
  url: blob ? URL.createObjectURL(blob) : getRecordingFileUrl(entry.id),
  duration: entry.duration,
  createdAt: entry.createdAt,
  size: entry.size,
  type: entry.mimeType,
});

type SelectedAudio = {
  source: AudioSourceKind;
  url: string;
  name: string;
  size: number;
  type: string;
  duration?: number;
};

type WhisperTranscriptionOptions = {
  return_timestamps: boolean;
  chunk_length_s: number;
  stride_length_s: number;
  task: string;
  language?: string;
};

const acceptedAudioFiles =
  'audio/*,.mp3,.wav,.m4a,.aac,.flac,.ogg,.oga,.opus,.webm,.mp4,.mpeg,.mpga';

let transformersRuntimePromise: Promise<typeof import('@huggingface/transformers')> | null = null;

const loadTransformersRuntime = async () => {
  if (!transformersRuntimePromise) {
    transformersRuntimePromise = import('@huggingface/transformers').then((runtime) => {
      runtime.env.allowRemoteModels = true;
      runtime.env.allowLocalModels = false;
      runtime.env.useBrowserCache = true;
      runtime.env.useWasmCache = true;
      return runtime;
    });
  }
  return transformersRuntimePromise;
};

const whisperModels = [
  { id: 'Xenova/whisper-tiny', label: 'Whisper Tiny', detail: '标准权重，加载较快' },
  { id: 'Xenova/whisper-base', label: 'Whisper Base', detail: '标准权重，精度更高' },
] as const;

type WhisperModelId = (typeof whisperModels)[number]['id'];

const languageOptions = [
  { value: 'auto', label: '自动识别' },
  { value: 'chinese', label: '中文' },
  { value: 'english', label: '英语' },
  { value: 'japanese', label: '日语' },
  { value: 'korean', label: '韩语' },
] as const;

type LanguageOption = (typeof languageOptions)[number]['value'];

const formatDuration = (seconds: number) => {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const mins = Math.floor(safeSeconds / 60)
    .toString()
    .padStart(2, '0');
  const secs = Math.floor(safeSeconds % 60)
    .toString()
    .padStart(2, '0');
  return `${mins}:${secs}`;
};

const formatFileSize = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
};

const formatDateTime = (timestamp: number) =>
  new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(timestamp));

const formatTimestampRange = (timestamp: [number, number]) =>
  `${formatDuration(timestamp[0])} - ${formatDuration(timestamp[1])}`;

const getSupportedMimeType = () => {
  const types = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
    'audio/wav',
  ];
  return types.find((type) => MediaRecorder.isTypeSupported(type)) ?? '';
};

const getAudioExtension = (mimeType: string) => {
  if (mimeType.includes('mp4')) return 'm4a';
  if (mimeType.includes('ogg')) return 'ogg';
  if (mimeType.includes('wav')) return 'wav';
  return 'webm';
};

const getErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
};

export default function HomePage() {
  const [activePage, setActivePage] = useState<PageKey>('capture');
  /** 为 false 时表示尚未完成「刷新后 GET /api/ui-state」，侧栏不高亮、主区不渲染，避免误像本地缓存 */
  const [activePageMemoryReady, setActivePageMemoryReady] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [status, setStatus] = useState<RecorderStatus>('idle');
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>('idle');
  const [error, setError] = useState('');
  const [duration, setDuration] = useState(0);
  const [audioUrl, setAudioUrl] = useState('');
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [recordingName, setRecordingName] = useState('');
  const [recordings, setRecordings] = useState<RecordingClip[]>([]);
  const [activeRecordingId, setActiveRecordingId] = useState('');
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [editingId, setEditingId] = useState('');
  const [editingName, setEditingName] = useState('');
  const [savingId, setSavingId] = useState('');
  const [audioLevel, setAudioLevel] = useState(0);

  const [selectedAudio, setSelectedAudio] = useState<SelectedAudio | null>(null);
  const [transcriptionStatus, setTranscriptionStatus] = useState<TranscriptionStatus>('idle');
  const [transcriptionError, setTranscriptionError] = useState('');
  const [transcript, setTranscript] = useState('');
  const [transcriptChunks, setTranscriptChunks] = useState<AutomaticSpeechRecognitionOutput['chunks']>([]);
  const [modelId, setModelId] = useState<WhisperModelId>('Xenova/whisper-tiny');
  const [language, setLanguage] = useState<LanguageOption>('chinese');
  const [modelProgress, setModelProgress] = useState(0);
  const [modelProgressLabel, setModelProgressLabel] = useState('模型未加载');
  const [copyStatus, setCopyStatus] = useState('');
  const [recordingPickerOpen, setRecordingPickerOpen] = useState(false);
  const [pickingId, setPickingId] = useState('');

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const timerRef = useRef<number | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const animationRef = useRef<number | null>(null);
  const discardOnStopRef = useRef(false);
  const durationRef = useRef(0);
  const recordingsRef = useRef<RecordingClip[]>([]);
  const selectedAudioUrlRef = useRef('');
  const transcriberRef = useRef<AutomaticSpeechRecognitionPipeline | null>(null);
  const loadedModelIdRef = useRef<WhisperModelId | null>(null);
  const activePageTouchedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const savedPage = await fetchActivePageMemory();
        if (!cancelled && !activePageTouchedRef.current && savedPage) {
          setActivePage(savedPage);
        }
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : '读取页签记忆失败';
          setError(message);
        }
      } finally {
        if (!cancelled) {
          setActivePageMemoryReady(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleActivePageSelect = (page: PageKey) => {
    activePageTouchedRef.current = true;
    setActivePage(page);
    void saveActivePageMemory(page).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : '保存页签记忆失败';
      setError(message);
    });
  };

  const canRecord = status === 'idle' || status === 'ready' || status === 'stopped' || status === 'error';
  const canPause = status === 'recording' && mediaRecorderRef.current?.state === 'recording';
  const canResume = status === 'paused' && mediaRecorderRef.current?.state === 'paused';
  const canStop = status === 'recording' || status === 'paused';
  const isTranscriptionBusy = transcriptionStatus === 'loading-model' || transcriptionStatus === 'transcribing';

  const recordingClip = useMemo(
    () => recordings.find((clip) => clip.id === activeRecordingId) ?? null,
    [activeRecordingId, recordings],
  );

  const statusMeta = useMemo(() => {
    switch (status) {
      case 'requesting':
        return { label: '请求麦克风', color: 'bg-amber-400', tone: 'text-amber-700' };
      case 'ready':
        return { label: '已授权', color: 'bg-emerald-500', tone: 'text-emerald-700' };
      case 'recording':
        return { label: '录音中', color: 'bg-rose-500', tone: 'text-rose-700' };
      case 'paused':
        return { label: '已暂停', color: 'bg-sky-500', tone: 'text-sky-700' };
      case 'stopped':
        return { label: '已生成', color: 'bg-indigo-500', tone: 'text-indigo-700' };
      case 'error':
        return { label: '异常', color: 'bg-red-500', tone: 'text-red-700' };
      default:
        return { label: '待授权', color: 'bg-slate-400', tone: 'text-slate-700' };
    }
  }, [status]);

  const pages = useMemo(
    () => [
      { key: 'capture' as const, label: '音频采集', detail: '麦克风录音', icon: Mic },
      { key: 'convert' as const, label: '音频转换', detail: 'Whisper 转写', icon: Languages },
      { key: 'video' as const, label: '文字转视频', detail: 'MiniMax 视频', icon: Video },
      { key: 'image' as const, label: '文字转图片', detail: 'MiniMax 图片', icon: ImageIcon },
      { key: 'chat' as const, label: '知识问答', detail: '多会话对话', icon: MessageSquare },
    ],
    [],
  );

  const bars = useMemo(
    () =>
      Array.from({ length: 32 }, (_, index) => {
        const phase = Math.sin((index + 1) * 0.72);
        const base = status === 'recording' ? 22 + audioLevel * 0.58 : status === 'paused' ? 18 : 12;
        return Math.max(10, Math.min(88, base + phase * 18 + ((index % 5) * audioLevel) / 18));
      }),
    [audioLevel, status],
  );

  const transcriptDownloadHref = useMemo(() => {
    if (!transcript.trim()) return '';
    return `data:text/plain;charset=utf-8,${encodeURIComponent(transcript)}`;
  }, [transcript]);

  const releaseSelectedAudioUrl = () => {
    if (selectedAudioUrlRef.current) {
      URL.revokeObjectURL(selectedAudioUrlRef.current);
      selectedAudioUrlRef.current = '';
    }
  };

  const setConversionAudio = (source: AudioSourceKind, blob: Blob, name: string, durationSeconds?: number) => {
    releaseSelectedAudioUrl();
    const url = URL.createObjectURL(blob);
    selectedAudioUrlRef.current = url;
    setSelectedAudio({
      source,
      url,
      name,
      size: blob.size,
      type: blob.type || 'audio/*',
      duration: durationSeconds,
    });
    setTranscriptionStatus('idle');
    setTranscriptionError('');
    setTranscript('');
    setTranscriptChunks([]);
    setCopyStatus('');
    setUploadStatus('idle');
  };

  const setCurrentRecording = (clip: RecordingClip | null) => {
    setActiveRecordingId(clip?.id ?? '');
    setAudioBlob(clip?.blob ?? null);
    setAudioUrl(clip?.url ?? '');
    setRecordingName(clip?.displayName ?? '');
    setDuration(clip?.duration ?? 0);
    setUploadStatus('idle');
    setError('');
    setEditingId('');
    setEditingName('');
  };

  const syncRecordings = (clips: RecordingClip[], preferredId?: string) => {
    recordingsRef.current = clips;
    setRecordings(clips);
    const targetId = preferredId ?? activeRecordingId;
    const nextActive = clips.find((item) => item.id === targetId) ?? clips[0] ?? null;
    setCurrentRecording(nextActive);
  };

  const loadRecordingsFromServer = async () => {
    setListLoading(true);
    setListError('');
    try {
      const manifest = await fetchManifest();
      const clips = await Promise.all(
        manifest.recordings.map(async (entry) => {
          if (!usesLocalRecordings()) return entryToClip(entry);
          try {
            const blob = await fetchRecordingBlob(entry.id);
            return entryToClip(entry, blob);
          } catch {
            return entryToClip(entry);
          }
        }),
      );
      syncRecordings(clips, activeRecordingId || clips[0]?.id);
    } catch (err) {
      setListError(getErrorMessage(err, '无法加载采集列表，请确认后端服务已启动'));
    } finally {
      setListLoading(false);
    }
  };

  const persistRecording = async (blob: Blob, fileName: string, durationSeconds: number, displayName: string) => {
    const { recording } = await createRecording(blob, fileName, durationSeconds, displayName);
    return entryToClip(recording, blob);
  };

  const cleanupAnalyzer = () => {
    if (animationRef.current) {
      window.cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      void audioContextRef.current.close();
    }
    audioContextRef.current = null;
    analyserRef.current = null;
    setAudioLevel(0);
  };

  const cleanupStream = () => {
    cleanupAnalyzer();
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
  };

  const clearTimer = () => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const startTimer = () => {
    clearTimer();
    timerRef.current = window.setInterval(() => {
      setDuration((value) => value + 1);
    }, 1000);
  };

  const startAnalyzer = (stream: MediaStream) => {
    cleanupAnalyzer();
    const AudioContextCtor = window.AudioContext || (window as WebAudioWindow).webkitAudioContext;
    if (!AudioContextCtor) return;

    const audioContext = new AudioContextCtor();
    const analyser = audioContext.createAnalyser();
    const source = audioContext.createMediaStreamSource(stream);
    const data = new Uint8Array(analyser.frequencyBinCount);

    analyser.fftSize = 256;
    source.connect(analyser);
    audioContextRef.current = audioContext;
    analyserRef.current = analyser;

    const tick = () => {
      analyser.getByteFrequencyData(data);
      const average = data.reduce((sum, value) => sum + value, 0) / data.length;
      setAudioLevel(Math.min(100, Math.round((average / 140) * 100)));
      animationRef.current = window.requestAnimationFrame(tick);
    };
    tick();
  };

  const requestMicrophone = async () => {
    setError('');
    setStatus('requesting');
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('当前浏览器不支持麦克风采集');
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      mediaStreamRef.current = stream;
      startAnalyzer(stream);
      setStatus('ready');
      return stream;
    } catch (err) {
      const message = getErrorMessage(err, '麦克风权限获取失败');
      cleanupStream();
      setError(message);
      setStatus('error');
      return null;
    }
  };

  const startRecording = async () => {
    setError('');
    setUploadStatus('idle');
    discardOnStopRef.current = false;

    let stream = mediaStreamRef.current;
    if (!stream || stream.getTracks().every((track) => track.readyState === 'ended')) {
      stream = await requestMicrophone();
    }
    if (!stream) return;

    try {
      const mimeType = getSupportedMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      recorder.onstop = () => {
        clearTimer();
        cleanupStream();
        if (discardOnStopRef.current) {
          discardOnStopRef.current = false;
          chunksRef.current = [];
          return;
        }
        const createdAt = Date.now();
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        const fileName = `voice-${createdAt}.${getAudioExtension(blob.type)}`;
        const displayName = `采集 ${formatDateTime(createdAt)}`;
        const tempUrl = URL.createObjectURL(blob);
        const tempClip: RecordingClip = {
          id: `pending-${createdAt}`,
          displayName,
          fileName,
          blob,
          url: tempUrl,
          duration: durationRef.current,
          createdAt,
          size: blob.size,
          type: blob.type || 'audio/webm',
        };
        const next = [tempClip, ...recordingsRef.current];
        syncRecordings(next, tempClip.id);
        setStatus('stopped');

        void (async () => {
          try {
            const saved = await persistRecording(blob, fileName, tempClip.duration, displayName);
            URL.revokeObjectURL(tempUrl);
            const withoutTemp = recordingsRef.current.filter((item) => item.id !== tempClip.id);
            syncRecordings([saved, ...withoutTemp], saved.id);
            setUploadStatus('success');
          } catch (err) {
            setError(getErrorMessage(err, '录音保存失败'));
            setUploadStatus('error');
          }
        })();
      };

      recorder.onerror = () => {
        setError('录音过程中发生错误');
        setStatus('error');
        clearTimer();
        cleanupStream();
      };

      setDuration(0);
      recorder.start(1000);
      startTimer();
      setStatus('recording');
    } catch (err) {
      setError(getErrorMessage(err, '录音启动失败'));
      setStatus('error');
      clearTimer();
      cleanupStream();
    }
  };

  const pauseRecording = () => {
    if (!canPause) return;
    mediaRecorderRef.current?.pause();
    clearTimer();
    setStatus('paused');
  };

  const resumeRecording = () => {
    if (!canResume) return;
    mediaRecorderRef.current?.resume();
    startTimer();
    setStatus('recording');
  };

  const stopRecording = () => {
    if (!canStop) return;
    discardOnStopRef.current = false;
    mediaRecorderRef.current?.stop();
    clearTimer();
  };

  const resetRecorder = () => {
    if (mediaRecorderRef.current?.state === 'recording' || mediaRecorderRef.current?.state === 'paused') {
      discardOnStopRef.current = true;
      mediaRecorderRef.current.stop();
    }
    clearTimer();
    cleanupStream();
    chunksRef.current = [];
    mediaRecorderRef.current = null;
    setDuration(0);
    setError('');
    setUploadStatus('idle');
    setStatus('idle');
    setCurrentRecording(null);
  };

  const deleteRecording = async (clipId: string) => {
    if (clipId.startsWith('pending-')) return;
    setSavingId(clipId);
    setListError('');
    try {
      const manifest = await deleteRecordingById(clipId);
      const clips = manifest.recordings.map((entry) => {
        const existing = recordingsRef.current.find((item) => item.id === entry.id);
        return entryToClip(entry, existing?.blob ?? null);
      });
      const nextActive = clipId === activeRecordingId ? clips[0]?.id : activeRecordingId;
      syncRecordings(clips, nextActive);
    } catch (err) {
      setListError(getErrorMessage(err, '删除失败'));
    } finally {
      setSavingId('');
    }
  };

  const clearRecordings = async () => {
    setListError('');
    try {
      recordingsRef.current.forEach((clip) => {
        if (clip.url.startsWith('blob:')) URL.revokeObjectURL(clip.url);
      });
      const manifest = await clearAllRecordings();
      syncRecordings(manifest.recordings.map((entry) => entryToClip(entry)));
      setStatus((current) => (current === 'stopped' ? 'idle' : current));
    } catch (err) {
      setListError(getErrorMessage(err, '清空失败'));
    }
  };

  const startEditRecording = (clip: RecordingClip) => {
    setEditingId(clip.id);
    setEditingName(clip.displayName);
  };

  const cancelEditRecording = () => {
    setEditingId('');
    setEditingName('');
  };

  const saveEditRecording = async (clipId: string) => {
    const trimmed = editingName.trim();
    if (!trimmed) {
      setListError('名称不能为空');
      return;
    }
    if (clipId.startsWith('pending-')) return;

    setSavingId(clipId);
    setListError('');
    try {
      const { recording } = await updateRecordingName(clipId, trimmed);
      const clips = recordingsRef.current.map((item) =>
        item.id === clipId
          ? { ...item, displayName: recording.displayName, fileName: recording.fileName }
          : item,
      );
      syncRecordings(clips, clipId);
      cancelEditRecording();
    } catch (err) {
      setListError(getErrorMessage(err, '保存名称失败'));
    } finally {
      setSavingId('');
    }
  };

  const uploadSelectedAudio = async () => {
    if (!selectedAudio) {
      setTranscriptionError('请先选择要保存的音频');
      return;
    }
    setUploadStatus('uploading');
    setTranscriptionError('');
    try {
      const response = await fetch(selectedAudio.url);
      if (!response.ok) throw new Error(`读取音频失败：HTTP ${response.status}`);
      const blob = await response.blob();
      const extension = getAudioExtension(blob.type || selectedAudio.type);
      const fileName = selectedAudio.name.includes('.') ? selectedAudio.name : `${selectedAudio.name}.${extension}`;
      const displayName =
        selectedAudio.source === 'recording' ? selectedAudio.name : `导入 ${selectedAudio.name}`;
      const saved = await persistRecording(blob, fileName, selectedAudio.duration ?? 0, displayName);
      const next = [saved, ...recordingsRef.current.filter((item) => item.id !== saved.id)];
      syncRecordings(next, saved.id);
      setUploadStatus('success');
    } catch (err) {
      setTranscriptionError(getErrorMessage(err, '保存音频失败'));
      setUploadStatus('error');
    }
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    setConversionAudio('file', file, file.name);
  };

  const applyRecordingForConversion = async (clip: RecordingClip) => {
    if (clip.id.startsWith('pending-')) return;

    setPickingId(clip.id);
    setTranscriptionError('');
    try {
      const blob = clip.blob ?? (await fetchRecordingBlob(clip.id));
      if (!clip.blob) {
        const clips = recordingsRef.current.map((item) => (item.id === clip.id ? { ...item, blob } : item));
        recordingsRef.current = clips;
        setRecordings(clips);
      }
      setConversionAudio('recording', blob, clip.displayName, clip.duration);
      setRecordingPickerOpen(false);
    } catch (err) {
      setTranscriptionError(getErrorMessage(err, '读取录音失败'));
    } finally {
      setPickingId('');
    }
  };

  const openRecordingPicker = () => {
    setRecordingPickerOpen(true);
    if (!listLoading && recordings.length === 0) {
      void loadRecordingsFromServer();
    }
  };

  const useRecordingForConversion = async (clip?: RecordingClip, switchPage = false) => {
    const target = clip ?? recordingClip;
    if (!target) {
      setTranscriptionError('请先选择一条采集录音');
      if (switchPage) setActivePage('convert');
      return;
    }
    await applyRecordingForConversion(target);
    if (switchPage) setActivePage('convert');
  };

  const handleModelProgress = (progress: ProgressInfo) => {
    if (progress.status === 'progress_total') {
      setModelProgress(Math.round(progress.progress));
      setModelProgressLabel(`模型下载 ${Math.round(progress.progress)}%`);
      return;
    }
    if (progress.status === 'progress') {
      setModelProgress(Math.round(progress.progress));
      setModelProgressLabel(`正在下载 ${progress.file}`);
      return;
    }
    if (progress.status === 'ready') {
      setModelProgress(100);
      setModelProgressLabel('模型已就绪');
      return;
    }
    if (progress.status === 'initiate' || progress.status === 'download') {
      setModelProgressLabel(`准备 ${progress.file}`);
    }
  };

  const loadWhisperModel = async () => {
    if (transcriberRef.current && loadedModelIdRef.current === modelId) {
      return transcriberRef.current;
    }
    if (transcriberRef.current) {
      await transcriberRef.current.dispose();
      transcriberRef.current = null;
      loadedModelIdRef.current = null;
    }
    setTranscriptionStatus('loading-model');
    setModelProgress(0);
    setModelProgressLabel('准备加载模型');
    const { pipeline } = await loadTransformersRuntime();
    const transcriber = await pipeline('automatic-speech-recognition', modelId, {
      dtype: 'fp32',
      device: 'wasm',
      progress_callback: handleModelProgress,
    });
    transcriberRef.current = transcriber;
    loadedModelIdRef.current = modelId;
    setModelProgress(100);
    setModelProgressLabel('模型已就绪');
    return transcriber;
  };

  const transcribeAudio = async () => {
    if (!selectedAudio) {
      setTranscriptionError('请先选择一个音频文件');
      setTranscriptionStatus('error');
      return;
    }
    setTranscriptionError('');
    setTranscript('');
    setTranscriptChunks([]);
    setCopyStatus('');
    try {
      const transcriber = await loadWhisperModel();
      setTranscriptionStatus('transcribing');
      const options: WhisperTranscriptionOptions = {
        return_timestamps: true,
        chunk_length_s: 30,
        stride_length_s: 5,
        task: 'transcribe',
      };
      if (language !== 'auto') options.language = language;
      const output = (await transcriber(selectedAudio.url, options)) as AutomaticSpeechRecognitionOutput;
      setTranscript(output.text.trim());
      setTranscriptChunks(output.chunks ?? []);
      setTranscriptionStatus('success');
    } catch (err) {
      const message = getErrorMessage(err, '音频转换失败，请确认浏览器可以解码该音频格式');
      const isQuantizedModelError =
        message.includes('TransposeDQWeightsForMatMulNBits') || message.includes('Missing required scale');
      setTranscriptionError(
        isQuantizedModelError
          ? '模型量化权重加载失败。页面已改为使用标准权重，请刷新页面后重新转换；如果浏览器仍使用旧缓存，请清理站点缓存后重试。'
          : message,
      );
      setTranscriptionStatus('error');
    }
  };

  const copyTranscript = async () => {
    if (!transcript.trim()) return;
    try {
      await navigator.clipboard.writeText(transcript);
      setCopyStatus('已复制');
    } catch {
      setCopyStatus('复制失败');
    }
  };

  useEffect(() => {
    durationRef.current = duration;
  }, [duration]);

  useEffect(() => {
    void loadRecordingsFromServer();
  }, []);

  useEffect(() => {
    return () => {
      clearTimer();
      cleanupStream();
      releaseSelectedAudioUrl();
      recordingsRef.current.forEach((clip) => {
        if (clip.url.startsWith('blob:')) URL.revokeObjectURL(clip.url);
      });
      if (transcriberRef.current) void transcriberRef.current.dispose();
    };
  }, []);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="border-b border-border bg-card">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <FileAudio size={22} strokeWidth={2.3} />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-normal text-foreground sm:text-2xl">聚合工作台</h1>
              <p className="mt-1 text-sm text-muted-foreground">MediaRecorder + OpenAI Whisper fp32</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="rounded-full border border-border bg-muted px-3 py-2 font-medium text-muted-foreground">
              本地浏览器转写
            </span>
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 font-medium text-foreground transition hover:bg-muted"
              aria-label="打开设置"
            >
              <Settings size={16} />
              设置
            </button>
          </div>
        </div>
      </div>

      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      <div className="flex w-full">
        <AppSidebar
          items={pages}
          activeKey={activePage}
          pageReady={activePageMemoryReady}
          onSelect={handleActivePageSelect}
        />

        <div className="mx-auto min-w-0 w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
          {!activePageMemoryReady ? (
            <div className="flex min-h-[40vh] items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="animate-spin" size={18} />
              正在从服务器恢复页签…
            </div>
          ) : activePage === 'capture' ? (
            <div className="grid gap-6 lg:grid-cols-[1.35fr_0.9fr]">
              <section className="rounded-lg border border-border bg-card p-5 shadow-panel sm:p-6">
                <div className="flex flex-col gap-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <div className="text-sm font-medium text-muted-foreground">当前时长</div>
                      <div className="mt-1 font-mono text-5xl font-semibold tracking-normal text-foreground sm:text-6xl">
                        {formatDuration(duration)}
                      </div>
                    </div>
                    <div className="flex flex-col gap-3 sm:items-end">
                      <div className="inline-flex items-center gap-2 rounded-full border border-border bg-muted px-3 py-2 text-sm font-medium">
                        <span className={`h-2.5 w-2.5 rounded-full ${statusMeta.color}`} />
                        <span className={statusMeta.tone}>{statusMeta.label}</span>
                      </div>
                      <div className="flex w-full items-center gap-2 sm:w-auto">
                        <button
                          type="button"
                          onClick={requestMicrophone}
                          disabled={status === 'requesting' || status === 'recording' || status === 'paused'}
                          className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-lg border border-border bg-background px-4 text-sm font-semibold text-foreground transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none"
                        >
                          <ShieldCheck size={18} />
                          授权
                        </button>
                        <button
                          type="button"
                          onClick={resetRecorder}
                          className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground transition hover:bg-muted"
                          aria-label="重置"
                          title="重置"
                        >
                          <RefreshCw size={18} />
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="h-40 rounded-lg border border-border bg-primary px-4 py-5">
                    <div className="flex h-full items-end justify-between gap-1">
                      {bars.map((height, index) => (
                        <span
                          key={index}
                          className={`w-full rounded-full transition-all duration-150 ${
                            status === 'recording'
                              ? 'bg-emerald-400'
                              : status === 'paused'
                                ? 'bg-sky-400'
                                : 'bg-slate-600'
                          }`}
                          style={{ height: `${height}%` }}
                        />
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <button
                      type="button"
                      onClick={startRecording}
                      disabled={!canRecord}
                      className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-rose-600 px-4 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:bg-muted"
                    >
                      <Circle size={16} fill="currentColor" />
                      开始
                    </button>
                    <button
                      type="button"
                      onClick={pauseRecording}
                      disabled={!canPause}
                      className="inline-flex h-12 items-center justify-center gap-2 rounded-lg border border-border bg-background px-4 text-sm font-semibold text-foreground transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      <Pause size={18} />
                      暂停
                    </button>
                    <button
                      type="button"
                      onClick={resumeRecording}
                      disabled={!canResume}
                      className="inline-flex h-12 items-center justify-center gap-2 rounded-lg border border-border bg-background px-4 text-sm font-semibold text-foreground transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      <Play size={18} />
                      继续
                    </button>
                    <button
                      type="button"
                      onClick={stopRecording}
                      disabled={!canStop}
                      className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:bg-muted"
                    >
                      <Square size={16} fill="currentColor" />
                      停止
                    </button>
                  </div>

                  {error && (
                    <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">
                      {error}
                    </div>
                  )}
                </div>
              </section>

              <aside className="flex flex-col gap-6">
                <section className="rounded-lg border border-border bg-card p-5 shadow-panel">
                  <div className="mb-4 flex flex-col gap-2">
                    {usesLocalRecordings() && (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                        录音保存在本浏览器（IndexedDB），换设备不互通。若已部署 EdgeOne API，请设置
                        NEXT_PUBLIC_API_BASE_URL 为站点根地址后重新发布。
                      </div>
                    )}
                    <div className="flex items-center justify-between gap-3">
                      <h2 className="text-base font-semibold text-foreground">采集列表</h2>
                      {recordings.length > 0 && (
                        <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                          {recordings.length} 条
                        </span>
                      )}
                    </div>
                  </div>

                  <RecordingList
                    recordings={recordings}
                    activeRecordingId={activeRecordingId}
                    listLoading={listLoading}
                    listError={listError}
                    editingId={editingId}
                    editingName={editingName}
                    savingId={savingId}
                    onSelect={setCurrentRecording}
                    onStartEdit={startEditRecording}
                    onCancelEdit={cancelEditRecording}
                    onSaveEdit={(clipId) => void saveEditRecording(clipId)}
                    onEditingNameChange={setEditingName}
                    onConvert={(clip) => {
                      setCurrentRecording(clip);
                      void useRecordingForConversion(clip, true);
                    }}
                    onDelete={deleteRecording}
                    onClear={clearRecordings}
                    formatDuration={formatDuration}
                    formatFileSize={formatFileSize}
                    formatDateTime={formatDateTime}
                    getAudioExtension={getAudioExtension}
                  />
                </section>

              </aside>
            </div>
          ) : activePage === 'convert' ? (
            <div className="grid gap-6 xl:grid-cols-[0.95fr_1.25fr]">
              <section className="rounded-lg border border-border bg-card p-5 shadow-panel sm:p-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-semibold text-foreground">音频来源</h2>
                    <p className="mt-1 text-sm text-muted-foreground">支持 MP3、WAV、M4A、AAC、FLAC、OGG、WebM 等常见格式</p>
                  </div>
                  <FileAudio className="mt-1 text-muted-foreground" size={22} />
                </div>

                <div className="mt-5 grid gap-4">
                  <div className="rounded-lg border border-border bg-muted p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="text-sm font-semibold text-foreground">电脑文件</div>
                        <div className="mt-1 text-xs font-medium text-muted-foreground">浏览器负责解码，格式支持随浏览器而定</div>
                      </div>
                      <label className="inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90">
                        <UploadCloud size={18} />
                        选择文件
                        <input type="file" accept={acceptedAudioFiles} onChange={handleFileSelect} className="hidden" />
                      </label>
                    </div>
                  </div>

                  <div className="rounded-lg border border-border bg-background p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="text-sm font-semibold text-foreground">音频采集</div>
                        <div className="mt-1 text-xs font-medium text-muted-foreground">
                          {selectedAudio?.source === 'recording'
                            ? `已选：${selectedAudio.name}${
                                selectedAudio.duration !== undefined
                                  ? ` · ${formatDuration(selectedAudio.duration)}`
                                  : ''
                              }`
                            : recordings.length > 0
                              ? `共有 ${recordings.length} 条采集记录，点击按钮选择`
                              : '暂无采集录音'}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={openRecordingPicker}
                        className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-border bg-background px-4 text-sm font-semibold text-foreground transition hover:bg-muted"
                      >
                        <List size={18} />
                        选择录音
                      </button>
                    </div>
                  </div>
                </div>

                <div className="mt-6 rounded-lg border border-border bg-background p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold text-foreground">当前音频</h3>
                    {selectedAudio && (
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-semibold ${
                          selectedAudio.source === 'recording'
                            ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400'
                            : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                        }`}
                      >
                        {selectedAudio.source === 'recording' ? '采集录音' : '电脑文件'}
                      </span>
                    )}
                  </div>
                  {selectedAudio ? (
                    <div className="flex flex-col gap-4">
                      <div>
                        <div className="truncate text-sm font-semibold text-foreground">{selectedAudio.name}</div>
                        <div className="mt-1 flex flex-wrap gap-2 text-xs font-medium text-muted-foreground">
                          <span>{formatFileSize(selectedAudio.size)}</span>
                          {selectedAudio.duration !== undefined && (
                            <span>{formatDuration(selectedAudio.duration)}</span>
                          )}
                          <span>{selectedAudio.type}</span>
                        </div>
                      </div>
                      <audio
                        controls
                        src={selectedAudio.url}
                        className="w-full"
                        onLoadedMetadata={(event) => {
                          const loadedDuration = event.currentTarget.duration;
                          if (Number.isFinite(loadedDuration)) {
                            setSelectedAudio((current) =>
                              current ? { ...current, duration: loadedDuration } : current,
                            );
                          }
                        }}
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void uploadSelectedAudio()}
                          disabled={uploadStatus === 'uploading'}
                          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-muted"
                        >
                          <Send size={16} />
                          {uploadStatus === 'uploading' ? '保存中' : '保存到采集库'}
                        </button>
                        {uploadStatus === 'success' && (
                          <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">已保存，可在采集页查看</span>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="flex min-h-32 items-center justify-center rounded-lg border border-dashed border-border bg-muted px-4 py-8 text-center text-sm font-medium text-muted-foreground">
                      未选择音频
                    </div>
                  )}
                </div>
              </section>

              <section className="rounded-lg border border-border bg-card p-5 shadow-panel sm:p-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-foreground">Whisper 转写</h2>
                    <p className="mt-1 text-sm text-muted-foreground">OpenAI Whisper 标准权重，Transformers.js 在浏览器本地运行</p>
                  </div>
                  <div className="inline-flex items-center gap-2 rounded-full border border-border bg-muted px-3 py-2 text-sm font-medium text-muted-foreground">
                    {isTranscriptionBusy ? <Loader2 className="animate-spin" size={16} /> : <CheckCircle2 size={16} />}
                    {transcriptionStatus === 'loading-model'
                      ? '加载模型'
                      : transcriptionStatus === 'transcribing'
                        ? '转换中'
                        : transcriptionStatus === 'success'
                          ? '已完成'
                          : '待转换'}
                  </div>
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-2 block text-sm font-medium text-muted-foreground">模型</span>
                    <select
                      value={modelId}
                      onChange={(event) => setModelId(event.target.value as WhisperModelId)}
                      disabled={isTranscriptionBusy}
                      className="h-11 w-full rounded-lg border border-border bg-background px-3 text-sm font-semibold text-foreground outline-none transition focus:border-sky-500 focus:ring-4 focus:ring-sky-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {whisperModels.map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.label} · {model.detail}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-sm font-medium text-muted-foreground">语言</span>
                    <select
                      value={language}
                      onChange={(event) => setLanguage(event.target.value as LanguageOption)}
                      disabled={isTranscriptionBusy}
                      className="h-11 w-full rounded-lg border border-border bg-background px-3 text-sm font-semibold text-foreground outline-none transition focus:border-sky-500 focus:ring-4 focus:ring-sky-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {languageOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="mt-5 rounded-lg border border-border bg-muted p-4">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="font-semibold text-foreground">{modelProgressLabel}</span>
                    <span className="font-mono font-semibold text-muted-foreground">{modelProgress}%</span>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-border">
                    <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${modelProgress}%` }} />
                  </div>
                </div>

                <button
                  type="button"
                  onClick={transcribeAudio}
                  disabled={!selectedAudio || isTranscriptionBusy}
                  className="mt-5 inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-muted"
                >
                  {isTranscriptionBusy ? <Loader2 className="animate-spin" size={18} /> : <Languages size={18} />}
                  {transcriptionStatus === 'loading-model'
                    ? '加载模型中'
                    : transcriptionStatus === 'transcribing'
                      ? '转换中'
                      : '开始转换'}
                </button>

                {transcriptionError && (
                  <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">
                    {transcriptionError}
                  </div>
                )}

                <div className="mt-6 rounded-lg border border-border bg-background">
                  <div className="flex flex-col gap-3 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-2">
                      <FileText size={18} className="text-muted-foreground" />
                      <h3 className="text-sm font-semibold text-foreground">转换结果</h3>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={copyTranscript}
                        disabled={!transcript.trim()}
                        className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 text-xs font-semibold text-foreground transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        <Copy size={15} />
                        {copyStatus || '复制'}
                      </button>
                      <a
                        href={transcriptDownloadHref || undefined}
                        download={`${selectedAudio?.name.replace(/\.[^/.]+$/, '') || 'transcript'}.txt`}
                        aria-disabled={!transcriptDownloadHref}
                        className={`inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 text-xs font-semibold transition ${
                          transcriptDownloadHref
                            ? 'text-foreground hover:bg-muted'
                            : 'pointer-events-none text-muted-foreground opacity-45'
                        }`}
                      >
                        <Download size={15} />
                        下载
                      </a>
                    </div>
                  </div>
                  <textarea
                    value={transcript}
                    onChange={(event) => setTranscript(event.target.value)}
                    placeholder="转换后的文本会显示在这里"
                    className="min-h-56 w-full resize-y border-0 bg-background p-4 text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground"
                  />
                </div>

                {transcriptChunks && transcriptChunks.length > 0 && (
                  <div className="mt-5 rounded-lg border border-border bg-background">
                    <div className="border-b border-border px-4 py-3 text-sm font-semibold text-foreground">时间片段</div>
                    <div className="max-h-64 overflow-auto">
                      {transcriptChunks.map((chunk, index) => (
                        <div
                          key={`${chunk.timestamp[0]}-${index}`}
                          className="grid gap-2 border-b border-border px-4 py-3 text-sm last:border-0 sm:grid-cols-[120px_1fr]"
                        >
                          <span className="font-mono text-xs font-semibold text-muted-foreground">
                            {formatTimestampRange(chunk.timestamp)}
                          </span>
                          <span className="leading-6 text-foreground">{chunk.text.trim()}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </section>
            </div>
          ) : activePage === 'video' ? (
            <VideoGen />
          ) : activePage === 'image' ? (
            <ImageGen />
          ) : activePage === 'chat' ? (
            <KnowledgeChat />
          ) : null}
        </div>
      </div>

      <RecordingPickerModal
        open={recordingPickerOpen}
        recordings={recordings}
        listLoading={listLoading}
        listError={listError}
        pickingId={pickingId}
        onClose={() => setRecordingPickerOpen(false)}
        onSelect={(clip) => void applyRecordingForConversion(clip)}
        formatDuration={formatDuration}
        formatFileSize={formatFileSize}
        formatDateTime={formatDateTime}
      />
    </main>
  );
}
