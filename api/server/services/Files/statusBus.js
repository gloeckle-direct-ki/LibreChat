const EventEmitter = require('events');

/**
 * Phase 2 — In-process pub/sub for file-status SSE.
 *
 * Two event channels:
 *   - 'status'        — per-file pathStatus updates (mount/inline/rag).
 *                       payload shape: { file_id, filename, conversationId,
 *                       userId, path, state, reason?, chars?, chunks?,
 *                       timestamp }
 *   - 'session_file'  — conversation-level session_files updates (Track 2).
 *                       payload shape: { conversationId, userId, session_file:
 *                       { session_id, file_id, filename, generated_at },
 *                       timestamp }
 *
 * Subscribers (statusStream route handler) filter by userId and optionally
 * conversationId — the bus is a fan-out, not an authz layer.
 *
 * Single instance per Node process; sized for ~100 concurrent SSE clients.
 */
const statusBus = new EventEmitter();
statusBus.setMaxListeners(100);

function emitStatusUpdate(event) {
  statusBus.emit('status', event);
}

function emitSessionFileUpdate(event) {
  statusBus.emit('session_file', event);
}

module.exports = { statusBus, emitStatusUpdate, emitSessionFileUpdate };
