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

    // 优先显示已批准状态（比待处理更重要）
    if (approved && approved.status === "APPROVED") {
      const key = `approved:${approved.approved_at ?? ""}|${approved.elements ?? ""}`;
      if (key !== lastKey) {
        lastKey = key;
        ctx.ui.notify(
          `✅ Web UI Approve 已收到（元素 ${approved.elements ?? "?"} 个）`,
          "info"
        );
        ctx.ui.setWidget(WIDGET_ID, [
          "✅ 画布已批准（Web UI Approve）",
          `  元素数  : ${approved.elements ?? "?"}`,
          `  时间    : ${approved.approved_at ?? ""}`,
          "  → Pi 可直接执行画布任务（无需再次 approve）",
        ]);
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
