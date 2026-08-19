import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  ISSUE_STATUSES,
  decideReview,
  isIssueStatus,
  setIssueStatus,
} from '@/lib/paperclip-live';
import { LANES, NO_DROP } from '@/app/tasks/board';
import { POST } from '@/app/api/paperclip/route';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

// Declared with fetch's own parameters so the recorded call is typed, not cast.
const ok = () => vi.fn(async (_url: string, _init?: RequestInit) => new Response('{}', { status: 200 }));

const request = (payload: unknown) =>
  new Request('http://localhost/api/paperclip', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });

describe('setIssueStatus', () => {
  test('PATCHes the issue with status alone, leaving every other field untouched', async () => {
    const fetchMock = ok();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('PAPERCLIP_BASE_URL', 'http://127.0.0.1:3100');

    const result = await setIssueStatus('issue-1', 'in_review');

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:3100/api/issues/issue-1');
    expect(init?.method).toBe('PATCH');
    // Exactly `status` — Paperclip takes the issue partially, so anything extra
    // here would overwrite a field nobody asked to change.
    expect(JSON.parse(String(init?.body))).toEqual({ status: 'in_review' });
  });

  test('a status Paperclip does not have is refused here, before any request', async () => {
    const fetchMock = ok();
    vi.stubGlobal('fetch', fetchMock);

    const result = await setIssueStatus('issue-1', 'doing');

    expect(result.ok).toBe(false);
    expect(result.detail).toContain('doing');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('a missing issue id is refused before any request', async () => {
    const fetchMock = ok();
    vi.stubGlobal('fetch', fetchMock);

    expect((await setIssueStatus('  ', 'done')).ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("Paperclip's own rejection text survives to the caller", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('status is not a valid enum value', { status: 400 })),
    );

    const result = await setIssueStatus('issue-1', 'done');

    expect(result.ok).toBe(false);
    expect(result.detail).toContain('400');
    expect(result.detail).toContain('not a valid enum value');
  });

  test('an unreachable Paperclip is a failed result, not a throw', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('connect ECONNREFUSED 127.0.0.1:3100');
      }),
    );

    const result = await setIssueStatus('issue-1', 'done');

    expect(result.ok).toBe(false);
    expect(result.detail).toContain('ECONNREFUSED');
  });

  test('every status Paperclip publishes is accepted', () => {
    for (const status of ISSUE_STATUSES) expect(isIssueStatus(status)).toBe(true);
    expect(isIssueStatus('in-progress')).toBe(false);
  });
});

describe('POST /api/paperclip set_status', () => {
  test('a good move answers 200', async () => {
    vi.stubGlobal('fetch', ok());
    const res = await POST(request({ action: 'set_status', issueId: 'issue-1', status: 'todo' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });

  test('a refused move answers 502 and carries the reason', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 409 })));
    const res = await POST(request({ action: 'set_status', issueId: 'issue-1', status: 'todo' }));
    expect(res.status).toBe(502);
    expect((await res.json()).detail).toContain('nope');
  });
});

function reviewFetch(options: {
  status?: string;
  documents?: Array<{ key: string; body?: string; latestRevisionNumber: number | null }>;
  ignorePatch?: boolean;
} = {}) {
  let status = options.status ?? 'in_review';
  const documents = options.documents ?? [
    { key: 'draft', body: '# Current draft', latestRevisionNumber: 2 },
  ];
  return vi.fn(async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname + new URL(url).search;
    if (path === '/api/companies/company-1/issues?view=compact') {
      return new Response(JSON.stringify([{ id: 'issue-1', status }]), { status: 200 });
    }
    if (path === '/api/issues/issue-1/documents') {
      return new Response(JSON.stringify(documents), { status: 200 });
    }
    if (path === '/api/issues/issue-1' && init?.method === 'PATCH') {
      if (!options.ignorePatch) {
        status = String((JSON.parse(String(init.body)) as { status?: string }).status ?? status);
      }
      return new Response('{}', { status: 200 });
    }
    return new Response('not found', { status: 404 });
  });
}

describe('founder review decisions', () => {
  test('approval re-reads the exact revision then atomically records status and decision', async () => {
    const fetchMock = reviewFetch();
    vi.stubGlobal('fetch', fetchMock);

    const result = await decideReview({
      companyId: 'company-1',
      issueId: 'issue-1',
      decision: 'approve',
      note: 'Strong enough to use.',
      expectedDocuments: [{ key: 'draft', latestRevisionNumber: 2 }],
    });

    expect(result.ok).toBe(true);
    expect(result.detail).toBe('confirmed done');
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');
    expect(patch).toBeDefined();
    expect(JSON.parse(String(patch?.[1]?.body))).toEqual({
      status: 'done',
      comment:
        'Founder approved in FounderOS. Reviewed: draft@rev 2. Note: Strong enough to use.',
    });
  });

  test('a stale browser revision is rejected before any write', async () => {
    const fetchMock = reviewFetch({
      documents: [{ key: 'draft', body: '# Newer draft', latestRevisionNumber: 3 }],
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await decideReview({
      companyId: 'company-1',
      issueId: 'issue-1',
      decision: 'approve',
      expectedDocuments: [{ key: 'draft', latestRevisionNumber: 2 }],
    });

    expect(result.ok).toBe(false);
    expect(result.detail).toContain('stale');
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false);
  });

  test('an issue that already left review is rejected before any write', async () => {
    const fetchMock = reviewFetch({ status: 'done' });
    vi.stubGlobal('fetch', fetchMock);

    const result = await decideReview({
      companyId: 'company-1',
      issueId: 'issue-1',
      decision: 'approve',
      expectedDocuments: [{ key: 'draft', latestRevisionNumber: 2 }],
    });

    expect(result.ok).toBe(false);
    expect(result.detail).toContain('not in_review');
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false);
  });

  test('requesting changes requires a concrete note before any request', async () => {
    const fetchMock = reviewFetch();
    vi.stubGlobal('fetch', fetchMock);

    const result = await decideReview({
      companyId: 'company-1',
      issueId: 'issue-1',
      decision: 'request_changes',
      expectedDocuments: [{ key: 'draft', latestRevisionNumber: 2 }],
    });

    expect(result.ok).toBe(false);
    expect(result.detail).toContain('required');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('cancelling obsolete review work records the reason in the same PATCH', async () => {
    const fetchMock = reviewFetch({ documents: [] });
    vi.stubGlobal('fetch', fetchMock);

    const result = await decideReview({
      companyId: 'company-1',
      issueId: 'issue-1',
      decision: 'cancel',
      note: 'Old landing-page direction.',
      expectedDocuments: [],
    });

    expect(result.ok).toBe(true);
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');
    expect(JSON.parse(String(patch?.[1]?.body))).toEqual({
      status: 'cancelled',
      comment:
        'Founder cancelled obsolete review work in FounderOS. Reviewed: no documents. Reason: Old landing-page direction.',
    });
    expect(result.detail).toBe('confirmed cancelled');
  });

  test('a 2xx without the intended observable status is not reported as success', async () => {
    const fetchMock = reviewFetch({ ignorePatch: true });
    vi.stubGlobal('fetch', fetchMock);

    const result = await decideReview({
      companyId: 'company-1',
      issueId: 'issue-1',
      decision: 'approve',
      expectedDocuments: [{ key: 'draft', latestRevisionNumber: 2 }],
    });

    expect(result.ok).toBe(false);
    expect(result.detail).toContain('still reports in_review');
  });

  test('the review route refuses a malformed revision list', async () => {
    const res = await POST(
      request({
        action: 'review_decision',
        companyId: 'company-1',
        issueId: 'issue-1',
        decision: 'approve',
        expectedDocuments: 'not json',
      }),
    );

    expect(res.status).toBe(400);
    expect((await res.json()).detail).toContain('revision list');
  });
});

describe('the board lanes stay closed over Paperclip statuses', () => {
  // A status with no lane has nowhere to draw its cards. This is the same
  // closed-registry guard the page and API smoke suites use, for the same
  // reason: silence is the worst failure.
  test('one lane per status, no lane without a status', () => {
    expect(LANES.map((lane) => lane.status).sort()).toEqual([...ISSUE_STATUSES].sort());
  });

  test('blocked is not a drop target — Paperclip raises a recovery card for it', () => {
    expect([...NO_DROP]).toEqual(['blocked']);
    expect(LANES.some((lane) => lane.status === 'blocked')).toBe(true);
  });
});
