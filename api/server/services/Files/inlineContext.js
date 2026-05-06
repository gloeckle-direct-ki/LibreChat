const { logger } = require('@librechat/data-schemas');
const { Conversation, File } = require('~/db/models');

/**
 * Phase 3 Task 5 — builds the inline-file system-message block for a
 * conversation: collects every persistent_file whose inline-pipeline
 * extraction has completed (`metadata.pathStatus.inline.state === 'loaded'`)
 * and emits a sequence of
 *
 *   [Datei: <filename>]
 *   <extracted_text>
 *   [/Datei]
 *
 * blocks. The caller (loadAgentTools) injects this into `toolContextMap` so
 * the agent's run-graph picks it up via the existing system-message join.
 *
 * Best-effort: never throws. On lookup error returns ''.
 *
 * Hygiene: Conversation.findOne is scoped by user — same belt-and-suspenders
 * pattern as primeFiles() (Phase 1.6 I-3). Without the user filter, a
 * UUID-v4 conversationId from another tenant could leak inline blocks
 * cross-user.
 *
 * @param {{ user?: { id?: string } }} req
 * @param {string|undefined|null} conversationId
 * @returns {Promise<string>}
 */
async function buildInlineFileBlock(req, conversationId) {
  if (!conversationId) return '';

  let convo;
  try {
    convo = await Conversation.findOne(
      { conversationId, user: req?.user?.id },
      { persistent_files: 1 },
    ).lean();
  } catch (err) {
    logger.warn(`[buildInlineFileBlock] conversation lookup failed: ${err.message}`);
    return '';
  }

  const fileIds = (convo?.persistent_files ?? []).map((f) => f.file_id);
  if (fileIds.length === 0) return '';

  let files;
  try {
    files = await File.find(
      {
        file_id: { $in: fileIds },
        'metadata.pathStatus.inline.state': 'loaded',
      },
      { filename: 1, 'metadata.extracted_text': 1 },
    ).lean();
  } catch (err) {
    logger.warn(`[buildInlineFileBlock] File.find failed: ${err.message}`);
    return '';
  }

  const blocks = [];
  for (const f of files || []) {
    const text = f?.metadata?.extracted_text;
    if (typeof text !== 'string' || text.length === 0) continue;
    blocks.push(`[Datei: ${f.filename}]\n${text}\n[/Datei]`);
  }
  return blocks.join('\n\n');
}

module.exports = { buildInlineFileBlock };
