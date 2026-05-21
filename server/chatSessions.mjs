import fs from 'node:fs';

const MAX_SESSIONS = 200;
const MAX_MESSAGES_PER_SESSION = 500;
const ALLOWED_MODELS = new Set([
  'MiniMax-M2.7',
  'MiniMax-M2.7-highspeed',
  'MiniMax-M2.5',
  'MiniMax-M2.5-highspeed',
]);

/** @type {{ version: number; updatedAt: string; workspaceSeq: number; uiRevision: number; sessions: unknown[]; activeSessionId: string; chatModel: string }} */
let memoryPayload = {
  version: 3,
  updatedAt: '',
  workspaceSeq: 0,
  uiRevision: 0,
  sessions: [],
  activeSessionId: '',
  chatModel: 'MiniMax-M2.7',
};

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function sessionRevision(s) {
  const r = Number(s?.revision);
  if (Number.isFinite(r) && r > 0) return r;
  const t = Number(s?.updatedAt);
  return Number.isFinite(t) && t > 0 ? t : 0;
}

function sanitizeSessions(raw) {
  if (!Array.isArray(raw)) return [];
  const sessions = raw.slice(0, MAX_SESSIONS).map((s) => {
    if (!s || typeof s !== 'object') return null;
    const id = typeof s.id === 'string' ? s.id.slice(0, 80) : '';
    if (!id) return null;
    const messages = Array.isArray(s.messages)
      ? s.messages
          .slice(0, MAX_MESSAGES_PER_SESSION)
          .map((m) => {
            if (!m || typeof m !== 'object') return null;
            const role = m.role === 'user' || m.role === 'assistant' ? m.role : null;
            const content = typeof m.content === 'string' ? m.content.slice(0, 200_000) : '';
            if (!role || !content) return null;
            return {
              id: typeof m.id === 'string' ? m.id.slice(0, 80) : `${Date.now()}`,
              role,
              content,
              createdAt: Number(m.createdAt) || Date.now(),
            };
          })
          .filter(Boolean)
      : [];
    const updatedAt = Number(s.updatedAt) || Date.now();
    return {
      id,
      title: typeof s.title === 'string' ? s.title.slice(0, 120) : '新对话',
      messages,
      createdAt: Number(s.createdAt) || updatedAt,
      updatedAt,
      revision: sessionRevision({ ...s, updatedAt }),
    };
  }).filter(Boolean);
  return sessions;
}

function pickActiveSessionId(preferred, sessions) {
  const id = typeof preferred === 'string' ? preferred.slice(0, 80) : '';
  if (id && sessions.some((s) => s.id === id)) return id;
  return sessions[0]?.id ?? '';
}

function sanitizeModel(raw) {
  const model = typeof raw === 'string' ? raw.trim() : '';
  if (ALLOWED_MODELS.has(model)) return model;
  return 'MiniMax-M2.7';
}

function mergeMessageLists(a, b) {
  const byId = new Map();
  for (const m of a) byId.set(m.id, m);
  for (const m of b) byId.set(m.id, m);
  return [...byId.values()].sort((x, y) => x.createdAt - y.createdAt);
}

/** 同 id 会话：合并消息列表，避免后写入覆盖先写入 */
function mergeTwoSessions(stored, incoming) {
  const messages = mergeMessageLists(stored.messages, incoming.messages);
  const storedRev = sessionRevision(stored);
  const incomingRev = sessionRevision(incoming);
  const hadNewFromIncoming = incoming.messages.some((m) => !stored.messages.some((x) => x.id === m.id));
  const hadNewFromStored = stored.messages.some((m) => !incoming.messages.some((x) => x.id === m.id));
  return {
    id: stored.id,
    title: incomingRev >= storedRev ? incoming.title : stored.title,
    messages,
    createdAt: Math.min(stored.createdAt, incoming.createdAt),
    updatedAt: Math.max(stored.updatedAt, incoming.updatedAt, Date.now()),
    revision:
      Math.max(storedRev, incomingRev) + (hadNewFromIncoming && hadNewFromStored ? 1 : 0),
  };
}

function mergeSessionLists(stored, incoming) {
  const map = new Map();
  for (const s of stored) map.set(s.id, s);
  for (const s of incoming) {
    const prev = map.get(s.id);
    map.set(s.id, prev ? mergeTwoSessions(prev, s) : s);
  }
  return [...map.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

function normalizeWriteBody(body, storedSessions = []) {
  const incoming = sanitizeSessions(body?.sessions);
  const sessions =
    storedSessions.length > 0
      ? mergeSessionLists(sanitizeSessions(storedSessions), incoming)
      : incoming;
  const activeSessionId = pickActiveSessionId(body?.activeSessionId, sessions);
  const chatModel = sanitizeModel(body?.chatModel);
  const workspaceSeq = Math.max(0, Number(body?.workspaceSeq) || 0);
  const uiRevision = Math.max(0, Number(body?.uiRevision) || 0);
  return { sessions, activeSessionId, chatModel, workspaceSeq, uiRevision };
}

function toReadResponse(payload) {
  const sessions = sanitizeSessions(payload.sessions);
  return {
    sessions,
    revision: payload.updatedAt || '',
    workspaceSeq: Math.max(0, Number(payload.workspaceSeq) || 0),
    uiRevision: Math.max(0, Number(payload.uiRevision) || 0),
    activeSessionId: pickActiveSessionId(payload.activeSessionId, sessions),
    chatModel: sanitizeModel(payload.chatModel),
  };
}

function buildPayload(body) {
  const safeSessions = sanitizeSessions(body.sessions);
  return {
    version: 3,
    updatedAt: new Date().toISOString(),
    workspaceSeq: Math.max(0, Number(body.workspaceSeq) || 0),
    uiRevision: Math.max(0, Number(body.uiRevision) || 0),
    sessions: safeSessions,
    activeSessionId: pickActiveSessionId(body.activeSessionId, safeSessions),
    chatModel: sanitizeModel(body.chatModel),
  };
}

/** @param {string} filePath */
export function createFileChatStore(filePath) {
  const readRaw = () => {
    if (!fs.existsSync(filePath)) {
      return buildPayload({
        sessions: [],
        activeSessionId: '',
        chatModel: 'MiniMax-M2.7',
        workspaceSeq: 0,
        uiRevision: 0,
      });
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return buildPayload({
        sessions: parsed.sessions,
        activeSessionId: parsed.activeSessionId,
        chatModel: parsed.chatModel,
        workspaceSeq: parsed.workspaceSeq,
        uiRevision: parsed.uiRevision,
      });
    } catch {
      return buildPayload({
        sessions: [],
        activeSessionId: '',
        chatModel: 'MiniMax-M2.7',
        workspaceSeq: 0,
        uiRevision: 0,
      });
    }
  };

  return {
    read() {
      return toReadResponse(readRaw());
    },
    write(body) {
      const stored = sanitizeSessions(readRaw().sessions);
      const normalized = normalizeWriteBody(body, stored);
      const payload = buildPayload(normalized);
      ensureDir(filePath);
      fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
      return payload.updatedAt;
    },
    clear() {
      return this.write({
        sessions: [],
        activeSessionId: '',
        chatModel: 'MiniMax-M2.7',
        workspaceSeq: 0,
        uiRevision: 0,
      });
    },
  };
}

export function createMemoryChatStore() {
  return {
    read() {
      return toReadResponse(memoryPayload);
    },
    write(body) {
      const stored = sanitizeSessions(memoryPayload.sessions);
      const normalized = normalizeWriteBody(body, stored);
      memoryPayload = buildPayload(normalized);
      return memoryPayload.updatedAt;
    },
    clear() {
      return this.write({
        sessions: [],
        activeSessionId: '',
        chatModel: 'MiniMax-M2.7',
        workspaceSeq: 0,
        uiRevision: 0,
      });
    },
  };
}

/** @param {import('express').Router} router */
export function attachChatSessions(router, store) {
  router.get('/chat/sessions', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(store.read());
  });

  router.put('/chat/sessions', (req, res) => {
    const revision = store.write(req.body);
    const body = store.read();
    res.json({ ok: true, ...body, revision });
  });

  router.delete('/chat/sessions', (_req, res) => {
    const revision = store.clear();
    res.json({
      ok: true,
      sessions: [],
      activeSessionId: '',
      chatModel: 'MiniMax-M2.7',
      workspaceSeq: 0,
      uiRevision: 0,
      revision,
    });
  });
}
