import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ANTIGRAVITY_BASE = path.join(os.homedir(), '.gemini', 'antigravity');

/**
 * Determine model context limit based on model identifier
 * @param {string} modelName
 * @returns {number}
 */
export function getModelContextLimit(modelName = '') {
  const m = String(modelName || '').toLowerCase();
  if (m.includes('claude')) return 200_000;
  if (m.includes('pro') && m.includes('gemini')) return 2_000_000;
  if (m.includes('gemini') || m.includes('flash')) return 1_000_000;
  if (m.includes('gpt-4o') || m.includes('gpt-4')) return 128_000;
  if (m.includes('o1') || m.includes('o3')) return 200_000;
  if (m.includes('deepseek')) return 128_000;
  if (m.includes('qwen') || m.includes('llama')) return 128_000;
  if (m.includes('mistral') || m.includes('codestral')) return 128_000;
  if (m.includes('grok')) return 128_000;
  return 1_000_000;
}

/**
 * Format token count into clean human readable shorthand (e.g. 542, 37K, 1M, 1.2M)
 * @param {number} count
 * @returns {string}
 */
export function formatTokenCount(count = 0) {
  if (typeof count !== 'number' || !Number.isFinite(count) || count <= 0) return '0';
  if (count >= 999_500) {
    const m = count / 1_000_000;
    const str = m >= 9.95 ? String(Math.round(m)) : m.toFixed(1);
    return str.replace('.0', '') + 'M';
  }
  if (count >= 1_000) {
    return Math.round(count / 1_000) + 'K';
  }
  return String(Math.round(count));
}

/**
 * Retrieve token usage from a conversation transcript file
 * @param {string} conversationId
 * @returns {object|null}
 */
export function readLastTokensFromTranscript(conversationId) {
  if (!conversationId) return null;

  const logDir = path.join(ANTIGRAVITY_BASE, 'brain', conversationId, '.system_generated', 'logs');
  const logFile = path.join(logDir, 'transcript.jsonl');
  const fullLog = path.join(logDir, 'transcript_full.jsonl');

  if (fs.existsSync(logFile)) {
    const res = readTokensFromLogPath(logFile);
    if (res) return res;
  }

  if (fs.existsSync(fullLog)) {
    return readTokensFromLogPath(fullLog);
  }

  return null;
}

/**
 * Scan backward in chunks to find the latest valid token entry.
 * Efficiently handles large tool outputs (> 64KB) following model responses.
 * @param {string} filePath
 * @param {number} [maxScanBytes=5242880] Max 5MB backward scan
 * @returns {object|null}
 */
export function readTokensFromLogPath(filePath, maxScanBytes = 5 * 1024 * 1024) {
  let fd;
  try {
    const stat = fs.statSync(filePath);
    if (!stat.size) return null;

    fd = fs.openSync(filePath, 'r');
    const chunkSize = 65536;
    let filePos = stat.size;
    let carryOver = '';
    let totalScanned = 0;

    while (filePos > 0 && totalScanned < maxScanBytes) {
      const readLen = Math.min(chunkSize, filePos);
      filePos -= readLen;
      totalScanned += readLen;

      const buf = Buffer.alloc(readLen);
      fs.readSync(fd, buf, 0, readLen, filePos);
      const chunkStr = buf.toString('utf8') + carryOver;
      const lines = chunkStr.split('\n');

      // The first segment may be incomplete unless at the beginning of the file
      carryOver = filePos === 0 ? '' : (lines.shift() || '');

      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim();
        if (!line) continue;
        if (!line.includes('tokens') && !line.includes('Tokens') && !line.includes('usage')) continue;
        const tokens = parseTokenLine(line);
        if (tokens) return tokens;
      }
    }

    if (carryOver.trim()) {
      const tokens = parseTokenLine(carryOver.trim());
      if (tokens) return tokens;
    }
  } catch {
    // Return null on I/O error
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch {}
    }
  }
  return null;
}

function parseTokenLine(line) {
  try {
    const parsed = JSON.parse(line);
    if (typeof parsed.input_tokens === 'number') {
      return {
        inputTokens: parsed.input_tokens || 0,
        cachedTokens: parsed.cache_read_tokens || 0,
        outputTokens: parsed.output_tokens || 0
      };
    }
    if (parsed.usage && typeof parsed.usage.input_tokens === 'number') {
      return {
        inputTokens: parsed.usage.input_tokens || 0,
        cachedTokens: parsed.usage.cache_read_tokens || parsed.usage.cache_read_input_tokens || 0,
        outputTokens: parsed.usage.output_tokens || 0
      };
    }
    if (typeof parsed.inputTokens === 'number') {
      return {
        inputTokens: parsed.inputTokens || 0,
        cachedTokens: parsed.cachedTokens || parsed.cacheReadTokens || 0,
        outputTokens: parsed.outputTokens || 0
      };
    }
  } catch {}
  return null;
}

/**
 * Construct data payload for UI rendering
 * @param {object} params
 * @param {string} params.conversationId
 * @param {string} params.modelName
 * @returns {object}
 */
export function buildUsagePayload({ conversationId, modelName = 'Gemini 3.8 Flash' }) {
  const model = modelName || 'Gemini 3.8 Flash';
  const tokens = readLastTokensFromTranscript(conversationId);
  const limit = getModelContextLimit(model);
  const limitStr = formatTokenCount(limit);

  if (!tokens) {
    return {
      conversationId: conversationId || null,
      percentStr: '0%',
      tokenStr: '0',
      dotColor: '#10b981',
      model,
      inputStr: '0',
      cachedStr: '0',
      outputStr: '0',
      contextStr: `0 / ${limitStr} (0%)`,
      hasTokens: false
    };
  }

  const { inputTokens, cachedTokens, outputTokens } = tokens;
  const contextUsed = inputTokens + cachedTokens;
  const ratio = contextUsed / limit;
  const percentNum = Math.round(ratio * 100);

  let percentStr = `${percentNum}%`;
  if (percentNum === 0 && contextUsed > 0) {
    percentStr = '< 1%';
  }

  const tokenStr = formatTokenCount(contextUsed);

  // Status color according to threshold
  let dotColor = '#10b981'; // Green (< 60%)
  if (ratio >= 0.85) {
    dotColor = '#ef4444'; // Red (>= 85%)
  } else if (ratio >= 0.6) {
    dotColor = '#f59e0b'; // Amber (60% - 85%)
  }

  return {
    conversationId: conversationId || null,
    percentStr,
    tokenStr,
    dotColor,
    model,
    inputStr: inputTokens.toLocaleString(),
    cachedStr: cachedTokens.toLocaleString(),
    outputStr: outputTokens.toLocaleString(),
    contextStr: `${tokenStr} / ${limitStr} (${percentStr})`,
    hasTokens: true
  };
}
