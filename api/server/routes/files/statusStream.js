const { logger } = require('@librechat/data-schemas');
const { statusBus } = require('~/server/services/Files/statusBus');

/**
 * Phase 2 — SSE handler for file-status updates.
 *
 * Subscribes to the in-process statusBus and forwards events to the client
 * as Server-Sent-Events. Events are scoped per-user via `event.userId`; an
 * optional `?conversationId=` query narrows down to a single conversation.
 *
 * Event shapes:
 *   - `event: status\ndata: { file_id, filename, conversationId, userId, path,
 *     state, reason?, chars?, chunks?, timestamp }\n\n`
 *   - `event: session_file\ndata: { conversationId, userId, session_file:
 *     { session_id, file_id, filename, generated_at }, timestamp }\n\n`
 *
 * Listener cleanup happens on `req.on('close')` — required to avoid leaking
 * listeners on the bus when clients disconnect (browser tab close,
 * EventSource.close()).
 *
 * Auth: relies on the parent router's `requireJwtAuth` middleware to populate
 * `req.user`. Defensive 401 if missing — never trust the absence of middleware.
 */
function statusStreamHandler(req, res) {
  const userId = req.user && req.user.id;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const filterConversationId =
    typeof req.query.conversationId === 'string' && req.query.conversationId.length > 0
      ? req.query.conversationId
      : null;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Initial comment line — flushes the response chain through any
  // intermediate buffer (nginx, browser) so EventSource.onopen fires.
  safeWrite(res, `: connected ${new Date().toISOString()}\n\n`);

  const matchesScope = (event) => {
    if (!event || event.userId !== userId) return false;
    if (filterConversationId == null) return true;
    // Allow events without conversationId (upload-time, before convo binding).
    if (event.conversationId == null) return true;
    return event.conversationId === filterConversationId;
  };

  const onStatus = (event) => {
    if (!matchesScope(event)) return;
    safeWrite(res, `event: status\ndata: ${JSON.stringify(event)}\n\n`);
  };

  const onSessionFile = (event) => {
    if (!matchesScope(event)) return;
    safeWrite(res, `event: session_file\ndata: ${JSON.stringify(event)}\n\n`);
  };

  statusBus.on('status', onStatus);
  statusBus.on('session_file', onSessionFile);

  const cleanup = () => {
    statusBus.off('status', onStatus);
    statusBus.off('session_file', onSessionFile);
  };
  req.on('close', cleanup);
  req.on('aborted', cleanup);
}

function safeWrite(res, chunk) {
  if (res.writableEnded) return;
  try {
    res.write(chunk);
    if (typeof res.flush === 'function') res.flush();
  } catch (err) {
    logger.warn(`[statusStream] write failed: ${err && err.message}`);
  }
}

module.exports = { statusStreamHandler };
