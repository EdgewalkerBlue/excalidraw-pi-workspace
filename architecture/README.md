# 架构画布资产（Git 版本化）

本目录存放 Excalidraw 结构化画布文件，作为项目正式架构资产。

## 文件

| 文件 | 说明 |
|---|---|
| `main.excalidraw` | 主架构画布（标准 Excalidraw v2 格式，含 Arrow Binding） |

## 数据模型映射

画布元素与任务数据模型（task_set.json）的约定：

| 画布元素 | 映射 |
|---|---|
| rectangle / ellipse / diamond | 节点（node）：id 即元素 id，text 为节点文本 |
| arrow + startBinding/endBinding | 边（edge）：source/target 由 binding 表达 |
| bound text（containerId） | 节点/箭头标签 |
| 节点文本 `[TODO]` `[DONE]` 等 | 任务状态（status_values） |
| 节点文本 `task-XXX` | 任务 id（与 Git commit 关联） |

## 可追溯性约定

1. **每次人工 APPROVE 后**，画布变更由 Pi 提交入库，commit message 格式：
   ```
   review-gate: <task scope> - <变更摘要>
   ```
2. **任务关联**：commit message 中引用画布任务 id（如 `task-A`），画布节点文本保留 `task-XXX [状态]` 标记，形成 画布 ↔ commit 双向追溯。
3. **导出时机**：Pi 每次操作画布后执行
   ```
   npx mcp-excalidraw-server export --out architecture/main.excalidraw
   ```
4. **恢复**：canvas server 重启后内存画布丢失，用 `import` 恢复：
   ```
   npx mcp-excalidraw-server import architecture/main.excalidraw
   ```

## 追溯示例

```
7f83c52 review-gate: task-A 登录模块 - 新增 modules/auth(4/4测试通过)，MCP 回写画布(task-A→[DONE]...)
00e909a phase_4: Review Gate - 门禁协议
efab83f phase_3: MCP Integration - CLI 桥接
```

- 画布中 `task-A: 实现登录模块 [DONE]` ←→ commit `7f83c52`
