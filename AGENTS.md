# excalidraw-workspace（Excalidraw 画布服务）

> 画布服务（5001 WEBUI / mcp-excalidraw-server）与 Pi 协作协议。本节内容原位于全局`~/.pi/agent/AGENTS.md`，已随项目自治迁移至此。

# 术语约定（重要）

- **画布 = `http://192.168.0.1:5001`**：Excalidraw 无限画布 WEBUI（项目规划用）。用户说"画布"即指此 WEBUI。
- 回写画布方式：`GET http://192.168.0.1:5001/api/elements` 读现有元素，`POST /api/elements/sync` 提交全量 `{elements:[...], timestamp}`（Excalidraw 元素 JSON 格式）。已有元素必须保留合并，勿覆盖。
- 项目内 `docs/项目画布.md` 为画布内容文字镜像，以 WEBUI 为准。

# 画布持久化与 .excalidraw 归档（已启用）

- **持久化（自动）**：5001 服务（mcp-excalidraw-server，源码 `D:/projects/excalidraw-workspace/node_modules/mcp-excalidraw-server/`）已打补丁：每次元素变更落盘到 `%LOCALAPPDATA%\Excalidraw-Canvas\canvas-store.json`，启动时自动恢复；空场景不覆盖旧档（防误清空）。重启服务即可生效，无需其它操作。
- **落盘轮转备份（已启用）**：覆盖前自动备份到 `%LOCALAPPDATA%\Excalidraw-Canvas\backups\`（保留 20 份，`tools/patch-server.mjs` 注入）。画布被误覆盖/误清空时，从这里找回最近版本。
- **.excalidraw 归档（每次回写后同步）**：把当前画布内容导出为 `.excalidraw` 场景 JSON（`{type:"excalidraw",version:2,source:"mcp-excalidraw-server",elements:[...],appState:{viewBackgroundColor:"#ffffff",gridSize:null}}`），保存到**同名项目目录下的 `.pi` 目录**，文件名与项目同名（如 `D:\projects\TooBaCO_Warehouse_Print_Workbench\.pi\TooBaCO_Warehouse_Print_Workbench.excalidraw`）。

# 画布回写与操作约定（必须遵守）

1. **md / 外部数据 → 画布回写，必须先过 index 规范化**：
   - 回写前对元素执行 `node D:/projects/excalidraw-workspace/tools/fix-canvas-indices.mjs <输入.json> <输出.json>`（或在线 `--server`），确保所有元素 index 为合法小写序列（a0,a1,…）。
   - **原因（踩坑记录）**：大写/非法 index（如 aA0..aV0）会让 Excalidraw 新增元素时抛 `ELEMENT_HAS_INVALID_INDEX` → 画布只能编辑已有元素、无法新建（曾致 TooBaCO 画布故障，需清空才恢复）。
   - 手工构造元素（无 index 字段）时同样按 a0,a1,… 递增编号。
2. **批量/导入/恢复前先备份**：`curl http://127.0.0.1:5001/api/elements` 存一份（落盘轮转自动备份作为兜底）。
3. **已知陷阱 / 现状（sync 保护已启用 v1）**：浏览器页面 sync 曾为全量覆盖（clear+write）。现已打补丁（`tools/patch-server.mjs` → server.js sync 合并/保护）：
   - **空 sync 保护**：server 非空且距上次有效 sync <60s 的空场景 sync 返回 409（防新开空页清空画布；显式清空用 `DELETE /api/elements/clear`）；
   - **元素级 updated 合并**：旧场景不会覆盖更新过的元素（大者胜）；
   - **noop 快速路径**：内容等价的心跳静默返回（防双端互相覆盖/刷屏广播）；
   - **逐元素广播** element_created/updated/deleted → 各端实时收敛，Pi 批量回写逐步显示。
   - 多端协作前仍建议页面强刷一次（旧页面场景可能与 server 不一致）；已知限制：删除冲突（A 删 / B 旧场景仍含）未做墓碑合并（P4 增量协议根治）。
4. **回写任务集（画布 frame → 项目 `.pi/task_set.json`，Send to Task Set）只回写未完成项**：
   - 画布侧已完成标记（✓/已完成 开头）行不写入（已有）；
   - **合并写入时，若目标任务集中存在“已完成”状态的任务 → 自动剔除（删除该项）**，任务集只保留未完成项；
   - 新任务去重（标题）后追加，状态一律“待执行”。
5. 测试元素/旧用例（如 "D:\11111"）可忽略，不属于正式内容。
