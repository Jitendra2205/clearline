/**
 * Captures the current database as the snapshot baked into the deploy image.
 *
 * Run this after a real `npm run extract`, so the hosted demo opens on a
 * populated comparison grid instead of an empty one. Render's free plan has no
 * persistent disk, and a reviewer arriving at a cold container would otherwise
 * see nothing until they ran extraction themselves.
 *
 * Run: npm run snapshot
 */

import fs from 'node:fs';
import path from 'node:path';
import { all, ready, dbLocation } from '../src/lib/db/client';

const OUT = path.join(process.cwd(), 'data', 'snapshot', 'clearline-seed.db');

async function main() {
  await ready();

  const source = dbLocation();
  if (source.startsWith('libsql://')) {
    console.error('  Snapshots are only taken from a local file database.');
    process.exit(1);
  }
  if (!fs.existsSync(source)) {
    console.error(`  No database at ${source}. Run: npm run seed`);
    process.exit(1);
  }

  const [{ n: quotes }] = await all<{ n: number }>('SELECT COUNT(*) AS n FROM quote');
  const [{ n: lines }] = await all<{ n: number }>('SELECT COUNT(*) AS n FROM quote_line');
  const [{ n: open }] = await all<{ n: number }>("SELECT COUNT(*) AS n FROM review_item WHERE status='open'");
  const [{ n: docs }] = await all<{ n: number }>('SELECT COUNT(*) AS n FROM vendor_document');

  if (quotes === 0) {
    console.log('\n  Warning: no extractions in this database.');
    console.log('  The snapshot would deploy an empty comparison grid.');
    console.log('  Run `npm run extract` first, then take the snapshot.\n');
    if (!process.argv.includes('--force')) process.exit(1);
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.copyFileSync(source, OUT);

  // SQLite may leave the tail of the last transaction in a -wal sidecar.
  // Fold it in so the copied file is complete on its own.
  for (const suffix of ['-wal', '-shm']) {
    if (fs.existsSync(source + suffix)) fs.copyFileSync(source + suffix, OUT + suffix);
  }

  const kb = Math.round(fs.statSync(OUT).size / 1024);
  console.log(`\n  snapshot written: data/snapshot/clearline-seed.db  (${kb} KB)`);
  console.log(`  contains: ${docs} documents · ${quotes} quotes · ${lines} quote lines · ${open} open review items`);
  console.log('  commit it, and the deployed container opens on this state.\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
