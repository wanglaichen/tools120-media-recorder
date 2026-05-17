import cors from 'cors';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import multer from 'multer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const loadEnvFile = (envPath) => {
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
};

loadEnvFile(path.join(rootDir, '.env'));

const host = process.env.APP_HOST || '127.0.0.1';
const port = Number(process.env.APP_PORT || 8787);
const clientOrigin = process.env.CLIENT_ORIGIN || 'http://127.0.0.1:5173';
const uploadDir = path.resolve(rootDir, process.env.UPLOAD_DIR || 'output/audio');
const maxAudioMb = Number(process.env.MAX_AUDIO_MB || 25);
const manifestPath = path.join(uploadDir, 'manifest.json');

const ensureUploadDir = () => {
  fs.mkdirSync(uploadDir, { recursive: true });
};

const defaultManifest = () => ({
  version: 1,
  updatedAt: new Date().toISOString(),
  recordings: [],
});

const readManifest = () => {
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

const writeManifest = (manifest) => {
  ensureUploadDir();
  manifest.updatedAt = new Date().toISOString();
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
};

const sanitizeId = (id) => /^[a-zA-Z0-9_-]+$/.test(id);

const storage = multer.diskStorage({
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

const upload = multer({
  storage,
  limits: { fileSize: maxAudioMb * 1024 * 1024 },
});

const app = express();
app.use(
  cors({
    origin: clientOrigin,
  }),
);
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/audio', (_req, res) => {
  const manifest = readManifest();
  res.json(manifest);
});

app.post('/api/audio', upload.single('file'), (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: '缺少音频文件' });
    return;
  }

  const duration = Number(req.body.duration || 0);
  const displayName =
    typeof req.body.displayName === 'string' && req.body.displayName.trim()
      ? req.body.displayName.trim()
      : `采集 ${new Date().toLocaleString('zh-CN')}`;

  const id = path.basename(req.file.filename, path.extname(req.file.filename));
  const entry = {
    id,
    displayName,
    fileName: req.file.filename,
    duration: Number.isFinite(duration) ? duration : 0,
    size: req.file.size,
    mimeType: req.file.mimetype || 'audio/webm',
    createdAt: Date.now(),
  };

  const manifest = readManifest();
  manifest.recordings.unshift(entry);
  writeManifest(manifest);

  res.status(201).json({ recording: entry, manifest });
});

app.patch('/api/audio/:id', (req, res) => {
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

  const manifest = readManifest();
  const index = manifest.recordings.findIndex((item) => item.id === id);
  if (index < 0) {
    res.status(404).json({ error: '录音不存在' });
    return;
  }

  manifest.recordings[index].displayName = displayName.trim();
  writeManifest(manifest);
  res.json({ recording: manifest.recordings[index], manifest });
});

app.delete('/api/audio/:id', (req, res) => {
  const { id } = req.params;
  if (!sanitizeId(id)) {
    res.status(400).json({ error: '无效的 ID' });
    return;
  }

  const manifest = readManifest();
  const index = manifest.recordings.findIndex((item) => item.id === id);
  if (index < 0) {
    res.status(404).json({ error: '录音不存在' });
    return;
  }

  const [removed] = manifest.recordings.splice(index, 1);
  const filePath = path.join(uploadDir, removed.fileName);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  writeManifest(manifest);
  res.json({ ok: true, manifest });
});

app.delete('/api/audio', (_req, res) => {
  const manifest = readManifest();
  for (const item of manifest.recordings) {
    const filePath = path.join(uploadDir, item.fileName);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
  const next = defaultManifest();
  writeManifest(next);
  res.json({ ok: true, manifest: next });
});

app.get('/api/audio/:id/file', (req, res) => {
  const { id } = req.params;
  if (!sanitizeId(id)) {
    res.status(400).json({ error: '无效的 ID' });
    return;
  }

  const manifest = readManifest();
  const entry = manifest.recordings.find((item) => item.id === id);
  if (!entry) {
    res.status(404).json({ error: '录音不存在' });
    return;
  }

  const filePath = path.join(uploadDir, entry.fileName);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: '音频文件不存在' });
    return;
  }

  res.setHeader('Content-Type', entry.mimeType || 'audio/webm');
  res.sendFile(path.resolve(filePath));
});

app.use((err, _req, res, _next) => {
  if (err?.code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({ error: `文件超过 ${maxAudioMb} MB 限制` });
    return;
  }
  console.error(err);
  res.status(500).json({ error: err?.message || '服务器错误' });
});

ensureUploadDir();
app.listen(port, host, () => {
  console.log(`API server http://${host}:${port}`);
  console.log(`Upload dir: ${uploadDir}`);
  console.log(`Manifest: ${manifestPath}`);
});
