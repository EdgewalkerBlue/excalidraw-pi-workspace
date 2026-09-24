**[English](README.md)** · [简体中文](README_ZH.md) — 本项目 README 以英文版为主，本文件是它的中文镜像。

> ### 一键部署 / One-click deploy
>
> Windows：直接运行 **`deploy.bat`**（装依赖 → 构建画布 → 启动服务 → 自动打开 `http://localhost:5001`）。
> 等价命令：
>
> ```bash
> git clone https://github.com/EdgewalkerBlue/excalidraw-pi-workspace.git
> cd excalidraw-pi-workspace
> npm install && npm run build:canvas && start-canvas.bat
> ```
>
> 只需要 :5001 画布即可跑起来；认证模式与 Pi 扩展见 [快速开始](#快速开始)。

# Excalidraw × Pi Agent 双向协作工作区

> **GitHub 项目简介** — *Excalidraw ⇄ AI 双向协作工作台：在 Excalidraw 官方 master 底层的无限画布上画出结构化需求，经 MCP CLI + Review Gate 发送给 Pi Coding Agent，并把执行结果回写到画布。*
>
> 仓库 About 里实际使用的是中英双语合并版（283 字符）：
> `Excalidraw × Pi Agent 双向协作工作区：在官方 Excalidraw 无限画布上画结构化需求，经 MCP CLI + Review Gate 交给 AI 编码 Agent 执行，并将结果回写画布。 | Bidirectional Excalidraw ⇄ AI coding-agent workspace: sketch requirements on an official-master canvas, dispatch them via MCP CLI + Review Gate, and write the results back.`
>
> Topics（已在仓库上设置）：`excalidraw` · `mcp` · `model-context-protocol` · `ai-agent` · `ai-coding-agent` · `infinite-canvas` · `react` · `typescript` · `pwa` · `human-in-the-loop` · `self-hosted` · `webdav`

自托管的 Excalidraw 无限画布，把「画图」变成**可执行需求**：画布上的节点 + 箭头绑定（Arrow Binding）一键发给 Pi Coding Agent，经 Approve / Reject 与 Review Gate 门禁后执行，并回写画布。

- **画布即结构化数据** —— Agent 通过 MCP CLI 读写元素（describe/add/update/delete/export/import），箭头绑定承载语义
- **持久化与协作** —— 服务端落盘 + 覆盖前轮转备份，WebSocket 多端实时同步
- **浏览器优先** —— 触摸/手写笔友好、PWA 可安装，桌面 / 平板 / 手机浏览器均可
- **适合谁** —— 想让「草图」变成「可执行需求」的独立开发者与小团队

| 端口 | 服务 | 说明 |
|---|---|---|
| 5001 | Canvas Server | `mcp-excalidraw-server`，协作锚点（绑定 `0.0.0.0`） |
| 5002 | 工作区 UI | 独立 Vite 应用，瘦身为纯官方壳（无自动保存） |
| 5003 | 认证代理（可选） | Basic Auth + WebSocket 转发，用于不可信网络 |
| 5004 | canvas-web 开发服务器 | `npm run dev:canvas`，`/api` 与 WS 代理到 :5001 |
| 5010 | agent-notify | Send / Approve / Reject 标记文件 |

## 整体架构

```
┌────────────────────────────┐        ┌───────────────────────────────┐
│  浏览器                      │        │  本机 (Windows)                │
│  Excalidraw 画布            │        │  ┌─────────────────────────┐  │
│  [Send to Agent][Approve]   │        │  │ Canvas Server :5001     │  │
│  [Reject] ●Connected       │        │  └───────────┬─────────────┘  │
└──────────┬─────────────────┘        │              │ REST /api      │
           │ WebSocket 实时同步        │  ┌───────────▼─────────────┐  │
           │ （内网，无认证）           │  │ agent-notify :5010      │  │
           ▼                          │  │ （.agent/*.json 标记）   │  │
    http://<LAN-IP>:5001              │  └───────────┬─────────────┘  │
                                      │              │ 文件监听        │
                                      │  ┌───────────▼─────────────┐  │
                                      │  │ Pi Agent + 扩展          │  │
                                      │  │  ├ 实时通知 + 自动触发    │  │
                                      │  │  └ CLI 桥接 (mcp-cli)    │  │
                                      │  └───────────┬─────────────┘  │
                                      │              │                │
                                      │  ┌───────────▼─────────────┐  │
                                      │  │ Git 仓库                 │  │
                                      │  │  modules/（Agent 产出）   │  │
                                      │  └─────────────────────────┘  │
                                      └───────────────────────────────┘
```

## 功能清单

| 能力 | 说明 |
|---|---|
| 无限画布 | 官方 Excalidraw 完整能力：缩放平移、触摸、手写笔、图形/文本/图片、箭头 |
| 箭头绑定 | 起点/终点/binding/标签完整保留 —— Agent 读取的结构化语义 |
| 界面语言 | 跟随浏览器语言（`zh*` → 简体中文，其余英文），通过官方 `langCode` prop 生效；工具条按钮可切换，偏好记在 `localStorage`（按 origin 隔离） |
| 主题 | 工具条按钮循环 浅色 → 深色 → 跟随系统（会持久化）。走官方 `theme` prop，整套 UI 用官方深色主题（235 个 CSS 变量，其中 84 个在 `.theme--dark` 下被重定义），画布内容由官方 `applyDarkModeFilter` 重新着色 |
| 画布背景色 | 工具条取色器：**7 种浅色 + 末位纯黑**，另有自定义 `#rrggbb` 输入；写入官方 `appState.viewBackgroundColor`（官方自带的背景取色器在 File 菜单里仍然可用）。**导出图片使用该底色，不再强制白底** |
| 画布持久化 | 服务端落盘，覆盖前轮转备份（保留 20 份）；`.excalidraw` 归档留本地（已 gitignore） |
| Send to Agent | 工具条按钮通知 Pi，绿色「已发送」反馈 |
| Send to Task Set | 把画布各项目框内的未完成任务写入对应项目 `.pi/task_set.json`（按标题去重、按优先级排序） |
| Approve / Reject | Approve（黄→绿）启动执行；Reject 回退已发送内容并还原快照 |
| Pi 实时通知 | 扩展监听标记文件：TUI 弹窗 + 收件箱组件 + 自动触发 |
| Review Gate | 执行前生成门禁报告（节点/箭头差异、范围、计划动作），破坏性操作需二次确认 —— 见 [GATE.md](GATE.md) |
| MCP CLI 桥接 | `mcp-cli.bat describe/add/update/delete/export/import` |
| 保存目标 | 工具条 **「保存到…」**：本地 `.excalidraw`（走官方 `serializeAsJSON`）、**WebDAV**（坚果云 / Nextcloud / 群晖…）、以及 **Dropbox / Google Drive / OneDrive** 的 OAuth 2.0 + PKCE 直传；另有百度网盘 / 阿里云盘 / 夸克 / 微云的「导出 + 打开上传页」快捷入口。见 [保存到网盘](#保存到网盘) |
| 认证（可选） | Basic Auth 代理 + WebSocket 转发 |
| 上游自检 | 画布右上角徽标提示官方是否有新构建 |
| 二开仓库入口 | 汉堡菜单「Excalidraw links」区里，官方 GitHub **下方**多一条二开仓库链接（官方菜单没有扩展点，故采用范围可控的 DOM 注入 —— 见 `canvas-web/src/extra-menu-links.mjs`） |

> **2026-09-23 随前端切换到 `canvas-web/` 而退役**（见 [legacy/README.md](legacy/README.md)）：**frame 边框色色板**（原在 `webui/send-to-agent.js`）与**跨入口语言记忆（cookie）**（原在 `tools/patch-i18n.mjs`）。语言偏好现在只按 origin 存 `localStorage`。

## 目录结构

```
excalidraw-workspace/
├── canvas-web/                 # :5001 前端 —— 官方 Excalidraw 底座 + 二次开发
│   ├── public/                 # PWA 资源（manifest / sw / 图标）
│   └── src/
│       ├── CanvasApp.tsx       # 官方壳（onExcalidrawAPI / langCode / theme）+ sync 装配
│       ├── sync.ts             # 多端实时同步客户端
│       ├── agent-tools.tsx     # Send to Agent / Approve / Reject / Send to Task Set
│       ├── upstream-badge.tsx  # 上游更新提醒
│       └── upstream-core.mjs   # 自检判定规则 SSOT（与 tools/check-upstream.mjs 共用）
├── src/                        # :5002 工作区 UI —— 纯官方壳
├── tools/
│   ├── agent-notify.mjs        # 通知服务（:5010）
│   ├── patch-server.mjs        # Canvas server 落盘 / 备份 / sync-guard 补丁
│   ├── check-upstream.mjs      # 底层自检命令行
│   ├── review-gate.mjs         # Review Gate 变更检测
│   ├── exec-log.mjs            # 执行日志与回滚
│   ├── fix-canvas-indices.mjs  # 元素 index 规范化
│   ├── auth-proxy.mjs          # 可选 Basic Auth 代理
│   └── pi-extensions/agent-notify-watch.ts
├── modules/                    # Agent 产出示例代码
├── architecture/               # .excalidraw 归档（本地，不入 Git）
├── legacy/                     # 已退役实现，见 legacy/README.md
├── UPSTREAM-DIFF.md            # 与 excalidraw/excalidraw 官方 master 的对比报告
├── GATE.md · SECURITY.md · FINAL-ACCEPTANCE.md
├── deploy.bat                 # 一键部署（装依赖 → 构建 → 启动）
├── start-canvas.bat · start-auth.bat · mcp-cli.bat
└── README.md · README_ZH.md
```

## 上游底层

画布**不是** Excalidraw 源码 fork：它以官方 npm 构建为底座，并把「构建时用的是哪个 master 快照」固化成基线（baseline）。除二次开发面之外全部复用官方实现（引擎、渲染、`langCode` 切换、官方 `index.css`）。

| 组件 | 上游 | 版本 | 作用 |
|---|---|---|---|
| 画布引擎 | [excalidraw/excalidraw](https://github.com/excalidraw/excalidraw) | `0.18.0-c0ad61c` | React 组件、无限画布、箭头绑定 |
| Canvas Server + MCP + CLI | [mcp_excalidraw](https://github.com/yctimlin/mcp_excalidraw) | 2.0.0 | REST + WebSocket 同步、元素 CRUD、`.excalidraw` 读写 |
| Agent 宿主 | [pi-coding-agent](https://github.com/mariozechner/pi-coding-agent) | 0.84.4 | 扩展机制实现实时通知 / 自动触发 |

**基线**（编译期由 `canvas-web/vite.config.ts` 注入）：

| 项 | 值 |
|---|---|
| 基线 commit | `c0ad61c`（2026-09-16） |
| 升级时的上游 `master` HEAD | `2b9da96`（2026-09-22） |
| 尚未发包的 master 提交 | 4 个（`14e1c61`、`97c68dd`、`31df3e6`、`2b9da96`） |

> **不要用 npm `latest` 对齐。** `latest` 是 `0.18.1`，发布于 2026-04-20，代码比当前 canary 旧约 5 个月。跟随 master 的是 dist-tag **`next`**（`0.18.0-<sha7>`）。完整对比见 [UPSTREAM-DIFF.md](UPSTREAM-DIFF.md)。

**自检** —— 画布徽标每 24h 查一次上游 `master` 与 npm dist-tags，共四态：`✓ 官方最新`（灰）、`源码领先 N`（黄，尚未发包）、`官方新构建 <版本>`（黄，点击复制升级命令）、`⏳ 自检被限流，HH:MM 后重试`（灰）。真正的网络故障保持静默，但 GitHub 未认证接口的限流（每 IP 每小时 60 次，一次自检消耗 2 次）会**显式提示而不是让徽标消失**；配额耗尽期间不再发请求。命令行版额外检测**基线漂移**（声明的 `__CANVAS_BASELINE__` 与实际安装版本不一致）：

```bash
npm run check:upstream          # 退出码 1 = 有可升级项或发生漂移
```

判定规则有单测覆盖（用合成 API 数据，含限流分支与「本地 pin 比已发布构建更新」的误报防护）：`npm test`（见 `canvas-web/src/upstream-core.test.mjs`）。

升级步骤：`npm install @excalidraw/excalidraw@<版本>` → 同步 `canvas-web/vite.config.ts` 里的 `__CANVAS_BASELINE__` → `npm run build:canvas` → 重启画布。

## 快速开始

**环境要求**：Windows 10/11、Node.js ≥ 20（使用 22）、Git。可选：局域网内其他设备的浏览器。

```bash
# 1. 安装依赖
npm install

# 2. 启动 canvas server(:5001) + agent-notify(:5010)，自动执行落盘补丁
#    （deploy.bat 一步完成第 1-2 步）
start-canvas.bat
#   手动：PORT=5001 HOST=0.0.0.0 node node_modules/mcp-excalidraw-server/dist/server.js
#        node tools/agent-notify.mjs

# 2a. 不可信网络：认证模式（canvas 绑 127.0.0.1，代理 :5003）
start-auth.bat          # 首次运行生成随机密码 .auth.env（已 gitignore）

# 2b. 可选的独立壳（:5002）—— 无自动保存，请用 File → Save as
npm run dev

# 3. 安装 Pi 扩展，然后在 Pi 中执行 /reload
copy tools\pi-extensions\agent-notify-watch.ts %USERPROFILE%\.pi\agent\extensions\automation\

# 4. 浏览器打开 http://<LAN-IP>:5001（桌面 / 平板 / 手机均可）
```

防火墙（管理员 CMD）—— 只放行你的内网网段：

```bat
netsh advfirewall firewall add rule name="Excalidraw Workspace 5001" dir=in action=allow protocol=TCP localport=5001 remoteip=<LAN-CIDR>
```

## 协作流程

- **Send to Task Set** —— 用 frame 工具框住每个项目区（frame 名 = 项目名），框内写任务；前缀 `P0`–`P3` 定优先级，`✓`/`已完成` 标记完成（自动跳过）。按钮只保留未完成项，按标题去重，追加 `T-date-seq` id。
- **Send to Agent** —— 画好后点蓝色按钮：通知 Pi 并保存快照。
- **Approve / Reject** —— 发送后出现。Approve 启动执行（悬停提示先认真审查）；Reject 回退已发送内容、还原快照并通知 Pi 回滚。
- **Review Gate** —— 执行前生成门禁报告，破坏性操作需二次确认。见 [GATE.md](GATE.md)。

## 常用命令

```bash
npm run typecheck      # tsc 覆盖 src/ 与 canvas-web/src
npm run build:canvas   # 重建 canvas-web 到 Canvas Server 静态目录
npm run build:canvas:safe   # 同上，但先构建到临时目录再整体替换（目标被占用/半残时更安全）
npm run dev:canvas     # canvas-web 开发服务器（:5004）
npm run ship -- -m "feat: xxx"   # 提交 → 推 DEV → 合并 master → 自动切回 DEV
mcp-cli.bat describe | add | update <id> --set '{...}' | delete <id...>
mcp-cli.bat export --out architecture/main.excalidraw   # 本地快照
node tools/review-gate.mjs --task "..." --planned "..." [--destructive]
node tools/exec-log.mjs list | rollback                 # 执行日志 / 回滚
node tools/patch-server.mjs                             # 落盘补丁（启动时自动执行）
node tools/fix-canvas-indices.mjs --server http://127.0.0.1:5001
```

## 保存到网盘

官方那个「保存到…」对话框的卡片是**硬编码**的（只有本地卡片与一个可选的分享链接卡片，**没有扩展点**），所以本项目在工具条上自建入口。所有联网动作都交给一个本机中转服务：浏览器无法直接调 WebDAV / 网盘接口（跨域），且授权码换 token 不该放在页面里。

```
浏览器（画布）  --HTTP-->  save-bridge  :5011  --HTTPS-->  WebDAV / Dropbox / Google Drive / OneDrive
```

| 组成 | 位置 | 说明 |
|---|---|---|
| 中转服务 | `tools/save-bridge.mjs`（`:5011`） | 由 `start-canvas.bat` 启动；默认只监听 `127.0.0.1` |
| 纯逻辑（规格 / PKCE / URL 构造） | `tools/save-targets.mjs` | 离线单测覆盖，含 RFC 7636 官方测试向量 |
| 凭据与 token | `.save-targets.json` | **已 gitignore**；接口永不回传 WebDAV 密码 |
| 回归检查 | `node tools/save-bridge.integration.mjs` | 配合 `tools/dev-stub-webdav.mjs` 的桩服务器，不需要真实网盘 |

**WebDAV** —— 不需要注册任何应用。打开「保存到…」，填地址 / 用户名 / 应用密码，点**测试连接**，再点**保存到 WebDAV**。坚果云（`https://dav.jianguoyun.com/dav/`）、Nextcloud、群晖、TeraCLOUD 等都能用。

**Dropbox / Google Drive / OneDrive** —— 各需一次性注册应用，回调地址填中转服务的：

```
http://127.0.0.1:5011/oauth/callback        # 其他设备访问时用 http://<主机局域网IP>:5011/oauth/callback
```

把拿到的 `client_id` 粘进对话框，点**授权**，之后即可**保存到此处**。走 PKCE 公共客户端流程，**不使用也不保存 `client_secret`**，token 过期自动刷新。

> **安全默认**：中转服务只监听 `127.0.0.1`。若要手机等设备也能保存，需设 `SAVE_BRIDGE_HOST=0.0.0.0`，并清楚此时局域网内任何人都能访问这些上传接口。

## 分支与发布流程

开发固定在 **`DEV`** 分支；`master` 是发布分支（也是仓库默认分支）。一条命令跑完整套流程 —— 提交、推 `DEV`、合并进 `master`，并**始终切回 `DEV`**（即使中途失败也保证回切）：

```bash
npm run ship -- -m "feat: xxx"      # 或：ship.bat -m "feat: xxx"  /  bash tools/ship.sh -m "feat: xxx"
npm run ship -- -m "xxx" --dry-run  # 只打印将要执行的 git 命令
```

`tools/ship.sh` 是唯一实现（POSIX sh；`ship.bat` 只是定位 Git Bash 的启动器）。它会拒绝在 `DEV` 之外运行、把本机专属路径（`.pi/`、`exp-*.json`）排除在提交之外，并在检测到失效代理导致推送失败时自动改用直连重试。

## 安全

- 画布 API **无内置认证**且默认绑定局域网 —— 用防火墙规则收敛，或放到认证代理（+ HTTPS）之后
- 破坏性操作需 Review Gate 二次确认
- 详见 [SECURITY.md](SECURITY.md)

## 许可

[MIT](LICENSE)。上游组件均为 MIT：Excalidraw、mcp_excalidraw、pi-coding-agent、React、Vite。

> Excalidraw 的 MIT 许可附带商标条款 —— 未经许可不得将「Excalidraw」名称与 logo 用于宣传推广。
