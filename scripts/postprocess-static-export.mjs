/**
 * Next.js output:export 会在 out 根目录生成 404.html。
 * EdgeOne Pages 文档：SPA 不应在输出根目录放 404.html，否则易影响首页路由。
 * @see https://pages.edgeone.ai/document/custom-404-page
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'client', 'out');

function remove404Artifacts(dir) {
  const html404 = path.join(dir, '404.html');
  const dir404 = path.join(dir, '404');
  if (fs.existsSync(html404)) {
    fs.unlinkSync(html404);
    console.log('[postprocess-static-export] removed 404.html');
  }
  if (fs.existsSync(dir404)) {
    fs.rmSync(dir404, { recursive: true, force: true });
    console.log('[postprocess-static-export] removed 404/');
  }
}

if (!fs.existsSync(path.join(outDir, 'index.html'))) {
  console.error('[postprocess-static-export] missing client/out/index.html — run next build first');
  process.exit(1);
}

remove404Artifacts(outDir);

const verify = spawnSync(process.execPath, ['scripts/verify-static-export.mjs', outDir], {
  cwd: root,
  stdio: 'inherit',
});
if (verify.status !== 0) process.exit(verify.status ?? 1);

console.log('[postprocess-static-export] OK');
