/**
 * 将根目录 .env 的 MINIMAX_* 同步到 client/.env.local 的 NEXT_PUBLIC_MINIMAX_*。
 * MiniMax 密钥只维护根目录 .env，前端勿在 client/.env 手填。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rootEnv = path.join(root, '.env');
const clientDir = path.join(root, 'client');
const clientEnvExample = path.join(clientDir, '.env.example');
const clientEnvLocal = path.join(clientDir, '.env.local');

const MANAGED_KEYS = ['NEXT_PUBLIC_MINIMAX_API_KEY', 'NEXT_PUBLIC_MINIMAX_API_BASE_URL'];
const MANAGED_HEADER = '# --- MiniMax（自动生成，请勿编辑；在根目录 .env 配置 MINIMAX_*）---';

function parseEnv(text) {
  const map = new Map();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    map.set(trimmed.slice(0, eq).trim(), trimmed.slice(eq + 1).trim());
  }
  return map;
}

function stripManagedLines(lines) {
  return lines.filter((line) => {
    const t = line.trim();
    if (t.includes('MiniMax（自动生成')) return false;
    const key = t.split('=')[0]?.trim();
    return !MANAGED_KEYS.includes(key);
  });
}

function ensureClientEnvLocal() {
  if (fs.existsSync(clientEnvLocal)) return;
  if (fs.existsSync(clientEnvExample)) {
    fs.copyFileSync(clientEnvExample, clientEnvLocal);
    return;
  }
  fs.writeFileSync(
    clientEnvLocal,
    'NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8787\n',
    'utf8',
  );
}

function writeManagedBlock(apiKey, baseUrl) {
  ensureClientEnvLocal();
  let lines = fs.readFileSync(clientEnvLocal, 'utf8').split(/\r?\n/);
  lines = stripManagedLines(lines);
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  lines.push('', MANAGED_HEADER);
  lines.push(`NEXT_PUBLIC_MINIMAX_API_KEY=${apiKey}`);
  lines.push(`NEXT_PUBLIC_MINIMAX_API_BASE_URL=${baseUrl}`);
  lines.push('');
  fs.writeFileSync(clientEnvLocal, lines.join('\n'), 'utf8');
}

function removeManagedBlock() {
  if (!fs.existsSync(clientEnvLocal)) return;
  let lines = fs.readFileSync(clientEnvLocal, 'utf8').split(/\r?\n/);
  lines = stripManagedLines(lines);
  fs.writeFileSync(clientEnvLocal, lines.join('\n').replace(/\n*$/, '\n'), 'utf8');
}

if (!fs.existsSync(rootEnv)) {
  console.log('[sync-minimax-env] skip: no root .env');
  process.exit(0);
}

const rootVars = parseEnv(fs.readFileSync(rootEnv, 'utf8'));
const apiKey = rootVars.get('MINIMAX_API_KEY');
if (!apiKey || apiKey === 'your_api_key_here') {
  removeManagedBlock();
  console.log('[sync-minimax-env] skip: set MINIMAX_API_KEY in root .env');
  process.exit(0);
}

let baseUrl = rootVars.get('MINIMAX_API_BASE_URL') || 'https://api.minimaxi.com';
baseUrl = baseUrl.replace(/\/+$/, '').replace(/\/v1$/i, '');

writeManagedBlock(apiKey, baseUrl);
console.log('[sync-minimax-env] synced root .env MINIMAX_* -> client/.env.local');
