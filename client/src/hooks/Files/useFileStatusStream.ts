import { useEffect, useRef, useState, useMemo } from 'react';
import { SSE } from 'sse.js';
import { useAuthContext } from '~/hooks/AuthContext';
import type { PathStatus } from '~/components/Chat/Input/Files/FileStatusChip';
import type { SessionFile } from '~/components/Chat/Input/Files/SessionFileChip';

interface StatusEvent {
  file_id: string;
  filename?: string;
  conversationId?: string;
  userId?: string;
  path: 'inline' | 'rag' | 'mount';
  state: NonNullable<PathStatus['inline']>;
  reason?: string;
  chars?: number;
  chunks?: number;
  timestamp?: string;
}

interface SessionFileEvent {
  conversationId?: string;
  userId?: string;
  session_file: SessionFile;
  timestamp?: string;
}

interface UseFileStatusStreamArgs {
  enabled: boolean;
  conversationId?: string | null;
  initialSessionFiles?: SessionFile[];
}

interface UseFileStatusStreamResult {
  pathStatusByFileId: Record<string, PathStatus>;
  sessionFiles: SessionFile[];
}

/**
 * Phase 2 — single SSE subscription to /api/files/status-stream that fans out
 * pathStatus updates per file_id and conversation-level session_file events.
 *
 * Auth: passes the JWT bearer token explicitly via sse.js headers (native
 * EventSource cannot, since LibreChat's requireJwtAuth middleware reads from
 * the Authorization header only — see api/strategies/jwtStrategy.js).
 *
 * Defensive when:
 *   - FILE_ROUTING_V2 flag is OFF on the backend → no pathStatus events
 *     emitted; the hook simply returns empty maps. Existing UI keeps working.
 *   - Token is missing / connection fails → the catch swallows it; UI degrades
 *     gracefully to "no live updates" rather than crashing.
 *   - Connection drops → sse.js reconnects automatically via stream events,
 *     but state can be lost. Acceptable per Phase-2 plan; full reload-recovery
 *     via REST is Phase-3 backlog.
 *
 * Single connection per consumer — mount this hook once at the FileRow level,
 * not per individual chip, to stay under the browser's HTTP/2 stream cap.
 */
export default function useFileStatusStream({
  enabled,
  conversationId,
  initialSessionFiles,
}: UseFileStatusStreamArgs): UseFileStatusStreamResult {
  const { token, isAuthenticated } = useAuthContext();
  const [pathStatusByFileId, setPathStatusByFileId] = useState<Record<string, PathStatus>>({});
  const [liveSessionFiles, setLiveSessionFiles] = useState<SessionFile[]>([]);
  const sseRef = useRef<SSE | null>(null);

  // codex polish-iter-2 (F2-bis): the in-effect reset still leaves one
  // render where state belongs to the previous (conversationId, token)
  // tuple — long enough to flash a stale chip after navigation. We track
  // the scope synchronously in a ref and gate the *returned* values on
  // a match, so the very first render of a new scope yields empty maps
  // even before the effect's reset has flushed.
  //
  // codex polish-iter-3: BOTH sides of the comparison must use the same
  // normalization (`?? null`), otherwise `null === undefined` for callers
  // that pass no conversationId would keep `scopeMatches` permanently
  // false and silently swallow every status / session_file event.
  // codex polish-iter-4: inlined at both sites instead of via named
  // intermediate vars — keeps `useEffect` deps on the raw `conversationId`
  // and `token` (intentional, so undefined → null still re-opens the
  // stream) without tripping `react-hooks/exhaustive-deps`.
  const scopeRef = useRef<{ conversationId: string | null; token: string | null }>({
    conversationId: null,
    token: null,
  });
  const scopeMatches =
    scopeRef.current.conversationId === (conversationId ?? null) &&
    scopeRef.current.token === (token ?? null);

  useEffect(() => {
    // Fresh connection = fresh state. Prevents chips from one conversation
    // (or one logged-in user) bleeding into the next when this hook stays
    // mounted across navigation (codex review F2). React bails out of
    // re-renders when setState is called with the same empty-shape value,
    // so the no-op case (initial mount) is free. Updating scopeRef here
    // (post-reset) is what flips `scopeMatches` true on the next render.
    setPathStatusByFileId({});
    setLiveSessionFiles([]);
    scopeRef.current = { conversationId: conversationId ?? null, token: token ?? null };

    if (!enabled || !isAuthenticated || !token) return;

    const url = conversationId
      ? `/api/files/status-stream?conversationId=${encodeURIComponent(conversationId)}`
      : '/api/files/status-stream';

    let sse: SSE | null = null;
    try {
      sse = new SSE(url, {
        headers: { Authorization: `Bearer ${token}` },
        method: 'GET',
      });
      sseRef.current = sse;
    } catch (err) {
      // sse.js constructor failures (CSP, blocked etc.) — swallow, no live UX.
      console.warn('[useFileStatusStream] failed to open SSE:', err);
      return;
    }

    const onStatus = (e: MessageEvent) => {
      try {
        const evt: StatusEvent = JSON.parse(e.data);
        if (!evt.file_id || !evt.path) return;
        setPathStatusByFileId((prev) => {
          const current = prev[evt.file_id] ?? {};
          const entry: Record<string, unknown> = { state: evt.state };
          if (evt.reason !== undefined) entry.reason = evt.reason;
          if (evt.chars !== undefined) entry.chars = evt.chars;
          if (evt.chunks !== undefined) entry.chunks = evt.chunks;
          return {
            ...prev,
            [evt.file_id]: { ...current, [evt.path]: entry },
          };
        });
      } catch {
        /* malformed event — ignore */
      }
    };

    const onSessionFile = (e: MessageEvent) => {
      try {
        const evt: SessionFileEvent = JSON.parse(e.data);
        const sf = evt.session_file;
        if (!sf || !sf.file_id || !sf.session_id) return;
        setLiveSessionFiles((prev) => {
          if (prev.some((p) => p.session_id === sf.session_id && p.file_id === sf.file_id)) {
            return prev;
          }
          return [...prev, sf];
        });
      } catch {
        /* malformed event — ignore */
      }
    };

    sse.addEventListener('status', onStatus);
    sse.addEventListener('session_file', onSessionFile);
    sse.stream();

    return () => {
      try {
        sse?.removeEventListener('status', onStatus);
        sse?.removeEventListener('session_file', onSessionFile);
        sse?.close();
      } catch {
        /* connection already closed — ignore */
      }
      sseRef.current = null;
    };
  }, [enabled, isAuthenticated, token, conversationId]);

  // Merge initial (server-rendered) session_files with live SSE updates.
  // Live entries take precedence on (session_id, file_id) collision since
  // they reflect the most recent register. When the synchronous scope
  // guard reports a mismatch (just changed conversationId/token), drop the
  // live entries so this render shows initialSessionFiles only — no
  // bleeding from the previous scope.
  const sessionFiles = useMemo(() => {
    const merged = [...(initialSessionFiles ?? [])];
    if (!scopeMatches) {
      return merged;
    }
    const seen = new Set(merged.map((s) => `${s.session_id}::${s.file_id}`));
    for (const live of liveSessionFiles) {
      const key = `${live.session_id}::${live.file_id}`;
      if (!seen.has(key)) {
        merged.push(live);
        seen.add(key);
      }
    }
    return merged;
  }, [initialSessionFiles, liveSessionFiles, scopeMatches]);

  return {
    // Return empty pathStatus on a stale-scope render so chips don't briefly
    // carry data from the previous conversationId/token before the effect's
    // reset flushes (codex F2-bis).
    pathStatusByFileId: scopeMatches ? pathStatusByFileId : {},
    sessionFiles,
  };
}
