import './load-env';
import { all, run, ready } from '../src/lib/db/client';
import { deleteRfxDeep, deleteDocumentDeep } from '../src/lib/db/cascade';

const R = 'rfx_cascade_test';
const V = 'ven_cascade_test';
const D = 'doc_cascade_test';
const Q = 'q_cascade_test';

async function count(table: string, where: string, args: unknown[]): Promise<number> {
  const r = await all<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`, args as never[]);
  return r[0].n;
}

async function main() {
  await ready();
  const now = new Date().toISOString();

  // Idempotent: a previous failed run must not block this one.
  await deleteRfxDeep(R);
  await run('DELETE FROM audit_log WHERE rfx_id = ?', [R]);
  await run('DELETE FROM vendor WHERE id = ?', [V]);

  // Build a complete RFx: every table the cascade has to reach.
  await run(`INSERT INTO rfx (id, org_id, title, category, base_currency, status, created_at)
             VALUES (?,?,?,?,?,?,?)`, [R, 'org_demo', 'Cascade test', 'Test', 'INR', 'draft', now]);
  await run(`INSERT INTO rfx_line (id, rfx_id, line_no, code, description, spec_json, canonical_uom, annual_qty)
             VALUES (?,?,?,?,?,?,?,?)`, ['rl_ct', R, 1, 'L01', 'Test line', '{}', 'piece', 10]);
  await run(`INSERT INTO questionnaire_question (id, rfx_id, q_no, question, answer_type, gate_json)
             VALUES (?,?,?,?,?,NULL)`, ['qq_ct', R, 1, 'Test question?', 'text']);
  await run(`INSERT INTO vendor (id, org_id, name, country, email, currency_hint) VALUES (?,?,?,?,?,NULL)`,
    [V, 'org_demo', 'Cascade Test Vendor', 'IN', 'x@example.invalid']);
  await run(`INSERT INTO vendor_document (id, rfx_id, vendor_id, filename, mime, bytes, sha256, content, received_at)
             VALUES (?,?,?,?,?,?,?,?,?)`, [D, R, V, 'x.txt', 'text/plain', 1, 'hash', 'eA==', now]);
  await run(`INSERT INTO extraction_job (id, rfx_id, doc_id, idempotency_key, status, created_at)
             VALUES (?,?,?,?,?,?)`, ['job_ct', R, D, 'idem_cascade_test', 'succeeded', now]);
  await run(`INSERT INTO quote (id, rfx_id, vendor_id, doc_id, currency, model_version, extracted_at)
             VALUES (?,?,?,?,?,?,?)`, [Q, R, V, D, 'INR', 'test/test/test', now]);
  await run(`INSERT INTO quote_line (id, quote_id, rfx_id, vendor_id, raw_description, raw_price,
                                     source_ref_json, extraction_confidence, blocked)
             VALUES (?,?,?,?,?,?,?,?,0)`,
    ['ql_ct', Q, R, V, 'Test', '1.00', '{}', 'high']);
  await run(`INSERT INTO questionnaire_answer (id, quote_id, rfx_id, vendor_id, question_text, confidence)
             VALUES (?,?,?,?,?,?)`, ['qa_ct', Q, R, V, 'Test question?', 'high']);
  await run(`INSERT INTO review_item (id, rfx_id, quote_id, kind, detail, status, created_at)
             VALUES (?,?,?,?,?,?,?)`, ['ri_ct', R, Q, 'test', 'test', 'open', now]);
  await run(`INSERT INTO audit_log (id, rfx_id, actor, action, entity, entity_id, before_json, after_json, at)
             VALUES (?,?,?,?,?,?,NULL,NULL,?)`, ['au_ct', R, 'test', 'rfx.created', 'rfx', R, now]);

  const auditBefore = await count('audit_log', 'rfx_id = ?', [R]);
  console.log(`  seeded a full RFx (${auditBefore} audit row)`);

  // --- document-level cascade, on its own ------------------------------
  await deleteDocumentDeep(D);
  const afterDoc = {
    doc: await count('vendor_document', 'id = ?', [D]),
    job: await count('extraction_job', 'doc_id = ?', [D]),
    quote: await count('quote', 'doc_id = ?', [D]),
    line: await count('quote_line', 'quote_id = ?', [Q]),
    answer: await count('questionnaire_answer', 'quote_id = ?', [Q]),
    review: await count('review_item', 'quote_id = ?', [Q]),
  };
  const docClean = Object.values(afterDoc).every((n) => n === 0);
  console.log(`  ${docClean ? 'PASS' : 'FAIL'}  deleteDocumentDeep left nothing behind`, docClean ? '' : afterDoc);

  // --- rfx-level cascade ------------------------------------------------
  await deleteRfxDeep(R);
  const afterRfx: Record<string, number> = {
    rfx: await count('rfx', 'id = ?', [R]),
    rfx_line: await count('rfx_line', 'rfx_id = ?', [R]),
    questionnaire_question: await count('questionnaire_question', 'rfx_id = ?', [R]),
    vendor_document: await count('vendor_document', 'rfx_id = ?', [R]),
    extraction_job: await count('extraction_job', 'rfx_id = ?', [R]),
    quote: await count('quote', 'rfx_id = ?', [R]),
    quote_line: await count('quote_line', 'rfx_id = ?', [R]),
    questionnaire_answer: await count('questionnaire_answer', 'rfx_id = ?', [R]),
    review_item: await count('review_item', 'rfx_id = ?', [R]),
    dispatch: await count('dispatch', 'rfx_id = ?', [R]),
    award: await count('award', 'rfx_id = ?', [R]),
    qa_turn: await count('qa_turn', 'rfx_id = ?', [R]),
  };
  const leftovers = Object.entries(afterRfx).filter(([, n]) => n > 0);
  console.log(`  ${leftovers.length === 0 ? 'PASS' : 'FAIL'}  deleteRfxDeep cleared every dependent table`,
    leftovers.length ? leftovers : '');

  // --- the audit trail must survive -------------------------------------
  const auditAfter = await count('audit_log', 'rfx_id = ?', [R]);
  console.log(`  ${auditAfter === auditBefore ? 'PASS' : 'FAIL'}  audit log survives the deletion (${auditAfter} row kept)`);

  // --- the vendor must survive ------------------------------------------
  const vendorAfter = await count('vendor', 'id = ?', [V]);
  console.log(`  ${vendorAfter === 1 ? 'PASS' : 'FAIL'}  supplier record survives the deletion`);

  // clean up the fixtures this test owns
  await run('DELETE FROM audit_log WHERE rfx_id = ?', [R]);
  await run('DELETE FROM vendor WHERE id = ?', [V]);
  console.log('  fixtures removed');
}

main().then(() => process.exit(0));
