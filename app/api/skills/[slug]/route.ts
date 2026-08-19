import { NextResponse } from 'next/server';
import { readSkillMarkdown } from '@/lib/skills-catalog';
import { readPaperclipSkillMarkdown } from '@/lib/paperclip-skills';

export const dynamic = 'force-dynamic';

/**
 * The full SKILL.md for one skill, loaded on demand by the reader.
 *
 * Local disk first, then Paperclip. Two stores answer to the same reader
 * because they are the same question from where the operator sits — "show me
 * this skill" — and the alternative was a second reader that looked identical
 * and fetched somewhere else.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const local = readSkillMarkdown(slug);
  if (local !== null) return NextResponse.json({ markdown: local, source: 'local' });

  const remote = await readPaperclipSkillMarkdown(slug);
  if (remote !== null) return NextResponse.json({ markdown: remote, source: 'paperclip' });

  return NextResponse.json({ error: 'skill not found on disk or in Paperclip' }, { status: 404 });
}
