import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { getActivePort, getAntigravityPages, CdpClient } from './cdp.js';
import { INJECTED_SCRIPT } from './inject.js';
import { buildUsagePayload } from './tracker.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_STATUS_FILE = path.join(__dirname, '..', 'status.json');
const ANTIGRAVITY_BASE = path.join(os.homedir(), '.gemini', 'antigravity');

export class AgTopbarDaemon {
  constructor({ statusFile = DEFAULT_STATUS_FILE, log = console.log } = {}) {
    this.statusFile = statusFile;
    this.log = log;
    this.isRunning = false;
    this.activeConnections = new Map(); // targetId -> { client, watcher, lastConvId, scriptIdentifier }
    this.pollTimer = null;
    this.startTime = Date.now();
    this.lastPort = null;
  }

  async start() {
    this.isRunning = true;
    this.log('[ag-topbar] Starting daemon loop...');
    this.updateStatusFile({ running: true, connected: false, targets: [] });
    this.runLoop();
  }

  async stop() {
    this.isRunning = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }

    for (const [targetId, conn] of this.activeConnections.entries()) {
      if (!conn.client.isClosed) {
        await conn.client.send('Runtime.evaluate', {
          expression: 'typeof window.__AG_TOPBAR_DETACH__ === "function" && window.__AG_TOPBAR_DETACH__()'
        }).catch(() => {});
      }
      await this.cleanupConnection(targetId, conn);
    }
    this.activeConnections.clear();
    this.updateStatusFile({ running: false, connected: false, targets: [] });
    this.log('[ag-topbar] Daemon stopped cleanly.');
  }

  updateStatusFile(data) {
    try {
      const payload = {
        updatedAt: new Date().toISOString(),
        uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
        ...data
      };
      fs.writeFileSync(this.statusFile, JSON.stringify(payload, null, 2));
    } catch {}
  }

  async runLoop() {
    if (!this.isRunning) return;

    try {
      await this.tick();
    } catch (err) {
      this.log(`[ag-topbar] Loop error: ${err.message}`);
    }

    if (this.isRunning) {
      this.pollTimer = setTimeout(() => this.runLoop(), 1500);
    }
  }

  async tick() {
    const port = getActivePort();
    if (!port) {
      if (this.lastPort !== null) {
        // Port was present before, Antigravity likely closed
        await this.disconnectAll();
        this.lastPort = null;
      }
      this.updateStatusFile({
        running: true,
        connected: false,
        message: 'Antigravity DevTools port not found (is Antigravity running?)'
      });
      return;
    }

    // Detect if port changed upon Antigravity restart
    if (this.lastPort !== null && this.lastPort !== port) {
      this.log(`[ag-topbar] Port changed from ${this.lastPort} to ${port}. Re-attaching...`);
      await this.disconnectAll();
    }
    this.lastPort = port;

    const pages = await getAntigravityPages(port);
    if (!pages.length) {
      this.updateStatusFile({
        running: true,
        connected: false,
        port,
        message: 'No active Antigravity pages found'
      });
      return;
    }

    const currentTargetIds = new Set(pages.map(p => p.id));

    // Cleanup closed pages
    for (const [targetId, conn] of this.activeConnections.entries()) {
      if (!currentTargetIds.has(targetId) || conn.client.isClosed) {
        await this.cleanupConnection(targetId, conn);
        this.activeConnections.delete(targetId);
      }
    }

    // Connect new pages
    for (const page of pages) {
      if (!this.activeConnections.has(page.id)) {
        await this.attachToPage(page, port);
      }
    }

    // Update state for connected pages
    const targetsSummary = [];
    for (const [targetId, conn] of this.activeConnections.entries()) {
      if (!conn.client.isClosed) {
        const summary = await this.syncPage(conn);
        if (summary) targetsSummary.push(summary);
      }
    }

    this.updateStatusFile({
      running: true,
      connected: targetsSummary.length > 0,
      port,
      targets: targetsSummary
    });
  }

  async disconnectAll() {
    for (const [targetId, conn] of this.activeConnections.entries()) {
      await this.cleanupConnection(targetId, conn);
    }
    this.activeConnections.clear();
  }

  async attachToPage(page, port) {
    const wsUrl = page.webSocketDebuggerUrl;
    if (!wsUrl) return;

    try {
      const client = new CdpClient(wsUrl);
      await client.connect();

      this.log(`[ag-topbar] Attached to page "${page.title || page.url}" (${page.id})`);

      // Enable Page and Runtime domains
      await client.send('Page.enable').catch(() => {});
      await client.send('Runtime.enable').catch(() => {});

      // Add navigation binding for instant route updates
      await client.send('Runtime.addBinding', { name: '__ag_topbar_nav__' }).catch(() => {});

      // Add script for future page loads/reloads
      const addScriptRes = await client.send('Page.addScriptToEvaluateOnNewDocument', {
        source: INJECTED_SCRIPT
      }).catch(() => null);

      // Immediately evaluate in currently loaded document
      await client.send('Runtime.evaluate', {
        expression: INJECTED_SCRIPT
      }).catch(() => {});

      const conn = {
        targetId: page.id,
        title: page.title,
        url: page.url,
        client,
        watcher: null,
        lastConvId: null,
        scriptIdentifier: addScriptRes?.identifier || null
      };

      // Listen to navigation events to re-inject script
      client.on('Page.loadEventFired', async () => {
        try {
          await client.send('Runtime.evaluate', { expression: INJECTED_SCRIPT });
          await this.syncPage(conn);
        } catch {}
      });

      client.on('Page.frameNavigated', async (params) => {
        // Only react to main frame navigations, skip iframes
        if (params?.frame?.parentId) return;
        try {
          await client.send('Runtime.evaluate', { expression: INJECTED_SCRIPT });
          await this.syncPage(conn);
        } catch {}
      });

      // React to client-side route changes instantly
      client.on('Runtime.bindingCalled', async (params) => {
        if (params?.name === '__ag_topbar_nav__') {
          await this.syncPage(conn);
        }
      });

      client.onDisconnect = async () => {
        this.log(`[ag-topbar] Disconnected from target ${page.id}`);
        await this.cleanupConnection(page.id, conn);
        this.activeConnections.delete(page.id);
      };

      this.activeConnections.set(page.id, conn);
      await this.syncPage(conn);
    } catch (err) {
      this.log(`[ag-topbar] Failed to attach to ${page.id}: ${err.message}`);
    }
  }

  async syncPage(conn) {
    try {
      const stateRes = await conn.client.send('Runtime.evaluate', {
        expression: `typeof window.__AG_TOPBAR_GET_STATE__ === 'function' ? window.__AG_TOPBAR_GET_STATE__() : null`,
        returnByValue: true
      });

      let state = stateRes?.result?.value;
      if (!state) {
        // Injected functions might not be ready yet; re-evaluate injection
        await conn.client.send('Runtime.evaluate', { expression: INJECTED_SCRIPT }).catch(() => {});
        return null;
      }

      const { conversationId, model, isAttached } = state;

      // Handle transcript file watcher if conversation changed OR watcher not yet established
      if (conversationId !== conn.lastConvId || !conn.watcher) {
        conn.lastConvId = conversationId;
        this.setupWatcher(conn, conversationId);
      }

      // Compute payload
      const payload = buildUsagePayload({
        conversationId,
        modelName: model
      });

      // Push payload to page
      await conn.client.send('Runtime.evaluate', {
        expression: `typeof window.__AG_TOPBAR_UPDATE__ === 'function' && window.__AG_TOPBAR_UPDATE__(${JSON.stringify(payload)})`
      });

      // Re-attach if badge disappeared from DOM
      if (!isAttached) {
        await conn.client.send('Runtime.evaluate', {
          expression: `typeof window.__AG_TOPBAR_ATTACH__ === 'function' && window.__AG_TOPBAR_ATTACH__()`
        }).catch(() => {});
      }

      return {
        targetId: conn.targetId,
        conversationId: conversationId || '(none)',
        model: payload.model,
        percent: payload.percentStr,
        tokens: payload.tokenStr,
        contextStr: payload.contextStr
      };
    } catch {
      return null;
    }
  }

  setupWatcher(conn, conversationId) {
    if (conn.watcher) {
      try { conn.watcher.close(); } catch {}
      conn.watcher = null;
    }

    if (!conversationId) return;

    const transcriptDir = path.join(
      ANTIGRAVITY_BASE,
      'brain',
      conversationId,
      '.system_generated',
      'logs'
    );

    if (!fs.existsSync(transcriptDir)) return;

    try {
      let debounceTimer = null;
      conn.watcher = fs.watch(transcriptDir, (eventType, filename) => {
        if (filename && filename.includes('transcript')) {
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            this.syncPage(conn).catch(() => {});
          }, 250);
        }
      });
      conn.watcher.on('error', () => {
        if (conn.watcher) {
          try { conn.watcher.close(); } catch {}
          conn.watcher = null;
        }
      });
    } catch {}
  }

  async cleanupConnection(targetId, conn) {
    if (conn.watcher) {
      try { conn.watcher.close(); } catch {}
      conn.watcher = null;
    }
    if (conn.client && !conn.client.isClosed) {
      if (conn.scriptIdentifier) {
        await conn.client.send('Page.removeScriptToEvaluateOnNewDocument', {
          identifier: conn.scriptIdentifier
        }).catch(() => {});
      }
      conn.client.close();
    }
  }
}
