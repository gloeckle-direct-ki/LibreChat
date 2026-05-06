/**
 * Phase 2 Task 7 — verifies that the existing pipelines emit SSE events
 * next to their pathStatus / session_files writes.
 *
 * Mocks the underlying I/O (extractInlineText, embedToRag, updateFile,
 * registerSessionFile) and only asserts on bus listeners — the writes
 * themselves are exercised by pipeline-specific tests already.
 */

jest.mock('../inlineExtract', () => ({
  extractInlineText: jest.fn(),
}));

jest.mock('../VectorDB/embedToRag', () => ({
  embedToRag: jest.fn(),
}));

jest.mock('~/models/File', () => ({
  updateFile: jest.fn().mockResolvedValue({}),
}));

jest.mock('~/models/FilePathFailure', () => ({
  recordFilePathFailure: jest.fn().mockResolvedValue(),
}));

jest.mock('~/models/Conversation', () => ({
  registerSessionFile: jest.fn(),
}));

// Code/process.js pulls a *lot* of dependencies; mock the heavy ones so the
// require() doesn't drag in axios/agents/strategies/permissions trees.
jest.mock('@librechat/agents', () => ({
  getCodeBaseURL: () => 'http://code.local',
}));

jest.mock('@librechat/api', () => ({
  logAxiosError: jest.fn(),
  getBasePath: () => '',
}));

jest.mock('axios', () => ({
  get: jest.fn(),
  post: jest.fn(),
}));

jest.mock('~/server/services/Files/permissions', () => ({
  filterFilesByAgentAccess: jest.fn(),
}));

jest.mock('~/server/services/Files/strategies', () => ({
  getStrategyFunctions: jest.fn(() => ({})),
}));

jest.mock('~/server/services/Files/images/convert', () => ({
  convertImage: jest.fn(),
}));

jest.mock('~/models', () => ({
  createFile: jest.fn(),
  getFiles: jest.fn(),
  updateFile: jest.fn(),
}));

jest.mock('~/db/models', () => ({
  Conversation: {},
}));

const { statusBus } = require('../statusBus');
const { runInlinePipeline } = require('../inlinePipeline');
const { runRagPipeline } = require('../ragPipeline');
const { processCodeOutput } = require('../Code/process');
const { extractInlineText } = require('../inlineExtract');
const { embedToRag } = require('../VectorDB/embedToRag');
const fileModelMock = require('~/models/File');
const { registerSessionFile } = require('~/models/Conversation');

describe('SSE bus emits from Phase-3 pipelines', () => {
  let emitted;

  beforeEach(() => {
    emitted = { status: [], session_file: [] };
    statusBus.removeAllListeners();
    statusBus.on('status', (e) => emitted.status.push(e));
    statusBus.on('session_file', (e) => emitted.session_file.push(e));
    jest.clearAllMocks();
    // Reset the default updateFile success-path between tests; the F3 / F4
    // cases below override per-test with mockResolvedValueOnce / mockRejectedValueOnce.
    fileModelMock.updateFile.mockResolvedValue({ file_id: 'persisted' });
  });

  describe('inlinePipeline', () => {
    const file = { path: '/tmp/x.pdf', mimetype: 'application/pdf', size: 5_000 };
    const fileResult = { file_id: 'f-1', filename: 'x.pdf' };

    it('emits status: inline/loaded with chars on success', async () => {
      extractInlineText.mockResolvedValue({ text: 'Hi', chars: 2, filename: 'x.pdf' });

      await runInlinePipeline({ user: { id: 'u1' } }, file, fileResult, 'conv-1');

      expect(emitted.status).toHaveLength(1);
      expect(emitted.status[0]).toMatchObject({
        file_id: 'f-1',
        filename: 'x.pdf',
        conversationId: 'conv-1',
        userId: 'u1',
        path: 'inline',
        state: 'loaded',
        chars: 2,
      });
      expect(emitted.status[0].timestamp).toMatch(/^\d{4}-/);
    });

    it('emits status: inline/failed with reason on extract-failure', async () => {
      extractInlineText.mockRejectedValue(new Error('PDF encrypted'));

      await runInlinePipeline({ user: { id: 'u1' } }, file, fileResult, 'conv-1');

      expect(emitted.status).toHaveLength(1);
      expect(emitted.status[0]).toMatchObject({
        file_id: 'f-1',
        path: 'inline',
        state: 'failed',
        reason: 'PDF encrypted',
        userId: 'u1',
      });
    });

    it('does not emit when route decision skips inline (size > threshold)', async () => {
      const largeFile = { ...file, size: 100_000 };
      await runInlinePipeline({ user: { id: 'u1' } }, largeFile, fileResult, 'conv-1');
      expect(emitted.status).toHaveLength(0);
    });

    // Codex review F3 — emit must be gated on a persisted update.
    it('does not emit on inline/loaded when updateFile returns null (file row vanished)', async () => {
      extractInlineText.mockResolvedValue({ text: 'Hi', chars: 2, filename: 'x.pdf' });
      fileModelMock.updateFile.mockResolvedValueOnce(null);

      await runInlinePipeline({ user: { id: 'u1' } }, file, fileResult, 'conv-1');

      expect(emitted.status).toHaveLength(0);
    });

    it('does not emit on inline/failed when updateFile rejects (DB unreachable)', async () => {
      extractInlineText.mockRejectedValue(new Error('PDF encrypted'));
      fileModelMock.updateFile.mockRejectedValueOnce(new Error('Mongo down'));

      await runInlinePipeline({ user: { id: 'u1' } }, file, fileResult, 'conv-1');

      expect(emitted.status).toHaveLength(0);
    });
  });

  describe('ragPipeline', () => {
    const file = { path: '/tmp/big.pdf', mimetype: 'application/pdf', size: 50_000 };
    const fileResult = { file_id: 'f-2', filename: 'big.pdf' };

    it('emits status: rag/embedded with chunks on success', async () => {
      embedToRag.mockResolvedValue({ embedded: true, chunks: 7 });

      await runRagPipeline({ user: { id: 'u2' } }, file, fileResult, 'conv-2');

      expect(emitted.status).toHaveLength(1);
      expect(emitted.status[0]).toMatchObject({
        file_id: 'f-2',
        path: 'rag',
        state: 'embedded',
        chunks: 7,
        userId: 'u2',
      });
    });

    it('emits status: rag/failed with reason on embed-failure', async () => {
      embedToRag.mockRejectedValue(new Error('rag-api 502'));

      await runRagPipeline({ user: { id: 'u2' } }, file, fileResult, 'conv-2');

      expect(emitted.status).toHaveLength(1);
      expect(emitted.status[0]).toMatchObject({
        file_id: 'f-2',
        path: 'rag',
        state: 'failed',
        reason: 'rag-api 502',
      });
    });

    it('emits status: rag/failed when rag-api returns embedded=false', async () => {
      embedToRag.mockResolvedValue({ embedded: false });

      await runRagPipeline({ user: { id: 'u2' } }, file, fileResult, 'conv-2');

      expect(emitted.status).toHaveLength(1);
      expect(emitted.status[0]).toMatchObject({
        file_id: 'f-2',
        path: 'rag',
        state: 'failed',
        reason: expect.stringMatching(/embedded=false/),
      });
    });

    // Codex review F4 — emit must be gated on a persisted update.
    it('does not emit on rag/embedded when updateFile returns null (file row vanished)', async () => {
      embedToRag.mockResolvedValue({ embedded: true, chunks: 7 });
      fileModelMock.updateFile.mockResolvedValueOnce(null);

      await runRagPipeline({ user: { id: 'u2' } }, file, fileResult, 'conv-2');

      expect(emitted.status).toHaveLength(0);
    });

    it('does not emit on rag/failed when updateFile rejects (DB unreachable)', async () => {
      embedToRag.mockRejectedValue(new Error('rag-api 502'));
      fileModelMock.updateFile.mockRejectedValueOnce(new Error('Mongo down'));

      await runRagPipeline({ user: { id: 'u2' } }, file, fileResult, 'conv-2');

      expect(emitted.status).toHaveLength(0);
    });
  });

  describe('processCodeOutput', () => {
    it('emits session_file when registerSessionFile succeeds', async () => {
      registerSessionFile.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });

      await processCodeOutput({
        req: { user: { id: 'u3' } },
        id: 'sf-1',
        name: 'out.csv',
        apiKey: 'k',
        toolCallId: 't',
        conversationId: 'conv-3',
        messageId: 'm',
        session_id: 'sess-A',
      });

      expect(emitted.session_file).toHaveLength(1);
      expect(emitted.session_file[0]).toMatchObject({
        conversationId: 'conv-3',
        userId: 'u3',
        session_file: { session_id: 'sess-A', file_id: 'sf-1', filename: 'out.csv' },
      });
    });

    it('does not emit session_file when matchedCount=0 (cross-user injection rejected)', async () => {
      registerSessionFile.mockResolvedValue({ matchedCount: 0, modifiedCount: 0 });

      await processCodeOutput({
        req: { user: { id: 'attacker' } },
        id: 'malicious',
        name: 'bad.csv',
        apiKey: 'k',
        toolCallId: 't',
        conversationId: 'victim-conv',
        messageId: 'm',
        session_id: 'sess-X',
      });

      expect(emitted.session_file).toHaveLength(0);
    });

    it('does not emit session_file when registerSessionFile throws', async () => {
      registerSessionFile.mockRejectedValue(new Error('DB down'));

      await processCodeOutput({
        req: { user: { id: 'u3' } },
        id: 'sf-2',
        name: 'out.csv',
        apiKey: 'k',
        toolCallId: 't',
        conversationId: 'conv-3',
        messageId: 'm',
        session_id: 'sess-A',
      });

      expect(emitted.session_file).toHaveLength(0);
    });
  });
});
