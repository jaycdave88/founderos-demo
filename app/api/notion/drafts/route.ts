import { timingSafeEqual } from 'node:crypto';
import { Client } from '@notionhq/client';
import { NextResponse } from 'next/server';
import { runtimeEnv } from '@/lib/creds';
import {
  notionDraftCandidates,
  notionDraftGroupingCandidates,
  setupNotionDraftDatabase,
  syncNotionDrafts,
  ungroupedNotionDraftKeys,
  type NotionDraftCandidate,
  type NotionDraftClient,
  type NotionDraftGroupingCandidate,
} from '@/lib/notion-drafts';
import { getPaperclipSnapshot } from '@/lib/paperclip-live';

export const dynamic = 'force-dynamic';

let syncRunning = false;

function companyIds(env: Record<string, string | undefined>): string[] {
  const ids = (env.NOTION_DRAFT_COMPANY_IDS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => /^[A-Za-z0-9_-]{1,128}$/.test(value));
  return [...new Set(ids)].slice(0, 20);
}

function authorized(request: Request, expected: string | undefined): boolean {
  if (!expected) return false;
  const header = request.headers.get('authorization') ?? '';
  const supplied = header.startsWith('Bearer ') ? header.slice(7) : '';
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function notionClient(env: Record<string, string | undefined>): NotionDraftClient | null {
  return env.NOTION_API_KEY ? new Client({ auth: env.NOTION_API_KEY }) : null;
}

function parsePaperclipDraftKey(value: string): { companyId: string; issueId: string } | null {
  const match = /^([A-Za-z0-9_-]{1,128}):([A-Za-z0-9_-]{1,128}):draft$/.exec(value);
  return match ? { companyId: match[1], issueId: match[2] } : null;
}

export async function GET() {
  const env = runtimeEnv();
  const configured = Boolean(
    env.NOTION_API_KEY && env.NOTION_DRAFT_DATABASE_ID && env.NOTION_DRAFT_DATA_SOURCE_ID,
  );
  return NextResponse.json({
    ok: configured,
    enabled: env.NOTION_DRAFT_SYNC_ENABLED === '1',
    configured,
    running: syncRunning,
    companyIds: companyIds(env),
    databaseUrl: env.NOTION_DRAFT_DATABASE_URL || null,
    detail: configured
      ? 'One-way Paperclip draft review export is configured.'
      : 'Connect Notion, set a shared parent page, then run the setup command.',
  });
}

export async function POST(request: Request) {
  const env = runtimeEnv();
  if (!env.NOTION_DRAFT_SYNC_TOKEN) {
    return NextResponse.json(
      { ok: false, detail: 'NOTION_DRAFT_SYNC_TOKEN is not configured' },
      { status: 503 },
    );
  }
  if (!authorized(request, env.NOTION_DRAFT_SYNC_TOKEN)) {
    return NextResponse.json({ ok: false, detail: 'unauthorized' }, { status: 401 });
  }
  const notion = notionClient(env);
  if (!notion) {
    return NextResponse.json(
      { ok: false, detail: 'NOTION_API_KEY is not configured in FounderOS' },
      { status: 503 },
    );
  }

  let action = '';
  try {
    const body = (await request.json()) as { action?: unknown };
    action = typeof body.action === 'string' ? body.action : '';
  } catch {
    return NextResponse.json({ ok: false, detail: 'body must be JSON' }, { status: 400 });
  }

  if (action === 'setup') {
    if (env.NOTION_DRAFT_DATABASE_ID && env.NOTION_DRAFT_DATA_SOURCE_ID) {
      return NextResponse.json({
        ok: true,
        existing: true,
        databaseId: env.NOTION_DRAFT_DATABASE_ID,
        dataSourceId: env.NOTION_DRAFT_DATA_SOURCE_ID,
        url: env.NOTION_DRAFT_DATABASE_URL ?? '',
      });
    }
    const parentPageId = env.NOTION_DRAFT_PARENT_PAGE_ID?.trim();
    if (!parentPageId) {
      return NextResponse.json(
        { ok: false, detail: 'NOTION_DRAFT_PARENT_PAGE_ID is not configured' },
        { status: 409 },
      );
    }
    try {
      const created = await setupNotionDraftDatabase(notion, parentPageId);
      return NextResponse.json({ ok: true, existing: false, ...created });
    } catch (error) {
      return NextResponse.json(
        { ok: false, detail: error instanceof Error ? error.message : String(error) },
        { status: 502 },
      );
    }
  }

  if (action !== 'sync') {
    return NextResponse.json({ ok: false, detail: `unknown action "${action}"` }, { status: 400 });
  }
  if (env.NOTION_DRAFT_SYNC_ENABLED !== '1') {
    return NextResponse.json(
      { ok: false, detail: 'NOTION_DRAFT_SYNC_ENABLED is not 1; export remains off' },
      { status: 409 },
    );
  }
  const dataSourceId = env.NOTION_DRAFT_DATA_SOURCE_ID?.trim();
  const allowedCompanies = companyIds(env);
  if (!dataSourceId || allowedCompanies.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        detail: 'NOTION_DRAFT_DATA_SOURCE_ID and an explicit NOTION_DRAFT_COMPANY_IDS allowlist are required',
      },
      { status: 409 },
    );
  }
  if (syncRunning) {
    return NextResponse.json(
      { ok: false, detail: 'a Notion draft sync is already running' },
      { status: 409 },
    );
  }

  syncRunning = true;
  try {
    const drafts: NotionDraftCandidate[] = [];
    const groupingDrafts: NotionDraftGroupingCandidate[] = [];
    const sourceErrors: string[] = [];
    const companies: Array<{
      companyId: string;
      companyName: string | null;
      candidates: number;
      groupingCandidates: number;
    }> = [];
    let ungroupedKeys: string[];
    try {
      ungroupedKeys = await ungroupedNotionDraftKeys(notion, dataSourceId);
    } catch (error) {
      return NextResponse.json(
        {
          ok: false,
          detail: `Could not discover legacy Notion rows: ${error instanceof Error ? error.message : String(error)}`,
        },
        { status: 502 },
      );
    }
    for (const companyId of allowedCompanies) {
      const groupingKeys = ungroupedKeys.filter(
        (key) => parsePaperclipDraftKey(key)?.companyId === companyId,
      );
      const additionalDocumentIssueIds = groupingKeys.flatMap((key) => {
        const parsed = parsePaperclipDraftKey(key);
        return parsed ? [parsed.issueId] : [];
      });
      const snapshot = await getPaperclipSnapshot(companyId, {
        // Keep approved rows current after the founder closes Paperclip. A
        // `done` issue may update an existing review page to Ready to Post;
        // cancelled and in-flight work remain excluded.
        documentStatuses: ['in_review', 'done'],
        additionalDocumentIssueIds,
        prioritizeDocumentStatuses: ['in_review'],
        topLevelOnly: true,
        documentLimit: 200,
        hydrateDocumentIssues: true,
      });
      if (!snapshot.ok) {
        sourceErrors.push(
          `${companyId}: ${snapshot.errors.join('; ') || 'Paperclip snapshot was incomplete'}`,
        );
        continue;
      }
      const selected = notionDraftCandidates(snapshot, { mediaRoot: env.MEDIA_ROOT });
      const selectedGrouping = notionDraftGroupingCandidates(snapshot, groupingKeys);
      drafts.push(...selected);
      groupingDrafts.push(...selectedGrouping);
      companies.push({
        companyId,
        companyName: snapshot.companyName,
        candidates: selected.length,
        groupingCandidates: selectedGrouping.length,
      });
    }
    const result = await syncNotionDrafts(
      notion,
      dataSourceId,
      drafts,
      undefined,
      [...drafts, ...groupingDrafts],
    );
    result.errors.unshift(...sourceErrors);
    result.ok = result.ok && sourceErrors.length === 0;
    return NextResponse.json(
      { ...result, companies },
      { status: result.ok ? 200 : 502 },
    );
  } finally {
    syncRunning = false;
  }
}
