/**
 * Send to Agent 实时通知扩展
 *
 * 监听 Excalidraw 工作区的 .agent/ 标记文件：
 *   - pending.json   : Web UI 点击 "Send to Agent" 后写入（PENDING）
 *   - approved.json  : Web UI 点击 "Approve" 后写入（APPROVED）
 *
 * Pi TUI 实时弹出通知并在顶部显示收件箱 Widget，直至标记被清除。
 *
 * 相关组件：
 *   - Web UI 按钮: webui/send-to-agent.js（Send to Agent / Approve）
 *   - 通知服务: tools/agent-notify.mjs（监听 5010，写标记）
 *   - 标记文件: <project>/.agent/pending.json, approved.json
 *
 * 命令: /agent-inbox（手动刷新查看）
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import fs from "node:fs";
import path from "node:path";

// Excalidraw 工作区标记文件（本项目固定路径）
const MARKER_DIR = "D:/projects/excalidraw-workspace/.agent";
const MARKER_FILE = path.join(MARKER_DIR, "pending.json");
const APPROVED_FILE = path.join(MARKER_DIR, "approved.json");
const REJECTED_FILE = path.join(MARKER_DIR, "rejected.json");
const WIDGET_ID = "agent-inbox";
const POLL_MS = 3000;

function readJson(file: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export default function (pi: ExtensionAPI) {
  let watcher: fs.FSWatcher | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let lastKey = "";

  function clearWidget(ctx: ExtensionContext) {
    if (lastKey) {
      lastKey = "";
      ctx.ui.setWidget(WIDGET_ID, undefined);
    }
  }

  async function checkMarkers(ctx: ExtensionContext) {
    const pending = readJson(MARKER_FILE);
    const approved = readJson(APPROVED_FILE);
    const rejected = readJson(REJECTED_FILE);

    // 1) 拒绝优先：用户点击 Web UI Reject，回退已发送/取消执行中任务
    if (rejected && rejected.status === "REJECTED") {
      const key = `rejected:${rejected.rejected_at ?? ""}`;
      if (key !== lastKey) {
        ctx.ui.notify("❌ 画布任务已拒绝（Web UI Reject）", "warning");
        ctx.ui.setWidget(WIDGET_ID, undefined);
        try {
          await pi.sendUserMessage(
            `【Web UI 已拒绝任务】用户点击 Reject（拒绝时间 ${rejected.rejected_at ?? ""}）。` +
              `请停止当前画布任务，不要执行代码/文件修改，` +
              `清除 .agent 标记（含 rejected.json）后结束。`
          );
          lastKey = key;
        } catch {
          lastKey = ""; // 投递失败，下轮重试
        }
      }
      return;
    }

    // 2) 已批准状态（比待处理更重要）
    if (approved && approved.status === "APPROVED") {
      const key = `approved:${approved.approved_at ?? ""}|${approved.elements ?? ""}`;
      if (key !== lastKey) {
        ctx.ui.notify(
          `✅ Web UI Approve 已收到（元素 ${approved.elements ?? "?"} 个）`,
          "info"
        );
        ctx.ui.setWidget(WIDGET_ID, [
          "✅ 画布已批准（Web UI Approve）",
          `  元素数  : ${approved.elements ?? "?"}`,
          `  时间    : ${approved.approved_at ?? ""}`,
          "  → Pi 自动执行中…",
        ]);
        // 自动触发 agent 执行画布任务（Pi 无需人工再次提示）
        try {
          await pi.sendUserMessage(
            `【Web UI 已批准画布任务】检测到 approved.json（元素 ${approved.elements ?? "?"} 个，批准时间 ${approved.approved_at ?? ""}）。` +
              `请读取 D:/projects/excalidraw-workspace/.agent/approved.json 与当前画布内容，` +
              `按 Review Gate 执行画布任务，完成后清除 .agent 标记。`
          );
          lastKey = key;
        } catch {
          // 投递失败（如正在 streaming），下轮轮询重试
          lastKey = "";
        }
      }
      return;
    }

    if (pending && pending.status === "PENDING") {
      const key = `pending:${pending.received_at ?? ""}|${pending.elements ?? ""}`;
      if (key !== lastKey) {
        lastKey = key;
        ctx.ui.notify(
          `📮 Send to Agent: 收到画布通知（元素 ${pending.elements ?? "?"} 个）`,
          "info"
        );
        ctx.ui.setWidget(WIDGET_ID, [
          "📮 Send to Agent 收到新画布",
          `  元素数  : ${pending.elements ?? "?"}`,
          `  来源    : ${pending.source ?? "webui"}`,
          "  → 可在 Web UI 点 Approve，或让 Pi 走 Review Gate",
        ]);
      }
      return;
    }

    clearWidget(ctx);
  }

  pi.on("session_start", (_event, ctx) => {
    // 文档要求：后台资源（文件监听/定时器）在 session_start 中启动
    try {
      fs.mkdirSync(MARKER_DIR, { recursive: true });
      watcher = fs.watch(MARKER_DIR, { persistent: false }, () => checkMarkers(ctx));
    } catch {
      watcher = null;
    }
    timer = setInterval(() => checkMarkers(ctx), POLL_MS);
    checkMarkers(ctx);
  });

  pi.on("session_shutdown", () => {
    watcher?.close();
    watcher = null;
    if (timer) clearInterval(timer);
    timer = null;
  });

  pi.registerCommand("agent-inbox", {
    description: "查看/刷新 Send to Agent 收件箱",
    handler: async (_args, ctx) => {
      await checkMarkers(ctx);
      ctx.ui.notify("已刷新 agent-inbox", "info");
    },
  });
}
