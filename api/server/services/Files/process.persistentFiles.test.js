// Verifies the upload pipeline -> Conversation.persistent_files wiring.
// Tests the small `tryRegisterPersistentFile` shim that all upload paths
// call after the file row is created. Full end-to-end of processFileUpload
// is not testable in isolation (strategies, multer, OCR, etc. all mocked
// out by the existing files.agents.test.js layer); this targets the seam
// that was added.
jest.mock('~/models/Conversation', () => ({
  addPersistentFile: jest.fn(),
}));

const { addPersistentFile } = require('~/models/Conversation');
const { tryRegisterPersistentFile } = require('./process');

describe('tryRegisterPersistentFile', () => {
  beforeEach(() => {
    addPersistentFile.mockReset();
    addPersistentFile.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
  });

  it('calls addPersistentFile with file_id + filename when conversationId is set', async () => {
    await tryRegisterPersistentFile('conv-1', { file_id: 'f1', filename: 'a.pdf' });
    expect(addPersistentFile).toHaveBeenCalledTimes(1);
    expect(addPersistentFile).toHaveBeenCalledWith('conv-1', {
      file_id: 'f1',
      filename: 'a.pdf',
    });
  });

  it('no-ops without conversationId', async () => {
    await tryRegisterPersistentFile(undefined, { file_id: 'f1', filename: 'a.pdf' });
    await tryRegisterPersistentFile(null, { file_id: 'f1', filename: 'a.pdf' });
    await tryRegisterPersistentFile('', { file_id: 'f1', filename: 'a.pdf' });
    expect(addPersistentFile).not.toHaveBeenCalled();
  });

  it('no-ops when file is missing file_id or filename', async () => {
    await tryRegisterPersistentFile('conv-1', { file_id: 'f1' });
    await tryRegisterPersistentFile('conv-1', { filename: 'a.pdf' });
    await tryRegisterPersistentFile('conv-1', null);
    await tryRegisterPersistentFile('conv-1', undefined);
    expect(addPersistentFile).not.toHaveBeenCalled();
  });

  it('swallows underlying addPersistentFile errors (registration is best-effort)', async () => {
    addPersistentFile.mockRejectedValue(new Error('mongo unreachable'));
    await expect(
      tryRegisterPersistentFile('conv-1', { file_id: 'f1', filename: 'a.pdf' }),
    ).resolves.toBeUndefined();
    expect(addPersistentFile).toHaveBeenCalledTimes(1);
  });
});
