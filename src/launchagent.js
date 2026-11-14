import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';

export const LAUNCH_AGENT_LABEL = 'com.justinbibi.antigravity-topbar';

/**
 * Get standard LaunchAgents directory
 * @returns {string}
 */
export function getLaunchAgentDir() {
  return path.join(os.homedir(), 'Library', 'LaunchAgents');
}

/**
 * Get path to the LaunchAgent plist file
 * @returns {string}
 */
export function getPlistPath() {
  return path.join(getLaunchAgentDir(), `${LAUNCH_AGENT_LABEL}.plist`);
}

/**
 * Generate XML plist definition string for launchd
 * @param {object} options
 * @param {string} options.nodePath
 * @param {string} options.scriptPath
 * @param {string} options.workDir
 * @param {string} options.logPath
 * @param {string} [options.label]
 * @returns {string}
 */
export function generatePlistContent({
  nodePath = process.execPath,
  scriptPath,
  workDir,
  logPath,
  label = LAUNCH_AGENT_LABEL
}) {
  const currentPath = process.env.PATH || '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin';

  // Sanitize paths for XML insertion
  const escapeXml = (str) => String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${escapeXml(label)}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${escapeXml(nodePath)}</string>
        <string>${escapeXml(scriptPath)}</string>
        <string>run-daemon</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>WorkingDirectory</key>
    <string>${escapeXml(workDir)}</string>
    <key>StandardOutPath</key>
    <string>${escapeXml(logPath)}</string>
    <key>StandardErrorPath</key>
    <string>${escapeXml(logPath)}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>${escapeXml(currentPath)}</string>
    </dict>
</dict>
</plist>
`;
}

/**
 * Install and activate the LaunchAgent on macOS
 * @param {object} options
 * @returns {{ plistPath: string, loaded: boolean }}
 */
export function installLaunchAgent({ nodePath, scriptPath, workDir, logPath }) {
  if (process.platform !== 'darwin') {
    throw new Error('LaunchAgent installation is only supported on macOS');
  }

  const agentDir = getLaunchAgentDir();
  if (!fs.existsSync(agentDir)) {
    fs.mkdirSync(agentDir, { recursive: true });
  }

  const plistPath = getPlistPath();

  // If already exists, attempt to unload first
  if (fs.existsSync(plistPath)) {
    try {
      execSync(`launchctl unload "${plistPath}" 2>/dev/null`, { stdio: 'ignore' });
    } catch {}
  }

  const plistContent = generatePlistContent({
    nodePath: nodePath || process.execPath,
    scriptPath,
    workDir,
    logPath
  });

  fs.writeFileSync(plistPath, plistContent, 'utf8');

  // Load into launchctl
  try {
    execSync(`launchctl load -w "${plistPath}"`, { stdio: 'inherit' });
    return { plistPath, loaded: true };
  } catch (err) {
    throw new Error(`Failed to load LaunchAgent via launchctl: ${err.message}`);
  }
}

/**
 * Deactivate and remove the LaunchAgent
 * @returns {{ removed: boolean }}
 */
export function uninstallLaunchAgent() {
  if (process.platform !== 'darwin') {
    throw new Error('LaunchAgent uninstallation is only supported on macOS');
  }

  const plistPath = getPlistPath();
  if (!fs.existsSync(plistPath)) {
    return { removed: false };
  }

  try {
    execSync(`launchctl unload -w "${plistPath}" 2>/dev/null`, { stdio: 'ignore' });
  } catch {}

  try {
    fs.unlinkSync(plistPath);
    return { removed: true };
  } catch (err) {
    throw new Error(`Failed to remove plist file: ${err.message}`);
  }
}

/**
 * Check if the LaunchAgent is currently loaded in launchd
 * @returns {boolean}
 */
export function isLaunchAgentLoaded() {
  if (process.platform !== 'darwin') return false;
  try {
    const out = execSync(`launchctl list ${LAUNCH_AGENT_LABEL} 2>/dev/null`, { encoding: 'utf8' });
    return out.includes(LAUNCH_AGENT_LABEL) || out.includes('"PID"');
  } catch {
    return false;
  }
}
