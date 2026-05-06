const { logger } = require('@librechat/data-schemas');
const { File } = require('~/db/models');
const { emitStatusUpdate } = require('./statusBus');

const TERMINAL_STATES = new Set(['ready', 'loaded', 'embedded', 'failed', 'skipped']);

/**
 * Phase 2 — write a per-path state to `metadata.pathStatus.<path>` on the
 * File doc and broadcast the change on the SSE bus.
 *
 * Used by Phase-3 pipelines (inlinePipeline, ragPipeline) and processCodeOutput
 * to record routing outcomes. Replaces the raw dotted-key `safeUpdateFile`
 * pattern from Phase 3 — same on-disk shape, plus a bus emit so the chip-UI
 * reflects state changes live.
 *
 * Best-effort: never throws — the upload path must not break if SSE emit
 * fails or the file row vanishes between write and lookup.
 *
 * @param {string} file_id
 * @param {'inline'|'rag'|'mount'} path
 * @param {object} payload
 * @param {'pending'|'ready'|'loaded'|'embedded'|'failed'|'skipped'} payload.state
 * @param {string} [payload.reason]
 * @param {number} [payload.chars]
 * @param {number} [payload.chunks]
 */
async function updatePathStatus(file_id, path, { state, reason, chars, chunks }) {
  if (!file_id || !path || !state) return;

  const prefix = `metadata.pathStatus.${path}`;
  const set = { [`${prefix}.state`]: state };
  if (reason !== undefined && reason !== null) set[`${prefix}.reason`] = reason;
  if (TERMINAL_STATES.has(state)) set[`${prefix}.completed_at`] = new Date();
  if (chars !== undefined) set[`${prefix}.chars`] = chars;
  if (chunks !== undefined) set[`${prefix}.chunks`] = chunks;

  let result;
  try {
    result = await File.updateOne({ file_id }, { $set: set, $unset: { expiresAt: '' } });
  } catch (err) {
    logger.warn(`[updatePathStatus] write failed for ${file_id}/${path}: ${err && err.message}`);
    return;
  }

  if (!result || result.matchedCount === 0) return;

  try {
    const file = await File.findOne(
      { file_id },
      { user: 1, conversationId: 1, filename: 1 },
    ).lean();
    if (!file) return;
    emitStatusUpdate({
      file_id,
      filename: file.filename,
      conversationId: file.conversationId,
      userId: file.user ? String(file.user) : undefined,
      path,
      state,
      ...(reason !== undefined && reason !== null ? { reason } : {}),
      ...(chars !== undefined ? { chars } : {}),
      ...(chunks !== undefined ? { chunks } : {}),
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.warn(`[updatePathStatus] emit failed for ${file_id}/${path}: ${err && err.message}`);
  }
}

module.exports = { updatePathStatus };
