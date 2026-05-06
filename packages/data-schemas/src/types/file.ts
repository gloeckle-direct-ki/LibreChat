import { Document, Types } from 'mongoose';

export interface IMongoFile extends Omit<Document, 'model'> {
  user: Types.ObjectId;
  conversationId?: string;
  file_id: string;
  temp_file_id?: string;
  bytes: number;
  text?: string;
  filename: string;
  filepath: string;
  object: 'file';
  embedded?: boolean;
  type: string;
  context?: string;
  usage: number;
  source: string;
  model?: string;
  width?: number;
  height?: number;
  metadata?: {
    fileIdentifier?: string;
    extracted_text?: string;
    pathStatus?: {
      inline?: { state?: string; chars?: number; reason?: string; completed_at?: Date };
      rag?: { state?: string; chunks?: number; reason?: string; completed_at?: Date };
      mount?: { state?: string; reason?: string; completed_at?: Date };
    };
  };
  expiresAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}
