'use client';

/**
 * The Paperclip work board. Every card is a real issue in the running company,
 * and a lane is a real Paperclip status — no three-column approximation, because
 * collapsing seven statuses into three would make a drop silently rewrite work
 * as something it is not.
 *
 * A drop PATCHes Paperclip and then re-reads the board from the server, so what
 * you see after a move is Paperclip's answer rather than the browser's guess.
 */
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileText, User } from 'lucide-react';
import { ISSUE_STATUSES, type IssueStatus } from '@/lib/paperclip-live';

export type BoardIssue = {
  id: string;
  identifier: string;
  title: string;
  status: string;
  assignee: string | null;
  /** Document keys on this issue. Deliverables are the point; their absence is a signal. */
  docKeys: string[];
};

/** Exported so a test can assert the lanes stay closed over Paperclip's statuses. */
export const LANES: { status: IssueStatus; label: string; tone: string }[] = [
  { status: 'backlog', label: 'Backlog', tone: 'var(--text-3)' },
  { status: 'todo', label: 'To do', tone: 'var(--text-2)' },
  { status: 'in_progress', label: 'In progress', tone: 'var(--warn)' },
  { status: 'in_review', label: 'In review', tone: 'var(--accent)' },
  { status: 'done', label: 'Done', tone: 'var(--ok)' },
  { status: 'blocked', label: 'Blocked', tone: 'var(--err)' },
  { status: 'cancelled', label: 'Cancelled', tone: 'var(--text-3)' },
];

/**
 * Blocked is agent-set, not human-set: Paperclip raises a recovery card for a
 * blocked issue with no named unblock owner, and that card stays open until a
 * human clears it. Dragging work *out* of blocked is the useful direction.
 */
export const NO_DROP: ReadonlySet<IssueStatus> = new Set<IssueStatus>(['blocked']);

/** Statuses that mean an agent is mid-flight, so the board is worth re-reading. */
const LIVE: ReadonlySet<string> = new Set(['in_progress', 'in_review']);

export function TaskBoard({ issues }: { issues: BoardIssue[] }) {
  const router = useRouter();
  const [moves, setMoves] = useState<Record<string, IssueStatus>>({});
  const [failures, setFailures] = useState<Record<string, string>>({});
  const [dragId, setDragId] = useState<string | null>(null);
  const [overLane, setOverLane] = useState<IssueStatus | null>(null);
  const inFlight = useRef(0);

  // Retire an optimistic move once the server reports the same status. Returning
  // `prev` untouched when nothing matched keeps this from looping on every render.
  useEffect(() => {
    setMoves((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const issue of issues) {
        if (next[issue.id] && next[issue.id] === issue.status) {
          delete next[issue.id];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [issues]);

  const shown = issues.map((issue) => ({ ...issue, status: moves[issue.id] ?? issue.status }));

  // Poll only while something is actually running. Heartbeats are off by
  // default, so an idle board changes only when a human acts — polling it on a
  // timer would be dozens of requests per minute to answer "still nothing".
  const running = shown.some((issue) => LIVE.has(issue.status));
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      if (document.visibilityState === 'visible' && inFlight.current === 0) router.refresh();
    }, 10_000);
    return () => clearInterval(id);
  }, [running, router]);

  const move = async (id: string, status: IssueStatus) => {
    const current = shown.find((issue) => issue.id === id);
    if (!current || current.status === status) return;

    setMoves((prev) => ({ ...prev, [id]: status }));
    setFailures((prev) => {
      const { [id]: _dropped, ...rest } = prev;
      return rest;
    });
    inFlight.current += 1;
    try {
      const res = await fetch('/api/paperclip', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'set_status', issueId: id, status }),
      });
      const data = (await res.json()) as { ok?: boolean; detail?: string };
      if (res.ok && data.ok) {
        router.refresh();
        return;
      }
      // Put the card back where Paperclip still has it and say why it stayed.
      setMoves((prev) => {
        const { [id]: _rejected, ...rest } = prev;
        return rest;
      });
      setFailures((prev) => ({ ...prev, [id]: data.detail ?? `refused (HTTP ${res.status})` }));
    } catch (err) {
      setMoves((prev) => {
        const { [id]: _failed, ...rest } = prev;
        return rest;
      });
      setFailures((prev) => ({
        ...prev,
        [id]: err instanceof Error ? err.message : 'request failed',
      }));
    } finally {
      inFlight.current -= 1;
    }
  };

  // A status with no lane would leave its cards nowhere on the board. Count and
  // name them instead: a card that quietly does not exist is the worst outcome.
  const unknown = shown.filter((issue) => !ISSUE_STATUSES.includes(issue.status as IssueStatus));

  return (
    <div>
      <p className="mb-4 font-mono text-[11px] text-os-dim">
        Live from Paperclip. Drag a card to move the issue{running ? ' · re-reading every 10s while work is running' : ''}.
      </p>

      <div className="flex gap-3 overflow-x-auto pb-2">
        {LANES.map((lane) => {
          const laneIssues = shown.filter((issue) => issue.status === lane.status);
          const droppable = !NO_DROP.has(lane.status);
          const over = overLane === lane.status;
          return (
            <div
              key={lane.status}
              onDragOver={(e) => {
                if (!droppable) return;
                e.preventDefault();
                setOverLane(lane.status);
              }}
              onDragLeave={() => setOverLane((c) => (c === lane.status ? null : c))}
              onDrop={(e) => {
                if (!droppable) return;
                e.preventDefault();
                setOverLane(null);
                if (dragId) void move(dragId, lane.status);
                setDragId(null);
              }}
              className={`flex min-h-[260px] w-[240px] shrink-0 flex-col gap-2.5 rounded-xl border p-3 transition-colors ${
                over ? 'border-os-accent bg-os-surface2' : 'border-os-border bg-os-surface'
              }`}
            >
              <div className="mb-1 flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full" style={{ background: lane.tone }} />
                  <span className="font-mono text-[11px] font-bold uppercase tracking-widest text-os-muted">
                    {lane.label}
                  </span>
                </span>
                <span className="font-mono text-[11px] text-os-dim">{laneIssues.length}</span>
              </div>

              {laneIssues.map((issue) => (
                <div
                  key={issue.id}
                  draggable
                  onDragStart={() => setDragId(issue.id)}
                  onDragEnd={() => {
                    setDragId(null);
                    setOverLane(null);
                  }}
                  className={`cursor-grab rounded-lg border border-os-border bg-os-bg p-3 transition-opacity active:cursor-grabbing ${
                    dragId === issue.id ? 'opacity-40' : ''
                  }`}
                >
                  <div className="font-mono text-[10px] text-os-dim">{issue.identifier}</div>
                  <div
                    className={`mt-1 text-[12.5px] font-medium leading-snug ${
                      issue.status === 'done' || issue.status === 'cancelled'
                        ? 'text-os-dim line-through'
                        : 'text-os-text'
                    }`}
                  >
                    {issue.title}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] text-os-dim">
                    <span className="flex items-center gap-1.5">
                      <User className="h-3 w-3" />
                      {issue.assignee ?? 'unassigned'}
                    </span>
                    {issue.docKeys.length > 0 && (
                      <span className="flex items-center gap-1.5" style={{ color: 'var(--ok)' }}>
                        <FileText className="h-3 w-3" />
                        {issue.docKeys.join(' · ')}
                      </span>
                    )}
                  </div>
                  {failures[issue.id] && (
                    <div className="mt-2 font-mono text-[10px] leading-relaxed" style={{ color: 'var(--err)' }}>
                      {failures[issue.id]}
                    </div>
                  )}
                </div>
              ))}

              {laneIssues.length === 0 && (
                <div className="rounded-lg border border-dashed border-os-border px-3 py-6 text-center font-mono text-[10px] text-os-dim">
                  {droppable ? 'drop here' : 'agents set this'}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {unknown.length > 0 && (
        <p className="mt-3 font-mono text-[11px]" style={{ color: 'var(--warn)' }}>
          {unknown.length} issue{unknown.length === 1 ? '' : 's'} in a status this board does not
          have a lane for: {[...new Set(unknown.map((i) => i.status))].join(', ')}
        </p>
      )}
    </div>
  );
}
