import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApiApp } from './apiApp.mjs';

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
const uploadDir = path.resolve(rootDir, process.env.UPLOAD_DIR || 'output/audio');
const manifestPath = path.join(uploadDir, 'manifest.json');
const uiStatePath = path.resolve(rootDir, process.env.UI_STATE_PATH || 'output/ui-state.json');
const chatSessionsPath = path.resolve(
  rootDir,
  process.env.CHAT_SESSIONS_PATH || 'output/chat',
);
const maxAudioMb = Number(process.env.MAX_AUDIO_MB || 25);

const app = createApiApp({
  storage: 'disk',
  uploadDir,
  manifestPath,
  uiStatePath,
  chatSessionsPath,
  maxAudioMb,
});

fs.mkdirSync(uploadDir, { recursive: true });

app.listen(port, host, () => {
  console.log(`API server http://${host}:${port}`);
  console.log(`Upload dir: ${uploadDir}`);
  console.log(`Manifest: ${manifestPath}`);
  console.log(`UI state: ${uiStatePath}`);
  console.log(`Chat sessions: ${chatSessionsPath}`);
});
