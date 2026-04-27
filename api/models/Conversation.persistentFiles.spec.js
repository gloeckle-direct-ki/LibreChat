const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongoServer;
let Conversation;
let addPersistentFile;

describe('addPersistentFile', () => {
  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
    ({ Conversation } = require('~/db/models'));
    ({ addPersistentFile } = require('./Conversation'));
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await Conversation.deleteMany({});
  });

  it('appends a new file to persistent_files', async () => {
    await Conversation.create({
      conversationId: 'c1',
      user: 'u1',
      endpoint: 'openAI',
    });
    await addPersistentFile('c1', { file_id: 'f1', filename: 'a.pdf' });
    const c = await Conversation.findOne({ conversationId: 'c1' }).lean();
    expect(c.persistent_files).toHaveLength(1);
    expect(c.persistent_files[0].file_id).toBe('f1');
    expect(c.persistent_files[0].filename).toBe('a.pdf');
    expect(c.persistent_files[0].added_at).toBeInstanceOf(Date);
  });

  it('does not duplicate the same file_id on repeated calls', async () => {
    await Conversation.create({
      conversationId: 'c2',
      user: 'u1',
      endpoint: 'openAI',
    });
    await addPersistentFile('c2', { file_id: 'f1', filename: 'a.pdf' });
    await addPersistentFile('c2', { file_id: 'f1', filename: 'a.pdf' });
    await addPersistentFile('c2', { file_id: 'f1', filename: 'a-renamed.pdf' });
    const c = await Conversation.findOne({ conversationId: 'c2' }).lean();
    expect(c.persistent_files).toHaveLength(1);
    expect(c.persistent_files[0].file_id).toBe('f1');
    // First write wins on the filename — important for traceability
    expect(c.persistent_files[0].filename).toBe('a.pdf');
  });

  it('handles concurrent calls with distinct file_ids atomically', async () => {
    await Conversation.create({
      conversationId: 'c3',
      user: 'u1',
      endpoint: 'openAI',
    });
    await Promise.all([
      addPersistentFile('c3', { file_id: 'f1', filename: 'a.pdf' }),
      addPersistentFile('c3', { file_id: 'f2', filename: 'b.pdf' }),
      addPersistentFile('c3', { file_id: 'f3', filename: 'c.pdf' }),
    ]);
    const c = await Conversation.findOne({ conversationId: 'c3' }).lean();
    expect(c.persistent_files).toHaveLength(3);
    const ids = c.persistent_files.map((f) => f.file_id).sort();
    expect(ids).toEqual(['f1', 'f2', 'f3']);
  });

  it('is a no-op when the conversation does not exist', async () => {
    const result = await addPersistentFile('nonexistent', {
      file_id: 'f1',
      filename: 'a.pdf',
    });
    expect(result.matchedCount).toBe(0);
    expect(result.modifiedCount).toBe(0);
  });
});
