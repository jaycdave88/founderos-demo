'use client';

/**
 * Starting work from the board.
 *
 * Creating an issue does not run it. Paperclip only wakes an agent when asked,
 * and heartbeats are off, so this says so rather than leaving you watching a
 * card that will never move on its own.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';

export type AssignableAgent = { id: string; name: string };

const field =
  'w-full rounded-md-t border border-os-border bg-os-bg px-3 py-2 text-[12.5px] text-os-text placeholder:text-os-dim focus:border-os-accent focus:outline-none';

export function NewTask({ agents }: { agents: AssignableAgent[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assigneeAgentId, setAssignee] = useState(agents[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  const create = async () => {
    setBusy(true);
    setNote('');
    try {
      const res = await fetch('/api/paperclip', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'create_issue', title, description, assigneeAgentId }),
      });
      const data = (await res.json()) as { ok?: boolean; detail?: string };
      if (res.ok && data.ok) {
        setTitle('');
        setDescription('');
        setOpen(false);
        router.refresh();
        return;
      }
      setNote(data.detail ?? `refused (HTTP ${res.status})`);
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'request failed');
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mb-4 inline-flex items-center gap-1.5 rounded-md-t border border-os-border bg-os-surface px-3 py-1.5 font-mono text-[11px] uppercase tracking-widest text-os-muted transition-colors hover:border-os-accent hover:text-os-accent"
      >
        <Plus className="h-3.5 w-3.5" /> New task
      </button>
    );
  }

  return (
    <div className="mb-4 rounded-lg-t border border-os-border bg-os-surface p-4">
      <div className="mb-3 font-mono text-[11px] font-bold uppercase tracking-widest text-os-muted">
        New task
      </div>
      <input
        className={field}
        placeholder="What needs doing?"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <textarea
        className={`${field} mt-2 min-h-[88px] resize-y`}
        placeholder="Detail. If it needs more than one person, say so and ask for it to be decomposed."
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select
          className={`${field} w-auto`}
          value={assigneeAgentId}
          onChange={(e) => setAssignee(e.target.value)}
        >
          {agents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name}
            </option>
          ))}
        </select>
        <button
          disabled={busy || !title.trim()}
          onClick={() => void create()}
          className="rounded-md-t border border-os-border bg-os-surface2 px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-os-text transition-colors hover:border-os-accent disabled:opacity-40"
        >
          {busy ? 'creating…' : 'Create'}
        </button>
        <button
          onClick={() => {
            setOpen(false);
            setNote('');
          }}
          className="px-2 py-2 font-mono text-[11px] uppercase tracking-widest text-os-dim hover:text-os-muted"
        >
          Cancel
        </button>
        {note && <span className="font-mono text-[11px] text-os-err">{note}</span>}
      </div>
      <p className="mt-3 font-mono text-[10.5px] leading-relaxed text-os-dim">
        Lands in <span className="text-os-muted">To do</span> when assigned,{' '}
        <span className="text-os-muted">Backlog</span> when not — Paperclip&apos;s own default, not a
        guess. Creating it does not start it: wake the assignee from{' '}
        <span className="text-os-muted">/paperclip</span> when you want it run.
      </p>
    </div>
  );
}
