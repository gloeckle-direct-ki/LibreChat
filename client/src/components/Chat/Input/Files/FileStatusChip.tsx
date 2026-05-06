import React from 'react';
import { cn } from '~/utils';

type PathState =
  | 'pending'
  | 'ready'
  | 'loaded'
  | 'embedded'
  | 'failed'
  | 'skipped'
  | undefined;

interface PathStatusEntry {
  state?: PathState;
  reason?: string;
  chars?: number;
  chunks?: number;
  completed_at?: string | Date;
}

type Path = PathStatusEntry | PathState | null;

export interface PathStatus {
  mount?: Path;
  inline?: Path;
  rag?: Path;
}

const norm = (p: Path | undefined): PathStatusEntry => {
  if (p == null) return {};
  if (typeof p === 'string') return { state: p };
  return p;
};

/**
 * Live status chip for an uploaded file. Reads `metadata.pathStatus` (mount /
 * inline / rag) and renders one or more localized status fragments joined with
 * a separator, with an aggregate color (success/warn/error/pending).
 *
 * Defensive against three known edge cases:
 *   1. `pathStatus === undefined` for Pre-Phase-3 file rows (S5 stale-risk).
 *   2. `pathStatus === {}` while pipelines are still in flight.
 *   3. `state === 'skipped'` for paths that don't apply to a file (e.g. RAG
 *      on a small CSV) — rendered silently to avoid clutter.
 *
 * Status text is German because the user-base is German-speaking; all copy
 * is mirrored in the UAT-Playbook (S1-S7) for verification.
 */
const FileStatusChip: React.FC<{ pathStatus: PathStatus | null | undefined }> = ({
  pathStatus,
}) => {
  const ps: PathStatus = pathStatus ?? {};
  const mount = norm(ps.mount);
  const inline = norm(ps.inline);
  const rag = norm(ps.rag);

  const knownPaths = [mount, inline, rag].filter((p) => p.state !== undefined);
  const failedPaths = knownPaths.filter((p) => p.state === 'failed');
  const successPaths = knownPaths.filter(
    (p) => p.state === 'ready' || p.state === 'loaded' || p.state === 'embedded',
  );
  const pendingPaths = knownPaths.filter((p) => p.state === 'pending');

  // S5 + flag-OFF: nothing to render → generic "verarbeitet" stub.
  if (knownPaths.length === 0) {
    return (
      <span
        className={cn('file-status-chip', 'chip-pending')}
        title="Datei wird verarbeitet"
      >
        wird verarbeitet …
      </span>
    );
  }

  // Mount failure (e.g. T-34 MIME-Filter reject) trumps everything else: if
  // the upload itself died, nothing downstream matters and the user needs the
  // actionable reason front and center.
  if (mount.state === 'failed') {
    return (
      <span
        className={cn('file-status-chip', 'chip-error')}
        title={mount.reason || 'Upload abgebrochen'}
      >
        ❌ Upload abgebrochen{mount.reason ? `: ${mount.reason}` : ''}
      </span>
    );
  }

  // Terminal failure: every other known path failed (no path produced
  // anything usable).
  const allFailed = knownPaths.length > 0 && knownPaths.every((p) => p.state === 'failed');
  if (allFailed) {
    const reasons = failedPaths
      .map((p) => p.reason)
      .filter((r): r is string => Boolean(r))
      .join(' / ');
    return (
      <span
        className={cn('file-status-chip', 'chip-error')}
        title={reasons || 'Datei nicht verarbeitbar'}
      >
        ❌ Datei nicht verarbeitbar
      </span>
    );
  }

  const parts: string[] = [];
  // mount.state === 'failed' is handled by the early return above; here we
  // only build composite text for partial successes (inline/rag).
  if (inline.state === 'loaded') {
    parts.push(
      inline.chars != null
        ? `Im Chat-Kontext geladen ✓ (${inline.chars} Zeichen)`
        : 'Im Chat-Kontext geladen ✓',
    );
  }
  if (inline.state === 'failed') {
    parts.push(`⚠ Inline-Extraktion fehlgeschlagen${inline.reason ? `: ${inline.reason}` : ''}`);
  }
  if (rag.state === 'embedded') {
    parts.push(
      rag.chunks != null
        ? `Wissensbasis indexiert ✓ (${rag.chunks} Chunks)`
        : 'Wissensbasis indexiert ✓',
    );
  }
  if (rag.state === 'pending') {
    parts.push('Wissensbasis: indexiert wird …');
  }
  if (rag.state === 'failed') {
    parts.push(`⚠ Indexierung fehlgeschlagen${rag.reason ? `: ${rag.reason}` : ''}`);
  }

  // Color: any failure → warn, all pending and no success yet → pending,
  // otherwise success. (allFailed is already handled above.)
  let colorClass = 'chip-success';
  if (failedPaths.length > 0) {
    colorClass = 'chip-warn';
  } else if (pendingPaths.length > 0 && successPaths.length === 0) {
    colorClass = 'chip-pending';
  }

  // Tooltip carries failure reasons (for the warn color); for success we leave it
  // off so screen readers don't get noisy duplicates of visible chip text.
  const tooltip =
    failedPaths.map((p) => p.reason).filter((r): r is string => Boolean(r)).join(' / ') ||
    undefined;

  if (parts.length === 0) {
    // Known paths but none in a renderable state (e.g. all skipped).
    return (
      <span
        className={cn('file-status-chip', 'chip-pending')}
        title="Datei wird verarbeitet"
      >
        wird verarbeitet …
      </span>
    );
  }

  return (
    <span className={cn('file-status-chip', colorClass)} title={tooltip}>
      {parts.join(' · ')}
    </span>
  );
};

export default FileStatusChip;
