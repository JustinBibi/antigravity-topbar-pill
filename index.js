#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { AgTopbarDaemon } from './src/daemon.js';
import { getActivePort, getAntigravityPages, CdpClient } from './src/cdp.js';
import {
  installLaunchAgent,
  uninstallLaunchAgent,
  isLaunchAgentLoaded,
  getPlistPath
} from './src/launchagent.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PID_FILE = path.join(__dirname, 'daemon.pid');
const LOG_FILE = path.join(__dirname, 'daemon.log');
const STATUS_FILE = path.join(__dirname, 'status.json');

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function getRunningPid() {
  if (!fs.existsSync(PID_FILE)) return null;
  try {
    const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
    if (!isNaN(pid) && isProcessAlive(pid)) {
      return pid;
    }
  } catch {}
  return null;
}

async function removeBadgeFromWindow() {
  try {
    const port = getActivePort();
    if (!port) return;
    const pages = await getAntigravityPages(port);
    for (const page of pages) {
      if (page.webSocketDebuggerUrl) {
        try {
          const client = new CdpClient(page.webSocketDebuggerUrl);
          await client.connect();
          await client.send('Runtime.evaluate', {
            expression: `(() => {
              window.__AG_TOPBAR_ENABLED__ = false;
              if (typeof window.__AG_TOPBAR_DETACH__ === 'function') {
                window.__AG_TOPBAR_DETACH__();
              }
              const b = document.getElementById('ag-topbar-token-badge');
              if (b) b.remove();
              const tt = document.getElementById('ag-topbar-tooltip');
              if (tt) tt.remove();
              const st = document.getElementById('ag-topbar-styles');
              if (st) st.remove();
            })()`
          });
          client.close();
        } catch {}
      }
    }
  } catch (err) {
    console.error('[ag-topbar] Cleanup error:', err.message);
  }
}

async function handleStart() {
  const existingPid = getRunningPid();
  if (existingPid) {
    console.log(`[ag-topbar] Daemon is already running (PID: ${existingPid}).`);
    return;
  }

  if (isLaunchAgentLoaded()) {
    console.log('[ag-topbar] Running as macOS LaunchAgent. Use "status" to inspect.');
    return;
  }

  const logFd = fs.openSync(LOG_FILE, 'a');

  const child = spawn(process.execPath, [__filename, 'run-daemon'], {
    detached: true,
    stdio: ['ignore', logFd, logFd]
  });

  child.unref();
  fs.writeFileSync(PID_FILE, String(child.pid));

  console.log(`[ag-topbar] Daemon started in background (PID: ${child.pid}).`);
  console.log(`[ag-topbar] Log output: ${LOG_FILE}`);

  await new Promise(r => setTimeout(r, 1200));
  await handleStatus();
}

async function handleStop() {
  const pid = getRunningPid();

  if (pid) {
    console.log(`[ag-topbar] Stopping daemon (PID: ${pid})...`);
    try {
      process.kill(pid, 'SIGTERM');
    } catch {}

    let terminated = false;
    for (let i = 0; i < 30; i++) {
      if (!isProcessAlive(pid)) {
        terminated = true;
        break;
      }
      await new Promise(r => setTimeout(r, 100));
    }

    if (!terminated) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {}
    }

    if (fs.existsSync(PID_FILE)) {
      try { fs.unlinkSync(PID_FILE); } catch {}
    }
  } else if (isLaunchAgentLoaded()) {
    console.log('[ag-topbar] Notice: Daemon is running via LaunchAgent.');
    console.log('[ag-topbar] To stop and remove the LaunchAgent service, run:');
    console.log('       node index.js uninstall-daemon');
  } else {
    console.log('[ag-topbar] Daemon is not running.');
    if (fs.existsSync(PID_FILE)) {
      try { fs.unlinkSync(PID_FILE); } catch {}
    }
  }

  await removeBadgeFromWindow();
  console.log('[ag-topbar] Cleaned up UI badges.');
}

async function handleStatus() {
  const pid = getRunningPid();
  const launchAgentActive = isLaunchAgentLoaded();

  if (!pid && !launchAgentActive) {
    console.log('[ag-topbar] Status: Stopped');
    return;
  }

  const mode = launchAgentActive ? 'Running (macOS LaunchAgent)' : `Running (PID: ${pid})`;
  console.log(`[ag-topbar] Status: ${mode}`);

  if (fs.existsSync(STATUS_FILE)) {
    try {
      const status = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
      console.log(`[ag-topbar] DevTools Port: ${status.port || 'Waiting for Antigravity...'}`);
      console.log(`[ag-topbar] Connected: ${status.connected ? 'YES' : 'NO'}`);
      console.log(`[ag-topbar] Uptime: ${status.uptimeSeconds || 0}s`);

      if (status.targets && status.targets.length > 0) {
        console.log('[ag-topbar] Active Window Sessions:');
        for (const t of status.targets) {
          console.log(`  - Conversation: ${t.conversationId}`);
          console.log(`    Model: ${t.model}`);
          console.log(`    Context: ${t.contextStr}`);
        }
      } else if (status.message) {
        console.log(`[ag-topbar] Info: ${status.message}`);
      }
    } catch {}
  }
}

async function handleRun(isInternalDaemon = false) {
  const daemon = new AgTopbarDaemon({
    statusFile: STATUS_FILE,
    log: (...args) => console.log(...args)
  });

  const cleanup = async () => {
    await daemon.stop();
    if (fs.existsSync(PID_FILE)) {
      try { fs.unlinkSync(PID_FILE); } catch {}
    }
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  await daemon.start();
}

async function handleInstallDaemon() {
  console.log('[ag-topbar] Setting up macOS LaunchAgent...');

  // Stop standalone daemon if running
  const pid = getRunningPid();
  if (pid) {
    console.log(`[ag-topbar] Stopping existing standalone daemon (PID: ${pid})...`);
    try { process.kill(pid, 'SIGTERM'); } catch {}
    if (fs.existsSync(PID_FILE)) {
      try { fs.unlinkSync(PID_FILE); } catch {}
    }
  }

  try {
    const res = installLaunchAgent({
      nodePath: process.execPath,
      scriptPath: __filename,
      workDir: __dirname,
      logPath: LOG_FILE
    });

    console.log(`[ag-topbar] LaunchAgent installed successfully:`);
    console.log(`       Plist: ${res.plistPath}`);
    console.log(`[ag-topbar] The daemon will now launch automatically on login.`);

    await new Promise(r => setTimeout(r, 1500));
    await handleStatus();
  } catch (err) {
    console.error(`[ag-topbar] Failed to install LaunchAgent:`, err.message);
    process.exit(1);
  }
}

async function handleUninstallDaemon() {
  console.log('[ag-topbar] Removing macOS LaunchAgent...');
  try {
    const res = uninstallLaunchAgent();
    if (res.removed) {
      console.log(`[ag-topbar] LaunchAgent removed from: ${getPlistPath()}`);
    } else {
      console.log('[ag-topbar] LaunchAgent plist was not installed.');
    }

    await removeBadgeFromWindow();
    if (fs.existsSync(PID_FILE)) {
      try { fs.unlinkSync(PID_FILE); } catch {}
    }
    console.log('[ag-topbar] LaunchAgent uninstalled and UI badges cleaned.');
  } catch (err) {
    console.error(`[ag-topbar] Failed to uninstall LaunchAgent:`, err.message);
    process.exit(1);
  }
}

async function main() {
  const cmd = process.argv[2] || 'status';

  switch (cmd) {
    case 'start':
      await handleStart();
      break;
    case 'stop':
      await handleStop();
      break;
    case 'status':
      await handleStatus();
      break;
    case 'run':
      console.log('[ag-topbar] Running in foreground (Press Ctrl+C to stop)...');
      await handleRun(false);
      break;
    case 'run-daemon':
      await handleRun(true);
      break;
    case 'install-daemon':
      await handleInstallDaemon();
      break;
    case 'uninstall-daemon':
      await handleUninstallDaemon();
      break;
    default:
      console.log('Usage: antigravity-topbar [start|stop|status|run|install-daemon|uninstall-daemon]');
      process.exit(1);
  }
}

main().catch(err => {
  console.error('[ag-topbar] Error:', err);
  process.exit(1);
});
