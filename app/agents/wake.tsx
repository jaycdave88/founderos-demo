'use client';

/**
 * Wake one agent.
 *
 * Enqueues a heartbeat rather than running one inline: an agent takes minutes,
 * and Paperclip already owns the queue. The confirm is not ceremony — every
 * wake spends subscription quota, and heartbeats are off precisely so that
 * spending is deliberate.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Play } from 'lucide-react';

export function WakeButton({ agentId, name }: { agentId: string; name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  const wake = async () => {
    setBusy(true);
    setNote('');
    try {
      const res = await fetch('/api/paperclip', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'wake', agentId }),
      });
      const data = (await res.json()) as { ok?: boolean; detail?: string };
      if (res.ok && data.ok) {
        setNote('queued');
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

  return (
    <span className="inline-flex items-center gap-2">
      <button
        onClick={() => void wake()}
        disabled={busy}
        title={`Queue a heartbeat for ${name}. This spends subscription quota.`}
        className="inline-flex items-center gap-1.5 rounded-md-t border border-os-border bg-os-surface2 px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest text-os-muted transition-colors hover:border-os-accent hover:text-os-accent disabled:opacity-40"
      >
        <Play className="h-3 w-3" strokeWidth={2} />
        {busy ? '…' : 'wake'}
      </button>
      {note && (
        <span className={`font-mono text-[10px] ${note === 'queued' ? 'text-os-ok' : 'text-os-err'}`}>
          {note}
        </span>
      )}
    </span>
  );
}
