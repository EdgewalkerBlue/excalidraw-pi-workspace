#!/usr/bin/env node
/**
 * 任务执行日志与回滚工具（配合 Web UI Reject）
 *
 * Pi 在执行文件/代码修改前记录操作到 .agent/execution-log.json，
 * 用户点击 Reject 时据此回滚（删除 Pi 创建的文件/目录、恢复被修改的文件）。
 *
 * 动作类型：
 *   file_create  创建文件        → 回滚：删除文件
 *   dir_create   创建目录        → 回滚：删除空目录（不递归，安全）
 *   file_write   修改已有文件    → 回滚：恢复备份的原内容
 *
 * 用法：
 *   node tools/exec-log.mjs record --action file_create --path "D:/x/y.txt"
 *   node tools/exec-log.mjs record --action dir_create  --path "D:/x"
 *   node tools/exec-log.mjs record --action file_write  --path "D:/x/y.txt"
 *   node tools/exec-log.mjs list
 *   node tools/exec-log.mjs rollback
 *   node tools/exec-log.mjs clear
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MARKER_DIR = path.resolve(__dirname, "..", ".agent");
const LOG_FILE = path.join(MARKER_DIR, "execution-log.json");
const BACKUP_DIR = path.join(MARKER_DIR, "backup");

function loadLog() {
  try {
    return JSON.parse(fs.readFileSync(LOG_FILE, "utf8"));
  } catch {
    return [];
  }
}
function saveLog(log) {
  fs.mkdirSync(MARKER_DIR, { recursive: true });
  fs.writeFileSync(LOG_FILE, JSON.stringify(log, null, 2), "utf8");
}
function argVal(args, key) {
  const i = args.indexOf(key);
  return i >= 0 && args[i + 1] ? args[i + 1] : null;
}

const cmd = process.argv[2];
const args = process.argv.slice(3);

if (cmd === "record") {
  const action = argVal(args, "--action");
  const target = argVal(args, "--path");
  if (!action || !target) {
    console.error("用法: exec-log.mjs record --action <file_create|dir_create|file_write> --path <绝对路径>");
    process.exit(2);
  }
  const log = loadLog();
  const entry = { ts: new Date().toISOString(), action, path: target };
  if (action === "file_write" && fs.existsSync(target)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const hash = crypto.createHash("sha1").update(target).digest("hex").slice(0, 12);
    const backupFile = path.join(BACKUP_DIR, `${hash}.bak`);
    fs.copyFileSync(target, backupFile);
    entry.backupFile = backupFile;
  }
  log.push(entry);
  saveLog(log);
  console.log(`已记录 [${action}] ${target}（共 ${log.length} 条）`);
} else if (cmd === "list") {
  const log = loadLog();
  if (log.length === 0) {
    console.log("执行日志为空");
  } else {
    console.log(`执行日志（${log.length} 条）：`);
    log.forEach((e, i) =>
      console.log(`  ${i + 1}. [${e.action}] ${e.path} @ ${e.ts}${e.backupFile ? " (有备份)" : ""}`)
    );
  }
} else if (cmd === "rollback") {
  const log = loadLog();
  if (log.length === 0) {
    console.log("无记录可回滚");
    process.exit(0);
  }
  console.log(`开始回滚 ${log.length} 条记录（倒序）...`);
  let ok = 0,
    fail = 0;
  for (const e of [...log].reverse()) {
    try {
      if (e.action === "file_create" && fs.existsSync(e.path)) {
        fs.unlinkSync(e.path);
        console.log(`  ✓ 删除文件 ${e.path}`);
        ok++;
      } else if (e.action === "dir_create" && fs.existsSync(e.path)) {
        fs.rmdirSync(e.path); // 仅删除空目录，安全
        console.log(`  ✓ 删除目录 ${e.path}`);
        ok++;
      } else if (e.action === "file_write" && e.backupFile && fs.existsSync(e.backupFile)) {
        fs.copyFileSync(e.backupFile, e.path);
        console.log(`  ✓ 恢复文件 ${e.path}`);
        ok++;
      } else {
        console.log(`  - 跳过 ${e.action} ${e.path}（目标不存在或无需处理）`);
        ok++;
      }
    } catch (err) {
      console.error(`  ✗ 回滚失败 ${e.action} ${e.path}: ${err.message}`);
      fail++;
    }
  }
  // 清理备份目录
  try {
    fs.rmSync(BACKUP_DIR, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  saveLog([]);
  console.log(`回滚完成: 成功 ${ok}，失败 ${fail}。日志已清空。`);
} else if (cmd === "clear") {
  saveLog([]);
  try {
    fs.rmSync(BACKUP_DIR, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  console.log("执行日志与备份已清除");
} else {
  console.log(`用法:
  record --action <file_create|dir_create|file_write> --path <绝对路径>   记录操作
  list                                                                    查看日志
  rollback                                                                回滚所有记录
  clear                                                                   清空日志`);
  process.exit(cmd ? 2 : 0);
}
