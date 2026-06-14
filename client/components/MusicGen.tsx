'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Download, FolderOpen, Link2, Loader2, Music2, Search, Trash2, Upload } from 'lucide-react';
import { MiniMaxBillingAlert } from '@/components/MiniMaxBillingAlert';
import { RecordingPickerModal } from '@/components/RecordingPickerModal';
import { generateMusic, type MusicGenMode } from '@/lib/minimax';
import { buildMiniMaxBillingAlert } from '@/lib/minimax-errors';
import { readAudioFileAsBase64 } from '@/lib/music-audio';
import {
  buildCoverIntent,
  fetchOriginalSongByMeta,
  fetchOriginalSongFromUrl,
} from '@/lib/music-source';
import {
  appendMusicHistory,
  clearMusicHistoryStore,
  loadMusicDraft,
  loadMusicHistory,
  musicModeLabel,
  previewMusicLabel,
  removeMusicHistoryItem,
  saveMusicDraft,
  type CoverVoiceInput,
  type MusicHistoryItem,
} from '@/lib/music-storage';
import { fetchManifest, fetchRecordingBlob, getRecordingFileUrl, type RecordingEntry } from '@/lib/recordings';
import type { RecordingClip } from '@/types/recording';

type Status = 'idle' | 'generating' | 'done' | 'error';

const MODE_OPTIONS: { value: MusicGenMode; label: string; hint: string }[] = [
  { value: 'vocal', label: '有人声', hint: '歌词 + 风格 + 人声描述' },
  { value: 'instrumental', label: '纯音乐', hint: '无人声，仅风格描述' },
  { value: 'cover', label: '翻唱', hint: '参考声线 + 指定歌曲' },
];

const STYLE_EXAMPLES = [
  '独立民谣, 忧郁, 内省, 独自漫步, 咖啡馆',
  'Pop, upbeat, summer night, electric guitar',
  'Lo-fi hip hop, chill, study, soft piano',
];

const VOCAL_EXAMPLES = ['温暖男声, 中文', '甜美女声, 流行', '烟嗓, 摇滚, 英文'];

const COVER_SONG_DEFAULT = { title: '大海', artist: '张雨生' };

const COVER_VOICE_TABS: { value: CoverVoiceInput; label: string; hint: string }[] = [
  { value: 'sample', label: '声线样本', hint: '上传本人录音' },
  { value: 'describe', label: '声线描述', hint: '文字描述音色' },
];

const LYRICS_EXAMPLE = `[verse]
街灯微亮 晚风轻抚
影子拉长 独自漫步
[chorus]
推开木门 香气弥漫
熟悉的角落 陌生人看`;

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDateTime(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN');
}

function entryToClip(entry: RecordingEntry): RecordingClip {
  return {
    id: entry.id,
    displayName: entry.displayName,
    fileName: entry.fileName,
    blob: null,
    url: getRecordingFileUrl(entry.id),
    duration: entry.duration,
    createdAt: entry.createdAt,
    size: entry.size,
    type: entry.mimeType,
  };
}

function revokeHistoryUrls(items: MusicHistoryItem[]) {
  items.forEach((item) => URL.revokeObjectURL(item.audioUrl));
}

export function MusicGen() {
  const [mode, setMode] = useState<MusicGenMode>('vocal');
  const [prompt, setPrompt] = useState(STYLE_EXAMPLES[0]);
  const [vocalStyle, setVocalStyle] = useState(VOCAL_EXAMPLES[0]);
  const [lyrics, setLyrics] = useState('');
  const [lyricsOptimizer, setLyricsOptimizer] = useState(false);
  const [songTitle, setSongTitle] = useState(COVER_SONG_DEFAULT.title);
  const [artistName, setArtistName] = useState(COVER_SONG_DEFAULT.artist);
  const [coverVoiceInput, setCoverVoiceInput] = useState<CoverVoiceInput>('sample');
  const [coverStyleNote, setCoverStyleNote] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [sourceLoading, setSourceLoading] = useState(false);
  const [originalSongName, setOriginalSongName] = useState('');
  const [originalSongBlob, setOriginalSongBlob] = useState<Blob | null>(null);
  const [originalSongUrl, setOriginalSongUrl] = useState('');
  const [originalSource, setOriginalSource] = useState<'search' | 'url' | 'upload' | null>(null);
  const [progressHint, setProgressHint] = useState('');
  const [referenceName, setReferenceName] = useState('');
  const [referenceBlob, setReferenceBlob] = useState<Blob | null>(null);
  const [referenceUrl, setReferenceUrl] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [history, setHistory] = useState<MusicHistoryItem[]>([]);
  const [storageReady, setStorageReady] = useState(false);
  const [error, setError] = useState('');

  const [recordings, setRecordings] = useState<RecordingClip[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickingId, setPickingId] = useState('');

  const historyRef = useRef<MusicHistoryItem[]>([]);
  const draftSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const originalFileInputRef = useRef<HTMLInputElement>(null);
  const referenceUrlRef = useRef('');
  const originalSongUrlRef = useRef('');

  const isWorking = status === 'generating';
  const useVoiceSample = coverVoiceInput === 'sample';
  const useVoiceDescribe = coverVoiceInput === 'describe';

  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const draft = loadMusicDraft();
      if (draft && !cancelled) {
        setMode(draft.mode);
        setPrompt(draft.prompt);
        setLyrics(draft.lyrics);
        setVocalStyle(draft.vocalStyle);
        setLyricsOptimizer(draft.lyricsOptimizer);
        if (typeof draft.coverUseReferenceLyrics === 'boolean') {
          /* legacy draft flag ignored */
        }
        if (typeof draft.songTitle === 'string') setSongTitle(draft.songTitle);
        if (typeof draft.artistName === 'string') setArtistName(draft.artistName);
        if (typeof draft.coverStyleNote === 'string') setCoverStyleNote(draft.coverStyleNote);
        if (typeof draft.sourceUrl === 'string') setSourceUrl(draft.sourceUrl);
        if (draft.coverVoiceInput === 'sample' || draft.coverVoiceInput === 'describe') {
          setCoverVoiceInput(draft.coverVoiceInput);
        }
        if (draft.mode === 'instrumental') {
          setPrompt(draft.prompt || STYLE_EXAMPLES[0]);
        }
        if (draft.mode === 'cover') {
          setSongTitle(draft.songTitle || COVER_SONG_DEFAULT.title);
          setArtistName(draft.artistName || COVER_SONG_DEFAULT.artist);
        }
      }
      try {
        const saved = await loadMusicHistory();
        if (!cancelled) setHistory(saved);
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setStorageReady(true);
      }
    })();
    return () => {
      cancelled = true;
      revokeHistoryUrls(historyRef.current);
      if (referenceUrlRef.current) URL.revokeObjectURL(referenceUrlRef.current);
      if (originalSongUrlRef.current) URL.revokeObjectURL(originalSongUrlRef.current);
    };
  }, []);

  useEffect(() => {
    if (!storageReady) return;
    if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);
    draftSaveTimerRef.current = setTimeout(() => {
      saveMusicDraft({
        mode,
        prompt,
        lyrics,
        vocalStyle,
        lyricsOptimizer,
        songTitle,
        artistName,
        coverStyleNote,
        sourceUrl,
        coverVoiceInput,
      });
    }, 400);
    return () => {
      if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);
    };
  }, [
    mode,
    prompt,
    lyrics,
    vocalStyle,
    lyricsOptimizer,
    songTitle,
    artistName,
    coverStyleNote,
    sourceUrl,
    coverVoiceInput,
    storageReady,
  ]);

  const setOriginalPreview = useCallback((blob: Blob, name: string, source: 'search' | 'url' | 'upload') => {
    if (originalSongUrlRef.current) URL.revokeObjectURL(originalSongUrlRef.current);
    originalSongUrlRef.current = URL.createObjectURL(blob);
    setOriginalSongBlob(blob);
    setOriginalSongName(name);
    setOriginalSongUrl(originalSongUrlRef.current);
    setOriginalSource(source);
  }, []);

  const clearOriginal = () => {
    if (originalSongUrlRef.current) URL.revokeObjectURL(originalSongUrlRef.current);
    originalSongUrlRef.current = '';
    setOriginalSongBlob(null);
    setOriginalSongName('');
    setOriginalSongUrl('');
    setOriginalSource(null);
  };

  const searchOriginalSong = async () => {
    if (!songTitle.trim() && !artistName.trim()) {
      setError('请填写歌曲名或歌手名');
      return;
    }
    setSourceLoading(true);
    setError('');
    try {
      const fetched = await fetchOriginalSongByMeta(artistName, songTitle);
      const label =
        fetched.title && fetched.artist
          ? `${fetched.artist} - ${fetched.title}（预览）`
          : `${artistName} - ${songTitle}（预览）`;
      setOriginalPreview(fetched.blob, label, 'search');
      if (fetched.title) setSongTitle(fetched.title);
      if (fetched.artist) setArtistName(fetched.artist);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSourceLoading(false);
    }
  };

  const fetchOriginalFromUrl = async () => {
    if (!sourceUrl.trim()) {
      setError('请粘贴原曲音频直链');
      return;
    }
    setSourceLoading(true);
    setError('');
    try {
      const fetched = await fetchOriginalSongFromUrl(sourceUrl);
      setOriginalPreview(fetched.blob, sourceUrl.trim(), 'url');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSourceLoading(false);
    }
  };

  const onUploadOriginal = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setOriginalPreview(file, file.name, 'upload');
    setError('');
  };

  const switchCoverVoiceInput = (next: CoverVoiceInput) => {
    setCoverVoiceInput(next);
    setError('');
  };

  const setReferencePreview = useCallback((blob: Blob, name: string) => {
    if (referenceUrlRef.current) URL.revokeObjectURL(referenceUrlRef.current);
    referenceUrlRef.current = URL.createObjectURL(blob);
    setReferenceBlob(blob);
    setReferenceName(name);
    setReferenceUrl(referenceUrlRef.current);
  }, []);

  const clearReference = () => {
    if (referenceUrlRef.current) URL.revokeObjectURL(referenceUrlRef.current);
    referenceUrlRef.current = '';
    setReferenceBlob(null);
    setReferenceName('');
    setReferenceUrl('');
  };

  const refreshRecordings = useCallback(async () => {
    setListLoading(true);
    setListError('');
    try {
      const manifest = await fetchManifest();
      setRecordings(manifest.recordings.map(entryToClip));
    } catch (err) {
      setListError(err instanceof Error ? err.message : String(err));
    } finally {
      setListLoading(false);
    }
  }, []);

  const pickRecording = async (clip: RecordingClip) => {
    setPickingId(clip.id);
    setError('');
    try {
      const blob = await fetchRecordingBlob(clip.id);
      setReferencePreview(blob, clip.displayName);
      setPickerOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPickingId('');
    }
  };

  const onUploadReference = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setReferencePreview(file, file.name);
    setError('');
  };

  const persistRemoveItem = useCallback(async (id: string) => {
    const target = historyRef.current.find((item) => item.id === id);
    if (target) URL.revokeObjectURL(target.audioUrl);
    setHistory((prev) => prev.filter((item) => item.id !== id));
    try {
      await removeMusicHistoryItem(id);
    } catch {
      /* best effort */
    }
  }, []);

  const clearHistory = useCallback(async () => {
    revokeHistoryUrls(historyRef.current);
    setHistory([]);
    try {
      await clearMusicHistoryStore();
    } catch {
      /* best effort */
    }
  }, []);

  const runGenerate = async () => {
    setError('');

    if (mode === 'cover') {
      if (!songTitle.trim()) {
        setError('翻唱：请填写歌曲名');
        setStatus('error');
        return;
      }
      if (useVoiceSample && !referenceBlob) {
        setError('翻唱：请在「声线样本」页签上传或选择本人录音');
        setStatus('error');
        return;
      }
      if (useVoiceDescribe && !vocalStyle.trim()) {
        setError('翻唱：请在「声线描述」页签填写音色说明');
        setStatus('error');
        return;
      }
      const trimmedLyrics = lyrics.trim();
      if (trimmedLyrics && (trimmedLyrics.length < 10 || trimmedLyrics.length > 1000)) {
        setError('翻唱：歌词长度需 10–1000 个字符，或留空从原曲识别');
        setStatus('error');
        return;
      }
    }

    setStatus('generating');
    setProgressHint(mode === 'cover' ? '准备中…' : '');

    try {
      let originalBlob = originalSongBlob;
      if (mode === 'cover' && !originalBlob) {
        setProgressHint('正在搜索并下载原曲…');
        const fetched = await fetchOriginalSongByMeta(artistName, songTitle);
        originalBlob = fetched.blob;
        setOriginalPreview(
          fetched.blob,
          fetched.title && fetched.artist
            ? `${fetched.artist} - ${fetched.title}（预览）`
            : `${artistName} - ${songTitle}（预览）`,
          'search',
        );
      }

      let voiceBase64: string | undefined;
      if (mode === 'cover' && useVoiceSample && referenceBlob) {
        voiceBase64 = await readAudioFileAsBase64(referenceBlob, '声线样本');
      }

      let originalBase64: string | undefined;
      if (mode === 'cover' && originalBlob) {
        originalBase64 = await readAudioFileAsBase64(originalBlob, '原曲参考');
      }

      const coverIntent =
        mode === 'cover' ? buildCoverIntent(artistName, songTitle, coverStyleNote) : prompt;

      const result = await generateMusic({
        mode,
        prompt: mode === 'cover' ? coverIntent : prompt,
        song_title: mode === 'cover' ? songTitle : undefined,
        artist_name: mode === 'cover' ? artistName : undefined,
        cover_style_note: mode === 'cover' ? coverStyleNote : undefined,
        original_audio_base64: originalBase64,
        voice_audio_base64: voiceBase64,
        lyrics: mode === 'instrumental' ? undefined : lyrics,
        vocal_style:
          mode === 'vocal'
            ? vocalStyle
            : mode === 'cover' && useVoiceDescribe && vocalStyle.trim()
              ? vocalStyle
              : undefined,
        lyrics_optimizer: mode === 'vocal' ? lyricsOptimizer : undefined,
        onCoverProgress:
          mode === 'cover'
            ? (step) => {
                const hints: Record<string, string> = {
                  preprocess: '正在从你的声线样本提取音色…',
                  fetch: '正在获取原曲参考…',
                  lyrics: '正在生成目标歌词…',
                  generate: '正在用你的声线翻唱原曲（约 1–3 分钟）…',
                };
                setProgressHint(hints[step] ?? '');
              }
            : undefined,
      });

      const savedLyrics =
        mode === 'instrumental'
          ? ''
          : (result.resolvedLyrics ?? lyrics).trim();
      if (result.resolvedLyrics && mode === 'cover') {
        setLyrics(result.resolvedLyrics);
      }

      const blobRes = await fetch(result.audioUrl);
      const blob = await blobRes.blob();
      URL.revokeObjectURL(result.audioUrl);

      const id = crypto.randomUUID();
      const entry = {
        id,
        mode,
        prompt: mode === 'cover' ? coverIntent : prompt.trim(),
        lyrics: savedLyrics,
        vocalStyle: mode === 'vocal' || mode === 'cover' ? vocalStyle.trim() : '',
        referenceName: mode === 'cover' ? referenceName : '',
        songTitle: mode === 'cover' ? songTitle.trim() : undefined,
        artistName: mode === 'cover' ? artistName.trim() : undefined,
        format: result.format,
        durationMs: result.durationMs,
        model: result.model,
        lyricsOptimizer: mode === 'vocal' && lyricsOptimizer,
        createdAt: Date.now(),
      };
      await appendMusicHistory(entry, blob);

      const item: MusicHistoryItem = {
        ...entry,
        audioUrl: URL.createObjectURL(blob),
      };
      setHistory((prev) => [item, ...prev.filter((h) => h.id !== id)].slice(0, 50));
      setStatus('done');
      setProgressHint('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus('error');
      setProgressHint('');
    }
  };

  const downloadItem = (item: MusicHistoryItem) => {
    const a = document.createElement('a');
    a.href = item.audioUrl;
    a.download = `music-${item.createdAt}.${item.format}`;
    a.click();
  };

  return (
    <>
      <div className="grid gap-6 lg:grid-cols-[1fr_0.65fr]">
        <section className="rounded-lg border border-border bg-card p-5 shadow-panel sm:p-6">
          <div className="mb-4 flex items-center gap-2">
            <Music2 size={20} className="text-primary" />
            <h2 className="text-base font-semibold">音乐生成</h2>
          </div>
          <p className="mb-4 text-sm text-muted-foreground">
            有人声 / 纯音乐 / 翻唱三种模式；历史记录保存在本浏览器，刷新不丢失。
          </p>

          <div className="mb-5 grid grid-cols-3 gap-2">
            {MODE_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                disabled={isWorking}
                onClick={() => {
                  setMode(o.value);
                  setError('');
                  if (o.value === 'cover' && prompt === STYLE_EXAMPLES[0]) {
                    setSongTitle(COVER_SONG_DEFAULT.title);
                    setArtistName(COVER_SONG_DEFAULT.artist);
                  }
                }}
                className={`rounded-lg border px-2 py-2 text-left text-sm transition ${
                  mode === o.value
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border hover:bg-muted'
                }`}
              >
                <span className="block font-medium">{o.label}</span>
                <span className="mt-0.5 block text-[11px] opacity-80">{o.hint}</span>
              </button>
            ))}
          </div>

          <div className="grid gap-4">
            {mode === 'cover' && (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1.5 block text-sm font-medium">歌曲名</label>
                    <input
                      value={songTitle}
                      onChange={(e) => setSongTitle(e.target.value)}
                      disabled={isWorking || sourceLoading}
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      placeholder="如：大海"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium">歌手 / 原唱</label>
                    <input
                      value={artistName}
                      onChange={(e) => setArtistName(e.target.value)}
                      disabled={isWorking || sourceLoading}
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      placeholder="如：张雨生"
                    />
                  </div>
                </div>

                <div className="rounded-lg border border-border bg-muted/20 p-3">
                  <label className="mb-2 block text-sm font-medium">翻唱声线（二选一）</label>
                  <div className="mb-3 grid grid-cols-2 gap-2">
                    {COVER_VOICE_TABS.map((tab) => (
                      <button
                        key={tab.value}
                        type="button"
                        disabled={isWorking}
                        onClick={() => switchCoverVoiceInput(tab.value)}
                        className={`rounded-lg border px-2 py-2 text-left text-sm transition ${
                          coverVoiceInput === tab.value
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border bg-background hover:bg-muted'
                        }`}
                      >
                        <span className="block font-medium">{tab.label}</span>
                        <span className="mt-0.5 block text-[11px] opacity-80">{tab.hint}</span>
                      </button>
                    ))}
                  </div>

                  {useVoiceSample && (
                    <>
                      <p className="mb-2 text-xs text-muted-foreground">
                        上传 6 秒–6 分钟的本人录音，系统将提取你的音色参与翻唱（不使用文字描述）。
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            void refreshRecordings();
                            setPickerOpen(true);
                          }}
                          disabled={isWorking}
                          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-2 text-sm hover:bg-muted"
                        >
                          <FolderOpen size={15} />
                          从音频采集选择
                        </button>
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          disabled={isWorking}
                          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-2 text-sm hover:bg-muted"
                        >
                          <Upload size={15} />
                          上传声线样本
                        </button>
                        {referenceBlob && (
                          <button
                            type="button"
                            onClick={clearReference}
                            disabled={isWorking}
                            className="px-3 py-2 text-sm text-muted-foreground hover:bg-muted"
                          >
                            清除
                          </button>
                        )}
                      </div>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="audio/*,.mp3,.wav,.m4a,.flac"
                        className="hidden"
                        onChange={onUploadReference}
                      />
                      {referenceName ? (
                        <div className="mt-3 rounded-lg border border-border bg-background/60 p-3">
                          <p className="text-sm font-medium">{referenceName}</p>
                          {referenceUrl && (
                            <audio controls src={referenceUrl} className="mt-2 w-full" preload="metadata" />
                          )}
                        </div>
                      ) : (
                        <p className="mt-2 text-xs text-muted-foreground">请选择或上传一段本人录音。</p>
                      )}
                    </>
                  )}

                  {useVoiceDescribe && (
                    <>
                      <p className="mb-2 text-xs text-muted-foreground">
                        用文字描述目标音色，无需上传录音（本页签下不会使用声线样本）。
                      </p>
                      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                        <label className="text-sm font-medium">声线描述（写入翻唱风格）</label>
                        <div className="flex flex-wrap gap-1">
                          {VOCAL_EXAMPLES.map((ex) => (
                            <button
                              key={ex}
                              type="button"
                              disabled={isWorking}
                              onClick={() => setVocalStyle(ex)}
                              className="rounded border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted"
                            >
                              示例
                            </button>
                          ))}
                        </div>
                      </div>
                      <input
                        value={vocalStyle}
                        onChange={(e) => setVocalStyle(e.target.value)}
                        disabled={isWorking}
                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                        placeholder="如：温暖男声, 略带沙哑, 中文"
                      />
                    </>
                  )}
                </div>

                <div className="rounded-lg border border-border bg-muted/20 p-3">
                  <label className="mb-1.5 block text-sm font-medium">原曲参考（保留旋律）</label>
                  <p className="mb-2 text-xs text-muted-foreground">
                    按歌名搜索并下载 iTunes 预览（约 30 秒），或粘贴原曲直链 / 上传完整原曲。生成时会用原曲旋律 + 你的声线合成翻唱。
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void searchOriginalSong()}
                      disabled={isWorking || sourceLoading}
                      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-2 text-sm hover:bg-muted"
                    >
                      {sourceLoading ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
                      搜索并获取原曲
                    </button>
                    <button
                      type="button"
                      onClick={() => originalFileInputRef.current?.click()}
                      disabled={isWorking || sourceLoading}
                      className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted"
                    >
                      <Upload size={15} />
                      上传原曲
                    </button>
                    {originalSongBlob && (
                      <button
                        type="button"
                        onClick={clearOriginal}
                        disabled={isWorking || sourceLoading}
                        className="px-3 py-2 text-sm text-muted-foreground hover:bg-muted"
                      >
                        清除原曲
                      </button>
                    )}
                  </div>
                  <input
                    ref={originalFileInputRef}
                    type="file"
                    accept="audio/*,.mp3,.wav,.m4a,.flac"
                    className="hidden"
                    onChange={onUploadOriginal}
                  />
                  <div className="mt-2 flex gap-2">
                    <input
                      value={sourceUrl}
                      onChange={(e) => setSourceUrl(e.target.value)}
                      disabled={isWorking || sourceLoading}
                      className="min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
                      placeholder="或粘贴原曲 mp3/wav 直链"
                    />
                    <button
                      type="button"
                      onClick={() => void fetchOriginalFromUrl()}
                      disabled={isWorking || sourceLoading}
                      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted"
                    >
                      <Link2 size={14} />
                      获取
                    </button>
                  </div>
                  {originalSongName && (
                    <div className="mt-3 rounded-lg border border-border bg-background/60 p-3">
                      <p className="text-sm font-medium">{originalSongName}</p>
                      {originalSongUrl && (
                        <audio controls src={originalSongUrl} className="mt-2 w-full" preload="metadata" />
                      )}
                    </div>
                  )}
                </div>

                <div>
                  <label className="mb-1.5 block text-sm font-medium">补充风格（可选）</label>
                  <input
                    value={coverStyleNote}
                    onChange={(e) => setCoverStyleNote(e.target.value)}
                    disabled={isWorking}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    placeholder="如：更摇滚一点 / acoustic 版"
                  />
                </div>
              </>
            )}

            {mode !== 'cover' && (
            <div>
              <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                <label className="text-sm font-medium">风格描述（prompt）</label>
                <div className="flex flex-wrap gap-1">
                  {STYLE_EXAMPLES.map((ex) => (
                    <button
                      key={ex}
                      type="button"
                      disabled={isWorking}
                      onClick={() => setPrompt(ex)}
                      className="rounded border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted"
                    >
                      示例
                    </button>
                  ))}
                </div>
              </div>
              <input
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                disabled={isWorking}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                placeholder="流派、情绪、乐器、节奏…"
              />
            </div>
            )}

            {mode === 'vocal' && (
              <div>
                <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                  <label className="text-sm font-medium">人声描述（写入 prompt）</label>
                  <div className="flex flex-wrap gap-1">
                    {VOCAL_EXAMPLES.map((ex) => (
                      <button
                        key={ex}
                        type="button"
                        disabled={isWorking}
                        onClick={() => setVocalStyle(ex)}
                        className="rounded border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted"
                      >
                        示例
                      </button>
                    ))}
                  </div>
                </div>
                <input
                  value={vocalStyle}
                  onChange={(e) => setVocalStyle(e.target.value)}
                  disabled={isWorking}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  placeholder="温暖男声, 中文 / 甜美女声, 流行"
                />
              </div>
            )}

            {mode === 'vocal' && (
              <label className="inline-flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={lyricsOptimizer}
                  onChange={(e) => setLyricsOptimizer(e.target.checked)}
                  disabled={isWorking}
                />
                AI 优化歌词（歌词留空时按风格自动生成）
              </label>
            )}

            {mode !== 'instrumental' && (
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <label className="text-sm font-medium">
                    {mode === 'cover' ? '目标歌词（可选）' : '歌词'}
                  </label>
                  {(mode === 'vocal' || mode === 'cover') && (
                    <button
                      type="button"
                      disabled={isWorking}
                      onClick={() => setLyrics(LYRICS_EXAMPLE)}
                      className="text-xs text-primary hover:underline"
                    >
                      填入示例歌词
                    </button>
                  )}
                </div>
                <textarea
                  value={lyrics}
                  onChange={(e) => setLyrics(e.target.value)}
                  disabled={isWorking}
                  rows={8}
                  className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 font-mono text-sm"
                  placeholder={
                    mode === 'cover'
                      ? '留空则从原曲识别；也可手动填写要唱的歌词'
                      : '支持 [verse] / [chorus] 等结构标签'
                  }
                />
              </div>
            )}

            {mode === 'instrumental' && (
              <p className="text-xs text-muted-foreground">
                纯音乐模式无需歌词与人声描述，仅根据风格描述生成伴奏。
              </p>
            )}

            <button
              type="button"
              onClick={() => void runGenerate()}
              disabled={isWorking}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {isWorking ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  {progressHint || (mode === 'cover' ? '生成翻唱中（约 1–3 分钟）…' : '生成中（约 1–3 分钟）…')}
                </>
              ) : (
                <>
                  <Music2 size={16} />
                  生成音乐
                </>
              )}
            </button>

            {error && (
              <>
                <MiniMaxBillingAlert error={error} featureLabel="音乐生成" feature="chat" />
                {!buildMiniMaxBillingAlert(error, 'chat') && (
                  <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    <AlertCircle size={16} className="mt-0.5 shrink-0" />
                    <span>{error}</span>
                  </div>
                )}
              </>
            )}
          </div>
        </section>

        <section className="rounded-lg border border-border bg-card p-5 shadow-panel sm:p-6">
          <div className="mb-4 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Music2 size={18} className="text-primary" />
              <h2 className="text-base font-semibold">历史音乐</h2>
              {history.length > 0 && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  {history.length}
                </span>
              )}
            </div>
            {history.length > 0 && (
              <button
                type="button"
                onClick={() => void clearHistory()}
                className="text-xs text-muted-foreground transition hover:text-red-500"
              >
                清空全部
              </button>
            )}
          </div>

          {!storageReady ? (
            <div className="flex aspect-[4/3] items-center justify-center text-sm text-muted-foreground">
              <Loader2 size={18} className="mr-2 animate-spin" />
              正在加载本地历史…
            </div>
          ) : history.length > 0 ? (
            <div className="max-h-[min(70vh,640px)] space-y-3 overflow-y-auto pr-1">
              {history.map((item) => (
                <article
                  key={item.id}
                  className="rounded-lg border border-border bg-background/60 p-3 shadow-sm"
                >
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 text-sm font-medium leading-relaxed text-foreground">
                        {previewMusicLabel(item)}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatTime(item.createdAt)}
                        {item.durationMs != null && ` · 约 ${Math.round(item.durationMs / 1000)} 秒`}
                        {` · ${musicModeLabel(item.mode)} · ${item.model}`}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void persistRemoveItem(item.id)}
                      className="shrink-0 rounded-md p-1.5 text-muted-foreground transition hover:bg-red-500/10 hover:text-red-500"
                      aria-label="删除"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                  <audio controls src={item.audioUrl} className="mb-2 w-full" preload="metadata" />
                  <button
                    type="button"
                    onClick={() => downloadItem(item)}
                    className="flex w-full items-center justify-center gap-2 rounded-lg border border-border px-3 py-1.5 text-xs font-medium transition hover:bg-muted"
                  >
                    <Download size={14} />
                    下载
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <div className="flex aspect-[4/3] flex-col items-center justify-center gap-3 rounded-lg border border-border bg-black/5 text-muted-foreground/50">
              <Music2 size={40} />
              <p className="text-sm">生成的音乐会出现在这里</p>
              <p className="text-xs">已启用浏览器本地保存，刷新不丢失</p>
            </div>
          )}
        </section>
      </div>

      <RecordingPickerModal
        open={pickerOpen}
        recordings={recordings}
        listLoading={listLoading}
        listError={listError}
        pickingId={pickingId}
        onClose={() => setPickerOpen(false)}
        onSelect={(clip) => void pickRecording(clip)}
        formatDuration={formatDuration}
        formatFileSize={formatFileSize}
        formatDateTime={formatDateTime}
      />
    </>
  );
}
