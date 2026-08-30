# 最终验收测试清单（final_acceptance）

> 功能：Web UI 已加入 **Send to Agent** 按钮（Connected 左侧）。点击后通知 Pi Agent（.agent/pending.json 标记），Pi 走 Review Gate 处理。

> 状态标记：✅ 已自动验证 ｜ ⏳ 待 Android 真机验证 ｜ 📋 用户操作

| # | 验收项 | 状态 | 说明 |
|---|---|---|---|
| 1 | Android 打开 Excalidraw | ⏳📋 | 需先完成下方「前置条件」，访问 `http://192.168.0.1:5001` |
| 2 | 创建 3 个节点 | ⏳📋 | Android 画布上操作 |
| 3 | 创建 2 条箭头 | ⏳📋 | 选择箭头工具，从节点拖到节点 |
| 4 | 两条箭头都吸附绑定节点 | ⏳📋 | 拖拽箭头端点时吸附到节点边框 = Binding 成功 |
| 5 | 保存 main.excalidraw | ✅ | 画布由 server 端持久化；`export --out architecture/main.excalidraw` 已入库 |
| 6 | 打开 Review Gate | ✅ | `node tools/review-gate.mjs --task ... --planned ...` |
| 7 | Approve | 📋 | 回复 approve 批准 |
| 8 | Pi 通过 MCP 读取画布 | ✅ | `describe` 结构化输出（phase_3 验证） |
| 9 | Pi 正确识别节点与依赖 | ✅ | Connections: node-1→node-2→node-3, task-A→pi-done |
| 10 | Pi 修改 Git 项目 | ✅ | phase_5: modules/auth/login.js + test |
| 11 | Pi 运行测试 | ✅ | `npm test` → 4/4 通过 |
| 12 | Pi 通过 MCP 更新画布 | ✅ | task-A→[DONE]，新增 pi-done/edge-3 |
| 13 | Android 看到 Pi 回写变更 | ⏳📋 | WebSocket 实时同步，真机确认 task-A [DONE] 与 pi-done 节点 |

## 前置条件（用户操作）

1. **防火墙放行**（管理员 CMD）：
   ```
   netsh advfirewall firewall add rule name="Excalidraw Workspace 5001" dir=in action=allow protocol=TCP localport=5001 remoteip=192.168.0.0/255.255.0.0
   ```
2. **网络**：本机以太网 IP 192.168.0.1/23（WLAN 当前断开）。手机需接入同一 192.168.0.x 网段路由器（或启用本机 WLAN 并加入同网段 WiFi）。
3. Android Chrome 打开 `http://192.168.0.1:5001`

## PWA 安装（Android）

1. 打开 `http://192.168.0.1:5001`
2. Chrome 菜单 → 「添加到主屏幕」（安装应用）
3. 确认图标与名称（Excalidraw 工作区）

## Send to Agent 使用

1. 打开画布 Web UI（刷新页面，如缓存需硬刷新 Ctrl+F5）
2. 顶部工具栏可见 **Send to Agent** 按钮（Connected 左侧）
3. 画完内容后点击，按钮显示 ✓ 已发送
4. 通知服务须运行（start-canvas.bat 已包含 agent-notify，或单独 ）
5. Pi 检测到标记后走 Review Gate → 处理 → 删除标记

## 服务管理

```bash
# 启动 canvas server
start-canvas.bat

# 停止（由 start 的进程管理，或 taskkill /PID <pid>）

# Pi 操作画布（CLI 桥接）
mcp-cli.bat describe          # 读取
mcp-cli.bat add               # 创建（stdin JSON）
mcp-cli.bat update <id> --set '{"label":{"text":"..."}}'
mcp-cli.bat delete <id...>
mcp-cli.bat export --out architecture/main.excalidraw
mcp-cli.bat import architecture/main.excalidraw

# Review Gate
node tools/review-gate.mjs --task "..." --planned "..."

# 认证代理（公网场景）
node tools/auth-proxy.mjs
```

## 当前画布状态（最后一次 export）

```
元素 16：rectangle(4) arrow(3) ellipse(1) text(8)
Connections:
  node-1 --> node-2 (edge-1)
  node-2 --> node-3 (edge-2)
  task-A --> pi-done (edge-3)
任务：task-A "实现登录模块 [DONE]"（Pi 已完成，测试 4/4）
```
