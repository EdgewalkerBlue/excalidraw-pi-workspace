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

// pi-clip: 推送全量场景时把绑定箭头端点裁剪到绑定元素边缘外 gap 处。
// 该前端 bundle 的全量还原路径（initial_elements / HTTP GET 加载）渲染绑定箭头时
// 不做边缘裁剪（端点按原始 points 画进元素内部），单元素事件路径则正常。
// 在 server 推送侧预裁剪 points 可让两条路径渲染一致；存储仍保留原始 points，
// 交互（拖动端点/元素）与 reconcile 语义不受影响。
export function clipArrowsForRender(elements) {
    const arr = Array.isArray(elements) ? elements : Array.from(elements.values());
    const byId = new Map(arr.map(e => [e.id, e]));
    const clipEnd = (movingPt, otherPt, binding) => {
        const t = byId.get(binding && binding.elementId);
        if (!t || typeof t.x !== 'number' || typeof t.width !== 'number' || typeof t.height !== 'number') return movingPt;
        const gap = typeof binding.gap === 'number' && binding.gap >= 0 ? binding.gap : 6;
        const L = t.x - gap, R = t.x + t.width + gap, T = t.y - gap, B2 = t.y + t.height + gap;
        const px = movingPt.x, py = movingPt.y;
        if (px <= L || px >= R || py <= T || py >= B2) return movingPt; // 已在扩展边界外
        const ux = otherPt.x - px, uy = otherPt.y - py;
        const len = Math.hypot(ux, uy) || 1;
        const dx = ux / len, dy = uy / len; // 指向箭头另一端
        const ts = [];
        if (dx !== 0) { ts.push((px - L) / dx, (px - R) / dx); }
        if (dy !== 0) { ts.push((py - T) / dy, (py - B2) / dy); }
        const tExit = Math.min.apply(null, ts.filter(function (v) { return v > 0.0001; }));
        if (!Number.isFinite(tExit)) return movingPt;
        return { x: px + tExit * dx, y: py + tExit * dy };
    };
    const out = [];
    for (const el of arr) {
        if (!el || el.type !== 'arrow' || !Array.isArray(el.points) || el.points.length !== 2) { out.push(el); continue; }
        try {
            const pts = [el.points[0].slice(), el.points[1].slice()];
            const start = { x: el.x + pts[0][0], y: el.y + pts[0][1] };
            const end = { x: el.x + pts[1][0], y: el.y + pts[1][1] };
            const s2 = clipEnd(start, end, el.startBinding);
            const e2 = clipEnd(end, start, el.endBinding);
            pts[0] = [s2.x - el.x, s2.y - el.y];
            pts[1] = [e2.x - el.x, e2.y - el.y];
            out.push(Object.assign({}, el, {
                points: pts,
                width: Math.abs(pts[1][0] - pts[0][0]),
                height: Math.abs(pts[1][1] - pts[0][1])
            }));
        }
        catch (e) { out.push(el); }
    }
    return out;
}
`;

// ═══════ 2) server.js 注入 ═══════
const SERVER = path.join(PKG, "server.js");

function apply() {
  if (!fs.existsSync(path.dirname(PERSIST))) fs.mkdirSync(path.dirname(PERSIST), { recursive: true });
  if (!fs.existsSync(SERVER)) { console.error(`[patch-server] 未找到 server.js: ${SERVER}`); process.exit(1); }
  let s = fs.readFileSync(SERVER, "utf8").replace(/\r\n/g, "\n");

  if (!fs.existsSync(PERSIST) || !fs.readFileSync(PERSIST, "utf8").includes("clipArrowsForRender")) {
    fs.writeFileSync(PERSIST, PERSIST_SRC, "utf8");
    console.log("[patch-server] persist.js 已创建/升级（落盘+轮转备份+箭头渲染裁剪）");
  } else {
    console.log("[patch-server] persist.js 已存在");
  }

  // (e) 箭头渲染裁剪：import 扩展 + GET/initial_elements 推送侧 clip
  if (!s.includes("clipArrowsForRender(elements)")) {
    const impOld = "import { saveElementsToDisk, loadElementsFromDisk } from './utils/persist.js';";
    if (s.includes(impOld)) {
      s = s.replace(impOld, "import { saveElementsToDisk, loadElementsFromDisk, clipArrowsForRender } from './utils/persist.js';");
    }
    // import 缺失（全新 server.js）时由 (a) 步稍后插入完整三导出，这里不报错
    // GET /api/elements 响应（页面 HTTP 加载路径）
    const getOld = "const elementsArray = Array.from(elements.values());";
    if (s.includes(getOld)) {
      s = s.split(getOld).join("const elementsArray = clipArrowsForRender(elements);");
    }
    // WS 新连接初始推送
    const wsOld = "elements: Array.from(elements.values()),";
    s = s.split(wsOld).join("elements: clipArrowsForRender(elements),");
    fs.writeFileSync(SERVER, s, "utf8"); // 立即落盘：后续 skip 分支 return 不丢本次注入
    console.log("[patch-server] 箭头渲染裁剪已注入（GET + initial_elements）");
  }

  if (s.includes("pi-sync-guard v6") && s.includes("storm-guard")) { console.log("[patch-server] server.js 已是 v6+storm-guard，跳过"); return; }

  // v3/v4/v5/v6(无 storm-guard) → v6 就地升级：整块替换 guard（元素级 LWW + 可见性删除 + 单元素增量广播）
  if (s.includes("pi-sync-guard")) {
    const gStart = s.indexOf("        // ── pi-sync-guard");
    const endMarks = [
      "beforeCount, afterCount: elements.size, client: _clientId });", // v6（无 storm-guard）结尾
      "beforeCount, afterCount: elements.size, keptGrace: _keptGrace.length });", // v5 结尾
      "count: _writes.length, syncedAt: new Date().toISOString(), beforeCount, afterCount: elements.size, keptNewer: _keptNewer.length });", // v4 结尾
      "count: _writes.length, syncedAt: new Date().toISOString(), beforeCount, afterCount: elements.size });", // v3 结尾
    ];
    let gEnd = -1, hitMark = null;
    for (const m of endMarks) { const i = s.indexOf(m, gStart); if (i >= 0) { gEnd = i; hitMark = m; break; } }
    if (gStart < 0 || gEnd < 0) { console.error("[patch-server] 旧 guard 块定位失败，请人工检查"); process.exit(1); }
    s = s.slice(0, gStart) + GUARD_CORE + "\n" + s.slice(gEnd + hitMark.length);
    fs.writeFileSync(SERVER, s, "utf8");
    console.log("[patch-server] sync-guard → v6 已升级（元素级 LWW + 可见性删除 + 单元素增量广播）");
    return;
  }

  // (a) import persist（插到 import 区）
  if (!s.includes("utils/persist")) {
    const i = s.indexOf("import { writePidFile");
    if (i < 0) { console.error("[patch-server] import 锚点缺失"); process.exit(1); }
    s = s.slice(0, i) + "import { saveElementsToDisk, loadElementsFromDisk, clipArrowsForRender } from './utils/persist.js';\n" + s.slice(i);
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

const GUARD_CORE = `        // ── pi-sync-guard v6: 元素级 LWW 合并 / 可见性删除 / 单元素增量广播 ──
        // 借鉴 Excalidraw 官方协作语义（Google Docs 用 OT、Figma 用属性级 LWW，此处取同生态的
        // 官方方案）：whole-element last-writer-wins——version 高者胜，平局比 updated，再比
        // versionNonce（低者胜）；变更按单元素事件广播（element_created/updated/deleted），
        // 绝不整场景替换（initial_elements 仅在新 WS 连接时推送），客户端防抖期内未上传的
        // 本地编辑不会被广播覆盖；删除按"见过它的客户端缺席 + 宽限期"判定——从未见过某元素
        // 的客户端缺席它不构成删除证据，根治多端旧场景竞态。
        const beforeCount = elements.size;
        const _clientId = String((req.headers && req.headers['x-client-id']) || 'unknown').slice(0, 64);
        const _now = Date.now();
        const _elUpdated = (el) => { const v = el && (el.updated ?? el.updatedAt); if (v == null) return 0; const n = Number(v); if (Number.isFinite(n) && n > 0) return n; const p = Date.parse(v); return Number.isFinite(p) ? p : 0; };
        const _elVersion = (el) => Number(el && el.version) || 0;
        const _elNonce = (el) => Number(el && el.versionNonce) || 0;
        // a) 空 sync：静默 noop（v6 缺席不删除，空场景无威胁；新端等 WS 推送全量）
        if (!Array.isArray(frontendElements) || frontendElements.length === 0) {
            if (beforeCount > 0) logger.info('[sync-guard] empty sync ignored (noop, ' + beforeCount + ' kept)');
            return res.json({ success: true, message: 'noop', count: beforeCount, noop: true, beforeCount, afterCount: beforeCount });
        }
        // b) 整体等价 noop 快速路径
        const _normKeys = ['updated', 'updatedAt', 'versionNonce', 'syncedAt', 'source', 'syncTimestamp', 'version', '_piLastGoodSyncAt', '_piAbsentSince', '_piSeenClients'];
        const _normEl = (el) => { if (!el || typeof el !== 'object') return String(el); const c = {}; for (const k of Object.keys(el)) if (!_normKeys.includes(k)) c[k] = el[k]; return JSON.stringify(c); };
        if (frontendElements.length === elements.size && frontendElements.every((el) => { const ex = elements.get(el.id); return ex && _normEl(ex) === _normEl(el); })) {
            return res.json({ success: true, message: 'noop', count: elements.size, noop: true, beforeCount, afterCount: elements.size });
        }
        // c) 元素级 LWW 合并（不整体 clear；server 逐元素裁决，旧版本不回写）
        const _created = []; const _updated = [];
        const _incomingIds = new Set();
        for (const element of frontendElements) {
            try {
                if (!element || typeof element !== 'object' || !element.id) continue;
                _incomingIds.add(element.id);
                const existing = elements.get(element.id);
                if (existing) {
                    // 可见性先记：该客户端场景里有此元素（即使其版本落败）
                    const seen0 = new Set(existing._piSeenClients || []); seen0.add(_clientId);
                    existing._piSeenClients = Array.from(seen0).slice(-8);
                    const iv = _elVersion(element), sv = _elVersion(existing);
                    let incomingWins;
                    if (iv !== sv) incomingWins = iv > sv;
                    else {
                        const iu = _elUpdated(element), su = _elUpdated(existing);
                        if (iu !== su) incomingWins = iu > su;
                        else incomingWins = _elNonce(element) < _elNonce(existing); // 平局取低 nonce（Excalidraw 惯例）
                    }
                    if (!incomingWins) continue; // server 版本胜：跳过，不回写旧数据
                }
                if (existing && _normEl(element) === _normEl(existing)) continue; // storm-guard: 内容等价（仅 updated/versionNonce 等元数据差异）不回写不广播——前端每次 sync 会重打全部 updated，若照单全收会形成"全量 updated 广播 → 前端标脏 → 再 sync"的风暴
                const processedElement = { ...element, syncedAt: new Date().toISOString(), source: 'frontend_sync', syncTimestamp: timestamp, version: _elVersion(element) || _elVersion(existing) || 1 };
                const seen = new Set(processedElement._piSeenClients || (existing && existing._piSeenClients) || []);
                seen.add(_clientId);
                processedElement._piSeenClients = Array.from(seen).slice(-8);
                delete processedElement._piAbsentSince;
                elements.set(element.id, processedElement);
                (existing ? _updated : _created).push(processedElement);
            }
            catch (elementError) { logger.warn('[sync-guard] failed to process element:', elementError); }
        }
        // d) 删除判定：缺席 + 该客户端曾见过它 + 连续缺席超宽限期（从未见过 → 永不删）
        const ABSENT_GRACE_MS = 120000;
        const _deleted = [];
        for (const [id, ex] of Array.from(elements.entries())) {
            if (_incomingIds.has(id)) continue;
            const seen = ex._piSeenClients || [];
            const knows = seen.includes(_clientId) || (_clientId === 'unknown' && seen.length > 0);
            if (!knows) continue;
            if (typeof ex._piAbsentSince !== 'number') ex._piAbsentSince = _now;
            if (_now - ex._piAbsentSince >= ABSENT_GRACE_MS) {
                elements.delete(id);
                _deleted.push(id);
            }
        }
        logger.info(\`[sync-guard] sync from \${_clientId}: +\${_created.length} new, ~\${_updated.length} upd, -\${_deleted.length} del (before \${beforeCount} -> after \${elements.size})\`);
        // e) 单元素增量广播（element_* 事件走前端的单元素 merge 路径，不整场景替换）
        for (const el of _created) broadcast({ type: 'element_created', element: el });
        for (const el of _updated) broadcast({ type: 'element_updated', element: el });
        for (const id of _deleted) broadcast({ type: 'element_deleted', elementId: id });
        // 4. Return sync results
        saveElementsToDisk(elements);
        res.json({ success: true, message: \`Synced \${_created.length + _updated.length} elements\`, count: _created.length + _updated.length, syncedAt: new Date().toISOString(), beforeCount, afterCount: elements.size, client: _clientId });`;

apply();
console.log("[patch-server] 完成（重启 canvas server 后生效）");
