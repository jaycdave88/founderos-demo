import { NextResponse } from 'next/server';
import { getDb } from '@/lib/data';
import { syncFromZernioLive } from '@/lib/social-live';
import { zernioLiveAccounts } from '@/lib/connectors/zernio';
import { socialControls } from '@/lib/social-mode';

export const dynamic = 'force-dynamic';

/** Force a live follower-count sync from Zernio/Late and report what landed.
    GET and POST both work so it's trivial to trigger from a browser or curl. */
async function runSync() {
  if (socialControls(process.env).mode === 'preview') {
    return NextResponse.json({ ok: true, recorded: 0, source: 'demo-preview', accounts: {} });
  }
  const db = getDb();
  const accounts = await zernioLiveAccounts();
  const recorded = await syncFromZernioLive(db, { source: async () => accounts });
  return NextResponse.json({
    ok: true,
    recorded,
    syncedAt: new Date().toISOString(),
    source: Object.keys(accounts).length > 0 ? 'zernio-live' : 'config-fallback',
    accounts,
  });
}

export async function POST() {
  return runSync();
}

export async function GET() {
  return runSync();
}
