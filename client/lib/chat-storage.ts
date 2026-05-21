/**
 * 知识问答工作台：会话 revision + workspaceSeq 合并，避免轮询覆盖新建对话
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
  /** 会话内容版本，每次改标题/消息递增；合并时取较大者 */
  revision: number;
}

export type ChatStorageMode = 'server' | 'local';

export type ChatWorkspaceSnapshot = {
  sessions: ChatSession[];
  activeSessionId: string;
  chatModel: ChatModel;
  /** 服务端时间戳 revision，仅用于轮询是否变化 */
  revision: string;
  /** 工作台整体写入序号（客户端递增） */
  workspaceSeq: number;
  /** 选中会话 / 模型变更序号 */
  uiRevision: number;
  mode: ChatStorageMode;
};

export type ChatWorkspacePayload = {
  sessions: ChatSession[];
  activeSessionId: string;
  chatModel: ChatModel;
  workspaceSeq: number;
  uiRevision: number;
};

const STORAGE_KEY = 'tools120-knowledge-chat-v1';
const META_KEY = 'tools120-knowledge-chat-meta-v2';
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

export function sessionRevision(s: ChatSession): number {
  if (Number.isFinite(s.revision) && s.revision > 0) return s.revision;
  return s.updatedAt || 0;
}

export function bumpSession(session: ChatSession): ChatSession {
  const now = Date.now();
  const nextRev = sessionRevision(session) + 1;
  return { ...session, updatedAt: now, revision: nextRev };
}

export function normalizeSession(raw: ChatSession): ChatSession {
  const updatedAt = raw.updatedAt || Date.now();
  return {
    ...raw,
    createdAt: raw.createdAt || updatedAt,
    updatedAt,
    revision: sessionRevision(raw) || updatedAt,
  };
}

/** 同一会话：按消息 id 合并，保留双方各自发送的内容（解决双浏览器同时提交） */
export function mergeSessionMessages(
  local: ChatSession,
  remote: ChatSession,
): { session: ChatSession; mergedFromPeer: boolean } {
  const a = normalizeSession(local);
  const b = normalizeSession(remote);
  const byId = new Map<string, ChatMessage>();
  for (const m of a.messages) byId.set(m.id, m);
  let mergedFromPeer = false;
  for (const m of b.messages) {
    if (!byId.has(m.id)) mergedFromPeer = true;
    byId.set(m.id, m);
  }
  const messages = [...byId.values()].sort((x, y) => x.createdAt - y.createdAt);
  const localRev = sessionRevision(a);
  const remoteRev = sessionRevision(b);
  const title =
    localRev >= remoteRev
      ? a.title
      : b.title.length > 0
        ? b.title
        : a.title;
  const updatedAt = Math.max(a.updatedAt, b.updatedAt, Date.now());
  const revision = Math.max(localRev, remoteRev) + (mergedFromPeer ? 1 : 0);
  return {
    session: {
      ...a,
      title,
      messages,
      updatedAt,
      revision,
    },
    mergedFromPeer,
  };
}

/** 工作台合并：同 id 会话走消息级合并，而非整段覆盖 */
export function mergeChatWorkspace(
  local: ChatWorkspacePayload,
  remote: ChatWorkspaceSnapshot,
): { merged: ChatWorkspacePayload; localWins: boolean } {
  const map = new Map<string, ChatSession>();
  const allIds = new Set<string>();
  for (const s of remote.sessions) allIds.add(s.id);
  for (const s of local.sessions) allIds.add(s.id);

  let localWins = false;
  for (const id of allIds) {
    const localS = local.sessions.find((s) => s.id === id);
    const remoteS = remote.sessions.find((s) => s.id === id);
    if (localS && remoteS) {
      const { session, mergedFromPeer } = mergeSessionMessages(localS, remoteS);
      map.set(id, session);
      if (mergedFromPeer || sessionRevision(localS) > sessionRevision(remoteS)) {
        localWins = true;
      }
    } else if (localS) {
      map.set(id, normalizeSession(localS));
      localWins = true;
    } else if (remoteS) {
      map.set(id, normalizeSession(remoteS));
    }
  }

  const sessions = [...map.values()].sort((a, b) => b.updatedAt - a.updatedAt);

  const localUi = local.uiRevision ?? 0;
  const remoteUi = remote.uiRevision ?? 0;
  const localSeq = local.workspaceSeq ?? 0;
  const remoteSeq = remote.workspaceSeq ?? 0;

  let activeSessionId = pickActiveSessionId(remote.activeSessionId, sessions);
  let chatModel = remote.chatModel;

  if (localUi > remoteUi) {
    activeSessionId = pickActiveSessionId(local.activeSessionId, sessions);
    chatModel = local.chatModel;
    localWins = true;
  } else if (localSeq > remoteSeq) {
    activeSessionId = pickActiveSessionId(local.activeSessionId, sessions);
    chatModel = local.chatModel;
    localWins = true;
  }

  return {
    merged: {
      sessions,
      activeSessionId,
      chatModel,
      workspaceSeq: Math.max(localSeq, remoteSeq),
      uiRevision: Math.max(localUi, remoteUi),
    },
    localWins,
  };
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
    revision: now,
  };
}

function loadLocalSessions(): ChatSession[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ChatSession[];
    return Array.isArray(parsed) ? parsed.map(normalizeSession) : [];
  } catch {
    return [];
  }
}

function saveLocalSessions(sessions: ChatSession[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
}

function loadLocalMeta(): Omit<ChatWorkspacePayload, 'sessions'> {
  if (typeof window === 'undefined') {
    return {
      activeSessionId: '',
      chatModel: DEFAULT_MODEL,
      workspaceSeq: 0,
      uiRevision: 0,
    };
  }
  try {
    const raw = localStorage.getItem(META_KEY);
    if (!raw) {
      return {
        activeSessionId: '',
        chatModel: DEFAULT_MODEL,
        workspaceSeq: 0,
        uiRevision: 0,
      };
    }
    const parsed = JSON.parse(raw) as {
      activeSessionId?: string;
      chatModel?: string;
      workspaceSeq?: number;
      uiRevision?: number;
    };
    return {
      activeSessionId:
        typeof parsed.activeSessionId === 'string' ? parsed.activeSessionId : '',
      chatModel: normalizeModel(parsed.chatModel),
      workspaceSeq: Number(parsed.workspaceSeq) || 0,
      uiRevision: Number(parsed.uiRevision) || 0,
    };
  } catch {
    return {
      activeSessionId: '',
      chatModel: DEFAULT_MODEL,
      workspaceSeq: 0,
      uiRevision: 0,
    };
  }
}

function saveLocalMeta(payload: Omit<ChatWorkspacePayload, 'sessions'>): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(META_KEY, JSON.stringify(payload));
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
  workspaceSeq?: number;
  uiRevision?: number;
}): ChatWorkspaceSnapshot {
  const sessions = Array.isArray(data.sessions)
    ? data.sessions.map(normalizeSession)
    : [];
  const activeSessionId = pickActiveSessionId(
    typeof data.activeSessionId === 'string' ? data.activeSessionId : '',
    sessions,
  );
  return {
    sessions,
    activeSessionId,
    chatModel: normalizeModel(data.chatModel),
    revision: typeof data.revision === 'string' ? data.revision : '',
    workspaceSeq: Number(data.workspaceSeq) || 0,
    uiRevision: Number(data.uiRevision) || 0,
    mode: 'server',
  };
}

function saveLocalWorkspace(payload: ChatWorkspacePayload): void {
  saveLocalSessions(payload.sessions);
  saveLocalMeta({
    activeSessionId: payload.activeSessionId,
    chatModel: payload.chatModel,
    workspaceSeq: payload.workspaceSeq,
    uiRevision: payload.uiRevision,
  });
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

/** 发送前拉取服务端最新工作台（用于与当前会话合并） */
export async function fetchChatWorkspaceRemote(): Promise<ChatWorkspaceSnapshot | null> {
  return fetchServerSnapshot();
}

/**
 * 发送消息前：若服务端该会话有别人新增的消息，先合并再返回用于提交的会话
 */
export async function mergeSessionWithRemoteBeforeSend(
  localSession: ChatSession,
): Promise<{ session: ChatSession; hadRemoteUpdates: boolean }> {
  const remote = await fetchServerSnapshot();
  if (!remote) {
    return { session: normalizeSession(localSession), hadRemoteUpdates: false };
  }
  const remoteSession = remote.sessions.find((s) => s.id === localSession.id);
  if (!remoteSession) {
    return { session: normalizeSession(localSession), hadRemoteUpdates: false };
  }
  const { session, mergedFromPeer } = mergeSessionMessages(localSession, remoteSession);
  return { session, hadRemoteUpdates: mergedFromPeer };
}

async function fetchServerSnapshot(): Promise<ChatWorkspaceSnapshot | null> {
  const hit = await fetchFirstOk((url) => ({ method: 'GET', cache: 'no-store' }));
  if (!hit) return null;
  try {
    const data = (await hit.res.json()) as Record<string, unknown>;
    return parseApiPayload(data as Parameters<typeof parseApiPayload>[0]);
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
    const data = (await hit.res.json()) as Record<string, unknown>;
    return parseApiPayload(data as Parameters<typeof parseApiPayload>[0]);
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
    workspaceSeq: meta.workspaceSeq,
    uiRevision: meta.uiRevision,
    revision: loadLocalRevision(),
    mode: 'local',
  };
}

export const loadChatSessions = loadChatWorkspace;

export async function loadChatWorkspace(): Promise<ChatWorkspaceSnapshot> {
  const server = await fetchServerSnapshot();
  if (server !== null) {
    if (server.sessions.length > 0) {
      saveLocalWorkspace({
        sessions: server.sessions,
        activeSessionId: server.activeSessionId,
        chatModel: server.chatModel,
        workspaceSeq: server.workspaceSeq,
        uiRevision: server.uiRevision,
      });
      saveLocalRevision(server.revision);
      return server;
    }
    const local = localWorkspaceSnapshot();
    if (local.sessions.length > 0) {
      const saved = await putServerWorkspace({
        sessions: local.sessions,
        activeSessionId: local.activeSessionId,
        chatModel: local.chatModel,
        workspaceSeq: local.workspaceSeq,
        uiRevision: local.uiRevision,
      });
      if (saved) {
        saveLocalWorkspace({
          sessions: saved.sessions,
          activeSessionId: saved.activeSessionId,
          chatModel: saved.chatModel,
          workspaceSeq: saved.workspaceSeq,
          uiRevision: saved.uiRevision,
        });
        saveLocalRevision(saved.revision);
        return saved;
      }
      return local;
    }
    return server;
  }
  return localWorkspaceSnapshot();
}

export type PollMergeResult = {
  remote: ChatWorkspaceSnapshot;
  merged: ChatWorkspacePayload;
  localWins: boolean;
};

/** 拉取远端并用 revision 合并，避免旧数据覆盖本地新会话 */
export async function pollChatWorkspace(
  revision: string,
  local: ChatWorkspacePayload,
): Promise<PollMergeResult | null> {
  const remote = await fetchServerSnapshot();
  if (!remote) return null;
  if (remote.revision && remote.revision === revision) return null;
  const { merged, localWins } = mergeChatWorkspace(local, remote);
  return { remote, merged, localWins };
}

export const saveChatSessions = saveChatWorkspace;

export async function saveChatWorkspace(
  payload: ChatWorkspacePayload,
): Promise<ChatWorkspaceSnapshot> {
  const normalized: ChatWorkspacePayload = {
    sessions: payload.sessions.map(normalizeSession),
    activeSessionId: pickActiveSessionId(payload.activeSessionId, payload.sessions),
    chatModel: payload.chatModel,
    workspaceSeq: payload.workspaceSeq ?? 0,
    uiRevision: payload.uiRevision ?? 0,
  };
  saveLocalWorkspace(normalized);
  const saved = await putServerWorkspace(normalized);
  if (saved) {
    saveLocalRevision(saved.revision);
    return saved;
  }
  const hadServerRevision = Boolean(loadLocalRevision());
  const meta = loadLocalMeta();
  return {
    sessions: normalized.sessions,
    activeSessionId: normalized.activeSessionId,
    chatModel: normalized.chatModel,
    workspaceSeq: normalized.workspaceSeq,
    uiRevision: normalized.uiRevision,
    revision: loadLocalRevision(),
    mode: hadServerRevision ? 'server' : 'local',
  };
}

export async function clearAllChatSessions(): Promise<ChatWorkspaceSnapshot> {
  const hit = await fetchFirstOk((url) => ({ method: 'DELETE' }));
  if (hit) {
    try {
      const data = (await hit.res.json()) as Record<string, unknown>;
      const snapshot = parseApiPayload({
        ...(data as object),
        sessions: [],
      });
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
    workspaceSeq: 0,
    uiRevision: 0,
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
