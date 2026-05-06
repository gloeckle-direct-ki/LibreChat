const { logger } = require('@librechat/data-schemas');
const { routeFile } = require('./routing');
const { extractInlineText } = require('./inlineExtract');
const { emitStatusUpdate } = require('./statusBus');

/**
 * Phase 3 Task 3 — runs the inline pipeline for one freshly uploaded file.
 *
 * Decides via routeFile() whether the file is small + text-bearing, and if
 * so extracts the text and caches it on the File doc as
 * `metadata.extracted_text` + `metadata.pathStatus.inline.{state, chars,
 * completed_at}`. On failure: writes pathStatus.inline.{state:'failed',
 * reason} and (when conversationId is known) records to FilePathFailure.
 *
 * Best-effort: never throws. Storage / mount / agent-resource registration
 * has already happened by the time we run; this is a separate caching step
 * whose absence must not break the upload.
 *
 * @param {import('express').Request} req - needed to generate the short-lived
 *        JWT for rag-api `/text` (mirrors uploadVectors pattern). Without `req`
 *        the call falls back to no-Authorization, which prod rag-api rejects 401.
 * @param {{ path?: string, mimetype?: string, size?: number, originalname?: string }} file
 * @param {{ file_id?: string, filename?: string }} fileResult - the createFile result
 * @param {string} [conversationId] - usually undefined at upload time (FE
 *        omits it); required for telemetry-recording on failure since the
 *        FilePathFailure schema marks it required.
 * @returns {Promise<void>}
 */
async function runInlinePipeline(req, file, fileResult, conversationId) {
  if (!file || file.mimetype == null || file.size == null) return;
  if (!fileResult || !fileResult.file_id) return;

  const decision = routeFile({ mime: file.mimetype, size: file.size });
  if (!decision.inline) return;

  const file_id = fileResult.file_id;
  const filename = fileResult.filename || file.originalname;

  let extracted;
  try {
    extracted = await extractInlineText({
      filepath: file.path,
      filename,
      file_id,
      userId: req?.user?.id,
    });
  } catch (err) {
    const reason = err && err.message ? err.message : String(err);
    logger.warn(`[runInlinePipeline] extract failed for ${file_id}: ${reason}`);
    const persisted = await safeUpdateFile({
      file_id,
      'metadata.pathStatus.inline.state': 'failed',
      'metadata.pathStatus.inline.reason': reason,
      'metadata.pathStatus.inline.completed_at': new Date(),
    });
    if (persisted) {
      safeEmit({
        file_id,
        filename,
        conversationId,
        userId: req && req.user && req.user.id,
        path: 'inline',
        state: 'failed',
        reason,
      });
    }
    if (conversationId) {
      try {
        const { recordFilePathFailure } = require('~/models/FilePathFailure');
        await recordFilePathFailure({
          file_id,
          conversationId,
          path: 'inline',
          reason,
        });
      } catch (telemetryErr) {
        logger.warn(
          `[runInlinePipeline] failed to record telemetry: ${
            telemetryErr && telemetryErr.message
          }`,
        );
      }
    }
    return;
  }

  const persisted = await safeUpdateFile({
    file_id,
    'metadata.extracted_text': extracted.text,
    'metadata.pathStatus.inline.state': 'loaded',
    'metadata.pathStatus.inline.chars': extracted.chars,
    'metadata.pathStatus.inline.completed_at': new Date(),
  });
  if (persisted) {
    safeEmit({
      file_id,
      filename,
      conversationId,
      userId: req && req.user && req.user.id,
      path: 'inline',
      state: 'loaded',
      chars: extracted.chars,
    });
  }
}

function safeEmit(event) {
  try {
    emitStatusUpdate({ ...event, timestamp: new Date().toISOString() });
  } catch (err) {
    logger.warn(`[runInlinePipeline] emit failed: ${err && err.message}`);
  }
}

// Returns the updated File doc on success, or null when the row does not
// exist or the write failed. Callers gate `safeEmit` on the truthy result so
// we never broadcast a state change the DB doesn't reflect (Codex review F3).
async function safeUpdateFile(data) {
  try {
    const { updateFile } = require('~/models/File');
    return (await updateFile(data)) || null;
  } catch (err) {
    logger.warn(
      `[runInlinePipeline] updateFile failed for ${data.file_id}: ${err && err.message}`,
    );
    return null;
  }
}

module.exports = { runInlinePipeline };
