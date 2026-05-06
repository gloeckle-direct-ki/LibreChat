import React from 'react';
import { renderHook, act } from '@testing-library/react';
import '@testing-library/jest-dom';

let sseInstances: MockSSE[] = [];

class MockSSE {
  url: string;
  options: any;
  listeners: Record<string, ((e: any) => void)[]> = {};
  closed = false;
  streamCalled = false;

  constructor(url: string, options: any) {
    this.url = url;
    this.options = options;
    sseInstances.push(this);
  }
  addEventListener(name: string, cb: (e: any) => void) {
    if (!this.listeners[name]) this.listeners[name] = [];
    this.listeners[name].push(cb);
  }
  removeEventListener(name: string, cb: (e: any) => void) {
    this.listeners[name] = (this.listeners[name] ?? []).filter((l) => l !== cb);
  }
  stream() {
    this.streamCalled = true;
  }
  close() {
    this.closed = true;
  }
  dispatch(name: string, data: unknown) {
    (this.listeners[name] ?? []).forEach((cb) => cb({ data: JSON.stringify(data) }));
  }
}

jest.mock('sse.js', () => ({ SSE: jest.fn() }));
const sseModule = jest.requireMock('sse.js') as { SSE: jest.Mock };

let mockToken = 'tok-abc';
let mockAuthenticated = true;
jest.mock('~/hooks/AuthContext', () => ({
  useAuthContext: () => ({ token: mockToken, isAuthenticated: mockAuthenticated }),
}));

import useFileStatusStream from './useFileStatusStream';

describe('useFileStatusStream', () => {
  beforeEach(() => {
    sseInstances = [];
    sseModule.SSE.mockImplementation((url: string, opts: any) => new MockSSE(url, opts));
    mockToken = 'tok-abc';
    mockAuthenticated = true;
  });

  it('opens an SSE connection with bearer token when enabled', () => {
    renderHook(() =>
      useFileStatusStream({ enabled: true, conversationId: 'c1' }),
    );
    expect(sseInstances).toHaveLength(1);
    expect(sseInstances[0].url).toBe('/api/files/status-stream?conversationId=c1');
    expect(sseInstances[0].options.headers.Authorization).toBe('Bearer tok-abc');
    expect(sseInstances[0].streamCalled).toBe(true);
  });

  it('opens without conversationId param when none provided', () => {
    renderHook(() => useFileStatusStream({ enabled: true }));
    expect(sseInstances[0].url).toBe('/api/files/status-stream');
  });

  it('does not open SSE when enabled=false', () => {
    renderHook(() => useFileStatusStream({ enabled: false, conversationId: 'c1' }));
    expect(sseInstances).toHaveLength(0);
  });

  it('does not open SSE when not authenticated', () => {
    mockAuthenticated = false;
    renderHook(() => useFileStatusStream({ enabled: true, conversationId: 'c1' }));
    expect(sseInstances).toHaveLength(0);
  });

  it('updates pathStatusByFileId on status events', () => {
    const { result } = renderHook(() =>
      useFileStatusStream({ enabled: true, conversationId: 'c1' }),
    );
    expect(result.current.pathStatusByFileId).toEqual({});

    act(() => {
      sseInstances[0].dispatch('status', {
        file_id: 'f1',
        path: 'inline',
        state: 'loaded',
        chars: 1234,
      });
    });

    expect(result.current.pathStatusByFileId['f1']).toEqual({
      inline: { state: 'loaded', chars: 1234 },
    });
  });

  it('merges multiple paths for the same file', () => {
    const { result } = renderHook(() =>
      useFileStatusStream({ enabled: true, conversationId: 'c1' }),
    );

    act(() => {
      sseInstances[0].dispatch('status', {
        file_id: 'f1',
        path: 'inline',
        state: 'loaded',
        chars: 100,
      });
      sseInstances[0].dispatch('status', {
        file_id: 'f1',
        path: 'rag',
        state: 'embedded',
        chunks: 5,
      });
    });

    expect(result.current.pathStatusByFileId['f1']).toEqual({
      inline: { state: 'loaded', chars: 100 },
      rag: { state: 'embedded', chunks: 5 },
    });
  });

  it('appends session_file events with dedup on (session_id, file_id)', () => {
    const { result } = renderHook(() =>
      useFileStatusStream({ enabled: true, conversationId: 'c1' }),
    );

    act(() => {
      sseInstances[0].dispatch('session_file', {
        conversationId: 'c1',
        session_file: { session_id: 'A', file_id: 'f1', filename: 'out.csv' },
      });
      sseInstances[0].dispatch('session_file', {
        conversationId: 'c1',
        session_file: { session_id: 'A', file_id: 'f1', filename: 'out.csv' }, // dup
      });
      sseInstances[0].dispatch('session_file', {
        conversationId: 'c1',
        session_file: { session_id: 'A', file_id: 'f2', filename: 'out2.csv' },
      });
    });

    expect(result.current.sessionFiles).toHaveLength(2);
    expect(result.current.sessionFiles.map((s) => s.file_id)).toEqual(['f1', 'f2']);
  });

  it('seeds session_files from initialSessionFiles prop and merges with live', () => {
    const { result } = renderHook(() =>
      useFileStatusStream({
        enabled: true,
        conversationId: 'c1',
        initialSessionFiles: [
          { session_id: 'old', file_id: 'fOld', filename: 'old.csv' },
        ],
      }),
    );

    expect(result.current.sessionFiles).toHaveLength(1);
    expect(result.current.sessionFiles[0].file_id).toBe('fOld');

    act(() => {
      sseInstances[0].dispatch('session_file', {
        session_file: { session_id: 'new', file_id: 'fNew', filename: 'new.csv' },
      });
    });

    expect(result.current.sessionFiles).toHaveLength(2);
    expect(result.current.sessionFiles.map((s) => s.file_id).sort()).toEqual(['fNew', 'fOld']);
  });

  it('closes the SSE connection on unmount', () => {
    const { unmount } = renderHook(() =>
      useFileStatusStream({ enabled: true, conversationId: 'c1' }),
    );
    expect(sseInstances[0].closed).toBe(false);
    unmount();
    expect(sseInstances[0].closed).toBe(true);
  });

  it('ignores malformed JSON in events without crashing', () => {
    const { result } = renderHook(() =>
      useFileStatusStream({ enabled: true, conversationId: 'c1' }),
    );
    act(() => {
      const cb = sseInstances[0].listeners['status']?.[0];
      expect(() => cb && cb({ data: 'not-json{' })).not.toThrow();
    });
    expect(result.current.pathStatusByFileId).toEqual({});
  });

  it('ignores status events missing file_id or path', () => {
    const { result } = renderHook(() =>
      useFileStatusStream({ enabled: true, conversationId: 'c1' }),
    );
    act(() => {
      sseInstances[0].dispatch('status', { state: 'loaded' });
      sseInstances[0].dispatch('status', { file_id: 'f1', state: 'loaded' });
    });
    expect(result.current.pathStatusByFileId).toEqual({});
  });

  it('survives SSE constructor throw and returns empty maps', () => {
    sseModule.SSE.mockImplementationOnce(() => {
      throw new Error('CSP block');
    });
    const { result } = renderHook(() =>
      useFileStatusStream({ enabled: true, conversationId: 'c1' }),
    );
    expect(result.current.pathStatusByFileId).toEqual({});
    expect(result.current.sessionFiles).toEqual([]);
  });

  // Codex review F2 — stale state across conversations.
  describe('state reset on subscription change', () => {
    it('clears pathStatusByFileId when conversationId changes', () => {
      const { result, rerender } = renderHook(
        ({ cid }) => useFileStatusStream({ enabled: true, conversationId: cid }),
        { initialProps: { cid: 'c1' } },
      );

      act(() => {
        sseInstances[0].dispatch('status', {
          file_id: 'f1',
          path: 'inline',
          state: 'loaded',
          chars: 50,
        });
      });
      expect(result.current.pathStatusByFileId['f1']).toBeDefined();

      rerender({ cid: 'c2' });

      expect(result.current.pathStatusByFileId).toEqual({});
    });

    it('clears live sessionFiles when conversationId changes', () => {
      const { result, rerender } = renderHook(
        ({ cid }) => useFileStatusStream({ enabled: true, conversationId: cid }),
        { initialProps: { cid: 'c1' } },
      );

      act(() => {
        sseInstances[0].dispatch('session_file', {
          session_file: { session_id: 'A', file_id: 'sf-1', filename: 'old.csv' },
        });
      });
      expect(result.current.sessionFiles).toHaveLength(1);

      rerender({ cid: 'c2' });

      expect(result.current.sessionFiles).toEqual([]);
    });

    it('resets state when token changes (logout / re-login on same browser)', () => {
      const { result, rerender } = renderHook(() =>
        useFileStatusStream({ enabled: true, conversationId: 'c1' }),
      );

      act(() => {
        sseInstances[0].dispatch('status', {
          file_id: 'f1',
          path: 'rag',
          state: 'embedded',
          chunks: 3,
        });
      });
      expect(result.current.pathStatusByFileId['f1']).toBeDefined();

      mockToken = 'tok-new-user';
      rerender();

      expect(result.current.pathStatusByFileId).toEqual({});
    });

    it('does not reset state when none of the deps changed (re-render no-op)', () => {
      const { result, rerender } = renderHook(() =>
        useFileStatusStream({ enabled: true, conversationId: 'c1' }),
      );

      act(() => {
        sseInstances[0].dispatch('status', {
          file_id: 'f1',
          path: 'inline',
          state: 'loaded',
          chars: 10,
        });
      });
      expect(result.current.pathStatusByFileId['f1']).toBeDefined();

      rerender();

      expect(result.current.pathStatusByFileId['f1']).toBeDefined();
    });
  });

  // Codex polish-iter-2 review F2-bis — the in-effect reset still leaves one
  // render where the previous scope's state is exposed. Captures every render
  // via a probe component and asserts no render under the new scope ever sees
  // data that belonged to the old scope.
  describe('synchronous scope guard (codex F2-bis)', () => {
    function captureRenders() {
      const observed: Array<{
        cid: string | null | undefined;
        pathStatus: Record<string, unknown>;
        sessionFiles: number;
      }> = [];
      const Probe: React.FC<{ cid: string }> = ({ cid }) => {
        const { pathStatusByFileId, sessionFiles } = useFileStatusStream({
          enabled: true,
          conversationId: cid,
        });
        observed.push({
          cid,
          pathStatus: { ...pathStatusByFileId },
          sessionFiles: sessionFiles.length,
        });
        return null;
      };
      return { observed, Probe };
    }

    it('never exposes prev-scope pathStatus under a new conversationId', async () => {
      const { render, act: actRTL } = await import('@testing-library/react');
      const { observed, Probe } = captureRenders();

      const { rerender } = render(<Probe cid="c1" />);
      actRTL(() => {
        sseInstances[0].dispatch('status', {
          file_id: 'f-old',
          path: 'inline',
          state: 'loaded',
          chars: 99,
        });
      });

      rerender(<Probe cid="c2" />);

      const violations = observed.filter(
        (o) => o.cid === 'c2' && (o.pathStatus as Record<string, unknown>)['f-old'] !== undefined,
      );
      expect(violations).toEqual([]);
    });

    it('never exposes prev-scope sessionFiles under a new conversationId', async () => {
      const { render, act: actRTL } = await import('@testing-library/react');
      const { observed, Probe } = captureRenders();

      const { rerender } = render(<Probe cid="c1" />);
      actRTL(() => {
        sseInstances[0].dispatch('session_file', {
          session_file: { session_id: 'A', file_id: 'sf-old', filename: 'old.csv' },
        });
      });

      rerender(<Probe cid="c2" />);

      // c2 should never see a sessionFiles entry that came from the c1 scope.
      // (initialSessionFiles is unspecified here, so the only source is the
      // live event dispatched under c1.)
      const violations = observed.filter((o) => o.cid === 'c2' && o.sessionFiles > 0);
      expect(violations).toEqual([]);
    });

    // codex polish-iter-2 review re-pass found a P2 regression: scopeRef was
    // written with `?? null` but the render-side compared raw values.
    // For `conversationId: undefined`, `null === undefined` stayed false
    // forever, silently dropping every event from the return value.
    it('iter-3 regression — exposes events when conversationId is undefined', () => {
      const { result } = renderHook(() =>
        useFileStatusStream({ enabled: true /* conversationId: undefined */ }),
      );
      expect(sseInstances).toHaveLength(1);

      act(() => {
        sseInstances[0].dispatch('status', {
          file_id: 'no-convo',
          path: 'inline',
          state: 'loaded',
          chars: 5,
        });
        sseInstances[0].dispatch('session_file', {
          session_file: { session_id: 'X', file_id: 'sf-no-convo', filename: 'noc.csv' },
        });
      });

      expect(result.current.pathStatusByFileId['no-convo']).toEqual({
        inline: { state: 'loaded', chars: 5 },
      });
      expect(result.current.sessionFiles).toEqual([
        { session_id: 'X', file_id: 'sf-no-convo', filename: 'noc.csv' },
      ]);
    });

    it('iter-3 regression — undefined and null normalize equal under scope-key', () => {
      // Defensive: callers may pass `null` explicitly later (e.g. after
      // a loadConvo failure). Both forms must compare equal under the
      // normalize. The rerender re-opens the SSE (deps include raw
      // conversationId, so React sees undefined → null as a change), so
      // the freshly-opened MockSSE is the last entry in sseInstances.
      const { result, rerender } = renderHook(
        ({ cid }: { cid: string | null | undefined }) =>
          useFileStatusStream({ enabled: true, conversationId: cid }),
        { initialProps: { cid: undefined as string | null | undefined } },
      );

      rerender({ cid: null });

      const latest = sseInstances[sseInstances.length - 1];
      act(() => {
        latest.dispatch('status', {
          file_id: 'after-null',
          path: 'rag',
          state: 'embedded',
          chunks: 4,
        });
      });

      expect(result.current.pathStatusByFileId['after-null']).toEqual({
        rag: { state: 'embedded', chunks: 4 },
      });
    });
  });
});
