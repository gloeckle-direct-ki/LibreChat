jest.mock('../VectorDB/embedToRag', () => ({
  embedToRag: jest.fn(),
}));

jest.mock('~/models/File', () => ({
  updateFile: jest.fn(),
}));

jest.mock('~/models/FilePathFailure', () => ({
  recordFilePathFailure: jest.fn(),
}));

const { runRagPipeline } = require('../ragPipeline');
const { embedToRag } = require('../VectorDB/embedToRag');
const { updateFile } = require('~/models/File');
const { recordFilePathFailure } = require('~/models/FilePathFailure');

describe('runRagPipeline', () => {
  const req = { user: { id: 'user-1' } };

  beforeEach(() => {
    jest.clearAllMocks();
    embedToRag.mockReset();
    updateFile.mockResolvedValue({});
    recordFilePathFailure.mockResolvedValue();
  });

  describe('when routing decision = rag (large text-bearing file)', () => {
    const file = {
      path: '/tmp/big.pdf',
      mimetype: 'application/pdf',
      size: 100_000,
      originalname: 'big.pdf',
    };
    const fileResult = { file_id: 'f-1', filename: 'big.pdf' };

    it('embeds via rag-api and writes pathStatus.rag.embedded with chunks', async () => {
      embedToRag.mockResolvedValue({ embedded: true, chunks: 12, bytes: 100_000 });

      await runRagPipeline(req, file, fileResult, 'conv-1', 'agent-1');

      expect(embedToRag).toHaveBeenCalledWith({
        req,
        file,
        file_id: 'f-1',
        entity_id: 'agent-1',
      });
      expect(updateFile).toHaveBeenCalledTimes(1);
      const updateArg = updateFile.mock.calls[0][0];
      expect(updateArg.file_id).toBe('f-1');
      expect(updateArg['metadata.pathStatus.rag.state']).toBe('embedded');
      expect(updateArg['metadata.pathStatus.rag.chunks']).toBe(12);
      expect(updateArg['metadata.pathStatus.rag.completed_at']).toBeInstanceOf(Date);
      expect(updateArg.embedded).toBe(true);
      expect(recordFilePathFailure).not.toHaveBeenCalled();
    });

    it('on embed-failure: writes pathStatus.rag.failed + records telemetry', async () => {
      embedToRag.mockRejectedValue(new Error('rag-api 500'));

      await runRagPipeline(req, file, fileResult, 'conv-1');

      expect(updateFile).toHaveBeenCalledTimes(1);
      const updateArg = updateFile.mock.calls[0][0];
      expect(updateArg['metadata.pathStatus.rag.state']).toBe('failed');
      expect(updateArg['metadata.pathStatus.rag.reason']).toMatch(/rag-api 500/);
      expect(updateArg['metadata.pathStatus.rag.chunks']).toBeUndefined();
      expect(recordFilePathFailure).toHaveBeenCalledWith({
        file_id: 'f-1',
        conversationId: 'conv-1',
        path: 'rag',
        reason: expect.stringMatching(/rag-api 500/),
      });
    });

    it('on embed-failure without conversationId: status written, telemetry skipped', async () => {
      embedToRag.mockRejectedValue(new Error('rag-api 500'));

      await runRagPipeline(req, file, fileResult, undefined);

      expect(updateFile).toHaveBeenCalledTimes(1);
      expect(recordFilePathFailure).not.toHaveBeenCalled();
    });

    it('when rag-api returns embedded=false (unknown_type): writes failed state', async () => {
      embedToRag.mockResolvedValue({ embedded: false });

      await runRagPipeline(req, file, fileResult, 'conv-1');

      const updateArg = updateFile.mock.calls[0][0];
      expect(updateArg['metadata.pathStatus.rag.state']).toBe('failed');
      expect(updateArg['metadata.pathStatus.rag.reason']).toMatch(/known_type|unsupported/i);
      expect(updateArg.embedded).toBe(false);
    });

    it('does not throw if updateFile itself throws (helper is best-effort)', async () => {
      embedToRag.mockResolvedValue({ embedded: true, chunks: 3 });
      updateFile.mockRejectedValue(new Error('mongo down'));

      await expect(runRagPipeline(req, file, fileResult, 'conv-1')).resolves.toBeUndefined();
    });
  });

  describe('when routing decision = no rag', () => {
    it('small text-bearing file → no embed (inline-pipeline takes it)', async () => {
      const file = { path: '/tmp/x.pdf', mimetype: 'application/pdf', size: 5_000 };
      const fileResult = { file_id: 'f-small', filename: 'x.pdf' };

      await runRagPipeline(req, file, fileResult, 'conv-1');

      expect(embedToRag).not.toHaveBeenCalled();
      expect(updateFile).not.toHaveBeenCalled();
    });

    it('zip → no embed (not text-bearing)', async () => {
      const file = { path: '/tmp/a.zip', mimetype: 'application/zip', size: 200_000 };
      const fileResult = { file_id: 'f-zip', filename: 'a.zip' };

      await runRagPipeline(req, file, fileResult, 'conv-1');

      expect(embedToRag).not.toHaveBeenCalled();
    });

    it('image → no embed', async () => {
      const file = { path: '/tmp/p.png', mimetype: 'image/png', size: 50_000 };
      const fileResult = { file_id: 'f-img', filename: 'p.png' };

      await runRagPipeline(req, file, fileResult, 'conv-1');

      expect(embedToRag).not.toHaveBeenCalled();
    });
  });

  describe('input guards', () => {
    it('no-ops without file_id', async () => {
      const file = { path: '/tmp/x.pdf', mimetype: 'application/pdf', size: 100_000 };
      await runRagPipeline(req, file, { filename: 'x.pdf' }, 'conv-1');
      await runRagPipeline(req, file, null, 'conv-1');
      expect(embedToRag).not.toHaveBeenCalled();
    });

    it('no-ops if file lacks mimetype/size', async () => {
      await runRagPipeline(req, { path: '/tmp/x.pdf' }, { file_id: 'f-1' }, 'conv-1');
      await runRagPipeline(req, null, { file_id: 'f-1' }, 'conv-1');
      expect(embedToRag).not.toHaveBeenCalled();
    });
  });
});
