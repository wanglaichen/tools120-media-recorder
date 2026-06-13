/**
 * MiniMax 声音克隆：上传样本 → voice_clone → 使用自定义 voice_id 做 T2A
 * https://platform.minimaxi.com/docs/guides/speech-voice-clone
 */

import { assertMiniMaxApiKey, resolveMiniMaxBaseUrl } from '@/lib/ai-provider-config';
import type { SpeechModel } from '@/lib/minimax';
import {
  getMiniMaxProxyEndpoint,
  getMiniMaxUploadEndpoint,
  useMiniMaxServerProxy,
} from '@/lib/minimax-transport';

type MiniMaxBaseResp = {
  status_code?: number;
  status_msg?: unknown;
};

function normalizeApiErrorDetail(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>;
    if (typeof o.message === 'string' && o.message.trim()) return o.message.trim();
    if (typeof o.status_msg === 'string' && o.status_msg.trim()) return o.status_msg.trim();
  }
  return String(value);
}

function assertBaseResp(data: { base_resp?: MiniMaxBaseResp }, label: string) {
  const code = data.base_resp?.status_code;
  if (code === undefined || code === 0) return;
  const msg = normalizeApiErrorDetail(data.base_resp?.status_msg) || '未知错误';
  throw new Error(`${label}：${msg}${code ? `（status_code=${code}）` : ''}`);
}

function parseJsonBody<T>(text: string, label: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${label}：响应不是合法 JSON`);
  }
}

function hexToAudioBlob(hex: string, mime: string): Blob {
  const normalized = hex.replace(/\s/g, '');
  const bytes = new Uint8Array(normalized.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = parseInt(normalized.slice(i * 2, i * 2 + 2), 16);
  }
  return new Blob([bytes], { type: mime });
}

async function minimaxJsonPost(path: string, body: unknown, label: string): Promise<Response> {
  const baseUrl = resolveMiniMaxBaseUrl();
  const url = `${baseUrl}${path}`;

  if (await useMiniMaxServerProxy()) {
    return fetch(getMiniMaxProxyEndpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, method: 'POST', body }),
    });
  }

  const apiKey = assertMiniMaxApiKey();
  return fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

/** MiniMax voice_id：8–256 字符，英文字母开头，仅字母/数字/-/_，不能以 - 或 _ 结尾 */
export function buildCloneVoiceId(_label?: string): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  let id = `Clone${ts}${rand}`.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!/^[a-zA-Z]/.test(id)) id = `V${id}`;
  id = id.replace(/[-_]+$/g, '');
  while (id.length < 8) id += '0';
  return id.slice(0, 256);
}

export function isValidCloneVoiceId(voiceId: string): boolean {
  if (voiceId.length < 8 || voiceId.length > 256) return false;
  if (!/^[a-zA-Z]/.test(voiceId)) return false;
  if (/[-_]$/.test(voiceId)) return false;
  return /^[a-zA-Z0-9_-]+$/.test(voiceId);
}

export async function uploadMiniMaxVoiceFile(
  file: Blob,
  filename: string,
  purpose: 'voice_clone' | 'prompt_audio' = 'voice_clone',
): Promise<number> {
  if (!(await useMiniMaxServerProxy())) {
    throw new Error('声音克隆需服务端配置 MINIMAX_API_KEY（浏览器直连暂不支持文件上传）');
  }

  const form = new FormData();
  form.append('purpose', purpose);
  form.append('file', file, filename);

  const response = await fetch(getMiniMaxUploadEndpoint(), {
    method: 'POST',
    body: form,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`上传音频失败：HTTP ${response.status} ${text.slice(0, 200)}`);
  }

  const data = parseJsonBody<{
    file?: { file_id?: number };
    base_resp?: MiniMaxBaseResp;
  }>(text, '上传克隆样本');

  assertBaseResp(data, '上传克隆样本');
  const fileId = data.file?.file_id;
  if (typeof fileId !== 'number') {
    throw new Error('上传克隆样本：响应中缺少 file_id');
  }
  return fileId;
}

export type VoiceCloneResult = {
  voiceId: string;
  previewAudioUrl?: string;
  previewFormat?: string;
};

export async function cloneMiniMaxVoice(params: {
  fileId: number;
  voiceId: string;
  previewText?: string;
  model?: SpeechModel;
}): Promise<VoiceCloneResult> {
  if (!isValidCloneVoiceId(params.voiceId)) {
    throw new Error(
      '声音克隆：voice_id 格式无效（需 8–256 字符、英文字母开头，仅含字母/数字/-/_）',
    );
  }

  const payload: Record<string, unknown> = {
    file_id: params.fileId,
    voice_id: params.voiceId,
    model: params.model ?? 'speech-2.8-hd',
  };
  if (params.previewText?.trim()) {
    payload.text = params.previewText.trim();
  }

  const response = await minimaxJsonPost('/v1/voice_clone', payload, '声音克隆');
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`声音克隆失败：HTTP ${response.status} ${text.slice(0, 200)}`);
  }

  const data = parseJsonBody<{
    voice_id?: string;
    data?: { audio?: string };
    extra_info?: { audio_format?: string };
    base_resp?: MiniMaxBaseResp;
  }>(text, '声音克隆');

  assertBaseResp(data, '声音克隆');

  const voiceId = data.voice_id ?? params.voiceId;
  let previewAudioUrl: string | undefined;
  let previewFormat: string | undefined;
  const hex = data.data?.audio?.trim();
  if (hex) {
    previewFormat = data.extra_info?.audio_format ?? 'mp3';
    const mime =
      previewFormat === 'wav'
        ? 'audio/wav'
        : previewFormat === 'flac'
          ? 'audio/flac'
          : 'audio/mpeg';
    previewAudioUrl = URL.createObjectURL(hexToAudioBlob(hex, mime));
  }

  return { voiceId, previewAudioUrl, previewFormat };
}
