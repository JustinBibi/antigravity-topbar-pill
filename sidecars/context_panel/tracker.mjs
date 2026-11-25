import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const DEFAULT_BASE_DIR = process.env.ANTIGRAVITY_APP_DATA_DIR || path.join(os.homedir(), '.gemini', 'antigravity');
const CONV_ID_RE = /^[a-zA-Z0-9_-]+$/;
const MAX_HISTORY_TURNS = 40;
const MAX_CACHE_ENTRIES = 32;
const CHUNK_SIZE = 65536;

const transcriptCache = new Map();

/**
 * Clear in-memory incremental transcript cache (useful for tests)
 */
export function clearTranscriptCache() {
  transcriptCache.clear();
}

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
 * Format raw model slug (e.g. "gemini-4-neon-medium") into a readable label
 * @param {string} rawModel
 * @returns {string}
 */
export function formatModelName(rawModel = '') {
  const trimmed = String(rawModel || '').trim();
  if (!trimmed) return 'Unknown Model';
  if (trimmed.includes(' ')) return trimmed;
  return trimmed
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => (/^\d/.test(part) ? part : part[0].toUpperCase() + part.slice(1)))
    .join(' ');
}

/**
 * Format token count into clean human-readable shorthand (e.g. 542, 37K, 1M, 1.3M)
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
 * Validate a conversation identifier to prevent path traversal
 * @param {string} conversationId
 * @returns {boolean}
 */
export function isValidConversationId(conversationId) {
  return typeof conversationId === 'string' && CONV_ID_RE.test(conversationId);
}

/**
 * Resolve the active transcript path and file signature for change detection
 * @param {string} conversationId
 * @param {string} [baseDir]
 * @returns {{ filePath: string, etag: string }|null}
 */
export function resolveTranscriptFile(conversationId, baseDir = DEFAULT_BASE_DIR) {
  if (!isValidConversationId(conversationId)) return null;
  const logDir = path.join(baseDir, 'brain', conversationId, '.system_generated', 'logs');
  const candidates = [
    path.join(logDir, 'transcript.jsonl'),
    path.join(logDir, 'transcript_full.jsonl')
  ];

  for (const filePath of candidates) {
    try {
      const stat = fs.statSync(filePath);
      if (stat.size > 0) {
        return { filePath, etag: `${stat.size}:${Math.floor(stat.mtimeMs)}` };
      }
    } catch {}
  }
  return null;
}

function parseTokenEntry(line) {
  try {
    const parsed = JSON.parse(line);
    let inputTokens = null;
    let cachedTokens = 0;
    let cacheCreationTokens = 0;
    let outputTokens = 0;

    if (typeof parsed.input_tokens === 'number') {
      inputTokens = parsed.input_tokens;
      cachedTokens = parsed.cache_read_tokens || parsed.cache_read_input_tokens || 0;
      cacheCreationTokens = parsed.cache_creation_tokens || parsed.cache_creation_input_tokens || 0;
      outputTokens = parsed.output_tokens || 0;
    } else if (parsed.usage && typeof parsed.usage.input_tokens === 'number') {
      inputTokens = parsed.usage.input_tokens;
      cachedTokens = parsed.usage.cache_read_tokens || parsed.usage.cache_read_input_tokens || 0;
      cacheCreationTokens = parsed.usage.cache_creation_tokens || parsed.usage.cache_creation_input_tokens || 0;
      outputTokens = parsed.usage.output_tokens || 0;
    } else if (typeof parsed.inputTokens === 'number') {
      inputTokens = parsed.inputTokens;
      cachedTokens = parsed.cachedTokens || parsed.cacheReadTokens || 0;
      cacheCreationTokens = parsed.cacheCreationTokens || 0;
      outputTokens = parsed.outputTokens || 0;
    }

    if (inputTokens === null) return null;

    return {
      stepIndex: typeof parsed.step_index === 'number' ? parsed.step_index : null,
      createdAt: parsed.created_at || null,
      model: parsed.model || parsed.usage?.model || null,
      inputTokens,
      cachedTokens,
      cacheCreationTokens,
      outputTokens,
      contextUsed: inputTokens + cachedTokens + cacheCreationTokens
    };
  } catch {
    return null;
  }
}

function isCompleteJsonLine(line) {
  try {
    JSON.parse(line);
    return true;
  } catch {
    return false;
  }
}

function processTranscriptLine(line, state, maxTurns) {
  if (!line) return;
  if (!line.includes('tokens') && !line.includes('Tokens') && !line.includes('usage')) return;
  const entry = parseTokenEntry(line);
  if (!entry) return;

  state.totalTurns += 1;
  state.totalOutput += entry.outputTokens;
  if (entry.model) state.latestModel = entry.model;

  const delta = state.lastContextUsed === null
    ? entry.contextUsed
    : entry.contextUsed - state.lastContextUsed;
  state.lastContextUsed = entry.contextUsed;

  state.recentTurns.push({
    turn: state.totalTurns,
    stepIndex: entry.stepIndex,
    createdAt: entry.createdAt,
    model: entry.model,
    inputTokens: entry.inputTokens,
    cachedTokens: entry.cachedTokens,
    cacheCreationTokens: entry.cacheCreationTokens,
    outputTokens: entry.outputTokens,
    contextUsed: entry.contextUsed,
    delta
  });

  if (state.recentTurns.length > maxTurns) {
    state.recentTurns.shift();
  }
}

function consumeAppendedChunks(filePath, startOffset, endOffset, state, maxTurns) {
  let fd;
  let pos = startOffset;
  let carryBuf = Buffer.alloc(0);

  try {
    fd = fs.openSync(filePath, 'r');
    while (pos < endOffset) {
      const readLen = Math.min(CHUNK_SIZE, endOffset - pos);
      const chunk = Buffer.allocUnsafe(readLen);
      const bytesRead = fs.readSync(fd, chunk, 0, readLen, pos);
      if (bytesRead <= 0) break;

      pos += bytesRead;
      const slice = bytesRead === readLen ? chunk : chunk.subarray(0, bytesRead);
      const combined = carryBuf.length ? Buffer.concat([carryBuf, slice]) : slice;

      let lineStart = 0;
      let nlIdx = combined.indexOf(0x0a, lineStart);
      while (nlIdx !== -1) {
        const line = combined.subarray(lineStart, nlIdx).toString('utf8').trim();
        processTranscriptLine(line, state, maxTurns);
        lineStart = nlIdx + 1;
        nlIdx = combined.indexOf(0x0a, lineStart);
      }
      carryBuf = combined.subarray(lineStart);
    }
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch {}
    }
  }

  if (carryBuf.length === 0) {
    state.byteOffset = pos;
    return;
  }

  const trailing = carryBuf.toString('utf8').trim();
  if (!trailing) {
    state.byteOffset = pos;
  } else if (isCompleteJsonLine(trailing)) {
    processTranscriptLine(trailing, state, maxTurns);
    state.byteOffset = pos;
  } else {
    state.byteOffset = pos - carryBuf.length;
  }
}

/**
 * Incrementally scan a transcript JSONL file and return full-session totals plus recent turns
 * @param {string} filePath
 * @param {number} [maxTurns=MAX_HISTORY_TURNS]
 * @returns {{ totalTurns: number, totalOutput: number, latestModel: string|null, turns: Array<object> }}
 */
export function readUsageSummaryFromLogPath(filePath, maxTurns = MAX_HISTORY_TURNS) {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.size) {
      transcriptCache.delete(filePath);
      return { totalTurns: 0, totalOutput: 0, latestModel: null, turns: [] };
    }

    let state = transcriptCache.get(filePath);
    const shouldReset = !state || state.ino !== stat.ino || stat.size < state.byteOffset || state.maxTurns !== maxTurns;
    if (shouldReset) {
      state = {
        ino: stat.ino,
        maxTurns,
        byteOffset: 0,
        totalTurns: 0,
        totalOutput: 0,
        lastContextUsed: null,
        latestModel: null,
        recentTurns: []
      };
    }

    if (stat.size > state.byteOffset) {
      consumeAppendedChunks(filePath, state.byteOffset, stat.size, state, maxTurns);
    }

    if (!transcriptCache.has(filePath) && transcriptCache.size >= MAX_CACHE_ENTRIES) {
      const oldestKey = transcriptCache.keys().next().value;
      transcriptCache.delete(oldestKey);
    }
    transcriptCache.set(filePath, state);

    return {
      totalTurns: state.totalTurns,
      totalOutput: state.totalOutput,
      latestModel: state.latestModel,
      turns: state.recentTurns.slice()
    };
  } catch {
    return { totalTurns: 0, totalOutput: 0, latestModel: null, turns: [] };
  }
}

/**
 * Scan a transcript JSONL file and extract recent per-turn token usage history
 * @param {string} filePath
 * @param {number} [maxTurns=MAX_HISTORY_TURNS]
 * @returns {Array<object>}
 */
export function readUsageHistoryFromLogPath(filePath, maxTurns = MAX_HISTORY_TURNS) {
  return readUsageSummaryFromLogPath(filePath, maxTurns).turns;
}

function resolveHealthStatus(ratio) {
  if (ratio >= 0.85) return { level: 'critical', color: '#ef4444', label: 'Critical' };
  if (ratio >= 0.6) return { level: 'warning', color: '#f59e0b', label: 'Elevated' };
  return { level: 'healthy', color: '#10b981', label: 'Healthy' };
}

function formatUsageMetrics(latest, totalOutput) {
  return {
    inputTokens: latest.inputTokens,
    cachedTokens: latest.cachedTokens,
    cacheCreationTokens: latest.cacheCreationTokens || 0,
    outputTokens: latest.outputTokens,
    inputStr: latest.inputTokens.toLocaleString(),
    cachedStr: latest.cachedTokens.toLocaleString(),
    outputStr: latest.outputTokens.toLocaleString(),
    totalOutputStr: totalOutput.toLocaleString()
  };
}

/**
 * Build complete token usage payload for the Context Meter UI panel
 * @param {object} params
 * @param {string} params.conversationId
 * @param {string} [params.baseDir]
 * @param {string} [params.clientEtag]
 * @returns {object}
 */
export function buildConversationUsage({
  conversationId,
  baseDir = DEFAULT_BASE_DIR,
  clientEtag = ''
} = {}) {
  const fileInfo = resolveTranscriptFile(conversationId, baseDir);
  if (!fileInfo) return createEmptyPayload(conversationId);

  if (clientEtag && clientEtag === fileInfo.etag) {
    return { conversationId, unchanged: true, etag: fileInfo.etag };
  }

  const summary = readUsageSummaryFromLogPath(fileInfo.filePath);
  if (!summary.turns.length) return createEmptyPayload(conversationId, fileInfo.etag);

  const latest = summary.turns[summary.turns.length - 1];
  const rawModel = latest.model || summary.latestModel || 'Gemini';
  const model = formatModelName(rawModel);
  const limit = getModelContextLimit(model);
  const contextUsed = latest.contextUsed;
  const remaining = Math.max(0, limit - contextUsed);
  const ratio = limit > 0 ? contextUsed / limit : 0;
  const percentNum = Math.min(100, Math.round(ratio * 100));
  const percentStr = percentNum === 0 && contextUsed > 0 ? '< 1%' : `${percentNum}%`;
  const cacheHitRate = contextUsed > 0 ? Math.round((latest.cachedTokens / contextUsed) * 100) : 0;

  return {
    conversationId,
    etag: fileInfo.etag,
    hasTokens: true,
    model,
    rawModel,
    limit,
    limitStr: formatTokenCount(limit),
    contextUsed,
    tokenStr: formatTokenCount(contextUsed),
    remaining,
    remainingStr: formatTokenCount(remaining),
    percentNum,
    percentStr,
    ratio: Number(ratio.toFixed(4)),
    cacheHitRate,
    health: resolveHealthStatus(ratio),
    latest: formatUsageMetrics(latest, summary.totalOutput),
    turnCount: summary.totalTurns,
    history: summary.turns.map((item) => ({
      turn: item.turn,
      stepIndex: item.stepIndex,
      contextUsed: item.contextUsed,
      inputTokens: item.inputTokens,
      cachedTokens: item.cachedTokens,
      cacheCreationTokens: item.cacheCreationTokens || 0,
      outputTokens: item.outputTokens,
      delta: item.delta
    }))
  };
}

function createEmptyPayload(conversationId, etag = '') {
  return {
    conversationId: conversationId || null,
    etag,
    hasTokens: false,
    model: 'Waiting for response...',
    rawModel: null,
    limit: 1_000_000,
    limitStr: '1M',
    contextUsed: 0,
    tokenStr: '0',
    remaining: 1_000_000,
    remainingStr: '1M',
    percentNum: 0,
    percentStr: '0%',
    ratio: 0,
    cacheHitRate: 0,
    health: resolveHealthStatus(0),
    latest: {
      inputTokens: 0,
      cachedTokens: 0,
      cacheCreationTokens: 0,
      outputTokens: 0,
      inputStr: '0',
      cachedStr: '0',
      outputStr: '0',
      totalOutputStr: '0'
    },
    turnCount: 0,
    history: []
  };
}
