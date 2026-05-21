/**
 * 知识问答多会话存储：优先 API 服务端（跨浏览器/刷新保留），无 API 时回退 localStorage
 */

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

const STORAGE_KEY = 'tools120-knowledge-chat-v1';

const trimSlash = (value: string) => value.replace(/\/$/, '');

export function resolveChatSessionsUrl(): string {
  const origin = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
  if (origin?.startsWith('http://') || origin?.startsWith('https://')) {
    return `${trimSlash(origin)}/api/chat/sessions`;
  }
  return '/api/chat/sessions';
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

async function fetchServerSessions(): Promise<ChatSession[] | null> {
  try {
    const res = await fetch(resolveChatSessionsUrl());
    if (!res.ok) return null;
    const data = (await res.json()) as { sessions?: ChatSession[] };
    return Array.isArray(data.sessions) ? data.sessions : [];
  } catch {
    return null;
  }
}

async function putServerSessions(sessions: ChatSession[]): Promise<boolean> {
  try {
    const res = await fetch(resolveChatSessionsUrl(), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessions }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** 从服务端加载；若服务端为空且本机有旧数据则迁移一次 */
export async function loadChatSessions(): Promise<ChatSession[]> {
  const server = await fetchServerSessions();
  if (server !== null) {
    if (server.length > 0) {
      saveLocalSessions(server);
      return server;
    }
    const local = loadLocalSessions();
    if (local.length > 0) {
      await putServerSessions(local);
      return local;
    }
    return [];
  }
  return loadLocalSessions();
}

export async function saveChatSessions(sessions: ChatSession[]): Promise<void> {
  saveLocalSessions(sessions);
  await putServerSessions(sessions);
}

/** 清空全部会话历史（服务端 + 本机缓存） */
export async function clearAllChatSessions(): Promise<void> {
  try {
    await fetch(resolveChatSessionsUrl(), { method: 'DELETE' });
  } catch {
    /* 无 API 时仅清本地 */
  }
  if (typeof window !== 'undefined') {
    localStorage.removeItem(STORAGE_KEY);
  }
}

export function deriveSessionTitle(firstUserText: string): string {
  const t = firstUserText.trim().replace(/\s+/g, ' ');
  if (!t) return '新对话';
  return t.length > 24 ? `${t.slice(0, 24)}…` : t;
}

export function createMessage(role: ChatRole, content: string): ChatMessage {
  return { id: newId(), role, content, createdAt: Date.now() };
}
