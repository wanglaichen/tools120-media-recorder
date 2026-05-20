'use client';

import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Circle,
  Download,
  Loader2,
  Play,
  RefreshCw,
  Video,
  X,
} from 'lucide-react';
import { MiniMaxBillingAlert } from '@/components/MiniMaxBillingAlert';
import {
  createVideoTask,
  downloadVideoBlob,
  fetchVideoDownloadUrl,
  getResolutionsForModel,
  normalizeResolution,
  queryVideoTaskStatus,
  type VideoMode,
  type VideoModel,
  type VideoResolution,
} from '@/lib/minimax';
import { buildMiniMaxBillingAlert } from '@/lib/minimax-errors';

type VideoGenStatus = 'idle' | 'creating' | 'polling' | 'downloading' | 'done' | 'error';

const MODE_OPTIONS: { value: VideoMode; label: string }[] = [
  { value: 'text-to-video', label: '文生视频' },
  { value: 'image-to-video', label: '图生视频' },
  { value: 'start-end', label: '首尾帧' },
  { value: 'subject-reference', label: '主体参考' },
];

const MODEL_OPTIONS = [
  { value: 'MiniMax-Hailuo-2.3', label: 'MiniMax-Hailuo-2.3' },
  { value: 'MiniMax-Hailuo-02', label: 'MiniMax-Hailuo-02' },
  { value: 'S2V-01', label: 'S2V-01（主体参考）' },
];

const DURATION_OPTIONS = [
  { value: 6, label: '6 秒' },
  { value: 10, label: '10 秒' },
];

export function VideoGen() {
  const [mode, setMode] = useState<VideoMode>('text-to-video');
  const [prompt, setPrompt] = useState('');
  const [selectedModel, setSelectedModel] = useState<VideoModel>('MiniMax-Hailuo-2.3');
  const [duration, setDuration] = useState(6);
  const [resolution, setResolution] = useState<VideoResolution>('1080P');
  const [imageUrl, setImageUrl] = useState('');
  const [lastImageUrl, setLastImageUrl] = useState('');
  const [status, setStatus] = useState<VideoGenStatus>('idle');
  const [taskId, setTaskId] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const [error, setError] = useState('');
  const [progress, setProgress] = useState('');
  const [elapsedSec, setElapsedSec] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const startedAtRef = useRef<number | null>(null);

  const hasImage = mode === 'image-to-video' || mode === 'start-end';
  const hasLastImage = mode === 'start-end';
  const hasSubjectRef = mode === 'subject-reference';

  const stopAll = () => {
    abortRef.current?.abort();
    abortRef.current = null;
  };

  useEffect(() => {
    return () => stopAll();
  }, []);

  const resolutionOptions = getResolutionsForModel(selectedModel);

  useEffect(() => {
    setResolution((current) => normalizeResolution(selectedModel, current));
  }, [selectedModel]);

  const generateVideo = async () => {
    if (!prompt.trim()) {
      setError('请输入描述文字');
      return;
    }
    if (hasImage && !imageUrl.trim()) {
      setError('请输入首帧图片 URL');
      return;
    }
    if (hasLastImage && !lastImageUrl.trim()) {
      setError('请输入尾帧图片 URL');
      return;
    }

    stopAll();
    setError('');
    setVideoUrl('');
    setProgress('');
    setElapsedSec(0);
    startedAtRef.current = Date.now();
    setStatus('creating');

    try {
      const tid = await createVideoTask({
        model: selectedModel,
        prompt: prompt.trim(),
        duration: duration as 6 | 10,
        resolution: normalizeResolution(selectedModel, resolution),
        first_frame_image: hasImage ? imageUrl.trim() : undefined,
        last_frame_image: hasLastImage ? lastImageUrl.trim() : undefined,
      });
      setTaskId(tid);
      setStatus('polling');
      setProgress('任务已提交，正在查询状态…');
      void pollStatus(tid);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus('error');
    }
  };

  const pollStatus = async (tid: string) => {
    const controller = new AbortController();
    abortRef.current = controller;
    const pollIntervalMs = 10_000;

    const tickElapsed = () => {
      if (startedAtRef.current) {
        setElapsedSec(Math.floor((Date.now() - startedAtRef.current) / 1000));
      }
    };

    const statusLabel: Record<string, string> = {
      Pending: '排队中（MiniMax 服务端处理）',
      Processing: '视频生成中，通常需 1～5 分钟',
      Success: '生成完成，正在下载…',
      Fail: '生成失败',
    };

    while (!controller.signal.aborted) {
      try {
        tickElapsed();
        const result = await queryVideoTaskStatus(tid);
        setProgress(statusLabel[result.status] ?? result.status);

        if (result.status === 'Success') {
          if (!result.file_id) {
            throw new Error('任务成功但缺少 file_id');
          }
          setStatus('downloading');
          setProgress('正在拉取视频文件…');
          const downloadUrl = await fetchVideoDownloadUrl(result.file_id);
          const blob = await downloadVideoBlob(downloadUrl);
          const url = URL.createObjectURL(blob);
          setVideoUrl(url);
          setStatus('done');
          setProgress('完成');
          break;
        }

        if (result.status === 'Fail') {
          setError(result.error_message ?? '视频生成失败');
          setStatus('error');
          break;
        }

        if (controller.signal.aborted) break;
        await sleep(pollIntervalMs);
      } catch (err) {
        if (controller.signal.aborted) break;
        setError(err instanceof Error ? err.message : String(err));
        setStatus('error');
        break;
      }
    }
  };

  const downloadVideo = () => {
    if (!videoUrl) return;
    const a = document.createElement('a');
    a.href = videoUrl;
    a.download = `video-${Date.now()}.mp4`;
    a.click();
  };

  const reset = () => {
    stopAll();
    startedAtRef.current = null;
    setStatus('idle');
    setTaskId('');
    setVideoUrl('');
    setError('');
    setProgress('');
    setElapsedSec(0);
  };

  const isWorking = status === 'creating' || status === 'polling' || status === 'downloading';

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_0.65fr]">
      {/* 左侧：参数区 */}
      <section className="rounded-lg border border-border bg-card p-5 shadow-panel sm:p-6">
        <div className="mb-5 flex items-center gap-2">
          <Video size={20} className="text-primary" />
          <h2 className="text-base font-semibold">视频生成</h2>
        </div>

        <p className="mb-4 rounded-lg border border-border/80 bg-muted/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          使用 MiniMax 海螺视频 API，将消耗账户<strong className="font-medium text-foreground">视频周额度或余额</strong>
          。额度不足时会在下方醒目提示，并说明如何充值或等待重置。
        </p>

        <div className="grid gap-5">
          {/* 模式 */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
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

          {/* 模型 */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-muted-foreground">模型</label>
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value as VideoModel)}
              disabled={isWorking}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
              {MODEL_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {/* 提示词 */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-muted-foreground">
              {hasSubjectRef ? '主体描述（人物动作、场景等）' : '画面描述'}
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              disabled={isWorking}
              rows={5}
              placeholder={
                hasSubjectRef
                  ? '例如：On an overcast day, a woman in a brown jacket walks down a cobblestone alley, adjusting her beret with a smile...'
                  : '例如：镜头拍摄一个女性坐在咖啡馆里，女人抬头看着窗外，镜头缓缓移动拍摄到窗外的街道，画面呈现暖色调...'
              }
              className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>

          {/* 首帧图片 */}
          {hasImage && (
            <div>
              <label className="mb-1.5 block text-sm font-medium text-muted-foreground">
                {mode === 'start-end' ? '首帧图片 URL' : '图片 URL'}
              </label>
              <input
                type="url"
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                disabled={isWorking}
                placeholder="https://..."
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
          )}

          {/* 尾帧图片 */}
          {hasLastImage && (
            <div>
              <label className="mb-1.5 block text-sm font-medium text-muted-foreground">尾帧图片 URL</label>
              <input
                type="url"
                value={lastImageUrl}
                onChange={(e) => setLastImageUrl(e.target.value)}
                disabled={isWorking}
                placeholder="https://..."
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
          )}

          {/* 时长 + 分辨率 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-muted-foreground">时长</label>
              <select
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                disabled={isWorking}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                {DURATION_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-muted-foreground">分辨率</label>
              <select
                value={resolution}
                onChange={(e) => setResolution(e.target.value as VideoResolution)}
                disabled={isWorking}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                {resolutionOptions.map((value) => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </select>
            </div>
          </div>

          {/* 费用 / 额度不足 */}
          {error && (
            <>
              <MiniMaxBillingAlert error={error} featureLabel="文字转视频" />
              {!buildMiniMaxBillingAlert(error) && (
                <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-500">
                  <AlertCircle size={15} className="mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
            </>
          )}

          {/* 操作按钮 */}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={generateVideo}
              disabled={isWorking}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-60"
            >
              {isWorking ? <Loader2 size={15} className="animate-spin" /> : <Video size={15} />}
              {status === 'creating' ? '创建任务...' : status === 'polling' ? '生成中...' : status === 'downloading' ? '下载中...' : '生成视频'}
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

          {/* 进度 */}
          {isWorking && (
            <div className="space-y-1 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <Loader2 size={14} className="animate-spin shrink-0" />
                <span>{progress || '处理中…'}</span>
              </div>
              {elapsedSec > 0 && (
                <p className="text-xs text-muted-foreground/80">
                  已等待 {elapsedSec} 秒（文生视频在云端排队+渲染，1080P 往往更久；开发模式可在浏览器控制台查看 [MiniMax] 日志）
                </p>
              )}
            </div>
          )}

          {/* task id */}
          {taskId && status !== 'idle' && (
            <p className="text-xs text-muted-foreground/60">任务ID: {taskId}</p>
          )}
        </div>
      </section>

      {/* 右侧：预览区 */}
      <section className="rounded-lg border border-border bg-card p-5 shadow-panel sm:p-6">
        <div className="mb-4 flex items-center gap-2">
          <Play size={18} className="text-primary" />
          <h2 className="text-base font-semibold">预览</h2>
        </div>

        <div className="relative aspect-video overflow-hidden rounded-lg border border-border bg-black/5">
          {videoUrl ? (
            <video
              ref={videoRef}
              src={videoUrl}
              controls
              className="h-full w-full object-contain"
              onError={() => {
                setError('视频播放失败，请检查下载链接是否有效');
              }}
            />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-muted-foreground/50">
              <Video size={40} />
              <p className="text-sm">视频将在此预览</p>
            </div>
          )}
        </div>

        {status === 'done' && videoUrl && (
          <div className="mt-4 flex gap-3">
            <button
              type="button"
              onClick={downloadVideo}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-medium transition hover:bg-muted"
            >
              <Download size={15} /> 下载视频
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
