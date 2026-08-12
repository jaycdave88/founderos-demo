/**
 * CRM connector — the local customer/company/deal system of record.
 *
 * CRM_BASE_URL points at the CRM *API* (default :3001), not its UI (:3000).
 * The API is probed on a few well-known health paths, falling back to the root,
 * because the exact path differs between CRM builds.
 */
import type { ConnectorStatus } from '@/lib/connectors/types';

const BASE = () => (process.env.CRM_BASE_URL ?? 'http://127.0.0.1:3001').replace(/\/$/, '');
const HEALTH_PATHS = ['/health', '/api/health', '/healthz', ''];

export async function crmStatus(): Promise<ConnectorStatus> {
  const base = { id: 'crm', name: 'CRM', kind: 'crm' } as const;
  const root = BASE();

  for (const path of HEALTH_PATHS) {
    try {
      const res = await fetch(`${root}${path}`, { signal: AbortSignal.timeout(2500) });
      // Any HTTP answer proves the API is listening. A 401/404 still means the
      // service is up, which is what this tile is reporting on.
      if (res.status > 0) {
        return {
          ...base,
          state: 'connected',
          detail: `API reachable at ${root}${path || '/'} (HTTP ${res.status})`,
          meta: { endpoint: `${root}${path || '/'}` },
        };
      }
    } catch {
      /* try the next path */
    }
  }

  return {
    ...base,
    state: 'not_configured',
    detail: `No CRM API at ${root}. Start it with: cd ~/AI/apps/crm && docker compose up -d && bun run dev`,
  };
}
