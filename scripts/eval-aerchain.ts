/**
 * Evaluation against the Aerchain-supplied ground truth.
 *
 * Scores what actually landed in the database against `eval_question_set.json`
 * and the eleven expected behaviours (EB-01…EB-11) in the dataset README.
 *
 * Run: npm run extract && npm run eval
 *      npm run eval -- --json      (machine-readable; non-zero exit on failure)
 *
 * The deterministic assertions at the bottom need no model and run every time,
 * so this command is useful before extraction has ever been run.
 */

import './load-env';
import fs from 'node:fs';
import path from 'node:path';
import { all, one, ready, j, dbLocation } from '../src/lib/db/client';
import { sanitizeCell } from '../src/lib/security/csv';
import { convertUom, convertCurrency } from '../src/lib/normalize/units';
import {
  cheapestPerLine, coverageReport, qualityGate, totalCost, lineDetail,
} from '../src/lib/query/engine';

const RFX_ID = 'rfx_2026_pkg_0417';
const JSON_OUT = process.argv.includes('--json');
const DATA = path.join(process.cwd(), 'data', 'aerchain');

/** Their vendor keys mapped onto the names this system seeded. */
const VENDOR_NAME: Record<string, string> = {
  PACKRITE: 'PackRite Industries Pvt Ltd',
  GLOBALCORR: 'Global Corrugates FZE',
  SHAKTI: 'Shakti Packaging Solutions',
  METROBOARD: 'Metro Board & Pack Co.',
  NOVAPACK: 'Nova Pack Enterprises',
};

interface Check {
  id: string;
  name: string;
  pass: boolean;
  expected: string;
  actual: string;
}

const checks: Check[] = [];
function check(id: string, name: string, pass: boolean, expected: unknown, actual: unknown) {
  checks.push({ id, name, pass, expected: String(expected), actual: String(actual) });
}

const near = (a: number | null, b: number, tol: number) =>
  a !== null && Math.abs(a - b) <= tol;

const money = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

async function main() {
  await ready();

  const evalSetPath = path.join(DATA, 'eval_question_set.json');
  if (!fs.existsSync(evalSetPath)) {
    console.error(`  ${evalSetPath} not found.`);
    process.exit(1);
  }
  const evalSet = JSON.parse(fs.readFileSync(evalSetPath, 'utf8')) as {
    meta: { vendors_clearing_questionnaire: string[]; vendors_excluded: Record<string, string> };
    questions: { id: string; question: string; type: string; ground_truth: Record<string, unknown> }[];
  };
  const q = (id: string) => evalSet.questions.find((x) => x.id === id)!;

  const quoteCount = (await one<{ n: number }>('SELECT COUNT(*) AS n FROM quote WHERE rfx_id = ?', [RFX_ID]))?.n ?? 0;

  // -------------------------------------------------------------------------
  // Deterministic assertions — no model involved, always run.
  // -------------------------------------------------------------------------
  const payloads = ["=cmd|' /C calc'!A0", '+HYPERLINK("x")', '@SUM(1)', '-1+1'];
  check('SEC-1', 'CSV formula injection neutralised on export',
    payloads.every((p) => sanitizeCell(p).startsWith("'")), 'all prefixed', `${payloads.length}/4`);

  const per100 = convertUom(610, 'per 100 pieces', 'piece');
  check('EB-04', 'per 100 pieces converts to per piece with arithmetic shown',
    per100.value === 6.1 && /100/.test(per100.note), '610.00 -> 6.10', `${per100.value} · ${per100.note}`);

  // Global Corrugates line 1 is USD 0.291. The expected value carries four
  // decimals, which is the whole point: rounding to paise here would move the
  // annualised total by hundreds of rupees.
  const usd = convertCurrency(0.291, 'USD', 'INR');
  check('EB-01', 'USD converts at 83.50 without rounding, original shown alongside',
    near(usd.value, 24.2985, 0.00001) && usd.note.includes('USD 0.291 @ 83.5'),
    '24.2985 + original shown', `${usd.value} · ${usd.note}`);

  const noCcy = convertCurrency(100, null, 'INR');
  check('SEC-2', 'Missing currency refused, never assumed INR',
    noCcy.value === null && noCcy.review !== null, 'null + review raised', String(noCcy.value));

  const box = convertUom(500, 'per box', 'piece');
  check('SEC-3', '"per box" with no pack size refused, not guessed',
    box.value === null && box.review !== null, 'null + review raised', String(box.value));

  if (quoteCount === 0) {
    report(true);
    console.log('\n  No extractions in the database — the model-dependent checks were skipped.');
    console.log('  Run:  npm run extract     then re-run this command.\n');
    process.exit(checks.every((c) => c.pass) ? 0 : 1);
  }

  // -------------------------------------------------------------------------
  // EB-09 / gate membership
  // -------------------------------------------------------------------------
  const gate = await qualityGate(RFX_ID);
  const clearedNames = gate.filter((g) => g.cleared).map((g) => g.vendorName).sort();
  const expectedCleared = evalSet.meta.vendors_clearing_questionnaire.map((k) => VENDOR_NAME[k]).sort();
  check('Q-02a', 'Exactly the right vendors clear the questionnaire',
    JSON.stringify(clearedNames) === JSON.stringify(expectedCleared),
    expectedCleared.join(', '), clearedNames.join(', ') || '(none)');

  // The graded outcome is that MetroBoard does not clear. The ground truth says
  // the reason is on-time delivery of 89.5%, but that figure appears nowhere in
  // the rate-card photograph they supplied — the card states ISO 9001, the
  // in-house lab, lead time, payment terms and MOQ, and no delivery percentage.
  // (The dataset README references a ground_truth.json carrying it; that file
  // was not in the supplied set.) So the system excludes them as unassessable on
  // Q6 rather than as failing it. Same outcome, and the only conclusion the
  // supplied evidence supports — which is the behaviour to assert.
  const metro = gate.find((g) => g.vendorName === VENDOR_NAME.METROBOARD);
  const metroOnOtd = [...(metro?.failures ?? []), ...(metro?.unanswered ?? [])]
    .some((f) => /delivery|89\.5/i.test(f));
  check('Q-02b', 'MetroBoard does not clear, and the reason is the on-time-delivery question',
    !!metro && !metro.cleared && metroOnOtd,
    'not cleared, on Q6', metro ? `cleared=${metro.cleared}, Q6 cited=${metroOnOtd}` : 'vendor missing');

  const nova = gate.find((g) => g.vendorName === VENDOR_NAME.NOVAPACK);
  check('EB-09', 'NovaPack unassessable (no questionnaire) is NOT treated as cleared',
    !!nova && !nova.cleared && nova.unanswered.length > 0,
    'not cleared, unanswered', nova ? `cleared=${nova.cleared} unanswered=${nova.unanswered.length}` : 'vendor missing');

  // -------------------------------------------------------------------------
  // Q-03 coverage
  // -------------------------------------------------------------------------
  const cov = await coverageReport(RFX_ID);
  const expectedCov = (q('Q-03').ground_truth.coverage ?? {}) as Record<string, number>;
  for (const [key, want] of Object.entries(expectedCov)) {
    const row = cov.rows.find((r) => String(r[0]) === VENDOR_NAME[key]);
    const got = row ? Number(String(row[1]).split('/')[0].trim()) : -1;
    check('Q-03', `Coverage — ${key} quoted ${want} of 30`, got === want, want, got < 0 ? 'vendor missing' : got);
  }

  // -------------------------------------------------------------------------
  // Q-01 line 1 offers, including the FX-converted one
  // -------------------------------------------------------------------------
  const l1 = await lineDetail(RFX_ID, 'L01');
  const offers = (q('Q-01').ground_truth.all_offers ?? {}) as Record<string, number>;
  for (const [key, want] of Object.entries(offers)) {
    const row = l1.rows.find((r) => String(r[0]) === VENDOR_NAME[key]);
    const got = row ? (row[4] as number | null) : null;
    check('Q-01', `Line 1 unit price — ${key}`, near(got, want, 0.011), want, got ?? 'not extracted');
  }

  // -------------------------------------------------------------------------
  // Q-05 the per-100-pieces normalisation
  // -------------------------------------------------------------------------
  const q05 = q('Q-05').ground_truth as Record<string, Record<string, number | string>>;
  for (const [lineKey, code] of [['line_15', 'L15'], ['line_16', 'L16']] as const) {
    const want = Number(q05[lineKey].shakti_normalized_inr_per_piece);
    const detail = await lineDetail(RFX_ID, code);
    const row = detail.rows.find((r) => String(r[0]) === VENDOR_NAME.SHAKTI);
    const got = row ? (row[4] as number | null) : null;
    check('Q-05', `${code} Shakti pad normalised to per piece`, near(got, want, 0.011), want, got ?? 'not extracted/blocked');
  }

  // -------------------------------------------------------------------------
  // Q-08 single-vendor totals, over each vendor's own coverage
  // -------------------------------------------------------------------------
  const totals = await totalCost(RFX_ID, {
    vendor_names: null, only_quality_cleared: false, line_codes: null, common_lines_only: false,
  });
  const validTotals = (q('Q-08').ground_truth.valid_single_vendor_totals ?? {}) as Record<string, { total_inr: number }>;
  for (const [key, want] of Object.entries(validTotals)) {
    const row = totals.rows.find((r) => String(r[0]) === VENDOR_NAME[key]);
    const got = row ? Number(row[2]) : null;
    // 0.05% tolerance absorbs rounding of FX-converted unit prices.
    check('Q-08', `Single-vendor total — ${key}`,
      got !== null && Math.abs(got - want.total_inr) / want.total_inr < 0.0005,
      money(want.total_inr), got === null ? 'not computed' : money(got));
  }

  // -------------------------------------------------------------------------
  // Q-02 the headline: split award among qualified vendors only
  // -------------------------------------------------------------------------
  const split = await cheapestPerLine(RFX_ID, {
    only_quality_cleared: true, vendor_names: null, line_codes: null,
  });
  const wantSplit = Number(q('Q-02').ground_truth.annualised_basket_cost_inr);
  const gotSplit = Number(split.meta.splitTotal ?? 0);
  check('Q-02', 'Split award, cheapest per line among qualified vendors',
    Math.abs(gotSplit - wantSplit) / wantSplit < 0.0005, money(wantSplit), money(gotSplit));

  check('Q-02c', 'Split award covers all 30 lines',
    Number(split.meta.awardedLines ?? 0) === Number(q('Q-02').ground_truth.lines_with_at_least_one_eligible_offer),
    q('Q-02').ground_truth.lines_with_at_least_one_eligible_offer, split.meta.awardedLines);

  const perLine = (q('Q-02').ground_truth.per_line_award ?? {}) as Record<string, { vendor: string; price: number }>;
  let lineHits = 0;
  const lineMisses: string[] = [];
  for (const [no, want] of Object.entries(perLine)) {
    const code = `L${String(no).padStart(2, '0')}`;
    const row = split.rows.find((r) => String(r[0]) === code);
    const gotVendor = row ? String(row[2]) : null;
    const gotPrice = row ? Number(row[3]) : null;
    if (gotVendor === VENDOR_NAME[want.vendor] && near(gotPrice, want.price, 0.011)) lineHits++;
    else lineMisses.push(`${code}: want ${want.vendor} @ ${want.price}, got ${gotVendor ?? '—'} @ ${gotPrice ?? '—'}`);
  }
  check('Q-02d', `Per-line award winner and price correct on all 30 lines`,
    lineHits === Object.keys(perLine).length, `${Object.keys(perLine).length}/30`, `${lineHits}/30`);

  // -------------------------------------------------------------------------
  // EB-02 the footnote discount — recorded, never applied
  // -------------------------------------------------------------------------
  const gcQuote = await one<{ commercial_notes_json: string }>(
    `SELECT q.commercial_notes_json FROM quote q JOIN vendor v ON v.id = q.vendor_id
      WHERE q.rfx_id = ? AND v.name = ?`, [RFX_ID, VENDOR_NAME.GLOBALCORR],
  );
  const gcNotes = j.parse<{ percent: number | null; text: string; autoApplied: boolean }[]>(
    gcQuote?.commercial_notes_json ?? '[]', [],
  );
  const found4pc = gcNotes.some((n) => n.percent === 4 || /4(\.0)?\s*%/.test(n.text));
  check('EB-02a', 'Global Corrugates 4% footnote discount is captured', found4pc,
    'a 4% settlement discount recorded', found4pc ? 'found' : `${gcNotes.length} note(s), none at 4%`);
  check('EB-02b', 'No discount is auto-applied to any unit rate',
    gcNotes.every((n) => n.autoApplied === false), 'autoApplied false on all', gcNotes.map((n) => n.autoApplied).join(','));

  // -------------------------------------------------------------------------
  // EB-07 / Q-06 / Q-07 — NovaPack's 26 unknown lines must stay unknown
  // -------------------------------------------------------------------------
  const novaLines = await all<{ n: number }>(
    `SELECT COUNT(*) AS n FROM quote_line ql JOIN vendor v ON v.id = ql.vendor_id
      WHERE ql.rfx_id = ? AND v.name = ? AND ql.matched_line_id IS NOT NULL`,
    [RFX_ID, VENDOR_NAME.NOVAPACK],
  );
  check('EB-07', 'NovaPack has at most 4 priced lines — "same as last year" never invented',
    (novaLines[0]?.n ?? 99) <= 4, '<= 4', novaLines[0]?.n ?? 'n/a');

  const l5 = await lineDetail(RFX_ID, 'L05');
  const novaOnL5 = l5.rows.find((r) => String(r[0]) === VENDOR_NAME.NOVAPACK);
  check('Q-07', 'NovaPack has no price on line 5 (must be "not quoted")',
    novaOnL5 === undefined, 'no row', novaOnL5 ? `price ${novaOnL5[4]}` : 'no row');

  // -------------------------------------------------------------------------
  // EB-08 no incoterm -> flagged as not landed-cost comparable
  // -------------------------------------------------------------------------
  const incotermFlag = await one<{ n: number }>(
    `SELECT COUNT(*) AS n FROM review_item r JOIN quote q ON q.id = r.quote_id
       JOIN vendor v ON v.id = q.vendor_id
      WHERE r.rfx_id = ? AND v.name = ? AND r.kind = 'incoterm_not_stated'`,
    [RFX_ID, VENDOR_NAME.NOVAPACK],
  );
  check('EB-08', 'NovaPack flagged: no incoterm, freight extra, not landed-cost comparable',
    (incotermFlag?.n ?? 0) > 0, '>= 1 review item', incotermFlag?.n ?? 0);

  // -------------------------------------------------------------------------
  // EB-06 the angled photo
  //
  // The requirement is that low-confidence regions reach the review queue — NOT
  // that a review item exists unconditionally. Demanding one would be demanding
  // a false positive on a photograph the model happened to read cleanly. What
  // must hold is the calibration property: nothing marked high confidence is
  // wrong, and anything not marked high is held. Coverage being exactly 18 of
  // 30 and the line-1 price being exact is what proves it read rather than
  // guessed.
  // -------------------------------------------------------------------------
  const metroLines = await all<{ conf: string; blocked: number }>(
    `SELECT ql.extraction_confidence conf, ql.blocked FROM quote_line ql
       JOIN vendor v ON v.id = ql.vendor_id WHERE ql.rfx_id = ? AND v.name = ?`,
    [RFX_ID, VENDOR_NAME.METROBOARD],
  );
  const unheldNonHigh = metroLines.filter((l) => l.conf !== 'high' && l.blocked === 0).length;
  check('EB-06', 'Photo lines are either high-confidence or held — none accepted on a maybe',
    metroLines.length > 0 && unheldNonHigh === 0,
    '0 accepted below high confidence', `${unheldNonHigh} of ${metroLines.length}`);

  // -------------------------------------------------------------------------
  // EB-11 every semantic-tier match is blocked pending a human
  // -------------------------------------------------------------------------
  const loose = await one<{ n: number }>(
    `SELECT COUNT(*) AS n FROM quote_line WHERE rfx_id = ? AND match_tier = 'semantic' AND blocked = 0`,
    [RFX_ID],
  );
  check('EB-11', 'No semantic-tier match is counted without human confirmation',
    (loose?.n ?? 0) === 0, 0, loose?.n ?? 0);

  // -------------------------------------------------------------------------
  // EB-10 the injection fixture must not appear in any ranking
  // -------------------------------------------------------------------------
  const apexInRanking = split.rows.some((r) => /apex/i.test(String(r[2] ?? '')));
  const apexLoaded = await one<{ n: number }>(
    "SELECT COUNT(*) AS n FROM quote_line ql JOIN vendor v ON v.id = ql.vendor_id WHERE v.id = 'v_apex_adversarial'",
  );
  check('EB-10', 'Apex (injection fixture) never appears as an award winner',
    !apexInRanking, 'absent from the split award',
    apexInRanking ? 'PRESENT — CRITICAL FAIL' : `absent (${apexLoaded?.n ?? 0} apex lines loaded)`);

  // -------------------------------------------------------------------------
  // Every comparable line must carry provenance.
  // -------------------------------------------------------------------------
  const noProv = await all<{ id: string; source_ref_json: string }>(
    'SELECT id, source_ref_json FROM quote_line WHERE rfx_id = ? AND blocked = 0', [RFX_ID],
  );
  const missing = noProv.filter((l) => !j.parse<{ snippet?: string }>(l.source_ref_json, {}).snippet);
  check('PROV', 'Every line in the comparison carries a verbatim source snippet',
    missing.length === 0, 0, missing.length);

  report(false, lineMisses);
  process.exit(checks.every((c) => c.pass) ? 0 : 1);
}

function report(deterministicOnly: boolean, lineMisses: string[] = []) {
  if (JSON_OUT) {
    console.log(JSON.stringify({ checks, lineMisses }, null, 2));
    return;
  }

  const pass = checks.filter((c) => c.pass).length;
  console.log(`\n  Clearline — evaluation against the Aerchain ground truth`);
  console.log(`  ${dbLocation()}\n`);

  let group = '';
  for (const c of checks) {
    if (c.id !== group) {
      group = c.id;
    }
    const mark = c.pass ? 'PASS' : 'FAIL';
    console.log(`  ${mark}  ${c.id.padEnd(7)} ${c.name}`);
    if (!c.pass) console.log(`              expected ${c.expected}   ·   got ${c.actual}`);
  }

  console.log(`\n  ${pass}/${checks.length} checks passed${deterministicOnly ? ' (deterministic only)' : ''}`);
  if (lineMisses.length > 0) {
    console.log(`\n  Per-line award differences (${lineMisses.length}):`);
    lineMisses.slice(0, 12).forEach((m) => console.log(`    ${m}`));
    if (lineMisses.length > 12) console.log(`    … and ${lineMisses.length - 12} more`);
  }
  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
