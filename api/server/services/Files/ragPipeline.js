const { logger } = require('@librechat/data-schemas');
const { routeFile } = require('./routing');
const { embedToRag } = require('./VectorDB/embedToRag');
const { emitStatusUpdate } = require('./statusBus');

/**
 * Phase 3 Task 4 — runs the RAG pipeline for one freshly uploaded file.
 *
 * Decides via routeFile() whether the file is large + text-bearing (>= 20 KB),
 * and if so embeds it via rag-api `/embed`. Writes pathStatus.rag.{state,
 * chunks, reason, completed_at} on the File doc. On failure: writes
 * pathStatus.rag.{state:'failed', reason} and (when conversationId is
 * known) records to FilePathFailure.
 *
 * Best-effort: never throws. Storage / mount / agent-resource registration
 * has already happened by the time we run.
 *
 * Replaces the old "auto-trigger embed every text-bearing chat upload"
 * pattern (cherry-picked from feature/auto-rag-for-text-uploads, commit
 * 0ed2673). The auto-trigger fired for *every* text-bearing upload — we
 * now gate on size >= INLINE_THRESHOLD so small files take the inline
 * path instead.
 *
 * @param {object} req - Express request (uploadVectors needs req.user.id)
 * @param {{ path?: string, mimetype?: string, size?: number, originalname?: string }} file
 * @param {{ file_id?: string, filename?: string }} fileResult
 * @param {string} [conversationId]
 * @param {string} [entity_id]
 * @returns {Promise<void>}
 */
async function runRagPipeline(req, file, fileResult, conversationId, entity_id) {
  if (!file || file.mimetype == null || file.size == null) return;
  if (!fileResult || !fileResult.file_id) return;

  const decision = routeFile({ mime: file.mimetype, size: file.size });
  if (!decision.rag) return;

  const file_id = fileResult.file_id;

  let result;
  try {
    result = await embedToRag({ req, file, file_id, entity_id });
  } catch (err) {
    const reason = err && err.message ? err.message : String(err);
    logger.warn(`[runRagPipeline] embed failed for ${file_id}: ${reason}`);
    await safeUpdateFile({
      file_id,
      'metadata.pathStatus.rag.state': 'failed',
      'metadata.pathStatus.rag.reason': reason,
      'metadata.pathStatus.rag.completed_at': new Date(),
    });
    safeEmit({
      file_id,
      filename: fileResult.filename,
      conversationId,
      userId: req && req.user && req.user.id,
      path: 'rag',
      state: 'failed',
      reason,
    });
    if (conversationId) {
      try {
        const { recordFilePathFailure } = require('~/models/FilePathFailure');
        await recordFilePathFailure({
          file_id,
          conversationId,
          path: 'rag',
          reason,
        });
      } catch (telemetryErr) {
        logger.warn(
          `[runRagPipeline] failed to record telemetry: ${
            telemetryErr && telemetryErr.message
          }`,
        );
      }
    }
    return;
  }

  const update = {
    file_id,
    'metadata.pathStatus.rag.state': result && result.embedded ? 'embedded' : 'failed',
    'metadata.pathStatus.rag.completed_at': new Date(),
    embedded: Boolean(result && result.embedded),
  };
  if (result && typeof result.chunks === 'number') {
    update['metadata.pathStatus.rag.chunks'] = result.chunks;
  }
  if (!(result && result.embedded)) {
    update['metadata.pathStatus.rag.reason'] =
      'rag-api returned embedded=false (unsupported MIME or known_type=false)';
  }
  await safeUpdateFile(update);

  const emitState = result && result.embedded ? 'embedded' : 'failed';
  safeEmit({
    file_id,
    filename: fileResult.filename,
    conversationId,
    userId: req && req.user && req.user.id,
    path: 'rag',
    state: emitState,
    ...(typeof (result && result.chunks) === 'number' ? { chunks: result.chunks } : {}),
    ...(emitState === 'failed'
      ? {
          reason: 'rag-api returned embedded=false (unsupported MIME or known_type=false)',
        }
      : {}),
  });
}

function safeEmit(event) {
  try {
    emitStatusUpdate({ ...event, timestamp: new Date().toISOString() });
  } catch (err) {
    logger.warn(`[runRagPipeline] emit failed: ${err && err.message}`);
  }
}

async function safeUpdateFile(data) {
  try {
    const { updateFile } = require('~/models/File');
    await updateFile(data);
  } catch (err) {
    logger.warn(
      `[runRagPipeline] updateFile failed for ${data.file_id}: ${err && err.message}`,
    );
  }
}

module.exports = { runRagPipeline };
