/**
 * GET /api/paperclip — live company, roster and work from Paperclip.
 * POST /api/paperclip — the write half, behind an `action` discriminator.
 *
 * force-dynamic matters: without it Next prerenders this at build time, which
 * means `npm run build` would try to reach Paperclip and fail the build on any
 * machine where it is not yet running.
 */
import { NextResponse } from 'next/server';
import {
  addComment,
  createIssue,
  getPaperclipSnapshot,
  setIssueStatus,
  wakeAgent,
} from '@/lib/paperclip-live';

export const dynamic = 'force-dynamic';

export async function GET() {
  const snap = await getPaperclipSnapshot();
  const byStatus: Record<string, number> = {};
  for (const issue of snap.issues) {
    const key = issue.status ?? 'unknown';
    byStatus[key] = (byStatus[key] ?? 0) + 1;
  }
  // Always 200, never 50x. An unreachable Paperclip is a state this endpoint
  // reports — `ok: false` with the failed calls in `errors` — not a server
  // error. A 503 here is indistinguishable from the dashboard itself being
  // broken, which sends the reader debugging the wrong box.
  return NextResponse.json({
    ...snap,
    counts: {
      agents: snap.agents.length,
      issues: snap.issues.length,
      byStatus,
    },
  });
}

function field(payload: Record<string, unknown>, name: string): string {
  const value = payload[name];
  return typeof value === 'string' ? value : '';
}

export async function POST(request: Request) {
  let payload: Record<string, unknown>;
  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, detail: 'body must be JSON' }, { status: 400 });
  }

  const action = field(payload, 'action');
  let result;
  switch (action) {
    case 'create_issue':
      result = await createIssue({
        title: field(payload, 'title'),
        description: field(payload, 'description'),
        assigneeAgentId: field(payload, 'assigneeAgentId'),
      });
      break;
    case 'comment':
      result = await addComment(field(payload, 'issueId'), field(payload, 'body'));
      break;
    case 'set_status':
      result = await setIssueStatus(field(payload, 'issueId'), field(payload, 'status'));
      break;
    case 'wake':
      result = await wakeAgent(field(payload, 'agentId'));
      break;
    default:
      return NextResponse.json(
        { ok: false, detail: `unknown action "${action}"` },
        { status: 400 },
      );
  }

  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
