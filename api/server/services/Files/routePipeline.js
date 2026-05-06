const { EToolResources } = require('librechat-data-provider');
const { runInlinePipeline } = require('./inlinePipeline');
const { runRagPipeline } = require('./ragPipeline');

/**
 * Phase-3 file-routing gate.
 *
 * Skips when:
 *   - FILE_ROUTING_V2 is not 'true' (legacy auto-RAG path stays in charge), or
 *   - tool_resource === file_search (existing uploadVectors flow already
 *     embeds the file; running runRagPipeline here would duplicate vectors).
 *
 * @param {object} params
 * @param {object} params.req
 * @param {object} params.file
 * @param {object} params.result
 * @param {string} [params.conversationId]
 * @param {string} [params.tool_resource]
 * @param {string} [params.entity_id]
 */
async function maybeRunV2Pipeline({ req, file, result, conversationId, tool_resource, entity_id }) {
  if (process.env.FILE_ROUTING_V2 !== 'true') {
    return;
  }
  if (tool_resource === EToolResources.file_search) {
    return;
  }
  await runInlinePipeline(file, result, conversationId);
  await runRagPipeline(req, file, result, conversationId, entity_id);
}

module.exports = { maybeRunV2Pipeline };
