/**
 * The company's capabilities, read from Paperclip.
 *
 * Paperclip runs its own skill system — a published catalog, a per-company
 * install set, and a per-agent view of what is actually wired into the runtime.
 * FounderOS does not need a second store; it needs to show this one.
 *
 * Read-only on purpose. Installing, importing and syncing are real writes with
 * real consequences for what the agents can do, and this landed first so the
 * shapes could be confirmed against the running instance before anything
 * started changing them.
 */
import { paperclipBase, paperclipCompanyId, paperclipHeaders } from '@/lib/paperclip-live';

/** One entry in Paperclip's published catalog — installable, not yet installed. */
export type CatalogSkill = {
  id: string;
  slug: string;
  name: string;
  description: string;
  /** `bundled` ships with Paperclip; `optional` is opt-in. */
  kind: string;
  category: string;
  tags: string[];
  /** Paperclip's own answer to "who is this for" — the basis for recommending. */
  recommendedForRoles: string[];
  trustLevel: string;
  compatibility: string;
};

/** A skill installed into this company. */
export type CompanySkill = {
  id: string;
  slug: string;
  name: string;
  description: string;
  /** Human label for where it came from, e.g. "Paperclip bundled". */
  sourceLabel: string;
  trustLevel: string;
  categories: string[];
  fileCount: number;
  attachedAgentCount: number;
  editable: boolean;
  editableReason: string | null;
};

/**
 * What one agent's runtime actually has. Paperclip-managed skills are counted
 * separately from the ones the operator installed into Hermes, because only the
 * managed ones are Paperclip's to turn on.
 */
export type AgentSkills = {
  agentId: string;
  name: string;
  adapterType: string;
  supported: boolean;
  /** Managed skills switched on for this agent. */
  managedOn: string[];
  /** Managed skills available to it but not switched on. */
  managedOff: string[];
  /** Skills the operator installed outside Paperclip (Hermes, and the like). */
  externalCount: number;
};

export type SkillsSnapshot = {
  ok: boolean;
  base: string;
  companyId: string;
  catalog: CatalogSkill[];
  installed: CompanySkill[];
  agents: AgentSkills[];
  errors: string[];
};

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function strList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') {
    for (const key of ['items', 'data', 'skills', 'entries'] as const) {
      const inner = (value as Record<string, unknown>)[key];
      if (Array.isArray(inner)) return inner;
    }
  }
  return [];
}

async function getJson(path: string, errors: string[]): Promise<unknown | null> {
  try {
    const res = await fetch(`${paperclipBase()}${path}`, {
      headers: paperclipHeaders(),
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      errors.push(`${path} -> HTTP ${res.status}`);
      return null;
    }
    return (await res.json()) as unknown;
  } catch (err) {
    errors.push(`${path} -> ${err instanceof Error ? err.message : 'request failed'}`);
    return null;
  }
}

function toCatalogSkill(raw: unknown): CatalogSkill | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id = str(o.id);
  if (!id) return null;
  const slug = str(o.slug) || str(o.name) || id;
  return {
    id,
    slug,
    name: str(o.name, slug),
    description: str(o.description),
    kind: str(o.kind, 'unknown'),
    category: str(o.category, 'uncategorised'),
    tags: strList(o.tags),
    recommendedForRoles: strList(o.recommendedForRoles),
    trustLevel: str(o.trustLevel, 'unknown'),
    compatibility: str(o.compatibility, 'unknown'),
  };
}

function toCompanySkill(raw: unknown): CompanySkill | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id = str(o.id);
  if (!id) return null;
  const slug = str(o.slug) || str(o.name) || id;
  return {
    id,
    slug,
    name: str(o.name, slug),
    description: str(o.description),
    sourceLabel: str(o.sourceLabel, 'unknown source'),
    trustLevel: str(o.trustLevel, 'unknown'),
    categories: strList(o.categories),
    fileCount: Array.isArray(o.fileInventory) ? o.fileInventory.length : 0,
    attachedAgentCount: typeof o.attachedAgentCount === 'number' ? o.attachedAgentCount : 0,
    editable: o.editable === true,
    editableReason: str(o.editableReason) || null,
  };
}

/** The last path segment of a skill key — `a/b/reflection-coach` -> `reflection-coach`. */
function leaf(key: string): string {
  const parts = key.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? key;
}

function toAgentSkills(agentId: string, name: string, raw: unknown): AgentSkills {
  const empty: AgentSkills = {
    agentId,
    name,
    adapterType: 'unknown',
    supported: false,
    managedOn: [],
    managedOff: [],
    externalCount: 0,
  };
  if (!raw || typeof raw !== 'object') return empty;
  const o = raw as Record<string, unknown>;

  const managedOn: string[] = [];
  const managedOff: string[] = [];
  let externalCount = 0;

  for (const entry of asArray(o.entries)) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const key = str(e.key);
    if (!key) continue;
    if (e.managed === true) {
      (e.desired === true ? managedOn : managedOff).push(leaf(key));
    } else {
      externalCount += 1;
    }
  }

  return {
    agentId,
    name,
    adapterType: str(o.adapterType, 'unknown'),
    supported: o.supported === true,
    managedOn: managedOn.sort(),
    managedOff: managedOff.sort(),
    externalCount,
  };
}

/**
 * @param agents the company roster, so per-agent coverage can be named rather
 *   than listed by uuid. Pass the roster you already have; this does not re-read it.
 */
export async function getSkillsSnapshot(
  agents: { id: string; name: string }[],
): Promise<SkillsSnapshot> {
  const errors: string[] = [];
  const cid = paperclipCompanyId();

  if (!cid) {
    errors.push('PAPERCLIP_COMPANY_ID is not set.');
    return { ok: false, base: paperclipBase(), companyId: cid, catalog: [], installed: [], agents: [], errors };
  }

  const [catalogRaw, installedRaw, agentRaws] = await Promise.all([
    getJson('/api/skills/catalog', errors),
    getJson(`/api/companies/${cid}/skills`, errors),
    // One call per agent, in parallel. The roster is single digits, so this is
    // a handful of loopback requests rather than something worth paginating.
    Promise.all(agents.map((agent) => getJson(`/api/agents/${agent.id}/skills`, errors))),
  ]);

  const catalog = asArray(catalogRaw)
    .map(toCatalogSkill)
    .filter((s): s is CatalogSkill => s !== null);
  const installed = asArray(installedRaw)
    .map(toCompanySkill)
    .filter((s): s is CompanySkill => s !== null);
  const perAgent = agents.map((agent, i) => toAgentSkills(agent.id, agent.name, agentRaws[i]));

  return {
    ok: catalog.length > 0 || installed.length > 0,
    base: paperclipBase(),
    companyId: cid,
    catalog,
    installed,
    agents: perAgent,
    errors,
  };
}

/**
 * One skill's SKILL.md from Paperclip. Returns null when Paperclip does not
 * have it, so the caller can fall back rather than show a Paperclip 404 as if
 * the skill did not exist anywhere.
 */
export async function readPaperclipSkillMarkdown(name: string): Promise<string | null> {
  try {
    const res = await fetch(`${paperclipBase()}/api/skills/${encodeURIComponent(name)}`, {
      headers: paperclipHeaders(),
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as unknown;
    if (typeof body === 'string') return body;
    if (body && typeof body === 'object') {
      const o = body as Record<string, unknown>;
      const md = str(o.markdown) || str(o.content) || str(o.body) || str(o.skill);
      if (md) return md;
    }
    return null;
  } catch {
    return null;
  }
}
