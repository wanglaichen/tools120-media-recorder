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
const is404Page =
  html.includes('next-error-h1') &&
  html.includes('This page could not be found') &&
  !html.includes('聚合工作台') &&
  !html.includes('音频采集');

if (is404Page) {
  console.error('[verify-static-export] index.html 内容是 404 页，构建异常');
  process.exit(1);
}

if (!html.includes('v0.') && !html.match(/v\d+\.\d+\.\d+/)) {
  console.warn('[verify-static-export] 警告: index.html 中未找到版本号标记');
}

if (fs.existsSync(path.join(dir, '404.html'))) {
  console.error('[verify-static-export] 根目录仍存在 404.html，请运行 postprocess-static-export.mjs');
  process.exit(1);
}

console.log('[verify-static-export] OK:', indexPath);
