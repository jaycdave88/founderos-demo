/**
 * /tasks — the Paperclip work board.
 *
 * The seeded agent_tasks table this page used to read is gone with the rest of
 * the demo fixtures, and the work is real now: Paperclip owns it. This reads the
 * live company and renders nothing it cannot see.
 */
import { PageHeader } from '@/components/PageHeader';
import { getPaperclipSnapshot } from '@/lib/paperclip-live';
import { TaskBoard, type BoardIssue } from './board';

export const dynamic = 'force-dynamic';

export default async function TasksPage() {
  const snap = await getPaperclipSnapshot();
  const nameOf = new Map(snap.agents.map((agent) => [agent.id, agent.name]));

  // Document bodies are fetched with the snapshot but deliberately not passed
  // down: the board only needs to know a deliverable exists, and shipping full
  // drafts to the browser every ten seconds to draw a badge is waste. /paperclip
  // is where you read them.
  const issues: BoardIssue[] = snap.issues.map((issue) => ({
    id: issue.id,
    identifier: issue.identifier ?? issue.id.slice(0, 8),
    title: issue.title ?? '(untitled)',
    status: issue.status ?? 'unknown',
    assignee: issue.assigneeAgentId ? (nameOf.get(issue.assigneeAgentId) ?? 'unknown agent') : null,
    docKeys: (snap.documents[issue.id] ?? []).map((doc) => doc.key),
  }));

  const open = issues.filter((i) => i.status !== 'done' && i.status !== 'cancelled').length;

  return (
    <div>
      <PageHeader
        eyebrow="paperclip · live"
        title="Tasks"
        right={
          <span className="font-mono text-[11px] text-os-dim">
            {snap.ok ? `${open} open of ${issues.length}` : 'not connected'}
          </span>
        }
      />

      {!snap.ok && (
        <div className="mb-5 rounded-xl border border-os-border bg-os-surface p-4">
          <div className="font-mono text-[11px] font-bold uppercase tracking-widest" style={{ color: 'var(--err)' }}>
            Paperclip not reachable
          </div>
          <p className="mt-2 font-mono text-[11px] leading-relaxed text-os-muted">
            No board is drawn rather than an empty one, which would read as a company with
            nothing to do. Tried {snap.base}.
          </p>
          {snap.errors.map((err) => (
            <div key={err} className="mt-1.5 font-mono text-[11px] leading-relaxed text-os-dim">
              {err}
            </div>
          ))}
        </div>
      )}

      {snap.ok && <TaskBoard issues={issues} />}
    </div>
  );
}
