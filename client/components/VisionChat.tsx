'use client';

import { useRef, useState } from 'react';
import { AlertCircle, Eye, ImageIcon, Loader2, Video } from 'lucide-react';
import { MiniMaxBillingAlert } from '@/components/MiniMaxBillingAlert';
import { createMultimodalCompletion } from '@/lib/minimax';
import { buildMiniMaxBillingAlert } from '@/lib/minimax-errors';
import { compressImageForVision } from '@/lib/vision-image';

type InputMode = 'image' | 'video';

const QUESTION_EXAMPLES = [
  '请详细描述画面内容、主体与氛围。',
  '提取图片中的文字并翻译为中文。',
  '总结视频的主要情节与关键时间点。',
];

export function VisionChat() {
  const [mode, setMode] = useState<InputMode>('image');
  const [question, setQuestion] = useState(QUESTION_EXAMPLES[0]);
  const [videoUrl, setVideoUrl] = useState('');
  const [imagePreview, setImagePreview] = useState('');
  const [imageDataUrl, setImageDataUrl] = useState('');
  const [answer, setAnswer] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const onPickImage = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('请选择 JPEG / PNG / GIF / WEBP 图片');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('原图建议小于 10MB；上传后会自动压缩');
    }
    setError('');
    try {
      const { dataUrl, previewUrl } = await compressImageForVision(file);
      setImageDataUrl(dataUrl);
      setImagePreview(previewUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : '图片处理失败');
    }
  };

  const runAnalyze = async () => {
    if (!question.trim()) {
      setError('请输入问题');
      return;
    }
    if (mode === 'image' && !imageDataUrl) {
      setError('请先上传图片');
      return;
    }
    if (mode === 'video' && !videoUrl.trim()) {
      setError('请填写可公网访问的视频 URL（MP4 等）');
      return;
    }

    setError('');
    setAnswer('');
    setLoading(true);

    try {
      const content =
        mode === 'image'
          ? [
              { type: 'text' as const, text: question.trim() },
              { type: 'image_url' as const, image_url: { url: imageDataUrl } },
            ]
          : [
              { type: 'text' as const, text: question.trim() },
              { type: 'video_url' as const, video_url: { url: videoUrl.trim() } },
            ];

      const reply = await createMultimodalCompletion({
        model: 'MiniMax-M3',
        messages: [{ role: 'user', content }],
      });
      setAnswer(reply);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_0.55fr]">
      <section className="rounded-lg border border-border bg-card p-5 shadow-panel sm:p-6">
        <div className="mb-4 flex items-center gap-2">
          <Eye size={20} className="text-primary" />
          <h2 className="text-base font-semibold">多模态理解（M3）</h2>
        </div>
        <p className="mb-5 text-sm text-muted-foreground">
          Plus 档 M3 原生多模态：上传图片或提供视频 URL，进行视觉问答与内容理解。
        </p>

        <div className="mb-4 flex gap-2">
          <button
            type="button"
            onClick={() => setMode('image')}
            className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm ${
              mode === 'image' ? 'border-primary bg-primary/10 text-primary' : 'border-border'
            }`}
          >
            <ImageIcon size={15} />
            图片理解
          </button>
          <button
            type="button"
            onClick={() => setMode('video')}
            className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm ${
              mode === 'video' ? 'border-primary bg-primary/10 text-primary' : 'border-border'
            }`}
          >
            <Video size={15} />
            视频理解
          </button>
        </div>

        <div className="grid gap-4">
          {mode === 'image' ? (
            <div>
              <label className="mb-1.5 block text-sm font-medium">上传图片</label>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={loading}
                className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted"
              >
                选择图片
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                className="hidden"
                onChange={(e) => void onPickImage(e.target.files?.[0])}
              />
              {imagePreview && (
                <img
                  src={imagePreview}
                  alt="预览"
                  className="mt-3 max-h-48 rounded-lg border border-border object-contain"
                />
              )}
            </div>
          ) : (
            <div>
              <label className="mb-1.5 block text-sm font-medium">视频 URL</label>
              <input
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
                disabled={loading}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                placeholder="https://example.com/demo.mp4"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                需公网可访问；大文件可先上传 MiniMax Files API 后使用 mm_file:// 格式（后续可扩展）。
              </p>
            </div>
          )}

          <div>
            <div className="mb-1.5 flex flex-wrap gap-1">
              <label className="mr-auto text-sm font-medium">你的问题</label>
              {QUESTION_EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  disabled={loading}
                  onClick={() => setQuestion(ex)}
                  className="rounded border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted"
                >
                  示例
                </button>
              ))}
            </div>
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              disabled={loading}
              rows={3}
              className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>

          <button
            type="button"
            onClick={() => void runAnalyze()}
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {loading ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                M3 分析中…
              </>
            ) : (
              '开始分析'
            )}
          </button>

          {error && (
            <>
              <MiniMaxBillingAlert error={error} featureLabel="多模态理解" feature="chat" />
              {!buildMiniMaxBillingAlert(error, 'chat') && (
                <div className="flex items-start gap-2 text-sm text-destructive">
                  <AlertCircle size={16} className="mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
            </>
          )}
        </div>
      </section>

      <aside className="rounded-lg border border-border bg-card p-4 shadow-panel">
        <h3 className="mb-3 text-sm font-semibold">M3 回复</h3>
        {answer ? (
          <div className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{answer}</div>
        ) : (
          <p className="text-sm text-muted-foreground">分析结果将显示在这里。</p>
        )}
      </aside>
    </div>
  );
}
