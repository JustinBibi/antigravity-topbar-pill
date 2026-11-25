# AI Agent Integration & Maintenance Guide

This repository is a native **Antigravity Sidecar UI Plugin** (`context-meter`) that renders a real-time context token usage panel in Antigravity's auxiliary side pane (`SIDECAR_UI_ENTRYPOINT_AUX_PANE`).

---

## 1. Architecture Overview

- **Zero external dependencies**: Uses only Node.js built-ins and Antigravity's injected `sidecar_sdk`.
- **Read-only data source**: Incrementally reads `~/.gemini/antigravity/brain/<conversationId>/.system_generated/logs/transcript.jsonl` (or `$ANTIGRAVITY_APP_DATA_DIR` if set).
- **Native lifecycle & conversation binding**: Antigravity automatically manages the sidecar process and passes `?conversationId=<id>&token=<token>` to the side pane.

```text
plugin.json                       # Plugin manifest (name: "context-meter")
assets/logo.svg                   # Transparent-background SVG icon (light & dark friendly)
scripts/install.mjs               # Safe symlink installer (refuses to overwrite real dirs)
sidecars/context_panel/
├── sidecar.json                  # Declares has_web_ui: true + AUX_PANE entrypoint
├── main.mjs                      # sidecar_sdk server: GET / and POST /api/usage
├── tracker.mjs                   # 64KB incremental JSONL reader + ETag + full-session totals
└── index.html                    # Native-themed UI with 1:1 SVG chart
```

---

## 2. Safety Principles

1. **Never kill or restart Antigravity**: Plugin discovery and activation take effect live without restarting the host app.
2. **Never modify `app.asar` or `~/.gemini/config/config.json` manually**: Always let the user enable, disable, or reload the plugin via Antigravity's Customizations UI (`[Context Meter](customization://context-meter)`).
3. **Never overwrite non-symlink directories**: `scripts/install.mjs` checks `lstatSync` and refuses to delete or replace real directories/files.
4. **Keep public assets clean**: Never commit local absolute paths (e.g., `/Users/...`), temporary logs, or secrets.

---

## 3. Installation, Activation & Reloading

### Install plugin symlink
```bash
npm run install-plugin
```
This links the repository to `~/.gemini/config/plugins/context-meter` (uses a `junction` on Windows).

### Enable & open
1. Guide the user to enable **Context Meter** via `[Context Meter](customization://context-meter)`.
2. Once enabled and running, the user can open the panel from the side pane `+` menu or via `[Context Meter](sidecar://context-meter/context_panel/)`.

### Reload behavior after code edits
- **Frontend (`index.html`)**: `main.mjs` reads `index.html` on each request with `Cache-Control: no-store`. Closing and reopening the side pane tab immediately reflects UI edits.
- **Backend (`main.mjs`, `tracker.mjs`)**: Toggle **Context Meter** off and back on once in `[Context Meter](customization://context-meter)` so Antigravity restarts the sidecar process with the new backend code.

---

## 4. Antigravity Sidecar Engineering Guardrails

Any AI agent or maintainer modifying this plugin **MUST** respect these host-specific behaviors:

1. **`/preload.js` resets `body` padding**: Antigravity's `/preload.js` executes `document.body.style.padding = '0'` on `DOMContentLoaded`. Always apply outer spacing on an inner container (`.stack`), never on `body`.
2. **Avoid host `--accent` CSS variable collision**: Host `theme-change` messages inject `--accent` onto `:root`. Keep custom health/status colors in a dedicated variable (`--health-color`).
3. **Keep `/api/usage` as `POST` (not `GET`)**: `sidecar_sdk` only enforces `x-sidecar-token` authentication on non-GET requests (`req.method !== 'GET'`). Keeping `/api/usage` on `POST` guarantees token auth at the framework layer.
4. **Preserve incremental reading & full-session totals**:
   - `tracker.mjs` maintains a bounded `Map` cache keyed by `filePath` (`ino` + `byteOffset`) and reads appended bytes in 64KB chunks with partial-JSON line buffering. Do not regress to full-file `fs.readFileSync`.
   - Keep full-session `turnCount` and `totalOutput` decoupled from the 40-turn chart window so long conversations (> 40 turns) preserve real turn indices (e.g. `T22` → `T61`), accurate per-turn `delta`, and true cumulative output.
   - Include `cache_creation_tokens` / `cache_creation_input_tokens` in `contextUsed` for Claude models.
5. **Render SVG charts 1:1 (never `preserveAspectRatio="none"`)**: Compute `viewBox` from the container's real `clientWidth` with a `ResizeObserver`, and render axis labels as native HTML elements to prevent oval distortion and stretched text.
6. **Keep `assets/logo.svg` transparent**: Do not add an opaque dark background `<rect>`; use medium/emerald strokes legible on both light and dark themes.

---

## 5. Automated Verification

Run the test suite before committing or pushing:

```bash
npm test
```

**Expected assertion**: Exit code `0` ending with `🎉 ALL TESTS PASSED SUCCESSFULLY!`.

Tests cover:
- Plugin & sidecar manifests, `POST` route enforcement, and frontend inline `<script>` syntax validation.
- Multi-model context limits, formatting boundaries, and `conversationId` path-traversal guards.
- Multi-turn parsing across large tool outputs (> 100KB), ETag short-circuiting, > 40 turns accuracy (55 turns), incremental append + partial JSON line recovery, and Claude `cache_creation_input_tokens`.
- Safe symlink install/uninstall and non-symlink directory protection in `scripts/install.mjs`.

---

## 6. Safe Removal

```bash
npm run uninstall-plugin
```
