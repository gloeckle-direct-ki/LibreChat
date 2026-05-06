jest.mock('~/db/models', () => ({
  Conversation: {
    findOne: jest.fn(),
  },
  File: {
    find: jest.fn(),
  },
}));

const { Conversation, File } = require('~/db/models');
const { buildInlineFileBlock } = require('../inlineContext');

describe('buildInlineFileBlock', () => {
  const req = { user: { id: 'user-1' } };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const mockChain = (resolved) => ({
    lean: jest.fn().mockResolvedValue(resolved),
  });

  it('returns empty string when conversationId is missing', async () => {
    expect(await buildInlineFileBlock(req, undefined)).toBe('');
    expect(await buildInlineFileBlock(req, null)).toBe('');
    expect(await buildInlineFileBlock(req, '')).toBe('');
    expect(Conversation.findOne).not.toHaveBeenCalled();
  });

  it('returns empty string when conversation has no persistent_files', async () => {
    Conversation.findOne.mockReturnValue(mockChain({ persistent_files: [] }));
    expect(await buildInlineFileBlock(req, 'conv-1')).toBe('');
    expect(File.find).not.toHaveBeenCalled();
  });

  it('returns empty string when conversation not found', async () => {
    Conversation.findOne.mockReturnValue(mockChain(null));
    expect(await buildInlineFileBlock(req, 'conv-1')).toBe('');
  });

  it('scopes Conversation.findOne by user (cross-user-leak hygiene)', async () => {
    Conversation.findOne.mockReturnValue(mockChain({ persistent_files: [] }));
    await buildInlineFileBlock(req, 'conv-1');
    expect(Conversation.findOne).toHaveBeenCalledWith(
      { conversationId: 'conv-1', user: 'user-1' },
      { persistent_files: 1 },
    );
  });

  it('only includes files where pathStatus.inline.state === "loaded"', async () => {
    Conversation.findOne.mockReturnValue(
      mockChain({
        persistent_files: [{ file_id: 'f1' }, { file_id: 'f2' }, { file_id: 'f3' }],
      }),
    );
    File.find.mockReturnValue(
      mockChain([
        {
          file_id: 'f1',
          filename: 'a.pdf',
          metadata: { extracted_text: 'text-a' },
        },
      ]),
    );

    const block = await buildInlineFileBlock(req, 'conv-1');

    expect(File.find).toHaveBeenCalledWith(
      {
        file_id: { $in: ['f1', 'f2', 'f3'] },
        'metadata.pathStatus.inline.state': 'loaded',
      },
      { filename: 1, 'metadata.extracted_text': 1 },
    );
    expect(block).toContain('[Datei: a.pdf]');
    expect(block).toContain('text-a');
    expect(block).toContain('[/Datei]');
  });

  it('joins multiple inline files with double newline between blocks', async () => {
    Conversation.findOne.mockReturnValue(
      mockChain({ persistent_files: [{ file_id: 'f1' }, { file_id: 'f2' }] }),
    );
    File.find.mockReturnValue(
      mockChain([
        { file_id: 'f1', filename: 'a.txt', metadata: { extracted_text: 'first' } },
        { file_id: 'f2', filename: 'b.txt', metadata: { extracted_text: 'second' } },
      ]),
    );

    const block = await buildInlineFileBlock(req, 'conv-1');
    expect(block).toMatch(/\[Datei: a\.txt\][\s\S]*first[\s\S]*\[\/Datei\]\n\n\[Datei: b\.txt\][\s\S]*second[\s\S]*\[\/Datei\]/);
  });

  it('skips files with empty extracted_text', async () => {
    Conversation.findOne.mockReturnValue(
      mockChain({ persistent_files: [{ file_id: 'f1' }, { file_id: 'f2' }] }),
    );
    File.find.mockReturnValue(
      mockChain([
        { file_id: 'f1', filename: 'a.txt', metadata: { extracted_text: '' } },
        { file_id: 'f2', filename: 'b.txt', metadata: { extracted_text: 'real' } },
      ]),
    );

    const block = await buildInlineFileBlock(req, 'conv-1');
    expect(block).not.toContain('[Datei: a.txt]');
    expect(block).toContain('[Datei: b.txt]');
  });

  it('returns empty string when no files match the loaded-state filter', async () => {
    Conversation.findOne.mockReturnValue(
      mockChain({ persistent_files: [{ file_id: 'f1' }] }),
    );
    File.find.mockReturnValue(mockChain([]));

    expect(await buildInlineFileBlock(req, 'conv-1')).toBe('');
  });

  it('returns empty string and logs warn on Conversation lookup error', async () => {
    Conversation.findOne.mockImplementation(() => {
      throw new Error('mongo down');
    });

    expect(await buildInlineFileBlock(req, 'conv-1')).toBe('');
  });
});
