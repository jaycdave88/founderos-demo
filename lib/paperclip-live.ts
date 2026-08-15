/**
 * Live read of the Paperclip company — installed by personal-ai-stack
 * (scripts/65-founderos-paperclip.sh). Regenerated on every run; edit the
 * installer, not this file.
 *
 * Read-only. Paperclip owns the issues; FounderOS renders them.
 */

export type PaperclipAgent = {
  id: string;
  name: string;
  status: string;
  role?: string | null;
  title?: string | null;
  adapterType?: string;
  adapterConfig?: { model?: string; provider?: string; maxTurnsPerRun?: number };
  lastHeartbeatAt?: string | null;
};

export type PaperclipIssue = {
  id: string;
  identifier?: string;
  title?: string;
  status?: string;
  assigneeAgentId?: string | null;
  updatedAt?: string | null;
};

export type PaperclipDocument = {
  key: string;
  title: string | null;
  format: string;
  body: string;
  latestRevisionNumber: number | null;
};

export type PaperclipSnapshot = {
  ok: boolean;
  base: string;
  companyId: string;
  companyName: string | null;
  agents: PaperclipAgent[];
  issues: PaperclipIssue[];
  /** Deliverables, keyed by issue id. Absent means the issue has none. */
  documents: Record<string, PaperclipDocument[]>;
  /** Every failed call, verbatim. An empty roster with no error means an empty company. */
  errors: string[];
};

const base = (): string =>
  (process.env.PAPERCLIP_BASE_URL ?? 'http://127.0.0.1:3100').replace(/\/$/, '');
const companyId = (): string => process.env.PAPERCLIP_COMPANY_ID ?? '';

async function getJson(path: string, errors: string[], timeoutMs = 5000): Promise<unknown | null> {
  const headers: Record<string, string> = { accept: 'application/json' };
  const key = process.env.PAPERCLIP_API_KEY ?? '';
  if (key) headers.authorization = `Bearer ${key}`;
  try {
    const res = await fetch(`${base()}${path}`, {
      headers,
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      const hint =
        res.status === 401 || res.status === 403
          ? ' — mint one with `paperclipai token create` and set PAPERCLIP_API_KEY in stack.env'
          : '';
      errors.push(`${path} -> HTTP ${res.status}${hint}`);
      return null;
    }
    return (await res.json()) as unknown;
  } catch (err) {
    errors.push(`${path} -> ${err instanceof Error ? err.message : 'request failed'}`);
    return null;
  }
}

/** Paperclip returns bare arrays on some routes and {data:[...]} on others. */
function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') {
    const data = (value as { data?: unknown }).data;
    if (Array.isArray(data)) return data;
    const items = (value as { items?: unknown }).items;
    if (Array.isArray(items)) return items;
  }
  return [];
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function toAgent(raw: unknown): PaperclipAgent | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id = str(o.id);
  if (!id) return null;
  const cfg = (o.adapterConfig ?? {}) as Record<string, unknown>;
  return {
    id,
    name: str(o.name) ?? id,
    status: str(o.status) ?? 'unknown',
    role: str(o.role) ?? null,
    title: str(o.title) ?? null,
    adapterType: str(o.adapterType),
    adapterConfig: {
      model: str(cfg.model),
      provider: str(cfg.provider),
      maxTurnsPerRun: typeof cfg.maxTurnsPerRun === 'number' ? cfg.maxTurnsPerRun : undefined,
    },
    lastHeartbeatAt: str(o.lastHeartbeatAt) ?? null,
  };
}

function toDocument(raw: unknown): PaperclipDocument | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const key = str(o.key);
  if (!key) return null;
  return {
    key,
    title: str(o.title) ?? null,
    format: str(o.format) ?? 'markdown',
    body: str(o.body) ?? '',
    latestRevisionNumber:
      typeof o.latestRevisionNumber === 'number' ? o.latestRevisionNumber : null,
  };
}

function toIssue(raw: unknown): PaperclipIssue | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id = str(o.id);
  if (!id) return null;
  return {
    id,
    identifier: str(o.identifier),
    title: str(o.title),
    status: str(o.status),
    assigneeAgentId: str(o.assigneeAgentId) ?? null,
    updatedAt: str(o.updatedAt) ?? null,
  };
}

export async function getPaperclipSnapshot(): Promise<PaperclipSnapshot> {
  const errors: string[] = [];
  const cid = companyId();
  const empty: PaperclipSnapshot = {
    ok: false,
    base: base(),
    companyId: cid,
    companyName: null,
    agents: [],
    issues: [],
    documents: {},
    errors,
  };

  if (!cid) {
    errors.push(
      'PAPERCLIP_COMPANY_ID is not set. Run scripts/40-paperclip.sh, then scripts/60-founderos.sh to rewrite .env.local.',
    );
    return empty;
  }

  const company = await getJson(`/api/companies/${cid}`, errors);
  const companyName =
    company && typeof company === 'object'
      ? (str((company as Record<string, unknown>).name) ?? null)
      : null;

  // The company-scoped route is the documented one; the flat route exists on
  // some builds and 404s on others, so it is a fallback rather than the default.
  let agentsRaw = await getJson(`/api/companies/${cid}/agents`, errors);
  if (agentsRaw === null) agentsRaw = await getJson(`/api/agents?companyId=${cid}`, errors);

  const issuesRaw = await getJson(`/api/companies/${cid}/issues?view=compact`, errors);

  const agents = asArray(agentsRaw)
    .map(toAgent)
    .filter((a): a is PaperclipAgent => a !== null);
  const issues = asArray(issuesRaw)
    .map(toIssue)
    .filter((i): i is PaperclipIssue => i !== null);

  // Deliverables are the reason to look at this page at all, so fetch them with
  // the board rather than making the reader click through. One request per
  // issue, in parallel, capped — a company with hundreds of issues should not
  // turn one page load into hundreds of round trips.
  const withDocs = issues.slice(0, 40);
  const docLists = await Promise.all(
    withDocs.map(async (issue) => {
      const raw = await getJson(`/api/issues/${issue.id}/documents`, []);
      return asArray(raw)
        .map(toDocument)
        .filter((d): d is PaperclipDocument => d !== null);
    }),
  );
  const documents: Record<string, PaperclipDocument[]> = {};
  withDocs.forEach((issue, idx) => {
    const list = docLists[idx];
    if (list && list.length > 0) documents[issue.id] = list;
  });

  return {
    ...empty,
    ok: agents.length > 0 || issues.length > 0,
    companyName,
    agents,
    issues,
    documents,
  };
}

/* ── writes ──────────────────────────────────────────────────────────────
 * Routes taken from Paperclip's own OpenAPI document, not inferred. Loopback
 * accepts them without a bearer token; the header is sent anyway when
 * PAPERCLIP_API_KEY is set.
 */

export type WriteResult = { ok: boolean; detail: string };

async function post(path: string, payload: unknown): Promise<WriteResult> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const key = process.env.PAPERCLIP_API_KEY ?? '';
  if (key) headers.authorization = `Bearer ${key}`;
  try {
    const res = await fetch(`${base()}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      const text = (await res.text()).slice(0, 300);
      return { ok: false, detail: `HTTP ${res.status}${text ? ` — ${text}` : ''}` };
    }
    return { ok: true, detail: 'ok' };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : 'request failed' };
  }
}

export async function createIssue(input: {
  title: string;
  description?: string;
  assigneeAgentId?: string;
}): Promise<WriteResult> {
  const cid = companyId();
  if (!cid) return { ok: false, detail: 'PAPERCLIP_COMPANY_ID is not set' };
  if (!input.title.trim()) return { ok: false, detail: 'title is required' };
  return post(`/api/companies/${cid}/issues`, {
    title: input.title,
    description: input.description ?? '',
    assigneeAgentId: input.assigneeAgentId || undefined,
  });
}

export async function addComment(issueId: string, body: string): Promise<WriteResult> {
  if (!body.trim()) return { ok: false, detail: 'comment body is required' };
  return post(`/api/issues/${issueId}/comments`, { body });
}

/**
 * Enqueue a heartbeat. Deliberately the invoke route rather than a blocking
 * run: a browser request must not sit open for the minutes an agent takes, and
 * Paperclip already owns the queue.
 */
export async function wakeAgent(agentId: string): Promise<WriteResult> {
  return post(`/api/agents/${agentId}/heartbeat/invoke`, {});
}
