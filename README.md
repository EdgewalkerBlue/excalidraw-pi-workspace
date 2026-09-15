English | [简体中文](README_ZH.md)

# Excalidraw × Pi Agent Bidirectional Collaboration Workspace

> A browser-accessible Excalidraw infinite canvas, wired to the Pi Coding Agent into a bidirectional collaboration loop via MCP (CLI) + Review Gate.
> The canvas is structured requirements/architecture data; Arrow Binding is the core semantics.

## Project Overview

This project turns the Excalidraw infinite canvas into a **visual requirements & architecture workbench** for the Pi Coding Agent: express tasks and structures as nodes with Arrow Bindings on the canvas, send them to the AI agent in one click, and after Approve / Reject and a Review Gate check the agent executes automatically and writes results back to the canvas — a **bidirectional human-AI collaboration loop**.

- **Canvas as structured data**: the agent reads/writes elements over MCP (CLI) — describe/add/update/delete/export/import; the Pi extension receives live notifications and auto-triggers execution
- **Canvas persistence**: element changes are auto-persisted with rotating backups before overwrite (20 kept); `.excalidraw` archives per project (local assets, not committed to Git — `*.excalidraw` is ignored)
- **Multi-device browser access**: touch/stylus optimized, installable PWA; works in desktop, tablet and phone browsers; UI defaults to English with switchable Simplified Chinese (remembered across entries)
- **For whom**: solo developers and small teams who want to turn "sketching" into "executable requirements"

**Port layout**:

| Port | Service | Purpose |
|---|---|---|
| 5001 | Canvas Server | mcp-excalidraw-server canvas service (collaboration anchor, binds 0.0.0.0 by default) |
| 5002 | Workspace UI | Standalone Vite app (`npm run dev` / `npm start`, strictPort) |
| 5003 | Auth proxy (optional) | Basic Auth + WebSocket forwarding, entry for public/untrusted networks |
| 5010 | agent-notify | Notification service (Send / Approve / Reject mark files) |

## Table of Contents

- [Project Overview](#project-overview)
- [Architecture](#architecture)
- [Feature List](#feature-list)
- [Directory Layout](#directory-layout)
- [Upstream Dependencies](#upstream-dependencies)
- [Quick Start](#quick-start)
- [Collaboration Workflow](#collaboration-workflow)
  - [Send to Task Set](#send-to-task-setcanvas-tasks--project-task-set)
  - [Send to Agent](#send-to-agent)
  - [Approve / Reject](#approve--reject)
  - [Review Gate](#review-gate)
- [Pi Extension (Live Notifications)](#pi-extension-live-notifications)
- [Security Notes](#security-notes)
- [Services & Common Commands](#services--common-commands)

## Architecture

```
┌────────────────────────────┐        ┌───────────────────────────────┐
│  Web browser               │        │  Local host (Windows)         │
│  Excalidraw canvas         │        │                               │
│  [Send to Agent][Approve]  │        │  ┌─────────────────────────┐  │
│  [Reject] ●Connected       │        │  │ Canvas Server :5001     │  │
└──────────┬─────────────────┘        │  │ (mcp-excalidraw-server) │  │
           │ WebSocket live sync      │  └───────────┬─────────────┘  │
           │ (LAN, no auth)           │              │ REST /api      │
           ▼                          │  ┌───────────▼─────────────┐  │
    http://<LAN-IP>:5001              │  │ agent-notify :5010      │  │
                                      │  │ (mark files .agent/*.json)│ │
                                      │  └───────────┬─────────────┘  │
                                      │              │ file watcher   │
                                      │  ┌───────────▼─────────────┐  │
                                      │  │ Pi Agent (0.84.4)       │  │
                                      │  │  ├ ext: notify + auto   │  │
                                      │  │  └ CLI bridge (mcp-cli) │  │
                                      │  └───────────┬─────────────┘  │
                                      │              │                │
                                      │  ┌───────────▼─────────────┐  │
                                      │  │ Git repository          │  │
                                      │  │  modules/ (Pi code)     │  │
                                      │  │  tools/ webui/ docs     │  │
                                      │  └─────────────────────────┘  │
                                      └───────────────────────────────┘
```

**Data flow (one full collaboration round)**:

```
Browser canvas (nodes + arrow bindings)
  → [Send to Agent]   → save canvas snapshot + notify Pi (.agent/pending.json)
  → [Approve]         → write approval mark (.agent/approved.json)
  → Pi auto-executes  → read canvas → Review Gate → run tasks
  → MCP write-back    → add/update nodes, arrows, task status (live sync to browser)
  → export archive    → architecture/*.excalidraw local snapshot (not in Git)
  → clear marks       → Web UI buttons reset, loop closed
```

## Feature List

| Capability | Description |
|---|---|
| Infinite canvas | Full Excalidraw feature set: infinite canvas, zoom/pan, touch, stylus, shapes/text/images, arrows |
| Arrow Binding | Arrow source/target/binding/label fully preserved (structured semantics) |
| Browser access | `http://<LAN-IP>:5001`, touch/stylus optimized, installable PWA |
| UI language | Defaults to English; switchable to Simplified Chinese (official translations, same as excalidraw.com) with persistent memory — localStorage + cookie dual storage, effective across :5001/:5003 entries; header text follows the language |
| Canvas persistence | Element changes auto-persisted (`canvas-store.json`) with rotating backups before overwrite (20 kept); `.excalidraw` archive per project; canvas files not committed to Git (`*.excalidraw` ignored) |
| Send to Agent | Web UI button: send canvas notification to Pi (1s green "sent" feedback) |
| Send to Task Set | Web UI button (left of Send to Agent): write unfinished tasks from canvas frames into each project's `.pi/task_set.json` (idempotent dedup, priority-sorted) |
| Frame border color | Web UI palette (6 colors): update all frame border colors at once; new frames default to blue (visible on dark theme) |
| Approve | Web UI approve button: yellow (pending) → green (approved); hidden until sent; hover warns to review seriously |
| Reject | Web UI red reject button: roll back sent content + restore canvas snapshot + notify Pi to revert executed tasks |
| Pi live notifications | Pi extension listens in real time, TUI popup + inbox widget, auto-triggers agent execution |
| Review Gate | Gate protocol: change detection (node/arrow/binding diffs), task metadata, double confirmation for destructive ops |
| MCP(CLI) bridge | Pi drives the canvas via CLI: describe/add/update/delete/export/import |
| Auth (optional) | Basic Auth reverse proxy + WebSocket forwarding for public-network scenarios |

## Directory Layout

```
excalidraw-workspace/
├── architecture/
│   ├── main.excalidraw        # main architecture canvas (local snapshot, *.excalidraw not in Git)
│   └── README.md              # data-model mapping & traceability conventions
├── modules/auth/              # sample code produced by Pi (login module)
├── tools/
│   ├── review-gate.mjs        # Review Gate snapshot/change detection
│   ├── agent-notify.mjs       # notification service (:5010, mark files)
│   ├── exec-log.mjs           # task execution log & rollback
│   ├── patch-pwa.mjs          # Web UI PWA + button injection patch
│   ├── patch-i18n.mjs         # Web UI language patch (default EN + zh-CN switch persistence / translations)
│   ├── patch-server.mjs       # canvas server persist/backup patch (anti-overwrite)
│   ├── fix-canvas-indices.mjs # canvas element index normalization (invalid index blocks new elements)
│   ├── auth-proxy.mjs         # optional Basic Auth proxy
│   └── pi-extensions/
│       └── agent-notify-watch.ts  # Pi extension (live notify + auto trigger + Reject rollback)
├── webui/
│   └── send-to-agent.js       # Web UI button injection script (Send/Approve/Reject)
├── start-canvas.bat           # one-click start (canvas server + agent-notify)
├── start-auth.bat             # auth-mode one-click start (localhost-only 5001 + auth proxy :5003)
├── mcp-cli.bat                # MCP CLI bridge wrapper
├── GATE.md                    # Review Gate protocol
├── SECURITY.md                # security notes
├── README_ZH.md               # Chinese documentation (中文文档)
└── FINAL-ACCEPTANCE.md        # final acceptance checklist
```

## Upstream Dependencies

Following the "reuse mature components first, don't build a canvas engine" principle, the core components come from upstream open-source projects:

| Component | Upstream project | Version | Purpose |
|---|---|---|---|
| Excalidraw canvas engine | [excalidraw/excalidraw](https://github.com/excalidraw/excalidraw) (`@excalidraw/excalidraw`) | 0.18.0-afa3a65¹ | React component, infinite canvas, touch/stylus, Arrow Binding |
| Canvas Server + MCP + CLI | [yctimlin/mcp_excalidraw](https://github.com/yctimlin/mcp_excalidraw) (`mcp-excalidraw-server`) | 2.0.0 | Self-hosted Excalidraw Web UI + REST + WebSocket live sync; element-level CRUD; `.excalidraw` export/import; Arrow Binding preserved; structured describe |
| Pi Coding Agent | [mariozechner/pi-coding-agent](https://github.com/mariozechner/pi-coding-agent) (`@earendil-works/pi-coding-agent`) | 0.84.4 | Agent host; extension mechanism (events/UI/custom tools) for live notifications and auto-triggering |

> ¹ Since 2026-09-14 the root dependency is pinned to the upstream master snapshot build `0.18.0-afa3a65` (includes the mermaid-to-excalidraw ^2.2.2 security-line adaptation); the Canvas Server frontend bundle embeds 0.18.1.

> **Design note**: Pi 0.84.4 has no built-in MCP, so this project uses a **CLI bridge** (`mcp-excalidraw-server` CLI + REST); the in-repo extension layer adds "live notifications / auto-trigger / approve-reject / rollback" collaboration capabilities.
>
> Original parts of this project: `webui/` (button injection), `tools/` (notification service / gate / rollback / PWA patches), the Pi extension `agent-notify-watch.ts`, and the collaboration protocols (GATE.md / SECURITY.md).

## Quick Start

### Requirements

- Windows 10/11 (verified on Windows 11), Node.js ≥ 20 (22 in use), Git
- Optional: browsers on other LAN devices (tablet/phone touch or stylus input)

### Install & Run

```bash
# 1. Install dependencies
npm install

# 2. Start services (canvas server :5001 + agent-notify :5010)
#    The start script auto-applies i18n / server patches (idempotent)
start-canvas.bat
# Or start separately:
#   PORT=5001 HOST=0.0.0.0 node node_modules/mcp-excalidraw-server/dist/server.js
#   node tools/agent-notify.mjs

# 2a. Public/untrusted network: auth mode (canvas binds 127.0.0.1, Basic Auth proxy on :5003)
start-auth.bat          # first run auto-generates a random strong password in .auth.env (gitignored)

# 2b. Workspace UI (optional, standalone Vite app, port :5002, does not occupy 5001)
npm run dev        # http://localhost:5002 (hot reload while editing src/)
npm run build && npm start   # production preview, also on :5002 (npm start = npm run preview)

# 3. Install the Pi extension (live notifications + auto execution)
copy tools\pi-extensions\agent-notify-watch.ts %USERPROFILE%\.pi\agent\extensions\
# Run /reload inside Pi

# 4. Patch the Web UI (PWA + Send/Approve/Reject buttons)
node tools/patch-pwa.mjs

# 5. Open in a browser (desktop / tablet / phone all work)
#    http://<LAN-IP>:5001   (replace with your LAN IP)
```

### Firewall (LAN access)

Admin CMD:

```bat
rem Replace <LAN-CIDR> with your LAN segment (CIDR notation)
netsh advfirewall firewall add rule name="Excalidraw Workspace 5001" dir=in action=allow protocol=TCP localport=5001 remoteip=<LAN-CIDR>
```

## Collaboration Workflow

### Send to Task Set (canvas tasks → project task set)

1. On the canvas, use the **frame tool** to box each project area; **frame name = project name** (e.g. `excalidraw-workspace`, mapped to `<project-root>/.pi/task_set.json`; absolute paths also supported)
2. Add text tasks inside the frame: a leading `P0`–`P3` sets priority (default P2); a leading `✓`/`已完成` (done) marks completion (skipped automatically)
3. Click **Send to Task Set**:
   - Write rule: **keep unfinished items only** — tasks already marked "done" in the target task set are removed;
   - Unfinished canvas tasks are deduplicated by title and appended with `T-date-seq` ids, status "pending", stable priority ordering

### Send to Agent

1. Sketch the task on the canvas (nodes + arrow bindings)
2. Click **Send to Agent** (blue): notifies Pi and saves a canvas snapshot; the button briefly shows a green "sent" state
3. Pi receives the notification live (extension popup 📮 + inbox widget)

### Approve / Reject

- **Approve** (shown after Send, yellow): approves the canvas tasks; hover warns "please review the canvas content seriously before executing"; turns green on click and Pi starts automatically
- **Reject** (shown after Send, red): rolls back the sent content, restores the canvas snapshot, and notifies Pi to stop and revert executed file changes (`exec-log.mjs rollback`)
- Both buttons are hidden until something is sent

### Review Gate

Before execution, Pi generates a gate report: canvas statistics (nodes/arrows/bindings), node diffs, task scope, target repo/branch, planned actions. Destructive operations (bulk delete / force push / production changes, etc.) require extra human confirmation. See [GATE.md](GATE.md).

## Pi Extension (Live Notifications)

`agent-notify-watch.ts` is a Pi global extension (`~/.pi/agent/extensions/automation/`, organized into category suites since 2026-09-12) providing:

- **Live notifications**: watches `.agent/*.json` marks, Pi TUI popup + top inbox widget
- **Auto-trigger**: on an approval mark, drives the agent via `pi.sendUserMessage()` to execute canvas tasks (no manual prompt needed)
- **Reject handling**: on a reject mark, notifies the agent to stop the task and roll back

```
Install:  copy tools\pi-extensions\agent-notify-watch.ts %USERPROFILE%\.pi\agent\extensions\
Activate: /reload inside Pi
Command:  /agent-inbox (manually refresh the inbox)
```

## Security Notes

- The canvas server API has no built-in auth; it binds to the LAN by default (firewall allows only the <LAN segment>)
- Public exposure must enable the auth proxy (`tools/auth-proxy.mjs`, Basic Auth + WebSocket forwarding) plus HTTPS
- Destructive operations (bulk delete, force push, production changes, system-level config, project/canvas deletion) require Review Gate double confirmation
- See [SECURITY.md](SECURITY.md)

## Services & Common Commands

```bash
# Start
start-canvas.bat                          # canvas server(:5001) + agent-notify(:5010)
npm run dev                               # workspace UI (:5002, separate from Canvas Server, can run simultaneously)

# Pi canvas operations (CLI bridge)
mcp-cli.bat describe                      # structured canvas read (incl. Connections/Binding)
mcp-cli.bat add                           # create elements (stdin JSON)
mcp-cli.bat update <id> --set '{...}'     # update an element
mcp-cli.bat delete <id...>                # delete elements
mcp-cli.bat export --out architecture/main.excalidraw   # export archive (local snapshot)
mcp-cli.bat import architecture/main.excalidraw         # import / restore

# Review Gate
node tools/review-gate.mjs --task "..." --planned "..." [--destructive]

# Task rollback (on Reject)
node tools/exec-log.mjs list              # view execution log
node tools/exec-log.mjs rollback          # roll back all records

# Web UI patch (PWA + buttons)
node tools/patch-pwa.mjs

# Web UI patch (language-switch persistence + floating language switcher; auto-run by start-canvas.bat / start-auth.bat;
# re-run after upgrading mcp-excalidraw-server)
node tools/patch-i18n.mjs

# Canvas server persist/backup patch (anti-overwrite; auto-run by start-canvas.bat)
node tools/patch-server.mjs

# Canvas index normalization (invalid/uppercase indices block new elements in Excalidraw)
node tools/fix-canvas-indices.mjs --server http://127.0.0.1:5001   # one-click fix of the live canvas
node tools/fix-canvas-indices.mjs <input.json> <output.json>       # fix local .excalidraw/backup files
```

## License

Released under the [MIT](LICENSE) license. 本项目基于 [MIT](LICENSE) 协议开源。

Upstream components (all MIT):

- [Excalidraw](https://github.com/excalidraw/excalidraw) (`@excalidraw/excalidraw`)
- [mcp_excalidraw](https://github.com/yctimlin/mcp_excalidraw) (`mcp-excalidraw-server`)
- [pi-coding-agent](https://github.com/mariozechner/pi-coding-agent) (`@earendil-works/pi-coding-agent`)
- React / Vite

> Note: Excalidraw's MIT license carries a trademark clause — the "Excalidraw" name and logo may not be used for promotion/marketing without permission.
