'use client';

import type { SpeechModel } from '@/lib/minimax';
import {
  DEFAULT_SPEECH_VOICE_ID,
  normalizeSpeechVoiceId,
} from '@/lib/speech-voices';

const DRAFT_KEY = 'tools120-speech-draft-v1';
const MANIFEST_KEY = 'tools120-speech-history-v1';
const DB_NAME = 'tools120-speech';
const DB_VERSION = 1;
const STORE = 'clips';
const MAX_HISTORY = 100;

export type StoredSpeechEntry = {
  id: string;
  text: string;
  format: string;
  durationMs?: number;
  model: SpeechModel;
  voiceId: string;
  voiceLabel: string;
  createdAt: number;
};

export type SpeechDraft = {
  text: string;
  model: SpeechModel;
  voiceId: string;
  speed: number;
};

type SpeechManifest = {
  version: 1;
  updatedAt: string;
  items: StoredSpeechEntry[];
};

const defaultManifest = (): SpeechManifest => ({
  version: 1,
  updatedAt: new Date().toISOString(),
  items: [],
});

const readManifest = (): SpeechManifest => {
  try {
    const raw = localStorage.getItem(MANIFEST_KEY);
    if (!raw) return defaultManifest();
    const parsed = JSON.parse(raw) as SpeechManifest;
    if (parsed.version !== 1 || !Array.isArray(parsed.items)) return defaultManifest();
    return parsed;
  } catch {
    return defaultManifest();
  }
};

const writeManifest = (manifest: SpeechManifest) => {
  manifest.updatedAt = new Date().toISOString();
  localStorage.setItem(MANIFEST_KEY, JSON.stringify(manifest));
};

const openDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error ?? new Error('无法打开语音本地存储'));
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
    tx.onerror = () => reject(tx.error ?? new Error('保存语音失败'));
    tx.objectStore(STORE).put(blob, id);
  });
  db.close();
};

const getBlob = async (id: string): Promise<Blob | undefined> => {
  const db = await openDb();
  const blob = await new Promise<Blob | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    tx.onerror = () => reject(tx.error ?? new Error('读取语音失败'));
    const request = tx.objectStore(STORE).get(id);
    request.onsuccess = () => resolve(request.result as Blob | undefined);
    request.onerror = () => reject(request.error ?? new Error('读取语音失败'));
  });
  db.close();
  return blob;
};

const deleteBlob = async (id: string) => {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('删除语音失败'));
    tx.objectStore(STORE).delete(id);
  });
  db.close();
};

const clearBlobs = async () => {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('清空语音失败'));
    tx.objectStore(STORE).clear();
  });
  db.close();
};

export type SpeechHistoryItem = StoredSpeechEntry & { audioUrl: string };

export function loadSpeechDraft(): SpeechDraft | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SpeechDraft>;
    if (typeof parsed.text !== 'string') return null;
    return {
      text: parsed.text.slice(0, 10000),
      model: (parsed.model as SpeechModel) || 'speech-2.8-hd',
      voiceId: normalizeSpeechVoiceId(parsed.voiceId),
      speed: typeof parsed.speed === 'number' ? parsed.speed : 1,
    };
  } catch {
    return null;
  }
}

export function saveSpeechDraft(draft: SpeechDraft): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(
    DRAFT_KEY,
    JSON.stringify({
      text: draft.text.slice(0, 10000),
      model: draft.model,
      voiceId: draft.voiceId,
      speed: draft.speed,
    }),
  );
}

export function clearSpeechDraft(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(DRAFT_KEY);
}

export async function loadSpeechHistory(): Promise<SpeechHistoryItem[]> {
  const manifest = readManifest();
  const items: SpeechHistoryItem[] = [];
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

export async function appendSpeechHistory(
  entry: StoredSpeechEntry,
  blob: Blob,
): Promise<void> {
  await putBlob(entry.id, blob);
  const manifest = readManifest();
  const previousItems = manifest.items;
  manifest.items = [entry, ...previousItems.filter((i) => i.id !== entry.id)].slice(
    0,
    MAX_HISTORY,
  );
  const keptIds = new Set(manifest.items.map((i) => i.id));
  for (const old of previousItems) {
    if (!keptIds.has(old.id)) {
      await deleteBlob(old.id);
    }
  }
  writeManifest(manifest);
}

export async function removeSpeechHistoryItem(id: string): Promise<void> {
  const manifest = readManifest();
  manifest.items = manifest.items.filter((item) => item.id !== id);
  writeManifest(manifest);
  await deleteBlob(id);
}

export async function clearSpeechHistoryStore(): Promise<void> {
  await clearBlobs();
  writeManifest(defaultManifest());
}
