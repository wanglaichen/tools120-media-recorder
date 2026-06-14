/**
 * MiniMax 视频 / 图片生成 API
 * 视频: https://platform.minimaxi.com/docs/guides/video-generation
 * 图片: https://platform.minimaxi.com/docs/guides/image-generation
 */

import { assertMiniMaxApiKey, resolveMiniMaxBaseUrl } from '@/lib/ai-provider-config';
import { formatLyricsForSinging } from '@/lib/music-audio';
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
  | 'MiniMax-M3'
  | 'MiniMax-M3-highspeed'
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

// --- 音乐生成（/v1/music_generation，Plus 档可用）---

export type MusicGenMode = 'vocal' | 'instrumental' | 'cover';

export type MusicModel = 'music-2.6' | 'music-cover';

export type MusicCoverProgressStep = 'preprocess' | 'fetch' | 'lyrics' | 'generate';

export interface MusicGenerationParams {
  mode: MusicGenMode;
  prompt: string;
  lyrics?: string;
  vocal_style?: string;
  lyrics_optimizer?: boolean;
  /** @deprecated 翻唱请用 original_audio_base64 */
  audio_base64?: string;
  cover_use_reference_lyrics?: boolean;
  song_title?: string;
  artist_name?: string;
  cover_style_note?: string;
  /** 原曲参考音频（搜索/下载/上传），用于 music-cover 保留旋律 */
  original_audio_base64?: string;
  /** 用户声线样本（与 vocal_style 二选一） */
  voice_audio_base64?: string;
  onCoverProgress?: (step: MusicCoverProgressStep) => void;
}

export interface MusicGenerationResult {
  audioUrl: string;
  format: string;
  durationMs?: number;
  model: MusicModel;
  /** 翻唱时若自动生成了歌词，返回实际使用的歌词 */
  resolvedLyrics?: string;
}

function extractSongTitleFromPrompt(prompt: string): string | undefined {
  const book = prompt.match(/《([^》]{1,40})》/);
  if (book?.[1]?.trim()) return book[1].trim();
  const quote = prompt.match(/「([^」]{1,40})」/);
  if (quote?.[1]?.trim()) return quote[1].trim();
  return undefined;
}

const KNOWN_SONG_MUSIC_STYLES: Record<string, string> = {
  大海: '张雨生《大海》, 华语流行摇滚, 经典前奏, 电吉他, 鼓组, 贝斯, 弦乐, 澎湃情感, 高亢真假声',
};

function buildTargetSongMusicPrompt(userIntent: string, voiceStyle?: string): string {
  const title = extractSongTitleFromPrompt(userIntent);
  const parts: string[] = [
    '完整歌曲',
    '专业编曲',
    '旋律性演唱',
    '禁止朗诵',
    '禁止念白',
    '禁止说话式朗读',
  ];
  if (title && KNOWN_SONG_MUSIC_STYLES[title]) {
    parts.push(KNOWN_SONG_MUSIC_STYLES[title]);
  } else if (title) {
    parts.push(`经典歌曲《${title}》`, '华语流行', '抒情演唱');
  } else {
    parts.push('华语流行', '抒情演唱');
  }
  if (voiceStyle?.trim()) {
    parts.push(voiceStyle.trim());
  } else {
    parts.push('中文男声', '贴近参考录音声线');
  }
  return parts.join(', ').slice(0, 2000);
}

function buildVoiceCoverStylePrompt(
  artist?: string,
  title?: string,
  voiceStyle?: string,
  note?: string,
  useUploadedVoiceSample?: boolean,
): string {
  const parts = [
    '保留原曲旋律',
    '完整编曲翻唱',
    '旋律性演唱',
    '禁止朗诵',
    '禁止念白',
  ];
  const a = artist?.trim();
  const t = title?.trim();
  if (a && t) parts.push(`${a}《${t}》经典版`);
  else if (t) parts.push(`《${t}》`);
  if (voiceStyle?.trim()) {
    parts.push(voiceStyle.trim());
  } else if (useUploadedVoiceSample) {
    parts.push('使用上传声线样本音色');
  }
  if (note?.trim()) parts.push(note.trim());
  const text = parts.join(', ');
  return text.length >= 10 ? text.slice(0, 300) : `${text}, 流行翻唱`.slice(0, 300);
}

type CoverPreprocessResult = {
  cover_feature_id?: string;
  formatted_lyrics?: string;
  base_resp?: MiniMaxBaseResp;
};

async function musicCoverPreprocess(audioBase64: string): Promise<CoverPreprocessResult> {
  const response = await minimaxFetch(
    `${miniMaxBaseUrl()}/v1/music_cover_preprocess`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'music-cover',
        audio_base64: audioBase64,
      }),
    },
    '翻唱预处理',
  );

  const data = parseJsonBody<CoverPreprocessResult>(await response.text(), '翻唱预处理');
  assertBaseResp(data, '翻唱预处理');
  if (!data.cover_feature_id?.trim()) {
    throw new Error('翻唱预处理：未返回 cover_feature_id');
  }
  return data;
}

async function resolveCoverLyrics(
  userLyrics: string | undefined,
  originalAudioBase64: string | undefined,
  userIntent: string,
  artistName: string,
  songTitle: string,
  onProgress?: (step: MusicCoverProgressStep) => void,
): Promise<string> {
  if (userLyrics) {
    return formatLyricsForSinging(userLyrics);
  }
  if (originalAudioBase64) {
    onProgress?.('preprocess');
    const origPre = await musicCoverPreprocess(originalAudioBase64);
    const fromOriginal = origPre.formatted_lyrics?.trim();
    if (fromOriginal && fromOriginal.length >= 10) {
      return formatLyricsForSinging(fromOriginal);
    }
  }
  onProgress?.('lyrics');
  const intent =
    userIntent ||
    (artistName && songTitle
      ? `用我的声音翻唱${artistName}的《${songTitle}》`
      : songTitle
        ? `用我的声音翻唱《${songTitle}》`
        : '');
  return generateLyricsForCover(intent);
}

async function generateLyricsForCover(userPrompt: string): Promise<string> {
  const title = extractSongTitleFromPrompt(userPrompt);
  const chatPrompt = title
    ? `请输出中文歌曲《${title}》的完整歌词，供 AI 音乐模型演唱（不是朗诵）。要求：
1. 只输出歌词正文，不要标题、解释或 markdown
2. 使用 [Verse]、[Chorus]、[Bridge] 等英文结构标签，标签独占一行
3. 每句歌词单独一行，用换行分隔，尽量贴近原曲经典段落与名句
4. 总长度 10–900 字

用户说明：${userPrompt}`
    : `请输出完整中文歌词，只输出歌词正文。每句单独一行，使用 [Verse] [Chorus] 等标签，10–900 字：\n${userPrompt}`;

  const lyrics = await createChatCompletion({
    model: 'MiniMax-M2.7',
    messages: [{ role: 'user', content: chatPrompt }],
    max_tokens: 2500,
  });

  const formatted = formatLyricsForSinging(lyrics);
  if (!formatted || formatted.length < 10) {
    throw new Error('翻唱：未能根据描述生成足够长度的歌词，请手动填写目标歌曲歌词');
  }
  if (formatted.length > 1000) {
    return formatted.slice(0, 1000);
  }
  return formatted;
}

async function requestMusicGeneration(payload: Record<string, unknown>): Promise<MusicGenerationResult> {
  const response = await minimaxFetch(
    `${miniMaxBaseUrl()}/v1/music_generation`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
    '音乐生成',
  );

  const data = parseJsonBody<{
    data?: { audio?: string; status?: number };
    extra_info?: { music_duration?: number; music_format?: string };
    base_resp?: MiniMaxBaseResp;
  }>(await response.text(), '音乐生成');

  assertBaseResp(data, '音乐生成');

  const status = data.data?.status;
  if (status !== undefined && status !== 2) {
    throw new Error(`音乐生成：任务未完成（status=${status}），请稍后重试或缩短歌词`);
  }

  const hex = data.data?.audio?.trim();
  if (!hex) {
    throw new Error('音乐生成：响应中缺少音频数据');
  }

  const format = data.extra_info?.music_format ?? 'mp3';
  const mime = format === 'wav' ? 'audio/wav' : 'audio/mpeg';
  const blob = hexToAudioBlob(hex, mime);
  const model = payload.model === 'music-cover' ? 'music-cover' : 'music-2.6';

  return {
    audioUrl: URL.createObjectURL(blob),
    format,
    durationMs: data.extra_info?.music_duration,
    model,
  };
}

/** 文生音乐 / 纯音乐 / 翻唱（music-cover + 参考音频） */
export async function generateMusic(params: MusicGenerationParams): Promise<MusicGenerationResult> {
  const mode = params.mode;
  const payload: Record<string, unknown> = {
    output_format: 'hex',
    audio_setting: {
      sample_rate: 44100,
      bitrate: 256000,
      format: 'mp3',
    },
  };

  let model: MusicModel = 'music-2.6';

  if (mode === 'cover') {
    const songTitle = params.song_title?.trim() || extractSongTitleFromPrompt(params.prompt) || '';
    const artistName = params.artist_name?.trim() || '';
    const styleNote = params.cover_style_note?.trim() || '';
    const userIntent = params.prompt.trim();
    const originalB64 = params.original_audio_base64?.trim();
    const voiceB64 = params.voice_audio_base64?.trim();
    const legacyB64 = params.audio_base64?.trim();
    const voiceStyleText = params.vocal_style?.trim();

    if (!songTitle && userIntent.length < 10) {
      throw new Error('翻唱：请填写歌曲名，或填写至少 10 字的翻唱描述');
    }

    const userLyrics = params.lyrics?.trim();
    if (userLyrics && (userLyrics.length < 10 || userLyrics.length > 1000)) {
      throw new Error('翻唱：歌词长度需 10–1000 个字符，或留空从原曲识别/自动生成');
    }

    if (!voiceB64 && !voiceStyleText && !legacyB64) {
      throw new Error('翻唱：请上传声线样本，或填写声线描述（二选一）');
    }
    if (voiceB64 && voiceStyleText) {
      throw new Error('翻唱：已上传声线样本时请勿填写声线描述，二者不可同时使用');
    }

    const audioSetting = payload.audio_setting;
    const referenceB64 = originalB64 || (params.cover_use_reference_lyrics ? legacyB64 : '');

    if (referenceB64) {
      // 已上传声线样本：预处理提取音色，不用文字声线描述
      if (voiceB64) {
        params.onCoverProgress?.('preprocess');
        const voicePre = await musicCoverPreprocess(voiceB64);
        const finalLyrics = await resolveCoverLyrics(
          userLyrics,
          referenceB64,
          userIntent,
          artistName,
          songTitle,
          params.onCoverProgress,
        );
        const coverPrompt = buildVoiceCoverStylePrompt(
          artistName,
          songTitle,
          undefined,
          styleNote || userIntent,
          true,
        );
        params.onCoverProgress?.('generate');
        const result = await requestMusicGeneration({
          model: 'music-cover',
          cover_feature_id: voicePre.cover_feature_id,
          lyrics: finalLyrics,
          prompt: coverPrompt,
          output_format: 'hex',
          audio_setting: audioSetting,
        });
        return { ...result, resolvedLyrics: finalLyrics, model: 'music-cover' };
      }

      // 仅文字声线描述：原曲一步翻唱
      const coverPrompt = buildVoiceCoverStylePrompt(
        artistName,
        songTitle,
        voiceStyleText,
        styleNote || userIntent,
        false,
      );
      params.onCoverProgress?.('generate');
      const coverPayload: Record<string, unknown> = {
        model: 'music-cover',
        prompt: coverPrompt,
        audio_base64: referenceB64,
        output_format: 'hex',
        audio_setting: audioSetting,
      };
      if (userLyrics) {
        coverPayload.lyrics = formatLyricsForSinging(userLyrics);
      }
      const result = await requestMusicGeneration(coverPayload);
      return {
        ...result,
        resolvedLyrics: userLyrics ? formatLyricsForSinging(userLyrics) : undefined,
        model: 'music-cover',
      };
    }

    if (!voiceStyleText && !legacyB64) {
      throw new Error('翻唱：请先获取原曲，并上传声线样本或填写声线描述');
    }

    // 无原曲：music-2.6 按歌名生成（需先搜索原曲或粘贴链接）
    const intent =
      userIntent ||
      (artistName && songTitle
        ? `用我的声音翻唱${artistName}的《${songTitle}》`
        : songTitle
          ? `用我的声音翻唱《${songTitle}》`
          : '');
    if (intent.length < 10) {
      throw new Error('翻唱：请先点击「搜索并获取原曲」，或粘贴原曲链接');
    }

    let finalLyrics = userLyrics ? formatLyricsForSinging(userLyrics) : '';
    if (!finalLyrics) {
      params.onCoverProgress?.('lyrics');
      finalLyrics = await generateLyricsForCover(intent);
    }

    const musicPrompt = buildTargetSongMusicPrompt(intent, params.vocal_style);
    params.onCoverProgress?.('generate');
    const result = await requestMusicGeneration({
      model: 'music-2.6',
      prompt: musicPrompt,
      lyrics: finalLyrics,
      output_format: 'hex',
      audio_setting: audioSetting,
    });
    return { ...result, resolvedLyrics: finalLyrics, model: 'music-2.6' };
  } else if (mode === 'instrumental') {
    const styleParts = [params.prompt.trim(), params.vocal_style?.trim()].filter(Boolean);
    const prompt = styleParts.join(', ');
    if (!prompt) {
      throw new Error('纯音乐：请填写风格描述');
    }
    payload.model = model;
    payload.prompt = prompt;
    payload.is_instrumental = true;
  } else {
    const styleParts = [params.prompt.trim(), params.vocal_style?.trim()].filter(Boolean);
    const prompt = styleParts.join(', ');
    const lyrics = params.lyrics?.trim();
    if (!lyrics && !params.lyrics_optimizer) {
      throw new Error('有人声：请填写歌词，或开启 AI 优化歌词');
    }
    payload.model = model;
    if (prompt) payload.prompt = prompt;
    if (lyrics) payload.lyrics = lyrics;
    if (params.lyrics_optimizer) payload.lyrics_optimizer = true;
  }

  return requestMusicGeneration({ ...payload, model });
}

// --- M3 多模态对话（图片 / 视频理解）---

export type MultimodalContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
  | { type: 'video_url'; video_url: { url: string } };

export type MultimodalMessage = {
  role: ChatRole;
  content: string | MultimodalContentPart[];
};

export interface MultimodalCompletionParams {
  messages: MultimodalMessage[];
  model?: 'MiniMax-M3' | 'MiniMax-M3-highspeed';
  max_tokens?: number;
}

/** M3 多模态：支持 image_url / video_url 与文本混合输入 */
export async function createMultimodalCompletion(
  params: MultimodalCompletionParams,
): Promise<string> {
  const url = `${miniMaxBaseUrl()}/v1/chat/completions`;
  const payload = {
    model: params.model ?? 'MiniMax-M3',
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
    '多模态理解',
  );

  const data = parseJsonBody<{
    choices?: Array<{ message?: { content?: string } }>;
    base_resp?: MiniMaxBaseResp;
    error?: unknown;
  }>(await response.text(), '多模态理解');

  const apiError = normalizeApiErrorDetail(data.error);
  if (apiError) {
    throw new Error(`多模态理解：${formatMiniMaxErrorMessage(apiError, undefined, 'chat')}`);
  }
  assertBaseResp(data, '多模态理解');

  const content = data.choices?.[0]?.message?.content;
  if (!content?.trim()) {
    throw new Error('多模态理解：响应中缺少回复内容');
  }
  return content.trim();
}

/** M3 长文分析（1M 上下文，适合粘贴长文档） */
export async function createM3LongAnalysis(params: {
  document: string;
  question: string;
  model?: 'MiniMax-M3' | 'MiniMax-M3-highspeed';
}): Promise<string> {
  const doc = params.document.trim();
  const question = params.question.trim();
  if (!doc) throw new Error('长文分析：请粘贴或输入待分析文本');
  if (!question) throw new Error('长文分析：请输入分析问题');

  return createMultimodalCompletion({
    model: params.model ?? 'MiniMax-M3',
    max_tokens: 8192,
    messages: [
      {
        role: 'system',
        content:
          '你是擅长长文阅读与结构化分析的助手。请基于用户提供的全文作答，引用关键信息，不要编造文中不存在的内容。',
      },
      {
        role: 'user',
        content: `【待分析全文】\n${doc}\n\n【问题】\n${question}`,
      },
    ],
  });
}
