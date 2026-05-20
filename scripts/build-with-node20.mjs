#!/usr/bin/env node
/**
 * Next 静态导出构建：当前 Node 不满足 Next 15 时，在 Linux CI 上自动下载 Node 20。
 * 由根目录 npm run client:build 调用，兼容 Gitee 网页旧流水线（npm ci + client:build）。
 */
import { spawnSync, execSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { homedir, platform, arch } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const CLIENT_DIR = join(ROOT, "client");
const REQUIRED = "20.18.0";

function versionOk(v) {
  const [major, minor] = v.replace(/^v/, "").split(".").map(Number);
  if (major >= 21) return true;
  if (major === 20 && minor >= 3) return true;
  if (major === 19 && minor >= 8) return true;
  if (major === 18 && minor >= 18) return true;
  return false;
}

function syncMiniMaxEnv() {
  const syncScript = join(ROOT, "scripts", "sync-minimax-env.mjs");
  const r = spawnSync(process.execPath, [syncScript], { cwd: ROOT, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status === null ? 1 : r.status);
}

function runNext(nodeBin) {
  syncMiniMaxEnv();
  const nextBin = join(CLIENT_DIR, "node_modules", "next", "dist", "bin", "next");
  const r = spawnSync(nodeBin, [nextBin, "build"], {
    cwd: CLIENT_DIR,
    stdio: "inherit",
    env: process.env,
  });
  process.exit(r.status === null ? 1 : r.status);
}

function linuxArch() {
  return arch() === "arm64" ? "linux-arm64" : "linux-x64";
}

async function ensureNode20() {
  const tarball = `node-v${REQUIRED}-${linuxArch()}`;
  const cacheDir = join(homedir(), ".cache", "tools020-node");
  const nodeBin = join(cacheDir, tarball, "bin", "node");

  if (existsSync(nodeBin)) return nodeBin;

  mkdirSync(cacheDir, { recursive: true });
  const url = `https://nodejs.org/dist/v${REQUIRED}/${tarball}.tar.xz`;
  const tmpXz = join(cacheDir, `${tarball}.tar.xz`);
  console.log(`[build] 下载 Node v${REQUIRED} ...`);
  execSync(`curl -fsSL "${url}" -o "${tmpXz}"`, { stdio: "inherit" });
  execSync(`tar -xJf "${tmpXz}" -C "${cacheDir}"`, { stdio: "inherit" });

  if (!existsSync(nodeBin)) {
    console.error("[build] Node 解压失败:", nodeBin);
    process.exit(1);
  }
  return nodeBin;
}

async function main() {
  const current = process.version;
  console.log("[build] 当前 Node:", current);
  console.log("[build] 工作目录:", CLIENT_DIR);

  const ensure = join(ROOT, "scripts", "ensure-tailwind-native.mjs");
  if (existsSync(ensure)) {
    const r = spawnSync(process.execPath, [ensure], { cwd: ROOT, stdio: "inherit" });
    if (r.status !== 0) process.exit(r.status ?? 1);
  }

  if (versionOk(current)) {
    runNext(process.execPath);
    return;
  }

  if (platform() !== "linux") {
    console.error(
      `[build] Node ${current} 不满足 Next.js 要求（需 ^18.18 || ^19.8 || >=20），请升级 Node。`,
    );
    process.exit(1);
  }

  const nodeBin = await ensureNode20();
  console.log("[build] 使用 Node:", execSync(`"${nodeBin}" -v`, { encoding: "utf8" }).trim());
  runNext(nodeBin);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
