// Verifies primeFiles() unions agent execute_code resources with the
// Conversation.persistent_files registry. Catches the original Vector-B
// reliability hole where chat-paperclip uploads (no agent_resource flag)
// never reached /mnt/data on subsequent code-interpreter calls.

jest.mock('axios');

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const axios = require('axios');

let mongoServer;
let Conversation;
let File;
let primeFiles;
const userId = new mongoose.Types.ObjectId();

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  ({ Conversation, File } = require('~/db/models'));
  ({ primeFiles } = require('./process'));
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await Conversation.deleteMany({});
  await File.deleteMany({});
  axios.mockReset();
  // Default: getSessionInfo => active session, no re-upload needed.
  axios.mockResolvedValue({
    data: [
      {
        name: 'session-A/file-A',
        lastModified: new Date().toISOString(),
      },
      {
        name: 'session-B/file-B',
        lastModified: new Date().toISOString(),
      },
    ],
  });
});

const seedFile = async ({ file_id, filename, fileIdentifier }) => {
  return File.create({
    user: userId,
    file_id,
    filename,
    bytes: 100,
    filepath: `/tmp/${file_id}`,
    type: 'application/pdf',
    source: 'local',
    metadata: { fileIdentifier },
  });
};

describe('primeFiles — unions Conversation.persistent_files with agent resources', () => {
  it('includes files from persistent_files when no agent execute_code resource is present', async () => {
    await Conversation.create({
      conversationId: 'c1',
      user: 'u1',
      endpoint: 'openAI',
      persistent_files: [
        { file_id: 'fp1', filename: 'a.pdf', added_at: new Date() },
      ],
    });
    await seedFile({ file_id: 'fp1', filename: 'a.pdf', fileIdentifier: 'session-A/file-A' });

    const { files, toolContext } = await primeFiles(
      {
        req: { body: { conversationId: 'c1' }, user: { id: userId.toString() } },
        tool_resources: {},
      },
      'fake-api-key',
    );

    expect(files).toHaveLength(1);
    expect(files[0].name).toBe('a.pdf');
    expect(files[0].session_id).toBe('session-A');
    expect(toolContext).toContain('/mnt/data/a.pdf');
    // No '(just attached by user)' marker — file came via persistent_files
    expect(toolContext).toContain('/mnt/data/a.pdf (just attached by user)');
  });

  it('deduplicates when the same file_id is in both persistent_files and agent execute_code resources', async () => {
    await Conversation.create({
      conversationId: 'c2',
      user: 'u1',
      endpoint: 'openAI',
      persistent_files: [
        { file_id: 'fdup', filename: 'b.pdf', added_at: new Date() },
      ],
    });
    await seedFile({ file_id: 'fdup', filename: 'b.pdf', fileIdentifier: 'session-A/file-A' });

    const { files } = await primeFiles(
      {
        req: { body: { conversationId: 'c2' }, user: { id: userId.toString() } },
        tool_resources: { execute_code: { file_ids: ['fdup'] } },
      },
      'fake-api-key',
    );

    expect(files).toHaveLength(1);
    expect(files[0].name).toBe('b.pdf');
  });

  it('keeps backward-compat: empty conversationId does not throw', async () => {
    await seedFile({ file_id: 'fa1', filename: 'agent.pdf', fileIdentifier: 'session-A/file-A' });
    const { files } = await primeFiles(
      {
        req: { body: {}, user: { id: userId.toString() } },
        tool_resources: { execute_code: { file_ids: ['fa1'] } },
      },
      'fake-api-key',
    );
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe('agent.pdf');
  });

  it('marks agent-resource files without the (just attached by user) hint, persistent-only files with it', async () => {
    await Conversation.create({
      conversationId: 'c3',
      user: 'u1',
      endpoint: 'openAI',
      persistent_files: [
        { file_id: 'fp', filename: 'paper.pdf', added_at: new Date() },
      ],
    });
    await seedFile({ file_id: 'fp', filename: 'paper.pdf', fileIdentifier: 'session-A/file-A' });
    await seedFile({ file_id: 'fa', filename: 'attached.pdf', fileIdentifier: 'session-B/file-B' });

    const { toolContext } = await primeFiles(
      {
        req: { body: { conversationId: 'c3' }, user: { id: userId.toString() } },
        tool_resources: { execute_code: { file_ids: ['fa'] } },
      },
      'fake-api-key',
    );

    expect(toolContext).toContain('/mnt/data/attached.pdf');
    expect(toolContext).not.toMatch(/\/mnt\/data\/attached\.pdf \(just attached by user\)/);
    expect(toolContext).toContain('/mnt/data/paper.pdf (just attached by user)');
  });
});
