import fs from 'node:fs';

const MAX_SESSIONS = 200;
const MAX_MESSAGES_PER_SESSION = 500;
const ALLOWED_MODELS = new Set([
  'MiniMax-M2.7',
  'MiniMax-M2.7-highspeed',
  'MiniMax-M2.5',
  'MiniMax-M2.5-highspeed',
]);

/** @type {{ version: number; updatedAt: string; sessions: unknown[]; activeSessionId: string; chatModel: string }} */
let memoryPayload = {
  version: 2,
  updatedAt: '',
  sessions: [],
  activeSessionId: '',
  chatModel: 'MiniMax-M2.7',
};

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
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
    return {
      id,
      title: typeof s.title === 'string' ? s.title.slice(0, 120) : '新对话',
      messages,
      createdAt: Number(s.createdAt) || Date.now(),
      updatedAt: Number(s.updatedAt) || Date.now(),
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

function normalizeWriteBody(body) {
  const sessions = sanitizeSessions(body?.sessions);
  const activeSessionId = pickActiveSessionId(body?.activeSessionId, sessions);
  const chatModel = sanitizeModel(body?.chatModel);
  return { sessions, activeSessionId, chatModel };
}

function toReadResponse(payload) {
  const sessions = sanitizeSessions(payload.sessions);
  return {
    sessions,
    revision: payload.updatedAt || '',
    activeSessionId: pickActiveSessionId(payload.activeSessionId, sessions),
    chatModel: sanitizeModel(payload.chatModel),
  };
}

function buildPayload({ sessions, activeSessionId, chatModel }) {
  const safeSessions = sanitizeSessions(sessions);
  return {
    version: 2,
    updatedAt: new Date().toISOString(),
    sessions: safeSessions,
    activeSessionId: pickActiveSessionId(activeSessionId, safeSessions),
    chatModel: sanitizeModel(chatModel),
  };
}

/** @param {string} filePath */
export function createFileChatStore(filePath) {
  const readRaw = () => {
    if (!fs.existsSync(filePath)) {
      return buildPayload({ sessions: [], activeSessionId: '', chatModel: 'MiniMax-M2.7' });
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return buildPayload({
        sessions: parsed.sessions,
        activeSessionId: parsed.activeSessionId,
        chatModel: parsed.chatModel,
      });
    } catch {
      return buildPayload({ sessions: [], activeSessionId: '', chatModel: 'MiniMax-M2.7' });
    }
  };

  return {
    read() {
      return toReadResponse(readRaw());
    },
    write(body) {
      const payload = buildPayload(body);
      ensureDir(filePath);
      fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
      return payload.updatedAt;
    },
    clear() {
      return this.write({ sessions: [], activeSessionId: '', chatModel: 'MiniMax-M2.7' });
    },
  };
}

export function createMemoryChatStore() {
  return {
    read() {
      return toReadResponse(memoryPayload);
    },
    write(body) {
      memoryPayload = buildPayload(body);
      return memoryPayload.updatedAt;
    },
    clear() {
      return this.write({ sessions: [], activeSessionId: '', chatModel: 'MiniMax-M2.7' });
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
    const body = normalizeWriteBody(req.body);
    const revision = store.write(body);
    res.json({ ok: true, ...body, revision });
  });

  router.delete('/chat/sessions', (_req, res) => {
    const revision = store.clear();
    res.json({
      ok: true,
      sessions: [],
      activeSessionId: '',
      chatModel: 'MiniMax-M2.7',
      revision,
    });
  });
}
