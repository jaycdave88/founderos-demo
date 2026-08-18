import { createHash } from 'node:crypto';
import type { Client } from '@notionhq/client';
import type { PaperclipSnapshot } from '@/lib/paperclip-live';

export type NotionDraftClient = Pick<Client, 'databases' | 'dataSources' | 'pages'>;

export type NotionDraftCandidate = {
  companyId: string;
  companyName: string;
  issueId: string;
  issueIdentifier: string;
  issueTitle: string;
  paperclipKey: string;
  paperclipUrl: string;
  assignedEmployee: string;
  ownerMissing: boolean;
  sourceUpdated: string | null;
  revision: number;
  format: string;
  body: string;
  words: number;
  verifyMarkers: number;
  checksum: string;
};

export type NotionDraftSyncResult = {
  ok: boolean;
  candidates: number;
  created: number;
  updated: number;
  skipped: number;
  superseded: number;
  errors: string[];
};

const RICH_TEXT_LIMIT = 2_000;

function clip(value: string, limit = RICH_TEXT_LIMIT): string {
  return value.slice(0, limit);
}

function words(value: string): number {
  const normalized = value.trim();
  return normalized ? normalized.split(/\s+/u).length : 0;
}

function verifyMarkers(value: string): number {
  return value.match(/\[VERIFY:/giu)?.length ?? 0;
}

function checksum(parts: string[]): string {
  return createHash('sha256').update(parts.join('\u0000'), 'utf8').digest('hex');
}

/**
 * The machine-readable completion gate. Employees do not type a free-form
 * "send to Notion" tag: the canonical issue itself must be top-level,
 * `in_review`, and carry a non-empty document whose key is exactly `draft`.
 */
export function notionDraftCandidates(snapshot: PaperclipSnapshot): NotionDraftCandidate[] {
  const agents = new Map(snapshot.agents.map((agent) => [agent.id, agent.name]));
  return snapshot.issues.flatMap((issue) => {
    if (issue.status !== 'in_review' || issue.parentId) return [];
    const document = (snapshot.documents[issue.id] ?? []).find(
      (candidate) => candidate.key === 'draft' && candidate.body.trim().length > 0,
    );
    if (!document) return [];
    const assignedEmployee = issue.assigneeAgentId
      ? agents.get(issue.assigneeAgentId) ?? `UNKNOWN AGENT ${issue.assigneeAgentId}`
      : 'UNASSIGNED IN PAPERCLIP';
    const issueIdentifier = issue.identifier ?? issue.id;
    const issueTitle = issue.title?.trim() || document.title?.trim() || 'Untitled draft';
    const revision = document.latestRevisionNumber ?? 1;
    const paperclipKey = `${snapshot.companyId}:${issue.id}:draft`;
    return [
      {
        companyId: snapshot.companyId,
        companyName: snapshot.companyName ?? snapshot.companyId,
        issueId: issue.id,
        issueIdentifier,
        issueTitle,
        paperclipKey,
        paperclipUrl: `${snapshot.base}/api/issues/${encodeURIComponent(issue.id)}`,
        assignedEmployee,
        ownerMissing: !issue.assigneeAgentId,
        sourceUpdated: issue.updatedAt ?? null,
        revision,
        format: document.format,
        body: document.body,
        words: words(document.body),
        verifyMarkers: verifyMarkers(document.body),
        checksum: checksum([
          snapshot.companyId,
          issue.id,
          document.key,
          String(revision),
          document.body,
        ]),
      },
    ];
  });
}

export function notionDraftDatabaseSchema() {
  return {
    Name: { type: 'title' as const, title: {} },
    'Review Status': {
      type: 'select' as const,
      select: {
        options: [
          { name: 'Needs Review', color: 'yellow' as const },
          { name: 'Approved', color: 'green' as const },
          { name: 'Changes Requested', color: 'red' as const },
          { name: 'Superseded', color: 'gray' as const },
        ],
      },
    },
    Current: { type: 'checkbox' as const, checkbox: {} },
    Company: { type: 'select' as const, select: { options: [] } },
    'Paperclip Issue': { type: 'rich_text' as const, rich_text: {} },
    'Paperclip Key': { type: 'rich_text' as const, rich_text: {} },
    'Assigned Employee': { type: 'select' as const, select: { options: [] } },
    'Owner Missing': { type: 'checkbox' as const, checkbox: {} },
    'Source Status': {
      type: 'select' as const,
      select: { options: [{ name: 'in_review', color: 'yellow' as const }] },
    },
    'Source Updated': { type: 'date' as const, date: {} },
    'Synced At': { type: 'date' as const, date: {} },
    Words: { type: 'number' as const, number: { format: 'number' as const } },
    'VERIFY Markers': { type: 'number' as const, number: { format: 'number' as const } },
    Revision: { type: 'number' as const, number: { format: 'number' as const } },
    Checksum: { type: 'rich_text' as const, rich_text: {} },
    'Paperclip URL': { type: 'url' as const, url: {} },
  };
}

export function buildNotionDraftProperties(draft: NotionDraftCandidate, syncedAt: string) {
  const properties: NonNullable<Parameters<Client['pages']['create']>[0]['properties']> = {
    Name: {
      title: [{ type: 'text', text: { content: clip(`${draft.issueIdentifier} — ${draft.issueTitle}`) } }],
    },
    'Review Status': { select: { name: 'Needs Review' } },
    Current: { checkbox: true },
    Company: { select: { name: clip(draft.companyName, 100) } },
    'Paperclip Issue': {
      rich_text: [{ type: 'text', text: { content: clip(draft.issueIdentifier) } }],
    },
    'Paperclip Key': {
      rich_text: [{ type: 'text', text: { content: clip(draft.paperclipKey) } }],
    },
    'Assigned Employee': { select: { name: clip(draft.assignedEmployee, 100) } },
    'Owner Missing': { checkbox: draft.ownerMissing },
    'Source Status': { select: { name: 'in_review' } },
    'Source Updated': draft.sourceUpdated ? { date: { start: draft.sourceUpdated } } : { date: null },
    'Synced At': { date: { start: syncedAt } },
    Words: { number: draft.words },
    'VERIFY Markers': { number: draft.verifyMarkers },
    Revision: { number: draft.revision },
    Checksum: { rich_text: [{ type: 'text', text: { content: draft.checksum } }] },
    'Paperclip URL': { url: draft.paperclipUrl },
  };
  return properties;
}

export function buildNotionDraftMarkdown(draft: NotionDraftCandidate): string {
  const ownerLine = draft.ownerMissing
    ? '**Assigned employee:** UNASSIGNED IN PAPERCLIP — fix ownership on the source issue.'
    : `**Assigned employee:** ${draft.assignedEmployee}`;
  return [
    '> [!IMPORTANT]',
    '> Synced one-way for human review. Paperclip remains the source of truth; edits here do not change the agent task and nothing is published automatically.',
    '',
    `**Company:** ${draft.companyName}`,
    `**Paperclip issue:** ${draft.issueIdentifier} — ${draft.issueTitle}`,
    ownerLine,
    `**Source status:** in_review · **Revision:** ${draft.revision} · **VERIFY markers:** ${draft.verifyMarkers}`,
    `**Source link:** ${draft.paperclipUrl}`,
    '',
    '---',
    '',
    draft.body,
  ].join('\n');
}

export async function setupNotionDraftDatabase(
  notion: NotionDraftClient,
  parentPageId: string,
): Promise<{ databaseId: string; dataSourceId: string; url: string }> {
  const created = await notion.databases.create({
    parent: { type: 'page_id', page_id: parentPageId },
    title: [{ type: 'text', text: { content: 'AI Company Drafts' } }],
    description: [
      {
        type: 'text',
        text: {
          content:
            'One-way review library for canonical Paperclip drafts. Paperclip owns work; Notion preserves readable review history.',
        },
      },
    ],
    is_inline: false,
    icon: { type: 'emoji', emoji: '📝' },
    initial_data_source: { properties: notionDraftDatabaseSchema() },
  });
  if (!('data_sources' in created) || created.data_sources.length === 0 || !('url' in created)) {
    throw new Error('Notion created only a partial database response; no data source id was returned');
  }
  return { databaseId: created.id, dataSourceId: created.data_sources[0].id, url: created.url };
}

function richTextValue(property: unknown): string {
  if (!property || typeof property !== 'object') return '';
  const richText = (property as { rich_text?: Array<{ plain_text?: string }> }).rich_text;
  return Array.isArray(richText) ? richText.map((part) => part.plain_text ?? '').join('') : '';
}

function checkboxValue(property: unknown): boolean {
  return Boolean((property as { checkbox?: boolean } | null)?.checkbox);
}

function selectValue(property: unknown): string {
  return (property as { select?: { name?: string } | null } | null)?.select?.name ?? '';
}

function fullPage(value: unknown): boolean {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'id' in value &&
      typeof (value as { id?: unknown }).id === 'string' &&
      'properties' in value &&
      (value as { properties?: unknown }).properties &&
      typeof (value as { properties?: unknown }).properties === 'object',
  );
}

async function pagesForKey(notion: NotionDraftClient, dataSourceId: string, key: string) {
  const pages: Array<{ id: string; properties: Record<string, unknown> }> = [];
  let startCursor: string | undefined;
  do {
    const response = await notion.dataSources.query({
      data_source_id: dataSourceId,
      filter: { property: 'Paperclip Key', rich_text: { equals: key } },
      page_size: 100,
      start_cursor: startCursor,
    });
    for (const page of response.results) {
      if (!fullPage(page)) continue;
      const complete = page as unknown as { id: string; properties: Record<string, unknown> };
      pages.push({ id: complete.id, properties: complete.properties });
    }
    startCursor = response.has_more && response.next_cursor ? response.next_cursor : undefined;
  } while (startCursor);
  return pages;
}

async function validateSchema(notion: NotionDraftClient, dataSourceId: string): Promise<string[]> {
  const source = await notion.dataSources.retrieve({ data_source_id: dataSourceId });
  const actual = 'properties' in source ? source.properties : {};
  const expected = notionDraftDatabaseSchema();
  return Object.entries(expected).flatMap(([name, config]) => {
    const property = actual[name] as { type?: string } | undefined;
    return property?.type === config.type ? [] : [`${name} (${config.type})`];
  });
}

export async function syncNotionDrafts(
  notion: NotionDraftClient,
  dataSourceId: string,
  drafts: NotionDraftCandidate[],
  syncedAt = new Date().toISOString(),
): Promise<NotionDraftSyncResult> {
  const result: NotionDraftSyncResult = {
    ok: true,
    candidates: drafts.length,
    created: 0,
    updated: 0,
    skipped: 0,
    superseded: 0,
    errors: [],
  };
  try {
    const missing = await validateSchema(notion, dataSourceId);
    if (missing.length > 0) {
      throw new Error(`Notion data source is missing required properties: ${missing.join(', ')}`);
    }
  } catch (error) {
    result.ok = false;
    result.errors.push(error instanceof Error ? error.message : String(error));
    return result;
  }

  for (const draft of drafts) {
    try {
      const existing = await pagesForKey(notion, dataSourceId, draft.paperclipKey);
      const same = existing.find(
        (page) =>
          richTextValue(page.properties.Checksum) === draft.checksum &&
          checkboxValue(page.properties.Current),
      );
      if (same) {
        const assignedEmployee = selectValue(same.properties['Assigned Employee']);
        const ownerMissing = checkboxValue(same.properties['Owner Missing']);
        if (
          assignedEmployee !== draft.assignedEmployee ||
          ownerMissing !== draft.ownerMissing
        ) {
          // Ownership is source metadata, not a content revision. Refresh only
          // those fields and the sync time, preserving the human's Review
          // Status, page body, comments, and immutable checksum.
          await notion.pages.update({
            page_id: same.id,
            properties: {
              'Assigned Employee': { select: { name: clip(draft.assignedEmployee, 100) } },
              'Owner Missing': { checkbox: draft.ownerMissing },
              'Synced At': { date: { start: syncedAt } },
            },
          });
          result.updated += 1;
        } else {
          result.skipped += 1;
        }
        continue;
      }

      // Create first. If Notion rejects the new body, the previous revision
      // remains current and readable instead of leaving the review queue empty.
      await notion.pages.create({
        parent: { type: 'data_source_id', data_source_id: dataSourceId },
        properties: buildNotionDraftProperties(draft, syncedAt),
        icon: { type: 'emoji', emoji: '📝' },
        markdown: buildNotionDraftMarkdown(draft),
      });
      result.created += 1;

      for (const page of existing.filter((candidate) => checkboxValue(candidate.properties.Current))) {
        await notion.pages.update({
          page_id: page.id,
          properties: {
            Current: { checkbox: false },
            'Review Status': { select: { name: 'Superseded' } },
          },
        });
        result.superseded += 1;
      }
    } catch (error) {
      result.ok = false;
      result.errors.push(
        `${draft.issueIdentifier}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return result;
}
