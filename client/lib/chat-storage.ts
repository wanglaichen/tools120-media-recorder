/**
 * 知识问答多会话本地存储（localStorage）
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

export function loadChatSessions(): ChatSession[] {
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

export function saveChatSessions(sessions: ChatSession[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
}

export function deriveSessionTitle(firstUserText: string): string {
  const t = firstUserText.trim().replace(/\s+/g, ' ');
  if (!t) return '新对话';
  return t.length > 24 ? `${t.slice(0, 24)}…` : t;
}

export function createMessage(role: ChatRole, content: string): ChatMessage {
  return { id: newId(), role, content, createdAt: Date.now() };
}
