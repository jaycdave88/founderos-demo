import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * FOUNDER_OS_SEED=0 has to actually stop the seed, because the failure it
 * prevents is silent and total: an operator clears the demo rows, the next page
 * load sees an empty table in getDb()'s back-fill condition, and every fixture
 * comes back — including the ones they deliberately kept. They are then looking
 * at a dashboard of someone else's business believing it is theirs.
 *
 * getDb caches a module-level singleton, so each case needs a fresh module
 * registry and its own database file.
 */
let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fos-seed-'));
  vi.resetModules();
});

afterEach(() => {
  delete process.env.FOUNDER_OS_SEED;
  delete process.env.FOUNDER_OS_DB;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('FOUNDER_OS_SEED', () => {
  test('unset: a fresh database is seeded, so a new clone boots looking alive', async () => {
    process.env.FOUNDER_OS_DB = path.join(dir, 'seeded.db');
    const { getDb } = await import('@/lib/data');
    const db = getDb();
    expect(db.departments.all().length).toBeGreaterThan(0);
    expect(db.agents.all().length).toBeGreaterThan(0);
    db.close();
  });

  test('=0: a fresh database stays empty', async () => {
    process.env.FOUNDER_OS_SEED = '0';
    process.env.FOUNDER_OS_DB = path.join(dir, 'empty.db');
    const { getDb } = await import('@/lib/data');
    const db = getDb();
    expect(db.departments.all()).toHaveLength(0);
    expect(db.agents.all()).toHaveLength(0);
    expect(db.workflows.all()).toHaveLength(0);
    expect(db.skills.all()).toHaveLength(0);
    db.close();
  });

  test('=0: cleared rows are not restored on the next open', async () => {
    const dbPath = path.join(dir, 'cleared.db');

    // Boot once with seeding on, the way the demo ships.
    process.env.FOUNDER_OS_DB = dbPath;
    const first = await import('@/lib/data');
    const seeded = first.getDb();
    expect(seeded.agents.all().length).toBeGreaterThan(0);
    seeded.close();

    // Operator clears the fixtures and opts out. Re-opening must leave them
    // gone — this is the exact sequence that silently undid a reset before.
    // Agents only: departments are referenced by half the schema, and the point
    // here is the re-seed, not cascade order.
    vi.resetModules();
    process.env.FOUNDER_OS_SEED = '0';
    const second = await import('@/lib/data');
    const db = second.getDb();
    db.agents.deleteWhereIdNotIn([]);
    expect(db.agents.all()).toHaveLength(0);
    db.close();

    vi.resetModules();
    const third = await import('@/lib/data');
    const reopened = third.getDb();
    expect(reopened.agents.all()).toHaveLength(0);
    reopened.close();
  });
});
