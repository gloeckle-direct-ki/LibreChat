/**
 * Phase 3 routing decision: per file, decide which paths apply.
 *
 *   mount  : copy file into the code-interpreter session (always for any upload)
 *   inline : extract text and inject into the chat context as a system block
 *   rag    : embed via rag-api for chunk-based retrieval at chat time
 *
 * Pure function — no I/O, no logging, no DB access. The caller takes the
 * decision and runs the corresponding pipelines.
 */

const TEXT_BEARING_REGEX =
  /^(text\/|application\/(pdf|json|xml|x-yaml|csv)|application\/vnd\.openxmlformats-officedocument\.)/;

const INLINE_THRESHOLD = 20 * 1024;

function routeFile({ mime, size }) {
  const isTextBearing = TEXT_BEARING_REGEX.test(mime);
  return {
    mount: true,
    inline: isTextBearing && size < INLINE_THRESHOLD,
    rag: isTextBearing && size >= INLINE_THRESHOLD,
  };
}

module.exports = { routeFile, INLINE_THRESHOLD, TEXT_BEARING_REGEX };
