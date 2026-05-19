/**
 * MiniMax 视频生成 API 调用封装
 * 文档: https://platform.minimaxi.com/docs/guides/video-generation
 */

const BASE_URL = process.env.NEXT_PUBLIC_MINIMAX_API_BASE_URL || 'https://api.minimaxi.com';

export type VideoModel = 'MiniMax-Hailuo-2.3' | 'MiniMax-Hailuo-02' | 'S2V-01';

export type VideoMode = 'text-to-video' | 'image-to-video' | 'start-end' | 'subject-reference';

export interface VideoTaskResult {
  task_id: string;
  status: string;
  file_id?: string;
  error_message?: string;
}

export interface VideoCreateParams {
  model: VideoModel;
  prompt: string;
  duration?: 6 | 10;
  resolution?: '540P' | '720P' | '1080P';
  first_frame_image?: string;
  last_frame_image?: string;
  subject_reference?: Array<{
    type: 'character' | 'object';
    image: string[];
  }>;
}

export interface VideoStatus {
  status: 'Pending' | 'Processing' | 'Success' | 'Fail';
  file_id?: string;
  error_message?: string;
}

/** 创建视频生成任务 */
export async function createVideoTask(params: VideoCreateParams): Promise<string> {
  const apiKey = process.env.NEXT_PUBLIC_MINIMAX_API_KEY;
  if (!apiKey) throw new Error('请先在环境变量中配置 NEXT_PUBLIC_MINIMAX_API_KEY');

  const url = `${BASE_URL}/v1/video_generation`;
  const payload: Record<string, unknown> = {
    model: params.model,
    prompt: params.prompt,
    duration: params.duration ?? 6,
    resolution: params.resolution ?? '1080P',
  };

  if (params.first_frame_image) payload.first_frame_image = params.first_frame_image;
  if (params.last_frame_image) payload.last_frame_image = params.last_frame_image;
  if (params.subject_reference) payload.subject_reference = params.subject_reference;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`视频任务创建失败 (${response.status}): ${text}`);
  }

  const data = (await response.json()) as { task_id: string };
  return data.task_id;
}

/** 查询任务状态 */
export async function queryVideoTaskStatus(taskId: string): Promise<VideoStatus> {
  const apiKey = process.env.NEXT_PUBLIC_MINIMAX_API_KEY;
  if (!apiKey) throw new Error('请先在环境变量中配置 NEXT_PUBLIC_MINIMAX_API_KEY');

  const url = `${BASE_URL}/v1/query/video_generation?task_id=${encodeURIComponent(taskId)}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`任务状态查询失败 (${response.status}): ${text}`);
  }

  const data = (await response.json()) as VideoStatus;
  return data;
}

/** 获取视频下载链接 */
export async function fetchVideoDownloadUrl(fileId: string): Promise<string> {
  const apiKey = process.env.NEXT_PUBLIC_MINIMAX_API_KEY;
  if (!apiKey) throw new Error('请先在环境变量中配置 NEXT_PUBLIC_MINIMAX_API_KEY');

  const url = `${BASE_URL}/v1/files/retrieve?file_id=${encodeURIComponent(fileId)}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`文件信息获取失败 (${response.status}): ${text}`);
  }

  const data = (await response.json()) as { file: { download_url: string } };
  return data.file.download_url;
}

/** 下载视频到本地 Blob */
export async function downloadVideoBlob(downloadUrl: string): Promise<Blob> {
  const response = await fetch(downloadUrl);
  if (!response.ok) throw new Error(`视频下载失败 (${response.status})`);
  return response.blob();
}
