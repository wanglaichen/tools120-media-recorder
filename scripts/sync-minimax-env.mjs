/**
 * 将根目录 .env 同步到 client/.env.local：
 * - MINIMAX_* → NEXT_PUBLIC_MINIMAX_*
 * - NEXT_PUBLIC_API_BASE_URL（前端 API 地址，与根目录保持一致）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rootEnv = path.join(root, '.env');
const clientDir = path.join(root, 'client');
const clientEnvExample = path.join(clientDir, '.env.example');
const clientEnvLocal = path.join(clientDir, '.env.local');

const MINIMAX_MANAGED_KEYS = ['NEXT_PUBLIC_MINIMAX_API_KEY', 'NEXT_PUBLIC_MINIMAX_API_BASE_URL'];
const MINIMAX_HEADER = '# --- MiniMax（自动生成，请勿编辑；在根目录 .env 配置 MINIMAX_*）---';
const API_BASE_KEY = 'NEXT_PUBLIC_API_BASE_URL';
const API_BASE_HEADER = '# 本地开发：由根目录 .env 同步 NEXT_PUBLIC_API_BASE_URL';

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

function stripMiniMaxManaged(lines) {
  return lines.filter((line) => {
    const t = line.trim();
    if (t.includes('MiniMax（自动生成')) return false;
    const key = t.split('=')[0]?.trim();
    return !MINIMAX_MANAGED_KEYS.includes(key);
  });
}

function stripApiBaseManaged(lines) {
  return lines.filter((line) => {
    const t = line.trim();
    if (t === API_BASE_HEADER) return false;
    if (t.startsWith(`${API_BASE_KEY}=`)) return false;
    if (t.startsWith('# 本地开发：指向本机 Express')) return false;
    return true;
  });
}

function ensureClientEnvLocal() {
  if (fs.existsSync(clientEnvLocal)) return;
  if (fs.existsSync(clientEnvExample)) {
    fs.copyFileSync(clientEnvExample, clientEnvLocal);
    return;
  }
  fs.writeFileSync(clientEnvLocal, `${API_BASE_KEY}=http://127.0.0.1:8787\n`, 'utf8');
}

function upsertApiBaseUrl(apiBaseUrl) {
  if (!apiBaseUrl?.startsWith('http://') && !apiBaseUrl?.startsWith('https://')) return;
  ensureClientEnvLocal();
  let lines = fs.readFileSync(clientEnvLocal, 'utf8').split(/\r?\n/);
  lines = stripApiBaseManaged(lines);
  while (lines.length && lines[0].trim() === '') lines.shift();
  const block = [API_BASE_HEADER, `${API_BASE_KEY}=${apiBaseUrl.replace(/\/+$/, '')}`, ''];
  fs.writeFileSync(clientEnvLocal, [...block, ...lines].join('\n').replace(/\n*$/, '\n'), 'utf8');
}

function writeMiniMaxBlock(apiKey, baseUrl) {
  ensureClientEnvLocal();
  let lines = fs.readFileSync(clientEnvLocal, 'utf8').split(/\r?\n/);
  lines = stripMiniMaxManaged(lines);
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  lines.push('', MINIMAX_HEADER);
  lines.push(`NEXT_PUBLIC_MINIMAX_API_KEY=${apiKey}`);
  lines.push(`NEXT_PUBLIC_MINIMAX_API_BASE_URL=${baseUrl}`);
  lines.push('');
  fs.writeFileSync(clientEnvLocal, lines.join('\n'), 'utf8');
}

function removeMiniMaxBlock() {
  if (!fs.existsSync(clientEnvLocal)) return;
  let lines = fs.readFileSync(clientEnvLocal, 'utf8').split(/\r?\n/);
  lines = stripMiniMaxManaged(lines);
  fs.writeFileSync(clientEnvLocal, lines.join('\n').replace(/\n*$/, '\n'), 'utf8');
}

if (!fs.existsSync(rootEnv)) {
  console.log('[sync-minimax-env] skip: no root .env');
  process.exit(0);
}

const rootVars = parseEnv(fs.readFileSync(rootEnv, 'utf8'));

const apiBase = rootVars.get(API_BASE_KEY);
if (apiBase) {
  upsertApiBaseUrl(apiBase);
  console.log(`[sync-minimax-env] synced ${API_BASE_KEY} -> client/.env.local`);
}

const apiKey = rootVars.get('MINIMAX_API_KEY');
if (!apiKey || apiKey === 'your_api_key_here') {
  removeMiniMaxBlock();
  if (!apiBase) console.log('[sync-minimax-env] skip: set MINIMAX_API_KEY in root .env');
  process.exit(0);
}

let baseUrl = rootVars.get('MINIMAX_API_BASE_URL') || 'https://api.minimaxi.com';
baseUrl = baseUrl.replace(/\/+$/, '').replace(/\/v1$/i, '');

writeMiniMaxBlock(apiKey, baseUrl);
console.log('[sync-minimax-env] synced root .env MINIMAX_* -> client/.env.local');
