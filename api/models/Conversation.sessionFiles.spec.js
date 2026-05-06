const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongoServer;
let Conversation;
let registerSessionFile;

describe('registerSessionFile', () => {
  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
    ({ Conversation } = require('~/db/models'));
    ({ registerSessionFile } = require('./Conversation'));
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await Conversation.deleteMany({});
  });

  const seedConvo = (cid) =>
    Conversation.create({ conversationId: cid, user: 'u1', endpoint: 'openAI' });

  it('appends a new entry to session_files', async () => {
    await seedConvo('c1');
    await registerSessionFile('c1', { session_id: 'A', file_id: 'f1', filename: 'a.csv' });
    const c = await Conversation.findOne({ conversationId: 'c1' }).lean();
    expect(c.session_files).toHaveLength(1);
    expect(c.session_files[0].session_id).toBe('A');
    expect(c.session_files[0].generated_at).toBeInstanceOf(Date);
  });

  it('does not duplicate same (session_id, file_id) pair', async () => {
    await seedConvo('c2');
    await registerSessionFile('c2', { session_id: 'A', file_id: 'f1', filename: 'a.csv' });
    await registerSessionFile('c2', { session_id: 'A', file_id: 'f1', filename: 'a.csv' });
    await registerSessionFile('c2', { session_id: 'A', file_id: 'f1', filename: 'a-renamed.csv' });
    const c = await Conversation.findOne({ conversationId: 'c2' }).lean();
    expect(c.session_files).toHaveLength(1);
  });

  it('treats different sessions as distinct (same file_id allowed across sessions)', async () => {
    await seedConvo('c3');
    await registerSessionFile('c3', { session_id: 'A', file_id: 'extracted', filename: 'extracted' });
    await registerSessionFile('c3', { session_id: 'B', file_id: 'extracted', filename: 'extracted' });
    const c = await Conversation.findOne({ conversationId: 'c3' }).lean();
    expect(c.session_files).toHaveLength(2);
  });

  it('handles concurrent registers atomically', async () => {
    await seedConvo('c4');
    await Promise.all([
      registerSessionFile('c4', { session_id: 'A', file_id: 'f1', filename: 'x' }),
      registerSessionFile('c4', { session_id: 'A', file_id: 'f2', filename: 'y' }),
      registerSessionFile('c4', { session_id: 'B', file_id: 'f1', filename: 'z' }),
    ]);
    const c = await Conversation.findOne({ conversationId: 'c4' }).lean();
    expect(c.session_files).toHaveLength(3);
  });

  it('is a no-op when conversation does not exist', async () => {
    const result = await registerSessionFile('nonexistent', {
      session_id: 'A',
      file_id: 'f',
      filename: 'g',
    });
    expect(result.matchedCount).toBe(0);
  });
});
