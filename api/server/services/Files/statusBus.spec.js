const { statusBus, emitStatusUpdate, emitSessionFileUpdate } = require('./statusBus');

describe('statusBus', () => {
  afterEach(() => {
    statusBus.removeAllListeners();
  });

  it('emitStatusUpdate broadcasts a status event with the payload', (done) => {
    const payload = {
      file_id: 'f1',
      filename: 'a.pdf',
      conversationId: 'c1',
      userId: 'u1',
      path: 'inline',
      state: 'loaded',
      chars: 1234,
    };
    statusBus.on('status', (received) => {
      expect(received).toMatchObject(payload);
      done();
    });
    emitStatusUpdate(payload);
  });

  it('emitSessionFileUpdate broadcasts a session_file event', (done) => {
    const payload = {
      conversationId: 'c1',
      userId: 'u1',
      session_file: { session_id: 'A', file_id: 'f1', filename: 'out.csv' },
    };
    statusBus.on('session_file', (received) => {
      expect(received).toMatchObject(payload);
      done();
    });
    emitSessionFileUpdate(payload);
  });

  it('multiple listeners receive the same status event', () => {
    const received = [];
    statusBus.on('status', (e) => received.push(['l1', e.file_id]));
    statusBus.on('status', (e) => received.push(['l2', e.file_id]));
    emitStatusUpdate({ file_id: 'f9' });
    expect(received).toEqual([
      ['l1', 'f9'],
      ['l2', 'f9'],
    ]);
  });

  it('does not throw when emitting with no listeners', () => {
    expect(() => emitStatusUpdate({ file_id: 'lonely' })).not.toThrow();
    expect(() => emitSessionFileUpdate({ conversationId: 'lonely' })).not.toThrow();
  });
});
