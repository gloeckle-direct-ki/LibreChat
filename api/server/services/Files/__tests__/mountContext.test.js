jest.mock('~/db/models', () => ({
  Conversation: {
    findOne: jest.fn(),
  },
}));

const { Conversation } = require('~/db/models');
const { prefillMountFileIds } = require('../mountContext');

describe('prefillMountFileIds', () => {
  const req = { user: { id: 'user-1' } };
  const EToolResources_execute_code = 'execute_code';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const mockChain = (resolved) => ({
    lean: jest.fn().mockResolvedValue(resolved),
  });

  it('returns the same tool_resources reference when conversationId is missing', async () => {
    const tr = {};
    const out = await prefillMountFileIds(req, null, tr);
    expect(out).toBe(tr);
    expect(Conversation.findOne).not.toHaveBeenCalled();
  });

  it('returns the same reference when conversation has no persistent_files', async () => {
    Conversation.findOne.mockReturnValue(mockChain({ persistent_files: [] }));
    const tr = { execute_code: { file_ids: ['agent-attached-1'] } };
    const out = await prefillMountFileIds(req, 'conv-1', tr);
    expect(out.execute_code.file_ids).toEqual(['agent-attached-1']);
  });

  it('initializes tool_resources.execute_code.file_ids when missing', async () => {
    Conversation.findOne.mockReturnValue(
      mockChain({ persistent_files: [{ file_id: 'pf1' }, { file_id: 'pf2' }] }),
    );
    const tr = {};
    await prefillMountFileIds(req, 'conv-1', tr);
    expect(tr.execute_code.file_ids).toEqual(['pf1', 'pf2']);
  });

  it('unions with existing tool_resources.execute_code.file_ids (dedup)', async () => {
    Conversation.findOne.mockReturnValue(
      mockChain({
        persistent_files: [{ file_id: 'pf1' }, { file_id: 'pf2' }, { file_id: 'shared' }],
      }),
    );
    const tr = { execute_code: { file_ids: ['agent-1', 'shared'] } };
    await prefillMountFileIds(req, 'conv-1', tr);
    expect(new Set(tr.execute_code.file_ids)).toEqual(
      new Set(['agent-1', 'shared', 'pf1', 'pf2']),
    );
    expect(tr.execute_code.file_ids).toHaveLength(4);
  });

  it('preserves other tool_resources keys untouched', async () => {
    Conversation.findOne.mockReturnValue(
      mockChain({ persistent_files: [{ file_id: 'pf1' }] }),
    );
    const tr = {
      execute_code: { file_ids: [], files: [{ file_id: 'inline-attached' }] },
      file_search: { file_ids: ['search-1'], vector_store_ids: ['vs-1'] },
    };
    await prefillMountFileIds(req, 'conv-1', tr);

    expect(tr.execute_code.file_ids).toEqual(['pf1']);
    expect(tr.execute_code.files).toEqual([{ file_id: 'inline-attached' }]);
    expect(tr.file_search.file_ids).toEqual(['search-1']);
    expect(tr.file_search.vector_store_ids).toEqual(['vs-1']);
  });

  it('scopes Conversation.findOne by user (cross-user-leak hygiene)', async () => {
    Conversation.findOne.mockReturnValue(mockChain({ persistent_files: [] }));
    await prefillMountFileIds(req, 'conv-1', {});
    expect(Conversation.findOne).toHaveBeenCalledWith(
      { conversationId: 'conv-1', user: 'user-1' },
      { persistent_files: 1 },
    );
  });

  it('does NOT touch session_files (Track-2-territory; primeFiles delivers those)', async () => {
    // Only persistent_files (Vector A) flows through this prefill.
    // Track 2's session_files are unioned separately downstream by primeFiles.
    Conversation.findOne.mockReturnValue(
      mockChain({
        persistent_files: [{ file_id: 'pf1' }],
        session_files: [{ session_id: 's1', filename: 'derived.csv' }],
      }),
    );
    const tr = { execute_code: { file_ids: [] } };
    await prefillMountFileIds(req, 'conv-1', tr);
    expect(tr.execute_code.file_ids).toEqual(['pf1']);
    expect(tr.execute_code.session_files).toBeUndefined();
  });

  it('best-effort: returns tool_resources unchanged on lookup error', async () => {
    Conversation.findOne.mockImplementation(() => {
      throw new Error('mongo unreachable');
    });
    const tr = { execute_code: { file_ids: ['existing'] } };
    await prefillMountFileIds(req, 'conv-1', tr);
    expect(tr.execute_code.file_ids).toEqual(['existing']);
  });

  it('handles tool_resources being undefined (creates new object)', async () => {
    Conversation.findOne.mockReturnValue(
      mockChain({ persistent_files: [{ file_id: 'pf1' }] }),
    );
    const out = await prefillMountFileIds(req, 'conv-1', undefined);
    expect(out?.execute_code?.file_ids).toEqual(['pf1']);
  });
});
