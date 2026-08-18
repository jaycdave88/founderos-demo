import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { mergeSocialPosts, readPublishReceipts } from '@/lib/publish-receipts';
import type { SocialPost } from '@/lib/schemas';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function sha(file: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function fixture(): { root: string; video: string; manifest: string; receipt: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'founderos-publish-'));
  roots.push(root);
  const receipts = path.join(root, 'publish', 'receipts');
  fs.mkdirSync(receipts, { recursive: true });
  const video = path.join(root, 'output.mp4');
  fs.writeFileSync(video, 'verified video bytes');
  const rights = path.join(root, 'rights.json');
  fs.writeFileSync(rights, '{"schemaVersion":1,"externalAssets":[]}');
  const render = path.join(root, 'render.json');
  fs.writeFileSync(render, JSON.stringify({
    schemaVersion: 1,
    kind: 'momo-render',
    smokeTest: false,
    approval: { status: 'approved' },
    output: { path: video, sha256: sha(video), rightsLedger: rights },
  }));
  const manifest = path.join(root, 'publish.json');
  fs.writeFileSync(manifest, JSON.stringify({
    schemaVersion: 1,
    kind: 'momo-publish',
    companyId: 'company-faceless',
    issueId: 'MOMA-100',
    renderReceipt: render,
    platform: 'youtube',
    accountId: 'yt-account',
    title: 'A verified Short',
    description: 'The approved description.',
    visibility: 'private',
    approval: {
      status: 'approved', approvedBy: 'momo', approvedAt: '2026-08-18T00:40:00Z',
      evidence: 'Approved by Momo', renderSha256: sha(video), accountId: 'yt-account', visibility: 'private',
    },
  }));
  const receipt = path.join(receipts, 'receipt.json');
  fs.writeFileSync(receipt, JSON.stringify({
    schemaVersion: 1,
    kind: 'momo-publish-receipt',
    publishedAt: '2026-08-18T00:42:27Z',
    manifest: { path: manifest, sha256: sha(manifest) },
    render: { receiptPath: render, outputPath: video, sha256: sha(video) },
    platform: {
      name: 'youtube', provider: 'zernio', accountId: 'yt-account', username: '@momo',
      postId: 'yt-post', url: 'https://youtube.com/shorts/yt-post', status: 'published', visibility: 'private',
    },
  }));
  return { root, video, manifest, receipt };
}

describe('momo-publish receipt ingestion', () => {
  test('maps a checksum-valid platform receipt to an honest published social post', () => {
    const fx = fixture();
    expect(readPublishReceipts(fx.root)).toEqual([
      expect.objectContaining({
        id: 'publish:youtube:yt-post',
        caption: 'The approved description.',
        platforms: ['youtube'],
        status: 'published',
        companyId: 'company-faceless',
        platformPostId: 'yt-post',
        renderSha256: sha(fx.video),
        mediaUrl: 'https://youtube.com/shorts/yt-post',
      }),
    ]);
  });

  test('ignores a receipt when its source render or manifest has changed', () => {
    const fx = fixture();
    fs.appendFileSync(fx.video, 'tampered');
    expect(readPublishReceipts(fx.root)).toEqual([]);
  });

  test('ignores a receipt whose publication approval no longer matches the delivery', () => {
    const fx = fixture();
    const manifest = JSON.parse(fs.readFileSync(fx.manifest, 'utf8')) as { approval: { status: string } };
    manifest.approval.status = 'pending';
    fs.writeFileSync(fx.manifest, JSON.stringify(manifest));
    const receipt = JSON.parse(fs.readFileSync(fx.receipt, 'utf8')) as { manifest: { sha256: string } };
    receipt.manifest.sha256 = sha(fx.manifest);
    fs.writeFileSync(fx.receipt, JSON.stringify(receipt));
    expect(readPublishReceipts(fx.root)).toEqual([]);
  });

  test('filters the ledger to the active company', () => {
    const fx = fixture();
    expect(readPublishReceipts(fx.root, 'company-faceless')).toHaveLength(1);
    expect(readPublishReceipts(fx.root, 'another-company')).toEqual([]);
  });

  test('fails closed when the running dashboard has no active company', () => {
    const fx = fixture();
    const oldPublishRoot = process.env.PUBLISH_ROOT;
    const oldCompany = process.env.PAPERCLIP_COMPANY_ID;
    process.env.PUBLISH_ROOT = path.join(fx.root, 'publish');
    delete process.env.PAPERCLIP_COMPANY_ID;
    try {
      expect(readPublishReceipts()).toEqual([]);
    } finally {
      if (oldPublishRoot === undefined) delete process.env.PUBLISH_ROOT;
      else process.env.PUBLISH_ROOT = oldPublishRoot;
      if (oldCompany === undefined) delete process.env.PAPERCLIP_COMPANY_ID;
      else process.env.PAPERCLIP_COMPANY_ID = oldCompany;
    }
  });

  test('merges receipts with planning rows without promoting queued work', () => {
    const fx = fixture();
    const queued: SocialPost = {
      id: 'queue-1', caption: 'idea only', mediaUrl: null, platforms: ['youtube'], status: 'queued',
      scheduledFor: null, createdAt: '2026-08-17T00:00:00Z',
    };
    const merged = mergeSocialPosts([queued], readPublishReceipts(fx.root));
    expect(merged.map((p) => p.status)).toEqual(['published', 'queued']);
    expect(merged[1].platformPostId).toBeNull();
  });
});
