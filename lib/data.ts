import path from 'node:path';
import fs from 'node:fs';
import { openDb, type FounderDb } from '@/lib/db';
import { seedDatabase } from '@/lib/seed';

/**
 * App-level singleton. Larp-first, real-ready: every page and API route reads
 * through this seeded SQLite database, so swapping in live sources later is a
 * repo-level change, not a UI rewrite.
 */
let instance: FounderDb | null = null;

/**
 * Set FOUNDER_OS_SEED=0 to run against real data only.
 *
 * The demo seed is what makes a fresh clone boot looking alive, and that is
 * worth keeping — but it makes the database impossible to empty. Clearing rows
 * satisfies the back-fill condition below, so the next page load restores all
 * of it, including the tables the operator deliberately kept. An operator who
 * has wired real sources needs a way off that treadmill, and deleting the seed
 * is not it: they still want it for the next clone.
 */
function seedingEnabled(): boolean {
  return (process.env.FOUNDER_OS_SEED ?? '1') !== '0';
}

export function getDb(): FounderDb {
  if (instance) return instance;
  const dbPath = process.env.FOUNDER_OS_DB ?? path.join(process.cwd(), 'data', 'founder-os.db');
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  instance = openDb(dbPath);
  // Seed on first touch so a fresh clone boots looking alive. Each clause
  // back-fills databases created before that table existed; seedDatabase is
  // idempotent (INSERT OR REPLACE), so re-running only adds what's missing.
  if (
    seedingEnabled() &&
    (instance.departments.all().length === 0 ||
      instance.workflows.all().length === 0 ||
      instance.skills.all().length === 0 ||
      instance.social.accounts().length === 0 ||
      instance.emailList.snapshots().length === 0 ||
      instance.social.dmSnapshots().length === 0 ||
      instance.social.dmMessages().length === 0)
  ) {
    seedDatabase(instance);
  }
  return instance;
}
