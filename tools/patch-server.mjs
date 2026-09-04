#!/usr/bin/env node
/**
 * Canvas Server 补丁脚本
 *
 * 给 mcp-excalidraw-server 的画布落盘函数（utils/persist.js）加"覆盖前轮转备份"：
 *   - 每次写 canvas-store.json 前，把当前文件复制到 backups/canvas-store-<时间戳>.json
 *   - 保留最近 20 份，超出自动清理
 *   - 目的：防止误 sync / 误清空覆盖用户画布后无法找回（幂等可重跑）
 *
 * start-canvas.bat 启动时自动执行；升级 mcp-excalidraw-server 后需重跑。
 * 用法：node tools/patch-server.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PERSIST = path.resolve(
  __dirname,
  "..",
  "node_modules",
  "mcp-excalidraw-server",
  "dist",
  "utils",
  "persist.js"
);

const OLD = `        const file = storeFilePath();
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const tmp = file + '.tmp';`;
const NEW = `        const file = storeFilePath();
        // pi-backup-patch: 覆盖前轮转备份（保留最近 20 份），防误覆盖丢画布
        try {
            const backupDir = path.join(path.dirname(file), 'backups');
            if (fs.existsSync(file)) {
                fs.mkdirSync(backupDir, { recursive: true });
                const stamp = new Date().toISOString().replace(/[:.]/g, '-');
                fs.copyFileSync(file, path.join(backupDir, 'canvas-store-' + stamp + '.json'));
                const backups = fs.readdirSync(backupDir).filter(function (f) { return f.indexOf('canvas-store-') === 0; }).sort();
                while (backups.length > 20) {
                    fs.unlinkSync(path.join(backupDir, backups.shift()));
                }
            }
        }
        catch (backupError) {
            console.warn('[persist] backup failed:', backupError.message);
        }
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const tmp = file + '.tmp';`;

if (!fs.existsSync(PERSIST)) {
  console.error(`[patch-server] 未找到 persist.js: ${PERSIST}`);
  process.exit(1);
}
let src = fs.readFileSync(PERSIST, "utf8");
if (src.includes("pi-backup-patch")) {
  console.log("[patch-server] 备份轮转已打过补丁，跳过");
} else if (src.includes(OLD)) {
  fs.writeFileSync(PERSIST, src.replace(OLD, NEW), "utf8");
  console.log("[patch-server] persist.js 已加覆盖前备份轮转（保留 20 份）");
} else {
  console.error("[patch-server] 未找到插入点标记，请人工检查 persist.js");
  process.exit(1);
}
console.log("[patch-server] 完成（重启 canvas server 后生效）");
