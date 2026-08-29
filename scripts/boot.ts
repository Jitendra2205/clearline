/**
 * Boot: make sure the container has a usable database before Next starts.
 *
 * Render's free plan has no persistent disk, so the filesystem is wiped on every
 * redeploy and on every wake from idle sleep. Seeding alone is not enough: it
 * restores the RFx and the five vendor documents, but the extraction results are
 * gone, and a reviewer opening the link lands on an empty comparison grid.
 *
 * So the image can carry a snapshot — a real database from a real extraction run
 * — and this script restores it on a cold start. Order of preference:
 *
 *   1. An existing database (a warm restart, or a mounted disk). Leave it alone.
 *   2. A snapshot baked into the image. Copy it into place.
 *   3. Neither: seed the RFx and documents, unextracted.
 *
 * The snapshot is not fabricated data. It is produced by `npm run snapshot`
 * after a genuine `npm run extract`, and the app lets anyone re-run extraction
 * live from the UI to prove it.
 */

import './load-env';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { dbFilePath } from '../src/lib/db/client';

const SNAPSHOT = path.join(process.cwd(), 'data', 'snapshot', 'clearline-seed.db');

function main() {
  const target = dbFilePath();

  if (target === null) {
    console.log('  boot: remote database configured, seeding if empty');
    seed();
    return;
  }

  if (fs.existsSync(target) && fs.statSync(target).size > 0) {
    console.log(`  boot: existing database at ${target}`);
    seed(); // no-op when already seeded
    return;
  }

  if (fs.existsSync(SNAPSHOT)) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(SNAPSHOT, target);
    const kb = Math.round(fs.statSync(target).size / 1024);
    console.log(`  boot: restored extraction snapshot (${kb} KB) -> ${target}`);
    return;
  }

  console.log('  boot: no database and no snapshot — seeding the RFx unextracted');
  seed();
}

function seed() {
  const r = spawnSync(process.execPath, [
    path.join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs'),
    path.join(process.cwd(), 'scripts', 'seed-aerchain.ts'),
  ], { stdio: 'inherit' });

  if (r.status !== 0) {
    // A failed seed must not stop the server: the app renders an empty state
    // and says so, which is better than a container that will not start.
    console.error('  boot: seeding failed — the app will start with whatever is in the database');
  }
}

main();
