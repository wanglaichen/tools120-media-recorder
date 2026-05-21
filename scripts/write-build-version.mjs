/**
 * 构建前写入 client/lib/build-info.ts，供页面展示版本号（静态导出会打进 HTML）。
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'client/package.json'), 'utf8'));
const version = pkg.version ?? '0.0.0';

let git = 'nogit';
try {
  git = execSync('git rev-parse --short HEAD', { cwd: root, stdio: ['pipe', 'pipe', 'ignore'] })
    .toString()
    .trim();
} catch {
  /* 非 git 环境 */
}

const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}`;
const buildId = `${stamp}-${git}`;

const outPath = path.join(root, 'client/lib/build-info.ts');
const content = `/** 由 scripts/write-build-version.mjs 自动生成，请勿手改 */
export const APP_VERSION = ${JSON.stringify(version)};
export const BUILD_ID = ${JSON.stringify(buildId)};
`;

fs.writeFileSync(outPath, content, 'utf8');
console.log(`[write-build-version] ${version} · ${buildId}`);
