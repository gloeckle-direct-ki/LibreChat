import mongoose, { Schema } from 'mongoose';
import { FileSources } from 'librechat-data-provider';
import type { IMongoFile } from '~/types';

const file: Schema<IMongoFile> = new Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      index: true,
      required: true,
    },
    conversationId: {
      type: String,
      ref: 'Conversation',
      index: true,
    },
    file_id: {
      type: String,
      index: true,
      required: true,
    },
    temp_file_id: {
      type: String,
    },
    bytes: {
      type: Number,
      required: true,
    },
    filename: {
      type: String,
      required: true,
    },
    filepath: {
      type: String,
      required: true,
    },
    object: {
      type: String,
      required: true,
      default: 'file',
    },
    embedded: {
      type: Boolean,
    },
    type: {
      type: String,
      required: true,
    },
    text: {
      type: String,
    },
    context: {
      type: String,
    },
    usage: {
      type: Number,
      required: true,
      default: 0,
    },
    source: {
      type: String,
      default: FileSources.local,
    },
    model: {
      type: String,
    },
    width: Number,
    height: Number,
    metadata: {
      fileIdentifier: String,
      // Phase-2-shape, introduced in Phase 3 for the inline/rag pipeline state
      // machine. Phase 2 will add SSE + UI on top, NOT a new schema.
      extracted_text: String,
      pathStatus: {
        inline: {
          state: String,
          chars: Number,
          reason: String,
          completed_at: Date,
          _id: false,
        },
        rag: {
          state: String,
          chunks: Number,
          reason: String,
          completed_at: Date,
          _id: false,
        },
        mount: {
          state: String,
          reason: String,
          completed_at: Date,
          _id: false,
        },
        _id: false,
      },
    },
    expiresAt: {
      type: Date,
      expires: 3600, // 1 hour in seconds
    },
  },
  {
    timestamps: true,
  },
);

file.index({ createdAt: 1, updatedAt: 1 });

export default file;
