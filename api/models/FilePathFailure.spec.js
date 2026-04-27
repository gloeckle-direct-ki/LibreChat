const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongoServer;
let FilePathFailure;
let recordFilePathFailure;

describe('recordFilePathFailure', () => {
  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
    ({ FilePathFailure } = require('~/db/models'));
    ({ recordFilePathFailure } = require('./FilePathFailure'));
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await FilePathFailure.deleteMany({});
  });

  it('inserts a failure document with all fields', async () => {
    await recordFilePathFailure({
      file_id: 'f1',
      conversationId: 'c1',
      path: 'rag',
      reason: 'rag-api 502',
    });
    const all = await FilePathFailure.find({ file_id: 'f1' }).lean();
    expect(all).toHaveLength(1);
    expect(all[0].path).toBe('rag');
    expect(all[0].reason).toBe('rag-api 502');
    expect(all[0].retry_count).toBe(0);
    expect(all[0].timestamp).toBeInstanceOf(Date);
  });

  it('records distinct attempts with different paths', async () => {
    await recordFilePathFailure({
      file_id: 'f2', conversationId: 'c1', path: 'mount', reason: 'EROFS',
    });
    await recordFilePathFailure({
      file_id: 'f2', conversationId: 'c1', path: 'inline', reason: 'parse-fail', retry_count: 1,
    });
    const all = await FilePathFailure.find({ file_id: 'f2' }).sort({ path: 1 }).lean();
    expect(all).toHaveLength(2);
    expect(all.map((e) => e.path).sort()).toEqual(['inline', 'mount']);
  });

  it('rejects an invalid path enum value at the schema level', async () => {
    await expect(
      FilePathFailure.create({
        file_id: 'f3',
        conversationId: 'c1',
        path: 'NOT_A_VALID_PATH',
        reason: 'x',
      }),
    ).rejects.toThrow();
  });

  it('helper swallows write errors (telemetry is best-effort)', async () => {
    // Force an internal error by corrupting the model temporarily.
    const original = FilePathFailure.create;
    FilePathFailure.create = () => Promise.reject(new Error('mongo down'));
    try {
      await expect(
        recordFilePathFailure({
          file_id: 'f4',
          conversationId: 'c1',
          path: 'rag',
          reason: 'x',
        }),
      ).resolves.toBeUndefined();
    } finally {
      FilePathFailure.create = original;
    }
  });
});
