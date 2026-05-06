import React from 'react';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import SessionFileChip from '../SessionFileChip';

describe('SessionFileChip', () => {
  it('renders the filename and "vom Code generiert" badge', () => {
    const { container } = render(
      <SessionFileChip
        sessionFile={{ session_id: 'A', file_id: 'f1', filename: 'out.csv' }}
      />,
    );
    expect(container.textContent).toContain('out.csv');
    expect(container.textContent).toMatch(/vom Code generiert/i);
  });

  it('puts the session_id in the tooltip for debugging', () => {
    const { container } = render(
      <SessionFileChip
        sessionFile={{
          session_id: 'session-abc',
          file_id: 'f1',
          filename: 'a.txt',
        }}
      />,
    );
    const chip = container.querySelector('.file-status-chip');
    expect(chip?.getAttribute('title') ?? '').toContain('session-abc');
  });

  it('renders the package icon prefix', () => {
    const { container } = render(
      <SessionFileChip
        sessionFile={{ session_id: 'A', file_id: 'f1', filename: 'out.csv' }}
      />,
    );
    expect(container.textContent).toContain('📦');
  });

  it('uses chip-success styling (success state for generated files)', () => {
    const { container } = render(
      <SessionFileChip
        sessionFile={{ session_id: 'A', file_id: 'f1', filename: 'out.csv' }}
      />,
    );
    expect(container.querySelector('.chip-success')).toBeTruthy();
  });

  it('does not throw when generated_at is provided as a Date', () => {
    expect(() =>
      render(
        <SessionFileChip
          sessionFile={{
            session_id: 'A',
            file_id: 'f1',
            filename: 'a.csv',
            generated_at: new Date('2026-05-06T12:00:00Z'),
          }}
        />,
      ),
    ).not.toThrow();
  });

  it('does not throw when generated_at is provided as ISO string', () => {
    expect(() =>
      render(
        <SessionFileChip
          sessionFile={{
            session_id: 'A',
            file_id: 'f1',
            filename: 'a.csv',
            generated_at: '2026-05-06T12:00:00Z',
          }}
        />,
      ),
    ).not.toThrow();
  });

  it('truncates long filenames in the title attribute (so tooltip shows full name)', () => {
    const longName = 'a-very-long-export-from-pandas-2026-05-06-final-final.csv';
    const { container } = render(
      <SessionFileChip
        sessionFile={{ session_id: 'A', file_id: 'f1', filename: longName }}
      />,
    );
    const chip = container.querySelector('.file-status-chip');
    expect(chip?.getAttribute('title') ?? '').toContain(longName);
  });
});
