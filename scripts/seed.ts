/**
 * Seeds the demo RFx, the five vendors, and their response documents.
 *
 * Deliberately stops short of running extraction — the extraction jobs are
 * kicked off from the UI so the demo can show documents arriving as opaque
 * files and being read live.
 *
 * Run: npm run seed
 */

import fs from 'node:fs';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { run, all, batch, j, ready } from '../src/lib/db/client';
import { sniff, sha256 } from '../src/lib/security/files';
import { FX_RATES, UOM_FACTORS } from '../src/lib/normalize/units';
import { RFX_LINES, QUESTIONS, VENDORS, RFX_META, fixtureName } from './dataset';

const FIXTURES = path.join(process.cwd(), 'data', 'fixtures');
const ORG_ID = 'org_demo';
const RFX_ID = 'rfx_fy26_corrugated';

async function main() {
  await ready();

  const reset = process.argv.includes('--reset');
  if (reset) {
    for (const t of [
      'award', 'qa_turn', 'audit_log', 'review_item', 'questionnaire_answer', 'quote_line',
      'quote', 'extraction_job', 'vendor_document', 'dispatch', 'questionnaire_question',
      'rfx_line', 'rfx', 'vendor', 'org', 'fx_rate', 'uom_factor',
    ]) {
      await run(`DELETE FROM ${t}`);
    }
    console.log('  reset: all tables cleared');
  }

  const existing = await all('SELECT id FROM rfx WHERE id = ?', [RFX_ID]);
  if (existing.length > 0 && !reset) {
    console.log('  RFx already seeded. Re-run with --reset to rebuild.');
    return;
  }

  const now = new Date().toISOString();

  await run('INSERT INTO org (id, name) VALUES (?,?)', [ORG_ID, 'Meridian Consumer Products Ltd']);

  await run(
    `INSERT INTO rfx (id, org_id, title, category, base_currency, delivery_location, incoterm,
       payment_terms, closes_at, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [
      RFX_ID, ORG_ID, RFX_META.title, RFX_META.category, RFX_META.baseCurrency,
      RFX_META.deliveryLocation, RFX_META.incoterm, RFX_META.paymentTerms,
      RFX_META.closesAt, 'responses_in', now,
    ],
  );

  await batch(
    RFX_LINES.map((l, i) => ({
      sql: `INSERT INTO rfx_line (id, rfx_id, line_no, code, description, spec_json, canonical_uom, annual_qty)
            VALUES (?,?,?,?,?,?,?,?)`,
      args: [`rl_${l.code}`, RFX_ID, i + 1, l.code, l.description, j.stringify(l.spec), l.uom, l.annualQty],
    })),
  );

  await batch(
    QUESTIONS.map((q) => ({
      sql: `INSERT INTO questionnaire_question (id, rfx_id, q_no, question, answer_type, gate_json)
            VALUES (?,?,?,?,?,?)`,
      args: [`qq_${q.qNo}`, RFX_ID, q.qNo, q.question, q.answerType, q.gate ? j.stringify(q.gate) : null],
    })),
  );

  await batch(
    FX_RATES.map((r) => ({
      sql: 'INSERT INTO fx_rate (id, from_ccy, to_ccy, rate, source, as_of) VALUES (?,?,?,?,?,?)',
      args: [`fx_${r.from}_${r.to}`, r.from, r.to, r.rate, r.source, r.asOf],
    })),
  );

  await batch(
    UOM_FACTORS.map((f) => ({
      sql: 'INSERT INTO uom_factor (id, from_uom, to_uom, factor, note) VALUES (?,?,?,?,?)',
      args: [`uf_${f.from}_${f.to}`, f.from, f.to, f.factor, f.note],
    })),
  );

  let docs = 0;
  for (const v of VENDORS) {
    const vendorId = `v_${v.key}`;
    await run(
      'INSERT INTO vendor (id, org_id, name, country, email, currency_hint) VALUES (?,?,?,?,?,?)',
      [vendorId, ORG_ID, v.name, v.country, v.email, v.currencyHint],
    );

    // SMTP is stubbed, as the brief permits. The dispatch row records exactly
    // what would have gone out, so the audit trail is complete either way.
    await run(
      `INSERT INTO dispatch (id, rfx_id, vendor_id, channel, subject, body, sent_at, transport)
       VALUES (?,?,?,?,?,?,?, 'stub')`,
      [
        `dp_${nanoid(10)}`, RFX_ID, vendorId, 'email',
        `RFQ: ${RFX_META.title}`,
        `Dear ${v.name},\n\nWe invite your offer against the attached schedule of 30 corrugated packaging items, together with the pre-qualification questionnaire.\n\nResponses close ${RFX_META.closesAt}. Please quote in your own format — a completed template is not required.\n\nMeridian Consumer Products Ltd`,
        now,
      ],
    );

    const file = path.join(FIXTURES, fixtureName(v));
    if (!fs.existsSync(file)) {
      console.log(`  ! missing fixture ${fixtureName(v)} — run npm run fixtures first`);
      continue;
    }
    const buf = fs.readFileSync(file);
    const s = sniff(buf, fixtureName(v));
    if (!s.ok || !s.mime) {
      console.log(`  ! rejected ${fixtureName(v)}: ${s.reason}`);
      continue;
    }

    await run(
      `INSERT INTO vendor_document (id, rfx_id, vendor_id, filename, mime, bytes, sha256, content, received_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        `doc_${v.key}`, RFX_ID, vendorId, fixtureName(v), s.mime, buf.length,
        sha256(buf), buf.toString('base64'), now,
      ],
    );
    docs++;
    console.log(`  ${v.name.padEnd(32)} ${fixtureName(v).padEnd(26)} ${s.mime}`);
  }

  await run(
    `INSERT INTO audit_log (id, rfx_id, actor, action, entity, entity_id, before_json, after_json, at)
     VALUES (?,?,?,?,?,?,NULL,?,?)`,
    [
      `au_${nanoid(10)}`, RFX_ID, 'system', 'rfx.seeded', 'rfx', RFX_ID,
      j.stringify({ lines: RFX_LINES.length, vendors: VENDORS.length, documents: docs }), now,
    ],
  );

  console.log(`\n  seeded: ${RFX_LINES.length} lines · ${QUESTIONS.length} questions · ${VENDORS.length} vendors · ${docs} documents`);
  console.log('  extraction has NOT been run — start it from the app, or: npm run extract');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
