/**
 * /paperclip — the live Paperclip company.
 * Installed by personal-ai-stack (scripts/65-founderos-paperclip.sh).
 *
 * Inline styles on purpose: this file is dropped into a fork whose component
 * library it must not depend on, so it renders correctly no matter what the
 * surrounding app does with CSS.
 */
import type { CSSProperties } from 'react';
import { runtimeEnv } from '@/lib/creds';
import {
  getPaperclipPortfolio,
  getPaperclipSnapshot,
  paperclipCompanyId,
  type PaperclipIssue,
} from '@/lib/paperclip-live';
import { CommentBox, NewTask, ReviewDecision, WakeButton } from './controls';

export const dynamic = 'force-dynamic';

const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace';
// CSSProperties imported explicitly rather than reached through the React UMD
// global: under a strict tsconfig that global is not addressable from a module,
// and a typecheck failure here would break the whole FounderOS build.
const card: CSSProperties = {
  border: '1px solid #262626',
  borderRadius: 6,
  padding: '14px 16px',
  background: '#0b0b0b',
};
const th: CSSProperties = {
  textAlign: 'left',
  padding: '6px 10px',
  borderBottom: '1px solid #262626',
  color: '#7a7a7a',
  fontWeight: 400,
  fontSize: 11,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
};
const td: CSSProperties = {
  padding: '6px 10px',
  borderBottom: '1px solid #171717',
  color: '#d4d4d4',
  fontSize: 13,
  verticalAlign: 'top',
};

function dot(status: string): string {
  if (status === 'running') return '#22c55e';
  if (status === 'error' || status === 'terminated') return '#ef4444';
  if (status === 'paused') return '#eab308';
  return '#525252';
}

function ago(iso: string | null | undefined): string {
  if (!iso) return '—';
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '—';
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export default async function PaperclipPage(props: {
  searchParams?: { companyId?: string };
}) {
  const searchParams = props?.searchParams;
  const portfolio = await getPaperclipPortfolio();
  const requested = searchParams?.companyId;
  const configured = paperclipCompanyId();
  const selectedCompanyId =
    portfolio.companies.find((company) => company.id === requested)?.id ??
    portfolio.companies.find((company) => company.id === configured)?.id ??
    portfolio.companies[0]?.id ??
    requested ??
    configured;
  const snap = await getPaperclipSnapshot(selectedCompanyId, {
    // Review documents must never fall behind the general 40-document page
    // cap. Fetch them first, then use the remaining budget for the work board.
    prioritizeDocumentStatuses: ['in_review'],
    documentLimit: 60,
  });
  const env = runtimeEnv();
  const configuredReviewCap = Number.parseInt(env.FOUNDER_OS_REVIEW_BACKLOG_CAP ?? '20', 10);
  const reviewCap = Number.isFinite(configuredReviewCap) && configuredReviewCap > 0
    ? configuredReviewCap
    : 20;
  const notionCompanyIds = new Set(
    (env.NOTION_DRAFT_COMPANY_IDS ?? '').split(',').map((id) => id.trim()).filter(Boolean),
  );
  const notionUrl = env.NOTION_DRAFT_DATABASE_URL?.trim() ?? '';
  const notionEnabled = env.NOTION_DRAFT_SYNC_ENABLED === '1';
  const notionIncludesCompany = notionCompanyIds.has(snap.companyId);

  const byStatus = new Map<string, PaperclipIssue[]>();
  for (const issue of snap.issues) {
    const key = issue.status ?? 'unknown';
    byStatus.set(key, [...(byStatus.get(key) ?? []), issue]);
  }
  const nameOf = new Map(snap.agents.map((a) => [a.id, a.name]));
  const openIssues = snap.issues.filter((i) => i.status !== 'done' && i.status !== 'cancelled');
  const reviewIssues = snap.issues.filter((i) => i.status === 'in_review');
  const reviewCleanupCount = reviewIssues.filter(
    (issue) => issue.parentId || (snap.documents[issue.id] ?? []).length === 0,
  ).length;
  const reviewPressure = Math.min(100, Math.round((reviewIssues.length / reviewCap) * 100));
  const reviewColor = reviewIssues.length >= reviewCap
    ? '#f87171'
    : reviewPressure >= 75
      ? '#fde047'
      : '#22c55e';

  return (
    <main style={{ fontFamily: mono, padding: 28, background: '#050505', minHeight: '100vh' }}>
      <div style={{ color: '#7a7a7a', fontSize: 11, letterSpacing: '0.12em' }}>
        // PAPERCLIP · LIVE
      </div>
      <h1 style={{ color: '#e5e5e5', fontSize: 26, margin: '6px 0 4px', letterSpacing: '0.04em' }}>
        {snap.companyName ?? 'PAPERCLIP COMPANY'}
      </h1>
      <div style={{ color: snap.ok ? '#22c55e' : '#ef4444', fontSize: 12, marginBottom: 22 }}>
        {snap.ok
          ? `${snap.agents.length} agents · ${openIssues.length} open of ${snap.issues.length} issues · ${snap.base}`
          : `not reachable · ${snap.base}`}
      </div>

      <div style={{ ...card, marginBottom: 22 }}>
        <div style={{ color: '#7a7a7a', fontSize: 11, letterSpacing: '0.08em', marginBottom: 10 }}>
          COMPANY PORTFOLIO
        </div>
        <div style={{ color: '#a3a3a3', fontSize: 12, marginBottom: 12 }}>
          {portfolio.companies.length} companies ·{' '}
          {portfolio.companies.reduce((total, company) => total + company.agentCount, 0)} agents ·{' '}
          {portfolio.companies.reduce((total, company) => total + company.openIssueCount, 0)} open issues
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {portfolio.companies.map((company) => {
            const selected = company.id === snap.companyId;
            const attention = company.blockedIssueCount + company.unassignedOpenIssueCount;
            return (
              <a
                key={company.id}
                href={`/paperclip?companyId=${encodeURIComponent(company.id)}`}
                style={{
                  display: 'block',
                  minWidth: 210,
                  padding: '10px 12px',
                  border: `1px solid ${selected ? '#22c55e' : attention > 0 ? '#7f1d1d' : '#262626'}`,
                  borderRadius: 4,
                  color: '#e5e5e5',
                  background: selected ? '#0d1f14' : '#080808',
                  textDecoration: 'none',
                }}
              >
                <div style={{ fontSize: 13, marginBottom: 5 }}>{company.name}</div>
                <div style={{ color: '#7a7a7a', fontSize: 11 }}>
                  {company.agentCount} agents · {company.openIssueCount} open
                </div>
                <div style={{ color: company.reviewIssueCount >= reviewCap ? '#f87171' : '#c4b5fd', fontSize: 11, marginTop: 4 }}>
                  {company.reviewIssueCount} / {reviewCap} awaiting review
                </div>
                <div style={{ color: attention > 0 ? '#f87171' : '#22c55e', fontSize: 11, marginTop: 4 }}>
                  {company.ok
                    ? attention > 0
                      ? `${company.blockedIssueCount} blocked · ${company.unassignedOpenIssueCount} needs owner`
                      : 'no delivery blockers'
                    : 'company read failed'}
                </div>
              </a>
            );
          })}
          {portfolio.companies.length === 0 && (
            <div style={{ color: '#f87171', fontSize: 12 }}>
              No companies returned from Paperclip. {portfolio.errors.join(' · ')}
            </div>
          )}
        </div>
      </div>

      <div
        id="founder-review"
        style={{
          ...card,
          marginBottom: 22,
          borderColor: reviewIssues.length > 0 ? reviewColor : '#22543d',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <div style={{ color: '#c4b5fd', fontSize: 11, letterSpacing: '0.08em', marginBottom: 8 }}>
              FOUNDER REVIEW
            </div>
            <div style={{ color: '#e5e5e5', fontSize: 18 }}>
              {reviewIssues.length} of {reviewCap} awaiting your decision
            </div>
          </div>
          <div style={{ color: reviewColor, fontSize: 12, alignSelf: 'center' }}>
            {reviewIssues.length === 0
              ? 'queue clear'
              : reviewIssues.length >= reviewCap
                ? 'cadence paused for this company'
                : `${reviewCap - reviewIssues.length} slots before cadence pauses`}
          </div>
        </div>
        <div
          style={{
            height: 5,
            background: '#171717',
            borderRadius: 5,
            overflow: 'hidden',
            margin: '12px 0 8px',
          }}
        >
          <div style={{ width: `${reviewPressure}%`, height: '100%', background: reviewColor }} />
        </div>
        <div style={{ color: '#7a7a7a', fontSize: 11, lineHeight: 1.6, marginBottom: 12 }}>
          At {reviewCap}, autopilot stops creating new cadence issues for this company only. Agents,
          existing work, other companies, backups, and services keep running. Approving closes work;
          it never publishes content.
          {reviewCleanupCount > 0
            ? ` ${reviewCleanupCount} item${reviewCleanupCount === 1 ? '' : 's'} need cleanup because they are child handoffs or have no deliverable.`
            : ''}
        </div>

        {reviewIssues.map((issue, index) => {
          const docs = snap.documents[issue.id] ?? [];
          const cleanupReason = issue.parentId
            ? 'internal child handoff'
            : docs.length === 0
              ? 'missing deliverable'
              : null;
          return (
            <details
              key={issue.id}
              open={index === 0}
              style={{
                border: '1px solid #262626',
                borderRadius: 4,
                padding: '10px 12px',
                marginTop: 8,
                background: '#080808',
              }}
            >
              <summary style={{ cursor: 'pointer', listStyle: 'none', color: '#e5e5e5', fontSize: 13 }}>
                <span style={{ color: '#a78bfa', marginRight: 8 }}>
                  {issue.identifier ?? issue.id.slice(0, 8)}
                </span>
                {issue.title ?? '(untitled)'}
                <span style={{ color: cleanupReason ? '#fbbf24' : '#22c55e', marginLeft: 8, fontSize: 11 }}>
                  {cleanupReason ?? `${docs.length} deliverable${docs.length === 1 ? '' : 's'}`}
                </span>
              </summary>

              <div style={{ color: '#7a7a7a', fontSize: 11, margin: '8px 0' }}>
                {issue.parentId
                  ? 'This is a child issue. Review the output, then close it or cancel it if the parent already owns the canonical deliverable.'
                  : docs.length === 0
                    ? 'No document is attached. Approval is disabled; request the missing output or cancel obsolete work.'
                    : 'Read the exact output below. The server checks these revision numbers again before accepting your decision.'}
              </div>

              {docs.map((doc) => (
                <div key={doc.key} style={{ margin: '10px 0 4px' }}>
                  <div style={{ color: '#7a7a7a', fontSize: 11, letterSpacing: '0.06em' }}>
                    {doc.key.toUpperCase()}
                    {doc.latestRevisionNumber !== null ? ` · rev ${doc.latestRevisionNumber}` : ''}
                    {` · ${doc.body.trim() ? doc.body.trim().split(/\s+/).length : 0} words`}
                  </div>
                  <pre
                    style={{
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      background: '#050505',
                      border: '1px solid #1c1c1c',
                      borderRadius: 4,
                      padding: 12,
                      maxHeight: 520,
                      overflowY: 'auto',
                      fontSize: 12.5,
                      lineHeight: 1.65,
                      color: '#cfcfcf',
                      margin: '6px 0 0',
                    }}
                  >
                    {doc.body}
                  </pre>
                </div>
              ))}

              <ReviewDecision
                companyId={snap.companyId}
                issueId={issue.id}
                documents={docs.map((doc) => ({
                  key: doc.key,
                  latestRevisionNumber: doc.latestRevisionNumber,
                }))}
              />
            </details>
          );
        })}
        {reviewIssues.length === 0 && (
          <div style={{ color: '#86efac', fontSize: 12 }}>
            Nothing needs your review for this company.
          </div>
        )}
      </div>

      <div
        style={{
          ...card,
          marginBottom: 22,
          borderColor: notionEnabled && notionIncludesCompany ? '#22543d' : '#3f3f46',
        }}
      >
        <div style={{ color: '#7a7a7a', fontSize: 11, letterSpacing: '0.08em', marginBottom: 8 }}>
          NOTION DRAFT REVIEW
        </div>
        <div style={{ color: '#d4d4d4', fontSize: 12, lineHeight: 1.6 }}>
          {notionEnabled && notionIncludesCompany
            ? 'Top-level in_review issues with a `draft` document sync one-way for human review.'
            : 'This company is not enabled for Notion draft export.'}
        </div>
        <div style={{ color: '#7a7a7a', fontSize: 11, lineHeight: 1.6, marginTop: 4 }}>
          Paperclip remains the source of truth. Notion edits never assign, close, or publish work.
        </div>
        {notionUrl && (
          <a
            href={notionUrl}
            target="_blank"
            rel="noreferrer"
            style={{ color: '#86efac', fontSize: 12, display: 'inline-block', marginTop: 8 }}
          >
            Open the Notion review library ↗
          </a>
        )}
      </div>

      {snap.errors.length > 0 && (
        <div style={{ ...card, borderColor: '#7f1d1d', marginBottom: 22 }}>
          <div style={{ color: '#f87171', fontSize: 11, letterSpacing: '0.08em', marginBottom: 8 }}>
            PROBLEMS
          </div>
          {snap.errors.map((err) => (
            <div key={err} style={{ color: '#d4d4d4', fontSize: 12, lineHeight: 1.7 }}>
              {err}
            </div>
          ))}
        </div>
      )}

      <div style={{ ...card, marginBottom: 22 }}>
        <div style={{ color: '#7a7a7a', fontSize: 11, letterSpacing: '0.08em', marginBottom: 10 }}>
          NEW TASK
        </div>
        <NewTask
          companyId={snap.companyId}
          agents={snap.agents.map((a) => ({ id: a.id, name: a.name }))}
        />
      </div>

      <div style={{ ...card, marginBottom: 22 }}>
        <div style={{ color: '#7a7a7a', fontSize: 11, letterSpacing: '0.08em', marginBottom: 10 }}>
          ROSTER
        </div>
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              <th style={th}>Agent</th>
              <th style={th}>Role</th>
              <th style={th}>Model</th>
              <th style={th}>Provider</th>
              <th style={th}>Open work</th>
              <th style={th}>Last run</th>
              <th style={th}>Status</th>
              <th style={th}>Run</th>
            </tr>
          </thead>
          <tbody>
            {snap.agents.map((agent) => (
              <tr key={agent.id}>
                <td style={td}>{agent.name}</td>
                <td style={{ ...td, color: '#7a7a7a' }}>{agent.title ?? agent.role ?? '—'}</td>
                <td style={td}>{agent.adapterConfig?.model ?? '—'}</td>
                <td style={{ ...td, color: '#7a7a7a' }}>{agent.adapterConfig?.provider ?? '—'}</td>
                <td style={td}>
                  {openIssues.filter((i) => i.assigneeAgentId === agent.id).length}
                </td>
                <td style={{ ...td, color: '#7a7a7a' }}>{ago(agent.lastHeartbeatAt)}</td>
                <td style={td}>
                  <span style={{ color: dot(agent.status) }}>■</span>{' '}
                  <span style={{ color: '#a3a3a3' }}>{agent.status}</span>
                </td>
                <td style={td}>
                  <WakeButton agentId={agent.id} name={agent.name} />
                </td>
              </tr>
            ))}
            {snap.agents.length === 0 && (
              <tr>
                <td style={{ ...td, color: '#7a7a7a' }} colSpan={8}>
                  No agents returned.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={card}>
        <div style={{ color: '#7a7a7a', fontSize: 11, letterSpacing: '0.08em', marginBottom: 10 }}>
          WORK
        </div>
        {[...byStatus.entries()].filter(([status]) => status !== 'in_review').map(([status, issues]) => (
          <div key={status} style={{ marginBottom: 16 }}>
            <div style={{ color: '#a3a3a3', fontSize: 12, marginBottom: 6 }}>
              {status} · {issues.length}
            </div>
            {issues.map((issue) => {
              const docs = snap.documents[issue.id] ?? [];
              return (
                <details
                  key={issue.id}
                  style={{
                    color: '#d4d4d4',
                    fontSize: 13,
                    lineHeight: 1.8,
                    padding: '6px 0 6px 12px',
                    borderBottom: '1px solid #141414',
                  }}
                >
                  <summary style={{ cursor: 'pointer', listStyle: 'none' }}>
                    <span style={{ color: '#7a7a7a' }}>
                      {issue.identifier ?? issue.id.slice(0, 8)}
                    </span>{' '}
                    {issue.title ?? '(untitled)'}{' '}
                    <span style={{ color: '#525252' }}>
                      {issue.assigneeAgentId
                        ? `→ ${nameOf.get(issue.assigneeAgentId) ?? 'unknown agent'}`
                        : issue.assigneeUserId
                          ? '→ human owner'
                          : issue.status === 'in_review'
                            ? '→ founder review'
                            : '→ unassigned'}
                    </span>
                    {docs.length > 0 && (
                      <span style={{ color: '#22c55e', marginLeft: 8, fontSize: 11 }}>
                        {docs.map((d) => d.key).join(' · ')}
                      </span>
                    )}
                  </summary>

                  {docs.map((doc) => (
                    <div key={doc.key} style={{ margin: '10px 0 4px' }}>
                      <div style={{ color: '#7a7a7a', fontSize: 11, letterSpacing: '0.06em' }}>
                        {doc.key.toUpperCase()}
                        {doc.latestRevisionNumber !== null
                          ? ` · rev ${doc.latestRevisionNumber}`
                          : ''}
                        {` · ${doc.body.trim().split(/\s+/).length} words`}
                      </div>
                      <pre
                        style={{
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                          background: '#080808',
                          border: '1px solid #1c1c1c',
                          borderRadius: 4,
                          padding: 12,
                          maxHeight: 420,
                          overflowY: 'auto',
                          fontSize: 12.5,
                          lineHeight: 1.65,
                          color: '#cfcfcf',
                          margin: '6px 0 0',
                        }}
                      >
                        {doc.body}
                      </pre>
                    </div>
                  ))}

                  <CommentBox issueId={issue.id} />
                </details>
              );
            })}
          </div>
        ))}
        {snap.issues.length === 0 && (
          <div style={{ color: '#7a7a7a', fontSize: 13 }}>
            No issues in this company yet. Work created in Paperclip appears here.
          </div>
        )}
      </div>
    </main>
  );
}
