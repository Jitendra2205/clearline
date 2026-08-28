/**
 * Integration test for the normalisation pipeline.
 *
 * NOT a demo path and NOT a substitute for extraction. It feeds hand-written
 * Extraction objects — the shape the model returns — straight into
 * normalizeExtraction, so the conversion, matching, blocking and review-queue
 * logic can be asserted without a model call. The model half is scored
 * separately by `npm run eval` against the golden dataset.
 *
 * Run: npm run test:pipeline
 */

import { all, run, ready, j } from '../src/lib/db/client';
import { normalizeExtraction } from '../src/lib/normalize/pipeline';
import type { Extraction } from '../src/lib/ai/schemas';
import { RFX_LINES, QUESTIONS, RFX_META } from './dataset';

const RFX_ID = 'rfx_pipeline_test';
const VENDOR_A = 'v_test_a';
const VENDOR_B = 'v_test_b';

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail = '') {
  if (condition) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const ref = (snippet: string) => ({ page: 1, locator: 'test', snippet });

function line(over: Partial<Extraction['lines'][number]> & { raw_description: string; raw_price: string }) {
  return {
    raw_uom: 'per pc',
    raw_qty: null,
    parsed_price: Number(over.raw_price.replace(/[^\d.]/g, '')),
    parsed_uom: 'piece',
    source_ref: ref(`${over.raw_description} ${over.raw_price}`),
    extraction_confidence: 'high' as const,
    ambiguity_flags: [] as string[],
    ...over,
  };
}

/** Children first, then the RFx itself, which is keyed on `id` not `rfx_id`. */
async function cleanup() {
  for (const t of [
    'review_item', 'questionnaire_answer', 'quote_line', 'quote',
    'rfx_line', 'questionnaire_question', 'vendor_document', 'audit_log',
  ]) {
    await run(`DELETE FROM ${t} WHERE rfx_id = ?`, [RFX_ID]);
  }
  await run('DELETE FROM rfx WHERE id = ?', [RFX_ID]);
  await run('DELETE FROM vendor WHERE id IN (?,?)', [VENDOR_A, VENDOR_B]);
}

async function setup() {
  await ready();
  await cleanup();

  await run(
    `INSERT INTO rfx (id, org_id, title, category, base_currency, status, created_at)
     VALUES (?,?,?,?,?, 'test', ?)`,
    [RFX_ID, 'org_test', 'Pipeline test', RFX_META.category, 'INR', new Date().toISOString()],
  );
  for (const [i, l] of RFX_LINES.entries()) {
    await run(
      `INSERT INTO rfx_line (id, rfx_id, line_no, code, description, spec_json, canonical_uom, annual_qty)
       VALUES (?,?,?,?,?,?,?,?)`,
      [`tl_${l.code}`, RFX_ID, i + 1, l.code, l.description, j.stringify(l.spec), l.uom, l.annualQty],
    );
  }
  for (const q of QUESTIONS) {
    await run(
      `INSERT INTO questionnaire_question (id, rfx_id, q_no, question, answer_type, gate_json) VALUES (?,?,?,?,?,?)`,
      [`tq_${q.qNo}`, RFX_ID, q.qNo, q.question, q.answerType, q.gate ? j.stringify(q.gate) : null],
    );
  }
  for (const [id, name] of [[VENDOR_A, 'Test Vendor A'], [VENDOR_B, 'Test Vendor B']]) {
    await run('INSERT INTO vendor (id, org_id, name, country, email, currency_hint) VALUES (?,?,?,?,?,NULL)',
      [id, 'org_test', name, 'IN', `${id}@test.invalid`]);
  }
  for (const [docId, vendorId] of [['doc_test_a', VENDOR_A], ['doc_test_b', VENDOR_B]]) {
    await run(
      `INSERT INTO vendor_document (id, rfx_id, vendor_id, filename, mime, bytes, sha256, content, received_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [docId, RFX_ID, vendorId, `${docId}.xlsx`, 'text/plain', 1, docId, '', new Date().toISOString()],
    );
  }
}

async function main() {
  await setup();

  // ---- Vendor A: the interesting cases, all in INR --------------------------
  const a: Extraction = {
    vendor_name: 'Test Vendor A',
    currency: 'INR',
    incoterm: 'Ex-works',
    validity: '30 days',
    payment_terms: 'Net 45',
    lines: [
      // 1. clean deterministic match, cm dimensions
      line({ raw_description: '3ply RSC CARTON 45 x 30 x 20 cm 140gsm', raw_price: '24.60' }),
      // 2. buyer's own line code present -> tier 1
      line({ raw_description: 'Regular Slotted Container CP-004', raw_price: '38.40' }),
      // 3. per MT where the RFx wants per kg -> declared factor, must convert
      line({
        raw_description: '2ply CORR ROLL 100 cm 120gsm', raw_price: '46500', raw_uom: 'per MT',
        parsed_uom: 'tonne', parsed_price: 46500,
      }),
      // 4. "per box" with no pack size -> matches a line, but must NOT convert
      line({
        raw_description: '3ply DIECUT MAILER 25 x 18 x 6 cm', raw_price: '487.50', raw_uom: 'per box',
        parsed_uom: 'box', parsed_price: 487.5, ambiguity_flags: ['uom_ambiguous'],
      }),
      // 5. low confidence -> must be blocked even though everything else is fine
      line({
        raw_description: '5ply RSC CARTON 50 x 40 x 30 cm', raw_price: '52.90',
        extraction_confidence: 'low', ambiguity_flags: ['price_illegible'],
      }),
      // 6. a snippet that does not appear anywhere (provenance failure path is
      //    exercised separately via provenanceFailures)
      line({ raw_description: '5ply RSC CARTON 60 x 40 x 40 cm 180gsm', raw_price: '68.50' }),
      // 7. nothing in the schedule looks like this -> unmatched, blocked
      line({ raw_description: 'Assorted plastic strapping reel 12mm', raw_price: '910.00' }),
    ],
    questionnaire_answers: [
      {
        question_text: 'Are you ISO 9001:2015 certified? State certificate number and expiry.',
        raw_answer: 'Yes — ISO 9001:2015, cert TEST/1', parsed_answer: 'yes',
        source_ref: ref('Yes — ISO 9001:2015'), confidence: 'high',
      },
      {
        question_text: 'Do you supply burst-strength / ECT test reports with every production lot?',
        raw_answer: 'Yes, with every lot', parsed_answer: 'yes',
        source_ref: ref('Yes, with every lot'), confidence: 'high',
      },
    ],
    commercial_notes: [
      { kind: 'discount', text: '3% settlement discount if paid within 15 days.', percent: 3, applies_to: 'all lines', source_ref: ref('3% settlement discount') },
    ],
    unquoted_note: 'We are not quoting edge protectors.',
    document_observations: null,
  };

  const ra = await normalizeExtraction({
    rfxId: RFX_ID, vendorId: VENDOR_A, docId: 'doc_test_a', extraction: a,
    modelVersion: 'test/v1', provenanceFailures: [], baseCurrency: 'INR', skipSemantic: true,
  });

  const rows = await all<{
    raw_description: string; code: string | null; match_tier: string; normalized_price: number | null;
    blocked: number; normalization_note: string | null;
  }>(
    `SELECT ql.raw_description, rl.code, ql.match_tier, ql.normalized_price, ql.blocked, ql.normalization_note
       FROM quote_line ql LEFT JOIN rfx_line rl ON rl.id = ql.matched_line_id
      WHERE ql.quote_id = ?`,
    [ra.quoteId],
  );
  const find = (frag: string) => rows.find((r) => r.raw_description.includes(frag))!;

  console.log('\n  MATCHING AND CONVERSION');
  const cm = find('45 x 30 x 20 cm');
  check('cm dimensions match the mm-specified RFx line', cm?.code === 'CP-003', `got ${cm?.code}`);
  check('deterministic tier used, no model', cm?.match_tier === 'fuzzy', `tier ${cm?.match_tier}`);
  check('price passes through unchanged when units already agree', cm?.normalized_price === 24.6, String(cm?.normalized_price));

  const coded = find('CP-004');
  check('buyer line code in the text wins as tier 1', coded?.match_tier === 'exact' && coded?.code === 'CP-004', `${coded?.match_tier}/${coded?.code}`);

  const roll = find('CORR ROLL');
  check('per-MT converts to per-kg with the declared factor', roll?.normalized_price === 46.5, String(roll?.normalized_price));
  check('the conversion is explained in words', /1 tonne = 1000 kg/.test(roll?.normalization_note ?? ''), roll?.normalization_note ?? '');
  check('converted line is not blocked', roll?.blocked === 0);

  console.log('\n  REFUSALS — the behaviour that matters');
  const box = find('DIECUT MAILER');
  check('the "per box" line does match an RFx line', box?.code === 'CP-008', `got ${box?.code}`);
  check('"per box" is never converted', box?.normalized_price === null, String(box?.normalized_price));
  check('"per box" line is held out of the comparison', box?.blocked === 1);
  check('the refusal is explained in words', /box/i.test(box?.normalization_note ?? ''), box?.normalization_note ?? '');

  const low = find('50 x 40 x 30 cm');
  check('low-confidence line is blocked despite a clean match', low?.blocked === 1);
  check('low-confidence line still matched correctly', low?.code === 'CP-005', `got ${low?.code}`);

  const junk = find('plastic strapping');
  check('out-of-scope line is left unmatched', junk?.code === null && junk?.match_tier === 'unmatched');
  check('unmatched line is blocked', junk?.blocked === 1);

  const reviews = await all<{ kind: string; status: string }>(
    'SELECT kind, status FROM review_item WHERE rfx_id = ?', [RFX_ID],
  );
  const kinds = reviews.map((r) => r.kind);
  console.log('\n  REVIEW QUEUE');
  check('uom_not_convertible raised', kinds.includes('uom_not_convertible'));
  check('low_confidence_extraction raised', kinds.includes('low_confidence_extraction'));
  check('unmatched_line raised', kinds.includes('unmatched_line'));
  check('every review item starts open', reviews.every((r) => r.status === 'open'));

  const quote = await all<{ commercial_notes_json: string; unquoted_note: string | null }>(
    'SELECT commercial_notes_json, unquoted_note FROM quote WHERE id = ?', [ra.quoteId],
  );
  const notes = j.parse<{ autoApplied: boolean; percent: number | null }[]>(quote[0].commercial_notes_json, []);
  check('discount is recorded', notes.length === 1 && notes[0].percent === 3);
  check('discount is NOT auto-applied to any price', notes[0].autoApplied === false);
  check('unquoted note is kept verbatim', (quote[0].unquoted_note ?? '').includes('edge protectors'));

  // ---- Vendor B: currency, and the cross-vendor price-band check ------------
  console.log('\n  CURRENCY AND SANITY BANDS');

  const usd: Extraction = {
    ...a,
    vendor_name: 'Test Vendor B',
    currency: 'USD',
    lines: [
      line({ raw_description: '3ply RSC 450x300x200', raw_price: 'USD 0.29', parsed_price: 0.29 }),
    ],
    questionnaire_answers: [],
    commercial_notes: [],
    unquoted_note: null,
  };
  const rb = await normalizeExtraction({
    rfxId: RFX_ID, vendorId: VENDOR_B, docId: 'doc_test_b', extraction: usd,
    modelVersion: 'test/v1', provenanceFailures: [], baseCurrency: 'INR', skipSemantic: true,
  });
  const bRows = await all<{ normalized_price: number | null; normalization_note: string | null; blocked: number }>(
    'SELECT normalized_price, normalization_note, blocked FROM quote_line WHERE quote_id = ?', [rb.quoteId],
  );
  check('USD converts at full precision, not rounded to paise (0.29 x 83.5 = 24.215)', bRows[0]?.normalized_price === 24.215, String(bRows[0]?.normalized_price));
  check('the original value stays visible in the note', /USD 0\.29 @ 83\.5/.test(bRows[0]?.normalization_note ?? ''), bRows[0]?.normalization_note ?? '');

  // No currency at all -> refuse, never assume the vendor's home currency.
  const noCcy: Extraction = { ...usd, currency: null };
  const rc = await normalizeExtraction({
    rfxId: RFX_ID, vendorId: VENDOR_B, docId: 'doc_test_b', extraction: noCcy,
    modelVersion: 'test/v1', provenanceFailures: [], baseCurrency: 'INR', skipSemantic: true,
  });
  const cRows = await all<{ normalized_price: number | null; blocked: number }>(
    'SELECT normalized_price, blocked FROM quote_line WHERE quote_id = ?', [rc.quoteId],
  );
  check('missing currency is never assumed to be INR', cRows[0]?.normalized_price === null);
  check('missing-currency line is blocked', cRows[0]?.blocked === 1);
  const ccyReviews = await all<{ n: number }>(
    "SELECT COUNT(*) AS n FROM review_item WHERE rfx_id = ? AND kind = 'currency_not_stated'", [RFX_ID],
  );
  check('currency_not_stated review raised', (ccyReviews[0]?.n ?? 0) > 0);

  // ---- re-running an extraction must be idempotent -------------------------
  console.log('\n  IDEMPOTENCY');
  const before = await all<{ n: number }>('SELECT COUNT(*) AS n FROM quote_line WHERE rfx_id = ?', [RFX_ID]);
  await normalizeExtraction({
    rfxId: RFX_ID, vendorId: VENDOR_A, docId: 'doc_test_a', extraction: a,
    modelVersion: 'test/v1', provenanceFailures: [], baseCurrency: 'INR', skipSemantic: true,
  });
  const after = await all<{ n: number }>('SELECT COUNT(*) AS n FROM quote_line WHERE rfx_id = ?', [RFX_ID]);
  check('re-extracting a document replaces rather than duplicates', before[0].n === after[0].n, `${before[0].n} -> ${after[0].n}`);

  await cleanup();

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
