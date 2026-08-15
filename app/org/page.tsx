/**
 * /org — who reports to whom, as Paperclip has it.
 *
 * The chart was built from seeded agents, seeded departments, and a venture
 * lens belonging to the demo's operator. The company has a real hierarchy now:
 * Paperclip builds one from each agent's parent, and this draws that. It has no
 * concept of ventures or life areas, so the filters those drove are gone rather
 * than kept pointing at nothing.
 */
import Link from 'next/link';
import { ArrowUpRight, Users } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Badge, SectionHead } from '@/components/terminal';
import { getPaperclipOrg, type OrgNode } from '@/lib/paperclip-live';
import { operatorName, operatorTitle } from '@/lib/operator';

export const dynamic = 'force-dynamic';

function dotClass(status: string): string {
  if (status === 'running') return 'bg-os-ok';
  if (status === 'error' || status === 'terminated') return 'bg-os-err';
  if (status === 'paused') return 'bg-os-warn';
  return 'bg-os-muted';
}

function count(nodes: OrgNode[]): number {
  return nodes.reduce((n, node) => n + 1 + count(node.reports), 0);
}

function Node({ node, depth = 0 }: { node: OrgNode; depth?: number }) {
  return (
    <li className="relative">
      <div className="flex items-center gap-2 py-1.5">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotClass(node.status)}`} />
        <span className={`truncate ${depth === 0 ? 'text-[14px] font-bold' : 'text-[12.5px] font-medium'}`}>
          {node.name}
        </span>
        <span className="shrink-0 font-mono text-[9.5px] uppercase tracking-[0.14em] text-os-dim">
          {node.role}
        </span>
        {node.reports.length > 0 && (
          <span className="shrink-0 font-mono text-[9.5px] text-os-dim">
            · {node.reports.length} report{node.reports.length === 1 ? '' : 's'}
          </span>
        )}
      </div>
      {node.reports.length > 0 && (
        <ul className="ml-[3px] border-l border-os-border pl-4">
          {node.reports.map((child) => (
            <Node key={child.id} node={child} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

export default async function OrgChartPage() {
  const org = await getPaperclipOrg();
  const total = count(org.nodes);

  return (
    <div>
      <PageHeader
        eyebrow="paperclip · hierarchy"
        title="Org Chart"
        right={org.ok ? <Badge tone="accent">{total} agents</Badge> : <Badge tone="err">not connected</Badge>}
      />

      {!org.ok && (
        <div className="rounded-lg-t border border-os-border bg-os-surface p-4">
          <div className="font-mono text-[11px] font-bold uppercase tracking-widest text-os-err">
            Paperclip not reachable
          </div>
          <p className="mt-2 font-mono text-[11.5px] leading-relaxed text-os-muted">
            No chart is drawn rather than an empty one. Tried {org.base}.
          </p>
          {org.errors.map((err) => (
            <div key={err} className="mt-1.5 font-mono text-[11px] leading-relaxed text-os-dim">
              {err}
            </div>
          ))}
        </div>
      )}

      {org.ok && (
        <>
          {/* The operator sits above the tree because Paperclip's hierarchy is
              agents only — it does not model the human the company answers to. */}
          <div className="mb-4 flex items-center gap-3 rounded-lg-t border border-os-border-strong bg-os-surface px-4 py-3">
            <Users className="h-4 w-4 shrink-0 text-os-accent" strokeWidth={1.8} />
            <div className="min-w-0">
              <div className="truncate text-[14px] font-bold">{operatorName()}</div>
              <div className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-os-dim">
                {operatorTitle()}
              </div>
            </div>
          </div>

          <SectionHead label="Reports to the operator" count={`${org.nodes.length}`} />
          <p className="mb-3 flex flex-wrap items-center gap-1.5 text-xs text-os-dim">
            Reporting lines come from Paperclip, which is also what decides who an
            orchestrator can delegate to. Configure an agent from{' '}
            <Link href="/agents" className="inline-flex items-center gap-0.5 text-os-accent hover:underline">
              Agents <ArrowUpRight className="h-3 w-3" />
            </Link>
          </p>

          <div className="rounded-lg-t border border-os-border bg-os-surface px-4 py-3">
            <ul>
              {org.nodes.map((node) => (
                <Node key={node.id} node={node} />
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
