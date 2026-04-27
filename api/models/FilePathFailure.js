const { logger } = require('@librechat/data-schemas');
const { FilePathFailure } = require('~/db/models');

/**
 * Records a failure of one of the routing paths (mount, inline, rag) for a
 * specific file in a conversation. Empty in P1 (the schema/model are wired
 * but no caller writes to it yet); P2/P3 will populate this as part of the
 * pathStatus state machine. The collection lets us see common failure modes
 * once we have prod data — which is the whole point of the 95/05 telemetry
 * loop in the design doc.
 *
 * Errors are logged but never thrown — telemetry is best-effort.
 *
 * @param {Object} entry
 * @param {string} entry.file_id
 * @param {string} entry.conversationId
 * @param {'mount'|'inline'|'rag'} entry.path
 * @param {string} entry.reason
 * @param {number} [entry.retry_count=0]
 * @returns {Promise<void>}
 */
const recordFilePathFailure = async ({
  file_id,
  conversationId,
  path,
  reason,
  retry_count = 0,
}) => {
  try {
    await FilePathFailure.create({
      file_id,
      conversationId,
      path,
      reason,
      retry_count,
    });
  } catch (err) {
    logger.warn(`[recordFilePathFailure] failed to record: ${err.message}`);
  }
};

module.exports = { recordFilePathFailure };
