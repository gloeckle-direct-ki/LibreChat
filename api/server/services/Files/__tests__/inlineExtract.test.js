jest.mock('axios');
jest.mock('fs');

const axios = require('axios');
const fs = require('fs');

const { extractInlineText } = require('../inlineExtract');

describe('extractInlineText', () => {
  const ORIGINAL_RAG_URL = process.env.RAG_API_URL;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.RAG_API_URL = 'http://127.0.0.1:8000';
    fs.createReadStream.mockReturnValue('FAKE_STREAM');
  });

  afterAll(() => {
    if (ORIGINAL_RAG_URL == null) {
      delete process.env.RAG_API_URL;
    } else {
      process.env.RAG_API_URL = ORIGINAL_RAG_URL;
    }
  });

  it('calls rag-api /text and returns { text, chars, filename }', async () => {
    axios.post.mockResolvedValue({
      data: { text: 'Hallo Welt', file_id: 'abc', filename: 'x.pdf', known_type: true },
    });

    const result = await extractInlineText({
      filepath: '/tmp/x.pdf',
      filename: 'x.pdf',
      file_id: 'abc',
    });

    expect(result.text).toBe('Hallo Welt');
    expect(result.chars).toBe(10);
    expect(result.filename).toBe('x.pdf');

    expect(axios.post).toHaveBeenCalledTimes(1);
    const [url, _form, opts] = axios.post.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:8000/text');
    expect(opts.timeout).toBeGreaterThanOrEqual(60_000);
    expect(fs.createReadStream).toHaveBeenCalledWith('/tmp/x.pdf');
  });

  it('throws when rag-api returns 5xx', async () => {
    axios.post.mockRejectedValue(
      Object.assign(new Error('Request failed with status code 500'), {
        response: { status: 500 },
      }),
    );
    await expect(
      extractInlineText({ filepath: '/tmp/x.pdf', filename: 'x.pdf', file_id: 'abc' }),
    ).rejects.toThrow();
  });

  it('throws when known_type is false (unsupported MIME)', async () => {
    axios.post.mockResolvedValue({
      data: { text: '', file_id: 'abc', filename: 'x.bin', known_type: false },
    });
    await expect(
      extractInlineText({ filepath: '/tmp/x.bin', filename: 'x.bin', file_id: 'abc' }),
    ).rejects.toThrow(/known_type/i);
  });

  it('throws when RAG_API_URL is not configured', async () => {
    delete process.env.RAG_API_URL;
    await expect(
      extractInlineText({ filepath: '/tmp/x.pdf', filename: 'x.pdf', file_id: 'abc' }),
    ).rejects.toThrow(/RAG_API_URL/);
  });

  it('counts chars from the response text length', async () => {
    axios.post.mockResolvedValue({
      data: { text: 'a'.repeat(1234), file_id: 'abc', filename: 'x.pdf', known_type: true },
    });
    const { chars } = await extractInlineText({
      filepath: '/tmp/x.pdf',
      filename: 'x.pdf',
      file_id: 'abc',
    });
    expect(chars).toBe(1234);
  });
});
