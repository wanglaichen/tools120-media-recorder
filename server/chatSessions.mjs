import fs from 'node:fs';
import path from 'node:path';

const MAX_SESSIONS = 200;
const MAX_MESSAGES_PER_SESSION = 500;

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readSessions(filePath) {
  if (!fs.existsSync(filePath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Array.isArray(parsed.sessions) ? parsed.sessions : [];
  } catch {
    return [];
  }
}

function writeSessions(filePath, sessions) {
  ensureDir(filePath);
  const payload = {
    version: 1,
    updatedAt: new Date().toISOString(),
    sessions,
  };
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
}

function sanitizeSessions(raw) {
  if (!Array.isArray(raw)) return [];
  const sessions = raw.slice(0, MAX_SESSIONS).map((s) => {
    if (!s || typeof s !== 'object') return null;
    const id = typeof s.id === 'string' ? s.id.slice(0, 80) : '';
    if (!id) return null;
    const messages = Array.isArray(s.messages)
      ? s.messages.slice(0, MAX_MESSAGES_PER_SESSION).map((m) => {
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
        }).filter(Boolean)
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

/** @param {import('express').Router} router */
export function attachChatSessions(router, chatSessionsPath) {
  router.get('/chat/sessions', (_req, res) => {
    res.json({ sessions: readSessions(chatSessionsPath) });
  });

  router.put('/chat/sessions', (req, res) => {
    const sessions = sanitizeSessions(req.body?.sessions);
    writeSessions(chatSessionsPath, sessions);
    res.json({ ok: true, sessions });
  });

  router.delete('/chat/sessions', (_req, res) => {
    writeSessions(chatSessionsPath, []);
    res.json({ ok: true, sessions: [] });
  });
}
