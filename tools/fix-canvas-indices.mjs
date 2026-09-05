#!/usr/bin/env node
/**
 * 画布元素 index 规范化工具
 *
 * 背景：Excalidraw 0.18 使用小写 fractional index（如 a0、a1、a2…）做 z-order 排序，
 * 并会在新增元素时校验全场景 index 不变量（ELEMENT_HAS_INVALID_INDEX）。
 * 若元素 index 携带非法字符（如大写 aA0/aB0…），新增元素会抛异常 → 画布"只能改已有元素、不能新建"。
 *
 * 本工具将元素的 index 按存储顺序重排为合法小写序列 a0, a1, a2 …（保持 z-order 相对顺序）。
 *
 * 用法：
 *   # 1. 规范化本地 .excalidraw / 备份 JSON，输出到文件
 *   node tools/fix-canvas-indices.mjs <输入.json> <输出.json>
 *     （输入支持 {elements:[...]} 或纯数组，或完整 .excalidraw {elements,appState}）
 *
 *   # 2. 规范化后同步回画布（示例）
 *   node tools/fix-canvas-indices.mjs <输入.json> | node -e "..."   # 或配合 sync
 *
 *   # 3. 直接从 canvas server 拉取 → 规范化 → 写回（一键修复线上画布）
 *   node tools/fix-canvas-indices.mjs --server http://127.0.0.1:5001
 *
 * 幂等：合法小写 index 的输入不会改变（保持原值即可安全重复执行）。
 */
import fs from "node:fs";

function normalize(elements) {
  let out = 0;
  elements.forEach((el, i) => {
    if (el && typeof el.index === "string" && /^a\d+$/.test(el.index)) return; // 已合法
    if (el && typeof el === "object") {
      el.index = `a${i}`;
      out++;
    }
  });
  return { fixed: out, total: elements.length };
}

function load(path) {
  const raw = fs.readFileSync(path, "utf8");
  const json = JSON.parse(raw);
  if (Array.isArray(json)) return { elements: json, wrap: "array" };
  if (json && Array.isArray(json.elements)) return { elements: json.elements, wrap: "object" };
  throw new Error(`无法识别的输入结构: ${path}`);
}

// 在线修复：拉取 server 画布 → 规范化 → sync 回写
async function fixServer(url) {
  const resp = await fetch(`${url}/api/elements`);
  const data = await resp.json();
  const elements = Array.isArray(data) ? data : data.elements || [];
  const { fixed, total } = normalize(elements);
  console.log(`[fix-indices] server 元素 ${total} 个，修复 index ${fixed} 个`);
  if (fixed === 0) return;
  const syncResp = await fetch(`${url}/api/elements/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ elements, timestamp: `fix-indices-${Date.now()}` }),
  });
  const sj = await syncResp.json();
  console.log(`[fix-indices] 已写回: ${sj.success ? sj.count + " 个元素" : "失败 " + JSON.stringify(sj).slice(0, 200)}`);
}

const argv = process.argv.slice(2);
if (argv[0] === "--server") {
  await fixServer(argv[1] || "http://127.0.0.1:5001");
} else if (argv.length === 2) {
  const { elements, wrap } = load(argv[0]);
  const { fixed, total } = normalize(elements);
  const out = wrap === "array"
    ? elements
    : { ...JSON.parse(fs.readFileSync(argv[0], "utf8")), elements };
  fs.writeFileSync(argv[1], JSON.stringify(out, null, 2), "utf8");
  console.log(`[fix-indices] ${total} 个元素，修复 index ${fixed} 个 → 已写入 ${argv[1]}`);
} else {
  console.log("用法:\n  node tools/fix-canvas-indices.mjs <in.json> <out.json>\n  node tools/fix-canvas-indices.mjs --server http://127.0.0.1:5001");
  process.exit(1);
}
