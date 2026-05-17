#!/usr/bin/env node
/**
 * 修复 Linux CI 上 @tailwindcss/oxide 缺少平台原生 binding（npm optional deps / npm ci 跨平台问题）
 */
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { arch, platform } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const CLIENT = join(ROOT, "client");

function linuxOxidePackage() {
  if (platform() !== "linux") return null;
  return arch() === "arm64"
    ? "@tailwindcss/oxide-linux-arm64-gnu"
    : "@tailwindcss/oxide-linux-x64-gnu";
}

function isInstalled(pkg) {
  return existsSync(join(CLIENT, "node_modules", pkg));
}

function runNpm(args) {
  const r = spawnSync("npm", args, {
    cwd: ROOT,
    stdio: "inherit",
    env: {
      ...process.env,
      npm_config_ignore_scripts: "false",
    },
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

function main() {
  const pkg = linuxOxidePackage();
  if (!pkg) return;

  if (isInstalled(pkg)) {
    console.log(`[ci] Tailwind 原生模块已存在: ${pkg}`);
    return;
  }

  console.log(`[ci] 缺少 ${pkg}，重新安装 client 依赖（含 optional）...`);
  runNpm([
    "install",
    "--prefix",
    "client",
    "--include=optional",
    "--no-audit",
    "--no-fund",
  ]);

  if (!isInstalled(pkg)) {
    console.log(`[ci] 显式安装 ${pkg}@4.3.0 ...`);
    runNpm(["install", "--prefix", "client", "--no-save", `${pkg}@4.3.0`]);
  }

  if (!isInstalled(pkg)) {
    console.error(`[ci] 仍无法安装 ${pkg}，构建将失败`);
    process.exit(1);
  }
  console.log(`[ci] Tailwind 原生模块就绪: ${pkg}`);
}

main();
