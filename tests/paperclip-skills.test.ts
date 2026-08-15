import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { getSkillsSnapshot, readPaperclipSkillMarkdown } from '@/lib/paperclip-skills';

const CID = 'company-1';

beforeEach(() => {
  vi.stubEnv('PAPERCLIP_BASE_URL', 'http://127.0.0.1:3100');
  vi.stubEnv('PAPERCLIP_COMPANY_ID', CID);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

// Field-for-field from a live Paperclip instance, so a shape change here fails
// rather than quietly rendering an empty catalog.
const CATALOG = [
  {
    id: 'paperclipai:optional:browser:agent-browser',
    key: 'paperclipai/optional/browser/agent-browser',
    kind: 'optional',
    category: 'browser',
    slug: 'agent-browser',
    name: 'agent-browser',
    description: 'Drive a real browser to inspect or interact with a web page.',
    trustLevel: 'markdown_only',
    compatibility: 'compatible',
    defaultInstall: false,
    recommendedForRoles: ['qa', 'engineer', 'researcher'],
    tags: ['browser', 'verification'],
    files: [{ path: 'SKILL.md', kind: 'skill', sizeBytes: 5133 }],
  },
];

const COMPANY_SKILLS = [
  {
    id: '48b6f1e6-e78f-4f48-80aa-e130b94f2dcc',
    companyId: CID,
    key: 'paperclipai/paperclip/paperclip',
    slug: 'paperclip',
    name: 'paperclip',
    description: 'Interact with the Paperclip control plane API.',
    trustLevel: 'scripts_executables',
    fileInventory: [
      { path: 'SKILL.md', kind: 'skill' },
      { path: 'references/api-reference.md', kind: 'reference' },
      { path: 'scripts/upload.sh', kind: 'script' },
    ],
    categories: [],
    attachedAgentCount: 1,
    editable: false,
    editableReason: 'Bundled Paperclip skills are read-only.',
    sourceLabel: 'Paperclip bundled',
  },
];

const AGENT_SKILLS = {
  adapterType: 'hermes_local',
  supported: true,
  mode: 'persistent',
  desiredSkills: [],
  entries: [
    { key: 'paperclipai/paperclip/paperclip', desired: true, managed: true, state: 'installed', origin: 'company_managed' },
    { key: 'paperclipai/bundled/paperclip-operations/reflection-coach', desired: false, managed: true, state: 'available', origin: 'company_managed' },
    { key: 'paperclipai/paperclip/paperclip-board', desired: false, managed: true, state: 'available', origin: 'company_managed' },
    { key: 'airtable', desired: true, managed: false, state: 'installed', origin: 'user_installed' },
    { key: 'obsidian', desired: true, managed: false, state: 'installed', origin: 'user_installed' },
  ],
  warnings: [],
};

/** Routes by URL so the three concurrent reads can each get their own body. */
function stubRoutes(over: Record<string, { status?: number; body?: unknown }> = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const hit = Object.entries(over).find(([fragment]) => url.includes(fragment));
      if (hit) {
        const { status = 200, body = {} } = hit[1];
        return new Response(JSON.stringify(body), { status });
      }
      if (url.endsWith('/api/skills/catalog')) return new Response(JSON.stringify(CATALOG), { status: 200 });
      if (url.endsWith(`/api/companies/${CID}/skills`)) return new Response(JSON.stringify(COMPANY_SKILLS), { status: 200 });
      if (/\/api\/agents\/[^/]+\/skills$/.test(url)) return new Response(JSON.stringify(AGENT_SKILLS), { status: 200 });
      return new Response('not found', { status: 404 });
    }),
  );
}

const ROSTER = [{ id: 'agent-1', name: 'Chief of Staff' }];

describe('getSkillsSnapshot', () => {
  test('reads the catalog as the bare array Paperclip returns', async () => {
    stubRoutes();
    const snap = await getSkillsSnapshot(ROSTER);

    expect(snap.ok).toBe(true);
    expect(snap.catalog).toHaveLength(1);
    expect(snap.catalog[0]).toMatchObject({
      slug: 'agent-browser',
      kind: 'optional',
      category: 'browser',
      recommendedForRoles: ['qa', 'engineer', 'researcher'],
    });
  });

  test("counts a company skill's files from its inventory", async () => {
    stubRoutes();
    const snap = await getSkillsSnapshot(ROSTER);

    expect(snap.installed).toHaveLength(1);
    expect(snap.installed[0]).toMatchObject({
      slug: 'paperclip',
      fileCount: 3,
      attachedAgentCount: 1,
      editable: false,
      sourceLabel: 'Paperclip bundled',
    });
  });

  test("splits an agent's skills into managed-on, managed-off and external", async () => {
    stubRoutes();
    const snap = await getSkillsSnapshot(ROSTER);

    const agent = snap.agents[0];
    expect(agent.name).toBe('Chief of Staff');
    expect(agent.adapterType).toBe('hermes_local');
    // Named by the last path segment — the full key is not what an operator reads.
    expect(agent.managedOn).toEqual(['paperclip']);
    expect(agent.managedOff).toEqual(['paperclip-board', 'reflection-coach']);
    // Hermes skills are reported, not owned: they must not inflate the counts
    // Paperclip can actually act on.
    expect(agent.externalCount).toBe(2);
  });

  test('an unreachable Paperclip is an empty snapshot with the failures named, not a throw', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('connect ECONNREFUSED 127.0.0.1:3100');
      }),
    );

    const snap = await getSkillsSnapshot(ROSTER);

    expect(snap.ok).toBe(false);
    expect(snap.catalog).toEqual([]);
    expect(snap.installed).toEqual([]);
    expect(snap.errors.join(' ')).toContain('ECONNREFUSED');
  });

  test('a missing company id is reported without any request', async () => {
    vi.stubEnv('PAPERCLIP_COMPANY_ID', '');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const snap = await getSkillsSnapshot(ROSTER);

    expect(snap.ok).toBe(false);
    expect(snap.errors[0]).toContain('PAPERCLIP_COMPANY_ID');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('one dead endpoint does not take the whole page down', async () => {
    stubRoutes({ '/api/skills/catalog': { status: 500, body: { error: 'boom' } } });
    const snap = await getSkillsSnapshot(ROSTER);

    expect(snap.catalog).toEqual([]);
    expect(snap.installed).toHaveLength(1); // still rendered
    expect(snap.ok).toBe(true);
    expect(snap.errors.join(' ')).toContain('HTTP 500');
  });
});

describe('readPaperclipSkillMarkdown', () => {
  test('returns the markdown body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ markdown: '# paperclip' }), { status: 200 })),
    );
    expect(await readPaperclipSkillMarkdown('paperclip')).toBe('# paperclip');
  });

  test('returns null on 404 so the reader can fall back instead of showing a dead end', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })));
    expect(await readPaperclipSkillMarkdown('nothing')).toBeNull();
  });

  test('returns null when Paperclip is unreachable, never throws', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('down');
      }),
    );
    expect(await readPaperclipSkillMarkdown('paperclip')).toBeNull();
  });
});
