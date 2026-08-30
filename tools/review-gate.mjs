#!/usr/bin/env node
/**
 * Review Gate 快照生成器（phase_4）
 *
 * 职责：在 Pi 执行任何代码修改之前，生成结构化审查报告：
 *   - 画布结构（node / arrow / binding / text 统计）
 *   - 与 Git 上次提交的 architecture/main.excalidraw 对比（新增/删除/修改节点）
 *   - 审查元数据（任务范围、目标仓库/分支、计划动作）
 *   - 破坏性操作标记（delete / clear / force push 等需额外确认）
 *
 * 用法：node tools/review-gate.mjs [--planned "计划动作描述"] [--task "任务范围"] [--destructive]
 * 输出：review-gate-report.json（同目录）+ 人类可读摘要（stdout）
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(__dirname, "..");
const CANVAS_FILE = path.join(PROJECT, "architecture", "main.excalidraw");
const REPORT_FILE = path.join(__dirname, "review-gate-report.json");

const args = process.argv.slice(2);
const planned = argValue(args, "--planned");
const taskScope = argValue(args, "--task");
const destructive = args.includes("--destructive");

function argValue(argv, key) {
  const i = argv.indexOf(key);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
}

function run(cmd) {
  try {
    return execSync(cmd, { encoding: "utf8", cwd: PROJECT, stdio: ["pipe", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

// Canvas URL：优先环境变量，默认 127.0.0.1:5001（与 start-canvas.bat 一致）
const CANVAS_URL = process.env.EXCALIDRAW_CANVAS_URL || "http://127.0.0.1:5001";
function mcp(cmd) {
  return run(`npx mcp-excalidraw-server ${cmd} --url ${CANVAS_URL}`);
}

const NODE_TYPES = new Set(["rectangle", "ellipse", "diamond", "line", "frame", "embeddable", "link", "magicframe"]);

function analyze(scene) {
  const elements = scene?.elements ?? [];
  const nodes = elements.filter((e) => NODE_TYPES.has(e.type));
  const edges = elements.filter((e) => e.type === "arrow");
  const texts = elements.filter((e) => e.type === "text");
  const textsByContainer = new Map(texts.map((t) => [t.containerId, t]));
  const bindings = edges.filter(
    (e) => e.startBinding?.elementId || e.endBinding?.elementId
  ).length;

  // 文本关联：containerId 优先；浏览器画布导出时 containerId 可能丢失，
  // 回退用 bbox 包含匹配（文本中心点在节点框内）
  const findTextFor = (x, y, w, h, id) => {
    const byId = id ? textsByContainer.get(id) : null;
    if (byId) return byId.text ?? null;
    const hit = texts.find((t) => {
      const cx = t.x + t.width / 2;
      const cy = t.y + t.height / 2;
      return cx >= x && cx <= x + w && cy >= y && cy <= y + h;
    });
    return hit ? hit.text : null;
  };

  return {
    total: elements.length,
    nodes: nodes.length,
    edges: edges.length,
    texts: texts.length,
    bindings,
    edgeList: edges.map((e) => ({
      id: e.id,
      from: e.startBinding?.elementId ?? null,
      to: e.endBinding?.elementId ?? null,
      label: findTextFor(e.x - 60, e.y - 30, e.width + 120, e.height + 60, e.id) ?? null,
    })),
    nodeList: nodes.map((n) => ({
      id: n.id,
      type: n.type,
      text: findTextFor(n.x, n.y, n.width, n.height, n.id),
      status: n.metadata?.status ?? null,
    })),
  };
}

function diff(prev, curr) {
  const prevIds = new Set(prev.map((n) => n.id));
  const currIds = new Set(curr.map((n) => n.id));
  const added = curr.filter((n) => !prevIds.has(n.id));
  const deleted = prev.filter((n) => !currIds.has(n.id));
  const modified = curr.filter((n) => {
    if (!prevIds.has(n.id)) return false;
    const p = prev.find((x) => x.id === n.id);
    return JSON.stringify({ t: p.text, ty: p.type }) !== JSON.stringify({ t: n.text, ty: n.type });
  });
  return { added, deleted, modified };
}

function readScene(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

// ---- 1. 获取当前画布并导出（export 失败必须中止，避免覆盖坏文件） ----
const desc = mcp("describe");
const exportOut = mcp("export --out architecture/main.excalidraw");
if (!exportOut.includes('"success": true')) {
  console.error(`FAIL: export 失败（canvas ${CANVAS_URL} 不可达？）`);
  console.error(exportOut || "(无输出)");
  process.exit(1);
}
if (!fs.existsSync(CANVAS_FILE)) {
  console.error("FAIL: architecture/main.excalidraw 不存在（export 失败？）");
  process.exit(1);
}

// ---- 2. 与 Git HEAD 对比 ----
const headRaw = run("git show HEAD:architecture/main.excalidraw");
const headScene = headRaw ? JSON.parse(headRaw) : null;
const currScene = readScene(CANVAS_FILE);
const curr = analyze(currScene);
const prev = analyze(headScene ?? currScene);
const nodeDiff = diff(prev.nodeList, curr.nodeList);
const edgeDiff = diff(prev.edgeList, curr.edgeList);

const branch = run("git rev-parse --abbrev-ref HEAD") || "unknown";
const repoUrl = run("git config --get remote.origin.url") || "(本地仓库，无 remote)";
const headCommit = run("git rev-parse --short HEAD") || "none";

const report = {
  generated_at: new Date().toISOString(),
  canvas_file: "architecture/main.excalidraw",
  canvas_stats: {
    current: { total: curr.total, nodes: curr.nodes, edges: curr.edges, texts: curr.texts, bindings: curr.bindings },
    previous_commit: { total: prev.total, nodes: prev.nodes, edges: prev.edges, texts: prev.texts, bindings: prev.bindings },
  },
  changes: {
    added_nodes: nodeDiff.added,
    deleted_nodes: nodeDiff.deleted,
    modified_nodes: nodeDiff.modified,
    added_edges: edgeDiff.added,
    deleted_edges: edgeDiff.deleted,
    modified_edges: edgeDiff.modified,
  },
  task: {
    scope: taskScope ?? "(未指定)",
    target_project: PROJECT,
    target_repo: repoUrl,
    target_branch: branch,
    head_commit: headCommit,
  },
  planned_actions: planned ?? "(未指定)",
  destructive_operations: destructive,
  review_required: true,
  approval_status: "PENDING",
};

fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2), "utf8");

// ---- 3. 人类可读摘要 ----
console.log("=".repeat(60));
console.log("🔍 REVIEW GATE 审查报告");
console.log("=".repeat(60));
console.log(`画布文件    : ${report.canvas_file}`);
console.log(`生成时间    : ${report.generated_at}`);
console.log(`\n[画布统计] 当前 / 上次提交`);
console.log(`  元素总数  : ${curr.total} / ${prev.total}`);
console.log(`  节点(nodes): ${curr.nodes} / ${prev.nodes}`);
console.log(`  箭头(edges): ${curr.edges} / ${prev.edges}`);
console.log(`  Binding   : ${curr.bindings} / ${prev.bindings}`);
console.log(`  Text      : ${curr.texts} / ${prev.texts}`);
console.log(`\n[变更检测]`);
console.log(`  新增节点  : ${report.changes.added_nodes.length}${report.changes.added_nodes.length ? " -> " + report.changes.added_nodes.map(n=>n.id+"("+n.text+")").join(", ") : ""}`);
console.log(`  删除节点  : ${report.changes.deleted_nodes.length}${report.changes.deleted_nodes.length ? " -> " + report.changes.deleted_nodes.map(n=>n.id).join(", ") : ""}`);
console.log(`  修改节点  : ${report.changes.modified_nodes.length}${report.changes.modified_nodes.length ? " -> " + report.changes.modified_nodes.map(n=>n.id).join(", ") : ""}`);
console.log(`  新增箭头  : ${report.changes.added_edges.length}`);
console.log(`  删除箭头  : ${report.changes.deleted_edges.length}`);
console.log(`\n[任务元数据]`);
console.log(`  任务范围  : ${report.task.scope}`);
console.log(`  目标仓库  : ${report.task.target_repo}`);
console.log(`  目标分支  : ${report.task.target_branch} (HEAD ${report.task.head_commit})`);
console.log(`\n[计划动作]`);
console.log(`  ${report.planned_actions}`);
console.log(`\n[门禁状态]`);
if (report.destructive_operations) {
  console.log(`  ⛔ 包含破坏性操作（delete/clear/force push 等）—— 需【额外人工确认】`);
}
console.log(`  ⏳ 等待人工 APPROVE 后才能触发 Pi 执行代码修改`);
console.log("=".repeat(60));
console.log(`完整报告已写入: ${REPORT_FILE}`);
