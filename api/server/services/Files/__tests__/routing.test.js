const { routeFile, INLINE_THRESHOLD, TEXT_BEARING_REGEX } = require('../routing');

describe('routeFile', () => {
  describe('matrix', () => {
    const cases = [
      // Text-bearing, klein → inline + mount, kein rag
      ['text/plain', 5_000, { mount: true, inline: true, rag: false }],
      ['application/pdf', 10_000, { mount: true, inline: true, rag: false }],
      ['application/json', 1_000, { mount: true, inline: true, rag: false }],
      ['application/xml', 8_000, { mount: true, inline: true, rag: false }],
      ['application/x-yaml', 2_500, { mount: true, inline: true, rag: false }],
      ['text/markdown', 4_000, { mount: true, inline: true, rag: false }],
      ['text/csv', 3_000, { mount: true, inline: true, rag: false }],

      // Boundary: exact threshold → rag (>= INLINE_THRESHOLD goes to rag, not inline)
      ['application/pdf', INLINE_THRESHOLD, { mount: true, inline: false, rag: true }],
      ['text/plain', INLINE_THRESHOLD, { mount: true, inline: false, rag: true }],

      // One byte below threshold → still inline
      ['application/pdf', INLINE_THRESHOLD - 1, { mount: true, inline: true, rag: false }],

      // Text-bearing, groß → rag + mount, kein inline
      ['application/pdf', 100_000, { mount: true, inline: false, rag: true }],
      ['text/csv', 500_000, { mount: true, inline: false, rag: true }],
      ['text/plain', 50_000, { mount: true, inline: false, rag: true }],

      // Office (DOCX/XLSX/PPTX) — text-bearing
      [
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        50_000,
        { mount: true, inline: false, rag: true },
      ],
      [
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        25_000,
        { mount: true, inline: false, rag: true },
      ],
      [
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        80_000,
        { mount: true, inline: false, rag: true },
      ],
      [
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        10_000,
        { mount: true, inline: true, rag: false },
      ],

      // Nicht text-bearing → nur mount
      ['application/zip', 200_000, { mount: true, inline: false, rag: false }],
      ['application/x-tar', 50_000, { mount: true, inline: false, rag: false }],
      ['image/png', 50_000, { mount: true, inline: false, rag: false }],
      ['image/jpeg', 1_000, { mount: true, inline: false, rag: false }],
      ['video/mp4', 50_000_000, { mount: true, inline: false, rag: false }],
      ['audio/mpeg', 5_000_000, { mount: true, inline: false, rag: false }],

      // Edge: 0-byte text-bearing
      ['text/plain', 0, { mount: true, inline: true, rag: false }],

      // Edge: unknown MIME
      ['application/octet-stream', 5_000, { mount: true, inline: false, rag: false }],
      ['application/octet-stream', 100_000, { mount: true, inline: false, rag: false }],
    ];

    cases.forEach(([mime, size, expected]) => {
      it(`mime=${mime} size=${size} → ${JSON.stringify(expected)}`, () => {
        expect(routeFile({ mime, size })).toEqual(expected);
      });
    });
  });

  describe('exports', () => {
    it('exports INLINE_THRESHOLD as 20 KB', () => {
      expect(INLINE_THRESHOLD).toBe(20 * 1024);
    });

    it('exports TEXT_BEARING_REGEX', () => {
      expect(TEXT_BEARING_REGEX).toBeInstanceOf(RegExp);
      expect(TEXT_BEARING_REGEX.test('text/plain')).toBe(true);
      expect(TEXT_BEARING_REGEX.test('application/zip')).toBe(false);
    });
  });

  describe('invariants', () => {
    it('mount is always true', () => {
      const samples = [
        ['application/zip', 100],
        ['image/png', 999_999_999],
        ['text/plain', 0],
        ['application/octet-stream', 5_000],
      ];
      samples.forEach(([mime, size]) => {
        expect(routeFile({ mime, size }).mount).toBe(true);
      });
    });

    it('inline and rag are mutually exclusive', () => {
      const samples = [
        ['text/plain', 100],
        ['application/pdf', 50_000],
        ['application/zip', 100],
        ['image/png', 50_000],
      ];
      samples.forEach(([mime, size]) => {
        const r = routeFile({ mime, size });
        expect(r.inline && r.rag).toBe(false);
      });
    });
  });
});
