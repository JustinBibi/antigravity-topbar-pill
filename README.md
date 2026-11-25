# Context Meter for Antigravity (`context-meter`)

<p align="center">
  <b>English</b> · <a href="README_zh.md">简体中文</a>
</p>

<p align="center">
  <b>Official-architecture Antigravity Sidecar UI Plugin for real-time context window token usage, cache hit rate, and turn-by-turn growth tracking.</b>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-%3E%3D18.0.0-green.svg" alt="Node version" />
  <img src="https://img.shields.io/badge/Dependencies-0-brightgreen.svg" alt="Zero dependencies" />
  <img src="https://img.shields.io/badge/Plugin-Antigravity%20Sidecar%20UI-blue.svg" alt="Antigravity Sidecar UI Plugin" />
  <img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License" />
</p>

---

## Why Official Sidecar UI Plugin?

Starting with **Antigravity v2.35+**, Chrome DevTools remote debugging (`--remote-debugging-port`) is disabled by default. Version 2.0 of this project migrates completely to Antigravity's native **Plugin + Sidecar Web UI** architecture:

- **Zero launch flags & zero CDP**: Open Antigravity normally from your Dock or launcher — no `--remote-debugging-port`, no wrapper `.app`, no LaunchAgent.
- **100% bound to the active conversation**: Antigravity passes the active `conversationId` directly to the side panel (`AUX_PANE`), keeping multi-window and historical conversation switching accurate.
- **Zero external dependencies**: Uses only built-in Node.js APIs and Antigravity's injected `sidecar_sdk`.
- **Native light/dark theme sync**: Inherits Antigravity's live CSS theme variables automatically via `/preload.js`, paired with a transparent-background icon.
- **Built-in token auth & incremental I/O**: Uses a token-authenticated `POST /api/usage` endpoint and 64KB incremental chunked reading with ETag short-circuiting so long sessions stay fast.

---

## Features

1. **Real-Time Context Window Gauge**
   - Live percentage, used vs. limit ratio (e.g. `110K / 1M`), and remaining context budget.
   - Dynamic health indicator:
     - `< 60%`: Healthy (Emerald `#10b981`)
     - `60% – 85%`: Elevated (Amber `#f59e0b`)
     - `>= 85%`: Critical (Red `#ef4444`)

2. **Token Breakdown & Prompt Cache Efficiency**
   - **Input (Uncached)** tokens for the latest turn.
   - **Cached Read** tokens with live **Cache Hit Rate (%)**.
   - **Output** tokens (latest turn + true full-session cumulative total, even beyond 40 turns).
   - Supports **Claude `cache_creation_input_tokens`** in total context accounting.

3. **Responsive Turn-by-Turn Growth Chart**
   - 1:1 pixel-accurate SVG sparkline with `ResizeObserver` support and native HTML axis labels showing real turn numbers (e.g. `T22` → `T61`).
   - Hover any turn dot to inspect exact context size, per-turn delta (`+Δ`), and output tokens.

---

## Installation

### 1. Clone and install plugin symlink
```bash
git clone https://github.com/JustinBibi/antigravity-topbar-pill.git
cd antigravity-topbar-pill
npm run install-plugin
```
This safely links the repository to `~/.gemini/config/plugins/context-meter` (uses a `junction` on Windows and refuses to overwrite non-symlink directories).

### 2. Enable in Antigravity
1. Open **Customizations → Plugins** in Antigravity.
2. Enable **Context Meter** (`context-meter`).
3. Open the **Context Meter** tab from the right-hand side pane (`+` menu) in any conversation.

> **Updating**: After pulling backend changes (`main.mjs` / `tracker.mjs`), toggle **Context Meter** off and back on once in **Customizations → Plugins** to reload the sidecar process.

### Uninstall
```bash
npm run uninstall-plugin
```

---

## Architecture

```text
antigravity-topbar-pill/
├── plugin.json                        # Antigravity plugin manifest
├── assets/logo.svg                    # Transparent-background plugin icon
├── sidecars/context_panel/
│   ├── sidecar.json                   # Declares has_web_ui + AUX_PANE entrypoint
│   ├── main.mjs                       # sidecar_sdk server (GET / and authenticated POST /api/usage)
│   ├── tracker.mjs                    # 64KB incremental transcript.jsonl reader + ETag caching
│   └── index.html                     # Native-themed side panel UI with 1:1 SVG chart
├── scripts/install.mjs                # Safe symlink installer for ~/.gemini/config/plugins/
└── test/run-tests.mjs                 # Automated unit, security, and manifest test suite
```

---

## Automated Testing

```bash
npm test
```

---

## Guide for AI Agents

See [AGENTS.md](AGENTS.md) for automated installation, Sidecar engineering guardrails, verification assertions, and safe removal instructions.

---

## License

This project is licensed under the [MIT License](LICENSE).
Copyright (c) 2026 JustinBibi.
