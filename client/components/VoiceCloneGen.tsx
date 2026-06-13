'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  AudioWaveform,
  Download,
  FolderOpen,
  Loader2,
  Trash2,
  Upload,
  Volume2,
} from 'lucide-react';
import { MiniMaxBillingAlert } from '@/components/MiniMaxBillingAlert';
import { RecordingPickerModal } from '@/components/RecordingPickerModal';
import { convertBlobToWav } from '@/lib/audio-to-wav';
import {
  loadClonedVoices,
  removeClonedVoice,
  saveClonedVoice,
  type ClonedVoiceEntry,
} from '@/lib/cloned-voices-storage';
import { synthesizeSpeech, type SpeechModel } from '@/lib/minimax';
import { buildMiniMaxBillingAlert } from '@/lib/minimax-errors';
import {
  buildCloneVoiceId,
  cloneMiniMaxVoice,
  uploadMiniMaxVoiceFile,
} from '@/lib/minimax-voice-clone';
import {
  fetchManifest,
  fetchRecordingBlob,
  getRecordingFileUrl,
  type RecordingEntry,
} from '@/lib/recordings';
import type { RecordingClip } from '@/types/recording';

type CloneStatus = 'idle' | 'uploading' | 'cloning' | 'done' | 'error';
type SynthStatus = 'idle' | 'generating' | 'done' | 'error';

const MODEL: SpeechModel = 'speech-2.8-hd';
const PREVIEW_TEXT = '你好，这是我克隆后的专属音色，欢迎试听。';

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

export function VoiceCloneGen() {
  const [voiceLabel, setVoiceLabel] = useState('');
  const [sourceName, setSourceName] = useState('');
  const [sourceBlob, setSourceBlob] = useState<Blob | null>(null);
  const [sourceUrl, setSourceUrl] = useState('');
  const [cloneStatus, setCloneStatus] = useState<CloneStatus>('idle');
  const [cloneError, setCloneError] = useState('');
  const [clonedVoices, setClonedVoices] = useState<ClonedVoiceEntry[]>([]);
  const [activeVoiceId, setActiveVoiceId] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const [synthText, setSynthText] = useState(PREVIEW_TEXT);
  const [synthStatus, setSynthStatus] = useState<SynthStatus>('idle');
  const [synthError, setSynthError] = useState('');
  const [synthAudioUrl, setSynthAudioUrl] = useState('');

  const [recordings, setRecordings] = useState<RecordingClip[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickingId, setPickingId] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewUrlRef = useRef('');
  const synthUrlRef = useRef('');

  const isCloning = cloneStatus === 'uploading' || cloneStatus === 'cloning';
  const isSynthWorking = synthStatus === 'generating';

  const revokePreview = useCallback(() => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = '';
    }
    setPreviewUrl('');
  }, []);

  const revokeSynth = useCallback(() => {
    if (synthUrlRef.current) {
      URL.revokeObjectURL(synthUrlRef.current);
      synthUrlRef.current = '';
    }
    setSynthAudioUrl('');
  }, []);

  const setSourcePreview = useCallback(
    (blob: Blob, name: string) => {
      if (sourceUrl) URL.revokeObjectURL(sourceUrl);
      setSourceBlob(blob);
      setSourceName(name);
      setSourceUrl(URL.createObjectURL(blob));
    },
    [sourceUrl],
  );

  useEffect(() => {
    setClonedVoices(loadClonedVoices());
    return () => {
      if (sourceUrl) URL.revokeObjectURL(sourceUrl);
      revokePreview();
      revokeSynth();
    };
  }, [revokePreview, revokeSynth, sourceUrl]);

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

  const openPicker = () => {
    void refreshRecordings();
    setPickerOpen(true);
  };

  const pickRecording = async (clip: RecordingClip) => {
    setPickingId(clip.id);
    setCloneError('');
    try {
      const blob = await fetchRecordingBlob(clip.id);
      setSourcePreview(blob, clip.displayName);
      if (!voiceLabel.trim()) setVoiceLabel(clip.displayName.replace(/\.[^.]+$/, ''));
      setPickerOpen(false);
    } catch (err) {
      setCloneError(err instanceof Error ? err.message : String(err));
    } finally {
      setPickingId('');
    }
  };

  const onUploadFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setSourcePreview(file, file.name);
    if (!voiceLabel.trim()) setVoiceLabel(file.name.replace(/\.[^.]+$/, ''));
    setCloneError('');
  };

  const clearSource = () => {
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    setSourceBlob(null);
    setSourceName('');
    setSourceUrl('');
    setCloneError('');
  };

  const runClone = async () => {
    if (!sourceBlob) {
      setCloneError('请先选择或上传一段人声样本');
      return;
    }
    if (!voiceLabel.trim()) {
      setCloneError('请填写音色名称');
      return;
    }

    setCloneError('');
    revokePreview();
    setCloneStatus('uploading');

    try {
      const { blob: wavBlob, filename } = await convertBlobToWav(sourceBlob);
      const fileId = await uploadMiniMaxVoiceFile(wavBlob, filename, 'voice_clone');

      setCloneStatus('cloning');
      const voiceId = buildCloneVoiceId();
      const result = await cloneMiniMaxVoice({
        fileId,
        voiceId,
        previewText: PREVIEW_TEXT,
        model: MODEL,
      });

      const entry: ClonedVoiceEntry = {
        voiceId: result.voiceId,
        label: voiceLabel.trim(),
        sourceName,
        createdAt: Date.now(),
      };
      saveClonedVoice(entry);
      setClonedVoices(loadClonedVoices());
      setActiveVoiceId(result.voiceId);

      if (result.previewAudioUrl) {
        previewUrlRef.current = result.previewAudioUrl;
        setPreviewUrl(result.previewAudioUrl);
      }

      setCloneStatus('done');
    } catch (err) {
      setCloneError(err instanceof Error ? err.message : String(err));
      setCloneStatus('error');
    }
  };

  const deleteClone = (voiceId: string) => {
    removeClonedVoice(voiceId);
    setClonedVoices(loadClonedVoices());
    if (activeVoiceId === voiceId) setActiveVoiceId('');
  };

  const runSynth = async () => {
    if (!activeVoiceId) {
      setSynthError('请先选择或创建一个克隆音色');
      return;
    }
    if (!synthText.trim()) {
      setSynthError('请输入要合成的文本');
      return;
    }

    revokeSynth();
    setSynthError('');
    setSynthStatus('generating');

    try {
      const result = await synthesizeSpeech({
        text: synthText.trim(),
        model: MODEL,
        voice_id: activeVoiceId,
        speed: 1,
      });
      synthUrlRef.current = result.audioUrl;
      setSynthAudioUrl(result.audioUrl);
      setSynthStatus('done');
    } catch (err) {
      setSynthError(err instanceof Error ? err.message : String(err));
      setSynthStatus('error');
    }
  };

  return (
    <>
      <div className="grid gap-6 lg:grid-cols-[1fr_0.55fr]">
        <div className="space-y-6">
          <section className="rounded-lg border border-border bg-card p-5 shadow-panel sm:p-6">
            <div className="mb-5 flex items-center gap-2">
              <AudioWaveform size={20} className="text-primary" />
              <h2 className="text-base font-semibold">声音克隆</h2>
            </div>
            <p className="mb-5 text-sm text-muted-foreground">
              从「音频采集」选一条清晰人声（建议 10 秒以上），或上传 wav / mp3 / m4a。克隆完成后可在本页或「文字转语音」里使用自定义音色。
            </p>

            <div className="grid gap-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium">克隆样本</label>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={openPicker}
                    disabled={isCloning}
                    className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
                  >
                    <FolderOpen size={16} />
                    从音频采集选择
                  </button>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isCloning}
                    className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
                  >
                    <Upload size={16} />
                    上传音频
                  </button>
                  {sourceBlob && (
                    <button
                      type="button"
                      onClick={clearSource}
                      disabled={isCloning}
                      className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted disabled:opacity-50"
                    >
                      清除样本
                    </button>
                  )}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="audio/*,.wav,.mp3,.m4a"
                  className="hidden"
                  onChange={onUploadFile}
                />
                {sourceName && (
                  <div className="mt-3 rounded-lg border border-border bg-muted/30 p-3">
                    <p className="text-sm font-medium">{sourceName}</p>
                    {sourceUrl && (
                      <audio controls src={sourceUrl} className="mt-2 w-full" preload="metadata" />
                    )}
                  </div>
                )}
              </div>

              <div>
                <label htmlFor="clone-voice-label" className="mb-1.5 block text-sm font-medium">
                  音色名称（本地显示用，可中文）
                </label>
                <input
                  id="clone-voice-label"
                  type="text"
                  value={voiceLabel}
                  onChange={(e) => setVoiceLabel(e.target.value)}
                  placeholder="例如：我的播报声"
                  maxLength={32}
                  disabled={isCloning}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </div>

              <button
                type="button"
                onClick={() => void runClone()}
                disabled={isCloning || !sourceBlob}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {isCloning ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    {cloneStatus === 'uploading' ? '上传样本…' : '克隆中…'}
                  </>
                ) : (
                  <>
                    <AudioWaveform size={16} />
                    开始克隆
                  </>
                )}
              </button>

              {cloneError && (
                <>
                  <MiniMaxBillingAlert error={cloneError} featureLabel="声音克隆" feature="chat" />
                  {!buildMiniMaxBillingAlert(cloneError, 'chat') && (
                    <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                      <AlertCircle size={16} className="mt-0.5 shrink-0" />
                      <span>{cloneError}</span>
                    </div>
                  )}
                </>
              )}
            </div>
          </section>

          <section className="rounded-lg border border-border bg-card p-5 shadow-panel sm:p-6">
            <div className="mb-4 flex items-center gap-2">
              <Volume2 size={18} className="text-primary" />
              <h3 className="text-sm font-semibold">用克隆音色合成</h3>
            </div>
            <div className="grid gap-3">
              <div>
                <label htmlFor="clone-active-voice" className="mb-1.5 block text-sm font-medium">
                  当前音色
                </label>
                <select
                  id="clone-active-voice"
                  value={activeVoiceId}
                  onChange={(e) => setActiveVoiceId(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="">请选择已克隆音色</option>
                  {clonedVoices.map((v) => (
                    <option key={v.voiceId} value={v.voiceId}>
                      {v.label}（{v.voiceId}）
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="clone-synth-text" className="mb-1.5 block text-sm font-medium">
                  合成文本
                </label>
                <textarea
                  id="clone-synth-text"
                  value={synthText}
                  onChange={(e) => setSynthText(e.target.value)}
                  rows={4}
                  className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </div>
              <button
                type="button"
                onClick={() => void runSynth()}
                disabled={isSynthWorking || !activeVoiceId}
                className="inline-flex items-center justify-center gap-2 rounded-md border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
              >
                {isSynthWorking ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    合成中…
                  </>
                ) : (
                  '生成语音'
                )}
              </button>
              {synthError && (
                <>
                  <MiniMaxBillingAlert error={synthError} featureLabel="文字转语音" feature="chat" />
                  {!buildMiniMaxBillingAlert(synthError, 'chat') && (
                    <p className="text-sm text-destructive">{synthError}</p>
                  )}
                </>
              )}
              {synthAudioUrl && (
                <div className="rounded-lg border border-border bg-muted/30 p-3">
                  <audio controls src={synthAudioUrl} className="w-full" />
                  <a
                    href={synthAudioUrl}
                    download={`clone-tts-${Date.now()}.mp3`}
                    className="mt-2 inline-flex items-center gap-1 text-sm text-primary hover:underline"
                  >
                    <Download size={14} />
                    下载
                  </a>
                </div>
              )}
            </div>
          </section>
        </div>

        <aside className="space-y-4">
          {previewUrl && (
            <section className="rounded-lg border border-border bg-card p-4 shadow-panel">
              <h3 className="mb-2 text-sm font-semibold">克隆试听（API 返回）</h3>
              <audio controls src={previewUrl} className="w-full" />
            </section>
          )}

          <section className="rounded-lg border border-border bg-card p-4 shadow-panel">
            <h3 className="mb-3 text-sm font-semibold">已保存的克隆音色</h3>
            {clonedVoices.length === 0 ? (
              <p className="text-sm text-muted-foreground">暂无，完成一次克隆后会出现在这里。</p>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {clonedVoices.map((v) => (
                  <li key={v.voiceId} className="flex items-start gap-2 p-3">
                    <button
                      type="button"
                      onClick={() => setActiveVoiceId(v.voiceId)}
                      className={`min-w-0 flex-1 text-left ${activeVoiceId === v.voiceId ? 'text-primary' : ''}`}
                    >
                      <p className="truncate text-sm font-medium">{v.label}</p>
                      <p className="truncate text-xs text-muted-foreground">{v.sourceName}</p>
                      <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                        {v.voiceId}
                      </p>
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteClone(v.voiceId)}
                      className="shrink-0 rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
                      aria-label="删除"
                    >
                      <Trash2 size={15} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
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
