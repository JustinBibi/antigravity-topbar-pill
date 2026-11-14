# Antigravity Topbar Token Pill (`antigravity-topbar-pill`)

<p align="center">
  <b>English</b> · <a href="README_zh.md">简体中文</a>
</p>

<p align="center">
  <b>A minimalist, 100% non-intrusive real-time context token usage pill for Google Antigravity desktop top bar via CDP.</b>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-%3E%3D18.0.0-green.svg" alt="Node version" />
  <img src="https://img.shields.io/badge/Dependencies-0-brightgreen.svg" alt="Zero dependencies" />
  <img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License" />
  <img src="https://img.shields.io/badge/Platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey.svg" alt="Platform" />
</p>

---

## 🌟 Why CDP Runtime Injection over ASAR Patching?

Traditional Electron modifications or plugins unpack `app.asar`, inject code, and repack the archive. This approach has critical drawbacks:

| Dimension | ASAR Patching Approach | `antigravity-topbar-pill` (CDP Injection) |
| :--- | :--- | :--- |
| **App Integrity** | ❌ Breaks code signatures, alters binary checksums, and can trigger security warnings | ✅ **100% Zero-Modification**. Leaves `app.asar` completely untouched |
| **Auto-Updates** | ❌ Overwritten on every Antigravity client update, requiring repeated patching | ✅ **Update-Proof**. Daemon automatically discovers ports; updates never break it |
| **Memory & Performance** | ❌ Bloated Webpack/Vite bundles, heavy tokenizers, extra runtimes | ✅ **Ultra-Lightweight**. Uses `< 15MB` RAM, 0% CPU when idle |
| **Dependencies** | ❌ Pulls dozens to hundreds of MBs in npm packages | ✅ **Zero Dependencies (0 npm packages)**. Pure built-in Node.js APIs |
| **Installation & Teardown** | ❌ Requires killing the app, swapping files, and risky rollbacks | ✅ **Instant & Clean**. 1-click start; stopping cleans all injected DOM nodes immediately |

---

## ✨ Features

1. **Native Borderless Minimalist Pill**
   - Seamlessly blends into the Antigravity top titlebar without jarring borders or backgrounds.
   - Dynamic health indicator dot reflecting context consumption:
     - 🟢 `< 60%`: Safe (Emerald `#10b981`)
     - 🟡 `60% ~ 85%`: Warning (Amber `#f59e0b`)
     - 🔴 `>= 85%`: Critical (Red `#ef4444`)

2. **Hover Tooltip Breakdown**
   - Hovering over the pill instantly opens a frosted-glass card with clean metrics:
     - **Active Model** (e.g. `Gemini 3.8 Flash High`, `Claude 3.7 Sonnet`, etc.)
     - **Input Tokens**
     - **Cached Tokens** (`cache_read_tokens`)
     - **Output Tokens**
     - **Context Used & Budget** (e.g. `180K / 1M (18%)`)

3. **Multi-Model Context Limit Awareness**
   - Automatically detects the conversation model and matches its official context window:
     - Gemini 1.5 / 2.0 / 2.5 / 3.0 Pro: **2,000,000 Tokens (2M)**
     - Gemini Flash Series: **1,000,000 Tokens (1M)**
     - Claude 3.5 / 3.7 Sonnet / Thinking / Opus: **200,000 Tokens (200K)**
     - OpenAI o1 / o3 / o3-mini: **200,000 Tokens (200K)**
     - DeepSeek V3 / R1: **128,000 Tokens (128K)**
     - GPT-4o / GPT-4: **128,000 Tokens (128K)**
     - Qwen / Llama: **128,000 Tokens (128K)**

4. **Resilience & Full Lifecycle Self-Healing**
   - **Client Restart**: Automatically re-detects the new port and reconnects when Antigravity restarts.
   - **Page Reload**: Re-mounts the pill within milliseconds when the user presses `Cmd+R`.
   - **Route Awareness**: Detects SPA client-side route changes instantly without polling.
   - **Large Log Resilience**: Efficient backward chunk scanning skips massive tool output (>150KB) to find model metrics without CPU spikes.

5. **macOS Zero-Footprint On-Demand Lifecycle (Hybrid Architecture)**
   - **macOS (On-Demand via `WatchPaths` - Option 2)**:
     - Uses `launchd` `WatchPaths` to monitor `DevToolsActivePort`.
     - **True 0 Footprint**: When Antigravity is closed, the Node process automatically exits (`KeepAlive: false`), leaving **0 processes and 0 MB RAM**.
     - **Auto-starts with Antigravity**: Opening Antigravity triggers `launchd` to launch the daemon and mount the pill in milliseconds.
     - **Reload Guard (`Cmd+R`)**: Built-in 3~4s verification checks the `/json/version` endpoint to differentiate between page reloads and actual app quits, preventing false exits on `Cmd+R`.
   - **Linux & Windows (Standard Background Daemon - Option 1)**:
     - Retains the lightweight persistent daemon model (`node index.js start / stop`).

---

## 🏗️ Architecture

```text
┌────────────────────────────────────────────────────────┐
│             Google Antigravity Desktop                 │
│                                                        │
│   [ Topbar: (🟢 18% · 180K)  Controls  [+][-][x] ]     │
│       ▲                                                │
│       │ DOM Badge & Hover Tooltip                      │
│       ▼                                                │
│   Electron Chromium Renderer                           │
│       ▲                                                │
└───────┼────────────────────────────────────────────────┘
        │
        │ Chrome DevTools Protocol (CDP) WebSocket
        │ (Discovered via ~/Library/Application Support/Antigravity/DevToolsActivePort)
        ▼
┌────────────────────────────────────────────────────────┐
│             antigravity-topbar-pill                    │
│                                                        │
│  - src/cdp.js      : Lightweight native WebSocket CDP  │
│  - src/daemon.js   : Lifecycle & auto-reconnection     │
│  - src/inject.js   : High-performance DOM pill badge   │
│  - src/tracker.js  : Backward transcript scanner       │
└───────▲────────────────────────────────────────────────┘
        │
        │ fs.watch (Debounced event streaming)
        ▼
┌────────────────────────────────────────────────────────┐
│ ~/.gemini/antigravity/brain/<id>/.../transcript.jsonl  │
└────────────────────────────────────────────────────────┘
```

---

## 🚀 Quick Start

### Prerequisites
- **Node.js**: `>= 18.0.0` (Node 20, 22, 25+ recommended)
- **OS**: macOS (supports LaunchAgent), Linux, Windows

### 1. Clone the repository
```bash
git clone https://github.com/JustinBibi/antigravity-topbar-pill.git
cd antigravity-topbar-pill
```

### 2. Start Background Daemon
```bash
node index.js start
```

### 3. Check Status
```bash
node index.js status
```
*Example Output:*
```text
[ag-topbar] Status: Running (PID: 64123)
[ag-topbar] DevTools Port: 55312
[ag-topbar] Connected: YES
[ag-topbar] Uptime: 12s
[ag-topbar] Active Window Sessions:
  - Conversation: 664aea0e-c0e4-4e67-bd25-02e8415a3422
    Model: Gemini 3.8 Flash High
    Context: 180K / 1M (18%)
```

### 4. Stop and Clean Up
```bash
node index.js stop
```
*Gracefully disconnects and removes the DOM pill and listeners from all open Antigravity windows.*

---

## 🖥️ macOS On-Demand Service (`launchd WatchPaths`)

On macOS, it is recommended to set up the on-demand `launchd` service:
- **When Antigravity opens**: `launchd` detects `DevToolsActivePort` and launches the daemon with `--auto-exit`.
- **When reloading (`Cmd+R`)**: The built-in Reload Guard keeps the service alive.
- **When Antigravity quits**: The daemon detaches and exits cleanly, returning the system to **0 processes and 0 MB RAM**.

### Install macOS LaunchAgent
```bash
node index.js install-daemon
```
Generates and loads `~/Library/LaunchAgents/com.justinbibi.antigravity-topbar.plist`.

### Uninstall macOS LaunchAgent
```bash
node index.js uninstall-daemon
```

> **Note for Linux & Windows Users**: Linux and Windows continue to use the Option 1 standard persistent daemon: `node index.js start` and `node index.js stop`.

---

## 🛠️ CLI Commands

| Command | Description | Platform |
| :--- | :--- | :--- |
| `node index.js start` | Start persistent background daemon (Option 1) | Linux / Windows / macOS |
| `node index.js stop` | Stop daemon and remove topbar pill from all windows | All platforms |
| `node index.js status` | Inspect daemon status, port, and active conversation sessions | All platforms |
| `node index.js run` | Run directly in foreground (prints debug logs, `Ctrl+C` to quit) | All platforms |
| `node index.js run --auto-exit` | Run in on-demand mode (exits when Antigravity closes) | macOS LaunchAgent |
| `node index.js install-daemon` | Install and activate macOS `launchd WatchPaths` service | macOS |
| `node index.js uninstall-daemon` | Uninstall macOS LaunchAgent and clean up | macOS |
| `npm test` | Run full test suite (tracker, CDP, LaunchAgent XML, live DOM injection) | All platforms |

---

## 🧪 Automated Testing

The project includes unit and integration tests covering Token formatting, large transcript scanning, LaunchAgent Plist generation, and live CDP injection:

```bash
npm test
```

---

## 🤖 Guide for AI Agents

If you are an AI Coding Agent (e.g. Antigravity Assistant, Cursor, Claude Code, Gemini CLI, Windsurf) assisting a user, please read [AGENTS.md](AGENTS.md) for automated preflight checks, installation commands, and status assertions.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
Copyright (c) 2026 JustinBibi.
