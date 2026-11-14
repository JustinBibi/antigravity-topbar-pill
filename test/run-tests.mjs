import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

import {
  getModelContextLimit,
  formatTokenCount,
  readTokensFromLogPath,
  readLastTokensFromTranscript,
  buildUsagePayload
} from '../src/tracker.js';

import { getActivePort, getAntigravityPages, isCdpEndpointAlive, CdpClient } from '../src/cdp.js';
import { INJECTED_SCRIPT } from '../src/inject.js';
import { AgTopbarDaemon } from '../src/daemon.js';
import {
  generateLaunchAgentPlist,
  generatePlistContent,
  getPlistPath,
  installLaunchAgent,
  uninstallLaunchAgent,
  isLaunchAgentLoaded,
  LAUNCH_AGENT_LABEL
} from '../src/launchagent.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runTests() {
  console.log('=== [1] Testing tracker.js functions ===');

  // 1.1 Model context limit
  assert.strictEqual(getModelContextLimit('Gemini 3.8 Flash High'), 1_000_000);
  assert.strictEqual(getModelContextLimit('Gemini 1.5 Pro'), 2_000_000);
  assert.strictEqual(getModelContextLimit('Claude 3.5 Sonnet'), 200_000);
  assert.strictEqual(getModelContextLimit('Claude 3.7 Sonnet Thinking'), 200_000);
  assert.strictEqual(getModelContextLimit('gpt-4o'), 128_000);
  assert.strictEqual(getModelContextLimit('o1'), 200_000);
  assert.strictEqual(getModelContextLimit('o3-mini'), 200_000);
  assert.strictEqual(getModelContextLimit('DeepSeek V3'), 128_000);
  assert.strictEqual(getModelContextLimit('DeepSeek R1'), 128_000);
  assert.strictEqual(getModelContextLimit('Qwen 2.5 72B'), 128_000);
  assert.strictEqual(getModelContextLimit('Llama 3.3 70B'), 128_000);
  assert.strictEqual(getModelContextLimit('Mistral Large'), 128_000);
  assert.strictEqual(getModelContextLimit('Grok 2'), 128_000);
  assert.strictEqual(getModelContextLimit('custom-fine-tuned-model'), 1_000_000);
  console.log('✓ getModelContextLimit: multi-model limits verified');

  // 1.2 Format token count (edge cases & 999.5K boundary)
  assert.strictEqual(formatTokenCount(0), '0');
  assert.strictEqual(formatTokenCount(-50), '0');
  assert.strictEqual(formatTokenCount(null), '0');
  assert.strictEqual(formatTokenCount(undefined), '0');
  assert.strictEqual(formatTokenCount(Infinity), '0');
  assert.strictEqual(formatTokenCount(-Infinity), '0');
  assert.strictEqual(formatTokenCount(NaN), '0');
  assert.strictEqual(formatTokenCount(542), '542');
  assert.strictEqual(formatTokenCount(542.4), '542');
  assert.strictEqual(formatTokenCount(1000), '1K');
  assert.strictEqual(formatTokenCount(37499), '37K');
  assert.strictEqual(formatTokenCount(106896), '107K');
  assert.strictEqual(formatTokenCount(999499), '999K');
  assert.strictEqual(formatTokenCount(999500), '1M'); // Avoids 1000K display
  assert.strictEqual(formatTokenCount(1_000_000), '1M');
  assert.strictEqual(formatTokenCount(1_250_000), '1.3M');
  assert.strictEqual(formatTokenCount(9_950_000), '10M');
  console.log('✓ formatTokenCount: all boundary formatting verified');

  // 1.3 Synthetic transcript parsing & Large Tool Output resilience (> 100KB)
  const tmpDir = path.join(__dirname, 'tmp');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const tmpLog = path.join(tmpDir, 'test_transcript.jsonl');

  // Empty file
  fs.writeFileSync(tmpLog, '');
  assert.strictEqual(readTokensFromLogPath(tmpLog), null);

  // File with steps and model response followed by massive 150KB tool output
  const sampleData = [
    JSON.stringify({ step_index: 1, source: 'USER', content: 'hello' }),
    JSON.stringify({ step_index: 2, source: 'MODEL', input_tokens: 3200, cache_read_tokens: 7500, output_tokens: 450 }),
    JSON.stringify({ step_index: 3, source: 'GENERIC', content: 'z'.repeat(160000) })
  ].join('\n');
  fs.writeFileSync(tmpLog, sampleData);

  const parsed = readTokensFromLogPath(tmpLog);
  assert.deepStrictEqual(parsed, {
    inputTokens: 3200,
    cachedTokens: 7500,
    outputTokens: 450
  });

  // Alternative usage format
  const sampleDataUsage = [
    JSON.stringify({ step_index: 1, source: 'USER', content: 'hello' }),
    JSON.stringify({ step_index: 2, source: 'MODEL', usage: { input_tokens: 1500, cache_read_tokens: 300, output_tokens: 80 } })
  ].join('\n');
  fs.writeFileSync(tmpLog, sampleDataUsage);
  const parsedUsage = readTokensFromLogPath(tmpLog);
  assert.deepStrictEqual(parsedUsage, {
    inputTokens: 1500,
    cachedTokens: 300,
    outputTokens: 80
  });

  console.log('✓ readTokensFromLogPath: large tool output & alternate formats scan verified');

  // Cleanup tmp
  fs.rmSync(tmpDir, { recursive: true, force: true });

  // 1.4 Test real Antigravity transcript if present
  const realConvId = '664aea0e-c0e4-4e67-bd25-02e8415a3422';
  const realTokens = readLastTokensFromTranscript(realConvId);
  if (realTokens) {
    assert(typeof realTokens.inputTokens === 'number');
    const realPayload = buildUsagePayload({
      conversationId: realConvId,
      modelName: 'Gemini 3.8 Flash High'
    });
    console.log('  Live transcript sample payload:', realPayload);
    assert.strictEqual(realPayload.conversationId, realConvId);
    assert(realPayload.tokenStr.endsWith('K') || realPayload.tokenStr.endsWith('M'));
    assert(realPayload.percentStr.endsWith('%'));
    console.log('✓ buildUsagePayload: real transcript integration verified');
  }

  // 1.5 Payload color threshold testing
  const emptyPayload = buildUsagePayload({ conversationId: 'non-existent-conv', modelName: 'Gemini 3.8 Flash' });
  assert.strictEqual(emptyPayload.dotColor, '#10b981');
  assert.strictEqual(emptyPayload.percentStr, '0%');
  assert.strictEqual(emptyPayload.hasTokens, false);
  console.log('✓ buildUsagePayload: fallback state verified');

  console.log('\n=== [2] Testing launchagent.js ===');

  const plistPath = getPlistPath();
  assert(plistPath.endsWith(`${LAUNCH_AGENT_LABEL}.plist`), 'Plist path matches expected label');

  const plist = generateLaunchAgentPlist({
    nodePath: '/usr/local/bin/node',
    scriptPath: '/Users/test/index.js',
    workDir: '/Users/test',
    logPath: '/Users/test/daemon.log'
  });

  assert(plist.includes('<plist version="1.0">'), 'Contains plist header');
  assert(plist.includes(LAUNCH_AGENT_LABEL), 'Contains label');
  assert(plist.includes('/usr/local/bin/node'), 'Contains nodePath');
  assert(plist.includes('/Users/test/index.js'), 'Contains scriptPath');
  assert(plist.includes('<string>run</string>'), 'Contains run subcommand');
  assert(plist.includes('<string>--auto-exit</string>'), 'Contains --auto-exit flag');
  assert(plist.includes('<key>WatchPaths</key>'), 'Contains WatchPaths');
  assert(plist.includes('Library/Application Support/Antigravity/DevToolsActivePort'), 'Contains DevToolsActivePort watch path');
  assert(plist.includes('<key>ThrottleInterval</key>\n    <integer>2</integer>'), 'Contains ThrottleInterval of 2s');
  assert(plist.includes('<key>RunAtLoad</key>\n    <true/>'), 'Contains RunAtLoad');
  assert(plist.includes('<key>KeepAlive</key>\n    <false/>'), 'Contains KeepAlive: false for on-demand lifecycle');
  assert(plist.includes('<key>PATH</key>'), 'Preserves PATH environment variable');
  console.log('✓ generateLaunchAgentPlist: WatchPaths, ThrottleInterval, KeepAlive:false, --auto-exit verified');

  // Verify generatePlistContent alias works identically
  const aliasPlist = generatePlistContent({
    nodePath: '/usr/local/bin/node',
    scriptPath: '/Users/test/index.js',
    workDir: '/Users/test',
    logPath: '/Users/test/daemon.log'
  });
  assert.strictEqual(aliasPlist, plist, 'generatePlistContent is an alias of generateLaunchAgentPlist');
  console.log('✓ generatePlistContent alias backward-compatibility verified');

  // Verify custom options in generateLaunchAgentPlist
  const customPlist = generateLaunchAgentPlist({
    nodePath: '/opt/homebrew/bin/node',
    scriptPath: '/custom/path/index.js',
    workDir: '/custom/path',
    logPath: '/custom/path/custom.log',
    watchPath: '/custom/DevToolsActivePort',
    throttleInterval: 5,
    autoExit: false
  });
  assert(customPlist.includes('<string>/custom/DevToolsActivePort</string>'), 'Custom watchPath rendered');
  assert(customPlist.includes('<integer>5</integer>'), 'Custom throttleInterval rendered');
  assert(!customPlist.includes('--auto-exit'), 'When autoExit=false, --auto-exit flag is omitted');
  console.log('✓ generateLaunchAgentPlist: custom options verified');

  if (process.platform === 'darwin') {
    // Non-destructive install / uninstall test cycle
    const wasLoaded = isLaunchAgentLoaded();
    const res = installLaunchAgent({
      nodePath: process.execPath,
      scriptPath: path.join(__dirname, '..', 'index.js'),
      workDir: path.join(__dirname, '..'),
      logPath: path.join(__dirname, '..', 'daemon.log')
    });
    assert(res.loaded, 'LaunchAgent reported loaded');
    assert(fs.existsSync(res.plistPath), 'Plist file created');
    assert.strictEqual(isLaunchAgentLoaded(), true, 'LaunchAgent is loaded in launchctl');

    const unRes = uninstallLaunchAgent();
    assert(unRes.removed, 'LaunchAgent reported removed');
    assert(!fs.existsSync(res.plistPath), 'Plist file unlinked');
    assert.strictEqual(isLaunchAgentLoaded(), false, 'LaunchAgent unloaded from launchctl');
    console.log('✓ installLaunchAgent & uninstallLaunchAgent: lifecycle verified');
  }

  console.log('\n=== [2.5] Testing Auto-Exit & Reload Guard (src/daemon.js) ===');

  // Verify isCdpEndpointAlive helper
  assert.strictEqual(await isCdpEndpointAlive(null), false, 'null port returns false');
  assert.strictEqual(await isCdpEndpointAlive(0), false, '0 port returns false');
  assert.strictEqual(await isCdpEndpointAlive(1), false, 'unreachable port returns false');
  console.log('✓ isCdpEndpointAlive: invalid/dead ports verified');

  // Case A: Antigravity Window Reload Guard (Cmd+R simulation)
  // When an active endpoint is responsive on /json/version, daemon MUST stay alive!
  const mockServer = http.createServer((req, res) => {
    if (req.url === '/json/version') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ Browser: 'Antigravity/Mock', 'Protocol-Version': '1.3' }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  await new Promise(resolve => mockServer.listen(0, '127.0.0.1', resolve));
  const reloadServerPort = mockServer.address().port;

  // Endpoint check on running mock server
  assert.strictEqual(await isCdpEndpointAlive(reloadServerPort), true, 'Mock server /json/version is responsive');

  let exitCalledA = false;
  let exitCodeA = null;
  const daemonReload = new AgTopbarDaemon({
    autoExit: true,
    reloadGuardRetries: 2,
    reloadGuardIntervalMs: 50,
    onExit: (code) => { exitCalledA = true; exitCodeA = code; },
    log: () => {}
  });
  daemonReload.isRunning = true;

  // Simulate disconnect while mock server is still alive (Cmd+R reload simulation)
  await daemonReload.checkAndHandleAutoExit(reloadServerPort);
  assert.strictEqual(exitCalledA, false, 'Reload guard: must NOT exit while endpoint is alive');
  assert.strictEqual(daemonReload.isRunning, true, 'Reload guard: daemon must remain running');
  console.log('✓ Reload guard: stayed alive across page reload simulation (Cmd+R)');

  // Close mock server
  await new Promise(resolve => mockServer.close(resolve));

  // Case B: Antigravity Process Termination (Quit simulation)
  // When endpoint is completely dead over retries, daemon MUST call stop() and onExit(0)!
  let exitCalledB = false;
  let exitCodeB = null;
  const daemonQuit = new AgTopbarDaemon({
    autoExit: true,
    reloadGuardRetries: 2,
    reloadGuardIntervalMs: 50,
    onExit: (code) => { exitCalledB = true; exitCodeB = code; },
    log: () => {}
  });
  daemonQuit.isRunning = true;

  // reloadServerPort is now dead (server was closed)
  await daemonQuit.checkAndHandleAutoExit(reloadServerPort);
  assert.strictEqual(exitCalledB, true, 'Auto-exit: must call exit when endpoint is dead');
  assert.strictEqual(exitCodeB, 0, 'Auto-exit: exit code must be 0');
  assert.strictEqual(daemonQuit.isRunning, false, 'Auto-exit: daemon stopped cleanly');
  console.log('✓ Auto-exit on quit: stopped cleanly and called process.exit(0)');

  // Case C: Standard Daemon Mode (Linux / Windows / persistent daemon)
  // When autoExit is false, checkAndHandleAutoExit must do nothing
  let exitCalledC = false;
  const daemonStandard = new AgTopbarDaemon({
    autoExit: false,
    reloadGuardRetries: 2,
    reloadGuardIntervalMs: 50,
    onExit: () => { exitCalledC = true; },
    log: () => {}
  });
  daemonStandard.isRunning = true;

  await daemonStandard.checkAndHandleAutoExit(reloadServerPort);
  assert.strictEqual(exitCalledC, false, 'Standard daemon: autoExit=false never calls exit');
  assert.strictEqual(daemonStandard.isRunning, true, 'Standard daemon: remains running');
  console.log('✓ Standard daemon mode: autoExit=false preserves persistent lifecycle (Linux/Win)');

  console.log('\n=== [3] Testing cdp.js functions ===');

  const port = getActivePort();
  console.log('  Discovered DevTools port:', port);
  assert(typeof port === 'number' && port > 1024, 'Active port must be a valid port number');
  console.log('✓ getActivePort: port discovery verified');

  const pages = await getAntigravityPages(port);
  console.log(`  Found ${pages.length} Antigravity page target(s)`);
  assert(pages.length > 0, 'Must have at least one Antigravity page');
  console.log('✓ getAntigravityPages: page discovery verified');

  console.log('\n=== [4] Testing Live Injection & DOM State via CDP ===');
  const mainPage = pages.find(p => p.url.includes('/c/')) || pages[0];
  const client = new CdpClient(mainPage.webSocketDebuggerUrl);
  await client.connect();

  await client.send('Page.enable');
  await client.send('Runtime.enable');
  await client.send('Runtime.addBinding', { name: '__ag_topbar_nav__' });

  // Clean any previous state
  await client.send('Runtime.evaluate', {
    expression: `(() => {
      if (typeof window.__AG_TOPBAR_DETACH__ === 'function') window.__AG_TOPBAR_DETACH__();
      const b = document.getElementById('ag-topbar-token-badge');
      if (b) b.remove();
      const t = document.getElementById('ag-topbar-tooltip');
      if (t) t.remove();
      const s = document.getElementById('ag-topbar-styles');
      if (s) s.remove();
    })()`
  });

  // Inject script
  await client.send('Runtime.evaluate', { expression: INJECTED_SCRIPT });

  // Verify that before update, ghost badge does NOT attach
  const preState = await client.send('Runtime.evaluate', {
    expression: 'document.getElementById("ag-topbar-token-badge") !== null',
    returnByValue: true
  });
  assert.strictEqual(preState.result.value, false, 'No ghost badge before first update');

  // Check state extraction
  const stateRes = await client.send('Runtime.evaluate', {
    expression: 'window.__AG_TOPBAR_GET_STATE__()',
    returnByValue: true
  });
  const state = stateRes.result.value;
  assert(state && typeof state === 'object', 'State object returned');
  console.log('  Page detected state:', { conversationId: state.conversationId, model: state.model });

  // Test 1: Update with NO conversationId should keep badge hidden
  await client.send('Runtime.evaluate', {
    expression: `window.__AG_TOPBAR_UPDATE__(${JSON.stringify({
      conversationId: null,
      percentStr: '0%',
      tokenStr: '0'
    })})`
  });
  const noConvVerify = await client.send('Runtime.evaluate', {
    expression: `(() => {
      const badge = document.getElementById('ag-topbar-token-badge');
      return !badge || badge.style.display === 'none';
    })()`,
    returnByValue: true
  });
  assert.strictEqual(noConvVerify.result.value, true, 'Badge is hidden when no conversationId');

  // Test 2: Push valid conversation update
  const testPayload = {
    conversationId: state.conversationId || 'test-conv-123',
    percentStr: '12%',
    tokenStr: '120K',
    dotColor: '#10b981',
    model: state.model || 'Gemini 3.8 Flash',
    inputStr: '40,000',
    cachedStr: '75,000',
    outputStr: '5,000',
    contextStr: '120K / 1M (12%)',
    hasTokens: true
  };

  await client.send('Runtime.evaluate', {
    expression: `window.__AG_TOPBAR_UPDATE__(${JSON.stringify(testPayload)})`
  });

  // Verify DOM values and elements
  const domVerify = await client.send('Runtime.evaluate', {
    expression: `(() => {
      const badge = document.getElementById('ag-topbar-token-badge');
      const text = document.getElementById('ag-topbar-badge-text')?.textContent;
      const dot = document.querySelector('#ag-topbar-token-badge .ag-dot')?.style.background;
      const isVisible = badge && badge.style.display !== 'none';
      return { isVisible, text, dot };
    })()`,
    returnByValue: true
  });
  assert.strictEqual(domVerify.result.value.isVisible, true, 'Badge is visible');
  assert.strictEqual(domVerify.result.value.text, '12% · 120K');

  // Verify detach cleanly removes elements
  await client.send('Runtime.evaluate', {
    expression: 'window.__AG_TOPBAR_DETACH__()'
  });
  const postDetach = await client.send('Runtime.evaluate', {
    expression: 'document.getElementById("ag-topbar-token-badge") === null && document.getElementById("ag-topbar-tooltip") === null',
    returnByValue: true
  });
  assert.strictEqual(postDetach.result.value, true, 'Badge & tooltip cleanly removed from DOM');

  client.close();
  console.log('✓ Live CDP injection & DOM verification passed');

  console.log('\n🎉 ALL TESTS PASSED SUCCESSFULLY!');
}

runTests().catch(err => {
  console.error('\n❌ Test failed:', err);
  process.exit(1);
});
