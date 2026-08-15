/**
 * /skills — the company's capabilities, from Paperclip.
 *
 * The page used to read ~/.claude/skills off the operator's own machine and
 * fall back to a seeded catalog. That directory is the operator's personal
 * Claude Code setup, not the company's, and the seeded rows went with the rest
 * of the fixtures. Paperclip already runs a catalog, an install set and a
 * per-agent runtime view, so this shows that instead.
 *
 * Read-only. Install, import and sync are writes that change what the agents
 * can do; they come after these shapes are confirmed against the live company.
 */
import { PageHeader } from '@/components/PageHeader';
import { Badge, SectionHead } from '@/components/terminal';
import { SkillsGrid, type SkillCard } from '@/components/SkillsGrid';
import { getPaperclipSnapshot } from '@/lib/paperclip-live';
import { getSkillsSnapshot } from '@/lib/paperclip-skills';

export const dynamic = 'force-dynamic';

const truncate = (t: string, n = 110) => (t.length > n ? `${t.slice(0, n).replace(/\s+\S*$/, '')}…` : t);

export default async function SkillsPage() {
  // The roster comes from the company read so per-agent coverage can be named.
  const company = await getPaperclipSnapshot();
  const skills = await getSkillsSnapshot(company.agents.map((a) => ({ id: a.id, name: a.name })));

  const installedSlugs = new Set(skills.installed.map((s) => s.slug));

  const cards: SkillCard[] = [
    ...skills.installed.map((skill) => ({
      id: skill.slug,
      name: skill.name,
      group: 'Installed',
      description: truncate(skill.description),
      meta: skill.sourceLabel,
      filePath: `${skill.sourceLabel} · ${skill.fileCount} file${skill.fileCount === 1 ? '' : 's'}`,
      status: 'live' as const,
    })),
    // Catalog entries already installed would otherwise appear twice, once as a
    // capability the company has and once as one it could get.
    ...skills.catalog
      .filter((skill) => !installedSlugs.has(skill.slug))
      .map((skill) => ({
        id: skill.slug,
        name: skill.name,
        group: `Catalog · ${skill.category}`,
        description: truncate(skill.description),
        meta: skill.kind,
        filePath: `catalog · ${skill.kind} · ${skill.trustLevel}`,
        status: 'planned' as const,
      })),
  ];

  const sourceNote = skills.ok
    ? `${skills.installed.length} installed in ${company.companyName ?? 'this company'}, ${skills.catalog.length} more in Paperclip's catalog. Green is installed; grey is available. Open a card to read its SKILL.md.`
    : `Paperclip not reachable at ${skills.base}.`;

  const withGaps = skills.agents.filter((a) => a.managedOff.length > 0);

  return (
    <div>
      <PageHeader
        eyebrow="capability library"
        title="Skills"
        right={
          skills.ok ? (
            <Badge tone="accent">{skills.installed.length} installed</Badge>
          ) : (
            <Badge tone="err">not connected</Badge>
          )
        }
      />

      {!skills.ok && (
        <div className="mb-5 rounded-lg-t border border-os-border bg-os-surface p-4">
          <div className="font-mono text-[11px] font-bold uppercase tracking-widest text-os-err">
            Paperclip not reachable
          </div>
          <p className="mt-2 font-mono text-[11.5px] leading-relaxed text-os-muted">
            No catalog is drawn rather than an empty one, which would read as a company with no
            capabilities. Tried {skills.base}.
          </p>
          {skills.errors.map((err) => (
            <div key={err} className="mt-1.5 font-mono text-[11px] leading-relaxed text-os-dim">
              {err}
            </div>
          ))}
        </div>
      )}

      {skills.ok && <SkillsGrid cards={cards} sourceNote={sourceNote} />}

      {skills.agents.length > 0 && (
        <section className="mt-6">
          <SectionHead label="Per agent" count={skills.agents.length} />
          <p className="mb-3 font-mono text-[11px] leading-relaxed text-os-dim">
            &quot;On&quot; and &quot;off&quot; count only the skills Paperclip manages — the ones it
            can switch. Everything under External the operator installed into the agent runtime
            directly, and Paperclip reports them without owning them.
          </p>
          <div className="overflow-x-auto rounded-lg-t border border-os-border bg-os-surface">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  {['Agent', 'Runtime', 'On', 'Off', 'External', 'Switched on'].map((h) => (
                    <th
                      key={h}
                      className="border-b border-os-border px-4 py-2.5 text-left font-mono text-[10px] font-normal uppercase tracking-[0.14em] text-os-dim"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {skills.agents.map((agent) => (
                  <tr key={agent.agentId}>
                    <td className="border-b border-os-hairline px-4 py-2 text-[12.5px]">{agent.name}</td>
                    <td className="border-b border-os-hairline px-4 py-2 font-mono text-[11px] text-os-dim">
                      {agent.adapterType}
                      {!agent.supported && ' · unsupported'}
                    </td>
                    <td className="border-b border-os-hairline px-4 py-2 font-mono text-[12px] text-os-ok">
                      {agent.managedOn.length}
                    </td>
                    <td className="border-b border-os-hairline px-4 py-2 font-mono text-[12px] text-os-warn">
                      {agent.managedOff.length}
                    </td>
                    <td className="border-b border-os-hairline px-4 py-2 font-mono text-[12px] text-os-dim">
                      {agent.externalCount}
                    </td>
                    <td className="border-b border-os-hairline px-4 py-2 font-mono text-[11px] text-os-muted">
                      {agent.managedOn.length > 0 ? agent.managedOn.join(', ') : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {withGaps.length > 0 && (
            <p className="mt-3 font-mono text-[11px] leading-relaxed text-os-warn">
              {withGaps.length === skills.agents.length
                ? 'Every agent has'
                : `${withGaps.length} of ${skills.agents.length} agents have`}{' '}
              Paperclip-managed skills available but switched off — including{' '}
              {[...new Set(withGaps.flatMap((a) => a.managedOff))].slice(0, 4).join(', ')}. Installing
              a skill does not attach it to anyone; that is a separate sync.
            </p>
          )}
        </section>
      )}
    </div>
  );
}
