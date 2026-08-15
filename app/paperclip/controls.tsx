'use client';

/**
 * The write half of /paperclip — installed by personal-ai-stack
 * (scripts/65-founderos-paperclip.sh). Regenerated on every run.
 *
 * Every action posts to /api/paperclip and then refreshes the server component,
 * so what you see after a write is re-read from Paperclip rather than patched
 * optimistically in the browser. Slower by a beat, and never shows you a board
 * that does not exist.
 */
import { useRouter } from 'next/navigation';
import { useState, type CSSProperties } from 'react';

const input: CSSProperties = {
  width: '100%',
  background: '#0b0b0b',
  color: '#e5e5e5',
  border: '1px solid #303030',
  borderRadius: 4,
  padding: '8px 10px',
  fontFamily: 'inherit',
  fontSize: 13,
  marginBottom: 8,
};
const button: CSSProperties = {
  background: '#1c1c1c',
  color: '#e5e5e5',
  border: '1px solid #3a3a3a',
  borderRadius: 4,
  padding: '7px 14px',
  fontFamily: 'inherit',
  fontSize: 12,
  cursor: 'pointer',
};

type Agent = { id: string; name: string };

function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  async function send(payload: Record<string, string>): Promise<boolean> {
    setBusy(true);
    setNote('');
    try {
      const res = await fetch('/api/paperclip', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { ok?: boolean; detail?: string };
      if (res.ok && data.ok) {
        setNote('done');
        router.refresh();
        return true;
      }
      setNote(data.detail ?? `failed (HTTP ${res.status})`);
      return false;
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'request failed');
      return false;
    } finally {
      setBusy(false);
    }
  }

  return { busy, note, send };
}

export function NewTask({ agents }: { agents: Agent[] }) {
  const { busy, note, send } = useAction();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assigneeAgentId, setAssignee] = useState(agents[0]?.id ?? '');

  return (
    <div>
      <input
        style={input}
        placeholder="What needs doing?"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <textarea
        style={{ ...input, minHeight: 90, resize: 'vertical' }}
        placeholder="Detail. If it needs more than one person, say so and ask for it to be decomposed."
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <select
          style={{ ...input, width: 'auto', marginBottom: 0 }}
          value={assigneeAgentId}
          onChange={(e) => setAssignee(e.target.value)}
        >
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <button
          style={{ ...button, opacity: busy || !title.trim() ? 0.5 : 1 }}
          disabled={busy || !title.trim()}
          onClick={async () => {
            const ok = await send({ action: 'create_issue', title, description, assigneeAgentId });
            if (ok) {
              setTitle('');
              setDescription('');
            }
          }}
        >
          {busy ? 'creating…' : 'Create task'}
        </button>
        {note && <span style={{ color: note === 'done' ? '#22c55e' : '#f87171', fontSize: 12 }}>{note}</span>}
      </div>
      <div style={{ color: '#525252', fontSize: 11, marginTop: 8 }}>
        Creating a task does not start it. Wake the assignee below when you want it run.
      </div>
    </div>
  );
}

export function WakeButton({ agentId, name }: { agentId: string; name: string }) {
  const { busy, note, send } = useAction();
  return (
    <span style={{ whiteSpace: 'nowrap' }}>
      <button
        style={{ ...button, padding: '3px 9px', fontSize: 11, opacity: busy ? 0.5 : 1 }}
        disabled={busy}
        onClick={() => send({ action: 'wake', agentId })}
        title={`Queue a heartbeat for ${name}. This spends subscription quota.`}
      >
        {busy ? '…' : 'wake'}
      </button>
      {note && (
        <span style={{ color: note === 'done' ? '#22c55e' : '#f87171', fontSize: 11, marginLeft: 6 }}>
          {note === 'done' ? 'queued' : note}
        </span>
      )}
    </span>
  );
}

export function CommentBox({ issueId }: { issueId: string }) {
  const { busy, note, send } = useAction();
  const [body, setBody] = useState('');
  return (
    <div style={{ marginTop: 8 }}>
      <textarea
        style={{ ...input, minHeight: 56, resize: 'vertical' }}
        placeholder="Reply on this issue…"
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      <button
        style={{ ...button, opacity: busy || !body.trim() ? 0.5 : 1 }}
        disabled={busy || !body.trim()}
        onClick={async () => {
          const ok = await send({ action: 'comment', issueId, body });
          if (ok) setBody('');
        }}
      >
        {busy ? 'sending…' : 'Comment'}
      </button>
      {note && (
        <span style={{ color: note === 'done' ? '#22c55e' : '#f87171', fontSize: 12, marginLeft: 8 }}>
          {note}
        </span>
      )}
    </div>
  );
}
