/**
 * 知识问答工作台：以 Q&A pair 为原子同步单元
 *
 * 工作机制：
 * 1. 每次发送消息 → 把 [user msg + assistant msg] 两个消息打包成一个 pair 提交到服务器
 * 2. 服务器按 pairSeq 自增排序，多端不会覆盖
 * 3. 冲突检测：提交时带上 clientCurrentSeq，服务端若已更大说明别人抢先 → 返回 newPairs，客户端合并显示
 * 4. 页面加载 → 从服务器拉取完整历史，按 pairSeq 排序后渲染
 */

import type { ChatModel } from '@/lib/minimax';

export type ChatRole = 'user' | 'assistant';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
  currentSeq: number;
}

export interface QAPair {
  id: string;          // pair 唯一 id，格式 "p-{ts}-{rand}"
  pairSeq: number;    // 自增序号，用于排序
  pairCreatedAt: number;
  user: ChatMessage;
  assistant: ChatMessage;
}

export type ChatStorageMode = 'server' | 'local';

export interface ChatWorkspaceSnapshot {
  sessions: ChatSession[];
  activeSessionId: string;
  chatModel: ChatModel;
  revision: string;
  workspaceSeq: number;
  uiRevision: number;
  mode: ChatStorageMode;
}

export interface ChatWorkspacePayload {
  sessionId: string;
  pairs: QAPair[];
  title?: string;
  chatModel: ChatModel;
  baseSeq: number;   // 客户端知道的最新 seq，发送时带上，用于冲突检测
  workspaceSeq: number;
  uiRevision: number;
  activeSessionId?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'tools120-knowledge-chat-v1';
const META_KEY = 'tools120-knowledge-chat-meta-v2';
const DEFAULT_MODEL: ChatModel = 'MiniMax-M2.7';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function trimSlash(value: string): string {
  return value.replace(/\/$/, '');
}

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

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

// ---------------------------------------------------------------------------
// Local persistence
// ---------------------------------------------------------------------------

function loadLocalSessions(): ChatSession[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ChatSession[]) : [];
  } catch {
    return [];
  }
}

function saveLocalSessions(sessions: ChatSession[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
}

function loadLocalMeta(): Omit<ChatWorkspaceSnapshot, 'sessions' | 'revision' | 'mode'> {
  if (typeof window === 'undefined') {
    return { activeSessionId: '', chatModel: DEFAULT_MODEL, workspaceSeq: 0, uiRevision: 0 };
  }
  try {
    const raw = localStorage.getItem(META_KEY);
    if (!raw) return { activeSessionId: '', chatModel: DEFAULT_MODEL, workspaceSeq: 0, uiRevision: 0 };
    const p = JSON.parse(raw);
    return {
      activeSessionId: String(p.activeSessionId ?? ''),
      chatModel: (p.chatModel ?? DEFAULT_MODEL) as ChatModel,
      workspaceSeq: Number(p.workspaceSeq) || 0,
      uiRevision: Number(p.uiRevision) || 0,
    };
  } catch {
    return { activeSessionId: '', chatModel: DEFAULT_MODEL, workspaceSeq: 0, uiRevision: 0 };
  }
}

function saveLocalMeta(meta: Omit<ChatWorkspaceSnapshot, 'sessions' | 'revision' | 'mode'>): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(META_KEY, JSON.stringify(meta));
}

// ---------------------------------------------------------------------------
// API fetch helpers
// ---------------------------------------------------------------------------

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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
      } catch { /* retry */ }
      if (attempt === 0) await sleep(280);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Core API calls
// ---------------------------------------------------------------------------

interface ServerSnapshot extends ChatWorkspaceSnapshot {
  newPairs?: QAPair[];
  conflict?: boolean;
  currentSeq?: number;
}

async function fetchServerSnapshot(): Promise<ServerSnapshot | null> {
  const hit = await fetchFirstOk((url) => ({ method: 'GET', cache: 'no-store' }));
  if (!hit) return null;
  try {
    const data = await hit.res.json() as Record<string, unknown>;
    return {
      sessions: (data.sessions as ChatSession[]) ?? [],
      activeSessionId: String(data.activeSessionId ?? ''),
      chatModel: (data.chatModel as ChatModel) ?? DEFAULT_MODEL,
      revision: String(data.updatedAt ?? ''),
      workspaceSeq: Number(data.workspaceSeq) || 0,
      uiRevision: Number(data.uiRevision) || 0,
      mode: 'server',
    };
  } catch {
    return null;
  }
}

async function putServerWorkspace(payload: ChatWorkspacePayload): Promise<ServerSnapshot | null> {
  const hit = await fetchFirstOk((url) => ({
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }));
  if (!hit) return null;
  try {
    const data = await hit.res.json() as Record<string, unknown>;
    return {
      sessions: (data.sessions as ChatSession[]) ?? [],
      activeSessionId: String(data.activeSessionId ?? ''),
      chatModel: (data.chatModel as ChatModel) ?? DEFAULT_MODEL,
      revision: String(data.updatedAt ?? ''),
      workspaceSeq: Number(data.workspaceSeq) || 0,
      uiRevision: Number(data.uiRevision) || 0,
      newPairs: (data.newPairs as QAPair[]) ?? [],
      conflict: Boolean(data.conflict),
      currentSeq: Number(data.currentSeq) || 0,
      mode: 'server',
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Session helpers
// ---------------------------------------------------------------------------

export function pickActiveSessionId(preferred: string, sessions: ChatSession[]): string {
  if (preferred && sessions.some((s) => s.id === preferred)) return preferred;
  return sessions[0]?.id ?? '';
}

export function createEmptySession(): ChatSession {
  const now = Date.now();
  return {
    id: newId(),
    title: '新对话',
    messages: [],
    createdAt: now,
    updatedAt: now,
    currentSeq: 0,
  };
}

export function createMessage(role: ChatRole, content: string): ChatMessage {
  return { id: newId(), role, content, createdAt: Date.now() };
}

export function createQAPair(userMsg: ChatMessage, assistantMsg: ChatMessage, seq: number): QAPair {
  return {
    id: newId(),
    pairSeq: seq + 1,
    pairCreatedAt: Date.now(),
    user: userMsg,
    assistant: assistantMsg,
  };
}

// ---------------------------------------------------------------------------
// Main load/save
// ---------------------------------------------------------------------------

export async function loadChatWorkspace(): Promise<ChatWorkspaceSnapshot> {
  const server = await fetchServerSnapshot();
  if (server && server.sessions.length > 0) {
    saveLocalSessions(server.sessions);
    saveLocalMeta({
      activeSessionId: pickActiveSessionId(server.activeSessionId, server.sessions),
      chatModel: server.chatModel,
      workspaceSeq: server.workspaceSeq,
      uiRevision: server.uiRevision,
    });
    return server;
  }

  const localSessions = loadLocalSessions();
  const localMeta = loadLocalMeta();
  if (localSessions.length > 0) {
    return {
      sessions: localSessions,
      activeSessionId: pickActiveSessionId(localMeta.activeSessionId, localSessions),
      chatModel: localMeta.chatModel,
      revision: '',
      workspaceSeq: localMeta.workspaceSeq,
      uiRevision: localMeta.uiRevision,
      mode: 'local',
    };
  }

  return {
    sessions: [],
    activeSessionId: '',
    chatModel: DEFAULT_MODEL,
    revision: '',
    workspaceSeq: 0,
    uiRevision: 0,
    mode: 'local',
  };
}

/**
 * 保存工作台：带上 baseSeq 检测冲突
 * 若 conflict=true，服务端会返回 newPairs（别人抢先插入的）
 */
export async function saveChatWorkspace(
  sessionId: string,
  pairs: QAPair[],
  baseSeq: number,
  opts?: {
    title?: string;
    chatModel?: ChatModel;
    activeSessionId?: string;
    workspaceSeq?: number;
    uiRevision?: number;
  },
): Promise<{
  snapshot: ChatWorkspaceSnapshot;
  newPairs: QAPair[];
  conflict: boolean;
  currentSeq: number;
}> {
  const payload: ChatWorkspacePayload = {
    sessionId,
    pairs,
    title: opts?.title,
    chatModel: opts?.chatModel ?? DEFAULT_MODEL,
    baseSeq,
    workspaceSeq: opts?.workspaceSeq ?? 0,
    uiRevision: opts?.uiRevision ?? 0,
    activeSessionId: opts?.activeSessionId,
  };

  const saved = await putServerWorkspace(payload);

  if (saved) {
    saveLocalSessions(saved.sessions);
    saveLocalMeta({
      activeSessionId: pickActiveSessionId(saved.activeSessionId, saved.sessions),
      chatModel: saved.chatModel,
      workspaceSeq: saved.workspaceSeq,
      uiRevision: saved.uiRevision,
    });
    return {
      snapshot: saved,
      newPairs: saved.newPairs ?? [],
      conflict: saved.conflict ?? false,
      currentSeq: saved.currentSeq ?? baseSeq,
    };
  }

  // Server unreachable — keep local only
  const localSessions = loadLocalSessions();
  const localMeta = loadLocalMeta();
  const mode = localMeta.activeSessionId ? 'local' : 'local';
  return {
    snapshot: {
      sessions: localSessions,
      activeSessionId: localMeta.activeSessionId,
      chatModel: localMeta.chatModel,
      revision: '',
      workspaceSeq: localMeta.workspaceSeq,
      uiRevision: localMeta.uiRevision,
      mode,
    },
    newPairs: [],
    conflict: false,
    currentSeq: baseSeq,
  };
}

export async function clearAllChatSessions(): Promise<ChatWorkspaceSnapshot> {
  const hit = await fetchFirstOk((url) => ({ method: 'DELETE', url }));
  if (hit) {
    try {
      const data = await hit.res.json() as Record<string, unknown>;
      const snapshot: ChatWorkspaceSnapshot = {
        sessions: (data.sessions as ChatSession[]) ?? [],
        activeSessionId: '',
        chatModel: DEFAULT_MODEL,
        revision: '',
        workspaceSeq: 0,
        uiRevision: 0,
        mode: 'server',
      };
      if (typeof window !== 'undefined') {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(META_KEY);
      }
      return snapshot;
    } catch { /* fall through */ }
  }
  if (typeof window !== 'undefined') {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(META_KEY);
  }
  return {
    sessions: [],
    activeSessionId: '',
    chatModel: DEFAULT_MODEL,
    revision: '',
    workspaceSeq: 0,
    uiRevision: 0,
    mode: 'local',
  };
}

export function deriveSessionTitle(firstUserText: string): string {
  const t = firstUserText.trim().replace(/\s+/g, ' ');
  if (!t) return '新对话';
  return t.length > 24 ? `${t.slice(0, 24)}…` : t;
}

export async function probeChatApi(): Promise<boolean> {
  return (await fetchServerSnapshot()) !== null;
}

/**
 * Merge incoming Q&A pairs into a session.
 * Incoming pairs from the server (conflict response) are newer — prepend them
 * to the session messages keeping proper time order.
 */
export function mergePairsIntoSession(
  session: ChatSession,
  incomingPairs: QAPair[],
): ChatSession {
  if (!incomingPairs.length) return session;

  const existingIds = new Set(session.messages.map((m) => m.id));
  const newMessages: ChatMessage[] = [];

  for (const pair of incomingPairs) {
    if (!existingIds.has(pair.user.id)) newMessages.push(pair.user);
    if (!existingIds.has(pair.assistant.id)) newMessages.push(pair.assistant);
  }

  return {
    ...session,
    messages: [...session.messages, ...newMessages].sort((a, b) => a.createdAt - b.createdAt),
    updatedAt: Date.now(),
  };
}