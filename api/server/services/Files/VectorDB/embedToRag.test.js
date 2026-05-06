jest.mock('./crud', () => ({
  uploadVectors: jest.fn(),
}));

const { uploadVectors } = require('./crud');
const { embedToRag } = require('./embedToRag');

describe('embedToRag', () => {
  const ORIGINAL_RAG_URL = process.env.RAG_API_URL;
  const req = { user: { id: 'user-1' } };
  const file = {
    path: '/tmp/test.pdf',
    mimetype: 'application/pdf',
    size: 100_000,
    originalname: 'test.pdf',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.RAG_API_URL = 'http://rag-api';
  });

  afterAll(() => {
    if (ORIGINAL_RAG_URL == null) {
      delete process.env.RAG_API_URL;
    } else {
      process.env.RAG_API_URL = ORIGINAL_RAG_URL;
    }
  });

  it('forwards to uploadVectors and returns the result', async () => {
    uploadVectors.mockResolvedValue({
      embedded: true,
      bytes: 100_000,
      filename: 'test.pdf',
      chunks: 7,
    });

    const result = await embedToRag({
      req,
      file,
      file_id: 'fid-1',
      entity_id: 'agent-1',
    });

    expect(result.embedded).toBe(true);
    expect(result.chunks).toBe(7);
    expect(uploadVectors).toHaveBeenCalledWith({
      req,
      file,
      file_id: 'fid-1',
      entity_id: 'agent-1',
      storageMetadata: undefined,
    });
  });

  it('throws when RAG_API_URL is not configured', async () => {
    delete process.env.RAG_API_URL;
    await expect(embedToRag({ req, file, file_id: 'fid-1' })).rejects.toThrow(/RAG_API_URL/);
    expect(uploadVectors).not.toHaveBeenCalled();
  });

  it('propagates uploadVectors errors (caller decides how to handle)', async () => {
    uploadVectors.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(embedToRag({ req, file, file_id: 'fid-1' })).rejects.toThrow(/ECONNREFUSED/);
  });

  it('forwards storageMetadata when provided', async () => {
    uploadVectors.mockResolvedValue({ embedded: true });
    await embedToRag({
      req,
      file,
      file_id: 'fid-1',
      storageMetadata: { source: 's3', s3_bucket: 'a' },
    });
    expect(uploadVectors).toHaveBeenCalledWith({
      req,
      file,
      file_id: 'fid-1',
      entity_id: undefined,
      storageMetadata: { source: 's3', s3_bucket: 'a' },
    });
  });
});
