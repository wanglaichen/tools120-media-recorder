'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Download, Eraser, Loader2, Trash2, Volume2 } from 'lucide-react';
import { MiniMaxBillingAlert } from '@/components/MiniMaxBillingAlert';
import {
  synthesizeSpeech,
  type SpeechModel,
} from '@/lib/minimax';
import { buildMiniMaxBillingAlert } from '@/lib/minimax-errors';
import {
  DEFAULT_SPEECH_VOICE_ID,
  getClonedSpeechVoiceOptions,
  SPEECH_VOICE_GROUP_LABELS,
  SPEECH_VOICE_GROUP_ORDER,
  SPEECH_VOICE_OPTIONS,
  speechVoiceLabel,
} from '@/lib/speech-voices';
import {
  appendSpeechHistory,
  clearSpeechDraft,
  clearSpeechHistoryStore,
  loadSpeechDraft,
  loadSpeechHistory,
  removeSpeechHistoryItem,
  saveSpeechDraft,
  type SpeechHistoryItem,
} from '@/lib/speech-storage';

type SpeechGenStatus = 'idle' | 'generating' | 'done' | 'error';

const MODEL_OPTIONS: { value: SpeechModel; label: string }[] = [
  { value: 'speech-2.8-hd', label: 'speech-2.8 HD（推荐）' },
  { value: 'speech-2.8-turbo', label: 'speech-2.8 Turbo' },
  { value: 'speech-2.6-hd', label: 'speech-2.6 HD' },
  { value: 'speech-2.6-turbo', label: 'speech-2.6 Turbo' },
];

const MAX_CHARS = 10000;

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function previewText(text: string, max = 80): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

function revokeHistoryUrls(items: SpeechHistoryItem[]) {
  items.forEach((item) => URL.revokeObjectURL(item.audioUrl));
}

export function SpeechGen() {
  const [text, setText] = useState('');
  const [model, setModel] = useState<SpeechModel>('speech-2.8-hd');
  const [voiceId, setVoiceId] = useState(DEFAULT_SPEECH_VOICE_ID);
  const [speed, setSpeed] = useState(1);
  const [status, setStatus] = useState<SpeechGenStatus>('idle');
  const [history, setHistory] = useState<SpeechHistoryItem[]>([]);
  const [clonedVoiceOptions, setClonedVoiceOptions] = useState<
    ReturnType<typeof getClonedSpeechVoiceOptions>
  >([]);
  const [storageReady, setStorageReady] = useState(false);
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const historyRef = useRef<SpeechHistoryItem[]>([]);
  const draftSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isWorking = status === 'generating';

  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const draft = loadSpeechDraft();
      if (draft && !cancelled) {
        setText(draft.text);
        setModel(draft.model);
        setVoiceId(draft.voiceId);
        setSpeed(draft.speed);
      }
      try {
        const saved = await loadSpeechHistory();
        if (!cancelled) setHistory(saved);
      } catch {
        /* ignore corrupt local data */
      } finally {
        if (!cancelled) {
          setClonedVoiceOptions(getClonedSpeechVoiceOptions());
          setStorageReady(true);
        }
      }
    })();
    return () => {
      cancelled = true;
      abortRef.current?.abort();
      revokeHistoryUrls(historyRef.current);
    };
  }, []);

  useEffect(() => {
    if (!storageReady) return;
    if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);
    draftSaveTimerRef.current = setTimeout(() => {
      saveSpeechDraft({ text, model, voiceId, speed });
    }, 400);
    return () => {
      if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);
    };
  }, [text, model, voiceId, speed, storageReady]);

  const persistRemoveItem = useCallback(async (id: string) => {
    const target = historyRef.current.find((item) => item.id === id);
    if (target) URL.revokeObjectURL(target.audioUrl);
    setHistory((prev) => prev.filter((item) => item.id !== id));
    try {
      await removeSpeechHistoryItem(id);
    } catch {
      /* best effort */
    }
  }, []);

  const clearHistory = useCallback(async () => {
    revokeHistoryUrls(historyRef.current);
    setHistory([]);
    try {
      await clearSpeechHistoryStore();
    } catch {
      /* best effort */
    }
  }, []);

  const clearTextInput = () => {
    setText('');
    clearSpeechDraft();
    setError('');
  };

  const cancelGenerate = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStatus('idle');
  };

  const generate = async () => {
    if (!text.trim()) {
      setError('请输入要合成的文本');
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setError('');
    setStatus('generating');

    try {
      const result = await synthesizeSpeech({
        text: text.trim(),
        model,
        voice_id: voiceId,
        speed,
      });
      if (controller.signal.aborted) {
        URL.revokeObjectURL(result.audioUrl);
        return;
      }

      const blobRes = await fetch(result.audioUrl);
      const blob = await blobRes.blob();
      URL.revokeObjectURL(result.audioUrl);

      const id = crypto.randomUUID();
      const entry = {
        id,
        text: text.trim(),
        format: result.format,
        durationMs: result.durationMs,
        model,
        voiceId,
        voiceLabel: speechVoiceLabel(voiceId),
        createdAt: Date.now(),
      };
      await appendSpeechHistory(entry, blob);

      const item: SpeechHistoryItem = {
        ...entry,
        audioUrl: URL.createObjectURL(blob),
      };
      setHistory((prev) => [item, ...prev.filter((h) => h.id !== id)].slice(0, 100));
      setStatus('done');
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : String(err));
      setStatus('error');
    }
  };

  const downloadItem = (item: SpeechHistoryItem) => {
    const a = document.createElement('a');
    a.href = item.audioUrl;
    a.download = `speech-${item.createdAt}.${item.format}`;
    a.click();
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_0.65fr]">
      <section className="rounded-lg border border-border bg-card p-5 shadow-panel sm:p-6">
        <div className="mb-5 flex items-center gap-2">
          <Volume2 size={20} className="text-primary" />
          <h2 className="text-base font-semibold">文字转语音</h2>
        </div>

        <div className="grid gap-5">
          <div>
            <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
              <label className="text-sm font-medium text-muted-foreground">合成文本</label>
              <div className="flex items-center gap-2">
                {text.length > 0 && (
                  <button
                    type="button"
                    onClick={clearTextInput}
                    disabled={isWorking}
                    className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-50"
                  >
                    <Eraser size={12} />
                    一键清除
                  </button>
                )}
                <span className="text-xs text-muted-foreground">
                  {text.length}/{MAX_CHARS}
                </span>
              </div>
            </div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, MAX_CHARS))}
              disabled={isWorking}
              rows={8}
              placeholder="输入要朗读的中文或英文文本，例如：欢迎使用 AI 聚合工作台..."
              className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
            <p className="mt-1.5 text-xs text-muted-foreground/70">
              输入内容与历史语音已自动保存到本浏览器，刷新页面不会丢失。
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-muted-foreground">模型</label>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value as SpeechModel)}
                disabled={isWorking}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                {MODEL_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-muted-foreground">音色</label>
              <select
                value={voiceId}
                onChange={(e) => setVoiceId(e.target.value)}
                disabled={isWorking}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                {SPEECH_VOICE_GROUP_ORDER.map((group) => {
                  const options =
                    group === 'cloned'
                      ? clonedVoiceOptions
                      : SPEECH_VOICE_OPTIONS.filter((o) => o.group === group);
                  if (options.length === 0) return null;
                  return (
                    <optgroup key={group} label={SPEECH_VOICE_GROUP_LABELS[group]}>
                      {options.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </optgroup>
                  );
                })}
              </select>
              <p className="mt-1 text-xs text-muted-foreground/70">
                在「声音克隆」页创建的音色会出现在「我的克隆音色」分组；也可使用 MiniMax 官方预设音色。
              </p>
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-muted-foreground">
              语速：{speed.toFixed(1)}x
            </label>
            <input
              type="range"
              min={0.5}
              max={2}
              step={0.1}
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
              disabled={isWorking}
              className="w-full accent-primary"
            />
          </div>

          {error && (
            <>
              <MiniMaxBillingAlert error={error} featureLabel="文字转语音" feature="chat" />
              {!buildMiniMaxBillingAlert(error, 'chat') && (
                <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-500">
                  <AlertCircle size={15} className="mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
            </>
          )}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={generate}
              disabled={isWorking || !storageReady}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-60"
            >
              {isWorking ? <Loader2 size={15} className="animate-spin" /> : <Volume2 size={15} />}
              {isWorking ? '合成中...' : '生成语音'}
            </button>
            {isWorking && (
              <button
                type="button"
                onClick={cancelGenerate}
                className="flex items-center justify-center gap-2 rounded-lg border border-border px-4 py-2.5 text-sm text-muted-foreground transition hover:bg-muted"
              >
                取消
              </button>
            )}
          </div>

          <p className="text-xs text-muted-foreground/70">
            使用 MiniMax T2A 同步接口（/v1/t2a_v2），单次最多 10000 字；需在根目录 .env 配置 MINIMAX_API_KEY。
          </p>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-5 shadow-panel sm:p-6">
        <div className="mb-4 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Volume2 size={18} className="text-primary" />
            <h2 className="text-base font-semibold">历史语音</h2>
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
                    <p className="line-clamp-2 text-sm leading-relaxed text-foreground">
                      {previewText(item.text)}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatTime(item.createdAt)}
                      {item.durationMs != null && ` · 约 ${Math.round(item.durationMs / 1000)} 秒`}
                      {` · ${item.voiceLabel}`}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void persistRemoveItem(item.id)}
                    className="shrink-0 rounded-md p-1.5 text-muted-foreground transition hover:bg-red-500/10 hover:text-red-500"
                    title="删除"
                    aria-label="删除这条语音"
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
                  <Download size={14} /> 下载
                </button>
              </article>
            ))}
          </div>
        ) : (
          <div className="flex aspect-[4/3] flex-col items-center justify-center gap-3 rounded-lg border border-border bg-black/5 text-muted-foreground/50">
            <Volume2 size={40} />
            <p className="text-sm">生成的语音会出现在这里</p>
            <p className="text-xs">已启用浏览器本地保存，刷新不丢失</p>
          </div>
        )}
      </section>
    </div>
  );
}
