/**
 * Paperclip connector — the AI workforce control plane running locally.
 *
 * Reports whether the Paperclip API is reachable and, when it is, how many
 * agents the scoped company has. Status stays honest: an unreachable Paperclip
 * is `not_configured`, never a fake "connected".
 */
import type { ConnectorStatus } from '@/lib/connectors/types';

const BASE = () => (process.env.PAPERCLIP_BASE_URL ?? 'http://127.0.0.1:3100').replace(/\/$/, '');

async function tryJson(url: string, timeoutMs = 2500): Promise<unknown | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function paperclipStatus(): Promise<ConnectorStatus> {
  const base = { id: 'paperclip', name: 'Paperclip', kind: 'orchestration' } as const;
  const root = BASE();

  let reachable = false;
  try {
    const res = await fetch(root, { signal: AbortSignal.timeout(2500) });
    reachable = res.status > 0;
  } catch {
    reachable = false;
  }

  if (!reachable) {
    return {
      ...base,
      state: 'not_configured',
      detail: `No Paperclip at ${root}. Set PAPERCLIP_BASE_URL in .env.local, or start Paperclip.`,
    };
  }

  // Agent count is a nice-to-have: the endpoint requires auth in some
  // configurations, and an unauthenticated 401 should not turn the tile red.
  const agents = (await tryJson(`${root}/api/agents`)) as unknown;
  const count = Array.isArray(agents)
    ? agents.length
    : Array.isArray((agents as { data?: unknown[] } | null)?.data)
      ? (agents as { data: unknown[] }).data.length
      : null;

  return {
    ...base,
    state: 'connected',
    detail: count === null ? `reachable at ${root}` : `${count} agent(s) at ${root}`,
    meta: count === null ? undefined : { agents: count },
  };
}
