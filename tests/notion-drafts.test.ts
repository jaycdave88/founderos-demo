import { describe, expect, test, vi } from 'vitest';
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
        title: 'Why AI broke the security model',
        status: 'in_review',
        assigneeAgentId: 'writer-1',
        parentId: null,
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
          title: 'Why AI broke the security model',
          format: 'markdown',
          body: 'A concrete opening.\n\n[VERIFY: source the incident]\n\nThe argument.',
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
    },
    errors: [],
  };
}

describe('Notion draft completion gate', () => {
  test('exports only a top-level in-review issue carrying the exact draft key', () => {
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
      Name: { title: [{ text: { content: 'MOM-45 — Why AI broke the security model' } }] },
      'Review Status': { select: { name: 'Needs Review' } },
      Current: { checkbox: true },
      Company: { select: { name: 'Momo' } },
      'Assigned Employee': { select: { name: 'Senior Writer' } },
      'Owner Missing': { checkbox: false },
      Words: { number: 9 },
      'VERIFY Markers': { number: 1 },
      Revision: { number: 3 },
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
    expect(update).toHaveBeenCalledWith({
      page_id: 'old-page',
      properties: {
        Current: { checkbox: false },
        'Review Status': { select: { name: 'Superseded' } },
      },
    });
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
    expect(notion.pages.update).toHaveBeenCalledWith({
      page_id: 'existing-page',
      properties: {
        'Assigned Employee': { select: { name: 'Senior Writer' } },
        'Owner Missing': { checkbox: false },
        'Synced At': { date: { start: '2026-08-18T12:00:00.000Z' } },
      },
    });
  });
});
