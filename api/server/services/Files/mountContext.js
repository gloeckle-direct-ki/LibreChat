const { logger } = require('@librechat/data-schemas');
const { Conversation } = require('~/db/models');

/**
 * Phase 3 Task 6 — pre-populates `tool_resources.execute_code.file_ids` with
 * the conversation's persistent_files (Vector A) before the agent's tool
 * loader runs.
 *
 * Why prefill instead of relying on primeFiles alone? primeFiles already
 * unions persistent_files with agent resources internally (Phase 1.6), but
 * the union happens deep inside the execute_code tool path. Any code that
 * inspects `tool_resources.execute_code.file_ids` *upstream* of primeFiles
 * (custom-provider agent paths, future caching/dedup layers) would see only
 * the agent-attached resources without this prefill.
 *
 * Scope:
 *   - Vector A only — persistent_files (user-uploaded files).
 *   - Vector B (session_files, /exec-output persistence) is Track 2's
 *     territory and is unioned downstream by primeFiles itself. We do NOT
 *     write session_files here, to keep the layering clean.
 *
 * Best-effort: never throws. Mutates and returns the provided
 * tool_resources (creates a new object if `undefined` is passed). Scopes
 * Conversation.findOne by user — Phase 1.6 hygiene.
 *
 * @param {{ user?: { id?: string } }} req
 * @param {string|undefined|null} conversationId
 * @param {object|undefined} tool_resources
 * @returns {Promise<object>}
 */
async function prefillMountFileIds(req, conversationId, tool_resources) {
  const tr = tool_resources || {};
  if (!conversationId) return tr;

  let convo;
  try {
    convo = await Conversation.findOne(
      { conversationId, user: req?.user?.id },
      { persistent_files: 1 },
    ).lean();
  } catch (err) {
    logger.warn(`[prefillMountFileIds] conversation lookup failed: ${err.message}`);
    return tr;
  }

  const persistentIds = (convo?.persistent_files ?? []).map((f) => f.file_id).filter(Boolean);
  if (persistentIds.length === 0) return tr;

  if (!tr.execute_code) tr.execute_code = {};
  const existing = Array.isArray(tr.execute_code.file_ids) ? tr.execute_code.file_ids : [];
  tr.execute_code.file_ids = [...new Set([...existing, ...persistentIds])];

  return tr;
}

module.exports = { prefillMountFileIds };
