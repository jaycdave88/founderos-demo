import { afterEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  setup: vi.fn(async () => ({
    databaseId: 'database-1',
    dataSourceId: 'source-1',
    url: 'https://www.notion.so/database-1',
  })),
  candidates: vi.fn(() => [{ issueIdentifier: 'MOM-45' }]),
  sync: vi.fn(async () => ({
    ok: true,
    candidates: 1,
    created: 1,
    updated: 0,
    skipped: 0,
    superseded: 0,
    errors: [],
  })),
  snapshot: vi.fn(async (companyId: string) => ({
    ok: true,
    companyId,
    companyName: 'Momo',
    agents: [],
    issues: [],
    documents: {},
    errors: [],
  })),
  notion: {},
}));

vi.mock('@notionhq/client', () => ({
  Client: class {
    constructor() {
      return mocks.notion;
    }
  },
}));

vi.mock('@/lib/notion-drafts', () => ({
  setupNotionDraftDatabase: mocks.setup,
  notionDraftCandidates: mocks.candidates,
  syncNotionDrafts: mocks.sync,
}));

vi.mock('@/lib/paperclip-live', () => ({ getPaperclipSnapshot: mocks.snapshot }));

import { GET, POST } from '@/app/api/notion/drafts/route';

function post(action: string, token?: string) {
  return POST(
    new Request('http://localhost/api/notion/drafts', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ action }),
    }),
  );
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('Notion draft worker route', () => {
  test('reports configuration without ever returning either secret', async () => {
    vi.stubEnv('NOTION_API_KEY', 'notion-secret');
    vi.stubEnv('NOTION_DRAFT_SYNC_TOKEN', 'worker-secret');
    vi.stubEnv('NOTION_DRAFT_DATABASE_ID', 'database-1');
    vi.stubEnv('NOTION_DRAFT_DATA_SOURCE_ID', 'source-1');
    vi.stubEnv('NOTION_DRAFT_COMPANY_IDS', 'company-momo');

    const response = await GET();
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(JSON.parse(text)).toMatchObject({
      ok: true,
      enabled: false,
      configured: true,
      companyIds: ['company-momo'],
    });
    expect(text).not.toContain('notion-secret');
    expect(text).not.toContain('worker-secret');
  });

  test('fails closed when the worker token is absent or wrong', async () => {
    vi.stubEnv('NOTION_API_KEY', 'notion-secret');
    expect((await post('sync', 'anything')).status).toBe(503);

    vi.stubEnv('NOTION_DRAFT_SYNC_TOKEN', 'worker-secret');
    expect((await post('sync', 'wrong-secret')).status).toBe(401);
  });

  test('creates the review database only under the configured shared parent', async () => {
    vi.stubEnv('NOTION_API_KEY', 'notion-secret');
    vi.stubEnv('NOTION_DRAFT_SYNC_TOKEN', 'worker-secret');
    vi.stubEnv('NOTION_DRAFT_PARENT_PAGE_ID', 'parent-page-1');

    const response = await post('setup', 'worker-secret');

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, dataSourceId: 'source-1' });
    expect(mocks.setup).toHaveBeenCalledWith(mocks.notion, 'parent-page-1');
  });

  test('syncs only the explicit company allowlist and requests canonical review drafts', async () => {
    vi.stubEnv('NOTION_API_KEY', 'notion-secret');
    vi.stubEnv('NOTION_DRAFT_SYNC_TOKEN', 'worker-secret');
    vi.stubEnv('NOTION_DRAFT_SYNC_ENABLED', '1');
    vi.stubEnv('NOTION_DRAFT_DATA_SOURCE_ID', 'source-1');
    vi.stubEnv('NOTION_DRAFT_COMPANY_IDS', 'company-momo,company-faceless');

    const response = await post('sync', 'worker-secret');

    expect(response.status).toBe(200);
    expect(mocks.snapshot).toHaveBeenCalledTimes(2);
    expect(mocks.snapshot).toHaveBeenCalledWith('company-momo', {
      documentStatuses: ['in_review'],
      topLevelOnly: true,
      documentLimit: 200,
    });
    expect(mocks.snapshot).toHaveBeenCalledWith('company-faceless', expect.any(Object));
  });
});
