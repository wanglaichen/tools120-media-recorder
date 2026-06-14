'use client';

export type OriginalSongMatch = {
  title: string;
  artist: string;
  previewUrl?: string;
  durationMs?: number;
  source: string;
};

export type FetchedOriginalAudio = OriginalSongMatch & {
  blob: Blob;
  size: number;
  sourceUrl?: string;
};

function musicApiBase(): string {
  const base = (process.env.NEXT_PUBLIC_API_BASE_URL || '').trim().replace(/\/+$/, '');
  return base ? `${base}/api` : '/api';
}

function base64ToBlob(base64: string, contentType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: contentType || 'audio/mpeg' });
}

async function readApiError(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: string };
    if (data.error) return data.error;
  } catch {
    /* ignore */
  }
  return `请求失败 HTTP ${res.status}`;
}

/** 按歌手 + 歌名搜索并下载原曲预览（iTunes，约 30 秒） */
export async function fetchOriginalSongByMeta(
  artist: string,
  title: string,
): Promise<FetchedOriginalAudio> {
  const res = await fetch(`${musicApiBase()}/music/fetch-preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ artist: artist.trim(), title: title.trim() }),
  });
  if (!res.ok) {
    throw new Error(await readApiError(res));
  }
  const data = (await res.json()) as {
    title: string;
    artist: string;
    previewUrl?: string;
    durationMs?: number;
    source: string;
    base64: string;
    contentType: string;
    size: number;
  };
  return {
    title: data.title,
    artist: data.artist,
    previewUrl: data.previewUrl,
    durationMs: data.durationMs,
    source: data.source,
    size: data.size,
    blob: base64ToBlob(data.base64, data.contentType),
  };
}

/** 从用户粘贴的原曲直链下载 */
export async function fetchOriginalSongFromUrl(url: string): Promise<FetchedOriginalAudio> {
  const res = await fetch(`${musicApiBase()}/music/fetch-audio`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: url.trim() }),
  });
  if (!res.ok) {
    throw new Error(await readApiError(res));
  }
  const data = (await res.json()) as {
    base64: string;
    contentType: string;
    size: number;
    sourceUrl?: string;
  };
  return {
    title: '',
    artist: '',
    source: 'url',
    size: data.size,
    sourceUrl: data.sourceUrl,
    blob: base64ToBlob(data.base64, data.contentType),
  };
}

export function buildCoverIntent(
  artist: string,
  title: string,
  styleNote?: string,
): string {
  const a = artist.trim();
  const t = title.trim();
  const note = styleNote?.trim();
  let intent = '';
  if (a && t) intent = `用我的声音翻唱${a}的《${t}》`;
  else if (t) intent = `用我的声音翻唱《${t}》`;
  else if (a) intent = `用我的声音翻唱${a}的歌曲`;
  else intent = '用我的声音翻唱指定歌曲';
  if (note) intent = `${intent}，${note}`;
  return intent.slice(0, 300);
}
