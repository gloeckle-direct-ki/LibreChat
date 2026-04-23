// Validates that createToolInstance/_call injects framework-reserved
// context (_librechat_conversation_id, _librechat_user_id) into the MCP
// tool-call arguments before they reach mcpManager.callTool.

jest.mock('@librechat/data-schemas', () => ({
  logger: {
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  },
}));

jest.mock('@langchain/core/tools', () => ({
  tool: jest.fn((fn, config) => {
    const toolInstance = { _call: fn, ...config };
    return toolInstance;
  }),
}));

jest.mock('@librechat/agents', () => ({
  Providers: {
    VERTEXAI: 'vertexai',
    GOOGLE: 'google',
  },
  StepTypes: {
    TOOL_CALLS: 'tool_calls',
  },
  GraphEvents: {
    ON_RUN_STEP_DELTA: 'on_run_step_delta',
    ON_RUN_STEP: 'on_run_step',
  },
  Constants: {
    CONTENT_AND_ARTIFACT: 'content_and_artifact',
  },
}));

const mockCallTool = jest.fn();
const mockGetMCPManager = jest.fn(() => ({ callTool: mockCallTool }));

jest.mock('~/config', () => ({
  getMCPManager: mockGetMCPManager,
  getFlowStateManager: jest.fn(() => ({
    createFlow: jest.fn(),
    completeFlow: jest.fn(),
    failFlow: jest.fn(),
    getFlowState: jest.fn(),
  })),
  getMCPServersRegistry: jest.fn(() => ({
    getServerConfig: jest.fn(() => null),
  })),
  getOAuthReconnectionManager: jest.fn(() => ({})),
}));

jest.mock('~/models', () => ({
  findToken: jest.fn(),
  createToken: jest.fn(),
  updateToken: jest.fn(),
}));

jest.mock('./Tools/mcp', () => ({
  reinitMCPServer: jest.fn(),
}));

jest.mock('./Config', () => ({
  getAppConfig: jest.fn(() => Promise.resolve({})),
}));

jest.mock('~/cache', () => ({
  getLogStores: jest.fn(() => ({})),
}));

const mockRegistryInstance = {
  getOAuthServers: jest.fn(() => Promise.resolve(new Set())),
  getAllServerConfigs: jest.fn(() => Promise.resolve({})),
  getServerConfig: jest.fn(() => Promise.resolve(null)),
};

jest.mock('@librechat/api', () => ({
  MCPOAuthHandler: { generateFlowId: jest.fn() },
  sendEvent: jest.fn(),
  normalizeServerName: jest.fn((name) => name),
  convertWithResolvedRefs: jest.fn(() => null), // force fallback schema
  isMCPDomainAllowed: jest.fn(() => Promise.resolve(true)),
  MCPServersRegistry: { getInstance: () => mockRegistryInstance },
}));

jest.mock('librechat-data-provider', () => ({
  CacheKeys: { FLOWS: 'flows' },
  Constants: { mcp_delimiter: '_mcp_', mcp_prefix: 'mcp_' },
  ContentTypes: { TEXT: 'text' },
  isAssistantsEndpoint: jest.fn(() => false),
}));

jest.mock('@librechat/agents', () => ({
  Providers: { VERTEXAI: 'vertexai', GOOGLE: 'google' },
  StepTypes: { TOOL_CALLS: 'tool_calls' },
  GraphEvents: { ON_RUN_STEP_DELTA: 'on_run_step_delta', ON_RUN_STEP: 'on_run_step' },
  Constants: { CONTENT_AND_ARTIFACT: 'content_and_artifact' },
}));

jest.mock('@keyv/redis', () => ({}));
jest.mock('keyv', () => jest.fn());

const { createMCPTool } = require('./MCP');

async function makeTool() {
  const toolDefinition = {
    function: {
      description: 'fake MCP tool',
      parameters: { type: 'object', properties: {} },
    },
  };
  const availableTools = { [`fake_tool_mcp_server-one`]: toolDefinition };
  return createMCPTool({
    res: {},
    user: { id: 'user-xyz' },
    provider: 'openai',
    availableTools,
    toolKey: `fake_tool_mcp_server-one`,
    config: { url: undefined },
  });
}

function buildConfig({ conversationId = 'conv-123', userId = 'user-xyz' } = {}) {
  return {
    configurable: {
      user: { id: userId },
    },
    metadata: {
      thread_id: conversationId,
      run_id: 'run-1',
      provider: 'openai',
    },
    toolCall: { args: {}, stepId: 'step-1' },
  };
}

describe('MCP _call — framework-reserved context injection', () => {
  beforeEach(() => {
    mockCallTool.mockReset();
    mockCallTool.mockResolvedValue([{ type: 'text', text: 'ok' }]);
  });

  test('injects _librechat_conversation_id into MCP tool args', async () => {
    const instance = await makeTool();
    await instance._call({ path: '/foo.pdf' }, buildConfig({ conversationId: 'abc-123' }));
    expect(mockCallTool).toHaveBeenCalledTimes(1);
    const passedArgs = mockCallTool.mock.calls[0][0].toolArguments;
    expect(passedArgs._librechat_conversation_id).toBe('abc-123');
  });

  test('injects _librechat_user_id into MCP tool args', async () => {
    const instance = await makeTool();
    await instance._call({ path: '/foo.pdf' }, buildConfig({ userId: 'user-xyz' }));
    const passedArgs = mockCallTool.mock.calls[0][0].toolArguments;
    expect(passedArgs._librechat_user_id).toBe('user-xyz');
  });

  test('overrides LLM-supplied _librechat_user_id (anti-spoof)', async () => {
    const instance = await makeTool();
    await instance._call(
      { path: '/foo.pdf', _librechat_user_id: 'admin-account', _librechat_conversation_id: 'other' },
      buildConfig({ conversationId: 'conv-real', userId: 'user-xyz' }),
    );
    const passedArgs = mockCallTool.mock.calls[0][0].toolArguments;
    expect(passedArgs._librechat_user_id).toBe('user-xyz');
    expect(passedArgs._librechat_conversation_id).toBe('conv-real');
  });

  test('does not mutate the caller-provided toolArguments object', async () => {
    const instance = await makeTool();
    const original = { path: '/foo.pdf' };
    await instance._call(original, buildConfig());
    expect(original).toEqual({ path: '/foo.pdf' });
  });
});
