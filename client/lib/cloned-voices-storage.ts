'use client';

const STORAGE_KEY = 'tools120-cloned-voices-v1';

export type ClonedVoiceEntry = {
  voiceId: string;
  label: string;
  sourceName: string;
  createdAt: number;
};

export function loadClonedVoices(): ClonedVoiceEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ClonedVoiceEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveClonedVoice(entry: ClonedVoiceEntry): void {
  const list = loadClonedVoices().filter((v) => v.voiceId !== entry.voiceId);
  list.unshift(entry);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, 50)));
}

export function removeClonedVoice(voiceId: string): void {
  const list = loadClonedVoices().filter((v) => v.voiceId !== voiceId);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}
