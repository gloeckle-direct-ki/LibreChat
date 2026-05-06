import React from 'react';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import FileStatusChip from '../FileStatusChip';

describe('FileStatusChip', () => {
  it('renders inline-loaded with char count', () => {
    const { container } = render(
      <FileStatusChip pathStatus={{ inline: { state: 'loaded', chars: 1234 } }} />,
    );
    expect(container.textContent).toContain('Im Chat-Kontext geladen');
    expect(container.textContent).toContain('1234');
  });

  it('renders rag-embedded with chunk count', () => {
    const { container } = render(
      <FileStatusChip pathStatus={{ rag: { state: 'embedded', chunks: 8 } }} />,
    );
    expect(container.textContent).toContain('Wissensbasis indexiert');
    expect(container.textContent).toContain('8 Chunks');
  });

  it('renders rag-pending with progress hint', () => {
    const { container } = render(
      <FileStatusChip pathStatus={{ rag: { state: 'pending' } }} />,
    );
    expect(container.textContent).toMatch(/indexiert wird/i);
  });

  it('renders combined inline + rag success', () => {
    const { container } = render(
      <FileStatusChip
        pathStatus={{
          inline: { state: 'loaded', chars: 500 },
          rag: { state: 'embedded', chunks: 4 },
        }}
      />,
    );
    expect(container.textContent).toContain('Im Chat-Kontext geladen');
    expect(container.textContent).toContain('Wissensbasis indexiert');
  });

  it('shows ❌ for terminal-failure (all paths failed)', () => {
    const { container } = render(
      <FileStatusChip
        pathStatus={{
          inline: { state: 'failed', reason: 'PDF encrypted' },
          rag: { state: 'failed', reason: 'rag-api 500' },
        }}
      />,
    );
    expect(container.textContent).toContain('nicht verarbeitbar');
    expect(container.textContent).toContain('❌');
  });

  it('shows ⚠ for partial failure (rag failed, inline ok)', () => {
    const { container } = render(
      <FileStatusChip
        pathStatus={{
          inline: { state: 'loaded', chars: 100 },
          rag: { state: 'failed', reason: 'timeout' },
        }}
      />,
    );
    expect(container.textContent).toContain('⚠');
    expect(container.textContent).toMatch(/Indexierung fehlgeschlagen|fehlgeschlagen/);
  });

  it('renders generic "wird verarbeitet" for empty pathStatus object', () => {
    const { container } = render(<FileStatusChip pathStatus={{}} />);
    expect(container.textContent).toMatch(/wird verarbeitet/i);
  });

  it('S5 stale-risk: renders generic state for undefined pathStatus (Pre-Phase-3 file)', () => {
    const { container } = render(<FileStatusChip pathStatus={undefined} />);
    expect(container.textContent).toMatch(/verarbeitet/i);
  });

  it('S5 stale-risk: renders generic state for null pathStatus', () => {
    const { container } = render(<FileStatusChip pathStatus={null} />);
    expect(container.textContent).toMatch(/verarbeitet/i);
  });

  it('does not throw on undefined input (S5 regression guard)', () => {
    expect(() => render(<FileStatusChip pathStatus={undefined} />)).not.toThrow();
  });

  it('handles short-form state strings (inline === "loaded" instead of object)', () => {
    const { container } = render(
      <FileStatusChip pathStatus={{ inline: 'loaded' as any, rag: 'embedded' as any }} />,
    );
    expect(container.textContent).toContain('Im Chat-Kontext geladen');
    expect(container.textContent).toContain('Wissensbasis indexiert');
  });

  it('renders mount-failed when explicit mount: failed is set', () => {
    const { container } = render(
      <FileStatusChip
        pathStatus={{ mount: { state: 'failed', reason: 'MIME-Filter Reject' } }}
      />,
    );
    expect(container.textContent).toContain('Upload abgebrochen');
    expect(container.textContent).toContain('MIME-Filter');
  });

  it('renders rag-skipped silently (no clutter for non-applicable paths)', () => {
    const { container } = render(
      <FileStatusChip
        pathStatus={{
          inline: { state: 'loaded', chars: 50 },
          rag: { state: 'skipped' },
        }}
      />,
    );
    expect(container.textContent).toContain('Im Chat-Kontext geladen');
    expect(container.textContent).not.toMatch(/skipped/i);
  });

  it('exposes a tooltip with the reason on failure', () => {
    const { container } = render(
      <FileStatusChip
        pathStatus={{ rag: { state: 'failed', reason: 'rag-api unreachable' } }}
      />,
    );
    const chip = container.querySelector('.file-status-chip');
    expect(chip).toBeTruthy();
    // Title attribute carries the reason for hover-tooltip.
    expect(chip?.getAttribute('title') ?? '').toMatch(/rag-api unreachable/);
  });

  it('uses chip-success class when all known paths are healthy', () => {
    const { container } = render(
      <FileStatusChip
        pathStatus={{
          inline: { state: 'loaded', chars: 100 },
          rag: { state: 'embedded', chunks: 5 },
        }}
      />,
    );
    expect(container.querySelector('.chip-success')).toBeTruthy();
  });

  it('uses chip-warn class when at least one path failed but others succeeded', () => {
    const { container } = render(
      <FileStatusChip
        pathStatus={{
          inline: { state: 'loaded', chars: 100 },
          rag: { state: 'failed', reason: 'x' },
        }}
      />,
    );
    expect(container.querySelector('.chip-warn')).toBeTruthy();
  });

  it('uses chip-error class when every path failed', () => {
    const { container } = render(
      <FileStatusChip
        pathStatus={{
          inline: { state: 'failed', reason: 'a' },
          rag: { state: 'failed', reason: 'b' },
        }}
      />,
    );
    expect(container.querySelector('.chip-error')).toBeTruthy();
  });

  it('uses chip-pending class while still in flight', () => {
    const { container } = render(
      <FileStatusChip pathStatus={{ rag: { state: 'pending' } }} />,
    );
    expect(container.querySelector('.chip-pending')).toBeTruthy();
  });
});
