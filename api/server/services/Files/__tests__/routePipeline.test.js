jest.mock('../inlinePipeline', () => ({ runInlinePipeline: jest.fn().mockResolvedValue() }));
jest.mock('../ragPipeline', () => ({ runRagPipeline: jest.fn().mockResolvedValue() }));

const { EToolResources } = require('librechat-data-provider');
const { runInlinePipeline } = require('../inlinePipeline');
const { runRagPipeline } = require('../ragPipeline');
const { maybeRunV2Pipeline } = require('../routePipeline');

const baseArgs = () => ({
  req: { user: { id: 'u1' } },
  file: { mimetype: 'application/pdf' },
  result: { file_id: 'f1' },
  conversationId: 'c1',
  entity_id: 'a1',
});

describe('maybeRunV2Pipeline', () => {
  const originalFlag = process.env.FILE_ROUTING_V2;

  afterEach(() => {
    if (originalFlag === undefined) {
      delete process.env.FILE_ROUTING_V2;
    } else {
      process.env.FILE_ROUTING_V2 = originalFlag;
    }
    jest.clearAllMocks();
  });

  test('flag OFF: skips both pipelines (legacy auto-RAG path stays in charge)', async () => {
    delete process.env.FILE_ROUTING_V2;
    await maybeRunV2Pipeline({ ...baseArgs(), tool_resource: EToolResources.context });
    expect(runInlinePipeline).not.toHaveBeenCalled();
    expect(runRagPipeline).not.toHaveBeenCalled();
  });

  test('flag set to anything other than "true": skips both pipelines', async () => {
    process.env.FILE_ROUTING_V2 = 'false';
    await maybeRunV2Pipeline({ ...baseArgs(), tool_resource: EToolResources.context });
    expect(runInlinePipeline).not.toHaveBeenCalled();
    expect(runRagPipeline).not.toHaveBeenCalled();
  });

  test('flag ON + non-file_search tool_resource: invokes both pipelines', async () => {
    process.env.FILE_ROUTING_V2 = 'true';
    const args = { ...baseArgs(), tool_resource: EToolResources.context };
    await maybeRunV2Pipeline(args);
    expect(runInlinePipeline).toHaveBeenCalledWith(args.file, args.result, args.conversationId);
    expect(runRagPipeline).toHaveBeenCalledWith(
      args.req,
      args.file,
      args.result,
      args.conversationId,
      args.entity_id,
    );
  });

  test('flag ON + tool_resource undefined (plain message-attachment): invokes both pipelines', async () => {
    process.env.FILE_ROUTING_V2 = 'true';
    await maybeRunV2Pipeline({ ...baseArgs(), tool_resource: undefined });
    expect(runInlinePipeline).toHaveBeenCalledTimes(1);
    expect(runRagPipeline).toHaveBeenCalledTimes(1);
  });

  test('flag ON + tool_resource=file_search: skips both pipelines (uploadVectors already embedded)', async () => {
    process.env.FILE_ROUTING_V2 = 'true';
    await maybeRunV2Pipeline({ ...baseArgs(), tool_resource: EToolResources.file_search });
    expect(runInlinePipeline).not.toHaveBeenCalled();
    expect(runRagPipeline).not.toHaveBeenCalled();
  });
});
