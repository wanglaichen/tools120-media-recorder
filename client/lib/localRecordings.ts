'use client';

import type { RecordingEntry, RecordingsManifest } from './recordings';

const MANIFEST_KEY = 'media-recorder-manifest';
const DB_NAME = 'media-recorder-clips';
const DB_VERSION = 1;
const STORE = 'clips';

const defaultManifest = (): RecordingsManifest => ({
  version: 1,
  updatedAt: new Date().toISOString(),
  recordings: [],
});

const readManifest = (): RecordingsManifest => {
  try {
    const raw = localStorage.getItem(MANIFEST_KEY);
    if (!raw) return defaultManifest();
    return JSON.parse(raw) as RecordingsManifest;
  } catch {
    return defaultManifest();
  }
};

const writeManifest = (manifest: RecordingsManifest) => {
  manifest.updatedAt = new Date().toISOString();
  localStorage.setItem(MANIFEST_KEY, JSON.stringify(manifest));
};

const openDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error ?? new Error('无法打开本地存储'));
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
    tx.onerror = () => reject(tx.error ?? new Error('保存音频失败'));
    tx.objectStore(STORE).put(blob, id);
  });
  db.close();
};

const getBlob = async (id: string): Promise<Blob> => {
  const db = await openDb();
  const blob = await new Promise<Blob | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    tx.onerror = () => reject(tx.error ?? new Error('读取音频失败'));
    const request = tx.objectStore(STORE).get(id);
    request.onsuccess = () => resolve(request.result as Blob | undefined);
    request.onerror = () => reject(request.error ?? new Error('读取音频失败'));
  });
  db.close();
  if (!blob) throw new Error('本地录音不存在');
  return blob;
};

const deleteBlob = async (id: string) => {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('删除音频失败'));
    tx.objectStore(STORE).delete(id);
  });
  db.close();
};

const clearBlobs = async () => {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('清空音频失败'));
    tx.objectStore(STORE).clear();
  });
  db.close();
};

export const localFetchManifest = async (): Promise<RecordingsManifest> => readManifest();

export const localCreateRecording = async (
  file: Blob,
  fileName: string,
  duration: number,
  displayName: string,
): Promise<{ recording: RecordingEntry; manifest: RecordingsManifest }> => {
  const manifest = readManifest();
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const recording: RecordingEntry = {
    id,
    displayName,
    fileName,
    duration,
    size: file.size,
    mimeType: file.type || 'audio/webm',
    createdAt: Date.now(),
  };
  await putBlob(id, file);
  manifest.recordings = [recording, ...manifest.recordings];
  writeManifest(manifest);
  return { recording, manifest };
};

export const localUpdateRecordingName = async (
  id: string,
  displayName: string,
): Promise<{ recording: RecordingEntry; manifest: RecordingsManifest }> => {
  const manifest = readManifest();
  const recording = manifest.recordings.find((item) => item.id === id);
  if (!recording) throw new Error('录音不存在');
  recording.displayName = displayName;
  writeManifest(manifest);
  return { recording, manifest };
};

export const localDeleteRecordingById = async (id: string): Promise<RecordingsManifest> => {
  const manifest = readManifest();
  manifest.recordings = manifest.recordings.filter((item) => item.id !== id);
  await deleteBlob(id);
  writeManifest(manifest);
  return manifest;
};

export const localClearAllRecordings = async (): Promise<RecordingsManifest> => {
  await clearBlobs();
  const manifest = defaultManifest();
  writeManifest(manifest);
  return manifest;
};

export const localFetchRecordingBlob = async (id: string): Promise<Blob> => getBlob(id);