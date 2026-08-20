/**
 * Live read of the Paperclip company. Paperclip owns the issues; FounderOS
 * renders them and can nudge them.
 *
 * Tracked code in this repo — an earlier version of this file was written into
 * the clone by a personal-ai-stack installer, which froze the fork on one pin
 * and broke its smoke suites. Edit it here.
 */

import { z } from 'zod';

const CompanyIdSchema = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);
const PaperclipCompanySchema = z.object({
  id: CompanyIdSchema,
  name: z.string().trim().min(1).nullish(),
});

export type PaperclipCompany = {
  id: string;
  name: string;
};

export type PaperclipCompanies = {
  ok: boolean;
  base: string;
  companies: PaperclipCompany[];
  errors: string[];
};

export type PaperclipCompanySummary = PaperclipCompany & {
  ok: boolean;
  agentCount: number;
  issueCount: number;
  openIssueCount: number;
  reviewIssueCount: number;
  blockedIssueCount: number;
  recoveringIssueCount: number;
  unassignedOpenIssueCount: number;
  errors: string[];
};

export type PaperclipPortfolio = {
  ok: boolean;
  base: string;
  companies: PaperclipCompanySummary[];
  errors: string[];
};

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

/**
 * Paperclip's issue statuses, in board order — left to right is the path work
 * actually takes. Membership matches Paperclip's own ISSUE_STATUSES exactly;
 * only the order differs, so this is safe to validate against.
 */
export const ISSUE_STATUSES = [
  'backlog',
  'todo',
  'in_progress',
  'in_review',
  'done',
  'blocked',
  'cancelled',
] as const;

export type IssueStatus = (typeof ISSUE_STATUSES)[number];

export function isIssueStatus(value: string): value is IssueStatus {
  return (ISSUE_STATUSES as readonly string[]).includes(value);
}

export type PaperclipIssue = {
  id: string;
  companyId?: string;
  identifier?: string;
  title?: string;
  status?: string;
  parentId?: string | null;
  assigneeAgentId?: string | null;
  assigneeUserId?: string | null;
  executionState?: PaperclipExecutionState | null;
  activeRecoveryAction?: PaperclipRecoveryAction | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type PaperclipRecoveryAction = {
  id?: string;
  status?: string;
  ownerType?: string;
  ownerAgentId?: string | null;
  ownerUserId?: string | null;
  cause?: string;
  nextAction?: string | null;
};

export type PaperclipExecutionParticipant = {
  type?: string;
  agentId?: string;
  userId?: string;
};

export type PaperclipExecutionState = {
  status?: string;
  currentStageId?: string;
  currentStageIndex?: number;
  currentParticipant?: PaperclipExecutionParticipant | null;
  lastDecisionId?: string | null;
  lastDecisionOutcome?: string | null;
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

export const paperclipBase = (): string =>
  (process.env.PAPERCLIP_BASE_URL ?? 'http://127.0.0.1:3100').replace(/\/$/, '');
export const paperclipCompanyId = (): string => process.env.PAPERCLIP_COMPANY_ID ?? '';

const base = paperclipBase;
const companyId = paperclipCompanyId;

function selectedCompanyId(explicit?: string): string {
  const parsed = CompanyIdSchema.safeParse(explicit?.trim() || companyId());
  return parsed.success ? parsed.data : '';
}

/** Auth header for Paperclip. Loopback accepts writes without one; the bearer
 *  is sent anyway when PAPERCLIP_API_KEY is set. */
export function paperclipHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = { accept: 'application/json', ...extra };
  const key = process.env.PAPERCLIP_API_KEY ?? '';
  if (key) headers.authorization = `Bearer ${key}`;
  return headers;
}

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

function toExecutionParticipant(raw: unknown): PaperclipExecutionParticipant | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  return {
    type: str(o.type),
    agentId: str(o.agentId),
    userId: str(o.userId),
  };
}

function toExecutionState(raw: unknown): PaperclipExecutionState | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  return {
    status: str(o.status),
    currentStageId: str(o.currentStageId),
    currentStageIndex:
      typeof o.currentStageIndex === 'number' ? o.currentStageIndex : undefined,
    currentParticipant: toExecutionParticipant(o.currentParticipant),
    lastDecisionId: str(o.lastDecisionId) ?? null,
    lastDecisionOutcome: str(o.lastDecisionOutcome) ?? null,
  };
}

function toIssue(raw: unknown): PaperclipIssue | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id = str(o.id);
  if (!id) return null;
  return {
    id,
    companyId: str(o.companyId),
    identifier: str(o.identifier),
    title: str(o.title),
    status: str(o.status),
    parentId: str(o.parentId) ?? null,
    assigneeAgentId: str(o.assigneeAgentId) ?? null,
    assigneeUserId: str(o.assigneeUserId) ?? null,
    executionState: toExecutionState(o.executionState),
    activeRecoveryAction: toRecoveryAction(o.activeRecoveryAction),
    createdAt: str(o.createdAt) ?? null,
    updatedAt: str(o.updatedAt) ?? null,
  };
}

function toRecoveryAction(raw: unknown): PaperclipRecoveryAction | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  return {
    id: str(o.id),
    status: str(o.status),
    ownerType: str(o.ownerType),
    ownerAgentId: str(o.ownerAgentId) ?? null,
    ownerUserId: str(o.ownerUserId) ?? null,
    cause: str(o.cause),
    nextAction: str(o.nextAction) ?? null,
  };
}

/**
 * Founder review is a business queue, not an alias for Paperclip's entire
 * `in_review` lane. Delegated children belong to their accountable parent, and
 * a native execution-policy stage assigned to an agent belongs to that agent.
 * Legacy top-level issues have no executionState and remain founder-visible.
 */
export function isFounderReviewIssue(issue: PaperclipIssue): boolean {
  if (issue.status !== 'in_review' || !!issue.parentId) return false;
  const participant =
    issue.executionState?.status === 'pending'
      ? issue.executionState.currentParticipant
      : null;
  return participant?.type !== 'agent';
}

export async function getPaperclipCompanies(): Promise<PaperclipCompanies> {
  const errors: string[] = [];
  const raw = await getJson('/api/companies', errors);
  const companies = asArray(raw).flatMap((item, index) => {
    const parsed = PaperclipCompanySchema.safeParse(item);
    if (!parsed.success) {
      errors.push(`/api/companies[${index}] -> invalid company payload`);
      return [];
    }
    return [{ id: parsed.data.id, name: parsed.data.name ?? parsed.data.id }];
  });
  return { ok: raw !== null && errors.length === 0, base: base(), companies, errors };
}

/** A node in Paperclip's reporting tree. `reports` is the agents under it. */
export type OrgNode = {
  id: string;
  name: string;
  role: string;
  status: string;
  reports: OrgNode[];
};

/**
 * Depth cap. Paperclip builds the tree from parent pointers, and a cycle there
 * would otherwise recurse until the stack goes — a hierarchy this deep is a bug
 * worth truncating rather than a company worth drawing.
 */
const MAX_ORG_DEPTH = 12;

function toOrgNode(raw: unknown, depth = 0): OrgNode | null {
  if (!raw || typeof raw !== 'object' || depth > MAX_ORG_DEPTH) return null;
  const o = raw as Record<string, unknown>;
  const id = str(o.id);
  if (!id) return null;
  return {
    id,
    name: str(o.name) ?? id,
    role: str(o.role) ?? 'unknown',
    status: str(o.status) ?? 'unknown',
    reports: asArray(o.reports)
      .map((child) => toOrgNode(child, depth + 1))
      .filter((n): n is OrgNode => n !== null),
  };
}

export type PaperclipOrg = { ok: boolean; base: string; nodes: OrgNode[]; errors: string[] };

/** The company's reporting tree, as Paperclip builds it. */
export async function getPaperclipOrg(explicitCompanyId?: string): Promise<PaperclipOrg> {
  const errors: string[] = [];
  const cid = selectedCompanyId(explicitCompanyId);
  if (!cid) {
    errors.push('A valid Paperclip company id is required.');
    return { ok: false, base: base(), nodes: [], errors };
  }
  const raw = await getJson(`/api/companies/${cid}/org`, errors);
  const nodes = asArray(raw)
    .map((n) => toOrgNode(n))
    .filter((n): n is OrgNode => n !== null);
  return { ok: nodes.length > 0, base: base(), nodes, errors };
}

export async function getPaperclipSnapshot(
  explicitCompanyId?: string,
  options: {
    includeDocuments?: boolean;
    documentStatuses?: string[];
    additionalDocumentIssueIds?: string[];
    prioritizeDocumentStatuses?: string[];
    topLevelOnly?: boolean;
    documentLimit?: number;
    hydrateDocumentIssues?: boolean;
  } = {},
): Promise<PaperclipSnapshot> {
  const errors: string[] = [];
  const cid = selectedCompanyId(explicitCompanyId);
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
      'A valid Paperclip company id is required. Set PAPERCLIP_COMPANY_ID or select a company.',
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
  let issues = asArray(issuesRaw)
    .map(toIssue)
    .filter((i): i is PaperclipIssue => i !== null);

  // Deliverables are the reason to look at this page at all, so fetch them with
  // the board rather than making the reader click through. One request per
  // issue, in parallel, capped — a company with hundreds of issues should not
  // turn one page load into hundreds of round trips.
  let documentIssues = issues;
  const additionalDocumentIssueIds = new Set(options.additionalDocumentIssueIds ?? []);
  if (options.documentStatuses?.length) {
    const statuses = new Set(options.documentStatuses);
    documentIssues = documentIssues.filter(
      (issue) => statuses.has(issue.status ?? '') || additionalDocumentIssueIds.has(issue.id),
    );
  }
  if (options.topLevelOnly) {
    documentIssues = documentIssues.filter((issue) => !issue.parentId);
  }
  if (additionalDocumentIssueIds.size > 0 || options.prioritizeDocumentStatuses?.length) {
    const priority = new Set(options.prioritizeDocumentStatuses);
    documentIssues = [
      // Existing ungrouped Notion rows are bounded and go first so a large
      // current review queue cannot starve the one-time legacy repair.
      ...documentIssues.filter((issue) => additionalDocumentIssueIds.has(issue.id)),
      ...documentIssues.filter(
        (issue) => !additionalDocumentIssueIds.has(issue.id) && priority.has(issue.status ?? ''),
      ),
      ...documentIssues.filter(
        (issue) => !additionalDocumentIssueIds.has(issue.id) && !priority.has(issue.status ?? ''),
      ),
    ];
  }
  const documentLimit = Math.max(0, Math.min(options.documentLimit ?? 40, 500));
  let withDocs = options.includeDocuments === false ? [] : documentIssues.slice(0, documentLimit);
  if (options.hydrateDocumentIssues && withDocs.length > 0) {
    // Compact issue rows may omit creation/source timestamps on older work.
    // Hydrate only the bounded document candidates from the authoritative
    // issue endpoint so Notion can backfill dates without multiplying every
    // normal FounderOS board read into hundreds of requests.
    const hydrated = await Promise.all(
      withDocs.map(async (issue) => toIssue(await getJson(`/api/issues/${issue.id}`, []))),
    );
    const byId = new Map(
      hydrated.filter((issue): issue is PaperclipIssue => issue !== null).map((issue) => [issue.id, issue]),
    );
    issues = issues.map((issue) => byId.get(issue.id) ?? issue);
    withDocs = withDocs.map((issue) => byId.get(issue.id) ?? issue);
  }
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
    ok: company !== null && agentsRaw !== null && issuesRaw !== null,
    companyName,
    agents,
    issues,
    documents,
  };
}

export async function getPaperclipPortfolio(): Promise<PaperclipPortfolio> {
  const listed = await getPaperclipCompanies();
  const snapshots = await Promise.all(
    listed.companies.map((company) =>
      getPaperclipSnapshot(company.id, { includeDocuments: false }),
    ),
  );
  const companies = listed.companies.map((company, index): PaperclipCompanySummary => {
    const snapshot = snapshots[index];
    const open = snapshot.issues.filter(
      (issue) => issue.status !== 'done' && issue.status !== 'cancelled',
    );
    return {
      ...company,
      ok: snapshot.ok,
      agentCount: snapshot.agents.length,
      issueCount: snapshot.issues.length,
      openIssueCount: open.length,
      reviewIssueCount: open.filter(isFounderReviewIssue).length,
      blockedIssueCount: open.filter((issue) => issue.status === 'blocked').length,
      recoveringIssueCount: open.filter(
        (issue) =>
          issue.status === 'blocked' && issue.activeRecoveryAction?.status === 'active',
      ).length,
      // Founder review is a deliberate queue, not abandoned agent work. A
      // human assignee is also an owner even when assigneeAgentId is null.
      unassignedOpenIssueCount: open.filter(
        (issue) =>
          issue.status !== 'in_review' &&
          !issue.assigneeAgentId &&
          !issue.assigneeUserId,
      ).length,
      errors: snapshot.errors,
    };
  });
  const errors = [
    ...listed.errors,
    ...companies.flatMap((company) =>
      company.errors.map((error) => `${company.name}: ${error}`),
    ),
  ];
  return {
    ok: listed.ok && companies.every((company) => company.ok),
    base: listed.base,
    companies,
    errors,
  };
}

/* ── writes ──────────────────────────────────────────────────────────────
 * Routes taken from Paperclip's own OpenAPI document, not inferred. Loopback
 * accepts them without a bearer token; the header is sent anyway when
 * PAPERCLIP_API_KEY is set.
 */

export type WriteResult = { ok: boolean; detail: string; data?: unknown };

export type ReviewDecision = 'approve' | 'request_changes' | 'cancel';

export type ReviewRevision = {
  key: string;
  latestRevisionNumber: number | null;
};

async function send(method: 'POST' | 'PATCH', path: string, payload: unknown): Promise<WriteResult> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const key = process.env.PAPERCLIP_API_KEY ?? '';
  if (key) headers.authorization = `Bearer ${key}`;
  try {
    const res = await fetch(`${base()}${path}`, {
      method,
      headers,
      body: JSON.stringify(payload),
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });
    const responseText = await res.text();
    if (!res.ok) {
      // Paperclip's rejection text is the useful half — it names the field it
      // refused. Swallowing it for a tidy "failed" is how a wrong payload turns
      // into a debugging session.
      const text = responseText.slice(0, 300);
      return { ok: false, detail: `HTTP ${res.status}${text ? ` — ${text}` : ''}` };
    }
    let data: unknown;
    if (responseText) {
      try {
        data = JSON.parse(responseText) as unknown;
      } catch {
        data = responseText;
      }
    }
    return { ok: true, detail: 'ok', data };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : 'request failed' };
  }
}

const post = (path: string, payload: unknown) => send('POST', path, payload);

export async function createIssue(input: {
  companyId?: string;
  title: string;
  description?: string;
  assigneeAgentId?: string;
}): Promise<WriteResult> {
  const cid = selectedCompanyId(input.companyId);
  if (!cid) return { ok: false, detail: 'a valid companyId is required' };
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
 * Move an issue to another status.
 *
 * `PATCH /api/issues/{id}` takes every issue field partially, so sending
 * `status` alone leaves title, assignee and parent untouched — checked against
 * Paperclip's own `updateIssueSchema` rather than inferred from the route name.
 *
 * The schema also carries a `reopen` flag, and whether a move out of done or
 * cancelled needs it is not established. It is deliberately not sent: an
 * unverified flag that might wake an agent is worse than a rejection whose text
 * this returns verbatim.
 */
export async function setIssueStatus(issueId: string, status: string): Promise<WriteResult> {
  if (!issueId.trim()) return { ok: false, detail: 'issueId is required' };
  if (!isIssueStatus(status)) {
    return { ok: false, detail: `unknown status "${status}" — Paperclip takes ${ISSUE_STATUSES.join(', ')}` };
  }
  return send('PATCH', `/api/issues/${issueId}`, { status });
}

function revisionToken(documents: ReviewRevision[]): string {
  return documents
    .map((document) => `${document.key}@${document.latestRevisionNumber ?? 'none'}`)
    .sort()
    .join('|');
}

/**
 * Record a founder's review decision without separating the decision comment
 * from the state transition. Paperclip's review policy evaluates both fields
 * in the same PATCH, and this also leaves one auditable event instead of two
 * writes that can race or only half-succeed.
 *
 * The company membership, current status and document revisions are re-read
 * immediately before the PATCH. A stale browser tab therefore cannot approve
 * a revision it did not display.
 */
export async function decideReview(input: {
  companyId: string;
  issueId: string;
  decision: ReviewDecision;
  note?: string;
  expectedDocuments: ReviewRevision[];
}): Promise<WriteResult> {
  const cid = selectedCompanyId(input.companyId);
  if (!cid) return { ok: false, detail: 'a valid companyId is required' };
  if (!input.issueId.trim()) return { ok: false, detail: 'issueId is required' };
  if (!['approve', 'request_changes', 'cancel'].includes(input.decision)) {
    return { ok: false, detail: `unknown review decision "${input.decision}"` };
  }

  const note = input.note?.trim() ?? '';
  if ((input.decision === 'request_changes' || input.decision === 'cancel') && !note) {
    return {
      ok: false,
      detail: input.decision === 'cancel' ? 'a cancellation reason is required' : 'requested changes are required',
    };
  }
  if (note.length > 2000) return { ok: false, detail: 'review note must be 2000 characters or fewer' };

  const targetStatus =
    input.decision === 'approve'
      ? 'done'
      : input.decision === 'request_changes'
        ? 'in_progress'
        : 'cancelled';

  const errors: string[] = [];
  // The company compact list is a read model and can briefly lag a successful
  // PATCH. The direct issue route is the authoritative retry/staleness check.
  const issueRaw = await getJson(`/api/issues/${input.issueId}`, errors);
  if (issueRaw === null) return { ok: false, detail: errors.join(' · ') || 'could not read issue' };
  const issue = toIssue(issueRaw);
  if (!issue || issue.companyId !== cid) {
    return { ok: false, detail: 'issue does not belong to the selected company' };
  }
  // A browser retry after a committed decision must not append another audit
  // comment. The requested terminal state is already the desired outcome.
  if (issue.status === targetStatus) {
    return { ok: true, detail: `already ${targetStatus}; no duplicate decision written` };
  }
  if (issue.status !== 'in_review') {
    return { ok: false, detail: `review is stale: issue is ${issue.status ?? 'unknown'}, not in_review` };
  }

  const documentsRaw = await getJson(`/api/issues/${input.issueId}/documents`, errors);
  if (documentsRaw === null) return { ok: false, detail: errors.join(' · ') || 'could not read issue documents' };
  const currentDocuments = asArray(documentsRaw)
    .map(toDocument)
    .filter((document): document is PaperclipDocument => document !== null)
    .map(({ key, latestRevisionNumber }) => ({ key, latestRevisionNumber }));

  if (revisionToken(currentDocuments) !== revisionToken(input.expectedDocuments)) {
    return { ok: false, detail: 'review is stale: the deliverables changed; refresh and read the latest revision' };
  }
  if (input.decision === 'approve' && currentDocuments.length === 0) {
    return { ok: false, detail: 'cannot approve an issue with no deliverable document' };
  }

  const reviewed = currentDocuments.length > 0
    ? currentDocuments
        .map((document) => `${document.key}@rev ${document.latestRevisionNumber ?? 'unknown'}`)
        .sort()
        .join(', ')
    : 'no documents';
  const suffix = note ? ` Note: ${note}` : '';
  const transition =
    input.decision === 'approve'
      ? { status: 'done', comment: `Founder approved in FounderOS. Reviewed: ${reviewed}.${suffix}` }
      : input.decision === 'request_changes'
        ? { status: 'in_progress', comment: `Founder requested changes in FounderOS. Reviewed: ${reviewed}. Changes: ${note}` }
        : { status: 'cancelled', comment: `Founder cancelled obsolete review work in FounderOS. Reviewed: ${reviewed}. Reason: ${note}` };

  const written = await send('PATCH', `/api/issues/${input.issueId}`, transition);
  if (!written.ok) return written;

  // Paperclip returns the committed issue from PATCH. Use it directly instead
  // of immediately querying the eventually refreshed compact-list read model.
  const confirmed = toIssue(written.data);
  if (!confirmed || confirmed.companyId !== cid) {
    return { ok: false, detail: 'Paperclip accepted the decision but returned no verifiable issue state' };
  }
  if (confirmed.status === targetStatus) {
    return { ok: true, detail: `confirmed ${targetStatus}` };
  }

  // Approving one native execution-policy stage can legitimately leave the
  // issue in_review while moving it to the next participant. A new decision id
  // is the durable proof that this request advanced the workflow.
  const previousDecisionId = issue.executionState?.lastDecisionId ?? null;
  const nextDecisionId = confirmed.executionState?.lastDecisionId ?? null;
  if (
    input.decision === 'approve' &&
    confirmed.status === 'in_review' &&
    !!nextDecisionId &&
    nextDecisionId !== previousDecisionId
  ) {
    return { ok: true, detail: 'confirmed approval; advanced to the next review stage' };
  }

  return {
    ok: false,
    detail: `Paperclip accepted the decision but returned ${confirmed.status ?? 'unknown'}; expected ${targetStatus}`,
  };
}

/**
 * Enqueue a heartbeat. Deliberately the invoke route rather than a blocking
 * run: a browser request must not sit open for the minutes an agent takes, and
 * Paperclip already owns the queue.
 */
export async function wakeAgent(agentId: string): Promise<WriteResult> {
  return post(`/api/agents/${agentId}/heartbeat/invoke`, {});
}
