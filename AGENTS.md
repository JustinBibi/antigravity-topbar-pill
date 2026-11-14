# AI Agent Integration & Verification Guide

This guide is designed for AI Coding Agents (such as **Google Antigravity**, **Cursor**, **Claude Code**, **Gemini CLI**, **Windsurf**, etc.) to safely install, verify, and manage `antigravity-topbar-pill` in user environments without causing disruption.

---

## 1. Safety Principles for Agents

1. **Never kill or restart the host Antigravity app**: The user may be actively chatting or coding. `antigravity-topbar-pill` dynamically hooks into running Electron instances via CDP without requiring any app restart.
2. **Never modify `app.asar`**: Zero ASAR hacking. Never attempt to unpack, patch, or alter Antigravity application bundles.
3. **Assert deterministically**: Always verify the installation by checking CLI output assertions rather than guessing.

---

## 2. Preflight Checks

Before installing or running, execute the following commands in shell:

### Check 1: Node.js Runtime (>= 18 required)
```bash
node -v
```
**Expected assertion**: Output must be `>= v18.0.0` (v20, v22, v25+ fully supported with native WebSocket and fetch).

### Check 2: Antigravity DevTools Port Availability
On macOS:
```bash
cat ~/Library/Application\ Support/Antigravity/DevToolsActivePort
```
**Expected assertion**: Must output a positive integer port (e.g. `55312`) followed by a path. If the file does not exist, notify the user that Google Antigravity needs to be running.

---

## 3. Installation Options

### Option A: As a Background Daemon (Ad-hoc)
```bash
node index.js start
```

### Option B: As a Persistent macOS LaunchAgent (Recommended for User Logins)
```bash
node index.js install-daemon
```
This generates and loads `~/Library/LaunchAgents/com.justinbibi.antigravity-topbar.plist`, keeping the token pill active across reboots and Antigravity restarts.

---

## 4. Verification Assertions

To confirm that the badge is live and communicating with the renderer, run:

```bash
node index.js status
```

### Passing Assertion Criteria:
- **Status**: Contains `Running`
- **Connected**: Strictly `Connected: YES`
- **Active Window Sessions**: At least one active conversation target listed:
  ```text
  [ag-topbar] Status: Running (macOS LaunchAgent)
  [ag-topbar] DevTools Port: 55312
  [ag-topbar] Connected: YES
  [ag-topbar] Uptime: 4s
  [ag-topbar] Active Window Sessions:
    - Conversation: <conversation-uuid>
      Model: <model-name>
      Context: <percent>% · <tokens>
  ```

---

## 5. Automated Verification Test Suite

You can execute the automated test suite anytime to verify backward log parsing, CDP discovery, LaunchAgent XML generation, and live DOM injection:

```bash
npm test
```
**Expected assertion**: Exit code `0` and ending with `🎉 ALL TESTS PASSED SUCCESSFULLY!`.

---

## 6. Safe Removal & Rollback

If the user requests removal or you need to roll back:

### If installed as LaunchAgent:
```bash
node index.js uninstall-daemon
```

### If running as ad-hoc daemon:
```bash
node index.js stop
```

Both commands cleanly detach the DOM elements (badge, tooltip, styles) from all open Antigravity windows immediately.
