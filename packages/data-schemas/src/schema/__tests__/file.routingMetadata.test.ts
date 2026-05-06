import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import fileSchema from '../file';

/**
 * Phase 3 Task 3 — schema roundtrip for the routing-v2 metadata fields:
 *   metadata.extracted_text  : cached inline-pipeline output
 *   metadata.pathStatus      : per-path state machine (Phase-2-shape, introduced
 *                              in Phase 3 for the routing pipeline). Phase 2
 *                              will layer SSE + UI on top, no new schema.
 *
 * Mongoose strict mode silently drops fields not declared in the schema. If
 * we don't add them here they'd survive in-memory writes but disappear on
 * load — a known sharp edge from Phase 1.
 */
describe('File schema — routing-v2 metadata', () => {
  let mongoServer: MongoMemoryServer;
  let File: mongoose.Model<unknown>;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
    File = mongoose.model('RoutingMetadataTestFile', fileSchema);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await File.deleteMany({});
  });

  const mkBase = (file_id: string) => ({
    user: new mongoose.Types.ObjectId(),
    file_id,
    bytes: 1024,
    filename: 'x.pdf',
    filepath: '/tmp/x.pdf',
    object: 'file',
    type: 'application/pdf',
    usage: 0,
  });

  it('persists metadata.extracted_text on save+load', async () => {
    await File.create({
      ...mkBase('f-extracted-1'),
      metadata: { extracted_text: 'Hallo Welt' },
    });
    const loaded = await File.findOne({ file_id: 'f-extracted-1' }).lean<{
      metadata?: { extracted_text?: string };
    }>();
    expect(loaded?.metadata?.extracted_text).toBe('Hallo Welt');
  });

  it('persists metadata.pathStatus.inline on save+load', async () => {
    const completed_at = new Date('2026-05-06T10:00:00Z');
    await File.create({
      ...mkBase('f-status-1'),
      metadata: {
        pathStatus: {
          inline: { state: 'loaded', chars: 4567, completed_at },
        },
      },
    });
    const loaded = await File.findOne({ file_id: 'f-status-1' }).lean<{
      metadata?: {
        pathStatus?: {
          inline?: { state?: string; chars?: number; reason?: string; completed_at?: Date };
        };
      };
    }>();
    expect(loaded?.metadata?.pathStatus?.inline?.state).toBe('loaded');
    expect(loaded?.metadata?.pathStatus?.inline?.chars).toBe(4567);
    expect(loaded?.metadata?.pathStatus?.inline?.completed_at).toEqual(completed_at);
  });

  it('persists metadata.pathStatus.rag with chunks (not chars)', async () => {
    await File.create({
      ...mkBase('f-status-2'),
      metadata: {
        pathStatus: {
          rag: { state: 'embedded', chunks: 12, completed_at: new Date() },
        },
      },
    });
    const loaded = await File.findOne({ file_id: 'f-status-2' }).lean<{
      metadata?: {
        pathStatus?: { rag?: { state?: string; chunks?: number; completed_at?: Date } };
      };
    }>();
    expect(loaded?.metadata?.pathStatus?.rag?.state).toBe('embedded');
    expect(loaded?.metadata?.pathStatus?.rag?.chunks).toBe(12);
  });

  it('persists metadata.pathStatus.{inline,rag}.reason for failed states', async () => {
    await File.create({
      ...mkBase('f-status-3'),
      metadata: {
        pathStatus: {
          inline: { state: 'failed', reason: 'rag-api 5xx' },
          rag: { state: 'failed', reason: 'embedding timeout' },
        },
      },
    });
    const loaded = await File.findOne({ file_id: 'f-status-3' }).lean<{
      metadata?: {
        pathStatus?: {
          inline?: { reason?: string };
          rag?: { reason?: string };
        };
      };
    }>();
    expect(loaded?.metadata?.pathStatus?.inline?.reason).toBe('rag-api 5xx');
    expect(loaded?.metadata?.pathStatus?.rag?.reason).toBe('embedding timeout');
  });

  it('persists metadata.pathStatus.mount entry', async () => {
    await File.create({
      ...mkBase('f-status-4'),
      metadata: {
        pathStatus: {
          mount: { state: 'mounted', completed_at: new Date() },
        },
      },
    });
    const loaded = await File.findOne({ file_id: 'f-status-4' }).lean<{
      metadata?: { pathStatus?: { mount?: { state?: string } } };
    }>();
    expect(loaded?.metadata?.pathStatus?.mount?.state).toBe('mounted');
  });

  it('keeps existing metadata.fileIdentifier alongside new fields', async () => {
    await File.create({
      ...mkBase('f-coexist'),
      metadata: {
        fileIdentifier: 'azure-blob-id-123',
        extracted_text: 'Some text',
        pathStatus: { inline: { state: 'loaded', chars: 9 } },
      },
    });
    const loaded = await File.findOne({ file_id: 'f-coexist' }).lean<{
      metadata?: {
        fileIdentifier?: string;
        extracted_text?: string;
        pathStatus?: { inline?: { state?: string } };
      };
    }>();
    expect(loaded?.metadata?.fileIdentifier).toBe('azure-blob-id-123');
    expect(loaded?.metadata?.extracted_text).toBe('Some text');
    expect(loaded?.metadata?.pathStatus?.inline?.state).toBe('loaded');
  });
});
