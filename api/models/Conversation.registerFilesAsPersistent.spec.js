const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongoServer;
let Conversation;
let File;
let registerFilesAsPersistent;

describe('registerFilesAsPersistent', () => {
  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
    ({ Conversation, File } = require('~/db/models'));
    ({ registerFilesAsPersistent } = require('./Conversation'));
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await Conversation.deleteMany({});
    await File.deleteMany({});
  });

  const seedConvo = (conversationId) =>
    Conversation.create({ conversationId, user: 'u1', endpoint: 'openAI' });

  const seedFile = (file_id, filename) =>
    File.create({
      user: new mongoose.Types.ObjectId(),
      file_id,
      filename,
      bytes: 100,
      filepath: `/tmp/${file_id}`,
      type: 'application/pdf',
      source: 'local',
    });

  it('registers all matching files in Conversation.persistent_files', async () => {
    await seedConvo('c1');
    await seedFile('f1', 'a.pdf');
    await seedFile('f2', 'b.pdf');

    await registerFilesAsPersistent('c1', ['f1', 'f2']);

    const c = await Conversation.findOne({ conversationId: 'c1' }).lean();
    const ids = c.persistent_files.map((f) => f.file_id).sort();
    const names = c.persistent_files.map((f) => f.filename).sort();
    expect(ids).toEqual(['f1', 'f2']);
    expect(names).toEqual(['a.pdf', 'b.pdf']);
  });

  it('skips file_ids that have no matching File row (no throw)', async () => {
    await seedConvo('c2');
    await seedFile('f1', 'a.pdf');

    await registerFilesAsPersistent('c2', ['f1', 'orphan-id', 'another-orphan']);

    const c = await Conversation.findOne({ conversationId: 'c2' }).lean();
    expect(c.persistent_files).toHaveLength(1);
    expect(c.persistent_files[0].file_id).toBe('f1');
  });

  it('is a no-op on empty file-ids array', async () => {
    await seedConvo('c3');

    await registerFilesAsPersistent('c3', []);

    const c = await Conversation.findOne({ conversationId: 'c3' }).lean();
    expect(c.persistent_files ?? []).toHaveLength(0);
  });

  it('is a no-op on missing conversationId', async () => {
    await seedConvo('c4');
    await seedFile('f1', 'a.pdf');

    await registerFilesAsPersistent(null, ['f1']);
    await registerFilesAsPersistent(undefined, ['f1']);
    await registerFilesAsPersistent('', ['f1']);

    const c = await Conversation.findOne({ conversationId: 'c4' }).lean();
    expect(c.persistent_files ?? []).toHaveLength(0);
  });

  it('is idempotent — re-registering the same files does not duplicate', async () => {
    await seedConvo('c5');
    await seedFile('f1', 'a.pdf');
    await seedFile('f2', 'b.pdf');

    await registerFilesAsPersistent('c5', ['f1', 'f2']);
    await registerFilesAsPersistent('c5', ['f1', 'f2']);
    await registerFilesAsPersistent('c5', ['f1']);

    const c = await Conversation.findOne({ conversationId: 'c5' }).lean();
    expect(c.persistent_files).toHaveLength(2);
  });

  it('handles non-array fileIds gracefully (no-op, no throw)', async () => {
    await seedConvo('c6');

    await registerFilesAsPersistent('c6', null);
    await registerFilesAsPersistent('c6', undefined);

    const c = await Conversation.findOne({ conversationId: 'c6' }).lean();
    expect(c.persistent_files ?? []).toHaveLength(0);
  });
});
