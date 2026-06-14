'use client';

import type { MusicGenMode, MusicModel } from '@/lib/minimax';

const DRAFT_KEY = 'tools120-music-draft-v2';
const MANIFEST_KEY = 'tools120-music-history-v2';
const DB_NAME = 'tools120-music';
const DB_VERSION = 1;
const STORE = 'clips';
const MAX_HISTORY = 50;

export type StoredMusicEntry = {
  id: string;
  mode: MusicGenMode;
  prompt: string;
  lyrics: string;
  vocalStyle: string;
  referenceName: string;
  songTitle?: string;
  artistName?: string;
  format: string;
  durationMs?: number;
  model: MusicModel;
  lyricsOptimizer: boolean;
  createdAt: number;
};

export type CoverVoiceInput = 'sample' | 'describe';

export type MusicDraft = {
  mode: MusicGenMode;
  prompt: string;
  lyrics: string;
  vocalStyle: string;
  lyricsOptimizer: boolean;
  coverUseReferenceLyrics?: boolean;
  coverVoiceInput?: CoverVoiceInput;
  songTitle?: string;
  artistName?: string;
  coverStyleNote?: string;
  sourceUrl?: string;
};

type MusicManifest = {
  version: 2;
  updatedAt: string;
  items: StoredMusicEntry[];
};

const defaultManifest = (): MusicManifest => ({
  version: 2,
  updatedAt: new Date().toISOString(),
  items: [],
});

const normalizeMode = (value: unknown, instrumental?: boolean): MusicGenMode => {
  if (value === 'vocal' || value === 'instrumental' || value === 'cover') return value;
  return instrumental ? 'instrumental' : 'vocal';
};

type LegacyMusicItem = Partial<StoredMusicEntry> & { instrumental?: boolean };

const readManifest = (): MusicManifest => {
  try {
    const raw = localStorage.getItem(MANIFEST_KEY);
    if (!raw) return defaultManifest();
    const parsed = JSON.parse(raw) as {
      updatedAt?: string;
      items?: LegacyMusicItem[];
    };
    if (!Array.isArray(parsed.items)) return defaultManifest();
    return {
      version: 2,
      updatedAt: parsed.updatedAt ?? new Date().toISOString(),
      items: parsed.items.map((item: LegacyMusicItem) => ({
        id: String(item.id ?? crypto.randomUUID()),
        mode: normalizeMode(item.mode, item.instrumental),
        prompt: String(item.prompt ?? ''),
        lyrics: String(item.lyrics ?? ''),
        vocalStyle: String(item.vocalStyle ?? ''),
        referenceName: String(item.referenceName ?? ''),
        format: String(item.format ?? 'mp3'),
        durationMs: item.durationMs,
        model: item.model === 'music-cover' ? 'music-cover' : 'music-2.6',
        lyricsOptimizer: Boolean(item.lyricsOptimizer),
        createdAt: typeof item.createdAt === 'number' ? item.createdAt : Date.now(),
      })),
    };
  } catch {
    return defaultManifest();
  }
};

const writeManifest = (manifest: MusicManifest) => {
  manifest.updatedAt = new Date().toISOString();
  localStorage.setItem(MANIFEST_KEY, JSON.stringify(manifest));
};

const openDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error ?? new Error('无法打开音乐本地存储'));
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
  });

const putBlob = async (id: string, blob: Blob) => {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('保存音乐失败'));
    tx.objectStore(STORE).put(blob, id);
  });
  db.close();
};

const getBlob = async (id: string): Promise<Blob | undefined> => {
  const db = await openDb();
  const blob = await new Promise<Blob | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    tx.onerror = () => reject(tx.error ?? new Error('读取音乐失败'));
    const request = tx.objectStore(STORE).get(id);
    request.onsuccess = () => resolve(request.result as Blob | undefined);
    request.onerror = () => reject(request.error ?? new Error('读取音乐失败'));
  });
  db.close();
  return blob;
};

const deleteBlob = async (id: string) => {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('删除音乐失败'));
    tx.objectStore(STORE).delete(id);
  });
  db.close();
};

const clearBlobs = async () => {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('清空音乐失败'));
    tx.objectStore(STORE).clear();
  });
  db.close();
};

export type MusicHistoryItem = StoredMusicEntry & { audioUrl: string };

export function loadMusicDraft(): MusicDraft | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<MusicDraft> & { instrumental?: boolean };
    if (typeof parsed.prompt !== 'string') return null;
    return {
      mode: normalizeMode(parsed.mode, parsed.instrumental),
      prompt: parsed.prompt,
      lyrics: typeof parsed.lyrics === 'string' ? parsed.lyrics : '',
      vocalStyle: typeof parsed.vocalStyle === 'string' ? parsed.vocalStyle : '',
      lyricsOptimizer: Boolean(parsed.lyricsOptimizer),
      coverUseReferenceLyrics: Boolean(parsed.coverUseReferenceLyrics),
      coverVoiceInput:
        parsed.coverVoiceInput === 'sample' || parsed.coverVoiceInput === 'describe'
          ? parsed.coverVoiceInput
          : undefined,
      songTitle: typeof parsed.songTitle === 'string' ? parsed.songTitle : undefined,
      artistName: typeof parsed.artistName === 'string' ? parsed.artistName : undefined,
      coverStyleNote: typeof parsed.coverStyleNote === 'string' ? parsed.coverStyleNote : undefined,
      sourceUrl: typeof parsed.sourceUrl === 'string' ? parsed.sourceUrl : undefined,
    };
  } catch {
    return null;
  }
}

export function saveMusicDraft(draft: MusicDraft): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
}

export async function loadMusicHistory(): Promise<MusicHistoryItem[]> {
  const manifest = readManifest();
  const items: MusicHistoryItem[] = [];
  for (const entry of manifest.items) {
    const blob = await getBlob(entry.id);
    if (!blob) continue;
    items.push({
      ...entry,
      audioUrl: URL.createObjectURL(blob),
    });
  }
  return items;
}

export async function appendMusicHistory(entry: StoredMusicEntry, blob: Blob): Promise<void> {
  await putBlob(entry.id, blob);
  const manifest = readManifest();
  const previousItems = manifest.items;
  manifest.items = [entry, ...previousItems.filter((i) => i.id !== entry.id)].slice(0, MAX_HISTORY);
  const keptIds = new Set(manifest.items.map((i) => i.id));
  for (const old of previousItems) {
    if (!keptIds.has(old.id)) {
      await deleteBlob(old.id);
    }
  }
  writeManifest(manifest);
}

export async function removeMusicHistoryItem(id: string): Promise<void> {
  const manifest = readManifest();
  manifest.items = manifest.items.filter((item) => item.id !== id);
  writeManifest(manifest);
  await deleteBlob(id);
}

export async function clearMusicHistoryStore(): Promise<void> {
  await clearBlobs();
  writeManifest(defaultManifest());
}

const MODE_LABELS: Record<MusicGenMode, string> = {
  vocal: '有人声',
  instrumental: '纯音乐',
  cover: '翻唱',
};

export function musicModeLabel(mode: MusicGenMode): string {
  return MODE_LABELS[mode];
}

export function previewMusicLabel(
  entry: Pick<StoredMusicEntry, 'prompt' | 'mode' | 'referenceName' | 'songTitle' | 'artistName'>,
): string {
  if (entry.mode === 'cover') {
    const t = entry.songTitle?.trim();
    const a = entry.artistName?.trim();
    if (t && a) return `翻唱 · ${a}《${t}》`;
    if (t) return `翻唱 · 《${t}》`;
    if (entry.referenceName) return `翻唱 · ${entry.referenceName}`;
  }
  const p = entry.prompt.trim();
  if (p) return p.length > 48 ? `${p.slice(0, 48)}…` : p;
  return musicModeLabel(entry.mode);
}
