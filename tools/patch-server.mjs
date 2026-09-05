#!/usr/bin/env node
/**
 * Canvas Server 补丁脚本（幂等，可重跑；升级 mcp-excalidraw-server 后需重跑）
 *
 * 补丁 1：persist.js 落盘前轮转备份（保留 20 份）—— 防误覆盖丢画布
 * 补丁 2：server.js sync 合并/保护（P1 sync 版本/合并保护 + P2 实时逐步显示）
 *   a) 空 sync 保护：server 非空且距上次有效 sync <60s 的空场景 sync 拒绝（防新开空页清空画布）
 *   b) 元素级合并：updated 更大者胜 —— 旧场景不会覆盖更新过的元素
 *   c) 逐元素广播 element_created/updated/deleted → 各客户端实时收敛与逐步显示（Pi 批量回写可见逐步渲染）
 *
 * 用法：node tools/patch-server.mjs（start-canvas.bat 启动时自动执行）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PKG = path.resolve(ROOT, "node_modules", "mcp-excalidraw-server", "dist");

// ═══════════════ 补丁 1：persist.js 覆盖前轮转备份 ═══════════════
const PERSIST = path.join(PKG, "utils", "persist.js");
const PERSIST_OLD = `        const file = storeFilePath();
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const tmp = file + '.tmp';`;
const PERSIST_NEW = `        const file = storeFilePath();
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

// ═══════════════ 补丁 2：server.js sync 合并/保护 ═══════════════
const SERVER = path.join(PKG, "server.js");
// handler 内：validate 之后到 saveElementsToDisk 之前（含广播与响应前半）
const SYNC_OLD = `        // Record element count before sync
        const beforeCount = elements.size;
        // 1. Clear existing memory storage
        elements.clear();
        logger.info(\`Cleared existing elements: \${beforeCount} elements removed\`);
        // 2. Batch write new data
        let successCount = 0;
        const processedElements = [];
        frontendElements.forEach((element, index) => {
            try {
                // Ensure element has ID, generate one if missing
                const elementId = element.id || generateId();
                // Add server metadata
                const processedElement = {
                    ...element,
                    id: elementId,
                    syncedAt: new Date().toISOString(),
                    source: 'frontend_sync',
                    syncTimestamp: timestamp,
                    version: 1
                };
                // Store to memory
                elements.set(elementId, processedElement);
                processedElements.push(processedElement);
                successCount++;
            }
            catch (elementError) {
                logger.warn(\`Failed to process element \${index}:\`, elementError);
            }
        });
        logger.info(\`Sync completed: \${successCount}/\${frontendElements.length} elements synced\`);
        // 3. Broadcast sync event to all WebSocket clients
        broadcast({
            type: 'elements_synced',
            count: successCount,
            timestamp: new Date().toISOString(),
            source: 'manual_sync'
        });
        // 4. Return sync results
        saveElementsToDisk();
        res.json({
            success: true,
            message: \`Successfully synced \${successCount} elements\`,
            count: successCount,
            syncedAt: new Date().toISOString(),
            beforeCount,
            afterCount: elements.size
        });`;

const SYNC_NEW = `        // ── pi-sync-guard v1: 合并/保护（防覆盖/防清空/实时收敛） ──
        const beforeCount = elements.size;
        const _nowMs = Date.now();
        const _lastGood = Number(elements._piLastGoodSyncAt || 0);
        const _elUpdated = (el) => { const v = Number(el && el.updated); return Number.isFinite(v) ? v : 0; };

        // a) 空 sync 保护：server 非空且距上次有效 sync <60s → 拒绝（防新开空页面/旧空场景清空画布）
        if (frontendElements.length === 0 && beforeCount > 0 && _nowMs - _lastGood < 60000) {
            logger.warn('[sync-guard] empty sync rejected (protect last good scene)');
            return res.status(409).json({
                success: false,
                error: 'empty-sync-protected',
                message: 'Empty scene sync rejected: protect existing ' + beforeCount + ' elements. Use DELETE /api/elements/clear to clear explicitly.',
                currentCount: beforeCount
            });
        }

        // b) 元素级合并：逐元素比较 updated（大者胜），旧场景不会覆盖更新过的元素
        const _writes = [];      // { element, kind: 'created'|'updated'|'restored' }
        const _removedIds = [];
        for (const element of frontendElements) {
            try {
                if (!element || typeof element !== 'object') continue;
                const elementId = element.id || generateId();
                const existing = elements.get(elementId);
                const incomingT = _elUpdated(element);
                const existingT = _elUpdated(existing);
                // 新值 updated 无效(0) 或 不小于 server → 采用新值；否则保留 server 较新版本（防旧覆盖）并广播纠正
                const useNew = !existing || !(existingT > incomingT && incomingT > 0);
                const base = useNew ? element : existing;
                const processedElement = {
                    ...base,
                    id: elementId,
                    syncedAt: new Date().toISOString(),
                    source: 'frontend_sync',
                    syncTimestamp: timestamp,
                    version: 1
                };
                elements.set(elementId, processedElement);
                _writes.push({ element: processedElement, kind: useNew ? (existing ? 'updated' : 'created') : 'restored' });
            }
            catch (elementError) {
                logger.warn('[sync-guard] failed to process element:', elementError);
            }
        }
        // 删除：场景缺失 = 删除（保持原语义），广播 element_deleted 同步各端
        const _seenIds = new Set(frontendElements.map((el) => el && (el.id || el._id)));
        for (const [id, ex] of elements.entries()) {
            if (!_seenIds.has(id)) { elements.delete(id); _removedIds.push(id); }
        }
        elements._piLastGoodSyncAt = Date.now();
        logger.info(\`[sync-guard] sync merged: +/\${_writes.length} new-or-updated, -\${_removedIds.length} removed (before \${beforeCount} -> after \${elements.size})\`);

        // c) 逐元素广播（element_created/updated/deleted）→ 各端实时收敛；Pi 批量回写可逐步显示
        for (const w of _writes) {
            broadcast({ type: w.kind === 'created' ? 'element_created' : 'element_updated', element: w.element });
        }
        for (const rid of _removedIds) {
            broadcast({ type: 'element_deleted', elementId: rid });
        }

        // 4. Return sync results
        saveElementsToDisk();
        res.json({
            success: true,
            message: \`Successfully synced \${_writes.length} elements\`,
            count: _writes.length,
            syncedAt: new Date().toISOString(),
            beforeCount,
            afterCount: elements.size
        });`;

// ═══════════════ 补丁 2b：sync noop 快速路径（内容等价不广播不落盘） ═══════════════
const NOOP_OLD = `        // b) 元素级合并：逐元素比较 updated（大者胜），旧场景不会覆盖更新过的元素`;
const NOOP_NEW = `        // ── pi-sync-guard-noop: 内容等价时静默快速返回（防双端心跳风暴 / 重复逐元素广播）──
        if (frontendElements.length === elements.size) {
            const _same = frontendElements.every((el) => {
                if (!el) return false;
                const ex = elements.get(el.id);
                return ex && Number(ex.updated) === Number(el.updated);
            });
            if (_same) {
                elements._piLastGoodSyncAt = Date.now();
                logger.info('[sync-guard] noop sync (identical scene)');
                return res.json({ success: true, message: 'noop', count: elements.size, noop: true, beforeCount: elements.size, afterCount: elements.size });
            }
        }

        // b) 元素级合并：逐元素比较 updated（大者胜），旧场景不会覆盖更新过的元素`;

let ok = true;
function apply(file, oldS, newS, name, marker) {
  if (!fs.existsSync(file)) { console.error(`[patch-server] 未找到: ${file}`); ok = false; return; }
  const src = fs.readFileSync(file, "utf8");
  if (src.includes(marker)) {
    console.log(`[patch-server] ${name} 已打过补丁，跳过`);
    return;
  }
  if (!src.includes(oldS)) { console.error(`[patch-server] ${name}: 未找到插入点标记，请人工检查`); ok = false; return; }
  fs.writeFileSync(file, src.replace(oldS, newS), "utf8");
  console.log(`[patch-server] ${name} 已应用`);
}

apply(PERSIST, PERSIST_OLD, PERSIST_NEW, "persist.js 覆盖前轮转备份", "pi-backup-patch");
apply(SERVER, SYNC_OLD, SYNC_NEW, "server.js sync 合并/保护", "pi-sync-guard v1");
apply(SERVER, NOOP_OLD, NOOP_NEW, "server.js sync noop 快速路径", "pi-sync-guard-noop");

if (!ok) process.exit(1);
console.log("[patch-server] 完成（重启 canvas server 后生效）");
