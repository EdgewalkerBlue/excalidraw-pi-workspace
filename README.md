# Excalidraw × Pi Agent 双向协作工作区

> Android 手机可访问的 Excalidraw 无限画布，与 Pi Coding Agent 通过 MCP(CLI) + Review Gate 建立双向协作闭环。
> 画布即结构化需求/架构数据，箭头绑定（Arrow Binding）为核心语义，画布文件进入 Git 作为正式资产。

## 目录

- [整体架构](#整体架构)
- [功能清单](#功能清单)
- [目录结构](#目录结构)
- [上游依赖与借鉴项目](#上游依赖与借鉴项目)
- [快速开始](#快速开始)
- [协作流程](#协作流程)
  - [Send to Agent](#send-to-agent)
  - [Approve / Reject](#approve--reject)
  - [Review Gate](#review-gate)
- [Pi 扩展（实时通知）](#pi-扩展实时通知)
- [安全说明](#安全说明)
- [服务与常用命令](#服务与常用命令)

## 整体架构

```
┌────────────────────────────┐        ┌──────────────────────────────┐
│   Android / Web 浏览器       │        │  本机 (Windows)               │
│   Excalidraw 无限画布        │        │                              │
│   [Send to Agent][Approve]  │        │  ┌────────────────────────┐  │
│   [Reject] ●Connected       │        │  │ Canvas Server :5001    │  │
└──────────┬─────────────────┘        │  │ (mcp-excalidraw-server) │  │
           │ WebSocket 实时同步         │  └───────────┬────────────┘  │
           │ (无认证内网)                │              │ REST /api      │
           ▼                           │  ┌───────────▼────────────┐  │
    http://192.168.0.1:5001            │  │ agent-notify :5010      │  │
                                       │  │ (标记文件 .agent/*.json) │  │
                                       │  └───────────┬────────────┘  │
                                       │              │ 文件变化监听    │
                                       │  ┌───────────▼────────────┐  │
                                       │  │ Pi Agent (0.84.4)       │  │
                                       │  │  ├ 扩展: 实时通知+自动触发 │  │
                                       │  │  └ CLI 桥接 (mcp-cli)    │  │
                                       │  └───────────┬────────────┘  │
                                       │              │               │
                                       │  ┌───────────▼────────────┐  │
                                       │  │ Git 仓库               │  │
                                       │  │  architecture/main.excalidraw│
                                       │  │  modules/ (Pi 产出代码)  │  │
                                       │  └────────────────────────┘  │
                                       └──────────────────────────────┘
```

**数据流（一次完整协作）**：

```
Android 画布(节点+箭头Binding)
  → [Send to Agent]     → 保存画布快照 + 通知 Pi（.agent/pending.json）
  → [Approve]           → 写入批准标记（.agent/approved.json）
  → Pi 自动执行          → 读取画布 → Review Gate → 执行任务
  → MCP 回写画布         → 新增/更新节点、箭头、任务状态（实时同步回 Android）
  → export 入库 Git      → architecture/main.excalidraw 版本化
  → 清除标记             → Web UI 按钮恢复，闭环完成
```

## 功能清单

| 能力 | 说明 |
|---|---|
| 无限画布 | Excalidraw 完整功能：无限画布、缩放平移、触摸、手写笔、形状/文本/图片、箭头 |
| Arrow Binding | 箭头 source/target/binding/label 完整保留（结构化语义） |
| Android 访问 | `http://<LAN-IP>:5001`，触摸/手写笔优化，PWA 可安装 |
| 中文界面 | 默认简体中文（与 excalidraw.com 同款官方翻译），底部浮窗可切换 English，右上角 header 文本随语言同步 |
| Send to Agent | Web UI 按钮：发送画布通知给 Pi（1s 绿色"已发送"反馈） |
| Send to Task Set | Web UI 按钮（Send to Agent 左侧）：将画布中各 frame 的未完成任务写入对应项目 `.pi/task_set.json`（幂等去重、P 级排序） |
| Approve | Web UI 批准按钮：黄(待处理)→绿(已批准)，未 Send 时不显示，悬停提示严肃审查 |
| Reject | Web UI 红色拒绝按钮：回退已发送内容 + 恢复画布快照 + 通知 Pi 回滚已执行任务 |
| Pi 实时通知 | Pi 扩展实时监听标记，TUI 弹出通知 + 收件箱 Widget，自动触发 agent 执行 |
| Review Gate | 门禁协议：变更检测（节点/箭头/Binding 增删改）、任务元数据、破坏性操作双重确认 |
| Git 版本化 | 画布文件作为正式资产入库，任务↔commit 可追溯 |
| MCP(CLI) 桥接 | Pi 通过 CLI 驱动画布：describe/add/update/delete/export/import |
| 认证（可选） | Basic Auth 反向代理 + WebSocket 转发，供公网场景 |

## 目录结构

```
excalidraw-workspace/
├── architecture/
│   ├── main.excalidraw        # 主架构画布（Git 正式资产）
│   └── README.md              # 数据模型映射与可追溯性约定
├── modules/auth/              # Pi 产出示例代码（登录模块）
├── tools/
│   ├── review-gate.mjs        # Review Gate 快照/变更检测
│   ├── agent-notify.mjs       # 通知服务（:5010，标记文件）
│   ├── exec-log.mjs           # 任务执行日志与回滚
│   ├── patch-pwa.mjs          # Web UI PWA + 按钮注入补丁
│   ├── patch-i18n.mjs         # Web UI 中文默认语言 + 语言切换器补丁
│   ├── auth-proxy.mjs         # 可选 Basic Auth 代理
│   └── pi-extensions/
│       └── agent-notify-watch.ts  # Pi 扩展（实时通知+自动触发+Reject回滚指示）
├── webui/
│   └── send-to-agent.js       # Web UI 按钮注入脚本（Send/Approve/Reject）
├── start-canvas.bat           # 一键启动（canvas server + agent-notify）
├── mcp-cli.bat                # MCP CLI 桥接封装
├── GATE.md                    # Review Gate 协议
├── SECURITY.md                # 安全说明
└── FINAL-ACCEPTANCE.md        # 最终验收清单
```

## 上游依赖与借鉴项目

本项目遵循"优先复用成熟组件，不自研画布引擎"原则，核心组件来自上游开源项目：

| 组件 | 上游项目 | 版本 | 用途 |
|---|---|---|---|
| Excalidraw 画布引擎 | [excalidraw/excalidraw](https://github.com/excalidraw/excalidraw)（`@excalidraw/excalidraw`）| 0.18.1 | React 组件、无限画布、触摸/手写笔、Arrow Binding |
| Canvas Server + MCP + CLI | [yctimlin/mcp_excalidraw](https://github.com/yctimlin/mcp_excalidraw)（`mcp-excalidraw-server`）| 2.0.0 | 自托管 Excalidraw Web UI + REST + WebSocket 实时同步；元素级 CRUD；`.excalidraw` 导出/导入；Arrow Binding 保留；结构化 describe |
| Pi Coding Agent | [mariozechner/pi-coding-agent](https://github.com/mariozechner/pi-coding-agent)（`@earendil-works/pi-coding-agent`）| 0.84.4 | Agent 宿主；扩展机制（事件/UI/自定义工具）实现实时通知与自动触发 |

> **选型说明**：Pi 0.84.4 不内置 MCP，本项目采用 **CLI 桥接**方案（`mcp-excalidraw-server` 的 CLI + REST），由本项目自研扩展层补齐"实时通知 / 自动触发 / 批准拒绝 / 回滚"等协作能力。
>
> 本项目自研部分：`webui/`（按钮注入）、`tools/`（通知服务/门禁/回滚/PWA 补丁）、Pi 扩展 `agent-notify-watch.ts`、协作协议（GATE.md / SECURITY.md）。

## 快速开始

### 环境要求

- Windows 10/11（本项目在 Windows 11 验证）、Node.js ≥ 20（使用 22）、Git
- 可选：Android 手机（同局域网）用于画布操作

### 安装与启动

```bash
# 1. 安装依赖
npm install

# 2. 启动服务（canvas server :5001 + agent-notify :5010）
start-canvas.bat
# 或分开启动：
#   PORT=5001 HOST=0.0.0.0 node node_modules/mcp-excalidraw-server/dist/server.js
#   node tools/agent-notify.mjs

# 2b. 工作区 UI（可选，独立 Vite 应用，端口 :5002 不占 5001）
npm run dev        # http://localhost:5002 （修改 src/ 时热更新）
npm run build && npm run preview   # 生产预览同样在 :5002

# 3. 安装 Pi 扩展（实时通知 + 自动执行）
copy tools\pi-extensions\agent-notify-watch.ts %USERPROFILE%\.pi\agent\extensions\
# Pi 中执行 /reload

# 4. Web UI 打补丁（PWA + Send/Approve/Reject 按钮）
node tools/patch-pwa.mjs

# 5. 浏览器 / Android 打开
#    http://192.168.0.1:5001   （换成你的 LAN IP）
```

### 防火墙（Android 局域网访问）

管理员 CMD：

```bat
netsh advfirewall firewall add rule name="Excalidraw Workspace 5001" dir=in action=allow protocol=TCP localport=5001 remoteip=192.168.0.0/255.255.0.0
```

## 协作流程

### Send to Task Set（画布任务 → 项目任务集）

1. 在画布上用 **frame tool（框架）** 框定各项目区域，**frame 名 = 项目名**（如 `excalidraw-workspace`，映射到 `<项目根>/.pi/task_set.json`；也支持绝对路径）
2. frame 内添加文本任务：行首 `P0`~`P3` 为优先级（默认 P2）；行首 `✓`/`已完成` 表示完成（自动跳过）
3. 点击 **Send to Task Set**（发送到任务集）：各 frame 的未完成任务写入对应项目的 `.pi/task_set.json` —— 标题去重（幂等）、生成 `T-日期-序号` id、状态"待执行"、P 级稳定排序

### Send to Agent

1. 在画布上画任务（节点 + 箭头 Binding）
2. 点击 **Send to Agent**（蓝色）：通知 Pi 并保存画布快照，按钮短暂显示绿色"已发送"
3. Pi 实时收到通知（扩展弹出 📮 + 收件箱 Widget）

### Approve / Reject

- **Approve**（Send 后显示，黄色）：批准画布任务，悬停提示"请严肃审查画布内容，再点击执行"；点击后变绿，Pi 自动开始执行
- **Reject**（Send 后显示，红色）：回退已发送内容、恢复画布快照、通知 Pi 停止并回滚已执行的文件修改（`exec-log.mjs rollback`）
- 未 Send 时两个按钮均不显示

### Review Gate

Pi 执行前生成门禁报告：画布统计（节点/箭头/Binding）、增删改节点、任务范围、目标仓库/分支、计划动作。破坏性操作（批量删除/force push/生产变更等）需额外人工确认。详见 [GATE.md](GATE.md)。

## Pi 扩展（实时通知）

`agent-notify-watch.ts` 是 Pi 全局扩展（`~/.pi/agent/extensions/`），提供：

- **实时通知**：监听 `.agent/*.json` 标记，Pi TUI 弹出通知 + 顶部收件箱 Widget
- **自动触发**：检测到批准标记后通过 `pi.sendUserMessage()` 自动驱动 agent 执行画布任务（无需人工提示）
- **Reject 处理**：检测到拒绝标记后通知 agent 停止任务并回滚

```
安装：copy tools\pi-extensions\agent-notify-watch.ts %USERPROFILE%\.pi\agent\extensions\
生效：Pi 中 /reload
命令：/agent-inbox（手动刷新收件箱）
```

## 安全说明

- Canvas server API 无内置认证，默认绑定局域网（防火墙仅放行 192.168.0.0/23）
- 公网暴露必须启用认证代理（`tools/auth-proxy.mjs`，Basic Auth + WebSocket 转发）并配合 HTTPS
- 破坏性操作（批量删除、force push、生产变更、系统级配置、删除项目/画布）需 Review Gate 双重确认
- 详见 [SECURITY.md](SECURITY.md)

## 服务与常用命令

```bash
# 启动
start-canvas.bat                          # canvas server(:5001) + agent-notify(:5010)
npm run dev                               # 工作区 UI (:5002，与 Canvas Server 端口分离，可同时运行)

# Pi 操作画布（CLI 桥接）
mcp-cli.bat describe                      # 结构化读取画布（含 Connections/Binding）
mcp-cli.bat add                           # 创建元素（stdin JSON）
mcp-cli.bat update <id> --set '{...}'     # 更新元素
mcp-cli.bat delete <id...>                # 删除元素
mcp-cli.bat export --out architecture/main.excalidraw   # 导出入库
mcp-cli.bat import architecture/main.excalidraw         # 导入恢复

# Review Gate
node tools/review-gate.mjs --task "..." --planned "..." [--destructive]

# 任务回滚（Reject 时）
node tools/exec-log.mjs list              # 查看执行日志
node tools/exec-log.mjs rollback          # 回滚所有记录

# Web UI 补丁（PWA + 按钮）
node tools/patch-pwa.mjs

# Web UI 补丁（默认中文 + 底部浮窗语言切换；start-canvas.bat 启动时自动执行）
node tools/patch-i18n.mjs
```

## License

本项目基于 [MIT](LICENSE) 协议开源。

上游组件（均为 MIT）：

- [Excalidraw](https://github.com/excalidraw/excalidraw)（`@excalidraw/excalidraw`）
- [mcp_excalidraw](https://github.com/yctimlin/mcp_excalidraw)（`mcp-excalidraw-server`）
- [pi-coding-agent](https://github.com/mariozechner/pi-coding-agent)（`@earendil-works/pi-coding-agent`）
- React / Vite

> 注：Excalidraw 的 MIT 许可证附带商标条款 —— 未经许可不得将 "Excalidraw" 名称与 Logo 用于推广营销。
