import { describe, expect, test, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PaperclipSnapshot } from '@/lib/paperclip-live';
import {
  buildNotionDraftMarkdown,
  buildNotionDraftProperties,
  notionDraftCandidates,
  notionDraftDatabaseSchema,
  setupNotionDraftDatabase,
  syncNotionDrafts,
  type NotionDraftClient,
} from '@/lib/notion-drafts';

function snapshot(): PaperclipSnapshot {
  return {
    ok: true,
    base: 'http://127.0.0.1:3100',
    companyId: 'company-momo',
    companyName: 'Momo',
    agents: [
      { id: 'writer-1', name: 'Senior Writer', status: 'idle' },
      { id: 'editor-1', name: 'Editorial Lead', status: 'idle' },
    ],
    issues: [
      {
        id: 'root-ready',
        identifier: 'MOM-45',
        title: 'Draft the next long-form article package',
        status: 'in_review',
        assigneeAgentId: 'writer-1',
        parentId: null,
        createdAt: '2026-08-17T14:00:00.000Z',
        updatedAt: '2026-08-18T10:00:00.000Z',
      },
      {
        id: 'child-ready',
        identifier: 'MOM-46',
        title: 'Write the delegated draft',
        status: 'in_review',
        assigneeAgentId: 'writer-1',
        parentId: 'root-ready',
        updatedAt: '2026-08-18T09:00:00.000Z',
      },
      {
        id: 'root-not-reviewed',
        identifier: 'MOM-47',
        title: 'Still being written',
        status: 'in_progress',
        assigneeAgentId: 'writer-1',
        parentId: null,
        updatedAt: '2026-08-18T08:00:00.000Z',
      },
      {
        id: 'root-no-draft',
        identifier: 'MOM-48',
        title: 'Only research exists',
        status: 'in_review',
        assigneeAgentId: 'editor-1',
        parentId: null,
        updatedAt: '2026-08-18T07:00:00.000Z',
      },
      {
        id: 'agent-review',
        identifier: 'MOM-49',
        title: 'QA is still reviewing this draft',
        status: 'in_review',
        assigneeAgentId: 'editor-1',
        parentId: null,
        executionState: {
          status: 'pending',
          currentParticipant: { type: 'agent', agentId: 'editor-1' },
        },
        updatedAt: '2026-08-18T06:00:00.000Z',
      },
    ],
    documents: {
      'root-ready': [
        {
          key: 'research',
          title: 'Sources',
          format: 'markdown',
          body: 'source notes',
          latestRevisionNumber: 1,
        },
        {
          key: 'draft',
          title: 'AI security draft review packet',
          format: 'markdown',
          body: '**Final title:** Why AI broke the security model\n\nA concrete opening.\n\n[VERIFY: source the incident]\n\nThe argument.',
          latestRevisionNumber: 3,
        },
      ],
      'child-ready': [
        {
          key: 'draft',
          title: null,
          format: 'markdown',
          body: 'Duplicate child copy.',
          latestRevisionNumber: 1,
        },
      ],
      'root-not-reviewed': [
        {
          key: 'draft',
          title: null,
          format: 'markdown',
          body: 'Not ready yet.',
          latestRevisionNumber: 1,
        },
      ],
      'root-no-draft': [
        {
          key: 'research',
          title: null,
          format: 'markdown',
          body: 'Not a draft.',
          latestRevisionNumber: 1,
        },
      ],
      'agent-review': [
        {
          key: 'draft',
          title: null,
          format: 'markdown',
          body: 'Not ready for the founder until QA signs off.',
          latestRevisionNumber: 1,
        },
      ],
    },
    errors: [],
  };
}

describe('Notion draft completion gate', () => {
  test('exports only a founder-owned top-level review carrying the exact draft key', () => {
    const candidates = notionDraftCandidates(snapshot());

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      companyId: 'company-momo',
      companyName: 'Momo',
      issueId: 'root-ready',
      issueIdentifier: 'MOM-45',
      assignedEmployee: 'Senior Writer',
      ownerMissing: false,
      revision: 3,
      verifyMarkers: 1,
      blogTitle: 'Why AI broke the security model',
      articleGroup: 'MOM-45 — Why AI broke the security model',
      createdAt: '2026-08-17T14:00:00.000Z',
      sourceVerification: 'Needs Verification',
      imageStatus: 'Missing Decision',
      postReadiness: 'Needs Source Verification',
    });
  });

  test('keeps an honest owner-missing signal instead of inventing an employee', () => {
    const source = snapshot();
    source.issues[0].assigneeAgentId = null;

    expect(notionDraftCandidates(source)[0]).toMatchObject({
      assignedEmployee: 'UNASSIGNED IN PAPERCLIP',
      ownerMissing: true,
    });
  });

  test('makes the page readable while naming Paperclip as the source of truth', () => {
    const draft = notionDraftCandidates(snapshot())[0];
    const markdown = buildNotionDraftMarkdown(draft);
    const properties = buildNotionDraftProperties(draft, '2026-08-18T10:30:00.000Z');

    expect(markdown).toContain('Paperclip remains the source of truth');
    expect(markdown).toContain('MOM-45');
    expect(markdown).toContain('[VERIFY: source the incident]');
    expect(properties).toMatchObject({
      Name: { title: [{ text: { content: 'Why AI broke the security model' } }] },
      'Article Group': { select: { name: 'MOM-45 — Why AI broke the security model' } },
      'Review Status': { select: { name: 'Needs Review' } },
      Current: { checkbox: true },
      Company: { select: { name: 'Momo' } },
      'Assigned Employee': { select: { name: 'Senior Writer' } },
      'Owner Missing': { checkbox: false },
      Created: { date: { start: '2026-08-17T14:00:00.000Z' } },
      'Source Verification': { select: { name: 'Needs Verification' } },
      'Image Status': { select: { name: 'Missing Decision' } },
      'Post Readiness': { select: { name: 'Needs Source Verification' } },
      'VERIFY Markers': { number: 1 },
      Revision: { number: 3 },
    });
  });

  test('recovers a reader-facing title from the first H1 in a legacy draft', () => {
    const source = snapshot();
    source.documents['root-ready'][1] = {
      ...source.documents['root-ready'][1],
      title: null,
      body: '# The operating model for an AI-native company\n\nA concrete opening.',
    };

    expect(notionDraftCandidates(source)[0]).toMatchObject({
      blogTitle: 'The operating model for an AI-native company',
      articleGroup: 'MOM-45 — The operating model for an AI-native company',
    });
  });

  test('marks sources verified only from a structured QA receipt and never from prose alone', () => {
    const source = snapshot();
    source.documents['root-ready'][1].body = [
      '**Final title:** Why AI broke the security model',
      '',
      '## Final article',
      'A sourced article.',
      '',
      '## Source ledger',
      '- https://example.com/primary (accessed 2026-08-18)',
    ].join('\n');
    source.documents['root-ready'].push(
      {
        key: 'qa',
        title: 'Editorial QA',
        format: 'json',
        body: JSON.stringify({
          schemaVersion: 1,
          kind: 'momo-blog-qa',
          sourceVerification: 'passed',
          verifiedSourceCount: 1,
          reviewedBy: 'Editorial Lead',
          reviewedAt: '2026-08-18T09:30:00.000Z',
        }),
        latestRevisionNumber: 1,
      },
      {
        key: 'media',
        title: 'Blog media receipt',
        format: 'json',
        body: JSON.stringify({
          schemaVersion: 1,
          kind: 'momo-blog-media',
          companyId: 'company-momo',
          issueId: 'root-ready',
          hero: { required: false },
          assets: [],
        }),
        latestRevisionNumber: 1,
      },
    );

    const reviewed = notionDraftCandidates(source)[0];
    expect(reviewed).toMatchObject({
      sourceVerification: 'Verified',
      verifiedSourceCount: 1,
      imageStatus: 'Not Required',
      postReadiness: 'Awaiting Founder Approval',
    });

    source.issues[0].status = 'done';
    expect(notionDraftCandidates(source)[0]).toMatchObject({
      sourceStatus: 'done',
      postReadiness: 'Ready to Post',
    });
  });

  test('accepts a checksummed generated-original hero under the configured media root', () => {
    const source = snapshot();
    source.documents['root-ready'][1].body = [
      '**Final title:** Why AI broke the security model',
      '',
      '## Source ledger',
      '- https://example.com/primary (accessed 2026-08-18)',
    ].join('\n');
    const mediaRoot = mkdtempSync(join(tmpdir(), 'momo-notion-media-'));
    const imagePath = join(mediaRoot, 'hero.png');
    const bytes = Buffer.from('local generated image fixture');
    writeFileSync(imagePath, bytes);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    source.documents['root-ready'].push(
      {
        key: 'qa',
        title: 'Editorial QA',
        format: 'json',
        body: JSON.stringify({
          schemaVersion: 1,
          kind: 'momo-blog-qa',
          sourceVerification: 'passed',
          verifiedSourceCount: 1,
          reviewedBy: 'Editorial Lead',
          reviewedAt: '2026-08-18T09:30:00.000Z',
        }),
        latestRevisionNumber: 1,
      },
      {
        key: 'media',
        title: 'Blog media receipt',
        format: 'json',
        body: JSON.stringify({
          schemaVersion: 1,
          kind: 'momo-blog-media',
          companyId: 'company-momo',
          issueId: 'root-ready',
          hero: { required: true },
          assets: [
            {
              assetId: 'hero-01',
              placement: 'hero',
              alt: 'Abstract trust boundary surrounding an enterprise AI agent',
              path: imagePath,
              sha256,
              contentType: 'image/png',
              rightsBasis: 'generated-original',
              synthetic: true,
            },
          ],
        }),
        latestRevisionNumber: 1,
      },
    );

    expect(notionDraftCandidates(source, { mediaRoot })[0]).toMatchObject({
      sourceVerification: 'Verified',
      heroRequired: true,
      imageStatus: 'Attached',
      postReadiness: 'Awaiting Founder Approval',
      assets: [
        expect.objectContaining({
          placement: 'hero',
          path: imagePath,
          sha256,
        }),
      ],
    });

    expect(notionDraftCandidates(source, { mediaRoot: join(mediaRoot, 'other') })[0]).toMatchObject({
      imageStatus: 'Invalid Receipt',
      postReadiness: 'Needs Images',
    });
  });
});

describe('Notion draft database setup and idempotent revision sync', () => {
  test('creates the complete review schema under the explicitly shared parent page', async () => {
    const create = vi.fn(async () => ({
      object: 'database',
      id: 'database-1',
      url: 'https://www.notion.so/database-1',
      data_sources: [{ id: 'source-1', name: 'AI Company Drafts' }],
    }));
    const notion = { databases: { create } } as unknown as NotionDraftClient;

    const result = await setupNotionDraftDatabase(notion, 'parent-page-1');

    expect(result).toEqual({
      databaseId: 'database-1',
      dataSourceId: 'source-1',
      url: 'https://www.notion.so/database-1',
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        parent: { type: 'page_id', page_id: 'parent-page-1' },
        initial_data_source: { properties: notionDraftDatabaseSchema() },
      }),
    );
    expect(notionDraftDatabaseSchema()).toMatchObject({
      Name: { type: 'title' },
      'Article Group': { type: 'select' },
      Created: { type: 'date' },
      'Source Verification': { type: 'select' },
      'Verified Sources': { type: 'number' },
      'Post Readiness': { type: 'select' },
      'Image Status': { type: 'select' },
      'Hero Image': { type: 'files' },
      'Other Images': { type: 'files' },
    });
  });

  test('adds missing editorial properties to an existing database without replacing it', async () => {
    const complete = notionDraftDatabaseSchema();
    const retrieve = vi
      .fn()
      .mockResolvedValueOnce({
        object: 'data_source',
        id: 'source-1',
        properties: {
          Name: complete.Name,
          'Review Status': complete['Review Status'],
          Current: complete.Current,
        },
      })
      .mockResolvedValueOnce({
        object: 'data_source',
        id: 'source-1',
        properties: complete,
      });
    const update = vi.fn(async () => ({ object: 'data_source', id: 'source-1' }));
    const notion = {
      dataSources: { retrieve, update, query: vi.fn() },
      pages: { create: vi.fn(), update: vi.fn() },
      fileUploads: { create: vi.fn(), send: vi.fn() },
    } as unknown as NotionDraftClient;

    const result = await syncNotionDrafts(notion, 'source-1', []);

    expect(result).toMatchObject({ ok: true, candidates: 0 });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data_source_id: 'source-1',
        properties: expect.objectContaining({
          Created: complete.Created,
          'Source Verification': complete['Source Verification'],
          'Hero Image': complete['Hero Image'],
        }),
      }),
    );
  });

  test('uploads a verified local hero and attaches it as the page cover', async () => {
    const source = snapshot();
    source.documents['root-ready'][1].body = [
      '**Final title:** Why AI broke the security model',
      '',
      '## Source ledger',
      '- https://example.com/primary (accessed 2026-08-18)',
    ].join('\n');
    const mediaRoot = mkdtempSync(join(tmpdir(), 'momo-notion-upload-'));
    const imagePath = join(mediaRoot, 'hero.png');
    const bytes = Buffer.from('verified local hero');
    writeFileSync(imagePath, bytes);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    source.documents['root-ready'].push(
      {
        key: 'qa',
        title: null,
        format: 'json',
        body: JSON.stringify({
          schemaVersion: 1,
          kind: 'momo-blog-qa',
          sourceVerification: 'passed',
          verifiedSourceCount: 1,
          reviewedBy: 'Editorial Lead',
          reviewedAt: '2026-08-18T09:30:00.000Z',
        }),
        latestRevisionNumber: 1,
      },
      {
        key: 'media',
        title: null,
        format: 'json',
        body: JSON.stringify({
          schemaVersion: 1,
          kind: 'momo-blog-media',
          companyId: 'company-momo',
          issueId: 'root-ready',
          hero: { required: true },
          assets: [
            {
              assetId: 'hero-01',
              placement: 'hero',
              alt: 'Abstract trust boundary surrounding an enterprise AI agent',
              path: imagePath,
              sha256,
              contentType: 'image/png',
              rightsBasis: 'generated-original',
              synthetic: true,
            },
          ],
        }),
        latestRevisionNumber: 1,
      },
    );
    const draft = notionDraftCandidates(source, { mediaRoot })[0];
    const pageCreate = vi.fn(async () => ({ object: 'page', id: 'new-page' }));
    const uploadCreate = vi.fn(async () => ({ object: 'file_upload', id: 'upload-1' }));
    const uploadSend = vi.fn(async () => ({ object: 'file_upload', id: 'upload-1', status: 'uploaded' }));
    const notion = {
      dataSources: {
        retrieve: vi.fn(async () => ({
          object: 'data_source',
          id: 'source-1',
          properties: notionDraftDatabaseSchema(),
        })),
        update: vi.fn(),
        query: vi.fn(async () => ({ results: [], has_more: false, next_cursor: null })),
      },
      pages: { create: pageCreate, update: vi.fn() },
      fileUploads: { create: uploadCreate, send: uploadSend },
    } as unknown as NotionDraftClient;

    const result = await syncNotionDrafts(notion, 'source-1', [draft]);

    expect(result).toMatchObject({ ok: true, created: 1 });
    expect(uploadCreate).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'single_part', content_type: 'image/png' }),
    );
    expect(uploadSend).toHaveBeenCalledWith(
      expect.objectContaining({ file_upload_id: 'upload-1' }),
    );
    expect(pageCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        cover: { type: 'file_upload', file_upload: { id: 'upload-1' } },
        properties: expect.objectContaining({
          'Hero Image': {
            files: [{ name: 'hero-01.png', type: 'file_upload', file_upload: { id: 'upload-1' } }],
          },
        }),
      }),
    );
  });

  test('uses done only to reconcile an existing review page, not to flood Notion with history', async () => {
    const source = snapshot();
    source.issues[0].status = 'done';
    const draft = notionDraftCandidates(source)[0];
    const pageCreate = vi.fn();
    const notion = {
      dataSources: {
        retrieve: vi.fn(async () => ({
          object: 'data_source',
          id: 'source-1',
          properties: notionDraftDatabaseSchema(),
        })),
        update: vi.fn(),
        query: vi.fn(async () => ({ results: [], has_more: false, next_cursor: null })),
      },
      pages: { create: pageCreate, update: vi.fn() },
      fileUploads: { create: vi.fn(), send: vi.fn() },
    } as unknown as NotionDraftClient;

    const result = await syncNotionDrafts(notion, 'source-1', [draft]);

    expect(result).toMatchObject({ ok: true, created: 0, skipped: 1 });
    expect(pageCreate).not.toHaveBeenCalled();
  });

  test('skips the same checksum, but creates a new current revision before superseding the old one', async () => {
    const draft = notionDraftCandidates(snapshot())[0];
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        results: [
          {
            object: 'page',
            id: 'same-page',
            properties: {
              Checksum: { type: 'rich_text', rich_text: [{ plain_text: draft.checksum }] },
              Current: { type: 'checkbox', checkbox: true },
              'Metadata Checksum': {
                type: 'rich_text',
                rich_text: [{ plain_text: draft.metadataChecksum }],
              },
              'Media Checksum': {
                type: 'rich_text',
                rich_text: [{ plain_text: draft.mediaChecksum }],
              },
              'Assigned Employee': { type: 'select', select: { name: 'Senior Writer' } },
              'Owner Missing': { type: 'checkbox', checkbox: false },
            },
          },
        ],
        has_more: false,
        next_cursor: null,
      })
      .mockResolvedValueOnce({
        results: [
          {
            object: 'page',
            id: 'old-page',
            properties: {
              Checksum: { type: 'rich_text', rich_text: [{ plain_text: 'old-checksum' }] },
              Current: { type: 'checkbox', checkbox: true },
            },
          },
        ],
        has_more: false,
        next_cursor: null,
      });
    const create = vi.fn(async () => ({ object: 'page', id: 'new-page' }));
    const update = vi.fn(async () => ({ object: 'page', id: 'old-page' }));
    const notion = {
      dataSources: {
        retrieve: vi.fn(async () => ({
          object: 'data_source',
          id: 'source-1',
          properties: notionDraftDatabaseSchema(),
        })),
        query,
      },
      pages: { create, update },
    } as unknown as NotionDraftClient;

    const first = await syncNotionDrafts(notion, 'source-1', [draft], '2026-08-18T10:30:00.000Z');
    const changed = { ...draft, body: `${draft.body}\n\nA corrected ending.`, checksum: 'new-checksum', revision: 4 };
    const second = await syncNotionDrafts(notion, 'source-1', [changed], '2026-08-18T11:00:00.000Z');

    expect(first).toMatchObject({ ok: true, created: 0, updated: 0, skipped: 1, superseded: 0 });
    expect(second).toMatchObject({ ok: true, created: 1, updated: 0, skipped: 0, superseded: 1 });
    expect(create.mock.invocationCallOrder[0]).toBeLessThan(update.mock.invocationCallOrder[0]);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      page_id: 'old-page',
      properties: expect.objectContaining({
        Current: { checkbox: false },
        'Review Status': { select: { name: 'Superseded' } },
        'Article Group': { select: { name: 'MOM-45 — Why AI broke the security model' } },
      }),
    }));
  });

  test('refreshes a corrected employee tag without replacing the page or its human review state', async () => {
    const draft = notionDraftCandidates(snapshot())[0];
    const notion = {
      dataSources: {
        retrieve: vi.fn(async () => ({
          object: 'data_source',
          id: 'source-1',
          properties: notionDraftDatabaseSchema(),
        })),
        query: vi.fn(async () => ({
          results: [
            {
              object: 'page',
              id: 'existing-page',
              properties: {
                Checksum: { type: 'rich_text', rich_text: [{ plain_text: draft.checksum }] },
                Current: { type: 'checkbox', checkbox: true },
                'Assigned Employee': {
                  type: 'select',
                  select: { name: 'UNASSIGNED IN PAPERCLIP' },
                },
                'Owner Missing': { type: 'checkbox', checkbox: true },
                'Review Status': { type: 'select', select: { name: 'Approved' } },
              },
            },
          ],
          has_more: false,
          next_cursor: null,
        })),
      },
      pages: {
        create: vi.fn(),
        update: vi.fn(async () => ({ object: 'page', id: 'existing-page' })),
      },
    } as unknown as NotionDraftClient;

    const result = await syncNotionDrafts(
      notion,
      'source-1',
      [draft],
      '2026-08-18T12:00:00.000Z',
    );

    expect(result).toMatchObject({ ok: true, created: 0, updated: 1, skipped: 0 });
    expect(notion.pages.create).not.toHaveBeenCalled();
    expect(notion.pages.update).toHaveBeenCalledWith(
      expect.objectContaining({
        page_id: 'existing-page',
        properties: expect.objectContaining({
          'Assigned Employee': { select: { name: 'Senior Writer' } },
          'Owner Missing': { checkbox: false },
          'Synced At': { date: { start: '2026-08-18T12:00:00.000Z' } },
          Name: { title: [{ type: 'text', text: { content: 'Why AI broke the security model' } }] },
        }),
      }),
    );
    const updatePayload = vi.mocked(notion.pages.update).mock.calls[0][0];
    expect(updatePayload.properties).not.toHaveProperty('Review Status');
    expect(updatePayload.properties).not.toHaveProperty('Checksum');
  });

  test('groups legacy historical revisions without rewriting their review state or body', async () => {
    const draft = notionDraftCandidates(snapshot())[0];
    const update = vi.fn(async (_input: unknown) => ({ object: 'page', id: 'legacy-history' }));
    const notion = {
      dataSources: {
        retrieve: vi.fn(async () => ({
          object: 'data_source',
          id: 'source-1',
          properties: notionDraftDatabaseSchema(),
        })),
        query: vi.fn(async () => ({
          results: [
            {
              object: 'page',
              id: 'current-page',
              properties: {
                Checksum: { rich_text: [{ plain_text: draft.checksum }] },
                Current: { checkbox: true },
                'Metadata Checksum': { rich_text: [{ plain_text: draft.metadataChecksum }] },
                'Grouping Checksum': { rich_text: [{ plain_text: draft.groupingChecksum }] },
              },
            },
            {
              object: 'page',
              id: 'legacy-history',
              properties: {
                Checksum: { rich_text: [{ plain_text: 'older-revision' }] },
                Current: { checkbox: false },
                'Review Status': { select: { name: 'Superseded' } },
              },
            },
          ],
          has_more: false,
          next_cursor: null,
        })),
      },
      pages: { create: vi.fn(), update },
      fileUploads: { create: vi.fn(), send: vi.fn() },
    } as unknown as NotionDraftClient;

    const result = await syncNotionDrafts(notion, 'source-1', [draft]);

    expect(result).toMatchObject({ ok: true, grouped: 1, created: 0, updated: 0, skipped: 1 });
    expect(update).toHaveBeenCalledWith({
      page_id: 'legacy-history',
      properties: expect.objectContaining({
        'Article Group': { select: { name: 'MOM-45 — Why AI broke the security model' } },
        Created: { date: { start: '2026-08-17T14:00:00.000Z' } },
        'Grouping Checksum': expect.any(Object),
      }),
    });
    const payload = (update.mock.calls[0][0] as { properties: Record<string, unknown> }).properties;
    expect(payload).not.toHaveProperty('Review Status');
    expect(payload).not.toHaveProperty('Current');
    expect(payload).not.toHaveProperty('Name');
  });
});
