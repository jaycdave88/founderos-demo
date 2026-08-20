import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  createIssue,
  getPaperclipCompanies,
  getPaperclipPortfolio,
  getPaperclipSnapshot,
} from '@/lib/paperclip-live';
import { GET } from '@/app/api/paperclip/route';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function paperclipFetch() {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname + new URL(url).search;
    if (path === '/api/companies') {
      return json([
        { id: 'company-a', name: 'Alpha' },
        { id: 'company-b', name: 'Beta' },
      ]);
    }
    if (path === '/api/companies/company-a') return json({ id: 'company-a', name: 'Alpha' });
    if (path === '/api/companies/company-b') return json({ id: 'company-b', name: 'Beta' });
    if (path === '/api/companies/company-a/agents') {
      return json([{ id: 'agent-a', name: 'Ada', status: 'idle' }]);
    }
    if (path === '/api/companies/company-b/agents') {
      return json([
        { id: 'agent-b1', name: 'Bea', status: 'running' },
        { id: 'agent-b2', name: 'Ben', status: 'idle' },
      ]);
    }
    if (path === '/api/companies/company-a/issues?view=compact') {
      return json([{ id: 'issue-a', status: 'done', assigneeAgentId: 'agent-a' }]);
    }
    if (path === '/api/companies/company-b/issues?view=compact') {
      return json([
        { id: 'issue-b1', status: 'in_progress', assigneeAgentId: 'agent-b1' },
        {
          id: 'issue-b2',
          status: 'blocked',
          assigneeAgentId: 'agent-b2',
          activeRecoveryAction: {
            id: 'recovery-b2',
            status: 'active',
            ownerType: 'agent',
            ownerAgentId: 'agent-b2',
            cause: 'successful_run_missing_state',
            nextAction: 'Record a valid disposition.',
          },
        },
        { id: 'issue-b3', status: 'backlog', assigneeAgentId: null },
        { id: 'issue-b4', status: 'in_review', assigneeAgentId: null },
        { id: 'issue-b5', status: 'todo', assigneeAgentId: null, assigneeUserId: 'founder' },
        { id: 'issue-b6', status: 'in_review', parentId: 'issue-b4', assigneeAgentId: 'agent-b2' },
        {
          id: 'issue-b7',
          status: 'in_review',
          assigneeAgentId: 'agent-b2',
          executionState: {
            status: 'pending',
            currentParticipant: { type: 'agent', agentId: 'agent-b2' },
          },
        },
      ]);
    }
    if (path === '/api/issues/issue-b1/documents') return json([]);
    if (path === '/api/issues/issue-b2/documents') return json([]);
    if (path === '/api/issues/issue-b3/documents') return json([]);
    if (path === '/api/issues/issue-b4/documents') return json([]);
    if (path === '/api/issues/issue-b5/documents') return json([]);
    if (path === '/api/issues/issue-b6/documents') return json([]);
    if (path === '/api/issues/issue-b7/documents') return json([]);
    if (path === '/api/issues/issue-b4') {
      return json({
        id: 'issue-b4',
        companyId: 'company-b',
        identifier: 'BET-4',
        title: 'Hydrated review article',
        status: 'in_review',
        assigneeAgentId: null,
        createdAt: '2026-08-17T14:00:00.000Z',
        updatedAt: '2026-08-18T10:00:00.000Z',
      });
    }
    if (path === '/api/companies/company-b/issues' && init?.method === 'POST') return json({}, 201);
    return json({ error: `unexpected ${init?.method ?? 'GET'} ${path}` }, 404);
  });
}

describe('Paperclip company portfolio', () => {
  test('lists every company from Paperclip instead of only the configured default', async () => {
    vi.stubGlobal('fetch', paperclipFetch());

    const result = await getPaperclipCompanies();

    expect(result.ok).toBe(true);
    expect(result.companies).toEqual([
      { id: 'company-a', name: 'Alpha' },
      { id: 'company-b', name: 'Beta' },
    ]);
  });

  test('summarises delivery risk separately for every company', async () => {
    vi.stubGlobal('fetch', paperclipFetch());

    const result = await getPaperclipPortfolio();

    expect(result.ok).toBe(true);
    expect(result.companies).toEqual([
      expect.objectContaining({
        id: 'company-a',
        name: 'Alpha',
        agentCount: 1,
        issueCount: 1,
        openIssueCount: 0,
        reviewIssueCount: 0,
        blockedIssueCount: 0,
        recoveringIssueCount: 0,
        unassignedOpenIssueCount: 0,
      }),
      expect.objectContaining({
        id: 'company-b',
        name: 'Beta',
        agentCount: 2,
        issueCount: 7,
        openIssueCount: 7,
        reviewIssueCount: 1,
        blockedIssueCount: 1,
        recoveringIssueCount: 1,
        unassignedOpenIssueCount: 1,
      }),
    ]);
  });

  test('an explicit company id overrides the default for every scoped read', async () => {
    const fetchMock = paperclipFetch();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('PAPERCLIP_COMPANY_ID', 'company-a');

    const snapshot = await getPaperclipSnapshot('company-b');

    expect(snapshot.companyId).toBe('company-b');
    expect(snapshot.companyName).toBe('Beta');
    expect(snapshot.agents).toHaveLength(2);
    expect(snapshot.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'issue-b5', assigneeUserId: 'founder' }),
        expect.objectContaining({
          id: 'issue-b2',
          activeRecoveryAction: expect.objectContaining({
            status: 'active',
            cause: 'successful_run_missing_state',
          }),
        }),
      ]),
    );
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/company-a/'))).toBe(false);
  });

  test('can hydrate document candidates from authoritative issue records', async () => {
    vi.stubGlobal('fetch', paperclipFetch());

    const result = await getPaperclipSnapshot('company-b', {
      documentStatuses: ['in_review'],
      prioritizeDocumentStatuses: ['in_review'],
      topLevelOnly: true,
      documentLimit: 1,
      hydrateDocumentIssues: true,
    });

    expect(result.issues).toContainEqual(
      expect.objectContaining({
        id: 'issue-b4',
        identifier: 'BET-4',
        createdAt: '2026-08-17T14:00:00.000Z',
      }),
    );
  });

  test('new work is created in the selected company, not whichever company is in env', async () => {
    const fetchMock = paperclipFetch();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('PAPERCLIP_COMPANY_ID', 'company-a');

    const result = await createIssue({ companyId: 'company-b', title: 'Publish the winning cut' });

    expect(result.ok).toBe(true);
    const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/api/companies/company-b/issues'));
    expect(call).toBeDefined();
    expect(call?.[1]?.method).toBe('POST');
  });

  test('the API can return a selected company or the whole portfolio', async () => {
    vi.stubGlobal('fetch', paperclipFetch());
    vi.stubEnv('PAPERCLIP_COMPANY_ID', 'company-a');

    const selected = await GET(new Request('http://localhost/api/paperclip?companyId=company-b'));
    expect(selected.status).toBe(200);
    expect(await selected.json()).toMatchObject({ companyId: 'company-b', counts: { agents: 2, issues: 7 } });

    const portfolio = await GET(new Request('http://localhost/api/paperclip?view=portfolio'));
    expect(portfolio.status).toBe(200);
    expect(await portfolio.json()).toMatchObject({
      ok: true,
      counts: {
        companies: 2,
        agents: 3,
        openIssues: 7,
        reviewIssues: 1,
        blockedIssues: 1,
        recoveringIssues: 1,
        unassignedOpenIssues: 1,
      },
    });
  });
});
