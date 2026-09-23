# legacy/ — 已退役的平行实现（历史留存，不参与流水线）

退役日期：2026-09-23。原因：2026-09-22 起 :5001 画布前端由 `canvas-web/`
（官方 `@excalidraw/excalidraw` React 壳 + 本项目二开）提供，下列实现所依赖的
"给 mcp-excalidraw-server 内嵌前端打补丁"的形态不再存在，且它们做的事已由官方能力
或新前端原生实现接管。遵守项目原则「除二次开发功能外复用官方的」收拢到此目录。

| 存档文件 | 原职责 | 由谁接管 |
|---|---|---|
| `send-to-agent.js` | DOM 注入式 Send to Agent / Approve / Reject 按钮 + 底部语言切换器 | `canvas-web/src/agent-tools.tsx`（原生 React 组件）；语言切换由官方 `lang` prop + 顶部按钮 |
| `patch-i18n.mjs` | 文本补丁改写官方 bundle 实现默认英文/中文切换、补齐缺失翻译 | 官方 `lang` prop（新实现仅保留现有功能，不再 monkey-patch 官方 bundle） |
| `patch-pwa.mjs` | 生成 PWA 图标/manifest/sw 并注入旧前端 | `canvas-web/public/`（manifest.json / sw.js / icon-192.png / icon-512.png），构建时复制到产物 |

## 为什么要保留而不是直接删除

归档时这三份文件仍有未提交的本地改动（约 99 行），直接 `git rm -f` 会丢失这些
尚未进入 Git 历史的内容。安全起见先移过来；确认无引用价值后再删除。

## 恢复须知

这三个脚本内部的根目录由 `__dirname/..` 推导，移动到 `legacy/` 后相对路径已失效；
若要重新启用必须回到 `tools/`（或 `webui/`）原位置并修正 ROOT/FRONTEND 路径。

仍在生效的是 `tools/patch-server.mjs` —— 它为 mcp-excalidraw-server 补齐画布落盘、
轮转备份与 sync-guard，属于真正的二开能力，不在本次收拢范围内。
