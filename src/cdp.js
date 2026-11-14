import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/**
 * Determine the DevToolsActivePort file path based on platform
 * @returns {string}
 */
export function getDevToolsPortFilePath() {
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Antigravity', 'DevToolsActivePort');
  }
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || '', 'Antigravity', 'DevToolsActivePort');
  }
  return path.join(os.homedir(), '.config', 'Antigravity', 'DevToolsActivePort');
}

/**
 * Discover the active DevTools port from Antigravity's runtime directory
 * @returns {number|null}
 */
export function getActivePort() {
  try {
    const portFile = getDevToolsPortFilePath();
    if (!fs.existsSync(portFile)) return null;

    const content = fs.readFileSync(portFile, 'utf8').trim();
    if (!content) return null;

    const lines = content.split('\n');
    const port = parseInt(lines[0].trim(), 10);
    return isNaN(port) ? null : port;
  } catch {
    return null;
  }
}

/**
 * Fetch active Antigravity page targets from the CDP HTTP endpoint
 * @param {number} port
 * @returns {Promise<Array<object>>}
 */
export async function getAntigravityPages(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/list`, {
      signal: AbortSignal.timeout(3000)
    });
    if (!res.ok) return [];

    const targets = await res.json();
    return targets.filter(t => (
      t.type === 'page' &&
      !t.url.startsWith('data:') &&
      (t.url.includes('127.0.0.1') || (t.title && t.title.includes('Antigravity')))
    ));
  } catch {
    return [];
  }
}

/**
 * Minimalist CDP client over native Node.js WebSocket
 */
export class CdpClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.msgId = 1;
    this.callbacks = new Map();
    this.eventListeners = new Map();
    this.isClosed = false;
    this.onDisconnect = null;
  }

  /**
   * Connect to the WebSocket target
   * @returns {Promise<void>}
   */
  async connect() {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.wsUrl);
      } catch (err) {
        return reject(err);
      }

      const timeout = setTimeout(() => {
        if (this.ws.readyState !== 1) {
          this.ws.close();
          reject(new Error('CDP connection timeout'));
        }
      }, 5000);

      this.ws.onopen = () => {
        clearTimeout(timeout);
        resolve();
      };

      this.ws.onerror = (err) => {
        clearTimeout(timeout);
        this.handleClose();
        reject(err);
      };

      this.ws.onclose = () => {
        clearTimeout(timeout);
        this.handleClose();
      };

      this.ws.onmessage = (event) => {
        const raw = typeof event.data === 'string' ? event.data : event.data.toString('utf8');
        this.handleMessage(raw);
      };
    });
  }

  handleMessage(dataStr) {
    let msg;
    try {
      msg = JSON.parse(dataStr);
    } catch {
      return;
    }

    if (msg.id && this.callbacks.has(msg.id)) {
      const { resolve, reject } = this.callbacks.get(msg.id);
      this.callbacks.delete(msg.id);
      if (msg.error) {
        reject(new Error(msg.error.message || 'CDP Error'));
      } else {
        resolve(msg.result);
      }
    } else if (msg.method && this.eventListeners.has(msg.method)) {
      const listeners = this.eventListeners.get(msg.method);
      for (const fn of listeners) {
        try { fn(msg.params); } catch {}
      }
    }
  }

  handleClose() {
    if (this.isClosed) return;
    this.isClosed = true;

    for (const { reject } of this.callbacks.values()) {
      reject(new Error('Connection closed'));
    }
    this.callbacks.clear();

    if (typeof this.onDisconnect === 'function') {
      try { this.onDisconnect(); } catch {}
    }
  }

  /**
   * Send a CDP command
   * @param {string} method
   * @param {object} [params]
   * @returns {Promise<any>}
   */
  send(method, params = {}) {
    if (this.isClosed || !this.ws || this.ws.readyState !== 1) {
      return Promise.reject(new Error('WebSocket not connected'));
    }

    const id = this.msgId++;
    return new Promise((resolve, reject) => {
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /**
   * Subscribe to CDP events
   * @param {string} method
   * @param {Function} callback
   */
  on(method, callback) {
    if (!this.eventListeners.has(method)) {
      this.eventListeners.set(method, new Set());
    }
    this.eventListeners.get(method).add(callback);
  }

  /**
   * Close connection
   */
  close() {
    this.isClosed = true;
    if (this.ws) {
      try { this.ws.close(); } catch {}
    }
  }
}
