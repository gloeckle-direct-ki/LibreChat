jest.mock('../inlineExtract', () => ({
  extractInlineText: jest.fn(),
}));

jest.mock('~/models/File', () => ({
  updateFile: jest.fn(),
}));

jest.mock('~/models/FilePathFailure', () => ({
  recordFilePathFailure: jest.fn(),
}));

const { runInlinePipeline } = require('../inlinePipeline');
const { extractInlineText } = require('../inlineExtract');
const { updateFile } = require('~/models/File');
const { recordFilePathFailure } = require('~/models/FilePathFailure');

describe('runInlinePipeline', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    extractInlineText.mockReset();
    updateFile.mockResolvedValue({});
    recordFilePathFailure.mockResolvedValue();
  });

  describe('when routing decision = inline (small text-bearing file)', () => {
    const file = { path: '/tmp/x.pdf', mimetype: 'application/pdf', size: 5_000 };
    const fileResult = { file_id: 'f-1', filename: 'x.pdf' };

    it('extracts text and caches it on the File doc', async () => {
      extractInlineText.mockResolvedValue({ text: 'Hallo Welt', chars: 10, filename: 'x.pdf' });

      await runInlinePipeline(null, file, fileResult, 'conv-1');

      expect(extractInlineText).toHaveBeenCalledWith({
        filepath: '/tmp/x.pdf',
        filename: 'x.pdf',
        file_id: 'f-1',
        userId: undefined,
      });
      expect(updateFile).toHaveBeenCalledTimes(1);
      const updateArg = updateFile.mock.calls[0][0];
      expect(updateArg.file_id).toBe('f-1');
      expect(updateArg['metadata.extracted_text']).toBe('Hallo Welt');
      expect(updateArg['metadata.pathStatus.inline.state']).toBe('loaded');
      expect(updateArg['metadata.pathStatus.inline.chars']).toBe(10);
      expect(updateArg['metadata.pathStatus.inline.completed_at']).toBeInstanceOf(Date);
      expect(recordFilePathFailure).not.toHaveBeenCalled();
    });

    it('on extract-failure: writes pathStatus.inline.failed + records telemetry', async () => {
      extractInlineText.mockRejectedValue(new Error('rag-api 500'));

      await runInlinePipeline(null, file, fileResult, 'conv-1');

      expect(updateFile).toHaveBeenCalledTimes(1);
      const updateArg = updateFile.mock.calls[0][0];
      expect(updateArg.file_id).toBe('f-1');
      expect(updateArg['metadata.pathStatus.inline.state']).toBe('failed');
      expect(updateArg['metadata.pathStatus.inline.reason']).toMatch(/rag-api 500/);
      expect(updateArg['metadata.extracted_text']).toBeUndefined();
      expect(recordFilePathFailure).toHaveBeenCalledWith({
        file_id: 'f-1',
        conversationId: 'conv-1',
        path: 'inline',
        reason: expect.stringMatching(/rag-api 500/),
      });
    });

    it('on extract-failure without conversationId: writes status but skips telemetry', async () => {
      extractInlineText.mockRejectedValue(new Error('rag-api 500'));

      await runInlinePipeline(null, file, fileResult, undefined);

      expect(updateFile).toHaveBeenCalledTimes(1);
      expect(recordFilePathFailure).not.toHaveBeenCalled();
    });

    it('does not throw if updateFile itself throws (helper is best-effort)', async () => {
      extractInlineText.mockResolvedValue({ text: 'Hallo', chars: 5, filename: 'x.pdf' });
      updateFile.mockRejectedValue(new Error('mongo unreachable'));

      await expect(runInlinePipeline(null, file, fileResult, 'conv-1')).resolves.toBeUndefined();
    });
  });

  describe('when routing decision = no inline', () => {
    it('zip → no extract, no updateFile, no telemetry', async () => {
      const file = { path: '/tmp/a.zip', mimetype: 'application/zip', size: 200_000 };
      const fileResult = { file_id: 'f-zip', filename: 'a.zip' };

      await runInlinePipeline(null, file, fileResult, 'conv-1');

      expect(extractInlineText).not.toHaveBeenCalled();
      expect(updateFile).not.toHaveBeenCalled();
      expect(recordFilePathFailure).not.toHaveBeenCalled();
    });

    it('large pdf (>= 20 KB) → no extract (rag-pipeline takes it, not inline)', async () => {
      const file = { path: '/tmp/big.pdf', mimetype: 'application/pdf', size: 100_000 };
      const fileResult = { file_id: 'f-big', filename: 'big.pdf' };

      await runInlinePipeline(null, file, fileResult, 'conv-1');

      expect(extractInlineText).not.toHaveBeenCalled();
      expect(updateFile).not.toHaveBeenCalled();
    });

    it('image → no extract', async () => {
      const file = { path: '/tmp/p.png', mimetype: 'image/png', size: 1_000 };
      const fileResult = { file_id: 'f-img', filename: 'p.png' };

      await runInlinePipeline(null, file, fileResult, 'conv-1');

      expect(extractInlineText).not.toHaveBeenCalled();
      expect(updateFile).not.toHaveBeenCalled();
    });
  });

  describe('input guards', () => {
    it('no-ops if fileResult lacks file_id', async () => {
      const file = { path: '/tmp/x.pdf', mimetype: 'application/pdf', size: 5_000 };

      await runInlinePipeline(null, file, { filename: 'x.pdf' }, 'conv-1');
      await runInlinePipeline(null, file, null, 'conv-1');
      await runInlinePipeline(null, file, undefined, 'conv-1');


      expect(extractInlineText).not.toHaveBeenCalled();
      expect(updateFile).not.toHaveBeenCalled();
    });

    it('no-ops if file lacks mimetype or size', async () => {
      const fileResult = { file_id: 'f-1', filename: 'x.pdf' };

      await runInlinePipeline(null, { path: '/tmp/x.pdf', size: 5_000 }, fileResult, 'conv-1');
      await runInlinePipeline(null, { path: '/tmp/x.pdf', mimetype: 'application/pdf' }, fileResult, 'conv-1');
      await runInlinePipeline(null, null, fileResult, 'conv-1');

      expect(extractInlineText).not.toHaveBeenCalled();
    });
  });
});
