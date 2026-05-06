import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import convoSchema from '../convo';

describe('Convo schema — session_files', () => {
  let mongoServer: MongoMemoryServer;
  let Convo: mongoose.Model<unknown>;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
    Convo = mongoose.model('SessionFilesTestConvo', convoSchema);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await Convo.deleteMany({});
  });

  it('persists session_files array on save+load', async () => {
    await Convo.create({
      conversationId: 'sf-1',
      user: 'u1',
      endpoint: 'openAI',
      session_files: [
        {
          session_id: 'sess-A',
          file_id: 'extracted-dir',
          filename: 'auflage_ist_extracted',
          generated_at: new Date(),
        },
      ],
    });
    const loaded = await Convo.findOne({ conversationId: 'sf-1' }).lean<{
      session_files?: Array<{
        session_id: string;
        file_id: string;
        filename: string;
        generated_at: Date;
      }>;
    }>();
    expect(loaded?.session_files).toHaveLength(1);
    expect(loaded?.session_files?.[0].session_id).toBe('sess-A');
    expect(loaded?.session_files?.[0].filename).toBe('auflage_ist_extracted');
  });

  it('defaults generated_at when not provided', async () => {
    await Convo.create({
      conversationId: 'sf-2',
      user: 'u1',
      endpoint: 'openAI',
      session_files: [{ session_id: 'A', file_id: 'f', filename: 'g.csv' }],
    });
    const loaded = await Convo.findOne({ conversationId: 'sf-2' }).lean<{
      session_files?: Array<{ generated_at: Date }>;
    }>();
    expect(loaded?.session_files?.[0].generated_at).toBeInstanceOf(Date);
  });

  it('returns empty array when no session_files set', async () => {
    await Convo.create({ conversationId: 'sf-3', user: 'u1', endpoint: 'openAI' });
    const loaded = await Convo.findOne({ conversationId: 'sf-3' }).lean<{
      session_files?: unknown[];
    }>();
    expect(Array.isArray(loaded?.session_files)).toBe(true);
    expect(loaded?.session_files).toHaveLength(0);
  });
});
