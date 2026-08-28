/**
 * AI evaluation harness.
 *
 * Scores what actually landed in the database against data/ground_truth.json —
 * which is the same object the vendor documents were generated from, so every
 * expected value provably appears in the source file.
 *
 * Run: npm run extract && npm run eval
 *      npm run eval -- --json         (machine-readable, for CI)
 *
 * The metric that matters most is not accuracy, it is calibration. A system
 * that is 85% accurate and knows which 15% it got wrong is far more useful
 * than one that is 95% accurate and confident about everything.
 */

import fs from 'node:fs';
import path from 'node:path';
import { all, ready, j, dbLocation } from '../src/lib/db/client';
import { sanitizeCell } from '../src/lib/security/csv';
import { convertUom, convertCurrency } from '../src/lib/normalize/units';
import type { GtQuote } from './dataset';

interface GroundTruth {
  quotes: GtQuote[];
}

const JSON_OUT = process.argv.includes('--json');
const TARGETS = {
  fieldAccuracy: 0.95,
  recall: 0.9,
  hallucination: 0,
  provenance: 1,
  nullHonesty: 0.98,
  highBucketAccuracy: 0.98,
  errorsFlagged: 0.9,
};

function pct(n: number, d: number): number {
  return d === 0 ? 1 : n / d;
}
const fmt = (x: number) => `${(x * 100).toFixed(1)}%`;

function verdict(actual: number, target: number, higherIsBetter = true): string {
  const ok = higherIsBetter ? actual >= target : actual <= target;
  return ok ? 'PASS' : 'FAIL';
}

async function main() {
  await ready();

  const gtPath = path.join(process.cwd(), 'data', 'ground_truth.json');
  if (!fs.existsSync(gtPath)) {
    console.error('  data/ground_truth.json missing. Run: npm run fixtures');
    process.exit(1);
  }
  const gt = JSON.parse(fs.readFileSync(gtPath, 'utf8')) as GroundTruth;

  const quotes = await all<{
    id: string; vendor_id: string; vendor_name: string; currency: string | null;
    incoterm: string | null; validity: string | null; commercial_notes_json: string;
  }>(
    `SELECT q.id, q.vendor_id, v.name AS vendor_name, q.currency, q.incoterm, q.validity,
            q.commercial_notes_json
       FROM quote q JOIN vendor v ON v.id = q.vendor_id`,
  );

  if (quotes.length === 0) {
    console.error('  No extractions in the database. Run: npm run extract');
    process.exit(1);
  }

  const lines = await all<{
    quote_id: string; vendor_id: string; code: string | null; raw_description: string;
    raw_price: string; raw_uom: string | null; parsed_price: number | null;
    normalized_price: number | null; match_tier: string; extraction_confidence: string;
    blocked: number; source_ref_json: string;
  }>(
    `SELECT ql.quote_id, ql.vendor_id, rl.code, ql.raw_description, ql.raw_price, ql.raw_uom,
            ql.parsed_price, ql.normalized_price, ql.match_tier, ql.extraction_confidence,
            ql.blocked, ql.source_ref_json
       FROM quote_line ql LEFT JOIN rfx_line rl ON rl.id = ql.matched_line_id`,
  );

  // -------------------------------------------------------------------------
  const results: Record<string, unknown> = {};
  const report: string[] = [];

  let priceHit = 0, priceTotal = 0;
  let recallHit = 0, recallTotal = 0;
  let hallucinated = 0;
  let provenanceOk = 0, provenanceTotal = 0;
  let nullHonest = 0, nullTotal = 0;
  const buckets: Record<string, { correct: number; total: number }> = {
    high: { correct: 0, total: 0 }, medium: { correct: 0, total: 0 }, low: { correct: 0, total: 0 },
  };
  const tierStats: Record<string, { correct: number; total: number }> = {
    exact: { correct: 0, total: 0 }, fuzzy: { correct: 0, total: 0 },
    semantic: { correct: 0, total: 0 }, unmatched: { correct: 0, total: 0 },
  };
  const perVendor: Record<string, { expected: number; found: number; priceOk: number; wrongMatch: number }> = {};

  for (const gq of gt.quotes) {
    const quote = quotes.find((q) => q.vendor_name === gq.vendorName);
    perVendor[gq.vendorKey] = { expected: gq.lines.length, found: 0, priceOk: 0, wrongMatch: 0 };
    if (!quote) {
      recallTotal += gq.lines.length;
      continue;
    }

    // Currency: null-honesty is measured on the field that matters most.
    nullTotal++;
    if (gq.currency === null ? quote.currency === null : quote.currency === gq.currency) nullHonest++;

    const mine = lines.filter((l) => l.quote_id === quote.id);
    perVendor[gq.vendorKey].found = mine.length;

    const gtCodes = new Set(gq.lines.map((l) => l.rfxCode));

    // A line the extractor produced for an RFx line the vendor never quoted is
    // a hallucination — the strictest definition, and the one that matters.
    for (const l of mine) {
      if (l.code && !gtCodes.has(l.code)) hallucinated++;
    }

    for (const gl of gq.lines) {
      recallTotal++;
      // Illegible photo rows: not extracting them is correct behaviour.
      const expectedIllegible = gq.expectedIllegible.includes(gl.rfxCode);

      const got = mine.find((l) => l.code === gl.rfxCode);
      if (!got) {
        if (expectedIllegible) recallHit++; // correctly declined
        continue;
      }
      recallHit++;
      perVendor[gq.vendorKey].priceOk += 0;

      // --- price accuracy, on the raw parsed value ---
      priceTotal++;
      const priceCorrect =
        got.parsed_price !== null && Math.abs(got.parsed_price - gl.price) < 0.011;
      if (priceCorrect) {
        priceHit++;
        perVendor[gq.vendorKey].priceOk++;
      }

      // --- calibration ---
      const bucket = buckets[got.extraction_confidence];
      if (bucket) {
        bucket.total++;
        if (priceCorrect) bucket.correct++;
      }

      // --- provenance: did the extractor cite a snippet at all, and does the
      //     price it claims actually occur in that snippet? ---
      provenanceTotal++;
      const ref = j.parse<{ snippet?: string }>(got.source_ref_json, {});
      const snippet = (ref.snippet ?? '').replace(/[\s,]/g, '');
      const priceStr = gl.price.toFixed(2).replace(/[\s,]/g, '');
      if (snippet.length > 0 && (snippet.includes(priceStr) || snippet.includes(String(gl.price)))) {
        provenanceOk++;
      }

      // --- normalisation: did it refuse to convert what it should refuse? ---
      if (gl.expectedNormalizedInr === null) {
        nullTotal++;
        if (got.normalized_price === null && got.blocked === 1) nullHonest++;
      } else if (got.blocked === 0 && got.normalized_price !== null) {
        nullTotal++;
        if (Math.abs(got.normalized_price - gl.expectedNormalizedInr) < 0.6) nullHonest++;
      }
    }

    // --- matching accuracy by tier ---
    for (const l of mine) {
      const t = tierStats[l.match_tier];
      if (!t) continue;
      t.total++;
      // Correct when the matched code is one this vendor actually quoted, and
      // the description plausibly belongs to it.
      if (l.code && gtCodes.has(l.code)) {
        const gl = gq.lines.find((x) => x.rfxCode === l.code);
        if (gl && Math.abs((l.parsed_price ?? -1) - gl.price) < 0.011) t.correct++;
        else perVendor[gq.vendorKey].wrongMatch++;
      } else if (l.match_tier === 'unmatched') {
        t.correct++; // an honest non-match is the correct outcome, not an error
      }
    }
  }

  // -------------------------------------------------------------------------
  // Calibration: what proportion of all errors did the system flag?
  const totalErrors =
    buckets.high.total - buckets.high.correct +
    (buckets.medium.total - buckets.medium.correct) +
    (buckets.low.total - buckets.low.correct);
  const flaggedErrors =
    buckets.medium.total - buckets.medium.correct + (buckets.low.total - buckets.low.correct);

  // -------------------------------------------------------------------------
  // Deterministic security assertions — no model needed, run every time.
  const security: { name: string; pass: boolean; detail: string }[] = [];

  const payloads = ["=cmd|' /C calc'!A0", '+HYPERLINK("x")', '@SUM(1)', '-1+1'];
  security.push({
    name: 'CSV formula injection neutralised',
    pass: payloads.every((p) => sanitizeCell(p).startsWith("'")),
    detail: `${payloads.length} payloads prefixed`,
  });

  const boxConv = convertUom(500, 'per box', 'piece');
  security.push({
    name: '"per box" is refused, not guessed',
    pass: boxConv.value === null && boxConv.review !== null,
    detail: boxConv.note,
  });

  const noCcy = convertCurrency(100, null, 'INR');
  security.push({
    name: 'Missing currency is refused, not assumed INR',
    pass: noCcy.value === null && noCcy.review !== null,
    detail: noCcy.note,
  });

  const mt = convertUom(46500, 'per MT', 'kg');
  security.push({
    name: 'Declared factor still converts (per MT to per kg)',
    pass: mt.value === 46.5,
    detail: mt.note,
  });

  // Nothing that reached the comparison may be missing provenance.
  const noProv = lines.filter((l) => l.blocked === 0 && !j.parse<{ snippet?: string }>(l.source_ref_json, {}).snippet);
  security.push({
    name: 'Every comparable line carries a source snippet',
    pass: noProv.length === 0,
    detail: `${noProv.length} line(s) without provenance`,
  });

  // -------------------------------------------------------------------------
  results.extraction = {
    fieldAccuracy: pct(priceHit, priceTotal),
    recall: pct(recallHit, recallTotal),
    hallucinationRate: pct(hallucinated, Math.max(1, lines.length)),
    provenanceIntegrity: pct(provenanceOk, provenanceTotal),
    nullHonesty: pct(nullHonest, nullTotal),
  };
  results.calibration = {
    buckets: Object.fromEntries(
      Object.entries(buckets).map(([k, v]) => [k, { ...v, accuracy: pct(v.correct, v.total) }]),
    ),
    proportionOfErrorsFlagged: totalErrors === 0 ? 1 : flaggedErrors / totalErrors,
  };
  results.matching = Object.fromEntries(
    Object.entries(tierStats).map(([k, v]) => [k, { ...v, accuracy: pct(v.correct, v.total) }]),
  );
  results.perVendor = perVendor;
  results.security = security;

  if (JSON_OUT) {
    console.log(JSON.stringify(results, null, 2));
    process.exit(security.every((s) => s.pass) ? 0 : 1);
  }

  // -------------------------------------------------------------------------
  const e = results.extraction as Record<string, number>;
  report.push(`\n  Clearline evaluation — ${dbLocation()}\n`);
  report.push('  EXTRACTION');
  report.push(row('Field accuracy (price, exact)', e.fieldAccuracy, TARGETS.fieldAccuracy));
  report.push(row('Coverage / recall', e.recall, TARGETS.recall));
  report.push(row('Hallucination rate', e.hallucinationRate, TARGETS.hallucination, false));
  report.push(row('Provenance integrity', e.provenanceIntegrity, TARGETS.provenance));
  report.push(row('Null-honesty', e.nullHonesty, TARGETS.nullHonesty));

  report.push('\n  CALIBRATION  (the metric that actually matters)');
  for (const [k, v] of Object.entries(buckets)) {
    const acc = pct(v.correct, v.total);
    const target = k === 'high' ? TARGETS.highBucketAccuracy : null;
    report.push(
      `    ${k.padEnd(30)} ${fmt(acc).padStart(7)}  (${v.correct}/${v.total})${target ? `  target ${fmt(target)}  ${verdict(acc, target)}` : ''}`,
    );
  }
  const flagged = (results.calibration as { proportionOfErrorsFlagged: number }).proportionOfErrorsFlagged;
  report.push(row('Errors correctly flagged medium/low', flagged, TARGETS.errorsFlagged));

  report.push('\n  LINE MATCHING BY TIER');
  for (const [k, v] of Object.entries(tierStats)) {
    if (v.total === 0) continue;
    report.push(`    ${k.padEnd(30)} ${fmt(pct(v.correct, v.total)).padStart(7)}  (${v.correct}/${v.total})`);
  }

  report.push('\n  PER VENDOR');
  for (const [k, v] of Object.entries(perVendor)) {
    report.push(
      `    ${k.padEnd(30)} extracted ${String(v.found).padStart(2)} of ${String(v.expected).padStart(2)} quoted · ${v.priceOk} prices exact${v.wrongMatch ? ` · ${v.wrongMatch} wrong match` : ''}`,
    );
  }

  report.push('\n  SECURITY ASSERTIONS  (deterministic, no model call)');
  for (const s of security) {
    report.push(`    ${s.pass ? 'PASS' : 'FAIL'}  ${s.name.padEnd(46)} ${s.detail}`);
  }

  console.log(report.join('\n') + '\n');

  const failed = !security.every((s) => s.pass);
  process.exit(failed ? 1 : 0);
}

function row(label: string, actual: number, target: number, higherIsBetter = true): string {
  return `    ${label.padEnd(30)} ${fmt(actual).padStart(7)}  target ${higherIsBetter ? '>=' : '<='} ${fmt(target).padStart(6)}  ${verdict(actual, target, higherIsBetter)}`;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
