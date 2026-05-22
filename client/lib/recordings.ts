'use client';

import {
  localClearAllRecordings,
  localCreateRecording,
  localDeleteRecordingById,
  localFetchManifest,
  localFetchRecordingBlob,
  localUpdateRecordingName,
} from './localRecordings';

export type RecordingEntry = {
  id: string;
  displayName: string;
  fileName: string;
  duration: number;
  size: number;
  mimeType: string;
  createdAt: number;
};

export type RecordingsManifest = {
  version: number;
  updatedAt: string;
  recordings: RecordingEntry[];
};

const trimSlash = (value: string) => value.replace(/\/$/, '');

const configuredApiOrigin = (): string => {
  const apiOrigin = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
  if (apiOrigin?.startsWith('http://') || apiOrigin?.startsWith('https://')) {
    return trimSlash(apiOrigin);
  }
  return '';
};

const isLocalDevHost = (hostname: string) =>
  hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]';

/**
 * 浏览器内实际请求 API 的 origin。
 * 预览域名（*-xxx.edgeone.cool）与构建变量里的正式域名不一致时，必须用当前页同源，否则会跨域/401。
 */
const resolveBrowserApiOrigin = (): string => {
  const pageOrigin = trimSlash(window.location.origin);
  const configured = configuredApiOrigin();
  if (!configured || configured === pageOrigin) return pageOrigin;
  if (isLocalDevHost(window.location.hostname)) return configured;
  return pageOrigin;
};

/** 顶栏展示用：浏览器内为当前页 origin，构建/SSR 为环境变量 */
export const resolveApiOrigin = (): string => {
  if (typeof window !== 'undefined') return resolveBrowserApiOrigin();
  return configuredApiOrigin();
};

export const resolveHealthUrl = (): string => {
  if (typeof window !== 'undefined') {
    if (isLocalDevHost(window.location.hostname) && configuredApiOrigin()) {
      return `${configuredApiOrigin()}/api/health`;
    }
    return '/api/health';
  }
  const origin = configuredApiOrigin();
  return origin ? `${origin}/api/health` : '/api/health';
};

export const resolveUiStateUrl = (): string => {
  if (typeof window !== 'undefined') {
    if (isLocalDevHost(window.location.hostname) && configuredApiOrigin()) {
      return `${configuredApiOrigin()}/api/ui-state`;
    }
    return '/api/ui-state';
  }
  const origin = configuredApiOrigin();
  return origin ? `${origin}/api/ui-state` : '/api/ui-state';
};

export const resolveApiBase = (): string => {
  if (typeof window !== 'undefined') {
    if (isLocalDevHost(window.location.hostname) && configuredApiOrigin()) {
      return `${configuredApiOrigin()}/api/audio`;
    }
    return '/api/audio';
  }
  const origin = configuredApiOrigin();
  return origin ? `${origin}/api/audio` : '/api/audio';
};

export const usesLocalRecordings = (): boolean => {
  if (process.env.NODE_ENV !== 'production') return false;
  const base = resolveApiBase();
  if (base.startsWith('http')) return false;
  if (base.startsWith('/api')) return false;
  return true;
};

export const apiUnavailableMessage =
  'API 不可用（返回了 EdgeOne 登录/401 页面）：请用控制台「预览」链接打开本站，或确认云函数已部署；预览地址请访问当前域名下的 /api/ui-state，勿跨域请求其它域名。';

export const readResponseJson = async <T>(response: Response, bodyText?: string): Promise<T> => {
  const text = bodyText ?? (await response.text());
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('text/html') || text.trimStart().startsWith('<!')) {
    throw new Error(
      response.status === 401
        ? `${apiUnavailableMessage}（HTTP 401）`
        : apiUnavailableMessage,
    );
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(
      text.trimStart().startsWith('<!')
        ? apiUnavailableMessage
        : `接口返回不是 JSON：${text.slice(0, 120)}`,
    );
  }
};

const requestJson = async <T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> => {
  const response = await fetch(input, init);
  const text = await response.text();
  const data = await readResponseJson<T>(response, text);
  if (!response.ok) {
    const payload = data as { error?: string };
    throw new Error(payload.error || `请求失败：HTTP ${response.status}`);
  }
  return data;
};

export const getRecordingFileUrl = (id: string) => `${resolveApiBase()}/${id}/file`;

export const fetchManifest = async (): Promise<RecordingsManifest> => {
  if (usesLocalRecordings()) return localFetchManifest();
  return requestJson<RecordingsManifest>(resolveApiBase());
};

export const createRecording = async (
  file: Blob,
  fileName: string,
  duration: number,
  displayName: string,
): Promise<{ recording: RecordingEntry; manifest: RecordingsManifest }> => {
  if (usesLocalRecordings()) {
    return localCreateRecording(file, fileName, duration, displayName);
  }

  const formData = new FormData();
  formData.append('file', file, fileName);
  formData.append('duration', String(duration));
  formData.append('displayName', displayName);

  return requestJson<{ recording: RecordingEntry; manifest: RecordingsManifest }>(resolveApiBase(), {
    method: 'POST',
    body: formData,
  });
};

export const updateRecordingName = async (
  id: string,
  displayName: string,
): Promise<{ recording: RecordingEntry; manifest: RecordingsManifest }> => {
  if (usesLocalRecordings()) return localUpdateRecordingName(id, displayName);

  return requestJson<{ recording: RecordingEntry; manifest: RecordingsManifest }>(
    `${resolveApiBase()}/${id}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName }),
    },
  );
};

export const deleteRecordingById = async (id: string): Promise<RecordingsManifest> => {
  if (usesLocalRecordings()) return localDeleteRecordingById(id);

  const data = await requestJson<{ manifest: RecordingsManifest }>(`${resolveApiBase()}/${id}`, {
    method: 'DELETE',
  });
  return data.manifest;
};

export const clearAllRecordings = async (): Promise<RecordingsManifest> => {
  if (usesLocalRecordings()) return localClearAllRecordings();

  const data = await requestJson<{ manifest: RecordingsManifest }>(resolveApiBase(), {
    method: 'DELETE',
  });
  return data.manifest;
};

export const fetchRecordingBlob = async (id: string): Promise<Blob> => {
  if (usesLocalRecordings()) return localFetchRecordingBlob(id);

  const response = await fetch(getRecordingFileUrl(id));
  if (!response.ok) {
    throw new Error(`读取音频失败：HTTP ${response.status}`);
  }
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('text/html')) {
    throw new Error(apiUnavailableMessage);
  }
  return response.blob();
};
