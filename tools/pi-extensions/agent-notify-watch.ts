/**
 * Send to Agent 实时通知扩展
 *
 * 监听 Excalidraw 工作区的 .agent/pending.json 标记文件。
 * Web UI 点击 "Send to Agent" 后（agent-notify 服务写入标记），
 * 本扩展实时弹出通知并在 TUI 顶部显示收件箱 Widget，直至标记被清除。
 *
 * 相关组件：
 *   - Web UI 按钮: webui/send-to-agent.js
 *   - 通知服务: tools/agent-notify.mjs（监听 5010，写标记）
 *   - 标记文件: <project>/.agent/pending.json
 *
 * 命令: /agent-inbox（手动刷新查看）
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import fs from "node:fs";
import path from "node:path";

// Excalidraw 工作区标记文件（本项目固定路径）
const MARKER_FILE = "D:/projects/excalidraw-workspace/.agent/pending.json";
const WIDGET_ID = "agent-inbox";
const POLL_MS = 3000;

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

  async function checkMarker(ctx: ExtensionContext) {
    try {
      const raw = fs.readFileSync(MARKER_FILE, "utf8");
      const data = JSON.parse(raw) as {
        status?: string;
        elements?: number;
        source?: string;
        received_at?: string;
      };
      const key = `${data.received_at ?? ""}|${data.elements ?? ""}|${data.source ?? ""}`;
      if (data.status === "PENDING" && key !== lastKey) {
        lastKey = key;
        ctx.ui.notify(
          `📮 Send to Agent: 收到画布通知（元素 ${data.elements ?? "?"} 个）`,
          "info"
        );
        ctx.ui.setWidget(WIDGET_ID, [
          "📮 Send to Agent 收到新画布",
          `  元素数  : ${data.elements ?? "?"}`,
          `  来源    : ${data.source ?? "webui"}`,
          `  时间    : ${data.received_at ?? ""}`,
          "  → 请让 Pi 走 Review Gate 处理（处理完标记自动清除）",
        ]);
      }
    } catch {
      clearWidget(ctx);
    }
  }

  pi.on("session_start", (_event, ctx) => {
    // 文档要求：后台资源（文件监听/定时器）在 session_start 中启动
    try {
      const dir = path.dirname(MARKER_FILE);
      fs.mkdirSync(dir, { recursive: true });
      watcher = fs.watch(dir, { persistent: false }, () => checkMarker(ctx));
    } catch {
      watcher = null;
    }
    timer = setInterval(() => checkMarker(ctx), POLL_MS);
    checkMarker(ctx);
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
      await checkMarker(ctx);
      ctx.ui.notify("已刷新 agent-inbox", "info");
    },
  });
}
