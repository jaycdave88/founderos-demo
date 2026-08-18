import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getDb } from '@/lib/data';
import { mergeSocialPosts, readPublishReceipts } from '@/lib/publish-receipts';
import { SocialPlatformSchema, type SocialPost } from '@/lib/schemas';

export const dynamic = 'force-dynamic';

/** Planning rows plus checksum-verified publication receipts, newest first. */
export async function GET() {
  return NextResponse.json({ posts: mergeSocialPosts(getDb().socialPosts.all(), readPublishReceipts()) });
}

const CreateSchema = z.object({
  caption: z.string().min(1, 'caption is required'),
  platforms: z.array(SocialPlatformSchema).min(1, 'pick at least one platform'),
  mediaUrl: z.string().url().nullish(),
  scheduledFor: z.string().nullish(),
});

/**
 * Save a publication plan. This does NOT post live and no background agent
 * consumes this row. External publishing requires the separately approved,
 * fail-closed momo-publish workflow; its receipt is exposed by GET.
 */
export async function POST(request: Request) {
  const parsed = CreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const post: SocialPost = {
    id: randomUUID(),
    caption: parsed.data.caption,
    mediaUrl: parsed.data.mediaUrl ?? null,
    platforms: parsed.data.platforms,
    status: 'queued',
    scheduledFor: parsed.data.scheduledFor ?? null,
    createdAt: new Date().toISOString(),
  };
  getDb().socialPosts.enqueue(post);
  return NextResponse.json({ post }, { status: 201 });
}
