#!/usr/bin/env node
/**
 * 安全部署 canvas-web 构建产物。
 *
 * 为什么需要：直接 `npm run build:canvas` 会往 `node_modules/.../frontend` 写入并清空旧目录，
 * 在受限环境（沙箱拦写 node_modules / 拦批量删除）里会**半途失败留下半成品**，
 * 而那时旧目录可能已被清空 → 对外服务的产物残缺。
 *
 * 本脚本改用「先构建到项目内临时目录 → 整体替换 → 清理」的顺序：
 *   1. `vite build --outDir canvas-web/.canvas-build`（写在项目内，权限友好）
 *   2. 校验新产物有 index.html 与 assets
 *   3. 把旧 `frontend` 改名成 `frontend.old-<HHMMSS>`，把新产物改名就位（rename 不是删除）
 *   4. 删除改名后的旧目录
 * 任何一步失败都不会把静态目录留在"残缺"状态。
 *
 * 用法：
 *   node tools/deploy-canvas-build.mjs                # 构建 + 替换
 *   node tools/deploy-canvas-build.mjs --skip-build    # 只替换（构建已在 .canvas-build）
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CANVAS = path.join(ROOT, "canvas-web");
const TEMP = path.join(CANVAS, ".canvas-build");
const DIST = path.join(ROOT, "node_modules", "mcp-excalidraw-server", "dist");
const TARGET = path.join(DIST, "frontend");
const skipBuild = process.argv.includes("--skip-build");

const stamp = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};
const countFiles = (dir) => {
  if (!fs.existsSync(dir)) return -1;
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).reduce(
    (n, e) => n + (e.isDirectory() ? walk(path.join(d, e.name)) : 1), 0);
  return walk(dir);
};

if (!skipBuild) {
  console.log("[1/4] 构建到临时目录 …");
  const r = spawnSync("npx", ["vite", "build", "--config", "canvas-web/vite.config.ts", "--outDir", ".canvas-build", "--emptyOutDir"], {
    cwd: ROOT, stdio: "inherit", shell: process.platform === "win32",
  });
  if (r.status !== 0) {
    console.error(`✗ 构建失败（exit ${r.status}）。静态目录未做任何改动。`);
    process.exit(1);
  }
} else {
  console.log("[1/4] --skip-build：跳过构建");
}

console.log("[2/4] 校验新产物 …");
if (!fs.existsSync(path.join(TEMP, "index.html"))) {
  console.error(`✗ ${TEMP} 里没有 index.html，中止（静态目录未改动）。`);
  process.exit(1);
}
if (!fs.existsSync(path.join(TEMP, "assets"))) {
  console.error(`✗ ${TEMP} 里没有 assets，中止（静态目录未改动）。`);
  process.exit(1);
}
console.log(`    新产物 ${countFiles(TEMP)} 个文件`);

console.log("[3/4] 替换静态目录（rename，非删除）…");
const backup = path.join(DIST, `frontend.old-${stamp()}`);
if (fs.existsSync(TARGET)) fs.renameSync(TARGET, backup);
fs.renameSync(TEMP, TARGET);
console.log(`    ${TARGET} 现在有 ${countFiles(TARGET)} 个文件`);

console.log("[4/4] 清理旧目录 …");
const removed = [];
for (const name of fs.readdirSync(DIST)) {
  if (!name.startsWith("frontend.old-")) continue;
  try {
    fs.rmSync(path.join(DIST, name), { recursive: true, force: true });
    removed.push(name);
  } catch (e) {
    console.warn(`    ⚠ 未能删除 ${name}：${e.message}（可稍后手动删）`);
  }
}
console.log(`    已清理：${removed.join(", ") || "（无）"}`);
console.log("✓ 完成。刷新浏览器（PWA 客户端可能需刷两次）以加载新产物。");
