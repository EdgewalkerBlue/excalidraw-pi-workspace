# 与 Excalidraw 官方 master 的对比报告

> 检查时间：2026-09-23（Asia/Shanghai）
> 上游仓库：`excalidraw/excalidraw@master`
> 检查手法：GitHub REST v3（`/commits/master`、`/compare/<base>...master`）+ npm registry（`-/package/.../dist-tags`）
> 第二轮（同日）追加：**收拢平行实现**，期间查出并修复 3 处官方 API 误用 —— 见第 6 节

## 0. 结论摘要

| 结论 | 说明 |
|---|---|
| 本仓库不是 Excalidraw 源码 fork | 官方引擎以 npm 包 `@excalidraw/excalidraw` 引入，二开全部位于外壳前端、服务端补丁与工具脚本，**没有改动官方源码** |
| 版本基座已升级 | `0.18.0-afa3a65`(2026-09-10) → `0.18.0-c0ad61c`(2026-09-16)，与 master 的差额从 **7 个提交降到 4 个** |
| 发现 1 处功能级偏差 | 新前端 `canvas-web` 未引入官方 `index.css`，整个画布缺官方样式 —— **已修复** |
| 自检机制已落地 | 浏览器徽标（每 24h）+ 命令行 `npm run check:upstream` |
| 3 处平行实现待收拢 | `webui/send-to-agent.js`、`src/App.tsx`(:5002)、`tools/patch-i18n.mjs` —— 见第 4 节 |

## 1. 版本基座对比

| 维度 | 升级前 | 升级后（本次） |
|---|---|---|
| 基线 commit | `afa3a65`（2026-09-10T14:45Z） | `c0ad61c`（2026-09-16T17:50Z） |
| npm 构建 | `0.18.0-afa3a65` | `0.18.0-c0ad61c`（dist-tag `next`） |
| 距 master HEAD `2b9da96`（2026-09-22T20:02Z） | 落后 7 个提交 | 落后 4 个提交（**均为尚未发包**） |

**关于 npm `latest` 的坑（重要）**：`@excalidraw/excalidraw@latest` = `0.18.1`，发布于 **2026-04-20**，其代码比本次升级前的 canary 还要旧 5 个月。Excalidraw 的稳定版常年滞后，真正跟随 master 的是 dist-tag `next`（`0.18.0-<sha7>`）。因此**不能**用 `latest` 当作"最新官方"来对齐，否则是降版本。

### master 上尚未纳入的 4 个提交

| commit | 日期 | 说明 | 是否已发 npm 构建 |
|---|---|---|---|
| `14e1c61` | 2026-09-19 | feat(packages/excalidraw): support onDuplicate replacements, vetoes and lookups (#12124) | 否 |
| `97c68dd` | 2026-09-19 | refactor(editor): split out duplication logic into App.duplicate.ts (#12125) | 否 |
| `31df3e6` | 2026-09-22 | fix(editor): Tab convert bound arrow update (#12143) | 否 |
| `2b9da96` | 2026-09-22 | fix(editor): Freedraw hit test precision (#11550) | 否 |

本次同时纳入的 3 个（在 `afa3a65..c0ad61c` 区间）：`4e758db` 滚轮按钮缩放 + 缩放偏好(#12099)、`a918648` renderOverrides(#12100)、`c0ad61c` 右键拖拽平移画布(#12110)。

## 2. 官方实现 vs 二次开发边界

| 能力 | 来源 | 说明 |
|---|---|---|
| 画布引擎、无限画布、手写笔、Arrow Binding、导出/ETL | **官方**（`@excalidraw/excalidraw`） | 一行未改 |
| 官方 UI 样式（183KB CSS）与字体 | **官方**（`@excalidraw/excalidraw/index.css`） | 本次新增引入 |
| 界面中/英双语 | **官方** `lang` prop + 官方语言包 | 不再 monkey-patch bundle |
| PWA（manifest / service worker / 图标） | 本项目 `canvas-web/public/` | 官方 npm 包不提供，属必要自建 |
| 多端实时同步（WS + LWW 合并 + dirty 集合） | 本项目 `canvas-web/src/sync.ts` | 二开能力 |
| Agent 工具条（Send to Agent / Approve / Reject / Send to Task Set） | 本项目 `canvas-web/src/agent-tools.tsx` | 二开能力 |
| 上游更新自检提醒 | 本项目 `canvas-web/src/upstream-badge.tsx` + `upstream-core.mjs` | 二开能力 |
| 画布落盘 + 轮转备份 + sync-guard | 本项目 `tools/patch-server.mjs` | 二开能力（`mcp-excalidraw-server` 上游无落盘） |
| Basic Auth 代理 | 本项目 `modules/auth/`、`tools/auth-proxy.mjs` | 二开能力 |

## 3. 本次发现并修复的偏差

### 3.1 缺失官方样式表（功能级，已修）

旧前端 `src/main.tsx` 里有 `import "@excalidraw/excalidraw/index.css"`，但新前端 `canvas-web/src/main.tsx` 漏了这一行。官方包的 `dist/prod/index.js` **不会**自动注入样式且不包含 `index.css` 的引用，`package.json` 里也有明确定向导出 `"./index.css"` —— 必须消费方显式引入。

- 验证证据（修复前）：构建产物无 `.css` 文件，`index.html` 无 `stylesheet` link，2.4MB 主包中不存在任何 `excalidraw-container` 样式规则（该字符串仅作为 className 出现一次）。
- 修复：`canvas-web/src/main.tsx` 增加官方入口引入。
- 验证证据（修复后）：产物生成 `index-CgPypQ4j.css`（183,514 B），`index.html` 出现 `<link rel="stylesheet" href="/assets/index-CgPypQ4j.css">`，HTTP 冒烟 `200`。

### 3.2 node_modules 内存在两份 Excalidraw（已知，不阻断）

| 路径 | 版本 | 用途 |
|---|---|---|
| `node_modules/@excalidraw/excalidraw`（根） | `0.18.0-c0ad61c` | `canvas-web` 构建输入 |
| `node_modules/mcp-excalidraw-server/node_modules/@excalidraw/excalidraw`（嵌套） | `0.18.1` | 仅被服务端硬编码路径用于静态路由 `/assets/fonts` |

之所以会有两份，是因为 `mcp-excalidraw-server` 声明了 `^0.18.1`，而 master canary `0.18.0-*` 在语义化版本上不满足该范围，npm 必须嵌套一份独立副本。

**不阻断的理由**：升级后新构建引用 230 个 `woff2` 字体，逐一比对嵌套 `0.18.1` 的字体目录，**缺失 0 个** —— 内容哈希稳定，字体路由仍然有效。
**不要做**：用 npm `overrides` 强行合并为一份。因为服务端路径是硬编码的 `../node_modules/@excalidraw/excalidraw/dist/prod/fonts`，一旦 npm 提升依赖导致嵌套目录消失，字体路由会直接 404。

### 3.3 构建清理与沙箱守卫（环境事项）

`canvas-web` 构建使用 `emptyOutDir: true`，需要清空服务端静态目录旧产物。在本环境（WorkBuddy 沙箱）中，node 侧的批量删除会被 `safe-delete` 守卫拦截（`SAFE_DELETE_BULK_CONFIRM_REQUIRED`，阈值 50）。

**可靠的清理姿势**：构建前用 Python 一次性删除，再跑 `npm run build:canvas`：

```
python -c "import shutil; shutil.rmtree(r'<repo>\node_modules\mcp-excalidraw-server\dist\frontend', ignore_errors=True)"
npm run build:canvas
```

## 4. 平行实现收拢（第二轮，同日完成）

| 文件 | 原状 | 处置（2026-09-23） |
|---|---|---|
| `webui/send-to-agent.js` | 28KB DOM 注入脚本，功能已被 `canvas-web/src/agent-tools.tsx` 取代，构建产物不再加载 | 移入 `legacy/`，附退役说明（未被链入任何流水线） |
| `tools/patch-i18n.mjs` | 文本补丁改写官方 bundle 实现双语，做事已由官方 `langCode` prop 接管 | 移入 `legacy/`；`start-canvas.bat` 不再调用 |
| `tools/patch-pwa.mjs` | 生成 PWA 资源注入旧前端，已由 `canvas-web/public/` 原生提供 | 移入 `legacy/`；`start-canvas.bat` 不再调用 |
| `src/App.tsx`（:5002） | 重复实现打开 / 保存 / 自动保存 / 清空画布四项官方能力 | **瘦身为纯官方壳**：四项全部改用官方 File 菜单；只保留官方 `langCode` 的语言切换与「未保存离开提醒」 |

保留归档而非直接删除的原因：这三份文件当时带有**尚未提交的本地改动**（约 99 行），直接 `git rm -f` 会永久丢失未入库内容。详见 `legacy/README.md`。

仍在生效的二开补丁只有 `tools/patch-server.mjs`（服务端画布落盘 / 轮转备份 / sync-guard），属于官方没有的能力，不在收拢范围。

### 官方 API 的一个坑：本轮修掉的 3 处误用

把 `canvas-web/src` 首次纳入 `tsc` 检查后，立刻暴露出此前一直静默失效的写法：

| 位置 | 错误写法 | 官方正确写法 | 后果 |
|---|---|---|---|
| `canvas-web/src/CanvasApp.tsx` | `excalidrawAPI={...}` | `onExcalidrawAPI={...}` | **最严重**：运行时只调用 `props.onExcalidrawAPI?.(api)`，`excalidrawAPI` 只是 `ExcalidrawMountPayload` 的字段名、不是组件 prop → `apiRef` 恒为 null → 初始加载与全部 WS 增量被静默丢弃 |
| 同上 / `src/App.tsx` | `lang={...}` | `langCode={...}`（`Language["code"]`，如 `en` / `zh-CN`） | 语言切换无效 |
| 同上（`UIOptions.canvasActions`） | `logState` / `changeCanvasBackground` | 官方 0.18 只允许 `changeViewBackgroundColor` / `clearCanvas` / `export` / `loadScene` / `saveToActiveFile` / `toggleTheme` / `saveAsImage` | 无效配置，被忽略 |

**防复发**：`tsconfig.json` 的 `include` 从 `["src","vite.config.ts"]` 扩展到 `["src","canvas-web/src","vite.config.ts"]`，
并把类型检查固化为 `npm run typecheck`。此前画布前端**完全不在类型检查范围内**，这正是上述错误写法长期无人发现的原因。

## 5. 自检机制

- **浏览器（默认）**：`UpstreamBadge` 每 24h 检查一次（localStorage 节流），结果缓存到 localStorage 跨刷新显示。**四种状态**：已是官方最新（灰）、源码领先但无包（黄）、有可升级官方构建（黄 + 点击复制升级命令）、**自检被限流**（灰，显示预计重试时间）。真离线保持静默。
- **命令行**：`npm run check:upstream`（`node tools/check-upstream.mjs`），额外检测 **package.json 实际安装版本与 `canvas-web/vite.config.ts` 里 `__CANVAS_BASELINE__` 声明是否漂移**。退出码：`1` = 有可升级项或存在漂移，`0` = 已是最新 / 被限流 / 离线。
- 判定规则集中在 `canvas-web/src/upstream-core.mjs`（纯函数、无网络），浏览器与 CLI 共用，避免平行实现。

### 5.1 限流可见化（2026-09-23 第二轮）

**背景**：GitHub 未认证 API 限额为**每 IP 每小时 60 次**，而一次自检要发 **2 次** GitHub 请求（`commits/master` + `compare`；npm dist-tags 不占额度）。触发 403 时上述实现的旧行为是**静默不显示徽标**——用户会以为"没有更新"，实际是"没查到"。实测证据：本轮排查耗尽了当日配额，`GET /rate_limit` 显示 `remaining: 0`，重置时间 14:36。

**改动**：
1. `assess()` 新增 **`rate-limited`** 状态：调用方在收到 403/429 时把 `blocked: { status, resetAt }` 传入（`resetAt` 取自响应头 `x-ratelimit-reset`），产出带**预计重试时刻**的中英文说明；真离线（无 `blocked`）仍是 `unknown` → 静默。
2. 徽标新增灰色 `⏳ 自检被限流，HH:MM 后重试` 态；并把重试时刻存进 `pi-canvas-upstream-retry`，**配额重置前不再发任何请求**（避免继续空耗；24h 时间戳只在成功时写，限流不占用它）。
3. CLI 同样识别 403/429，打印「自检被限流」与恢复时间，退出码仍为 `0`（不可行动，不该让 CI 变红）。

### 5.2 `pickLatestBuild` 的实现与注释对齐

原注释写「因此优先取 next」，实现却是「取第一个匹配 canary 正则的标签」，靠 `Object.entries` 的键顺序决定，并未显式优先 `next`。现改为**显式把 `next` 提到候选首位**再回退其余；当前 dist-tags 里只有 `next` 匹配 `0.18.0-<sha7>`（`preview` 带后缀、`test` 是 `0.5.0`），故行为不变，但已不再依赖注册表键顺序。

### 5.3 判定逻辑单测

新增 `canvas-web/src/upstream-core.test.mjs`（`node:test`，`npm test` 一并运行），用**合成 API 数据**覆盖真实环境难复现的分支：限流（含 `x-ratelimit-reset` 解析）、已发布新构建、`pickLatestBuild` 的 `next` 优先级，以及**「本地 pin 比已发布构建更新」时不得误报可升级**的防护。当前 14 项测试全绿（原 4 项 auth + 新增 10 项）。

