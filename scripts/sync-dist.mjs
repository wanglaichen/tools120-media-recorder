import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'client', 'out');
const dest = path.join(root, 'dist');

if (!fs.existsSync(src)) {
  console.error('client/out 不存在，请先执行 npm run client:build（需 next.config 开启 output: export）');
  process.exit(1);
}

fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(src, dest, { recursive: true });
console.log('已同步 client/out → dist');
