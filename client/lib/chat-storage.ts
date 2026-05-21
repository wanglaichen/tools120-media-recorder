/**
 * 知识问答工作台：会话列表 + 当前选中会话 + 模型，服务端同步（跨浏览器）
 */

import type { ChatModel } from '@/lib/minimax';

export type ChatRole = 'user' | 'assistant';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: number;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

export type ChatStorageMode = 'server' | 'local';

export type ChatWorkspaceSnapshot = {
  sessions: ChatSession[];
  activeSessionId: string;
  chatModel: ChatModel;
  revision: string;
  mode: ChatStorageMode;
};

export type ChatWorkspacePayload = {
  sessions: ChatSession[];
  activeSessionId: string;
  chatModel: ChatModel;
};

const STORAGE_KEY = 'tools120-knowledge-chat-v1';
const META_KEY = 'tools120-knowledge-chat-meta-v1';
const POLL_REVISION_KEY = 'tools120-knowledge-chat-revision';

const DEFAULT_MODEL: ChatModel = 'MiniMax-M2.7';

const trimSlash = (value: string) => value.replace(/\/$/, '');

export function resolveChatSessionsCandidates(): string[] {
  const candidates: string[] = [];
  if (typeof window !== 'undefined') {
    candidates.push(`${window.location.origin}/api/chat/sessions`);
  }
  const apiOrigin = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
  if (apiOrigin?.startsWith('http://') || apiOrigin?.startsWith('https://')) {
    const direct = `${trimSlash(apiOrigin)}/api/chat/sessions`;
    if (!candidates.includes(direct)) candidates.push(direct);
  }
  if (!candidates.includes('/api/chat/sessions')) {
    candidates.push('/api/chat/sessions');
  }
  return candidates;
}

export function resolveChatSessionsUrl(): string {
  return resolveChatSessionsCandidates()[0] ?? '/api/chat/sessions';
}

export function pickActiveSessionId(
  preferred: string,
  sessions: ChatSession[],
): string {
  if (preferred && sessions.some((s) => s.id === preferred)) return preferred;
  return sessions[0]?.id ?? '';
}

function normalizeModel(raw: unknown): ChatModel {
  const allowed: ChatModel[] = [
    'MiniMax-M2.7',
    'MiniMax-M2.7-highspeed',
    'MiniMax-M2.5',
    'MiniMax-M2.5-highspeed',
  ];
  if (typeof raw === 'string' && allowed.includes(raw as ChatModel)) {
    return raw as ChatModel;
  }
  return DEFAULT_MODEL;
}

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function createEmptySession(): ChatSession {
  const now = Date.now();
  return {
    id: newId(),
    title: '新对话',
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
}

function loadLocalSessions(): ChatSession[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ChatSession[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveLocalSessions(sessions: ChatSession[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
}

function loadLocalMeta(): Pick<ChatWorkspacePayload, 'activeSessionId' | 'chatModel'> {
  if (typeof window === 'undefined') {
    return { activeSessionId: '', chatModel: DEFAULT_MODEL };
  }
  try {
    const raw = localStorage.getItem(META_KEY);
    if (!raw) return { activeSessionId: '', chatModel: DEFAULT_MODEL };
    const parsed = JSON.parse(raw) as {
      activeSessionId?: string;
      chatModel?: string;
    };
    return {
      activeSessionId: typeof parsed.activeSessionId === 'string' ? parsed.activeSessionId : '',
      chatModel: normalizeModel(parsed.chatModel),
    };
  } catch {
    return { activeSessionId: '', chatModel: DEFAULT_MODEL };
  }
}

function saveLocalMeta(activeSessionId: string, chatModel: ChatModel): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(
    META_KEY,
    JSON.stringify({ activeSessionId, chatModel }),
  );
}

function loadLocalRevision(): string {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem(POLL_REVISION_KEY) || '';
}

function saveLocalRevision(revision: string): void {
  if (typeof window === 'undefined') return;
  if (revision) localStorage.setItem(POLL_REVISION_KEY, revision);
  else localStorage.removeItem(POLL_REVISION_KEY);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseApiPayload(data: {
  sessions?: ChatSession[];
  revision?: string;
  activeSessionId?: string;
  chatModel?: string;
}): ChatWorkspaceSnapshot {
  const sessions = Array.isArray(data.sessions) ? data.sessions : [];
  const activeSessionId = pickActiveSessionId(
    typeof data.activeSessionId === 'string' ? data.activeSessionId : '',
    sessions,
  );
  return {
    sessions,
    activeSessionId,
    chatModel: normalizeModel(data.chatModel),
    revision: typeof data.revision === 'string' ? data.revision : '',
    mode: 'server',
  };
}

function saveLocalWorkspace(payload: ChatWorkspacePayload): void {
  saveLocalSessions(payload.sessions);
  saveLocalMeta(payload.activeSessionId, payload.chatModel);
}

async function fetchFirstOk(
  build: (url: string) => RequestInit & { method?: string },
): Promise<{ res: Response; url: string } | null> {
  const candidates = resolveChatSessionsCandidates();
  for (const url of candidates) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const init = build(url);
        const res = await fetch(url, init);
        if (res.ok) return { res, url };
      } catch {
        /* retry */
      }
      if (attempt === 0) await sleep(280);
    }
  }
  return null;
}

async function fetchServerSnapshot(): Promise<ChatWorkspaceSnapshot | null> {
  const hit = await fetchFirstOk((url) => ({ method: 'GET', cache: 'no-store' }));
  if (!hit) return null;
  try {
    const data = (await hit.res.json()) as {
      sessions?: ChatSession[];
      revision?: string;
      activeSessionId?: string;
      chatModel?: string;
    };
    return parseApiPayload(data);
  } catch {
    return null;
  }
}

async function putServerWorkspace(
  payload: ChatWorkspacePayload,
): Promise<ChatWorkspaceSnapshot | null> {
  const hit = await fetchFirstOk((url) => ({
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }));
  if (!hit) return null;
  try {
    const data = (await hit.res.json()) as {
      sessions?: ChatSession[];
      revision?: string;
      activeSessionId?: string;
      chatModel?: string;
    };
    return parseApiPayload(data);
  } catch {
    return null;
  }
}

function localWorkspaceSnapshot(): ChatWorkspaceSnapshot {
  const sessions = loadLocalSessions();
  const meta = loadLocalMeta();
  return {
    sessions,
    activeSessionId: pickActiveSessionId(meta.activeSessionId, sessions),
    chatModel: meta.chatModel,
    revision: loadLocalRevision(),
    mode: 'local',
  };
}

/** @deprecated 使用 loadChatWorkspace */
export const loadChatSessions = loadChatWorkspace;

export async function loadChatWorkspace(): Promise<ChatWorkspaceSnapshot> {
  const server = await fetchServerSnapshot();
  if (server !== null) {
    if (server.sessions.length > 0) {
      saveLocalWorkspace(server);
      saveLocalRevision(server.revision);
      return server;
    }
    const local = localWorkspaceSnapshot();
    if (local.sessions.length > 0) {
      const saved = await putServerWorkspace({
        sessions: local.sessions,
        activeSessionId: local.activeSessionId,
        chatModel: local.chatModel,
      });
      if (saved) {
        saveLocalWorkspace(saved);
        saveLocalRevision(saved.revision);
        return saved;
      }
      return local;
    }
    return server;
  }
  return localWorkspaceSnapshot();
}

/** @deprecated 使用 pollChatWorkspace */
export const pollChatSessions = pollChatWorkspace;

export async function pollChatWorkspace(
  revision: string,
): Promise<ChatWorkspaceSnapshot | null> {
  const server = await fetchServerSnapshot();
  if (!server) return null;
  if (server.revision && server.revision === revision) return null;
  saveLocalWorkspace(server);
  saveLocalRevision(server.revision);
  return server;
}

/** @deprecated 使用 saveChatWorkspace */
export const saveChatSessions = saveChatWorkspace;

export async function saveChatWorkspace(
  payload: ChatWorkspacePayload,
): Promise<ChatWorkspaceSnapshot> {
  const normalized: ChatWorkspacePayload = {
    sessions: payload.sessions,
    activeSessionId: pickActiveSessionId(payload.activeSessionId, payload.sessions),
    chatModel: payload.chatModel,
  };
  saveLocalWorkspace(normalized);
  const saved = await putServerWorkspace(normalized);
  if (saved) {
    saveLocalRevision(saved.revision);
    return saved;
  }
  const hadServerRevision = Boolean(loadLocalRevision());
  return {
    ...normalized,
    revision: loadLocalRevision(),
    mode: hadServerRevision ? 'server' : 'local',
  };
}

export async function clearAllChatSessions(): Promise<ChatWorkspaceSnapshot> {
  const hit = await fetchFirstOk((url) => ({ method: 'DELETE' }));
  if (hit) {
    try {
      const data = (await hit.res.json()) as {
        revision?: string;
        activeSessionId?: string;
        chatModel?: string;
      };
      const snapshot = parseApiPayload({ ...data, sessions: [] });
      if (typeof window !== 'undefined') {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(META_KEY);
        saveLocalRevision(snapshot.revision);
      }
      return snapshot;
    } catch {
      /* fall through */
    }
  }
  if (typeof window !== 'undefined') {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(META_KEY);
    localStorage.removeItem(POLL_REVISION_KEY);
  }
  return {
    sessions: [],
    activeSessionId: '',
    chatModel: DEFAULT_MODEL,
    revision: '',
    mode: 'local',
  };
}

export async function probeChatApi(): Promise<boolean> {
  return (await fetchServerSnapshot()) !== null;
}

export function deriveSessionTitle(firstUserText: string): string {
  const t = firstUserText.trim().replace(/\s+/g, ' ');
  if (!t) return '新对话';
  return t.length > 24 ? `${t.slice(0, 24)}…` : t;
}

export function createMessage(role: ChatRole, content: string): ChatMessage {
  return { id: newId(), role, content, createdAt: Date.now() };
}
