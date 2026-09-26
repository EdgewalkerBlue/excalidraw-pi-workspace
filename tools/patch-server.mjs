#!/usr/bin/env node
/**
 * Canvas Server 补丁 v3（适配 registry 现行 mcp-excalidraw-server@2.0.0 结构）
 * 现行包 dist 无 persist（无落盘），此脚本为它补齐画布能力：
 *   1. 创建 dist/utils/persist.js —— 画布落盘（canvas-store.json）+ 覆盖前轮转备份(20) + 启动恢复
 *   2. server.js 注入：
 *      a. import/启动 loadElementsFromDisk
 *      b. 变更端点成功路径 saveElementsToDisk（sync/POST/PUT/DELETE/batch/clear，
 *         T-20260924-003；from-mermaid 不直接改 store 故不在列）
 *      c. sync-guard v7：空 sync noop + 等价 noop + 缩水闸门（409 拒绝远小于服务端的
 *         上行，防「客户端异常空画布 → 宽限期后批量删除服务端场景」）+ 元素级 LWW
 *         合并 + 可见性删除 + 单元素增量广播
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

// pi-appearance: 外观（主题模式 + 画布底色）持久化（多端一致，T-20260924-001）。
// 与画布元素分文件存放（appearance.json），避免动 canvas-store.json 的读写契约。
function appearanceFilePath() {
    const base = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    return path.join(base, 'Excalidraw-Canvas', 'appearance.json');
}

export function loadAppearanceFromDisk() {
    try {
        const file = appearanceFilePath();
        if (!fs.existsSync(file)) return null;
        const j = JSON.parse(fs.readFileSync(file, 'utf-8'));
        return j && typeof j === 'object' ? j : null;
    }
    catch (error) {
        console.warn('[persist] appearance load failed:', error.message);
        return null;
    }
}

export function saveAppearanceToDisk(appearance) {
    try {
        const file = appearanceFilePath();
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const tmp = file + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(Object.assign({}, appearance, { savedAt: new Date().toISOString() }), null, 2), 'utf-8');
        fs.renameSync(tmp, file);
        return true;
    }
    catch (error) {
        console.warn('[persist] appearance save failed:', error.message);
        return false;
    }
}

// pi-clip: 推送全量场景时把绑定箭头端点裁剪到绑定元素边缘外 gap 处。
// 该前端 bundle 的全量还原路径（initial_elements / HTTP GET 加载）渲染绑定箭头时
// 不做边缘裁剪（端点按原始 points 画进元素内部），单元素事件路径则正常。
// 在 server 推送侧预裁剪 points 可让两条路径渲染一致；存储仍保留原始 points，
// 交互（拖动端点/元素）与 reconcile 语义不受影响。
// v2（2026-09-26）：修正参数化求交符号错误——原实现 (px-L)/dx 符号颠倒，端点落在
// 绑定框扩展范围内时会被推到错误的对侧边界（箭头被拉长数倍贯穿盒子）。
// UI 绘制的箭头端点恰在边界上（outside 检查跳过）从未触发；回灌数据的端点略进入
// 扩展框即暴露。正确公式：射线 p+t·d 与边界线相交 t=(L-px)/dx 等，取最小正 t。
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
        if (dx !== 0) { ts.push((L - px) / dx, (R - px) / dx); }
        if (dy !== 0) { ts.push((T - py) / dy, (B2 - py) / dy); }
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

  if (!fs.existsSync(PERSIST)
    || !fs.readFileSync(PERSIST, "utf8").includes("clipArrowsForRender")
    || !fs.readFileSync(PERSIST, "utf8").includes("loadAppearanceFromDisk")
    || !fs.readFileSync(PERSIST, "utf8").includes("正确公式：射线")) {
    fs.writeFileSync(PERSIST, PERSIST_SRC, "utf8");
    console.log("[patch-server] persist.js 已创建/升级（落盘+轮转备份+箭头渲染裁剪v2+外观持久化）");
  } else {
    console.log("[patch-server] persist.js 已存在");
  }

  // types.js：类型白名单补 frame（T-20260905-007）。官方 Excalidraw 支持 frame 工具；
  // 缺它时 agent 经 POST /api/elements、batch 写 frame 会被 CreateElementSchema 的
  // z.enum / validateElement 拒绝。UI 手绘走 /sync（本就无类型校验），不受此影响。
  {
    const TYPES = path.join(PKG, "types.js");
    if (!fs.existsSync(TYPES)) {
      console.warn("[patch-server] 未找到 types.js，frame 白名单跳过");
    } else {
      let t = fs.readFileSync(TYPES, "utf8");
      if (t.includes("FRAME: 'frame'")) {
        console.log("[patch-server] types.js 已含 frame，跳过");
      } else if (t.includes("IMAGE: 'image'")) {
        t = t.replace("IMAGE: 'image'", "IMAGE: 'image',\n    FRAME: 'frame'");
        fs.writeFileSync(TYPES, t, "utf8");
        console.log("[patch-server] types.js 白名单已加 frame");
      } else {
        console.warn("[patch-server] types.js IMAGE 锚点未命中，frame 白名单未加");
      }
    }
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

  // (f) 变更端点成功路径落盘（pi-persist-endpoints，T-20260924-003）：
  //     此前仅 /sync guard 内有 saveElementsToDisk，REST/MCP 的变更重启即丢。
  //     锚点取端点起始行后第一个 res.json({ —— 各端点错误路径均为 res.status(N).json，
  //     不会误锚；幂等靠「锚点前 120 字符已含调用」判定。
  {
    const PERSIST_CALL = "saveElementsToDisk(elements);";
    const EP_MARKERS = [
      "app.post('/api/elements', (req, res) => {",
      "app.put('/api/elements/:id', (req, res) => {",
      "app.delete('/api/elements/clear', (req, res) => {",
      "app.delete('/api/elements/:id', (req, res) => {",
      "app.post('/api/elements/batch', (req, res) => {",
    ];
    let persisted = 0;
    for (const marker of EP_MARKERS) {
      const start = s.indexOf(marker);
      if (start < 0) { console.warn("[patch-server] 端点锚点缺失，跳过: " + marker); continue; }
      const rj = s.indexOf("res.json({", start);
      if (rj < 0) { console.warn("[patch-server] res.json 锚点缺失，跳过: " + marker); continue; }
      if (s.slice(Math.max(0, rj - 120), rj).includes(PERSIST_CALL)) { persisted++; continue; }
      s = s.slice(0, rj) + PERSIST_CALL + "\n        " + s.slice(rj);
      persisted++;
    }
    if (persisted > 0) {
      fs.writeFileSync(SERVER, s, "utf8");
      console.log("[patch-server] 变更端点落盘已注入（" + persisted + "/5）");
    }
  }

  // (g) 官方构建一键更新端点（pi-upstream-update）：画布徽标点击 → 安装官方包 →
  //     同步基线 → 安全重构建。锚点为 sync/status 端点（官方文本，结构稳定）；
  //     幂等靠块内 marker。未来 v1→v2 升级参考 guard 的整块替换模式。
  {
    const UPD_MARK = "// Sync status endpoint\napp.get('/api/sync/status', (req, res) => {";
    const i = s.indexOf(UPD_MARK);
    if (i < 0) {
      console.warn("[patch-server] sync/status 锚点缺失，跳过 upstream-update 注入");
    } else if (s.includes("pi-upstream-update")) {
      console.log("[patch-server] upstream-update 端点已存在，跳过");
    } else {
      s = s.slice(0, i) + UPSTREAM_UPDATE_BLOCK + "\n" + s.slice(i);
      fs.writeFileSync(SERVER, s, "utf8");
      console.log("[patch-server] upstream-update 端点已注入（apply-update / update-status）");
    }
  }

  // (h) import 行补外观函数（persist.js 升级到含 appearance 后的配套，幂等）。
  //     注意必须在 v7 早退之前：已是 v7 的 server 不会走后面 (a) 的完整注入。
  {
    const imp3 = "import { saveElementsToDisk, loadElementsFromDisk, clipArrowsForRender } from './utils/persist.js';";
    const imp5 = "import { saveElementsToDisk, loadElementsFromDisk, clipArrowsForRender, loadAppearanceFromDisk, saveAppearanceToDisk } from './utils/persist.js';";
    if (s.includes(imp3)) {
      s = s.replace(imp3, imp5);
      fs.writeFileSync(SERVER, s, "utf8");
      console.log("[patch-server] persist import 行已补外观函数");
    }
  }

  // (i) 外观多端一致端点（pi-appearance-sync，T-20260924-001）：
  //     GET/POST /api/appearance + WS appearance_updated 广播。
  //     主题只认 light|dark|system，底色只认 #rrggbb；改动即落盘 + 全客户端广播。
  {
    const UPD_MARK2 = "// Sync status endpoint\napp.get('/api/sync/status', (req, res) => {";
    const j = s.indexOf(UPD_MARK2);
    if (j < 0) {
      console.warn("[patch-server] sync/status 锚点缺失，跳过 appearance 注入");
    } else if (s.includes("pi-appearance-sync")) {
      console.log("[patch-server] appearance 端点已存在，跳过");
    } else {
      const APPEARANCE_BLOCK = `// ── pi-appearance-sync: 外观（主题/底色）多端一致（T-20260924-001）──
let piAppearance = loadAppearanceFromDisk() || {};
const PI_THEME_RE = /^(light|dark|system)$/;
const PI_HEX_RE = /^#[0-9a-f]{6}$/i;
app.get('/api/appearance', (_req, res) => {
    res.json({ success: true, appearance: piAppearance });
});
app.post('/api/appearance', (req, res) => {
    const b = req.body || {};
    const next = Object.assign({}, piAppearance);
    if (b.theme !== undefined) {
        if (!PI_THEME_RE.test(String(b.theme))) {
            return res.status(400).json({ success: false, error: 'invalid_theme', message: 'theme 只接受 light|dark|system' });
        }
        next.theme = String(b.theme);
    }
    if (b.viewBackgroundColor !== undefined) {
        const hex = String(b.viewBackgroundColor).toLowerCase();
        if (!PI_HEX_RE.test(hex)) {
            return res.status(400).json({ success: false, error: 'invalid_color', message: 'viewBackgroundColor 只接受 #rrggbb' });
        }
        next.viewBackgroundColor = hex;
    }
    next.updatedAt = Date.now();
    delete next.savedAt;
    piAppearance = next;
    saveAppearanceToDisk(piAppearance);
    broadcast({ type: 'appearance_updated', appearance: piAppearance });
    logger.info('[pi-appearance] updated: ' + JSON.stringify(piAppearance));
    res.json({ success: true, appearance: piAppearance });
});
`;
      s = s.slice(0, j) + APPEARANCE_BLOCK + "\n" + s.slice(j);
      fs.writeFileSync(SERVER, s, "utf8");
      console.log("[patch-server] appearance 端点已注入（GET/POST /api/appearance + 广播）");
    }
  }

  if (s.includes("pi-sync-guard v7") && s.includes("缩水闸门（比例制）")) { console.log("[patch-server] server.js 已是 v7+storm-guard，跳过"); return; }

  // v3/v4/v5/v6(无缩水闸门) → v7 就地升级：整块替换 guard（缩水闸门 + 元素级 LWW + 可见性删除 + 单元素增量广播）
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
    console.log("[patch-server] sync-guard → v7 已升级（缩水闸门 + 元素级 LWW + 可见性删除 + 单元素增量广播）");
    return;
  }

  // (a) import persist（插到 import 区；含外观函数——(i) 只升级已打补丁的 server，新装走这里）
  if (!s.includes("utils/persist")) {
    const i = s.indexOf("import { writePidFile");
    if (i < 0) { console.error("[patch-server] import 锚点缺失"); process.exit(1); }
    s = s.slice(0, i) + "import { saveElementsToDisk, loadElementsFromDisk, clipArrowsForRender, loadAppearanceFromDisk, saveAppearanceToDisk } from './utils/persist.js';\n" + s.slice(i);
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

const GUARD_CORE = `        // ── pi-sync-guard v7: 缩水闸门（比例制）+ 元素级 LWW 合并 / 可见性删除 / 单元素增量广播 ──
        // 借鉴 Excalidraw 官方协作语义（Google Docs 用 OT、Figma 用属性级 LWW，此处取同生态的
        // 官方方案）：whole-element last-writer-wins——version 高者胜，平局比 updated，再比
        // versionNonce（低者胜）；变更按单元素事件广播（element_created/updated/deleted），
        // 绝不整场景替换（initial_elements 仅在新 WS 连接时推送），客户端防抖期内未上传的
        // 本地编辑不会被广播覆盖；删除按"见过它的客户端缺席 + 宽限期"判定——从未见过某元素
        // 的客户端缺席它不构成删除证据，根治多端旧场景竞态。
        // v7 新增缩水闸门（b2，比例制）：上行不足服务端场景一半且服务端 >10 时 409 拒绝——
        // 防「客户端异常重置/旧 bundle 缺陷致空画布 → 120s 宽限后批量删除服务端完整场景」
        // （2026-09-23 实测事故 26→4）。合法大批删除不误伤：Excalidraw 删除元素在 onChange
        // 全量数组中保留 isDeleted 槽位，incoming 数量不会缩水。
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
        // b2) 缩水闸门 v7（比例制）：incoming 不足服务端场景一半（且服务端 >10）→ 409 拒绝
        // （不写、不落盘、不广播）。合法大批删除不误伤：Excalidraw 删除/清空在 onChange
        // 全量数组中保留 isDeleted 墓碑壳（本仓库 store 已有实证），incoming 数量不会缩水；
        // 会命中本闸门的只有「本端场景异常缩水/陈旧」的客户端——它们应当先拉取（刷新）
        // 而不是上行。2026-09-23 事故（26→4）即此类。不依赖 _piSeenClients 证据：
        // 该字段在 API 回灌后会丢失、且按元素稀疏分布，作为闸门条件不可靠（实测教训）。
        const _incomingIds = new Set();
        for (const element of frontendElements) {
            if (element && typeof element === 'object' && element.id) _incomingIds.add(element.id);
        }
        let _visibleCount = 0;
        for (const ex of elements.values()) { if (ex && !ex.isDeleted) _visibleCount++; }
        if (beforeCount > 10 && frontendElements.length * 2 < beforeCount) {
            logger.warn('[sync-guard] shrunk scene rejected: incoming ' + frontendElements.length + ' vs server ' + beforeCount + ' (visible ' + _visibleCount + '), client ' + _clientId);
            return res.status(409).json({ success: false, error: 'shrunk_scene_rejected', message: 'Local scene is far smaller than the server scene; upload rejected to protect server data. Reload the page to restore the full scene.', beforeCount, visibleCount: _visibleCount, incomingCount: frontendElements.length, client: _clientId });
        }
        // c) 元素级 LWW 合并（不整体 clear；server 逐元素裁决，旧版本不回写）
        const _created = []; const _updated = [];
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

// ═══════ 3) server.js 注入：官方构建一键更新端点（pi-upstream-update） ═══════
// 画布 WebUI 徽标（upstream-badge）在「官方新构建」状态下点击即调用：
//   POST /api/upstream/apply-update { version, sha, date } → 启动后台更新任务
//   GET  /api/upstream/update-status                       → 前端轮询进度
// 更新三步：npm install --save-exact 官方包 → 同步 canvas-web/vite.config.ts 的
// __CANVAS_BASELINE__（不同步会导致徽标误报）→ npm run build:canvas:safe（临时目录
// 构建→校验→rename 替换，失败不留半成品）。不重启 server：前端是静态文件，替换后
// 刷新页面即生效。
// 安全：version 必须是官方 canary 命名（x.y.z-<sha7>）且与 sha 一致；命令模板固定、
// 参数仅来自正则校验后的字符串，无 shell 注入面；date 仅接受 YYYY-MM-DD。
// 另含 GET /api/upstream/npm-tags：npm registry 的 dist-tags 接口不带 CORS 头，浏览器
// 直接拉取必被拦（徽标因此永远到不了 build-available 态），故经本服务端同源代理转发。
const UPSTREAM_UPDATE_BLOCK = `// ── pi-upstream-update: 官方构建一键更新（画布徽标触发，v1）──
const piUpstream = {
    running: false, phase: '', ok: null, version: '', error: '',
    log: [], startedAt: 0, finishedAt: 0,
};
const PI_CANARY_RE = /^\\d+\\.\\d+\\.\\d+-([0-9a-f]{7})$/i;
const piUpstreamPush = (line) => {
    piUpstream.log.push('[' + new Date().toISOString().slice(11, 19) + '] ' + line);
    if (piUpstream.log.length > 400) piUpstream.log.splice(0, piUpstream.log.length - 400);
};
const piUpstreamStep = async (args, cwd, label, phase) => {
    piUpstream.phase = phase;
    piUpstreamPush('── ' + label + ': npm ' + args.join(' '));
    const { spawn } = await import('node:child_process');
    return await new Promise((resolve) => {
        const child = spawn('npm', args, { cwd, shell: process.platform === 'win32', windowsHide: true });
        const onLine = (d) => { for (const l of String(d).split('\\n')) { const t = l.trim(); if (t) piUpstreamPush(t); } };
        child.stdout.on('data', onLine);
        child.stderr.on('data', onLine);
        child.on('error', (e) => { piUpstreamPush(label + ' 启动失败: ' + e.message); resolve(false); });
        child.on('close', (code) => { piUpstreamPush(label + ' 退出码 ' + code); resolve(code === 0); });
    });
};
const piUpstreamApply = async (info) => {
    try {
        const fs = (await import('node:fs')).default;
        const root = path.resolve(__dirname, '..', '..', '..');
        piUpstreamPush('项目根: ' + root);
        // 1) 安装官方构建（--save-exact 保持 package.json 精确 pin）
        if (!(await piUpstreamStep(['install', '--save-exact', '@excalidraw/excalidraw@' + info.version], root, '安装官方构建', 'install'))) {
            throw new Error('npm install 失败（见上方日志）');
        }
        // 2) 同步 vite.config.ts 基线（跳过会导致画布徽标与 check:upstream 误报漂移）
        piUpstream.phase = 'baseline';
        const cfgPath = path.join(root, 'canvas-web', 'vite.config.ts');
        const cfg = fs.readFileSync(cfgPath, 'utf8');
        const RE = /__CANVAS_BASELINE__:\\s*JSON\\.stringify\\(\\{[\\s\\S]*?\\}\\)/;
        if (!RE.test(cfg)) throw new Error('vite.config.ts 未找到 __CANVAS_BASELINE__，无法同步基线');
        const nl = cfg.includes('\\r\\n') ? '\\r\\n' : '\\n';
        const block = '__CANVAS_BASELINE__: JSON.stringify({' + nl + '      commit: "' + info.sha + '",' + nl + '      date: "' + info.date + '",' + nl + '      version: "' + info.version + '",' + nl + '    })';
        fs.writeFileSync(cfgPath, cfg.replace(RE, block), 'utf8');
        piUpstreamPush('基线已同步 → ' + info.version + ' (' + info.date + ')');
        // 3) 安全重构建 + 部署（deploy-canvas-build.mjs：临时目录构建→校验→rename 替换）
        if (!(await piUpstreamStep(['run', 'build:canvas:safe'], root, '重构建前端', 'build'))) {
            throw new Error('前端构建失败（见上方日志）');
        }
        piUpstream.ok = true;
        piUpstream.phase = 'done';
        logger.info('[pi-upstream-update] 更新完成: ' + info.version);
        piUpstreamPush('✓ 更新完成 ' + info.version + ' — 刷新页面加载新构建（PWA 客户端可能需刷新两次）');
    } catch (e) {
        piUpstream.ok = false;
        piUpstream.phase = 'failed';
        piUpstream.error = e && e.message ? e.message : String(e);
        logger.warn('[pi-upstream-update] 更新失败: ' + piUpstream.error);
        piUpstreamPush('✗ 更新失败: ' + piUpstream.error);
    } finally {
        piUpstream.running = false;
        piUpstream.finishedAt = Date.now();
    }
};
app.get('/api/upstream/npm-tags', (_req, res) => {
    void (async () => {
        try {
            const https = (await import('node:https')).default;
            https.get('https://registry.npmjs.org/-/package/@excalidraw/excalidraw/dist-tags', { headers: { Accept: 'application/json', 'User-Agent': 'excalidraw-workspace' } }, (r) => {
                let body = '';
                r.on('data', (c) => { body += c; });
                r.on('end', () => res.status(r.statusCode && r.statusCode < 400 ? 200 : 502).type('application/json').send(body));
            }).on('error', () => res.status(502).json({ success: false, error: 'npm_fetch_failed' }));
        } catch (e) {
            res.status(500).json({ success: false, error: 'proxy_failed', message: e && e.message });
        }
    })();
});
app.post('/api/upstream/apply-update', (req, res) => {
    if (piUpstream.running) {
        return res.status(409).json({ success: false, error: 'update_already_running', version: piUpstream.version });
    }
    const version = String((req.body && req.body.version) || '').trim();
    const sha = String((req.body && req.body.sha) || '').trim().toLowerCase();
    const m = PI_CANARY_RE.exec(version);
    if (!m) {
        return res.status(400).json({ success: false, error: 'invalid_version', message: 'version 必须是官方 canary 构建名（形如 0.18.0-<sha7>）' });
    }
    if (sha && m[1] !== sha) {
        return res.status(400).json({ success: false, error: 'sha_mismatch', message: 'version 与 sha 不一致' });
    }
    let date = String((req.body && req.body.date) || '').trim();
    if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(date)) date = new Date().toISOString().slice(0, 10);
    piUpstream.running = true;
    piUpstream.ok = null;
    piUpstream.error = '';
    piUpstream.version = version;
    piUpstream.log = [];
    piUpstream.startedAt = Date.now();
    piUpstream.finishedAt = 0;
    logger.info('[pi-upstream-update] 收到更新请求: ' + version + ' (sha ' + (sha || m[1]) + ')');
    piUpstreamPush('收到更新请求: ' + version + (sha ? ' (sha ' + sha + ')' : ''));
    void piUpstreamApply({ version, sha: sha || m[1], date });
    res.json({ success: true, started: true, version });
});
app.get('/api/upstream/update-status', (_req, res) => {
    res.json({
        success: true,
        running: piUpstream.running,
        phase: piUpstream.phase,
        ok: piUpstream.ok,
        version: piUpstream.version,
        error: piUpstream.error,
        startedAt: piUpstream.startedAt || null,
        finishedAt: piUpstream.finishedAt || null,
        log: piUpstream.log.slice(-60),
    });
});
`;

apply();
console.log("[patch-server] 完成（重启 canvas server 后生效）");
