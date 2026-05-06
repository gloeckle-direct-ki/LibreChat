const { logger } = require('@librechat/data-schemas');
const { routeFile } = require('./routing');
const { extractInlineText } = require('./inlineExtract');

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
 * @param {{ path?: string, mimetype?: string, size?: number, originalname?: string }} file
 * @param {{ file_id?: string, filename?: string }} fileResult - the createFile result
 * @param {string} [conversationId] - usually undefined at upload time (FE
 *        omits it); required for telemetry-recording on failure since the
 *        FilePathFailure schema marks it required.
 * @returns {Promise<void>}
 */
async function runInlinePipeline(file, fileResult, conversationId) {
  if (!file || file.mimetype == null || file.size == null) return;
  if (!fileResult || !fileResult.file_id) return;

  const decision = routeFile({ mime: file.mimetype, size: file.size });
  if (!decision.inline) return;

  const file_id = fileResult.file_id;
  const filename = fileResult.filename || file.originalname;

  let extracted;
  try {
    extracted = await extractInlineText({ filepath: file.path, filename, file_id });
  } catch (err) {
    const reason = err && err.message ? err.message : String(err);
    logger.warn(`[runInlinePipeline] extract failed for ${file_id}: ${reason}`);
    await safeUpdateFile({
      file_id,
      'metadata.pathStatus.inline.state': 'failed',
      'metadata.pathStatus.inline.reason': reason,
      'metadata.pathStatus.inline.completed_at': new Date(),
    });
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

  await safeUpdateFile({
    file_id,
    'metadata.extracted_text': extracted.text,
    'metadata.pathStatus.inline.state': 'loaded',
    'metadata.pathStatus.inline.chars': extracted.chars,
    'metadata.pathStatus.inline.completed_at': new Date(),
  });
}

async function safeUpdateFile(data) {
  try {
    const { updateFile } = require('~/models/File');
    await updateFile(data);
  } catch (err) {
    logger.warn(
      `[runInlinePipeline] updateFile failed for ${data.file_id}: ${err && err.message}`,
    );
  }
}

module.exports = { runInlinePipeline };
