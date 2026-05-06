const { uploadVectors } = require('./crud');

/**
 * Library function: embed one file via rag-api `/embed`. Replaces the old
 * "auto-trigger on every text-bearing chat upload" pattern (cherry-picked
 * from feature/auto-rag-for-text-uploads, commit 0ed2673) — Phase 3 routing
 * gates this conditionally via routeFile().rag, so a fire-and-forget wrapper
 * that auto-fires is no longer the right shape.
 *
 * Throws on failure — the caller (ragPipeline.runRagPipeline) maps the
 * error into pathStatus.rag.{state:'failed', reason} + recordFilePathFailure.
 *
 * @param {object} params
 * @param {import('express').Request} params.req
 * @param {Express.Multer.File} params.file
 * @param {string} params.file_id
 * @param {string} [params.entity_id]
 * @param {object} [params.storageMetadata]
 * @returns {Promise<{ embedded: boolean, bytes?: number, filename?: string, filepath?: string, chunks?: number }>}
 */
async function embedToRag({ req, file, file_id, entity_id, storageMetadata }) {
  if (!process.env.RAG_API_URL) {
    throw new Error('RAG_API_URL not defined');
  }
  return uploadVectors({ req, file, file_id, entity_id, storageMetadata });
}

module.exports = { embedToRag };
