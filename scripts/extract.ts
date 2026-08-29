/**
 * Runs extraction over every un-extracted document in the seeded RFx.
 *
 * The same job runner the app uses, driven from the CLI so a demo can be
 * prepared ahead of time (and so the eval harness has something to score).
 *
 * Run: npm run extract        (only documents with no successful job)
 *      npm run extract -- --force
 */

import './load-env';
import { all, ready } from '../src/lib/db/client';
import { runExtractionJob } from '../src/lib/jobs/runner';

async function main() {
  await ready();
  const force = process.argv.includes('--force');

  const docs = await all<{ id: string; filename: string; vendor_id: string; rfx_id: string }>(
    'SELECT id, filename, vendor_id, rfx_id FROM vendor_document ORDER BY received_at',
  );

  if (docs.length === 0) {
    console.log('  No documents. Run: npm run seed');
    return;
  }

  console.log(`  ${docs.length} documents\n`);
  let ok = 0;
  let failed = 0;

  // Sequential on purpose: five concurrent multi-megabyte document calls is a
  // good way to meet a rate limit during a live demo.
  for (const d of docs) {
    process.stdout.write(`  ${d.filename.padEnd(28)} `);
    try {
      const r = await runExtractionJob({ docId: d.id, force });
      if (r.cached) {
        console.log(`cached (${r.lines} lines)`);
      } else {
        console.log(
          `${r.lines} lines · ${r.blocked} blocked · ${r.reviewItems} to review · ${(r.ms / 1000).toFixed(1)}s · ${r.inputTokens}/${r.outputTokens} tok`,
        );
      }
      ok++;
    } catch (e) {
      console.log(`FAILED — ${e instanceof Error ? e.message : String(e)}`);
      failed++;
    }
  }

  const [{ n: reviews }] = await all<{ n: number }>(
    "SELECT COUNT(*) as n FROM review_item WHERE status = 'open'",
  );
  const [{ n: lines }] = await all<{ n: number }>('SELECT COUNT(*) as n FROM quote_line');

  console.log(`\n  ${ok} succeeded, ${failed} failed · ${lines} quote lines · ${reviews} open review items`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
