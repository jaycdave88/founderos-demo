import { NextResponse } from 'next/server';
import { zernioRecentPosts } from '@/lib/connectors/zernio';
import { socialControls } from '@/lib/social-mode';

export const dynamic = 'force-dynamic';

/** Live published-post history from Zernio/Late (real captions + post URLs).
    Distinct from /api/social/posts, which is the outgoing publish queue.
    `?limit=` caps the count. */
export async function GET(req: Request) {
  if (socialControls(process.env).mode === 'preview') {
    return NextResponse.json({ posts: [], source: 'demo-preview' });
  }
  const limit = Number(new URL(req.url).searchParams.get('limit')) || 6;
  const posts = await zernioRecentPosts(Math.min(Math.max(limit, 1), 24));
  return NextResponse.json({ posts });
}
