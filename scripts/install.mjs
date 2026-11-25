#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_PLUGIN_NAME = 'context-meter';
const DEFAULT_PLUGINS_DIR = path.join(os.homedir(), '.gemini', 'config', 'plugins');

function safeLstat(targetPath) {
  try {
    return fs.lstatSync(targetPath);
  } catch {
    return null;
  }
}

/**
 * Install the plugin symlink into Antigravity's plugins directory
 * @param {object} [options]
 * @returns {{ status: 'already-installed'|'installed', targetLink: string }}
 */
export function installPlugin({
  pluginsDir = DEFAULT_PLUGINS_DIR,
  repoRoot = DEFAULT_REPO_ROOT,
  pluginName = DEFAULT_PLUGIN_NAME,
  platform = process.platform
} = {}) {
  fs.mkdirSync(pluginsDir, { recursive: true });
  const targetLink = path.join(pluginsDir, pluginName);
  const stat = safeLstat(targetLink);

  if (stat) {
    if (!stat.isSymbolicLink()) {
      throw new Error(`Refusing to overwrite non-symlink path: ${targetLink}`);
    }
    const existingTarget = path.resolve(path.dirname(targetLink), fs.readlinkSync(targetLink));
    if (existingTarget === path.resolve(repoRoot)) {
      return { status: 'already-installed', targetLink };
    }
    fs.unlinkSync(targetLink);
  }

  const linkType = platform === 'win32' ? 'junction' : 'dir';
  fs.symlinkSync(repoRoot, targetLink, linkType);
  return { status: 'installed', targetLink };
}

/**
 * Uninstall the plugin symlink safely without deleting real directories
 * @param {object} [options]
 * @returns {{ status: 'not-installed'|'removed', targetLink: string }}
 */
export function uninstallPlugin({
  pluginsDir = DEFAULT_PLUGINS_DIR,
  pluginName = DEFAULT_PLUGIN_NAME
} = {}) {
  const targetLink = path.join(pluginsDir, pluginName);
  const stat = safeLstat(targetLink);

  if (!stat) {
    return { status: 'not-installed', targetLink };
  }
  if (!stat.isSymbolicLink()) {
    throw new Error(`Refusing to remove non-symlink path: ${targetLink}`);
  }

  fs.unlinkSync(targetLink);
  return { status: 'removed', targetLink };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isMain) {
  const cmd = process.argv[2] || 'install';
  if (cmd === 'uninstall') {
    const res = uninstallPlugin();
    if (res.status === 'not-installed') {
      console.log('[context-meter] Plugin is not installed.');
    } else {
      console.log(`[context-meter] Removed plugin symlink from ${res.targetLink}`);
    }
  } else {
    const res = installPlugin();
    if (res.status === 'already-installed') {
      console.log(`[context-meter] Already installed at ${res.targetLink}`);
    } else {
      console.log(`[context-meter] Installed plugin symlink: ${res.targetLink} -> ${DEFAULT_REPO_ROOT}`);
      console.log('[context-meter] Enable "Context Meter" in Antigravity Customizations to activate the side panel.');
    }
  }
}
