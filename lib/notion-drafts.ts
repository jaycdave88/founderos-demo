import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { basename, extname, resolve, sep } from 'node:path';
import type { Client } from '@notionhq/client';
import { isFounderReviewIssue, type PaperclipSnapshot } from '@/lib/paperclip-live';

export type NotionDraftClient = Pick<Client, 'databases' | 'dataSources' | 'pages' | 'fileUploads'>;

type SourceVerification = 'Verified' | 'Needs Verification' | 'Missing QA';
type ImageStatus =
  | 'Attached'
  | 'Needs Generation'
  | 'Not Required'
  | 'Missing Decision'
  | 'Invalid Receipt';
type PostReadiness =
  | 'Needs Source Verification'
  | 'Needs Images'
  | 'Awaiting Founder Approval'
  | 'Ready to Post';

export type NotionDraftAsset = {
  assetId: string;
  placement: 'hero' | 'inline';
  alt: string;
  path: string;
  sha256: string;
  contentType: 'image/png' | 'image/jpeg' | 'image/webp';
};

export type NotionDraftCandidate = {
  companyId: string;
  companyName: string;
  issueId: string;
  issueIdentifier: string;
  issueTitle: string;
  blogTitle: string;
  paperclipKey: string;
  paperclipUrl: string;
  assignedEmployee: string;
  ownerMissing: boolean;
  sourceStatus: 'in_review' | 'done';
  createdAt: string | null;
  sourceUpdated: string | null;
  revision: number;
  format: string;
  body: string;
  words: number;
  verifyMarkers: number;
  sourceVerification: SourceVerification;
  verifiedSourceCount: number;
  heroRequired: boolean | null;
  imageStatus: ImageStatus;
  assets: NotionDraftAsset[];
  postReadiness: PostReadiness;
  readinessNotes: string;
  mediaChecksum: string;
  metadataChecksum: string;
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
const NOTION_DIRECT_UPLOAD_LIMIT = 20 * 1024 * 1024;

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

function cleanTitle(value: string): string {
  return value
    .trim()
    .replace(/^#+\s*/u, '')
    .replace(/^\*+|\*+$/gu, '')
    .replace(/^["'“”‘’]+|["'“”‘’]+$/gu, '')
    .trim();
}

function blogTitle(body: string, documentTitle: string | null, issueTitle: string): string {
  const labelled = body.match(
    /^\s*(?:[-*]\s*)?(?:\*\*)?(?:final|selected|recommended|primary)\s+title(?:\*\*)?\s*:\s*(.+?)\s*$/imu,
  )?.[1];
  if (labelled && cleanTitle(labelled)) return cleanTitle(labelled);

  const finalArticle = body.match(/^##\s+Final article\s*$([\s\S]*)/imu)?.[1] ?? '';
  const articleHeading = finalArticle.match(/^#\s+(.+?)\s*$/mu)?.[1];
  if (articleHeading && cleanTitle(articleHeading)) return cleanTitle(articleHeading);
  if (documentTitle?.trim()) return cleanTitle(documentTitle);
  return cleanTitle(issueTitle) || 'Untitled draft';
}

function jsonObject(body: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(body) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function sourceEvidence(body: string, qaBody: string | undefined, markerCount: number) {
  const urls = new Set(body.match(/https?:\/\/[^\s)>\]}]+/giu) ?? []);
  const hasLedger = /^#{2,4}\s+(?:full\s+)?(?:claim-level\s+)?(?:source ledger|sources|references)\s*$/imu.test(
    body,
  );
  const qa = qaBody ? jsonObject(qaBody) : null;
  const verifiedSourceCount =
    typeof qa?.verifiedSourceCount === 'number' &&
    Number.isInteger(qa.verifiedSourceCount) &&
    qa.verifiedSourceCount > 0
      ? qa.verifiedSourceCount
      : 0;
  const qaValid = Boolean(
    qa?.schemaVersion === 1 &&
      qa?.kind === 'momo-blog-qa' &&
      qa?.sourceVerification === 'passed' &&
      verifiedSourceCount <= urls.size &&
      typeof qa?.reviewedBy === 'string' &&
      qa.reviewedBy.trim() &&
      typeof qa?.reviewedAt === 'string' &&
      /^\d{4}-\d{2}-\d{2}T/.test(qa.reviewedAt) &&
      hasLedger,
  );
  const sourceVerification: SourceVerification =
    markerCount > 0 ? 'Needs Verification' : qaValid ? 'Verified' : 'Missing QA';
  return {
    sourceVerification,
    verifiedSourceCount: sourceVerification === 'Verified' ? verifiedSourceCount : 0,
  };
}

function pathInside(root: string, candidate: string): boolean {
  const normalizedRoot = resolve(root);
  const normalizedCandidate = resolve(candidate);
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}${sep}`);
}

function mediaEvidence(
  body: string | undefined,
  companyId: string,
  issueId: string,
  mediaRoot: string | undefined,
): { heroRequired: boolean | null; imageStatus: ImageStatus; assets: NotionDraftAsset[] } {
  if (!body) return { heroRequired: null, imageStatus: 'Missing Decision', assets: [] };
  const receipt = jsonObject(body);
  const hero = receipt?.hero;
  const heroRequired =
    hero && typeof hero === 'object' && typeof (hero as { required?: unknown }).required === 'boolean'
      ? (hero as { required: boolean }).required
      : null;
  if (
    receipt?.schemaVersion !== 1 ||
    receipt?.kind !== 'momo-blog-media' ||
    receipt?.companyId !== companyId ||
    receipt?.issueId !== issueId ||
    heroRequired === null ||
    !Array.isArray(receipt.assets)
  ) {
    return { heroRequired, imageStatus: 'Invalid Receipt', assets: [] };
  }
  if (!heroRequired && receipt.assets.length === 0) {
    return { heroRequired: false, imageStatus: 'Not Required', assets: [] };
  }
  if (heroRequired && receipt.assets.length === 0) {
    return { heroRequired: true, imageStatus: 'Needs Generation', assets: [] };
  }
  if (!mediaRoot) return { heroRequired, imageStatus: 'Invalid Receipt', assets: [] };

  const assets: NotionDraftAsset[] = [];
  for (const raw of receipt.assets) {
    if (!raw || typeof raw !== 'object') {
      return { heroRequired, imageStatus: 'Invalid Receipt', assets: [] };
    }
    const asset = raw as Record<string, unknown>;
    const placement = asset.placement;
    const contentType = asset.contentType;
    if (
      typeof asset.assetId !== 'string' ||
      (placement !== 'hero' && placement !== 'inline') ||
      typeof asset.alt !== 'string' ||
      asset.alt.trim().length < 8 ||
      typeof asset.path !== 'string' ||
      !pathInside(mediaRoot, asset.path) ||
      typeof asset.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(asset.sha256) ||
      (contentType !== 'image/png' && contentType !== 'image/jpeg' && contentType !== 'image/webp') ||
      asset.rightsBasis !== 'generated-original' ||
      asset.synthetic !== true
    ) {
      return { heroRequired, imageStatus: 'Invalid Receipt', assets: [] };
    }
    try {
      const info = statSync(asset.path);
      if (!info.isFile() || info.size <= 0 || info.size > NOTION_DIRECT_UPLOAD_LIMIT) {
        return { heroRequired, imageStatus: 'Invalid Receipt', assets: [] };
      }
      const actual = createHash('sha256').update(readFileSync(asset.path)).digest('hex');
      if (actual !== asset.sha256) {
        return { heroRequired, imageStatus: 'Invalid Receipt', assets: [] };
      }
    } catch {
      return { heroRequired, imageStatus: 'Invalid Receipt', assets: [] };
    }
    assets.push({
      assetId: asset.assetId,
      placement,
      alt: asset.alt.trim(),
      path: asset.path,
      sha256: asset.sha256,
      contentType,
    });
  }
  if (heroRequired && !assets.some((asset) => asset.placement === 'hero')) {
    return { heroRequired, imageStatus: 'Needs Generation', assets: [] };
  }
  return { heroRequired, imageStatus: 'Attached', assets };
}

function readiness(
  sourceStatus: 'in_review' | 'done',
  sourceVerification: SourceVerification,
  imageStatus: ImageStatus,
): { postReadiness: PostReadiness; readinessNotes: string } {
  if (sourceVerification !== 'Verified') {
    return {
      postReadiness: 'Needs Source Verification',
      readinessNotes:
        sourceVerification === 'Needs Verification'
          ? 'Resolve every VERIFY marker and replace the QA receipt.'
          : 'Add a valid structured editorial QA receipt backed by the source ledger.',
    };
  }
  if (imageStatus !== 'Attached' && imageStatus !== 'Not Required') {
    return {
      postReadiness: 'Needs Images',
      readinessNotes:
        imageStatus === 'Missing Decision'
          ? 'Record whether a hero image is required.'
          : imageStatus === 'Needs Generation'
            ? 'Generate the required original local image package.'
            : 'Repair the local media receipt or checksum.',
    };
  }
  if (sourceStatus !== 'done') {
    return {
      postReadiness: 'Awaiting Founder Approval',
      readinessNotes: 'Sources and media are complete; Paperclip still requires founder approval.',
    };
  }
  return {
    postReadiness: 'Ready to Post',
    readinessNotes: 'Paperclip approval, source verification, and the declared media gate are complete.',
  };
}

/**
 * The machine-readable completion gate. Employees do not type a free-form
 * "send to Notion" tag: the canonical issue itself must be top-level,
 * `in_review`, and carry a non-empty document whose key is exactly `draft`.
 */
export function notionDraftCandidates(
  snapshot: PaperclipSnapshot,
  options: { mediaRoot?: string } = {},
): NotionDraftCandidate[] {
  const agents = new Map(snapshot.agents.map((agent) => [agent.id, agent.name]));
  return snapshot.issues.flatMap((issue) => {
    const sourceStatus = issue.status === 'done' ? 'done' : issue.status === 'in_review' ? 'in_review' : null;
    if (!sourceStatus || (sourceStatus === 'in_review' && !isFounderReviewIssue(issue)) || issue.parentId) {
      return [];
    }
    const documents = snapshot.documents[issue.id] ?? [];
    const document = documents.find(
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
    const markerCount = verifyMarkers(document.body);
    const source = sourceEvidence(
      document.body,
      documents.find((candidate) => candidate.key === 'qa')?.body,
      markerCount,
    );
    const media = mediaEvidence(
      documents.find((candidate) => candidate.key === 'media')?.body,
      snapshot.companyId,
      issue.id,
      options.mediaRoot,
    );
    const ready = readiness(sourceStatus, source.sourceVerification, media.imageStatus);
    const contentChecksum = checksum([
      snapshot.companyId,
      issue.id,
      document.key,
      String(revision),
      document.body,
    ]);
    const mediaChecksum = checksum(media.assets.map((asset) => `${asset.placement}:${asset.sha256}`));
    const title = blogTitle(document.body, document.title, issueTitle);
    const metadataChecksum = checksum([
      title,
      assignedEmployee,
      String(!issue.assigneeAgentId),
      sourceStatus,
      issue.createdAt ?? '',
      issue.updatedAt ?? '',
      source.sourceVerification,
      String(source.verifiedSourceCount),
      String(media.heroRequired),
      media.imageStatus,
      mediaChecksum,
      ready.postReadiness,
      ready.readinessNotes,
    ]);
    return [
      {
        companyId: snapshot.companyId,
        companyName: snapshot.companyName ?? snapshot.companyId,
        issueId: issue.id,
        issueIdentifier,
        issueTitle,
        blogTitle: title,
        paperclipKey,
        paperclipUrl: `${snapshot.base}/api/issues/${encodeURIComponent(issue.id)}`,
        assignedEmployee,
        ownerMissing: !issue.assigneeAgentId,
        sourceStatus,
        createdAt: issue.createdAt ?? null,
        sourceUpdated: issue.updatedAt ?? null,
        revision,
        format: document.format,
        body: document.body,
        words: words(document.body),
        verifyMarkers: markerCount,
        ...source,
        ...media,
        ...ready,
        mediaChecksum,
        metadataChecksum,
        checksum: contentChecksum,
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
      select: {
        options: [
          { name: 'in_review', color: 'yellow' as const },
          { name: 'done', color: 'green' as const },
        ],
      },
    },
    'Source Updated': { type: 'date' as const, date: {} },
    Created: { type: 'date' as const, date: {} },
    'Synced At': { type: 'date' as const, date: {} },
    Words: { type: 'number' as const, number: { format: 'number' as const } },
    'VERIFY Markers': { type: 'number' as const, number: { format: 'number' as const } },
    'Source Verification': {
      type: 'select' as const,
      select: {
        options: [
          { name: 'Verified', color: 'green' as const },
          { name: 'Needs Verification', color: 'red' as const },
          { name: 'Missing QA', color: 'yellow' as const },
        ],
      },
    },
    'Verified Sources': { type: 'number' as const, number: { format: 'number' as const } },
    'Post Readiness': {
      type: 'select' as const,
      select: {
        options: [
          { name: 'Needs Source Verification', color: 'red' as const },
          { name: 'Needs Images', color: 'orange' as const },
          { name: 'Awaiting Founder Approval', color: 'yellow' as const },
          { name: 'Ready to Post', color: 'green' as const },
        ],
      },
    },
    'Readiness Notes': { type: 'rich_text' as const, rich_text: {} },
    'Image Status': {
      type: 'select' as const,
      select: {
        options: [
          { name: 'Attached', color: 'green' as const },
          { name: 'Needs Generation', color: 'orange' as const },
          { name: 'Not Required', color: 'gray' as const },
          { name: 'Missing Decision', color: 'yellow' as const },
          { name: 'Invalid Receipt', color: 'red' as const },
        ],
      },
    },
    'Hero Required': { type: 'checkbox' as const, checkbox: {} },
    'Image Count': { type: 'number' as const, number: { format: 'number' as const } },
    'Hero Image': { type: 'files' as const, files: {} },
    'Other Images': { type: 'files' as const, files: {} },
    Revision: { type: 'number' as const, number: { format: 'number' as const } },
    Checksum: { type: 'rich_text' as const, rich_text: {} },
    'Media Checksum': { type: 'rich_text' as const, rich_text: {} },
    'Metadata Checksum': { type: 'rich_text' as const, rich_text: {} },
    'Paperclip URL': { type: 'url' as const, url: {} },
  };
}

type UploadedMedia = {
  hero: Array<{ name: string; type: 'file_upload'; file_upload: { id: string } }>;
  other: Array<{ name: string; type: 'file_upload'; file_upload: { id: string } }>;
};

export function buildNotionDraftProperties(
  draft: NotionDraftCandidate,
  syncedAt: string,
  uploaded: UploadedMedia = { hero: [], other: [] },
) {
  const properties: NonNullable<Parameters<Client['pages']['create']>[0]['properties']> = {
    Name: {
      title: [{ type: 'text', text: { content: clip(draft.blogTitle) } }],
    },
    'Review Status': { select: { name: draft.sourceStatus === 'done' ? 'Approved' : 'Needs Review' } },
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
    'Source Status': { select: { name: draft.sourceStatus } },
    Created: draft.createdAt ? { date: { start: draft.createdAt } } : { date: null },
    'Source Updated': draft.sourceUpdated ? { date: { start: draft.sourceUpdated } } : { date: null },
    'Synced At': { date: { start: syncedAt } },
    Words: { number: draft.words },
    'VERIFY Markers': { number: draft.verifyMarkers },
    'Source Verification': { select: { name: draft.sourceVerification } },
    'Verified Sources': { number: draft.verifiedSourceCount },
    'Post Readiness': { select: { name: draft.postReadiness } },
    'Readiness Notes': {
      rich_text: [{ type: 'text', text: { content: clip(draft.readinessNotes) } }],
    },
    'Image Status': { select: { name: draft.imageStatus } },
    'Hero Required': { checkbox: draft.heroRequired === true },
    'Image Count': { number: draft.assets.length },
    'Hero Image': { files: uploaded.hero },
    'Other Images': { files: uploaded.other },
    Revision: { number: draft.revision },
    Checksum: { rich_text: [{ type: 'text', text: { content: draft.checksum } }] },
    'Media Checksum': { rich_text: [{ type: 'text', text: { content: draft.mediaChecksum } }] },
    'Metadata Checksum': { rich_text: [{ type: 'text', text: { content: draft.metadataChecksum } }] },
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
    `# ${draft.blogTitle}`,
    '',
    `**Paperclip issue:** ${draft.issueIdentifier} — ${draft.issueTitle}`,
    ownerLine,
    `**Created:** ${draft.createdAt ?? 'unknown'} · **Paperclip status:** ${draft.sourceStatus} · **Revision:** ${draft.revision}`,
    `**Source verification:** ${draft.sourceVerification} · **Verified sources:** ${draft.verifiedSourceCount} · **VERIFY markers:** ${draft.verifyMarkers}`,
    `**Images:** ${draft.imageStatus} · **Post readiness:** ${draft.postReadiness}`,
    `**Readiness detail:** ${draft.readinessNotes}`,
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

async function validateSchema(
  notion: NotionDraftClient,
  dataSourceId: string,
  allowMigration = true,
): Promise<string[]> {
  const source = await notion.dataSources.retrieve({ data_source_id: dataSourceId });
  const actual = 'properties' in source ? source.properties : {};
  const expected = notionDraftDatabaseSchema();
  const wrong = Object.entries(expected).flatMap(([name, config]) => {
    const property = actual[name] as { type?: string } | undefined;
    return !property || property.type === config.type ? [] : [`${name} (${config.type})`];
  });
  if (wrong.length > 0) return wrong;
  const missing = Object.entries(expected).filter(([name]) => !(name in actual));
  if (missing.length > 0 && allowMigration) {
    await notion.dataSources.update({
      data_source_id: dataSourceId,
      properties: Object.fromEntries(missing),
    });
    // Notion normally exposes the new properties immediately. One readback is
    // enough to prove the migration without risking an unbounded retry loop if
    // the API is eventually consistent or rejects part of the schema.
    return validateSchema(notion, dataSourceId, false);
  }
  return missing.map(([name, config]) => `${name} (${config.type})`);
}

async function uploadMedia(notion: NotionDraftClient, draft: NotionDraftCandidate): Promise<UploadedMedia> {
  const result: UploadedMedia = { hero: [], other: [] };
  for (const asset of draft.assets) {
    const created = await notion.fileUploads.create({
      mode: 'single_part',
      filename: basename(asset.path),
      content_type: asset.contentType,
    });
    const bytes = readFileSync(asset.path);
    const sent = await notion.fileUploads.send({
      file_upload_id: created.id,
      file: {
        filename: basename(asset.path),
        data: new Blob([new Uint8Array(bytes)], { type: asset.contentType }),
      },
    });
    if (!('status' in sent) || sent.status !== 'uploaded') {
      throw new Error(`Notion did not finish uploading ${basename(asset.path)}`);
    }
    const file = {
      name: `${asset.assetId}${extname(asset.path)}`,
      type: 'file_upload' as const,
      file_upload: { id: created.id },
    };
    (asset.placement === 'hero' ? result.hero : result.other).push(file);
  }
  return result;
}

function machineProperties(
  draft: NotionDraftCandidate,
  syncedAt: string,
  uploaded?: UploadedMedia,
) {
  const properties = buildNotionDraftProperties(draft, syncedAt, uploaded);
  delete (properties as Record<string, unknown>)['Review Status'];
  delete (properties as Record<string, unknown>).Current;
  delete (properties as Record<string, unknown>).Checksum;
  if (!uploaded) {
    delete (properties as Record<string, unknown>)['Hero Image'];
    delete (properties as Record<string, unknown>)['Other Images'];
  }
  return properties;
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
      // `done` is a reconciliation state for a page that already entered the
      // founder review library. Do not backfill every historical closed issue
      // into Notion when this richer schema is first deployed.
      if (draft.sourceStatus === 'done' && existing.length === 0) {
        result.skipped += 1;
        continue;
      }
      const same = existing.find(
        (page) =>
          richTextValue(page.properties.Checksum) === draft.checksum &&
          checkboxValue(page.properties.Current),
      );
      if (same) {
        const storedMetadata = richTextValue(same.properties['Metadata Checksum']);
        if (storedMetadata !== draft.metadataChecksum) {
          const storedMedia = richTextValue(same.properties['Media Checksum']);
          const uploaded = storedMedia === draft.mediaChecksum ? undefined : await uploadMedia(notion, draft);
          await notion.pages.update({
            page_id: same.id,
            properties: machineProperties(draft, syncedAt, uploaded),
          });
          result.updated += 1;
        } else {
          result.skipped += 1;
        }
        continue;
      }

      // Create first. If Notion rejects the new body, the previous revision
      // remains current and readable instead of leaving the review queue empty.
      const uploaded = await uploadMedia(notion, draft);
      const heroCover = uploaded.hero[0];
      await notion.pages.create({
        parent: { type: 'data_source_id', data_source_id: dataSourceId },
        properties: buildNotionDraftProperties(draft, syncedAt, uploaded),
        icon: { type: 'emoji', emoji: '📝' },
        ...(heroCover
          ? { cover: { type: heroCover.type, file_upload: heroCover.file_upload } }
          : {}),
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
