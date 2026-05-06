// Verifies processCodeOutput registers every newFile (image AND non-image)
// in Conversation.session_files. Closes the gap from UAT cid 3b05229c-...:
// extracted directories and other non-image exec-outputs were never tracked
// anywhere LibreChat could see, so primeFiles couldn't forward them to the
// next /exec call.

jest.mock('axios');

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const axios = require('axios');

let mongoServer;
let Conversation;
let processCodeOutput;
const userId = new mongoose.Types.ObjectId();

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  ({ Conversation } = require('~/db/models'));
  ({ processCodeOutput } = require('./process'));
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await Conversation.deleteMany({});
  axios.mockReset();
});

describe('processCodeOutput — registers exec-output in session_files', () => {
  it('registers a non-image newFile (e.g. extracted dir) in session_files', async () => {
    await Conversation.create({
      conversationId: 'c1',
      user: userId.toString(),
      endpoint: 'openAI',
    });
    await processCodeOutput({
      req: { user: { id: userId.toString() }, config: {} },
      id: 'extracted_dir',
      name: 'auflage_ist_extracted',
      apiKey: 'fake',
      toolCallId: 'tc1',
      conversationId: 'c1',
      messageId: 'm1',
      session_id: 'sess-A',
    });
    const c = await Conversation.findOne({ conversationId: 'c1' }).lean();
    expect(c.session_files).toHaveLength(1);
    expect(c.session_files[0]).toMatchObject({
      session_id: 'sess-A',
      file_id: 'extracted_dir',
      filename: 'auflage_ist_extracted',
    });
  });

  it('registers an image newFile in session_files (wrapper runs before image-download)', async () => {
    // axios mocked to throw so the image-download branch fails fast — the
    // registration runs first regardless, which is what we verify.
    axios.mockRejectedValue(new Error('mocked-axios-fail'));
    await Conversation.create({
      conversationId: 'c2',
      user: userId.toString(),
      endpoint: 'openAI',
    });
    await processCodeOutput({
      req: { user: { id: userId.toString() }, config: {} },
      id: 'plot_id',
      name: 'plot.png',
      apiKey: 'fake',
      toolCallId: 'tc2',
      conversationId: 'c2',
      messageId: 'm2',
      session_id: 'sess-B',
    });
    const c = await Conversation.findOne({ conversationId: 'c2' }).lean();
    expect(c.session_files).toHaveLength(1);
    expect(c.session_files[0]).toMatchObject({
      session_id: 'sess-B',
      file_id: 'plot_id',
      filename: 'plot.png',
    });
  });

  it('skips registration when conversationId is missing', async () => {
    // No conversation created. Wrapper-condition fails → no Mongo write.
    // name='y' has no extension → returns the non-image stub, no axios call.
    await processCodeOutput({
      req: { user: { id: userId.toString() }, config: {} },
      id: 'x',
      name: 'y',
      apiKey: '',
      toolCallId: '',
      conversationId: undefined,
      messageId: '',
      session_id: 'A',
    });
    const count = await Conversation.countDocuments({});
    expect(count).toBe(0);
  });
});
