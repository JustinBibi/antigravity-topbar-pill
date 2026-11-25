import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

import {
  getModelContextLimit,
  formatModelName,
  formatTokenCount,
  isValidConversationId,
  readUsageHistoryFromLogPath,
  readUsageSummaryFromLogPath,
  buildConversationUsage,
  clearTranscriptCache
} from '../sidecars/context_panel/tracker.mjs';
import { installPlugin, uninstallPlugin } from '../scripts/install.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

async function runTests() {
  clearTranscriptCache();
  console.log('=== [1] Testing plugin & sidecar manifests ===');

  const pluginJson = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'plugin.json'), 'utf8'));
  assert.strictEqual(pluginJson.name, 'context-meter');
  assert(pluginJson.displayName, 'plugin.json has displayName');
  assert(fs.existsSync(path.join(REPO_ROOT, pluginJson.logo)), 'plugin logo exists');

  const sidecarJson = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, 'sidecars', 'context_panel', 'sidecar.json'), 'utf8')
  );
  assert.strictEqual(sidecarJson.has_web_ui, true, 'sidecar enables web UI');
  assert.strictEqual(sidecarJson.command, 'node');
  assert.deepStrictEqual(sidecarJson.args, ['main.mjs']);
  assert.strictEqual(
    sidecarJson.ui_config?.views?.[0]?.entrypoint,
    'SIDECAR_UI_ENTRYPOINT_AUX_PANE',
    'sidecar exposes AUX_PANE entrypoint'
  );

  const mainSource = fs.readFileSync(path.join(REPO_ROOT, 'sidecars', 'context_panel', 'main.mjs'), 'utf8');
  assert(mainSource.includes("'POST'"), 'API route uses POST so sidecar_sdk enforces token auth');

  const htmlSource = fs.readFileSync(path.join(REPO_ROOT, 'sidecars', 'context_panel', 'index.html'), 'utf8');
  const scriptMatch = htmlSource.match(/<script>([\s\S]*?)<\/script>/);
  assert(scriptMatch, 'index.html contains inline script');
  new Function(scriptMatch[1]);
  console.log('✓ Manifests, authenticated POST API, and frontend script syntax verified');

  console.log('\n=== [2] Testing tracker.mjs ===');

  // 2.1 Context window limits
  assert.strictEqual(getModelContextLimit('Gemini 4 Neon Medium'), 1_000_000);
  assert.strictEqual(getModelContextLimit('Gemini 2.5 Pro'), 2_000_000);
  assert.strictEqual(getModelContextLimit('Claude 3.7 Sonnet'), 200_000);
  assert.strictEqual(getModelContextLimit('gpt-4o'), 128_000);
  assert.strictEqual(getModelContextLimit('DeepSeek R1'), 128_000);

  // 2.2 Model name formatting
  assert.strictEqual(formatModelName('gemini-4-neon-medium'), 'Gemini 4 Neon Medium');
  assert.strictEqual(formatModelName('Claude 3.7 Sonnet'), 'Claude 3.7 Sonnet');
  assert.strictEqual(formatModelName(''), 'Unknown Model');

  // 2.3 Token formatting boundaries
  assert.strictEqual(formatTokenCount(0), '0');
  assert.strictEqual(formatTokenCount(-10), '0');
  assert.strictEqual(formatTokenCount(542), '542');
  assert.strictEqual(formatTokenCount(37499), '37K');
  assert.strictEqual(formatTokenCount(999500), '1M');
  assert.strictEqual(formatTokenCount(1_250_000), '1.3M');

  // 2.4 Conversation ID validation (path traversal guard)
  assert.strictEqual(isValidConversationId('a7d2fcdf-2cad-4f5d-8ad7-3c88b1cf6513'), true);
  assert.strictEqual(isValidConversationId('../etc/passwd'), false);
  assert.strictEqual(isValidConversationId(''), false);
  console.log('✓ Limits, formatting, and ID validation verified');

  // 2.5 Synthetic multi-turn transcript parsing + etag short-circuit + Claude cache creation
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-ctx-meter-test-'));
  try {
    const convId = 'test-conv-001';
    const logDir = path.join(tmpBase, 'brain', convId, '.system_generated', 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    const logPath = path.join(logDir, 'transcript.jsonl');

    const lines = [
      JSON.stringify({ step_index: 1, source: 'USER', content: 'hello' }),
      JSON.stringify({
        step_index: 2,
        source: 'MODEL',
        model: 'gemini-4-neon-medium',
        input_tokens: 10000,
        cache_read_tokens: 30000,
        output_tokens: 500
      }),
      JSON.stringify({ step_index: 3, source: 'GENERIC', content: 'x'.repeat(120000) }),
      JSON.stringify({
        step_index: 4,
        source: 'MODEL',
        model: 'gemini-4-neon-medium',
        input_tokens: 20000,
        cache_read_tokens: 80000,
        output_tokens: 1200
      })
    ].join('\n');
    fs.writeFileSync(logPath, lines);

    const history = readUsageHistoryFromLogPath(logPath);
    assert.strictEqual(history.length, 2, 'Parsed both model turns across large tool output');

    const payload = buildConversationUsage({ conversationId: convId, baseDir: tmpBase });
    assert.strictEqual(payload.hasTokens, true);
    assert.strictEqual(payload.model, 'Gemini 4 Neon Medium');
    assert.strictEqual(payload.contextUsed, 100_000);
    assert.strictEqual(payload.tokenStr, '100K');
    assert.strictEqual(payload.percentStr, '10%');
    assert.strictEqual(payload.remainingStr, '900K');
    assert.strictEqual(payload.cacheHitRate, 80);
    assert.strictEqual(payload.health.level, 'healthy');
    assert.strictEqual(payload.turnCount, 2);
    assert.strictEqual(payload.history[1].delta, 60_000);
    assert.strictEqual(payload.latest.totalOutputStr, '1,700');

    // Etag unchanged short-circuit
    const cachedRes = buildConversationUsage({
      conversationId: convId,
      baseDir: tmpBase,
      clientEtag: payload.etag
    });
    assert.strictEqual(cachedRes.unchanged, true, 'ETag short-circuits unchanged transcript');

    // Missing conversation fallback
    const emptyRes = buildConversationUsage({ conversationId: 'missing-conv', baseDir: tmpBase });
    assert.strictEqual(emptyRes.hasTokens, false);
    assert.strictEqual(emptyRes.percentStr, '0%');
    console.log('✓ Multi-turn usage parsing, cache hit rate, deltas, and ETag caching verified');

    // 2.6 > 40 turns accuracy (55 turns)
    const conv55 = 'test-conv-55';
    const logDir55 = path.join(tmpBase, 'brain', conv55, '.system_generated', 'logs');
    fs.mkdirSync(logDir55, { recursive: true });
    const lines55 = [];
    for (let i = 1; i <= 55; i++) {
      lines55.push(JSON.stringify({
        step_index: i,
        source: 'MODEL',
        model: 'gemini-4-neon-high',
        input_tokens: 1000,
        cache_read_tokens: i * 1000,
        output_tokens: 100
      }));
    }
    fs.writeFileSync(path.join(logDir55, 'transcript.jsonl'), lines55.join('\n') + '\n');
    const payload55 = buildConversationUsage({ conversationId: conv55, baseDir: tmpBase });
    assert.strictEqual(payload55.turnCount, 55, 'turnCount reflects total 55 turns');
    assert.strictEqual(payload55.history.length, 40, 'chart window caps at 40 turns');
    assert.strictEqual(payload55.history[0].turn, 16, 'first visible turn is T16');
    assert.strictEqual(payload55.history[39].turn, 55, 'last visible turn is T55');
    assert.strictEqual(payload55.history[0].delta, 1000, 'T16 delta reflects T16 - T15, not full context');
    assert.strictEqual(payload55.latest.totalOutputStr, '5,500', 'session total output sums all 55 turns');
    console.log('✓ Long conversation (>40 turns) turn numbers, deltas, and totals verified');

    // 2.7 Incremental append & partial JSON line resilience
    const incPath = path.join(tmpBase, 'incremental.jsonl');
    const turn1 = JSON.stringify({ step_index: 1, model: 'claude-3.7-sonnet', input_tokens: 2000, cache_read_tokens: 8000, cache_creation_input_tokens: 1000, output_tokens: 200 });
    const turn2 = JSON.stringify({ step_index: 2, model: 'claude-3.7-sonnet', input_tokens: 3000, cache_read_tokens: 9000, cache_creation_input_tokens: 500, output_tokens: 300 });
    const turn3 = JSON.stringify({ step_index: 3, model: 'claude-3.7-sonnet', input_tokens: 4000, cache_read_tokens: 10000, cache_creation_input_tokens: 0, output_tokens: 400 });

    fs.writeFileSync(incPath, `${turn1}\n${turn2}\n`);
    const s1 = readUsageSummaryFromLogPath(incPath);
    assert.strictEqual(s1.totalTurns, 2);
    assert.strictEqual(s1.turns[0].contextUsed, 11000, 'includes Claude cache_creation_input_tokens');

    // Append half of turn3 (no newline yet)
    const splitAt = Math.floor(turn3.length / 2);
    fs.appendFileSync(incPath, turn3.slice(0, splitAt));
    const s2 = readUsageSummaryFromLogPath(incPath);
    assert.strictEqual(s2.totalTurns, 2, 'partial JSON line does not corrupt or skip turn');

    // Append rest of turn3
    fs.appendFileSync(incPath, turn3.slice(splitAt) + '\n');
    const s3 = readUsageSummaryFromLogPath(incPath);
    assert.strictEqual(s3.totalTurns, 3, 'completed partial JSON line picked up cleanly');
    assert.strictEqual(s3.totalOutput, 900, 'incremental totalOutput accurate');
    assert.strictEqual(s3.turns[2].delta, 1500, 'incremental turn delta accurate');
    console.log('✓ Incremental chunked reading, partial line buffering, and Claude cache creation verified');
  } finally {
    fs.rmSync(tmpBase, { recursive: true, force: true });
  }

  console.log('\n=== [3] Testing scripts/install.mjs safety ===');
  const tmpPluginsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-ctx-install-test-'));
  try {
    const res1 = installPlugin({ pluginsDir: tmpPluginsDir, repoRoot: REPO_ROOT });
    assert.strictEqual(res1.status, 'installed');
    assert.strictEqual(fs.lstatSync(res1.targetLink).isSymbolicLink(), true);

    const res2 = installPlugin({ pluginsDir: tmpPluginsDir, repoRoot: REPO_ROOT });
    assert.strictEqual(res2.status, 'already-installed');

    const unRes = uninstallPlugin({ pluginsDir: tmpPluginsDir });
    assert.strictEqual(unRes.status, 'removed');
    assert.strictEqual(fs.existsSync(unRes.targetLink), false);

    // Real directory collision guard
    const realDir = path.join(tmpPluginsDir, 'context-meter');
    fs.mkdirSync(realDir, { recursive: true });
    fs.writeFileSync(path.join(realDir, 'keep.txt'), 'important');
    assert.throws(() => installPlugin({ pluginsDir: tmpPluginsDir, repoRoot: REPO_ROOT }), /Refusing to overwrite non-symlink/);
    assert.throws(() => uninstallPlugin({ pluginsDir: tmpPluginsDir }), /Refusing to remove non-symlink/);
    assert.strictEqual(fs.readFileSync(path.join(realDir, 'keep.txt'), 'utf8'), 'important');
    console.log('✓ Installer symlink lifecycle and non-symlink protection verified');
  } finally {
    fs.rmSync(tmpPluginsDir, { recursive: true, force: true });
  }

  console.log('\n🎉 ALL TESTS PASSED SUCCESSFULLY!');
}

runTests().catch((err) => {
  console.error('\n❌ Test failed:', err);
  process.exit(1);
});
