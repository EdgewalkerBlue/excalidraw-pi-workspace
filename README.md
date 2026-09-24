**[English](README.md)** · [简体中文](README_ZH.md) — this README is the primary English version; `README_ZH.md` is its Chinese mirror.

> ### 一键部署 / One-click deploy
>
> Windows: run **`deploy.bat`** (install deps → build canvas → start services → opens `http://localhost:5001`).
> Equivalent commands:
>
> ```bash
> git clone https://github.com/EdgewalkerBlue/excalidraw-pi-workspace.git
> cd excalidraw-pi-workspace
> npm install && npm run build:canvas && start-canvas.bat
> ```
>
> Only the :5001 canvas is required. See [Quick Start](#quick-start) for auth mode and the Pi extension.

# Excalidraw × Pi Agent Bidirectional Collaboration Workspace

> **GitHub About** — *Bidirectional Excalidraw ⇄ AI workspace: draw structured requirements on an official-master Excalidraw infinite canvas, send them to the Pi Coding Agent via MCP CLI + Review Gate, and write the results back onto the canvas.*
>
> Topics (as set on the repo): `excalidraw` · `mcp` · `model-context-protocol` · `ai-agent` · `ai-coding-agent` · `infinite-canvas` · `react` · `typescript` · `pwa` · `human-in-the-loop` · `self-hosted` · `webdav`

A self-hosted Excalidraw infinite canvas that turns drawings into **executable requirements**: node + Arrow Binding structures on the canvas are sent to the Pi Coding Agent in one click, gated by Approve / Reject + Review Gate, executed, and written back onto the canvas.

- **Canvas as structured data** — the agent reads/writes elements over MCP CLI (describe/add/update/delete/export/import); Arrow Bindings carry the semantics
- **Persisted and collaborative** — server-side persistence with rotating backups, WebSocket live sync across devices
- **Browser-first** — touch/stylus friendly, installable PWA, works from desktop / tablet / phone browsers
- **For whom** — solo developers and small teams who want "sketching" to become "executable requirements"

| Port | Service | Notes |
|---|---|---|
| 5001 | Canvas Server | `mcp-excalidraw-server`, collaboration anchor (binds `0.0.0.0`) |
| 5002 | Workspace UI | Standalone Vite app, thin official shell (no autosave) |
| 5003 | Auth proxy (optional) | Basic Auth + WebSocket forwarding for untrusted networks |
| 5004 | canvas-web dev server | `npm run dev:canvas`, proxies `/api` + WS to :5001 |
| 5010 | agent-notify | Send / Approve / Reject mark files |

## Architecture

```
┌────────────────────────────┐        ┌───────────────────────────────┐
│  Browser                   │        │  Host (Windows)               │
│  Excalidraw canvas         │        │  ┌─────────────────────────┐  │
│  [Send to Agent][Approve]  │        │  │ Canvas Server :5001     │  │
│  [Reject] ●Connected       │        │  └───────────┬─────────────┘  │
└──────────┬─────────────────┘        │              │ REST /api      │
           │ WebSocket live sync      │  ┌───────────▼─────────────┐  │
           │ (LAN, no auth)           │  │ agent-notify :5010      │  │
           ▼                          │  │ (.agent/*.json marks)   │  │
    http://<LAN-IP>:5001              │  └───────────┬─────────────┘  │
                                      │              │ file watcher   │
                                      │  ┌───────────▼─────────────┐  │
                                      │  │ Pi Agent + extension    │  │
                                      │  │  ├ notify + auto-trigger│  │
                                      │  │  └ CLI bridge (mcp-cli) │  │
                                      │  └───────────┬─────────────┘  │
                                      │              │                │
                                      │  ┌───────────▼─────────────┐  │
                                      │  │ Git repository          │  │
                                      │  │  modules/ (agent code)  │  │
                                      │  └─────────────────────────┘  │
                                      └───────────────────────────────┘
```

## Features

| Capability | Notes |
|---|---|
| Infinite canvas | Full official Excalidraw feature set: zoom/pan, touch, stylus, shapes/text/images, arrows |
| Arrow Binding | Source/target/binding/label preserved — the structured semantics the agent reads |
| UI language | Follows the browser language (`zh*` → Simplified Chinese, otherwise English) through the official `langCode` prop; the toolbar button switches it and remembers the choice in `localStorage` (per origin) |
| Theme | Toolbar button cycles light → dark → system (persisted). Uses the official `theme` prop, so the whole UI follows the official dark theme (235 CSS custom properties, 84 of them redefined under `.theme--dark`) while canvas content is recoloured by the official `applyDarkModeFilter` |
| Canvas background | Toolbar picker: **7 light swatches plus pure black** and a custom `#rrggbb` field, written through the official `appState.viewBackgroundColor` (the official background picker stays available in the File menu). Exports use this colour instead of a forced white background |
| Persistence | Server-side save with rotating backups before overwrite (20 kept); `.excalidraw` archives stay local (`*.excalidraw` is gitignored) |
| Send to Agent | Toolbar button → notifies Pi, green "sent" feedback |
| Send to Task Set | Writes unfinished tasks from canvas frames into each project's `.pi/task_set.json` (dedup by title, priority-sorted) |
| Approve / Reject | Approve (yellow → green) starts execution; Reject rolls back the sent content and restores the snapshot |
| Pi live notifications | Extension watches marks: TUI popup + inbox widget + auto-trigger |
| Review Gate | Pre-execution report (node/arrow diffs, scope, planned actions); destructive ops need extra confirmation — see [GATE.md](GATE.md) |
| MCP CLI bridge | `mcp-cli.bat describe/add/update/delete/export/import` |
| Save targets | Toolbar **“Save to…”** dialog: local `.excalidraw` file (via the official `serializeAsJSON`), **WebDAV** (Jianguoyun / Nextcloud / Synology …), and direct upload to **Dropbox / Google Drive / OneDrive** over OAuth 2.0 + PKCE; plus “export + open upload page” shortcuts for Baidu / Aliyun / Quark / Weiyun. See [Saving to cloud drives](#saving-to-cloud-drives) |
| Auth (optional) | Basic Auth proxy + WebSocket forwarding |
| Upstream self-check | Top-right badge in the canvas flags newer official builds |
| Fork repo link | The hamburger menu’s *Excalidraw links* section gains a **fork GitHub** entry right below the official one (the official menu has no extension point, so this is a scoped DOM injection — see `canvas-web/src/extra-menu-links.mjs`) |

> **Retired 2026-09-23** when the frontend moved to `canvas-web/` (see [legacy/README.md](legacy/README.md)): the **frame border-color palette** (lived in `webui/send-to-agent.js`) and **cross-entry language memory via cookie** (lived in `tools/patch-i18n.mjs`). Language preference is now per-origin `localStorage` only.

## Directory Layout

```
excalidraw-workspace/
├── canvas-web/                 # :5001 frontend — official Excalidraw base + secondary dev
│   ├── public/                 # PWA assets (manifest / sw / icons)
│   └── src/
│       ├── CanvasApp.tsx       # official shell (onExcalidrawAPI / langCode / theme) + sync wiring
│       ├── sync.ts             # multi-client live sync client
│       ├── agent-tools.tsx     # Send to Agent / Approve / Reject / Send to Task Set
│       ├── upstream-badge.tsx  # upstream update reminder
│       └── upstream-core.mjs   # SSOT of update-check rules (shared with tools/check-upstream.mjs)
├── src/                        # :5002 workspace UI — thin official shell
├── tools/
│   ├── agent-notify.mjs        # notification service (:5010)
│   ├── patch-server.mjs        # canvas server persistence / backup / sync-guard patch
│   ├── check-upstream.mjs      # base-layer self-check CLI
│   ├── review-gate.mjs         # Review Gate change detection
│   ├── exec-log.mjs            # execution log & rollback
│   ├── fix-canvas-indices.mjs  # element index normalization
│   ├── auth-proxy.mjs          # optional Basic Auth proxy
│   └── pi-extensions/agent-notify-watch.ts
├── modules/                    # agent-produced sample code
├── architecture/               # .excalidraw archives (local, not in Git)
├── legacy/                     # retired implementations, see legacy/README.md
├── UPSTREAM-DIFF.md            # diff vs excalidraw/excalidraw official master
├── GATE.md · SECURITY.md · FINAL-ACCEPTANCE.md
├── deploy.bat                 # one-click deploy (install -> build -> start)
├── start-canvas.bat · start-auth.bat · mcp-cli.bat
└── README.md · README_ZH.md
```

## Upstream Base Layer

The canvas does **not** fork Excalidraw — it consumes the official npm build and pins the `master` snapshot it was built from. Everything outside the secondary-development surface reuses the official implementation (engine, rendering, `langCode` switching, official `index.css`).

| Component | Upstream | Version | Role |
|---|---|---|---|
| Canvas engine | [excalidraw/excalidraw](https://github.com/excalidraw/excalidraw) | `0.18.0-c0ad61c` | React component, infinite canvas, Arrow Binding |
| Canvas Server + MCP + CLI | [mcp_excalidraw](https://github.com/yctimlin/mcp_excalidraw) | 2.0.0 | REST + WebSocket sync, element CRUD, `.excalidraw` I/O |
| Agent host | [pi-coding-agent](https://github.com/mariozechner/pi-coding-agent) | 0.84.4 | Extension mechanism for live notify / auto-trigger |

**Baseline** (compiled into the bundle from `canvas-web/vite.config.ts`):

| Item | Value |
|---|---|
| Baseline commit | `c0ad61c` (2026-09-16) |
| Upstream `master` HEAD at upgrade | `2b9da96` (2026-09-22) |
| Master commits without a published build | 4 (`14e1c61`, `97c68dd`, `31df3e6`, `2b9da96`) |

> **Never align to npm `latest`.** `latest` is `0.18.1`, published 2026-04-20 — its code is ~5 months *older* than the pinned canary. The tag that tracks master is **`next`** (`0.18.0-<sha7>`). Full comparison: [UPSTREAM-DIFF.md](UPSTREAM-DIFF.md).

**Self-check** — the canvas badge queries upstream `master` + npm dist-tags once per 24h and shows four states: `✓ up to date` (grey), `source ahead N` (yellow, no build published yet), `new build <version>` (yellow; click to copy the upgrade command), and `⏳ self-check rate-limited, retry after HH:MM` (grey). Genuine network failures stay silent, but GitHub's unauthenticated API limit (60 requests/hour per IP; one check costs 2) is surfaced explicitly instead of making the badge disappear. While the quota is exhausted no further requests are made. The CLI adds *baseline drift* detection (declared `__CANVAS_BASELINE__` ≠ installed version):

```bash
npm run check:upstream          # exit 1 = upgrade available or baseline drifted
```

The decision rules are covered by unit tests that use synthetic API payloads — including the rate-limit branch and the "local pin is newer than the published build" false-positive guard: `npm test` (see `canvas-web/src/upstream-core.test.mjs`).

To upgrade: `npm install @excalidraw/excalidraw@<version>` → sync `__CANVAS_BASELINE__` in `canvas-web/vite.config.ts` → `npm run build:canvas` → restart the canvas.

## Quick Start

**Requirements**: Windows 10/11, Node.js ≥ 20 (22 in use), Git. Optional: browsers on LAN devices.

```bash
# 1. Install
npm install

# 2. Start canvas server (:5001) + agent-notify (:5010); applies the persistence patch
#    (deploy.bat does steps 1-2 in one shot)
start-canvas.bat
#   manually: PORT=5001 HOST=0.0.0.0 node node_modules/mcp-excalidraw-server/dist/server.js
#             node tools/agent-notify.mjs

# 2a. Untrusted network: auth mode (canvas binds 127.0.0.1, proxy on :5003)
start-auth.bat          # first run generates a random password in .auth.env (gitignored)

# 2b. Optional standalone shell (:5002) — no autosave, use File → Save as
npm run dev

# 3. Install the Pi extension, then /reload inside Pi
copy tools\pi-extensions\agent-notify-watch.ts %USERPROFILE%\.pi\agent\extensions\automation\

# 4. Open http://<LAN-IP>:5001 (desktop / tablet / phone)
```

Firewall (admin CMD) — allow only your LAN segment:

```bat
netsh advfirewall firewall add rule name="Excalidraw Workspace 5001" dir=in action=allow protocol=TCP localport=5001 remoteip=<LAN-CIDR>
```

## Collaboration Workflow

- **Send to Task Set** — box each project with the frame tool (frame name = project name), add tasks inside; a leading `P0`–`P3` sets priority, `✓`/`已完成` marks done (skipped). The button keeps unfinished items only, dedups by title, appends `T-date-seq` ids.
- **Send to Agent** — sketch, then click the blue button: notifies Pi and saves a snapshot.
- **Approve / Reject** — both appear after Send. Approve starts execution (hover warns to review first); Reject rolls back the sent content, restores the snapshot, and tells Pi to revert.
- **Review Gate** — before execution Pi produces a gate report; destructive operations need extra confirmation. See [GATE.md](GATE.md).

## Commands

```bash
npm run typecheck      # tsc over src/ and canvas-web/src
npm run build:canvas   # rebuild canvas-web into the Canvas Server static dir
npm run build:canvas:safe   # same, but build to a temp dir then swap (safe when the target is locked/partial)
npm run dev:canvas     # canvas-web dev server on :5004
npm run ship -- -m "feat: xxx"   # commit -> push DEV -> merge master -> auto-return to DEV
mcp-cli.bat describe | add | update <id> --set '{...}' | delete <id...>
mcp-cli.bat export --out architecture/main.excalidraw   # local snapshot
node tools/review-gate.mjs --task "..." --planned "..." [--destructive]
node tools/exec-log.mjs list | rollback                 # execution log / rollback
node tools/patch-server.mjs                             # persistence patch (auto-run on start)
node tools/fix-canvas-indices.mjs --server http://127.0.0.1:5001
```

## Saving to cloud drives

The official “Save to…” dialog ships **hardcoded cards** (`saveToActiveFile` and an optional `onExportToBackend` share-link card) with no extension point, so this project adds its own **Save to…** entry in the toolbar. Everything network-related goes through a small local bridge service, because browsers cannot call WebDAV/cloud APIs directly (CORS) and OAuth code exchange should not live in the page.

```
Browser (canvas)  --HTTP-->  save-bridge  :5011  --HTTPS-->  WebDAV / Dropbox / Google Drive / OneDrive
```

| Piece | Where | Notes |
|---|---|---|
| Bridge service | `tools/save-bridge.mjs` (`:5011`) | Started by `start-canvas.bat`; binds `127.0.0.1` only by default |
| Pure logic (specs, PKCE, URL builders) | `tools/save-targets.mjs` | Unit-tested offline, incl. the RFC 7636 test vector |
| Credentials & tokens | `.save-targets.json` | **gitignored**; the API never returns the WebDAV password |
| Regression check | `node tools/save-bridge.integration.mjs` | Runs against `tools/dev-stub-webdav.mjs` — no real cloud needed |

**WebDAV** — no app registration required. Open *Save to…*, fill in URL / username / app password, press **Test**, then **Save to WebDAV**. Works with Jianguoyun (`https://dav.jianguoyun.com/dav/`), Nextcloud, Synology, TeraCLOUD, and anything else speaking WebDAV.

**Dropbox / Google Drive / OneDrive** — each needs a one-time app registration; the redirect URI must be the bridge callback:

```
http://127.0.0.1:5011/oauth/callback        # or http://<host-LAN-IP>:5011/oauth/callback for other devices
```

Paste the resulting `client_id` in the dialog, press **Authorise**, then **Save here**. PKCE public-client flow — no `client_secret` is used or stored. Tokens refresh automatically.

> **Security default**: the bridge listens on `127.0.0.1` only. Set `SAVE_BRIDGE_HOST=0.0.0.0` if you want to save from a phone, and be aware that anyone on your LAN can then reach the upload endpoints.

## Branching & Release Flow

Development happens on **`DEV`**; `master` is the release branch (the repo's default branch). One command runs the whole cycle — commit, push `DEV`, merge into `master`, and **always switch back to `DEV`** (guaranteed even if a step fails):

```bash
npm run ship -- -m "feat: xxx"      # or: ship.bat -m "feat: xxx"  /  bash tools/ship.sh -m "feat: xxx"
npm run ship -- -m "xxx" --dry-run  # print the git commands without running them
```

`tools/ship.sh` is the single source of truth (POSIX sh; `ship.bat` is only a launcher that locates Git Bash). It refuses to run outside `DEV`, excludes local-only paths (`.pi/`, `exp-*.json`) from the commit, and retries a failed push over a direct connection when a stale proxy is configured.

## Security

- The canvas API has **no built-in auth** and binds to the LAN — restrict with a firewall rule, or put it behind the auth proxy (+ HTTPS) when exposed
- Destructive operations require Review Gate double confirmation
- See [SECURITY.md](SECURITY.md)

## License

[MIT](LICENSE). Upstream components are all MIT: Excalidraw, mcp_excalidraw, pi-coding-agent, React, Vite.

> Excalidraw's MIT license carries a trademark clause — the "Excalidraw" name and logo may not be used for promotion/marketing without permission.
