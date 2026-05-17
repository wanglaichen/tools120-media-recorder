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

/** 生产构建需为完整 URL；开发可用 /api/audio */
export const resolveApiBase = (): string => {
  const endpoint = process.env.NEXT_PUBLIC_UPLOAD_ENDPOINT?.trim();
  const apiOrigin = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();

  if (endpoint?.startsWith('http://') || endpoint?.startsWith('https://')) {
    return trimSlash(endpoint);
  }

  if (apiOrigin) {
    const origin = trimSlash(apiOrigin);
    if (endpoint?.startsWith('/')) return `${origin}${endpoint}`;
    return `${origin}/api/audio`;
  }

  return trimSlash(endpoint || '/api/audio');
};

export const usesLocalRecordings = (): boolean =>
  process.env.NODE_ENV === 'production' && !resolveApiBase().startsWith('http');

const apiUnavailableMessage =
  '线上未配置录音 API：请在 Gitee 流水线设置 NEXT_PUBLIC_API_BASE_URL 或 NEXT_PUBLIC_UPLOAD_ENDPOINT（完整 https 地址），并重新部署。当前已改用浏览器本地存储。';

const readResponseJson = async <T>(response: Response, bodyText?: string): Promise<T> => {
  const text = bodyText ?? (await response.text());
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('text/html') || text.trimStart().startsWith('<!')) {
    throw new Error(apiUnavailableMessage);
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

const apiBase = resolveApiBase();

export const getRecordingFileUrl = (id: string) => `${apiBase}/${id}/file`;

export const fetchManifest = async (): Promise<RecordingsManifest> => {
  if (usesLocalRecordings()) return localFetchManifest();
  return requestJson<RecordingsManifest>(apiBase);
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

  return requestJson<{ recording: RecordingEntry; manifest: RecordingsManifest }>(apiBase, {
    method: 'POST',
    body: formData,
  });
};

export const updateRecordingName = async (
  id: string,
  displayName: string,
): Promise<{ recording: RecordingEntry; manifest: RecordingsManifest }> => {
  if (usesLocalRecordings()) return localUpdateRecordingName(id, displayName);

  return requestJson<{ recording: RecordingEntry; manifest: RecordingsManifest }>(`${apiBase}/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ displayName }),
  });
};

export const deleteRecordingById = async (id: string): Promise<RecordingsManifest> => {
  if (usesLocalRecordings()) return localDeleteRecordingById(id);

  const data = await requestJson<{ manifest: RecordingsManifest }>(`${apiBase}/${id}`, { method: 'DELETE' });
  return data.manifest;
};

export const clearAllRecordings = async (): Promise<RecordingsManifest> => {
  if (usesLocalRecordings()) return localClearAllRecordings();

  const data = await requestJson<{ manifest: RecordingsManifest }>(apiBase, { method: 'DELETE' });
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