import { Schema } from 'mongoose';

/**
 * Telemetry: every time the file pipeline cannot deliver a file via one of
 * the routing paths (mount, inline, rag), record a row here. Used as a
 * 95/05-tail observation source — Phase 1 only scaffolds the collection;
 * Phase 2/3 populate it as part of the pathStatus state machine.
 */
const filePathFailureSchema: Schema = new Schema({
  file_id: { type: String, required: true, index: true },
  conversationId: { type: String, required: true, index: true },
  path: {
    type: String,
    enum: ['mount', 'inline', 'rag'],
    required: true,
  },
  reason: { type: String, required: true },
  retry_count: { type: Number, default: 0 },
  timestamp: { type: Date, default: Date.now, index: true },
});

export default filePathFailureSchema;
