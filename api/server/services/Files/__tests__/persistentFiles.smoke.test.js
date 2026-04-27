// Smoke: real-MongoDB roundtrip via the actual @librechat/data-schemas
// package boundary. Catches silent-drops at the export/serialization
// layer that the in-package unit test in
// packages/data-schemas/src/schema/__tests__/convo.persistentFiles.test.ts
// would not see (e.g., missing re-export, name typo in createModels).
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongoServer;
let Conversation;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  // Require the model AFTER mongoose is connected so models bind to this connection.
  ({ Conversation } = require('~/db/models'));
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await Conversation.deleteMany({});
});

describe('persistent_files real-mongo smoke', () => {
  it('writes and reads persistent_files via the package boundary', async () => {
    await Conversation.create({
      conversationId: 'smoke-1',
      user: 'u1',
      endpoint: 'openAI',
      persistent_files: [
        { file_id: 'sf1', filename: 'test.pdf', added_at: new Date() },
      ],
    });
    const c = await Conversation.findOne({ conversationId: 'smoke-1' }).lean();
    expect(c.persistent_files).toHaveLength(1);
    expect(c.persistent_files[0].file_id).toBe('sf1');
    expect(c.persistent_files[0].filename).toBe('test.pdf');
  });

  it('survives a $push update + reload (mirrors addPersistentFile path)', async () => {
    await Conversation.create({
      conversationId: 'smoke-2',
      user: 'u1',
      endpoint: 'openAI',
    });
    await Conversation.updateOne(
      { conversationId: 'smoke-2' },
      {
        $push: {
          persistent_files: {
            file_id: 'sf2',
            filename: 'a.pdf',
            added_at: new Date(),
          },
        },
      },
    );
    const c = await Conversation.findOne({ conversationId: 'smoke-2' }).lean();
    expect(c.persistent_files).toHaveLength(1);
    expect(c.persistent_files[0].file_id).toBe('sf2');
  });
});
