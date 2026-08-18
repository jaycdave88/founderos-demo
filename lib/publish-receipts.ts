import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { SocialPostSchema, type SocialPost } from '@/lib/schemas';

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

const PublishReceiptSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal('momo-publish-receipt'),
  publishedAt: z.string().datetime(),
  manifest: z.object({
    path: z.string().min(1),
    sha256: Sha256Schema,
  }),
  render: z.object({
    receiptPath: z.string().min(1),
    outputPath: z.string().min(1),
    sha256: Sha256Schema,
  }),
  platform: z.object({
    name: z.literal('youtube'),
    provider: z.literal('zernio'),
    accountId: z.string().min(1),
    username: z.string().min(1),
    postId: z.string().min(1),
    url: z.string().url().refine((url) => url.startsWith('https://')),
    status: z.literal('published'),
    visibility: z.enum(['private', 'unlisted', 'public']),
  }),
});

const PublishManifestSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal('momo-publish'),
  companyId: z.string().min(1),
  issueId: z.string().min(1),
  renderReceipt: z.string().min(1),
  platform: z.literal('youtube'),
  accountId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  visibility: z.enum(['private', 'unlisted', 'public']),
  approval: z.object({
    status: z.literal('approved'),
    approvedBy: z.string().min(1),
    approvedAt: z.string().datetime(),
    evidence: z.string().min(8),
    renderSha256: Sha256Schema,
    accountId: z.string().min(1),
    visibility: z.enum(['private', 'unlisted', 'public']),
  }),
});

const RenderReceiptSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal('momo-render'),
  smokeTest: z.literal(false),
  approval: z.object({ status: z.literal('approved') }).passthrough(),
  output: z.object({
    path: z.string().min(1),
    sha256: Sha256Schema,
    rightsLedger: z.string().min(1),
  }).passthrough(),
});

function sha256(file: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function jsonFile(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
}

function defaultMediaRoot(): string {
  return process.env.MEDIA_ROOT || path.join(os.homedir(), 'AI', 'media');
}

/**
 * Read the immutable evidence written by momo-publish. Malformed, stale or
 * tampered evidence is omitted rather than being represented as published.
 */
export function readPublishReceipts(
  mediaRoot?: string,
  companyId = process.env.PAPERCLIP_COMPANY_ID,
): SocialPost[] {
  // Normal dashboard calls must be company-scoped. An explicit root is the
  // opt-in used by tests and offline tooling that intentionally reads all.
  if (mediaRoot === undefined && !companyId) return [];
  const receiptRoot = mediaRoot
    ? path.join(mediaRoot, 'publish', 'receipts')
    : path.join(process.env.PUBLISH_ROOT || path.join(defaultMediaRoot(), 'publish'), 'receipts');
  if (!fs.existsSync(receiptRoot)) return [];

  const posts: SocialPost[] = [];
  for (const entry of fs.readdirSync(receiptRoot, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const receiptPath = path.join(receiptRoot, entry.name);
    try {
      const receipt = PublishReceiptSchema.parse(jsonFile(receiptPath));
      if (!fs.statSync(receipt.manifest.path).isFile() || !fs.statSync(receipt.render.outputPath).isFile()) continue;
      if (sha256(receipt.manifest.path) !== receipt.manifest.sha256) continue;
      if (sha256(receipt.render.outputPath) !== receipt.render.sha256) continue;

      const manifest = PublishManifestSchema.parse(jsonFile(receipt.manifest.path));
      if (companyId && manifest.companyId !== companyId) continue;
      const render = RenderReceiptSchema.parse(jsonFile(receipt.render.receiptPath));
      if (manifest.renderReceipt !== receipt.render.receiptPath) continue;
      if (manifest.accountId !== receipt.platform.accountId || manifest.visibility !== receipt.platform.visibility) continue;
      if (manifest.approval.accountId !== manifest.accountId || manifest.approval.visibility !== manifest.visibility) continue;
      if (manifest.approval.renderSha256 !== receipt.render.sha256) continue;
      if (render.output.path !== receipt.render.outputPath || render.output.sha256 !== receipt.render.sha256) continue;
      if (!fs.statSync(render.output.rightsLedger).isFile()) continue;
      posts.push(SocialPostSchema.parse({
        id: `publish:${receipt.platform.name}:${receipt.platform.postId}`,
        caption: manifest.description,
        mediaUrl: receipt.platform.url,
        platforms: [receipt.platform.name],
        status: 'published',
        scheduledFor: null,
        createdAt: receipt.publishedAt,
        companyId: manifest.companyId,
        platformPostId: receipt.platform.postId,
        renderSha256: receipt.render.sha256,
        receiptPath,
      }));
    } catch {
      // Receipts are an external filesystem boundary. One bad file must not
      // break the dashboard or weaken the status of any valid publication.
    }
  }
  return posts.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Receipt-backed publications win ID collisions; queue records stay queued. */
export function mergeSocialPosts(planning: SocialPost[], published: SocialPost[]): SocialPost[] {
  const byId = new Map<string, SocialPost>();
  for (const post of planning) {
    byId.set(post.id, SocialPostSchema.parse({
      ...post,
      companyId: post.companyId ?? null,
      platformPostId: post.platformPostId ?? null,
      renderSha256: post.renderSha256 ?? null,
      receiptPath: post.receiptPath ?? null,
    }));
  }
  for (const post of published) byId.set(post.id, SocialPostSchema.parse(post));
  return [...byId.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
