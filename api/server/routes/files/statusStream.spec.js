jest.mock('@librechat/data-schemas', () => ({
  logger: { warn: jest.fn(), debug: jest.fn(), info: jest.fn(), error: jest.fn() },
}));

const { statusStreamHandler } = require('./statusStream');
const {
  statusBus,
  emitStatusUpdate,
  emitSessionFileUpdate,
} = require('~/server/services/Files/statusBus');

function makeReq(userId, query = {}) {
  const handlers = {};
  return {
    user: { id: userId },
    query,
    on: (evt, cb) => {
      handlers[evt] = cb;
    },
    _trigger: (evt) => handlers[evt] && handlers[evt](),
  };
}

function makeRes() {
  const writes = [];
  return {
    headers: {},
    writableEnded: false,
    setHeader(k, v) {
      this.headers[k] = v;
    },
    flushHeaders: jest.fn(),
    write(chunk) {
      writes.push(chunk);
    },
    end() {
      this.writableEnded = true;
    },
    flush: jest.fn(),
    writes,
  };
}

describe('GET /api/files/status-stream', () => {
  beforeEach(() => {
    statusBus.removeAllListeners();
  });

  it('sets SSE headers and a comment flush on connect', () => {
    const req = makeReq('u1');
    const res = makeRes();
    statusStreamHandler(req, res);

    expect(res.headers['Content-Type']).toBe('text/event-stream');
    expect(res.headers['Cache-Control']).toMatch(/no-cache/);
    expect(res.headers['Connection']).toBe('keep-alive');
    expect(res.headers['X-Accel-Buffering']).toBe('no');
    expect(res.flushHeaders).toHaveBeenCalled();
    // Initial heartbeat / handshake comment
    expect(res.writes.join('')).toMatch(/^:.*\n\n/);
  });

  it('forwards status events to the matching user only', () => {
    const reqA = makeReq('user-A');
    const resA = makeRes();
    const reqB = makeReq('user-B');
    const resB = makeRes();
    statusStreamHandler(reqA, resA);
    statusStreamHandler(reqB, resB);

    emitStatusUpdate({
      file_id: 'f1',
      filename: 'a.pdf',
      conversationId: 'c1',
      userId: 'user-A',
      path: 'inline',
      state: 'loaded',
      chars: 100,
      timestamp: '2026-05-06T12:00:00.000Z',
    });

    const aText = resA.writes.join('');
    expect(aText).toContain('event: status');
    expect(aText).toContain('"state":"loaded"');
    expect(aText).toContain('"file_id":"f1"');

    const bText = resB.writes.join('');
    expect(bText).not.toContain('"file_id":"f1"');
  });

  it('forwards session_file events to the matching user', () => {
    const req = makeReq('user-A');
    const res = makeRes();
    statusStreamHandler(req, res);

    emitSessionFileUpdate({
      conversationId: 'c1',
      userId: 'user-A',
      session_file: { session_id: 'A', file_id: 'f1', filename: 'out.csv' },
      timestamp: '2026-05-06T12:00:00.000Z',
    });

    const text = res.writes.join('');
    expect(text).toContain('event: session_file');
    expect(text).toContain('"session_id":"A"');
    expect(text).toContain('"filename":"out.csv"');
  });

  it('ignores events for other users (cross-user-leak guard)', () => {
    const req = makeReq('user-A');
    const res = makeRes();
    statusStreamHandler(req, res);

    emitStatusUpdate({ file_id: 'leaked', userId: 'user-B', path: 'inline', state: 'loaded' });

    expect(res.writes.join('')).not.toContain('"file_id":"leaked"');
  });

  it('filters by conversationId when ?conversationId= query is present', () => {
    const req = makeReq('user-A', { conversationId: 'wanted' });
    const res = makeRes();
    statusStreamHandler(req, res);

    emitStatusUpdate({
      file_id: 'f1',
      conversationId: 'wanted',
      userId: 'user-A',
      path: 'rag',
      state: 'embedded',
    });
    emitStatusUpdate({
      file_id: 'f2',
      conversationId: 'unrelated',
      userId: 'user-A',
      path: 'rag',
      state: 'embedded',
    });

    const text = res.writes.join('');
    expect(text).toContain('"file_id":"f1"');
    expect(text).not.toContain('"file_id":"f2"');
  });

  it('passes events with no conversationId through when filter is set (upload-time events)', () => {
    const req = makeReq('user-A', { conversationId: 'wanted' });
    const res = makeRes();
    statusStreamHandler(req, res);

    emitStatusUpdate({
      file_id: 'pre-convo',
      userId: 'user-A',
      conversationId: undefined,
      path: 'inline',
      state: 'loaded',
    });

    expect(res.writes.join('')).toContain('"file_id":"pre-convo"');
  });

  it('cleans up listeners on req close (no leak after disconnect)', () => {
    const req = makeReq('user-A');
    const res = makeRes();
    statusStreamHandler(req, res);

    expect(statusBus.listenerCount('status')).toBe(1);
    expect(statusBus.listenerCount('session_file')).toBe(1);

    req._trigger('close');

    expect(statusBus.listenerCount('status')).toBe(0);
    expect(statusBus.listenerCount('session_file')).toBe(0);
  });

  it('does not write after res ends (avoid post-close write errors)', () => {
    const req = makeReq('user-A');
    const res = makeRes();
    statusStreamHandler(req, res);
    res.writableEnded = true;
    const before = res.writes.length;

    emitStatusUpdate({ userId: 'user-A', file_id: 'after-close', path: 'inline', state: 'loaded' });

    expect(res.writes.length).toBe(before);
  });

  it('rejects unauthenticated requests (no req.user)', () => {
    const req = { query: {}, on: jest.fn() };
    const res = makeRes();
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);

    statusStreamHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
  });
});
