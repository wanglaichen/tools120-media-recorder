import cors from 'cors';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { attachMiniMaxProxy } from './minimaxProxy.mjs';
import {
  attachChatSessions,
  createFileChatStore,
  createMemoryChatStore,
} from './chatSessions.mjs';

const defaultManifest = () => ({
  version: 1,
  updatedAt: new Date().toISOString(),
  recordings: [],
});

const sanitizeId = (id) => /^[a-zA-Z0-9_-]+$/.test(id);

const getClientIp = (req) => {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  if (Array.isArray(forwarded) && forwarded[0]) {
    return String(forwarded[0]).trim();
  }
  const realIp = req.headers['x-real-ip'];
  if (typeof realIp === 'string' && realIp.trim()) return realIp.trim();
  return req.socket?.remoteAddress || '-';
};

/** @param {{ storage: 'disk', uploadDir: string, manifestPath: string, maxAudioMb: number, chatSessionsPath?: string } | { storage: 'memory', maxAudioMb: number, chatSessionsPath?: string }} opts */
export function createApiApp(opts) {
  const maxAudioMb = opts.maxAudioMb ?? 25;
  const clientOrigins = (process.env.CLIENT_ORIGIN ||
    'http://127.0.0.1:3000,http://127.0.0.1:5173,https://tools120-media-recorder.edgeone.dev')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  let readManifest;
  let writeManifest;
  let upload;
  let readAudioBuffer;
  let deleteAudioFile;
  let saveMemoryFile = null;

  if (opts.storage === 'disk') {
    const uploadDir = opts.uploadDir;
    const manifestPath = opts.manifestPath;

    const ensureUploadDir = () => {
      fs.mkdirSync(uploadDir, { recursive: true });
    };

    readManifest = () => {
      ensureUploadDir();
      if (!fs.existsSync(manifestPath)) {
        const manifest = defaultManifest();
        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
        return manifest;
      }
      try {
        const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        if (!parsed.recordings || !Array.isArray(parsed.recordings)) {
          return { ...defaultManifest(), recordings: [] };
        }
        return parsed;
      } catch {
        return defaultManifest();
      }
    };

    writeManifest = (manifest) => {
      ensureUploadDir();
      manifest.updatedAt = new Date().toISOString();
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    };

    const diskStorage = multer.diskStorage({
      destination: (_req, _file, cb) => {
        ensureUploadDir();
        cb(null, uploadDir);
      },
      filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname) || '.webm';
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        cb(null, `${id}${ext}`);
      },
    });

    upload = multer({
      storage: diskStorage,
      limits: { fileSize: maxAudioMb * 1024 * 1024 },
    });

    readAudioBuffer = (entry) => {
      const filePath = path.join(uploadDir, entry.fileName);
      if (!fs.existsSync(filePath)) return null;
      return fs.readFileSync(filePath);
    };

    deleteAudioFile = (entry) => {
      const filePath = path.join(uploadDir, entry.fileName);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    };
  } else {
    const memoryFiles = new Map();
    let manifest = defaultManifest();

    readManifest = () => manifest;

    writeManifest = (next) => {
      manifest = { ...next, updatedAt: new Date().toISOString() };
    };

    upload = multer({
      storage: multer.memoryStorage(),
      limits: { fileSize: maxAudioMb * 1024 * 1024 },
    });

    readAudioBuffer = (entry) => memoryFiles.get(entry.id) ?? null;

    deleteAudioFile = (entry) => {
      memoryFiles.delete(entry.id);
    };

    saveMemoryFile = (id, buffer) => {
      memoryFiles.set(id, buffer);
    };
  }

  const app = express();
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || clientOrigins.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(null, false);
      },
    }),
  );
  app.use(express.json({ limit: '1mb' }));

  const router = express.Router();
  const minimaxRouter = express.Router();
  minimaxRouter.use(express.json({ limit: '32mb' }));
  attachMiniMaxProxy(minimaxRouter);
  router.use(minimaxRouter);

  if (opts.chatSessionsPath) {
    attachChatSessions(router, createFileChatStore(opts.chatSessionsPath));
  } else if (opts.storage === 'memory') {
    attachChatSessions(router, createMemoryChatStore());
  }

  router.get('/health', (req, res) => {
    res.json({
      ok: true,
      storage: opts.storage,
      clientIp: getClientIp(req),
      host: req.headers.host || null,
    });
  });

  router.get('/audio', (_req, res) => {
    res.json(readManifest());
  });

  router.post('/audio', upload.single('file'), (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: '缺少音频文件' });
      return;
    }

    const duration = Number(req.body.duration || 0);
    const displayName =
      typeof req.body.displayName === 'string' && req.body.displayName.trim()
        ? req.body.displayName.trim()
        : `采集 ${new Date().toLocaleString('zh-CN')}`;

    let id;
    let fileName;
    if (opts.storage === 'memory') {
      const ext = path.extname(req.file.originalname) || '.webm';
      id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      fileName = `${id}${ext}`;
      saveMemoryFile(id, req.file.buffer);
    } else {
      id = path.basename(req.file.filename, path.extname(req.file.filename));
      fileName = req.file.filename;
    }

    const entry = {
      id,
      displayName,
      fileName,
      duration: Number.isFinite(duration) ? duration : 0,
      size: req.file.size,
      mimeType: req.file.mimetype || 'audio/webm',
      createdAt: Date.now(),
    };

    const nextManifest = readManifest();
    nextManifest.recordings.unshift(entry);
    writeManifest(nextManifest);

    res.status(201).json({ recording: entry, manifest: readManifest() });
  });

  router.patch('/audio/:id', (req, res) => {
    const { id } = req.params;
    if (!sanitizeId(id)) {
      res.status(400).json({ error: '无效的 ID' });
      return;
    }

    const displayName = req.body?.displayName;
    if (typeof displayName !== 'string' || !displayName.trim()) {
      res.status(400).json({ error: 'displayName 不能为空' });
      return;
    }

    const nextManifest = readManifest();
    const index = nextManifest.recordings.findIndex((item) => item.id === id);
    if (index < 0) {
      res.status(404).json({ error: '录音不存在' });
      return;
    }

    nextManifest.recordings[index].displayName = displayName.trim();
    writeManifest(nextManifest);
    res.json({ recording: nextManifest.recordings[index], manifest: readManifest() });
  });

  router.delete('/audio/:id', (req, res) => {
    const { id } = req.params;
    if (!sanitizeId(id)) {
      res.status(400).json({ error: '无效的 ID' });
      return;
    }

    const nextManifest = readManifest();
    const index = nextManifest.recordings.findIndex((item) => item.id === id);
    if (index < 0) {
      res.status(404).json({ error: '录音不存在' });
      return;
    }

    const [removed] = nextManifest.recordings.splice(index, 1);
    deleteAudioFile(removed);
    writeManifest(nextManifest);
    res.json({ ok: true, manifest: readManifest() });
  });

  router.delete('/audio', (_req, res) => {
    const nextManifest = readManifest();
    for (const item of nextManifest.recordings) {
      deleteAudioFile(item);
    }
    const cleared = defaultManifest();
    writeManifest(cleared);
    res.json({ ok: true, manifest: readManifest() });
  });

  router.get('/audio/:id/file', (req, res) => {
    const { id } = req.params;
    if (!sanitizeId(id)) {
      res.status(400).json({ error: '无效的 ID' });
      return;
    }

    const nextManifest = readManifest();
    const entry = nextManifest.recordings.find((item) => item.id === id);
    if (!entry) {
      res.status(404).json({ error: '录音不存在' });
      return;
    }

    const buffer = readAudioBuffer(entry);
    if (!buffer) {
      res.status(404).json({ error: '音频文件不存在' });
      return;
    }

    res.setHeader('Content-Type', entry.mimeType || 'audio/webm');
    res.send(buffer);
  });

  app.use('/api', router);
  app.use(router);

  app.use((err, _req, res, _next) => {
    if (err?.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({ error: `文件超过 ${maxAudioMb} MB 限制` });
      return;
    }
    console.error(err);
    res.status(500).json({ error: err?.message || '服务器错误' });
  });

  return app;
}
