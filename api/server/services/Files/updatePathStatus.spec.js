const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongoServer;
let File;
let updatePathStatus;
let statusBus;

describe('updatePathStatus', () => {
  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
    ({ File } = require('~/db/models'));
    ({ updatePathStatus } = require('./updatePathStatus'));
    ({ statusBus } = require('./statusBus'));
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await File.deleteMany({});
    statusBus.removeAllListeners();
  });

  const createFile = (file_id, extra = {}) =>
    File.create({
      file_id,
      filename: `${file_id}.pdf`,
      filepath: `/tmp/${file_id}.pdf`,
      bytes: 1234,
      type: 'application/pdf',
      user: new mongoose.Types.ObjectId(),
      ...extra,
    });

  it('writes per-path state with completed_at timestamp', async () => {
    await createFile('f1');
    await updatePathStatus('f1', 'inline', { state: 'loaded', chars: 1234 });
    const f = await File.findOne({ file_id: 'f1' }).lean();
    expect(f.metadata.pathStatus.inline.state).toBe('loaded');
    expect(f.metadata.pathStatus.inline.chars).toBe(1234);
    expect(f.metadata.pathStatus.inline.completed_at).toBeInstanceOf(Date);
  });

  it('preserves other paths when updating one', async () => {
    await createFile('f2', {
      metadata: { pathStatus: { inline: { state: 'loaded', chars: 500 } } },
    });
    await updatePathStatus('f2', 'rag', { state: 'embedded', chunks: 8 });
    const f = await File.findOne({ file_id: 'f2' }).lean();
    expect(f.metadata.pathStatus.inline.state).toBe('loaded');
    expect(f.metadata.pathStatus.inline.chars).toBe(500);
    expect(f.metadata.pathStatus.rag.state).toBe('embedded');
    expect(f.metadata.pathStatus.rag.chunks).toBe(8);
  });

  it('writes reason when provided (failure case)', async () => {
    await createFile('f3');
    await updatePathStatus('f3', 'inline', { state: 'failed', reason: 'PDF encrypted' });
    const f = await File.findOne({ file_id: 'f3' }).lean();
    expect(f.metadata.pathStatus.inline.state).toBe('failed');
    expect(f.metadata.pathStatus.inline.reason).toBe('PDF encrypted');
  });

  it('does not write reason field when not provided', async () => {
    await createFile('f4');
    await updatePathStatus('f4', 'inline', { state: 'loaded', chars: 100 });
    const f = await File.findOne({ file_id: 'f4' }).lean();
    expect(f.metadata.pathStatus.inline.reason).toBeUndefined();
  });

  it('emits a status event on the SSE bus after successful write', async () => {
    const file = await createFile('f5', { conversationId: 'conv-1' });
    const events = [];
    statusBus.on('status', (e) => events.push(e));

    await updatePathStatus('f5', 'rag', { state: 'embedded', chunks: 12 });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      file_id: 'f5',
      filename: 'f5.pdf',
      conversationId: 'conv-1',
      userId: String(file.user),
      path: 'rag',
      state: 'embedded',
      chunks: 12,
    });
    expect(events[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('emits even when conversationId is null (upload-time has no convo yet)', async () => {
    await createFile('f6'); // no conversationId
    const events = [];
    statusBus.on('status', (e) => events.push(e));

    await updatePathStatus('f6', 'inline', { state: 'loaded', chars: 50 });

    expect(events).toHaveLength(1);
    expect(events[0].file_id).toBe('f6');
    expect(events[0].conversationId).toBeFalsy();
  });

  it('does not throw when file_id does not exist (no-op + no emit)', async () => {
    const events = [];
    statusBus.on('status', (e) => events.push(e));

    await expect(
      updatePathStatus('nonexistent', 'inline', { state: 'loaded' }),
    ).resolves.not.toThrow();

    expect(events).toHaveLength(0);
  });

  it('does not write completed_at for state=pending', async () => {
    await createFile('f7');
    await updatePathStatus('f7', 'rag', { state: 'pending' });
    const f = await File.findOne({ file_id: 'f7' }).lean();
    expect(f.metadata.pathStatus.rag.state).toBe('pending');
    expect(f.metadata.pathStatus.rag.completed_at).toBeUndefined();
  });
});
