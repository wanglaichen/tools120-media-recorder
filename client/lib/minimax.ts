/**
 * MiniMax 视频 / 图片生成 API
 * 视频: https://platform.minimaxi.com/docs/guides/video-generation
 * 图片: https://platform.minimaxi.com/docs/guides/image-generation
 */

import { assertMiniMaxApiKey, resolveMiniMaxBaseUrl } from '@/lib/ai-provider-config';
import type { MiniMaxFeature } from '@/lib/minimax-errors';
import { DEFAULT_SPEECH_VOICE_ID } from '@/lib/speech-voices';
import {
  getMiniMaxProxyEndpoint,
  useMiniMaxServerProxy,
} from '@/lib/minimax-transport';

function labelToFeature(label: string): MiniMaxFeature {
  if (label.includes('视频')) return 'video';
  if (label.includes('图片')) return 'image';
  return 'chat';
}

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
  status_msg?: unknown;
};

/** OpenAI / MiniMax 错误字段可能是字符串或 { message, type } 等对象 */
function normalizeApiErrorDetail(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (value instanceof Error) return value.message;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>;
    if (typeof o.message === 'string' && o.message.trim()) return o.message.trim();
    if (typeof o.status_msg === 'string' && o.status_msg.trim()) return o.status_msg.trim();
    if (typeof o.msg === 'string' && o.msg.trim()) return o.msg.trim();
    if (typeof o.detail === 'string' && o.detail.trim()) return o.detail.trim();
    if (typeof o.error === 'string' && o.error.trim()) return o.error.trim();
    if (o.error && typeof o.error === 'object') {
      const nested = normalizeApiErrorDetail(o.error);
      if (nested) return nested;
    }
    if (o.base_resp && typeof o.base_resp === 'object') {
      const nested = normalizeApiErrorDetail(
        (o.base_resp as Record<string, unknown>).status_msg,
      );
      if (nested) return nested;
    }
    try {
      const s = JSON.stringify(value);
      if (s && s !== '{}') return s;
    } catch {
      /* ignore */
    }
  }
  return String(value);
}

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
function formatMiniMaxErrorMessage(
  raw: unknown,
  statusCode?: number,
  feature: MiniMaxFeature = 'video',
): string {
  const text = normalizeApiErrorDetail(raw) || '未知错误';
  const lower = text.toLowerCase();
  const codeHint = statusCode !== undefined ? `（status_code=${statusCode}）` : '';

  if (lower.includes('usage limit exceeded') || lower.includes('weekly usage limit')) {
    const resetMatch = text.match(/resets at ([^)]+)/i);
    const resetHint = resetMatch ? `，预计释放时间 ${resetMatch[1]}` : '';
    if (feature === 'video' || /video|hailuo|海螺|视频/.test(lower)) {
      return `【视频周额度不足】本周视频生成次数已用完或未开通${resetHint}。原始信息：${text}`;
    }
    return `【文本用量已达上限】Token Plan 文本滚动窗口（约 5 小时）内额度已用尽${resetHint}${codeHint}。请到控制台查看文本用量或升级套餐；「M2.7 极速」需 High-Speed 档。原始信息：${text}`;
  }
  if (lower.includes('insufficient balance') || (lower.includes('balance') && !lower.includes('invalid'))) {
    return `【账户余额不足】MiniMax 余额不足以支付本次请求${codeHint}。请到控制台充值后再试。原始信息：${text}`;
  }
  if (lower.includes('invalid params')) {
    return `参数无效${codeHint}：${text.replace(/^invalid params,\s*/i, '')}`;
  }
  return statusCode ? `${text}${codeHint}` : text;
}

/** MiniMax 常在 HTTP 200 时通过 base_resp.status_code 表示业务错误 */
function assertBaseResp(data: { base_resp?: MiniMaxBaseResp }, label: string) {
  const code = data.base_resp?.status_code;
  if (code === undefined || code === 0) return;
  const msg = formatMiniMaxErrorMessage(
    data.base_resp?.status_msg ?? '未知错误',
    code,
    labelToFeature(label),
  );
  throw new Error(`${label}：${msg}`);
}

async function minimaxFetch(url: string, init: RequestInit, label: string): Promise<Response> {
  const method = init.method ?? 'GET';
  const feature = labelToFeature(label);
  logMiniMax(`${label} request`, { url, method });

  let response: Response;
  if (await useMiniMaxServerProxy()) {
    const parsed = new URL(url);
    const path = parsed.pathname + parsed.search;
    let body: unknown;
    if (init.body && typeof init.body === 'string') {
      try {
        body = JSON.parse(init.body) as unknown;
      } catch {
        body = undefined;
      }
    }
    response = await fetch(getMiniMaxProxyEndpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, method, body }),
    });
  } else {
    const apiKey = assertApiKey();
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${apiKey}`);
    response = await fetch(url, { ...init, headers });
  }

  const text = await response.text();
  logMiniMax(`${label} response`, { status: response.status, body: text.slice(0, 500) });
  if (!response.ok) {
    let detail = text.slice(0, 300);
    try {
      const parsed = JSON.parse(text) as {
        base_resp?: MiniMaxBaseResp;
        error?: unknown;
        message?: unknown;
      };
      if (parsed.base_resp?.status_msg != null || parsed.base_resp?.status_code) {
        detail = formatMiniMaxErrorMessage(
          parsed.base_resp.status_msg ?? '未知错误',
          parsed.base_resp.status_code,
          feature,
        );
      } else if (parsed.error != null) {
        detail = formatMiniMaxErrorMessage(parsed.error, undefined, feature);
        if (
          response.status === 403 &&
          String(parsed.error).includes('不允许代理该 MiniMax 接口')
        ) {
          detail += '。请重启 API 服务（8787）：在项目根目录执行 node server/index.mjs 或 .\\start.ps1';
        }
      } else if (parsed.message != null) {
        detail = formatMiniMaxErrorMessage(parsed.message, undefined, feature);
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
      headers: { 'Content-Type': 'application/json' },
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
  const url = `${miniMaxBaseUrl()}/v1/query/video_generation?task_id=${encodeURIComponent(taskId)}`;
  const response = await minimaxFetch(url, { method: 'GET' }, '查询任务状态');

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
  const url = `${miniMaxBaseUrl()}/v1/files/retrieve?file_id=${encodeURIComponent(fileId)}`;
  const response = await minimaxFetch(url, { method: 'GET' }, '获取下载链接');

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
      headers: { 'Content-Type': 'application/json' },
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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
    '知识问答',
  );

  const data = parseJsonBody<{
    choices?: Array<{ message?: { content?: string } }>;
    base_resp?: MiniMaxBaseResp;
    error?: unknown;
  }>(await response.text(), '知识问答');

  const apiError = normalizeApiErrorDetail(data.error);
  if (apiError) {
    throw new Error(`知识问答：${formatMiniMaxErrorMessage(apiError, undefined, 'chat')}`);
  }
  assertBaseResp(data, '知识问答');

  const content = data.choices?.[0]?.message?.content;
  if (!content?.trim()) {
    throw new Error('知识问答：响应中缺少回复内容');
  }
  return content.trim();
}

// --- 文字转语音（同步 HTTP /v1/t2a_v2）---

export type SpeechModel =
  | 'speech-2.8-hd'
  | 'speech-2.8-turbo'
  | 'speech-2.6-hd'
  | 'speech-2.6-turbo';

export type SpeechVoiceId = string;

export interface SpeechSynthesisParams {
  text: string;
  model?: SpeechModel;
  voice_id?: string;
  speed?: number;
}

export interface SpeechSynthesisResult {
  audioUrl: string;
  format: string;
  sampleRate?: number;
  durationMs?: number;
}

function hexToAudioBlob(hex: string, mime: string): Blob {
  const normalized = hex.replace(/\s/g, '');
  if (!normalized || normalized.length % 2 !== 0) {
    throw new Error('文字转语音：音频数据格式无效');
  }
  const bytes = new Uint8Array(normalized.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = parseInt(normalized.slice(i * 2, i * 2 + 2), 16);
  }
  return new Blob([bytes], { type: mime });
}

/** 文字转语音，返回可播放的 blob URL（调用方需在不用时 revokeObjectURL） */
export async function synthesizeSpeech(params: SpeechSynthesisParams): Promise<SpeechSynthesisResult> {
  const text = params.text.trim();
  if (!text) {
    throw new Error('文字转语音：请输入要合成的文本');
  }
  if (text.length > 10000) {
    throw new Error('文字转语音：单次最多 10000 字符');
  }

  const url = `${miniMaxBaseUrl()}/v1/t2a_v2`;
  const payload = {
    model: params.model ?? 'speech-2.8-hd',
    text,
    stream: false,
    language_boost: 'Chinese',
    output_format: 'hex',
    voice_setting: {
      voice_id: params.voice_id ?? DEFAULT_SPEECH_VOICE_ID,
      speed: params.speed ?? 1,
      vol: 1,
      pitch: 0,
    },
    audio_setting: {
      sample_rate: 32000,
      bitrate: 128000,
      format: 'mp3',
      channel: 1,
    },
  };

  const response = await minimaxFetch(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
    '文字转语音',
  );

  const data = parseJsonBody<{
    data?: {
      audio?: string;
      status?: number;
    };
    extra_info?: {
      audio_format?: string;
      audio_sample_rate?: number;
      audio_length?: number;
    };
    base_resp?: MiniMaxBaseResp;
    error?: unknown;
  }>(await response.text(), '文字转语音');

  const apiError = normalizeApiErrorDetail(data.error);
  if (apiError) {
    throw new Error(`文字转语音：${formatMiniMaxErrorMessage(apiError, undefined, 'chat')}`);
  }
  assertBaseResp(data, '文字转语音');

  const hex = data.data?.audio?.trim();
  if (!hex) {
    throw new Error('文字转语音：响应中缺少音频数据');
  }

  const format = data.extra_info?.audio_format ?? 'mp3';
  const mime = format === 'wav' ? 'audio/wav' : format === 'flac' ? 'audio/flac' : 'audio/mpeg';
  const blob = hexToAudioBlob(hex, mime);

  return {
    audioUrl: URL.createObjectURL(blob),
    format,
    sampleRate: data.extra_info?.audio_sample_rate,
    durationMs: data.extra_info?.audio_length,
  };
}
