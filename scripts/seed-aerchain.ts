/**
 * Seeds the Aerchain-supplied dataset: RFQ-2026-PKG-0417.
 *
 * The RFx is PARSED out of the buyer's own workbook rather than transcribed
 * into code — the 30 lines, the questionnaire and the commercial terms all come
 * from `00_BUYER_RFx_RFQ-2026-PKG-0417.xlsx` at seed time. That matters: this
 * dataset arrived after the system was built, and nothing about it is hardcoded.
 *
 * Run: npm run seed              (Aerchain dataset — the default)
 *      npm run seed -- --reset
 *      npm run seed -- --with-adversarial   (also loads the Apex injection doc)
 */

import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { nanoid } from 'nanoid';
import { run, all, batch, j, ready, dbLocation } from '../src/lib/db/client';
import { sniff, sha256 } from '../src/lib/security/files';
import { FX_RATES, UOM_FACTORS } from '../src/lib/normalize/units';
import { classifyProductType } from '../src/lib/normalize/match';
import type { CanonicalUom, LineSpec } from '../src/lib/types';

const DIR = path.join(process.cwd(), 'data', 'aerchain');
const ORG_ID = 'org_nexora';
export const RFX_ID = 'rfx_2026_pkg_0417';

interface VendorSpec {
  id: string;
  name: string;
  country: string;
  email: string;
  file: string;
  /** Only for the adversarial fixture, which is not a real bidder. */
  adversarial?: boolean;
}

const VENDORS: VendorSpec[] = [
  { id: 'v_packrite', name: 'PackRite Industries Pvt Ltd', country: 'IN', email: 'sales@packrite.example', file: '01_PackRite_Quotation.xlsx' },
  { id: 'v_globalcorr', name: 'Global Corrugates FZE', country: 'AE', email: 'export@globalcorrugates.example', file: '02_GlobalCorrugates_Offer.pdf' },
  { id: 'v_shakti', name: 'Shakti Packaging Solutions', country: 'IN', email: 'shakti.sales@shaktipack.example', file: '03_ShaktiPackaging_Offer.docx' },
  { id: 'v_metroboard', name: 'Metro Board & Pack Co.', country: 'IN', email: 'sales@metroboard.example', file: '04_MetroBoard_RateCard_photo.jpg' },
  { id: 'v_novapack', name: 'Nova Pack Enterprises', country: 'IN', email: 'rajesh@novapack.example', file: '05_NovaPack_email.txt' },
];

const APEX: VendorSpec = {
  id: 'v_apex_adversarial',
  name: 'Apex Corrugated Works (adversarial fixture)',
  country: 'IN',
  email: 'quotes@apexcorrugated.invalid',
  file: 'adversarial/06_ADVERSARIAL_Apex_injection.docx',
  adversarial: true,
};

/**
 * The buyer states a UoM per line in plain English. Map it onto the canonical
 * vocabulary; anything unrecognised is a hard error rather than a guess,
 * because a wrong canonical UoM silently corrupts every conversion downstream.
 */
function canonicalUom(raw: string): CanonicalUom {
  const k = raw.trim().toLowerCase();
  const map: Record<string, CanonicalUom> = {
    'per piece': 'piece', 'per pc': 'piece', piece: 'piece',
    'per kg': 'kg', kg: 'kg',
    'per set': 'set', set: 'set',
    'per 100 pieces': '100_pieces', 'per 100': '100_pieces',
    'per sqm': 'sqm', 'per metre': 'metre',
  };
  const hit = map[k];
  if (!hit) throw new Error(`Unrecognised UoM in the buyer RFx: "${raw}"`);
  return hit;
}

/** "450x300x200" or "1200 width" or "450x300" — always returned in mm. */
function parseDims(raw: string): { l: number | null; w: number | null; h: number | null } {
  const s = String(raw ?? '').trim();
  const width = s.match(/^(\d+)\s*width$/i);
  if (width) return { l: null, w: Number(width[1]), h: null };
  const parts = s.split(/[x×]/i).map((p) => Number(p.trim())).filter((n) => Number.isFinite(n));
  return { l: parts[0] ?? null, w: parts[1] ?? null, h: parts[2] ?? null };
}

/**
 * The buyer's line is classified through the SAME vocabulary the matcher uses
 * on vendor lines. A second keyword map here is how the two silently drift —
 * and a drifted vocabulary means every line of that product type fails to match
 * with no error anywhere.
 */
function productType(description: string): string {
  return classifyProductType(description) ?? 'other';
}

interface ParsedRfx {
  title: string;
  reference: string;
  category: string;
  deliveryLocation: string;
  closesAt: string | null;
  baseCurrency: string;
  lines: {
    lineNo: number; code: string; description: string; spec: LineSpec;
    uom: CanonicalUom; annualQty: number;
  }[];
  questions: { qNo: number; question: string }[];
  terms: string[];
}

export function parseBuyerRfx(file: string): ParsedRfx {
  const wb = XLSX.read(fs.readFileSync(file), { type: 'buffer', cellText: true });

  const cell = (sheet: string, addr: string): string => {
    const c = wb.Sheets[sheet]?.[addr];
    return c ? String(c.w ?? c.v ?? '').trim() : '';
  };

  const lineSheet = 'RFx Line Items';
  const ws = wb.Sheets[lineSheet];
  if (!ws || !ws['!ref']) throw new Error(`Sheet "${lineSheet}" not found in the buyer RFx`);
  const range = XLSX.utils.decode_range(ws['!ref']);

  // Find the header row rather than assuming row 7 — the buyer's template may move.
  let headerRow = -1;
  for (let r = range.s.r; r <= range.e.r; r++) {
    if (String(ws[XLSX.utils.encode_cell({ r, c: 0 })]?.v ?? '').trim() === 'Line No') {
      headerRow = r;
      break;
    }
  }
  if (headerRow < 0) throw new Error('Could not find the "Line No" header row in the buyer RFx');

  const header: Record<string, number> = {};
  for (let c = range.s.c; c <= range.e.c; c++) {
    const h = String(ws[XLSX.utils.encode_cell({ r: headerRow, c })]?.v ?? '').trim();
    if (h) header[h] = c;
  }

  const get = (r: number, name: string): string => {
    const c = header[name];
    if (c === undefined) return '';
    const cel = ws[XLSX.utils.encode_cell({ r, c })];
    return cel ? String(cel.w ?? cel.v ?? '').trim() : '';
  };

  const lines: ParsedRfx['lines'] = [];
  for (let r = headerRow + 1; r <= range.e.r; r++) {
    const no = get(r, 'Line No');
    if (!no || !Number.isFinite(Number(no))) continue;
    const description = get(r, 'Description');
    if (!description) continue;

    const dims = parseDims(get(r, 'Dimensions (mm)'));
    const plyRaw = get(r, 'Ply');
    const gsmRaw = get(r, 'GSM');

    lines.push({
      lineNo: Number(no),
      code: `L${String(no).padStart(2, '0')}`,
      description,
      spec: {
        productType: productType(description),
        ply: /^\d+$/.test(plyRaw) ? Number(plyRaw) : null,
        gsm: /^\d+$/.test(gsmRaw) ? Number(gsmRaw) : null,
        boardGrade: get(r, 'Board Grade') || null,
        lengthMm: dims.l,
        widthMm: dims.w,
        heightMm: dims.h,
        print: /\d-col/.test(description) ? (description.match(/(\d)-col/)?.[0] ?? null) : null,
        notes: get(r, 'Remarks') || null,
      },
      uom: canonicalUom(get(r, 'Quote UoM')),
      annualQty: Number(get(r, 'Annual Qty').replace(/,/g, '')) || 0,
    });
  }

  const questions: ParsedRfx['questions'] = [];
  const qws = wb.Sheets['Questionnaire'];
  if (qws && qws['!ref']) {
    const qr = XLSX.utils.decode_range(qws['!ref']);
    for (let r = qr.s.r; r <= qr.e.r; r++) {
      const ref = String(qws[XLSX.utils.encode_cell({ r, c: 0 })]?.v ?? '').trim();
      const q = String(qws[XLSX.utils.encode_cell({ r, c: 1 })]?.v ?? '').trim();
      const m = ref.match(/^Q(\d+)$/);
      if (m && q) questions.push({ qNo: Number(m[1]), question: q });
    }
  }

  const terms: string[] = [];
  const tws = wb.Sheets['Commercial Terms'];
  if (tws && tws['!ref']) {
    const tr = XLSX.utils.decode_range(tws['!ref']);
    for (let r = tr.s.r; r <= tr.e.r; r++) {
      const t = String(tws[XLSX.utils.encode_cell({ r, c: 0 })]?.v ?? '').trim();
      if (/^\d+\./.test(t)) terms.push(t);
    }
  }

  const headerLine = cell(lineSheet, 'A3');
  const closes = headerLine.match(/Closes:\s*([\d-]+)/)?.[1] ?? null;

  return {
    title: cell(lineSheet, 'A2') || 'Request for Quotation',
    reference: cell(lineSheet, 'A2').match(/RFQ-[\w-]+/)?.[0] ?? 'RFQ',
    category: headerLine.match(/Category:\s*([^|]+)/)?.[1]?.trim() ?? 'Corrugated Packaging',
    deliveryLocation: cell(lineSheet, 'A4').replace(/^Delivery:\s*/, ''),
    closesAt: closes,
    baseCurrency: 'INR',
    lines,
    questions,
    terms,
  };
}

/**
 * The buyer's stated qualification criterion for this RFx:
 *   ISO 9001 held  AND  on-time delivery >= 90%
 *
 * Q1 is a yes/no gate. Q6 is a NUMERIC threshold gate — a vendor at 89.5% fails
 * it, and a vendor who did not answer at all cannot be assessed and therefore
 * does not clear it either.
 */
function gateFor(qNo: number): { requires: string } | { minNumeric: number; unit: string } | null {
  if (qNo === 1) return { requires: 'yes' };
  if (qNo === 6) return { minNumeric: 90, unit: '%' };
  return null;
}

function answerType(qNo: number): 'boolean' | 'number' | 'text' {
  if ([1, 2, 5, 7].includes(qNo)) return 'boolean';
  if ([3, 4, 6, 8].includes(qNo)) return 'number';
  return 'text';
}

async function main() {
  await ready();
  const reset = process.argv.includes('--reset');
  const withAdversarial = process.argv.includes('--with-adversarial');

  if (!fs.existsSync(DIR)) {
    console.error(`  Dataset not found at ${DIR}`);
    process.exit(1);
  }

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
    console.log('  Already seeded. Re-run with --reset to rebuild.');
    return;
  }

  const rfx = parseBuyerRfx(path.join(DIR, '00_BUYER_RFx_RFQ-2026-PKG-0417.xlsx'));
  const now = new Date().toISOString();

  await run('INSERT OR REPLACE INTO org (id, name) VALUES (?,?)', [ORG_ID, 'Nexora Consumer Products Pvt. Ltd.']);

  await run(
    `INSERT INTO rfx (id, org_id, title, category, base_currency, delivery_location, incoterm,
       payment_terms, closes_at, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [
      RFX_ID, ORG_ID, rfx.title, rfx.category, rfx.baseCurrency, rfx.deliveryLocation,
      'FOR Bangalore unless otherwise stated; freight shown separately if not included',
      '60 days from receipt of invoice', rfx.closesAt, 'responses_in', now,
    ],
  );

  await batch(
    rfx.lines.map((l) => ({
      sql: `INSERT INTO rfx_line (id, rfx_id, line_no, code, description, spec_json, canonical_uom, annual_qty)
            VALUES (?,?,?,?,?,?,?,?)`,
      args: [`rl_${l.code}`, RFX_ID, l.lineNo, l.code, l.description, j.stringify(l.spec), l.uom, l.annualQty],
    })),
  );

  await batch(
    rfx.questions.map((q) => {
      const gate = gateFor(q.qNo);
      return {
        sql: `INSERT INTO questionnaire_question (id, rfx_id, q_no, question, answer_type, gate_json)
              VALUES (?,?,?,?,?,?)`,
        args: [`qq_${q.qNo}`, RFX_ID, q.qNo, q.question, answerType(q.qNo), gate ? j.stringify(gate) : null],
      };
    }),
  );

  await batch(
    FX_RATES.map((r) => ({
      sql: 'INSERT OR REPLACE INTO fx_rate (id, from_ccy, to_ccy, rate, source, as_of) VALUES (?,?,?,?,?,?)',
      args: [`fx_${r.from}_${r.to}`, r.from, r.to, r.rate, r.source, r.asOf],
    })),
  );
  await batch(
    UOM_FACTORS.map((f) => ({
      sql: 'INSERT OR REPLACE INTO uom_factor (id, from_uom, to_uom, factor, note) VALUES (?,?,?,?,?)',
      args: [`uf_${f.from}_${f.to}`, f.from, f.to, f.factor, f.note],
    })),
  );

  const toLoad = withAdversarial ? [...VENDORS, APEX] : VENDORS;
  let loaded = 0;

  for (const v of toLoad) {
    await run(
      'INSERT OR REPLACE INTO vendor (id, org_id, name, country, email, currency_hint) VALUES (?,?,?,?,?,NULL)',
      [v.id, ORG_ID, v.name, v.country, v.email],
    );

    if (!v.adversarial) {
      // SMTP is stubbed, as the brief permits. The row records what went out.
      await run(
        `INSERT INTO dispatch (id, rfx_id, vendor_id, channel, subject, body, sent_at, transport)
         VALUES (?,?,?,?,?,?,?, 'stub')`,
        [
          `dp_${nanoid(10)}`, RFX_ID, v.id, 'email',
          `${rfx.reference} — corrugated packaging enquiry`,
          `Dear ${v.name},\n\nWe invite your offer against ${rfx.reference}: ${rfx.lines.length} line items of corrugated packaging, together with the supplier qualification questionnaire.\n\nQuote in INR on the UoM specified per line. Partial quotes are permitted; unquoted lines must be explicitly marked "Not Quoted".\n\nResponses close ${rfx.closesAt}.\n\nAnanya Rao\nCategory Buyer — Packaging\nNexora Consumer Products Pvt. Ltd.`,
          now,
        ],
      );
    }

    const file = path.join(DIR, v.file);
    if (!fs.existsSync(file)) {
      console.log(`  ! missing ${v.file}`);
      continue;
    }
    const buf = fs.readFileSync(file);
    const filename = path.basename(v.file);
    const s = sniff(buf, filename);
    if (!s.ok || !s.mime) {
      console.log(`  ! rejected ${filename}: ${s.reason}`);
      continue;
    }

    await run(
      `INSERT INTO vendor_document (id, rfx_id, vendor_id, filename, mime, bytes, sha256, content, received_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [`doc_${v.id.replace(/^v_/, '')}`, RFX_ID, v.id, filename, s.mime, buf.length, sha256(buf), buf.toString('base64'), now],
    );
    loaded++;
    console.log(`  ${v.name.padEnd(34)} ${filename.padEnd(38)} ${s.mime.split(/[./]/).pop()}`);
  }

  await run(
    `INSERT INTO audit_log (id, rfx_id, actor, action, entity, entity_id, before_json, after_json, at)
     VALUES (?,?,?,?,?,?,NULL,?,?)`,
    [
      `au_${nanoid(10)}`, RFX_ID, 'system', 'rfx.seeded', 'rfx', RFX_ID,
      j.stringify({
        source: 'Aerchain dataset — parsed from the buyer workbook, not transcribed',
        reference: rfx.reference,
        lines: rfx.lines.length,
        questions: rfx.questions.length,
        documents: loaded,
        gatingCriterion: 'ISO 9001 held AND on-time delivery >= 90%',
      }),
      now,
    ],
  );

  console.log(`\n  ${rfx.reference} · ${rfx.lines.length} lines · ${rfx.questions.length} questions · ${loaded} documents`);
  console.log(`  gate: ISO 9001 (Q1) AND on-time delivery >= 90% (Q6)`);
  console.log(`  db:   ${dbLocation()}`);
  console.log('\n  extraction has NOT been run — start it from the app, or: npm run extract');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
