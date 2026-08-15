/**
 * /agents — the real roster, from Paperclip.
 *
 * The page grouped seeded DB agents by seeded departments and gave each one a
 * chat box backed by FounderOS's own connector runtime. Those are a different
 * set of agents from the ones actually doing the company's work: the eight in
 * Paperclip, running on Hermes, which is where a wake goes and where the issues
 * live. Paperclip has no notion of departments, so neither does this.
 */
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Badge, Dot, Label, SectionHead } from '@/components/terminal';
import { getPaperclipSnapshot } from '@/lib/paperclip-live';
import { getSkillsSnapshot } from '@/lib/paperclip-skills';
import { WakeButton } from './wake';

export const dynamic = 'force-dynamic';

function ago(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return 'never';
  const mins = Math.round((Date.now() - then) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** Paperclip's agent statuses onto the Dot component's vocabulary. */
function dotState(status: string): string {
  if (status === 'running') return 'ok';
  if (status === 'error' || status === 'terminated') return 'err';
  if (status === 'paused') return 'warn';
  return 'available';
}

export default async function AgentsPage() {
  const snap = await getPaperclipSnapshot();
  const skills = await getSkillsSnapshot(snap.agents.map((a) => ({ id: a.id, name: a.name })));
  const skillsFor = new Map(skills.agents.map((a) => [a.agentId, a]));

  const open = snap.issues.filter((i) => i.status !== 'done' && i.status !== 'cancelled');
  const running = snap.agents.filter((a) => a.status === 'running').length;
  const lastRun = snap.agents
    .map((a) => a.lastHeartbeatAt)
    .filter((t): t is string => Boolean(t))
    .sort()
    .pop();

  return (
    <div>
      <PageHeader
        eyebrow="paperclip · runtime"
        title="Real Agents"
        right={
          snap.ok ? (
            <Badge tone="accent">{snap.agents.length} agents</Badge>
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
            No roster is drawn rather than an empty one, which would read as a company with no
            staff. Tried {snap.base}.
          </p>
          {snap.errors.map((err) => (
            <div key={err} className="mt-1.5 font-mono text-[11px] leading-relaxed text-os-dim">
              {err}
            </div>
          ))}
        </div>
      )}

      {snap.ok && (
        <>
          <div className="mb-6 grid grid-cols-4 gap-3 max-[1100px]:grid-cols-2">
            {[
              ['Agents', String(snap.agents.length)],
              ['Running', String(running)],
              ['Open work', String(open.length)],
              ['Last run', ago(lastRun)],
            ].map(([label, value]) => (
              <div
                key={label}
                className="hoverable flex flex-col gap-1.5 rounded-lg-t border border-os-border bg-os-surface px-4 py-3"
              >
                <Label>{label}</Label>
                <div className="font-mono text-[22px] font-semibold tracking-[-0.02em]">{value}</div>
              </div>
            ))}
          </div>

          <SectionHead label="Roster" count={`${snap.agents.length}`} />
          <p className="mb-3 flex flex-wrap items-center gap-1.5 text-xs text-os-dim">
            Heartbeats are off: an agent runs when woken and not otherwise. Its work lives on{' '}
            <Link href="/tasks" className="inline-flex items-center gap-0.5 text-os-accent hover:underline">
              Tasks <ArrowUpRight className="h-3 w-3" />
            </Link>
          </p>

          <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
            {snap.agents.map((agent) => {
              const mine = open.filter((i) => i.assigneeAgentId === agent.id);
              const agentSkills = skillsFor.get(agent.id);
              return (
                <article
                  key={agent.id}
                  className="hoverable flex flex-col rounded-lg-t border bg-os-surface p-4"
                  style={{
                    borderColor:
                      agent.status === 'running'
                        ? 'color-mix(in oklab, var(--accent) 35%, var(--border))'
                        : 'var(--border)',
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-2">
                        <Dot state={dotState(agent.status)} pulse={agent.status === 'running'} />
                        <h3 className="truncate text-[14.5px] font-bold">{agent.name}</h3>
                      </div>
                      <div className="mt-1 truncate font-mono text-[10.5px] text-os-dim">
                        {agent.title ?? agent.role ?? '—'}
                      </div>
                    </div>
                    <Badge>{agent.status}</Badge>
                  </div>

                  <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-[10.5px]">
                    {[
                      ['model', agent.adapterConfig?.model ?? '—'],
                      ['provider', agent.adapterConfig?.provider ?? '—'],
                      ['turns', agent.adapterConfig?.maxTurnsPerRun?.toString() ?? '—'],
                      ['runtime', agent.adapterType ?? '—'],
                    ].map(([k, v]) => (
                      <div key={k} className="contents">
                        <dt className="text-os-dim">{k}</dt>
                        <dd className="truncate text-os-muted">{v}</dd>
                      </div>
                    ))}
                  </dl>

                  <div className="mt-3 flex flex-wrap gap-1">
                    <span className="whitespace-nowrap rounded-sm-t border border-os-border bg-os-surface2 px-[7px] py-0.5 font-mono text-[9.5px] text-os-muted">
                      {mine.length} open
                    </span>
                    {agentSkills && (
                      <>
                        <span className="whitespace-nowrap rounded-sm-t border border-os-border bg-os-surface2 px-[7px] py-0.5 font-mono text-[9.5px] text-os-muted">
                          {agentSkills.managedOn.length} skills on
                        </span>
                        {agentSkills.managedOff.length > 0 && (
                          <span
                            className="whitespace-nowrap rounded-sm-t border px-[7px] py-0.5 font-mono text-[9.5px]"
                            style={{
                              borderColor: 'color-mix(in oklab, var(--warn) 35%, transparent)',
                              color: 'var(--warn)',
                            }}
                            title={`Available but not switched on: ${agentSkills.managedOff.join(', ')}`}
                          >
                            {agentSkills.managedOff.length} off
                          </span>
                        )}
                      </>
                    )}
                  </div>

                  <div className="mt-auto flex items-center justify-between gap-3 pt-4">
                    <span className="font-mono text-[10px] text-os-dim">
                      last run {ago(agent.lastHeartbeatAt)}
                    </span>
                    <WakeButton agentId={agent.id} name={agent.name} />
                  </div>
                </article>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
