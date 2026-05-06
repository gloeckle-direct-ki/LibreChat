const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');

/**
 * Extract text from a freshly uploaded file via rag-api.
 *
 * Calls the existing rag-api `POST /text` endpoint (see
 * `app/routes/document_routes.py:extract_text_from_file`), which extracts
 * text without embedding — no rows in `langchain_pg_embedding`. The
 * pre-extraction-webhook is also wired into that endpoint, so OCR-sidecar
 * results flow through automatically.
 *
 * Note: the Phase 3 plan called this endpoint `/extract`. We use the
 * pre-existing `/text` endpoint instead — it has the same contract
 * (text-only, no embedding) and adding a duplicate `/extract` would just be
 * naming churn.
 *
 * @param {Object} params
 * @param {string} params.filepath - Local path to read the file from
 * @param {string} params.filename - Original filename (sent to rag-api)
 * @param {string} params.file_id  - File-id (rag-api requires this as Form field)
 * @param {string} [params.entity_id]
 * @returns {Promise<{ text: string, chars: number, filename: string }>}
 * @throws when RAG_API_URL is unset, the upstream call fails, or
 *         `known_type === false` (unsupported MIME).
 */
async function extractInlineText({ filepath, filename, file_id, entity_id }) {
  if (!process.env.RAG_API_URL) {
    throw new Error('RAG_API_URL not defined');
  }

  const form = new FormData();
  form.append('file_id', file_id);
  form.append('file', fs.createReadStream(filepath), filename);
  if (entity_id) {
    form.append('entity_id', entity_id);
  }

  const response = await axios.post(`${process.env.RAG_API_URL}/text`, form, {
    headers: form.getHeaders ? form.getHeaders() : {},
    timeout: 60_000,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
  });

  const data = response.data || {};
  if (data.known_type === false) {
    throw new Error(
      `extractInlineText: rag-api reported known_type=false for ${filename}`,
    );
  }

  const text = typeof data.text === 'string' ? data.text : '';
  return {
    text,
    chars: text.length,
    filename: data.filename || filename,
  };
}

module.exports = { extractInlineText };
