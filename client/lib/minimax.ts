/**
 * MiniMax 视频 / 图片生成 API
 * 视频: https://platform.minimaxi.com/docs/guides/video-generation
 * 图片: https://platform.minimaxi.com/docs/guides/image-generation
 */

import { assertMiniMaxApiKey, resolveMiniMaxBaseUrl } from '@/lib/ai-provider-config';

const DEV = process.env.NODE_ENV === 'development';

export type VideoModel = 'MiniMax-Hailuo-2.3' | 'MiniMax-Hailuo-02' | 'S2V-01';

export type VideoResolution = '540P' | '720P' | '768P' | '1080P';

export type VideoMode = 'text-to-video' | 'image-to-video' | 'start-end' | 'subject-reference';

/** 各模型支持的分辨率（以 MiniMax API 返回为准） */
export const RESOLUTIONS_BY_MODEL: Record<VideoModel, VideoResolution[]> = {
  'MiniMax-Hailuo-2.3': ['768P', '1080P'],
  'MiniMax-Hailuo-02': ['768P', '1080P'],
  'S2V-01': ['1080P'],
};

export function getResolutionsForModel(model: string): VideoResolution[] {
  return RESOLUTIONS_BY_MODEL[model as VideoModel] ?? ['1080P'];
}

export function normalizeResolution(model: string, resolution: string): VideoResolution {
  const allowed = getResolutionsForModel(model);
  if (allowed.includes(resolution as VideoResolution)) {
    return resolution as VideoResolution;
  }
  return allowed[allowed.length - 1];
}

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
  resolution?: VideoResolution;
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

type MiniMaxBaseResp = {
  status_code?: number;
  status_msg?: string;
};

function logMiniMax(step: string, detail: unknown) {
  if (!DEV) return;
  console.info(`[MiniMax] ${step}`, detail);
}

function assertApiKey(): string {
  return assertMiniMaxApiKey();
}

function miniMaxBaseUrl(): string {
  return resolveMiniMaxBaseUrl();
}

function parseJsonBody<T>(text: string, label: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${label}：响应不是合法 JSON`);
  }
}

/** 将 MiniMax 英文业务错误转为更易读的中文说明 */
function formatMiniMaxErrorMessage(raw: string, statusCode?: number): string {
  const lower = raw.toLowerCase();
  const codeHint = statusCode !== undefined ? `（base_resp.status_code=${statusCode}）` : '';

  if (lower.includes('usage limit exceeded') || lower.includes('weekly usage limit')) {
    const resetMatch = raw.match(/resets at ([^)]+)/i);
    const resetHint = resetMatch ? `，重置时间 ${resetMatch[1]}` : '';
    return `【视频周额度不足】本周视频生成次数已用完或未开通${resetHint}。账户余额与视频周额度分开计费，请到 MiniMax 控制台查看套餐/充值。原始信息：${raw}`;
  }
  if (lower.includes('insufficient balance') || (lower.includes('balance') && !lower.includes('invalid'))) {
    return `【账户余额不足】MiniMax 余额不足以支付本次请求${codeHint}。请到控制台充值后再试。原始信息：${raw}`;
  }
  if (lower.includes('invalid params')) {
    return `参数无效${codeHint}：${raw.replace(/^invalid params,\s*/i, '')}`;
  }
  return statusCode ? `${raw}${codeHint}` : raw;
}

/** MiniMax 常在 HTTP 200 时通过 base_resp.status_code 表示业务错误 */
function assertBaseResp(data: { base_resp?: MiniMaxBaseResp }, label: string) {
  const code = data.base_resp?.status_code;
  if (code === undefined || code === 0) return;
  const msg = formatMiniMaxErrorMessage(data.base_resp?.status_msg || `未知错误`, code);
  throw new Error(`${label}：${msg}`);
}

async function minimaxFetch(url: string, init: RequestInit, label: string): Promise<Response> {
  logMiniMax(`${label} request`, { url, method: init.method ?? 'GET' });
  const response = await fetch(url, init);
  const text = await response.text();
  logMiniMax(`${label} response`, { status: response.status, body: text.slice(0, 500) });
  if (!response.ok) {
    let detail = text.slice(0, 300);
    try {
      const parsed = JSON.parse(text) as { base_resp?: MiniMaxBaseResp };
      if (parsed.base_resp?.status_msg) {
        detail = formatMiniMaxErrorMessage(parsed.base_resp.status_msg, parsed.base_resp.status_code);
      }
    } catch {
      /* 非 JSON 则保留原文 */
    }
    throw new Error(`${label}：${detail}`);
  }
  return new Response(text, { status: response.status, headers: response.headers });
}

/** 创建视频生成任务 */
export async function createVideoTask(params: VideoCreateParams): Promise<string> {
  const apiKey = assertApiKey();
  const url = `${miniMaxBaseUrl()}/v1/video_generation`;
  const payload: Record<string, unknown> = {
    model: params.model,
    prompt: params.prompt,
    duration: params.duration ?? 6,
    resolution: params.resolution ?? '1080P',
  };

  if (params.first_frame_image) payload.first_frame_image = params.first_frame_image;
  if (params.last_frame_image) payload.last_frame_image = params.last_frame_image;
  if (params.subject_reference) payload.subject_reference = params.subject_reference;

  const response = await minimaxFetch(
    url,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    },
    '创建视频任务',
  );

  const data = parseJsonBody<{ task_id?: string; base_resp?: MiniMaxBaseResp }>(
    await response.text(),
    '创建视频任务',
  );
  assertBaseResp(data, '创建视频任务');
  if (!data.task_id?.trim()) {
    const code = data.base_resp?.status_code;
    const msg = data.base_resp?.status_msg;
    if (code !== undefined && code !== 0) {
      throw new Error(
        `创建视频任务：${formatMiniMaxErrorMessage(msg || '未知错误', code)}`,
      );
    }
    throw new Error(
      `创建视频任务：HTTP 200 但 task_id 为空。完整响应字段：task_id、base_resp.status_code、base_resp.status_msg`,
    );
  }
  return data.task_id;
}

/** 查询任务状态 */
export async function queryVideoTaskStatus(taskId: string): Promise<VideoStatus> {
  const apiKey = assertApiKey();
  const url = `${miniMaxBaseUrl()}/v1/query/video_generation?task_id=${encodeURIComponent(taskId)}`;
  const response = await minimaxFetch(
    url,
    { headers: { Authorization: `Bearer ${apiKey}` } },
    '查询任务状态',
  );

  const data = parseJsonBody<VideoStatus & { base_resp?: MiniMaxBaseResp }>(
    await response.text(),
    '查询任务状态',
  );
  assertBaseResp(data, '查询任务状态');
  return {
    status: data.status,
    file_id: data.file_id,
    error_message: data.error_message,
  };
}

/** 获取视频下载链接 */
export async function fetchVideoDownloadUrl(fileId: string): Promise<string> {
  const apiKey = assertApiKey();
  const url = `${miniMaxBaseUrl()}/v1/files/retrieve?file_id=${encodeURIComponent(fileId)}`;
  const response = await minimaxFetch(
    url,
    { headers: { Authorization: `Bearer ${apiKey}` } },
    '获取下载链接',
  );

  const data = parseJsonBody<{ file?: { download_url?: string }; base_resp?: MiniMaxBaseResp }>(
    await response.text(),
    '获取下载链接',
  );
  assertBaseResp(data, '获取下载链接');
  const downloadUrl = data.file?.download_url;
  if (!downloadUrl) {
    throw new Error('获取下载链接：响应中缺少 download_url');
  }
  return downloadUrl;
}

/** 下载视频到本地 Blob */
export async function downloadVideoBlob(downloadUrl: string): Promise<Blob> {
  logMiniMax('下载视频', { downloadUrl: downloadUrl.slice(0, 80) + '...' });
  const response = await fetch(downloadUrl);
  if (!response.ok) {
    throw new Error(`视频下载失败 (HTTP ${response.status})`);
  }
  return response.blob();
}

// --- 图片生成（同步接口，返回 base64）---

export type ImageModel = 'image-01';
export type ImageAspectRatio = '1:1' | '16:9' | '4:3' | '3:4' | '9:16';
export type ImageMode = 'text-to-image' | 'image-to-image';

export interface ImageCreateParams {
  prompt: string;
  model?: ImageModel;
  aspect_ratio?: ImageAspectRatio;
  reference_image_url?: string;
}

/** 文生图 / 图生图，返回可预览的 data URL 列表 */
export async function generateImages(params: ImageCreateParams): Promise<string[]> {
  const apiKey = assertApiKey();
  const url = `${miniMaxBaseUrl()}/v1/image_generation`;
  const payload: Record<string, unknown> = {
    model: params.model ?? 'image-01',
    prompt: params.prompt,
    aspect_ratio: params.aspect_ratio ?? '1:1',
    response_format: 'base64',
  };

  if (params.reference_image_url?.trim()) {
    payload.subject_reference = [
      {
        type: 'character',
        image_file: params.reference_image_url.trim(),
      },
    ];
  }

  const response = await minimaxFetch(
    url,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    },
    '生成图片',
  );

  const data = parseJsonBody<{
    data?: { image_base64?: string[] };
    base_resp?: MiniMaxBaseResp;
  }>(await response.text(), '生成图片');
  assertBaseResp(data, '生成图片');

  const images = data.data?.image_base64;
  if (!images?.length) {
    throw new Error('生成图片：响应中缺少 data.image_base64');
  }

  return images.map((b64) => `data:image/jpeg;base64,${b64}`);
}

// --- 文本对话（OpenAI 兼容 /v1/chat/completions）---

export type ChatModel =
  | 'MiniMax-M2.7'
  | 'MiniMax-M2.7-highspeed'
  | 'MiniMax-M2.5'
  | 'MiniMax-M2.5-highspeed';

export type ChatRole = 'user' | 'assistant' | 'system';

export interface ChatTurn {
  role: ChatRole;
  content: string;
}

export interface ChatCompletionParams {
  messages: ChatTurn[];
  model?: ChatModel;
  max_tokens?: number;
}

/** 多轮对话：传入完整历史，模型具备会话记忆 */
export async function createChatCompletion(params: ChatCompletionParams): Promise<string> {
  const apiKey = assertApiKey();
  const url = `${miniMaxBaseUrl()}/v1/chat/completions`;
  const payload = {
    model: params.model ?? 'MiniMax-M2.7',
    messages: params.messages,
    max_tokens: params.max_tokens ?? 4096,
  };

  const response = await minimaxFetch(
    url,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    },
    '知识问答',
  );

  const data = parseJsonBody<{
    choices?: Array<{ message?: { content?: string } }>;
    base_resp?: MiniMaxBaseResp;
  }>(await response.text(), '知识问答');
  assertBaseResp(data, '知识问答');

  const content = data.choices?.[0]?.message?.content;
  if (!content?.trim()) {
    throw new Error('知识问答：响应中缺少回复内容');
  }
  return content.trim();
}
