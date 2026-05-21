/**
 * 校验静态导出产物：根目录 index.html 必须是首页，不能是 Next 默认 404。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = process.argv[2]
  ? path.resolve(process.cwd(), process.argv[2])
  : path.join(root, 'client', 'out');

const indexPath = path.join(dir, 'index.html');
if (!fs.existsSync(indexPath)) {
  console.error(`[verify-static-export] 缺少 ${indexPath}`);
  process.exit(1);
}

const html = fs.readFileSync(indexPath, 'utf8');

let expectedVersion = JSON.parse(
  fs.readFileSync(path.join(root, 'client/package.json'), 'utf8'),
).version;
let expectedBuildId = '';

const buildInfoPath = path.join(root, 'client/lib/build-info.ts');
if (fs.existsSync(buildInfoPath)) {
  const src = fs.readFileSync(buildInfoPath, 'utf8');
  const v = src.match(/APP_VERSION = "([^"]+)"/);
  const b = src.match(/BUILD_ID = "([^"]+)"/);
  if (v) expectedVersion = v[1];
  if (b) expectedBuildId = b[1];
}

const envProd = path.join(root, 'client/.env.production');
if (fs.existsSync(envProd)) {
  const env = fs.readFileSync(envProd, 'utf8');
  const v = env.match(/^NEXT_PUBLIC_APP_VERSION=(.+)$/m);
  const b = env.match(/^NEXT_PUBLIC_BUILD_ID=(.+)$/m);
  if (v) expectedVersion = v[1].trim();
  if (b) expectedBuildId = b[1].trim();
}

const is404Page =
  html.includes('next-error-h1') &&
  html.includes('This page could not be found') &&
  !html.includes('聚合工作台');

if (is404Page) {
  console.error('[verify-static-export] index.html 内容是 404 页，构建异常');
  process.exit(1);
}

if (!html.includes('聚合工作台')) {
  console.error('[verify-static-export] index.html 缺少「聚合工作台」');
  process.exit(1);
}

const hasVersion =
  html.includes(expectedVersion) ||
  html.includes(`v${expectedVersion}`) ||
  html.includes(`聚合工作台 v${expectedVersion}`);

const hasBuildId = expectedBuildId ? html.includes(expectedBuildId) : true;

if (!hasVersion) {
  console.error(
    `[verify-static-export] index.html 未包含版本号 ${expectedVersion}（请确认 write-build-version 已写入 .env.production）`,
  );
  process.exit(1);
}

if (!hasBuildId) {
  console.error(`[verify-static-export] index.html 未包含构建号 ${expectedBuildId}`);
  process.exit(1);
}

if (fs.existsSync(path.join(dir, '404.html'))) {
  console.error('[verify-static-export] 根目录仍存在 404.html，请运行 postprocess-static-export.mjs');
  process.exit(1);
}

console.log(`[verify-static-export] OK: ${indexPath} (${expectedVersion} · ${expectedBuildId})`);
