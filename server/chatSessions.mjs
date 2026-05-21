import fs from 'node:fs';
import path from 'node:path';

const MAX_SESSIONS = 200;
const MAX_PAIRS_PER_SESSION = 500;
const ALLOWED_MODELS = new Set([
  'MiniMax-M2.7',
  'MiniMax-M2.7-highspeed',
  'MiniMax-M2.5',
  'MiniMax-M2.5-highspeed',
]);

/**
 * Q&A pair — atomic sync unit.
 * Both client A and B add pairs; each pair is a distinct JSON file so inserts
 * from different browsers never overwrite each other.
 */
function sanitizeContent(raw) {
  return String(raw ?? '').slice(0, 200_000);
}

function sanitizeModel(raw) {
  const m = String(raw ?? '').trim();
  return ALLOWED_MODELS.has(m) ? m : 'MiniMax-M2.7';
}

function sanitizeSessionTitle(raw) {
  return String(raw ?? '新对话').slice(0, 120);
}

function sanitizeSessionId(raw) {
  return String(raw ?? '').slice(0, 80).replace(/[^a-zA-Z0-9_-]/g, '');
}

function newPairId() {
  return `p-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function newSessionId() {
  return `s-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function safeParsePath(p) {
  return String(p ?? '').replace(/[^a-zA-Z0-9_\/-]/g, '');
}

/** Read / create the sessions list file inside a session dir */
function readSessionMeta(sessionDir) {
  const metaPath = path.join(sessionDir, 'sessions_meta.json');
  if (fs.existsSync(metaPath)) {
    try {
      return JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    } catch { /* fall through */ }
  }
  return { sessions: [], version: 1, updatedAt: new Date().toISOString() };
}

function writeSessionMeta(sessionDir, meta) {
  const metaPath = path.join(sessionDir, 'sessions_meta.json');
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8');
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

/**
 * Per-session pair index: maps pairId -> { id, userId, assistantId, pairSeq, userCreatedAt }
 * pairSeq is the auto-increment sequence for ordering and conflict detection.
 */
function readPairIndex(sessionDir) {
  const indexPath = path.join(sessionDir, 'pairs_index.json');
  if (fs.existsSync(indexPath)) {
    try {
      return JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    } catch { /* fall through */ }
  }
  return { pairs: [], version: 1, currentSeq: 0 };
}

function writePairIndex(sessionDir, index) {
  const indexPath = path.join(sessionDir, 'pairs_index.json');
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf8');
}

function readPair(sessionDir, pairId) {
  const p = path.join(sessionDir, safeParsePath(pairId) + '.json');
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function writePair(sessionDir, pair) {
  const p = path.join(sessionDir, safeParsePath(pair.id) + '.json');
  ensureDir(p);
  fs.writeFileSync(p, JSON.stringify(pair, null, 2), 'utf8');
}

/** Build the full session object from pairs + meta */
function buildSession(sessionDir, metaEntry) {
  const index = readPairIndex(sessionDir);
  const pairs = (index.pairs || [])
    .map((entry) => {
      const user = readPair(sessionDir, entry.userId);
      const assistant = readPair(sessionDir, entry.assistantId);
      if (!user || !assistant) return null;
      return {
        pairId: entry.id,
        pairSeq: entry.pairSeq,
        user: {
          id: user.id,
          role: 'user',
          content: user.content,
          createdAt: user.createdAt,
        },
        assistant: {
          id: assistant.id,
          role: 'assistant',
          content: assistant.content,
          createdAt: assistant.createdAt,
        },
        pairCreatedAt: entry.pairCreatedAt,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.pairSeq - b.pairSeq);

  const messages = [];
  for (const p of pairs) {
    messages.push(p.user);
    messages.push(p.assistant);
  }

  return {
    id: metaEntry.id,
    title: metaEntry.title,
    createdAt: metaEntry.createdAt,
    updatedAt: metaEntry.updatedAt,
    currentSeq: index.currentSeq,
    messages,
  };
}

/** Merge incoming pairs into the stored pair index, return new pairs only */
function mergeIncomingPairs(sessionDir, incomingPairs, storedIndex) {
  const storedMap = new Map();
  for (const e of storedIndex.pairs) storedMap.set(e.id, e);

  const allIds = new Set([...storedMap.keys(), ...incomingPairs.map((p) => p.id)]);

  const newPairs = [];
  const mergedPairs = [];

  for (const id of allIds) {
    const stored = storedMap.get(id);
    const incoming = incomingPairs.find((p) => p.id === id);

    if (incoming && !stored) {
      // brand new pair — write both user and assistant files
      writePair(sessionDir, incoming.user);
      writePair(sessionDir, incoming.assistant);

      const indexEntry = {
        id: incoming.id,
        userId: incoming.user.id,
        assistantId: incoming.assistant.id,
        pairSeq: incoming.pairSeq,
        pairCreatedAt: incoming.pairCreatedAt,
      };
      storedMap.set(id, indexEntry);
      newPairs.push(incoming);
    } else if (stored && incoming) {
      // already exists — keep whichever has later seq, or keep stored
      mergedPairs.push({ stored, incoming });
    } else if (stored) {
      mergedPairs.push({ stored, incoming: null });
    }
  }

  // Resort by pairSeq
  const sorted = [...storedMap.values()].sort((a, b) => a.pairSeq - b.pairSeq);
  const newSeq = sorted.length > 0 ? sorted[sorted.length - 1].pairSeq : 0;

  writePairIndex(sessionDir, { pairs: sorted, version: 1, currentSeq: newSeq });

  return { newPairs, mergedCount: mergedPairs.length };
}

function createSessionDir(rootDir, sessionId) {
  return path.join(rootDir, safeParsePath(sessionId));
}

function ensureSessionDir(sessionDir) {
  fs.mkdirSync(sessionDir, { recursive: true });
}

/** Full snapshot returned to clients */
function buildSnapshot(rootDir, sessionsMeta) {
  return {
    sessions: sessionsMeta.map((m) => {
      const sessionDir = createSessionDir(rootDir, m.id);
      return buildSession(sessionDir, m);
    }),
    version: 1,
    updatedAt: new Date().toISOString(),
  };
}

/** Per-session PUT: append one Q&A pair, detect conflicts */
function handleSessionPut(sessionDir, body, sessionsMeta, metaEntry) {
  const incomingPairs = Array.isArray(body?.pairs) ? body.pairs : [];
  if (incomingPairs.length === 0) {
    return { revision: metaEntry.updatedAt, newPairs: [], conflict: false };
  }

  const storedIndex = readPairIndex(sessionDir);
  const baseSeq = Number(body?.baseSeq) || 0;

  // Conflict: someone else inserted after what we expected
  const conflict = storedIndex.currentSeq > baseSeq;

  // Collect pairs that the caller doesn't know about
  const newPairs = [];
  if (conflict) {
    for (const entry of storedIndex.pairs) {
      if (entry.pairSeq > baseSeq) {
        const p = readPair(sessionDir, entry.userId);
        const a = readPair(sessionDir, entry.assistantId);
        if (p && a) {
          newPairs.push({
            id: entry.id,
            pairSeq: entry.pairSeq,
            pairCreatedAt: entry.pairCreatedAt,
            user: { id: p.id, role: 'user', content: p.content, createdAt: p.createdAt },
            assistant: { id: a.id, role: 'assistant', content: a.content, createdAt: a.createdAt },
          });
        }
      }
    }
  }

  // Always write incoming pairs (merge, not overwrite)
  const { newPairs: written } = mergeIncomingPairs(sessionDir, incomingPairs, storedIndex);

  // Update session meta
  const updatedMeta = {
    ...metaEntry,
    title: sanitizeSessionTitle(body?.title || metaEntry.title),
    updatedAt: new Date().toISOString(),
  };
  const updatedMetaList = sessionsMeta.map((m) => (m.id === metaEntry.id ? updatedMeta : m));
  writeSessionMeta(path.dirname(sessionDir), {
    sessions: updatedMetaList,
    version: 1,
    updatedAt: updatedMeta.updatedAt,
  });

  return {
    revision: updatedMeta.updatedAt,
    newPairs: conflict ? newPairs : written,
    conflict,
    currentSeq: readPairIndex(sessionDir).currentSeq,
  };
}

/** Create brand-new session */
function handleNewSession(rootDir, sessionsMeta, body) {
  const sessionId = newSessionId();
  const sessionDir = createSessionDir(rootDir, sessionId);
  ensureSessionDir(sessionDir);

  const now = new Date().toISOString();
  const metaEntry = {
    id: sessionId,
    title: sanitizeSessionTitle(body?.title),
    createdAt: now,
    updatedAt: now,
  };

  const updatedMetaList = [metaEntry, ...sessionsMeta].slice(0, MAX_SESSIONS);
  writeSessionMeta(path.dirname(sessionDir), {
    sessions: updatedMetaList,
    version: 1,
    updatedAt: now,
  });

  writePairIndex(sessionDir, { pairs: [], version: 1, currentSeq: 0 });

  return { sessionId, metaEntry, updatedMetaList };
}

/** Delete session */
function handleDeleteSession(rootDir, sessionsMeta, sessionId) {
  const sessionDir = createSessionDir(rootDir, sessionId);
  const updatedMetaList = sessionsMeta.filter((m) => m.id !== sessionId);
  const parentDir = path.dirname(sessionDir);
  if (fs.existsSync(parentDir)) {
    writeSessionMeta(parentDir, {
      sessions: updatedMetaList,
      version: 1,
      updatedAt: new Date().toISOString(),
    });
  }
  return updatedMetaList;
}

export function createFileChatStore(rootDir) {
  // rootDir = e.g. "output/chat"
  ensureSessionDir(rootDir);

  const sessionsMetaPath = path.join(rootDir, 'sessions_meta.json');

  const loadSessionsMeta = () => {
    if (fs.existsSync(sessionsMetaPath)) {
      try {
        return JSON.parse(fs.readFileSync(sessionsMetaPath, 'utf8')).sessions || [];
      } catch { /* fall through */ }
    }
    return [];
  };

  const saveSessionsMeta = (sessions) => {
    ensureDir(sessionsMetaPath);
    fs.writeFileSync(
      sessionsMetaPath,
      JSON.stringify({ sessions, version: 1, updatedAt: new Date().toISOString() }, null, 2),
      'utf8',
    );
  };

  return {
    read() {
      const sessionsMeta = loadSessionsMeta();
      return buildSnapshot(rootDir, sessionsMeta);
    },

    put(body) {
      const sessionId = body?.sessionId || body?.activeSessionId;
      const sessionsMeta = loadSessionsMeta();

      if (!sessionId) {
        // Brand-new session
        const { metaEntry, updatedMetaList } = handleNewSession(rootDir, sessionsMeta, body);
        return {
          ...buildSnapshot(rootDir, updatedMetaList),
          revision: metaEntry.updatedAt,
          newPairs: [],
          conflict: false,
        };
      }

      const sessionDir = createSessionDir(rootDir, sessionId);
      const metaEntry = sessionsMeta.find((m) => m.id === sessionId);

      if (!metaEntry) {
        // Session not found — create it
        const { metaEntry: newMeta, updatedMetaList } = handleNewSession(rootDir, sessionsMeta, {
          ...body,
          sessionId,
        });
        return {
          ...buildSnapshot(rootDir, updatedMetaList),
          revision: newMeta.updatedAt,
          newPairs: [],
          conflict: false,
        };
      }

      // Existing session — append pairs
      const result = handleSessionPut(sessionDir, body, sessionsMeta, metaEntry);
      return {
        ...buildSnapshot(rootDir, sessionsMeta),
        revision: result.revision,
        newPairs: result.newPairs,
        conflict: result.conflict,
        currentSeq: result.currentSeq,
      };
    },

    deleteSession(sessionId) {
      const sessionsMeta = loadSessionsMeta();
      const updatedMetaList = handleDeleteSession(rootDir, sessionsMeta, sessionId);
      return { sessions: updatedMetaList, revision: new Date().toISOString() };
    },

    clear() {
      const sessionsMeta = loadSessionsMeta();
      for (const m of sessionsMeta) {
        const sd = createSessionDir(rootDir, m.id);
        try {
          const files = fs.readdirSync(sd);
          for (const f of files) fs.unlinkSync(path.join(sd, f));
          fs.rmdirSync(sd);
        } catch { /* ignore */ }
      }
      saveSessionsMeta([]);
      return { sessions: [], revision: new Date().toISOString() };
    },
  };
}

export function createMemoryChatStore() {
  let sessions = [];
  let byId = new Map();
  let pairSeqCounter = 0;

  function sessionDir(_id) { return ''; }

  return {
    read() {
      return { sessions, version: 1, updatedAt: new Date().toISOString() };
    },
    put(body) {
      // simplified in-memory — no conflict detection
      return { sessions, version: 1, updatedAt: new Date().toISOString(), newPairs: [], conflict: false };
    },
    deleteSession(id) {
      sessions = sessions.filter((s) => s.id !== id);
      return { sessions, revision: new Date().toISOString() };
    },
    clear() {
      sessions = [];
      byId.clear();
      return { sessions: [], revision: new Date().toISOString() };
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
    const result = store.put(req.body);
    res.json(result);
  });

  router.delete('/chat/sessions/:sessionId', (req, res) => {
    const result = store.deleteSession(req.params.sessionId);
    res.json(result);
  });

  router.delete('/chat/sessions', (_req, res) => {
    const result = store.clear();
    res.json(result);
  });
}