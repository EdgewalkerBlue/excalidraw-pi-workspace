# Review Gate 协议（phase_4）

> 门禁原则（来自 task_set.json）：
> **未经人工 Approve 的 Canvas 修改不得触发 Pi 执行代码修改。**
> **破坏性操作必须有额外人工确认。**

## 1. 何时必须走门禁

Pi（或任何 AI agent）在满足以下**任一**条件时，必须先输出 Review Gate 报告并等待人工 APPROVE：

- 将要对项目代码执行修改（新增/编辑/删除文件）
- 将运行可能产生副作用的长任务（test / lint / build / deploy）
- 将执行任何破坏性操作（见 §5）

纯读取类操作（describe / query / get / 阅读 Git）**不需要**门禁。

## 2. 门禁流程

```
Canvas 变更（Android 或 CLI）
        │
        ▼
node tools/review-gate.mjs --task "<任务范围>" --planned "<计划动作>" [--destructive]
        │
        ▼
生成 review-gate-report.json + 人类可读摘要
        │
        ▼
呈现给人工 → 人工回复 APPROVE / REJECT
        │
    APPROVE ──► Pi 继续执行（代码修改 / MCP 写回）
    REJECT  ──► 停止，等待人工调整画布或指示
```

## 3. 审查报告内容（对应 task_set.json minimum_review_items）

| 审查项 | 来源 |
|---|---|
| canvas file | `architecture/main.excalidraw`（导出） |
| node count / arrow count / binding count | describe 分析 |
| added / deleted / modified nodes | 与 `git show HEAD:architecture/main.excalidraw` 对比 |
| task scope | `--task` 参数 |
| target Git project | `git config remote.origin.url` |
| target branch | `git rev-parse --abbrev-ref HEAD` |
| planned actions | `--planned` 参数 |

## 4. Approve 约定

- 人工回复关键词：`approve` / `批准` / `同意`（大小写不敏感）
- APPROVE 仅授权**本次报告中的 planned_actions**，不构成对后续变更的持续授权
- Pi 每次新的代码修改前都需重新走门禁

## 5. 破坏性操作（需额外人工确认）

以下操作在 APPROVE 之外还需**额外二次确认**（`--destructive` 标记，报告会显示 ⛔）：

- 批量删除画布元素（mass deletion）
- `git push --force`
- 生产环境变更
- 系统级配置修改（防火墙、服务、注册表等）
- 删除项目文件 / 删除画布
- 其他不可逆操作

额外确认格式：人工回复 `confirm destructive` 或 `确认执行破坏性操作`。

## 6. 快照与追溯

- 每次门禁生成的报告存档于 `tools/review-gate-report.json`（被后续覆盖）
- 画布文件 `architecture/main.excalidraw` 每次 APPROVE 后由 Pi 提交入库（Git 版本化）
- 提交信息格式：`review-gate: <task scope> - <approve 摘要>`

## 7. 工具

```bash
# 常规门禁
node tools/review-gate.mjs --task "任务X" --planned "计划动作Y"

# 破坏性操作门禁
node tools/review-gate.mjs --task "任务X" --planned "计划动作Y" --destructive

# 指定 canvas 地址（默认 http://127.0.0.1:5001）
EXCALIDRAW_CANVAS_URL=http://127.0.0.1:5001 node tools/review-gate.mjs ...
```
