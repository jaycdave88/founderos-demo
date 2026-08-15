/**
 * /content — everything the company has actually written.
 *
 * This page used to read a seeded roster and link out to a third party's
 * content-intelligence product. The roster went with the fixtures and the
 * links were never ours. What the company produces now are Paperclip
 * documents, attached to the issue that commissioned them, so that is what
 * this shows: the deliverables, newest first, readable in place.
 */
import Link from 'next/link';
import { ArrowUpRight, FileText } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Badge, SectionHead } from '@/components/terminal';
import { getPaperclipSnapshot, type PaperclipDocument } from '@/lib/paperclip-live';

export const dynamic = 'force-dynamic';

function words(body: string): number {
  const trimmed = body.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

function ago(iso: string | null | undefined): string {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '';
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${Math.max(1, mins)}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

type Piece = {
  issueId: string;
  identifier: string;
  issueTitle: string;
  status: string;
  author: string;
  updatedAt: string | null;
  docs: PaperclipDocument[];
};

function DocBody({ doc }: { doc: PaperclipDocument }) {
  return (
    <details className="border-t border-os-hairline first:border-t-0">
      <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 hover:bg-os-surface2">
        <FileText className="h-3.5 w-3.5 shrink-0 text-os-dim" />
        <span className="font-mono text-[11px] uppercase tracking-wide text-os-accent">{doc.key}</span>
        <span className="min-w-0 flex-1 truncate text-[12.5px]">{doc.title ?? '—'}</span>
        <span className="shrink-0 font-mono text-[10px] text-os-dim">
          {words(doc.body).toLocaleString()} words
          {doc.latestRevisionNumber !== null ? ` · rev ${doc.latestRevisionNumber}` : ''}
        </span>
      </summary>
      <pre className="max-h-[520px] overflow-y-auto whitespace-pre-wrap break-words border-t border-os-hairline bg-os-bg px-4 py-3 text-[12.5px] leading-relaxed text-os-muted">
        {doc.body}
      </pre>
    </details>
  );
}

export default async function ContentPage() {
  const snap = await getPaperclipSnapshot();
  const nameOf = new Map(snap.agents.map((agent) => [agent.id, agent.name]));

  const pieces: Piece[] = snap.issues
    .filter((issue) => (snap.documents[issue.id] ?? []).length > 0)
    .map((issue) => ({
      issueId: issue.id,
      identifier: issue.identifier ?? issue.id.slice(0, 8),
      issueTitle: issue.title ?? '(untitled)',
      status: issue.status ?? 'unknown',
      author: issue.assigneeAgentId ? (nameOf.get(issue.assigneeAgentId) ?? 'unknown agent') : 'unassigned',
      updatedAt: issue.updatedAt ?? null,
      docs: snap.documents[issue.id] ?? [],
    }))
    // Newest first. Issues Paperclip gave no timestamp sort last rather than
    // claiming to be the oldest thing in the company.
    .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));

  const docCount = pieces.reduce((n, piece) => n + piece.docs.length, 0);
  const wordCount = pieces.reduce(
    (n, piece) => n + piece.docs.reduce((m, doc) => m + words(doc.body), 0),
    0,
  );

  return (
    <div>
      <PageHeader
        eyebrow="content engine"
        title="Content Creation"
        right={
          snap.ok ? (
            <Badge tone="accent">
              {docCount} {docCount === 1 ? 'document' : 'documents'}
            </Badge>
          ) : (
            <Badge tone="err">not connected</Badge>
          )
        }
      />

      {!snap.ok && (
        <div className="rounded-lg-t border border-os-border bg-os-surface p-4">
          <div className="font-mono text-[11px] font-bold uppercase tracking-widest text-os-err">
            Paperclip not reachable
          </div>
          <p className="mt-2 font-mono text-[11.5px] leading-relaxed text-os-muted">
            Nothing is listed rather than an empty library, which would read as a company that has
            written nothing. Tried {snap.base}.
          </p>
          {snap.errors.map((err) => (
            <div key={err} className="mt-1.5 font-mono text-[11px] leading-relaxed text-os-dim">
              {err}
            </div>
          ))}
        </div>
      )}

      {snap.ok && (
        <section>
          <SectionHead
            label="Deliverables"
            count={docCount > 0 ? `${wordCount.toLocaleString()} words` : '0'}
          />
          <p className="mb-3 flex flex-wrap items-center gap-1.5 text-xs text-os-dim">
            Written by the agents, attached to the issue that commissioned them. Comment on a piece
            from{' '}
            <Link href="/paperclip" className="inline-flex items-center gap-0.5 text-os-accent hover:underline">
              Paperclip <ArrowUpRight className="h-3 w-3" />
            </Link>
          </p>

          {pieces.length > 0 ? (
            <div className="flex flex-col gap-3">
              {pieces.map((piece) => (
                <article key={piece.issueId} className="overflow-hidden rounded-lg-t border border-os-border bg-os-surface">
                  <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3">
                    <span className="font-mono text-[10.5px] text-os-dim">{piece.identifier}</span>
                    <span className="min-w-0 flex-1 text-[13.5px] font-semibold">{piece.issueTitle}</span>
                    <span className="font-mono text-[10px] uppercase tracking-wide text-os-dim">
                      {piece.status}
                    </span>
                  </header>
                  <div className="flex flex-wrap items-center gap-x-3 px-4 pb-2.5 font-mono text-[10.5px] text-os-dim">
                    <span>{piece.author}</span>
                    {piece.updatedAt && <span>{ago(piece.updatedAt)}</span>}
                  </div>
                  {piece.docs.map((doc) => (
                    <DocBody key={doc.key} doc={doc} />
                  ))}
                </article>
              ))}
            </div>
          ) : (
            <p className="rounded-lg-t border border-dashed border-os-border bg-os-surface px-4 py-5 text-center font-mono text-[11.5px] text-os-dim">
              {snap.issues.length === 0
                ? 'No issues in the company yet — work created in Paperclip appears here once an agent writes something.'
                : `${snap.issues.length} issues on the board, none with a document attached yet.`}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
