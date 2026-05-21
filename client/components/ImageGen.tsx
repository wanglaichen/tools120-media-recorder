'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Download, ImageIcon, Loader2, X } from 'lucide-react';
import { MiniMaxBillingAlert } from '@/components/MiniMaxBillingAlert';
import { generateImages, type ImageAspectRatio, type ImageMode } from '@/lib/minimax';
import { buildMiniMaxBillingAlert } from '@/lib/minimax-errors';

type ImageGenStatus = 'idle' | 'generating' | 'done' | 'error';

const MODE_OPTIONS: { value: ImageMode; label: string }[] = [
  { value: 'text-to-image', label: '文生图' },
  { value: 'image-to-image', label: '参考图生图' },
];

const ASPECT_OPTIONS: { value: ImageAspectRatio; label: string }[] = [
  { value: '1:1', label: '1:1 方形' },
  { value: '16:9', label: '16:9 横屏' },
  { value: '9:16', label: '9:16 竖屏' },
  { value: '4:3', label: '4:3' },
  { value: '3:4', label: '3:4' },
];

export function ImageGen() {
  const [mode, setMode] = useState<ImageMode>('text-to-image');
  const [prompt, setPrompt] = useState('');
  const [aspectRatio, setAspectRatio] = useState<ImageAspectRatio>('1:1');
  const [referenceUrl, setReferenceUrl] = useState('');
  const [status, setStatus] = useState<ImageGenStatus>('idle');
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  const isReference = mode === 'image-to-image';
  const isWorking = status === 'generating';

  useEffect(() => () => abortRef.current?.abort(), []);

  const reset = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStatus('idle');
    setImageUrls([]);
    setError('');
  };

  const generate = async () => {
    if (!prompt.trim()) {
      setError('请输入画面描述');
      return;
    }
    if (isReference && !referenceUrl.trim()) {
      setError('请输入参考人物/主体图片 URL');
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setError('');
    setImageUrls([]);
    setStatus('generating');

    try {
      const urls = await generateImages({
        prompt: prompt.trim(),
        aspect_ratio: aspectRatio,
        reference_image_url: isReference ? referenceUrl.trim() : undefined,
      });
      if (controller.signal.aborted) return;
      setImageUrls(urls);
      setStatus('done');
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : String(err));
      setStatus('error');
    }
  };

  const downloadImage = (url: string, index: number) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = `image-${Date.now()}-${index + 1}.jpeg`;
    a.click();
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_0.65fr]">
      <section className="rounded-lg border border-border bg-card p-5 shadow-panel sm:p-6">
        <div className="mb-5 flex items-center gap-2">
          <ImageIcon size={20} className="text-primary" />
          <h2 className="text-base font-semibold">图片生成</h2>
        </div>

        <div className="grid gap-5">
          <div className="grid grid-cols-2 gap-2">
            {MODE_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => setMode(o.value)}
                disabled={isWorking}
                className={`rounded-lg border px-3 py-2 text-sm transition ${
                  mode === o.value
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:border-muted-foreground'
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-muted-foreground">画面描述</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              disabled={isWorking}
              rows={5}
              placeholder="例如：女孩在图书馆的窗户前，看向远方，暖色调，电影感..."
              className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>

          {isReference && (
            <div>
              <label className="mb-1.5 block text-sm font-medium text-muted-foreground">
                参考图 URL（保持人物/主体一致）
              </label>
              <input
                type="url"
                value={referenceUrl}
                onChange={(e) => setReferenceUrl(e.target.value)}
                disabled={isWorking}
                placeholder="https://..."
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
          )}

          <div>
            <label className="mb-1.5 block text-sm font-medium text-muted-foreground">画幅比例</label>
            <select
              value={aspectRatio}
              onChange={(e) => setAspectRatio(e.target.value as ImageAspectRatio)}
              disabled={isWorking}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
              {ASPECT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          {error && (
            <>
              <MiniMaxBillingAlert error={error} featureLabel="文字转图片" feature="image" />
              {!buildMiniMaxBillingAlert(error, 'image') && (
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
              disabled={isWorking}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-60"
            >
              {isWorking ? <Loader2 size={15} className="animate-spin" /> : <ImageIcon size={15} />}
              {isWorking ? '生成中...' : '生成图片'}
            </button>
            {status !== 'idle' && (
              <button
                type="button"
                onClick={reset}
                className="flex items-center justify-center gap-2 rounded-lg border border-border px-4 py-2.5 text-sm text-muted-foreground transition hover:bg-muted"
              >
                <X size={15} /> {isWorking ? '取消' : '重置'}
              </button>
            )}
          </div>

          <p className="text-xs text-muted-foreground/70">
            使用 MiniMax image-01 模型，同步返回；开发模式可在控制台查看 [MiniMax] 日志。
          </p>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-5 shadow-panel sm:p-6">
        <div className="mb-4 flex items-center gap-2">
          <ImageIcon size={18} className="text-primary" />
          <h2 className="text-base font-semibold">预览</h2>
        </div>

        {imageUrls.length > 0 ? (
          <div className="grid gap-4">
            {imageUrls.map((url, index) => (
              <div key={`${url.slice(0, 32)}-${index}`} className="space-y-2">
                <div className="overflow-hidden rounded-lg border border-border bg-black/5">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt={`生成图 ${index + 1}`} className="w-full object-contain" />
                </div>
                <button
                  type="button"
                  onClick={() => downloadImage(url, index)}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium transition hover:bg-muted"
                >
                  <Download size={15} /> 下载图片 {imageUrls.length > 1 ? index + 1 : ''}
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex aspect-square flex-col items-center justify-center gap-3 rounded-lg border border-border bg-black/5 text-muted-foreground/50">
            <ImageIcon size={40} />
            <p className="text-sm">图片将在此预览</p>
          </div>
        )}
      </section>
    </div>
  );
}
