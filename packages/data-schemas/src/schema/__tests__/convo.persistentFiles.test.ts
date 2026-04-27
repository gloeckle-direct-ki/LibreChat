import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import convoSchema from '../convo';

describe('Convo schema — persistent_files', () => {
  let mongoServer: MongoMemoryServer;
  let Convo: mongoose.Model<unknown>;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
    Convo = mongoose.model('PersistentFilesTestConvo', convoSchema);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await Convo.deleteMany({});
  });

  it('persists persistent_files array on save+load', async () => {
    await Convo.create({
      conversationId: 'pf-test-1',
      user: 'user1',
      endpoint: 'openAI',
      persistent_files: [
        { file_id: 'f1', filename: 'vertrag.pdf', added_at: new Date() },
      ],
    });
    const loaded = await Convo.findOne({ conversationId: 'pf-test-1' }).lean<{
      persistent_files?: Array<{ file_id: string; filename: string; added_at: Date }>;
    }>();
    expect(loaded?.persistent_files).toHaveLength(1);
    expect(loaded?.persistent_files?.[0].filename).toBe('vertrag.pdf');
    expect(loaded?.persistent_files?.[0].file_id).toBe('f1');
  });

  it('defaults added_at when not provided', async () => {
    await Convo.create({
      conversationId: 'pf-test-2',
      user: 'user1',
      endpoint: 'openAI',
      persistent_files: [{ file_id: 'f2', filename: 'a.pdf' }],
    });
    const loaded = await Convo.findOne({ conversationId: 'pf-test-2' }).lean<{
      persistent_files?: Array<{ file_id: string; filename: string; added_at: Date }>;
    }>();
    expect(loaded?.persistent_files?.[0].added_at).toBeInstanceOf(Date);
  });

  it('returns empty array when no persistent_files set', async () => {
    await Convo.create({ conversationId: 'pf-test-3', user: 'user1', endpoint: 'openAI' });
    const loaded = await Convo.findOne({ conversationId: 'pf-test-3' }).lean<{
      persistent_files?: unknown[];
    }>();
    // Mongoose default for un-set arrays is an empty array (not undefined) when defined in schema.
    expect(Array.isArray(loaded?.persistent_files)).toBe(true);
    expect(loaded?.persistent_files).toHaveLength(0);
  });
});
