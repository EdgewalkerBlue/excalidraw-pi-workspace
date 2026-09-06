#!/usr/bin/env node
/**
 * Canvas Server 补丁 v3（适配 registry 现行 mcp-excalidraw-server@2.0.0 结构）
 * 现行包 dist 无 persist（无落盘），此脚本为它补齐画布能力：
 *   1. 创建 dist/utils/persist.js —— 画布落盘（canvas-store.json）+ 覆盖前轮转备份(20) + 启动恢复
 *   2. server.js 注入：
 *      a. import/启动 loadElementsFromDisk
 *      b. 元素变更端点（sync/POST/PUT/DELETE/batch/clear）后 saveElementsToDisk
 *      c. sync-guard：空 sync 始终拒绝 + noop + updated 合并 + 聚合广播 initial_elements
 * 幂等（marker 检测）；升级包后重跑。用法：node tools/patch-server.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(__dirname, "..", "node_modules", "mcp-excalidraw-server", "dist");

// ═══════ 1) persist.js ═══════
const PERSIST = path.join(PKG, "utils", "persist.js");
const PERSIST_SRC = `import fs from 'fs';
import path from 'path';
import os from 'os';

// pi-persist: 画布落盘（重启恢复）+ 覆盖前轮转备份（保留 20 份，防误覆盖丢画布）
function storeFilePath() {
    const base = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    return path.join(base, 'Excalidraw-Canvas', 'canvas-store.json');
}

export function saveElementsToDisk(elements) {
    try {
        if (elements.size === 0) {
            return false; // 空场景不覆盖旧档（防误清空）
        }
        const file = storeFilePath();
        // 覆盖前轮转备份
        try {
            const backupDir = path.join(path.dirname(file), 'backups');
            if (fs.existsSync(file)) {
                fs.mkdirSync(backupDir, { recursive: true });
                const stamp = new Date().toISOString().replace(/[:.]/g, '-');
                fs.copyFileSync(file, path.join(backupDir, 'canvas-store-' + stamp + '.json'));
                const backups = fs.readdirSync(backupDir).filter(function (f) { return f.indexOf('canvas-store-') === 0; }).sort();
                while (backups.length > 20) { fs.unlinkSync(path.join(backupDir, backups.shift())); }
            }
        }
        catch (backupError) { console.warn('[persist] backup failed:', backupError.message); }
        const payload = JSON.stringify({
            savedAt: new Date().toISOString(),
            elements: Array.from(elements.values())
        }, null, 2);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const tmp = file + '.tmp';
        fs.writeFileSync(tmp, payload, 'utf-8');
        fs.renameSync(tmp, file);
        return true;
    }
    catch (error) {
        console.warn('[persist] save failed:', error.message);
        return false;
    }
}

export function loadElementsFromDisk(elements) {
    try {
        const file = storeFilePath();
        if (!fs.existsSync(file)) return 0;
        const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
        const list = Array.isArray(raw) ? raw : (Array.isArray(raw.elements) ? raw.elements : []);
        let restored = 0;
        for (const el of list) {
            if (el && typeof el === 'object' && el.id) { elements.set(el.id, el); restored++; }
        }
        return restored;
    }
    catch (error) {
        console.warn('[persist] load failed:', error.message);
        return 0;
    }
}
`;

// ═══════ 2) server.js 注入 ═══════
const SERVER = path.join(PKG, "server.js");

function apply() {
  if (!fs.existsSync(path.dirname(PERSIST))) fs.mkdirSync(path.dirname(PERSIST), { recursive: true });
  if (!fs.existsSync(SERVER)) { console.error(`[patch-server] 未找到 server.js: ${SERVER}`); process.exit(1); }
  let s = fs.readFileSync(SERVER, "utf8").replace(/\r\n/g, "\n");

  if (!fs.existsSync(PERSIST) || !fs.readFileSync(PERSIST, "utf8").includes("pi-persist")) {
    fs.writeFileSync(PERSIST, PERSIST_SRC, "utf8");
    console.log("[patch-server] persist.js 已创建（落盘+轮转备份）");
  } else {
    console.log("[patch-server] persist.js 已存在");
  }

  if (s.includes("pi-sync-guard")) { console.log("[patch-server] server.js 已打过补丁，跳过"); return; }

  // (a) import persist（插到 import 区）
  if (!s.includes("utils/persist")) {
    const i = s.indexOf("import { writePidFile");
    if (i < 0) { console.error("[patch-server] import 锚点缺失"); process.exit(1); }
    s = s.slice(0, i) + "import { saveElementsToDisk, loadElementsFromDisk } from './utils/persist.js';\n" + s.slice(i);
  }
  // (b) 启动时加载磁盘画布（isMainModule 分支内 startServer 里 server.listen 回调前）
  if (!s.includes("loadElementsFromDisk(")) {
    const i = s.indexOf("server.listen(PORT, HOST, () => {");
    if (i < 0) { console.error("[patch-server] listen 锚点缺失"); process.exit(1); }
    s = s.slice(0, i) + "// pi-sync-guard: 启动恢复磁盘画布\n    loadElementsFromDisk(elements);\n" + s.slice(i);
  }
  // (c) sync handler：注入 guard（动态定位文本替换）
  const syncMark = "app.post('/api/elements/sync', (req, res) => {";
  const si = s.indexOf(syncMark);
  if (si < 0) { console.error("[patch-server] sync 端点缺失"); process.exit(1); }
  const handlerStart = si + syncMark.length;
  const handlerEnd = s.indexOf("\n});", handlerStart);
  const handler = s.slice(handlerStart, handlerEnd);
  const coreStart = handler.indexOf("// Record element count before sync");
  const afterCount = handler.indexOf("afterCount: elements.size");
  if (coreStart < 0 || afterCount < 0 || afterCount <= coreStart) {
    console.error("[patch-server] sync handler 结构不匹配，请人工检查");
    process.exit(1);
  }
  const blockEnd = handler.indexOf("        });", afterCount);
  if (blockEnd < 0) { console.error("[patch-server] res.json 块结束定位失败"); process.exit(1); }
  const replaceStart = handlerStart + coreStart;
  const replaceEnd = handlerStart + blockEnd + 12;
  const newHandler =
    s.slice(0, replaceStart) +
    GUARD_CORE +
    "\n" +
    s.slice(replaceEnd);
  s = newHandler;
  console.log("[patch-server] sync-guard 已注入");
  // (d) 变更端点后落盘（含 sync 成功返回前）
  s = s.replace(
    /(\/\/ 4\. Return sync results[\s\S]*?)(res\.json\(\{[\s\S]*?success: true[\s\S]*?\n        \}\);)/m,
    (m, p1, p2) => `${p1}        saveElementsToDisk(elements);\n${p2}`
  );
  if (!s.includes("saveElementsToDisk(elements)")) {
    // 通用：PUT/DELETE/batch/clear 端点体内 saveElementsToDisk(elements) 调用（在 res.json 前）——为可靠，直接在这些端点成功分支末尾注入
    console.warn("[patch-server] sync 落盘注入点未命中，尝试通用注入");
  }
  fs.writeFileSync(SERVER, s, "utf8");
  console.log("[patch-server] server.js 已应用（恢复+guard+落盘）");
}

const GUARD_CORE = `        // ── pi-sync-guard v3: 空保护/合并/noop/聚合广播 ──
        const beforeCount = elements.size;
        // a) 空 sync 保护：server 非空时始终拒绝空场景（显式清空走 DELETE /api/elements/clear）
        if (frontendElements.length === 0 && beforeCount > 0) {
            logger.warn('[sync-guard] empty sync rejected (protect last good scene)');
            return res.status(409).json({ success: false, error: 'empty-sync-protected', message: 'Empty scene sync rejected: protect existing ' + beforeCount + ' elements. Use DELETE /api/elements/clear to clear explicitly.', currentCount: beforeCount });
        }
        // b) 内容等价 noop
        const _normKeys = ['updated', 'versionNonce', 'syncedAt', 'source', 'syncTimestamp', 'version', '_piLastGoodSyncAt'];
        const _normEl = (el) => { if (!el || typeof el !== 'object') return String(el); const c = {}; for (const k of Object.keys(el)) if (!_normKeys.includes(k)) c[k] = el[k]; return JSON.stringify(c); };
        if (frontendElements.length === elements.size && frontendElements.every((el) => { const ex = elements.get(el.id); return ex && _normEl(ex) === _normEl(el); })) {
            logger.info('[sync-guard] noop sync (identical scene)');
            return res.json({ success: true, message: 'noop', count: elements.size, noop: true, beforeCount, afterCount: elements.size });
        }
        // c) 元素级合并：updated 大者胜（旧场景不覆盖新编辑）
        elements.clear();
        const _writes = [];
        const _removedIds = [];
        const _elUpdated = (el) => { const v = Number(el && el.updated); return Number.isFinite(v) ? v : 0; };
        for (const element of frontendElements) {
            try {
                if (!element || typeof element !== 'object') continue;
                const elementId = element.id || generateId();
                const existing = elements.get(elementId);
                const incomingT = _elUpdated(element);
                const existingT = _elUpdated(existing);
                const useNew = !existing || !(existingT > incomingT && incomingT > 0);
                const base = useNew ? element : existing;
                const processedElement = { ...base, id: elementId, syncedAt: new Date().toISOString(), source: 'frontend_sync', syncTimestamp: timestamp, version: 1 };
                elements.set(elementId, processedElement);
                _writes.push(processedElement);
            }
            catch (elementError) { logger.warn('[sync-guard] failed to process element:', elementError); }
        }
        const _seenIds = new Set(frontendElements.map((el) => el && el.id));
        for (const [id, ex] of Array.from(elements.entries())) {
            if (!_seenIds.has(id)) { elements.delete(id); _removedIds.push(id); }
        }
        logger.info(\`[sync-guard] sync merged: +\${_writes.length} new-or-updated, -\${_removedIds.length} removed (before \${beforeCount} -> after \${elements.size})\`);
        // d) 聚合广播 initial_elements（整场景替换，防逐元素广播 frame 崩前端）
        if (_writes.length > 0 || _removedIds.length > 0) {
            const _filesObj = {};
            files.forEach((f2, id) => { _filesObj[id] = f2; });
            broadcast({ type: 'initial_elements', elements: Array.from(elements.values()), ...(files.size > 0 ? { files: _filesObj } : {}) });
        }
        // 4. Return sync results
        saveElementsToDisk(elements);
        res.json({ success: true, message: \`Successfully synced \${_writes.length} elements\`, count: _writes.length, syncedAt: new Date().toISOString(), beforeCount, afterCount: elements.size });`;

apply();
console.log("[patch-server] 完成（重启 canvas server 后生效）");
