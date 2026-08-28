import { all, j, one } from '../db/client';
import { formatMoney } from '../normalize/units';
import type { SourceRef } from '../types';

/**
 * The analyst query engine.
 *
 * Every number the buyer ever sees is computed here, in SQL and TypeScript,
 * against the normalised tables. The model in Loop 3 chooses *which* of these
 * functions to call and narrates the result — it never does arithmetic.
 *
 * This is the single most important trust decision in the build. A model doing
 * mental maths across 112 quote lines will be subtly wrong, and subtly wrong is
 * the worst possible failure mode when the output is an award recommendation.
 */

export interface QueryResult {
  kind: string;
  /** Human-readable statement of exactly what was included. */
  filtersApplied: string[];
  /** What was left out and why. Rendered under every answer, always. */
  caveats: string[];
  columns: string[];
  rows: (string | number | null)[][];
  chart: ChartSpec | null;
  meta: Record<string, unknown>;
}

export interface ChartSpec {
  type: 'bar' | 'grouped-bar';
  title: string;
  xKey: string;
  series: { key: string; label: string }[];
  data: Record<string, string | number>[];
  valueFormat: 'money' | 'number' | 'percent';
}

interface VendorRow {
  id: string;
  name: string;
}

// ---------------------------------------------------------------------------
// shared loaders
// ---------------------------------------------------------------------------

async function vendors(rfxId: string): Promise<VendorRow[]> {
  return all<VendorRow>(
    `SELECT DISTINCT v.id, v.name FROM vendor v
       JOIN quote q ON q.vendor_id = v.id
      WHERE q.rfx_id = ? ORDER BY v.name`,
    [rfxId],
  );
}

export interface GateStatus {
  vendorId: string;
  vendorName: string;
  cleared: boolean;
  failures: string[];
  unanswered: string[];
}

/**
 * The quality gate. Deterministic: a question is a gate if the buyer marked it
 * so, and a vendor clears the gate only by answering it the required way.
 * A missing answer is never treated as a pass.
 */
export async function qualityGate(rfxId: string): Promise<GateStatus[]> {
  const gates = await all<{ id: string; question: string; gate_json: string }>(
    'SELECT id, question, gate_json FROM questionnaire_question WHERE rfx_id = ? AND gate_json IS NOT NULL',
    [rfxId],
  );
  const vs = await vendors(rfxId);
  const answers = await all<{
    vendor_id: string; question_id: string; parsed_answer: string | null; raw_answer: string | null;
  }>(
    'SELECT vendor_id, question_id, parsed_answer, raw_answer FROM questionnaire_answer WHERE rfx_id = ?',
    [rfxId],
  );

  return vs.map((v) => {
    const failures: string[] = [];
    const unanswered: string[] = [];
    for (const g of gates) {
      const req = j.parse<{ requires: string }>(g.gate_json, { requires: 'yes' }).requires.toLowerCase();
      const a = answers.find((x) => x.vendor_id === v.id && x.question_id === g.id);
      const val = (a?.parsed_answer ?? '').trim().toLowerCase();
      if (!a || val === '') {
        unanswered.push(g.question);
      } else if (val !== req) {
        failures.push(`${g.question} — answered "${a.raw_answer ?? val}"`);
      }
    }
    return {
      vendorId: v.id,
      vendorName: v.name,
      cleared: failures.length === 0 && unanswered.length === 0,
      failures,
      unanswered,
    };
  });
}

interface PricedLine {
  vendor_id: string;
  vendor_name: string;
  line_id: string;
  code: string;
  description: string;
  canonical_uom: string;
  annual_qty: number;
  normalized_price: number;
  match_tier: string;
  match_score: number | null;
  extraction_confidence: string;
}

/** Only unblocked, matched, normalised lines are ever comparable. */
async function pricedLines(rfxId: string): Promise<PricedLine[]> {
  return all<PricedLine>(
    `SELECT ql.vendor_id, v.name AS vendor_name, rl.id AS line_id, rl.code, rl.description,
            rl.canonical_uom, rl.annual_qty, ql.normalized_price, ql.match_tier, ql.match_score,
            ql.extraction_confidence
       FROM quote_line ql
       JOIN rfx_line rl ON rl.id = ql.matched_line_id
       JOIN vendor v ON v.id = ql.vendor_id
      WHERE ql.rfx_id = ? AND ql.blocked = 0 AND ql.normalized_price IS NOT NULL
      ORDER BY rl.line_no, v.name`,
    [rfxId],
  );
}

async function resolveVendorFilter(
  rfxId: string,
  opts: { vendor_names?: string[] | null; only_quality_cleared?: boolean | null },
): Promise<{ ids: Set<string>; notes: string[] }> {
  const vs = await vendors(rfxId);
  let allowed = new Set(vs.map((v) => v.id));
  const notes: string[] = [];

  if (opts.vendor_names && opts.vendor_names.length > 0) {
    const wanted = opts.vendor_names.map((n) => n.toLowerCase());
    const matched = vs.filter((v) => wanted.some((w) => v.name.toLowerCase().includes(w)));
    allowed = new Set(matched.map((v) => v.id));
    notes.push(`vendors limited to ${matched.map((m) => m.name).join(', ') || '(none matched)'}`);
  }

  if (opts.only_quality_cleared) {
    const gate = await qualityGate(rfxId);
    const cleared = gate.filter((g) => g.cleared).map((g) => g.vendorId);
    const excluded = gate.filter((g) => !g.cleared && allowed.has(g.vendorId));
    allowed = new Set([...allowed].filter((id) => cleared.includes(id)));
    notes.push('only vendors that cleared the quality questionnaire');
    for (const e of excluded) {
      notes.push(
        `excluded ${e.vendorName} — ${[...e.failures, ...e.unanswered.map((u) => `${u} (unanswered)`)].join('; ')}`,
      );
    }
  }

  return { ids: allowed, notes };
}

async function lineFilter(
  rfxId: string,
  codes: string[] | null | undefined,
): Promise<{ ids: Set<string> | null; note: string | null }> {
  if (!codes || codes.length === 0) return { ids: null, note: null };
  const rows = await all<{ id: string; code: string }>(
    'SELECT id, code FROM rfx_line WHERE rfx_id = ?', [rfxId],
  );
  const up = codes.map((c) => c.toUpperCase());
  const hit = rows.filter((r) => up.includes(r.code.toUpperCase()));
  return {
    ids: new Set(hit.map((h) => h.id)),
    note: `lines limited to ${hit.map((h) => h.code).join(', ') || '(none matched)'}`,
  };
}

/** Every result carries the same exclusion accounting, computed the same way. */
async function exclusionCaveats(rfxId: string, allowedVendors: Set<string>): Promise<string[]> {
  const blocked = await all<{ vendor_name: string; n: number }>(
    `SELECT v.name AS vendor_name, COUNT(*) AS n FROM quote_line ql
       JOIN vendor v ON v.id = ql.vendor_id
      WHERE ql.rfx_id = ? AND ql.blocked = 1 GROUP BY v.name`,
    [rfxId],
  );
  const out: string[] = [];
  for (const b of blocked) {
    out.push(`${b.vendor_name}: ${b.n} line(s) held out of the comparison pending review.`);
  }
  const openReviews = await one<{ n: number }>(
    "SELECT COUNT(*) AS n FROM review_item WHERE rfx_id = ? AND status = 'open'", [rfxId],
  );
  if ((openReviews?.n ?? 0) > 0) {
    out.push(`${openReviews!.n} review item(s) are still open — resolving them may change these numbers.`);
  }
  if (allowedVendors.size === 0) out.push('No vendors satisfied the filter, so there is nothing to compare.');
  return out;
}

// ---------------------------------------------------------------------------
// the callable queries
// ---------------------------------------------------------------------------

export async function listRfxLines(rfxId: string): Promise<QueryResult> {
  const rows = await all<{ code: string; description: string; canonical_uom: string; annual_qty: number }>(
    'SELECT code, description, canonical_uom, annual_qty FROM rfx_line WHERE rfx_id = ? ORDER BY line_no',
    [rfxId],
  );
  return {
    kind: 'rfx_lines',
    filtersApplied: ['all RFx lines'],
    caveats: [],
    columns: ['Code', 'Description', 'Priced per', 'Annual qty'],
    rows: rows.map((r) => [r.code, r.description, r.canonical_uom, r.annual_qty]),
    chart: null,
    meta: { count: rows.length },
  };
}

export async function coverageReport(rfxId: string): Promise<QueryResult> {
  const [{ n: totalLines }] = await all<{ n: number }>(
    'SELECT COUNT(*) AS n FROM rfx_line WHERE rfx_id = ?', [rfxId],
  );
  const vs = await vendors(rfxId);
  const priced = await pricedLines(rfxId);
  const blocked = await all<{ vendor_id: string; n: number }>(
    'SELECT vendor_id, COUNT(*) AS n FROM quote_line WHERE rfx_id = ? AND blocked = 1 GROUP BY vendor_id',
    [rfxId],
  );
  const gate = await qualityGate(rfxId);

  const rows = vs.map((v) => {
    const covered = new Set(priced.filter((p) => p.vendor_id === v.id).map((p) => p.line_id)).size;
    const b = blocked.find((x) => x.vendor_id === v.id)?.n ?? 0;
    const g = gate.find((x) => x.vendorId === v.id);
    return [v.name, `${covered} / ${totalLines}`, b, g?.cleared ? 'cleared' : 'NOT cleared'];
  });

  return {
    kind: 'coverage',
    filtersApplied: ['all vendors that responded'],
    caveats: [
      'Coverage counts only lines that are matched, normalised and not held for review.',
      'A gap is a gap — no vendor’s missing line is estimated, imputed or carried over.',
    ],
    columns: ['Vendor', 'Lines comparable', 'Held for review', 'Quality gate'],
    rows,
    chart: {
      type: 'bar',
      title: `Comparable lines quoted, of ${totalLines}`,
      xKey: 'vendor',
      series: [{ key: 'lines', label: 'Comparable lines' }],
      valueFormat: 'number',
      data: vs.map((v) => ({
        vendor: v.name.replace(/ (Pvt |Pte )?Ltd$/, ''),
        lines: new Set(priced.filter((p) => p.vendor_id === v.id).map((p) => p.line_id)).size,
      })),
    },
    meta: { totalLines },
  };
}

export async function comparePrices(
  rfxId: string,
  opts: { line_codes?: string[] | null; vendor_names?: string[] | null; only_quality_cleared?: boolean | null },
): Promise<QueryResult> {
  const vf = await resolveVendorFilter(rfxId, opts);
  const lf = await lineFilter(rfxId, opts.line_codes);
  const priced = (await pricedLines(rfxId)).filter(
    (p) => vf.ids.has(p.vendor_id) && (!lf.ids || lf.ids.has(p.line_id)),
  );

  const vs = (await vendors(rfxId)).filter((v) => vf.ids.has(v.id));
  const lineIds = [...new Set(priced.map((p) => p.line_id))];
  const lineMeta = new Map(priced.map((p) => [p.line_id, p]));

  const rows = lineIds.map((id) => {
    const m = lineMeta.get(id)!;
    const cells = vs.map((v) => {
      const hit = priced.find((p) => p.line_id === id && p.vendor_id === v.id);
      return hit ? hit.normalized_price : null;
    });
    return [m.code, m.description, `per ${m.canonical_uom}`, ...cells];
  });

  return {
    kind: 'price_comparison',
    filtersApplied: [
      ...(lf.note ? [lf.note] : ['all RFx lines']),
      ...(vf.notes.length ? vf.notes : ['all responding vendors']),
      'unit prices normalised to INR and to the RFx line’s own unit of measure',
    ],
    caveats: [
      'Blank means the vendor did not quote a comparable price for that line. It does not mean zero.',
      ...(await exclusionCaveats(rfxId, vf.ids)),
    ],
    columns: ['Code', 'Description', 'Basis', ...vs.map((v) => v.name)],
    rows,
    chart: null,
    meta: { lines: lineIds.length, vendors: vs.length },
  };
}

export async function totalCost(
  rfxId: string,
  opts: {
    vendor_names?: string[] | null;
    only_quality_cleared?: boolean | null;
    line_codes?: string[] | null;
    /** Compare only over lines every included vendor quoted. Default true. */
    common_lines_only?: boolean | null;
  },
): Promise<QueryResult> {
  const vf = await resolveVendorFilter(rfxId, opts);
  const lf = await lineFilter(rfxId, opts.line_codes);
  const commonOnly = opts.common_lines_only !== false;

  const priced = (await pricedLines(rfxId)).filter(
    (p) => vf.ids.has(p.vendor_id) && (!lf.ids || lf.ids.has(p.line_id)),
  );
  const vs = (await vendors(rfxId)).filter((v) => vf.ids.has(v.id));

  const allLineIds = [...new Set(priced.map((p) => p.line_id))];
  const common = allLineIds.filter((id) =>
    vs.every((v) => priced.some((p) => p.line_id === id && p.vendor_id === v.id)),
  );
  const basis = commonOnly ? common : allLineIds;
  const dropped = allLineIds.length - common.length;

  const [{ n: scheduleLines }] = await all<{ n: number }>(
    'SELECT COUNT(*) AS n FROM rfx_line WHERE rfx_id = ?', [rfxId],
  );
  const allPriced = await pricedLines(rfxId);

  const rows = vs
    .map((v) => {
      const mine = priced.filter((p) => p.vendor_id === v.id && basis.includes(p.line_id));
      const total = mine.reduce((s, p) => s + p.normalized_price * p.annual_qty, 0);
      // A vendor's own coverage, not the like-for-like basis. Without this a
      // vendor who quoted 9 of 30 lines shows as "cheapest overall" and a buyer
      // could read that as a supplier they can actually award the schedule to.
      const own = new Set(allPriced.filter((p) => p.vendor_id === v.id).map((p) => p.line_id)).size;
      return { name: v.name, lines: mine.length, total, own };
    })
    .sort((a, b) => a.total - b.total);

  const caveats = [...(await exclusionCaveats(rfxId, vf.ids))];

  const partial = rows.filter((r) => r.own < scheduleLines);
  if (partial.length > 0) {
    caveats.unshift(
      `A single-supplier award is only possible for a vendor who quoted the whole schedule. ${partial
        .map((p) => `${p.name} quoted ${p.own} of ${scheduleLines}`)
        .join('; ')}.`,
    );
  }
  if (commonOnly && dropped > 0) {
    caveats.unshift(
      `Totals cover the ${common.length} line(s) that every included vendor quoted comparably. ${dropped} further line(s) were excluded because at least one vendor did not quote them — including them would compare different baskets.`,
    );
  } else if (!commonOnly) {
    caveats.unshift(
      'Totals cover each vendor’s own quoted lines, so they are NOT like-for-like — a vendor that quoted fewer lines will look cheaper.',
    );
  }

  return {
    kind: 'total_cost',
    filtersApplied: [
      ...(lf.note ? [lf.note] : ['all RFx lines']),
      ...(vf.notes.length ? vf.notes : ['all responding vendors']),
      commonOnly ? 'like-for-like: only lines quoted by every included vendor' : 'each vendor’s own coverage',
      'annual cost = normalised unit price x the RFx annual quantity',
    ],
    caveats,
    columns: ['Vendor', 'Lines counted', 'Annual cost (INR)', `Quoted of ${scheduleLines}`],
    rows: rows.map((r) => [r.name, r.lines, Math.round(r.total), r.own]),
    chart: {
      type: 'bar',
      title: `Annual cost across ${basis.length} comparable line(s)`,
      xKey: 'vendor',
      series: [{ key: 'cost', label: 'Annual cost (INR)' }],
      valueFormat: 'money',
      data: rows.map((r) => ({ vendor: r.name.replace(/ (Pvt |Pte )?Ltd$/, ''), cost: Math.round(r.total) })),
    },
    meta: { basisLines: basis.length, droppedLines: dropped, scheduleLines },
  };
}

export async function cheapestPerLine(
  rfxId: string,
  opts: { only_quality_cleared?: boolean | null; vendor_names?: string[] | null; line_codes?: string[] | null },
): Promise<QueryResult> {
  const vf = await resolveVendorFilter(rfxId, opts);
  const lf = await lineFilter(rfxId, opts.line_codes);
  const priced = (await pricedLines(rfxId)).filter(
    (p) => vf.ids.has(p.vendor_id) && (!lf.ids || lf.ids.has(p.line_id)),
  );

  const [{ n: totalLines }] = await all<{ n: number }>(
    'SELECT COUNT(*) AS n FROM rfx_line WHERE rfx_id = ?', [rfxId],
  );

  const byLine = new Map<string, PricedLine[]>();
  for (const p of priced) {
    const arr = byLine.get(p.line_id) ?? [];
    arr.push(p);
    byLine.set(p.line_id, arr);
  }

  const rows: (string | number | null)[][] = [];
  const awardByVendor = new Map<string, { lines: number; value: number }>();
  let splitTotal = 0;

  for (const [, group] of byLine) {
    const winner = group.reduce((a, b) => (b.normalized_price < a.normalized_price ? b : a));
    const runnerUp = group
      .filter((g) => g.vendor_id !== winner.vendor_id)
      .sort((a, b) => a.normalized_price - b.normalized_price)[0];
    const annual = winner.normalized_price * winner.annual_qty;
    splitTotal += annual;

    const cur = awardByVendor.get(winner.vendor_name) ?? { lines: 0, value: 0 };
    cur.lines++;
    cur.value += annual;
    awardByVendor.set(winner.vendor_name, cur);

    rows.push([
      winner.code,
      winner.description.slice(0, 58),
      winner.vendor_name,
      winner.normalized_price,
      runnerUp ? Math.round((runnerUp.normalized_price - winner.normalized_price) * winner.annual_qty) : null,
      group.length,
    ]);
  }

  const caveats = [
    `${byLine.size} of ${totalLines} RFx lines had at least one comparable quote from the included vendors. The remaining ${totalLines - byLine.size} cannot be awarded on price from this data.`,
    'Lines where only one vendor quoted are still shown as "cheapest", but there was nothing to compare against — check the "quotes" column.',
    'Discounts and rebates stated by vendors are NOT applied here. They are recorded separately and are the buyer’s call.',
    ...(await exclusionCaveats(rfxId, vf.ids)),
  ];

  return {
    kind: 'split_award',
    filtersApplied: [
      ...(lf.note ? [lf.note] : ['all RFx lines']),
      ...(vf.notes.length ? vf.notes : ['all responding vendors']),
      'cheapest normalised unit price per line',
    ],
    caveats,
    columns: ['Code', 'Description', 'Cheapest vendor', 'Unit price (INR)', 'Annual saving vs next (INR)', 'Quotes'],
    rows,
    chart: {
      type: 'bar',
      title: 'Split award — annual value by vendor',
      xKey: 'vendor',
      series: [{ key: 'value', label: 'Annual value (INR)' }],
      valueFormat: 'money',
      data: [...awardByVendor.entries()]
        .sort((a, b) => b[1].value - a[1].value)
        .map(([name, v]) => ({ vendor: name.replace(/ (Pvt |Pte )?Ltd$/, ''), value: Math.round(v.value) })),
    },
    meta: {
      splitTotal: Math.round(splitTotal),
      awardedLines: byLine.size,
      totalLines,
      byVendor: Object.fromEntries([...awardByVendor].map(([k, v]) => [k, { ...v, value: Math.round(v.value) }])),
    },
  };
}

export async function questionnaireReport(rfxId: string): Promise<QueryResult> {
  const qs = await all<{ id: string; q_no: number; question: string; gate_json: string | null }>(
    'SELECT id, q_no, question, gate_json FROM questionnaire_question WHERE rfx_id = ? ORDER BY q_no',
    [rfxId],
  );
  const vs = await vendors(rfxId);
  const answers = await all<{
    vendor_id: string; question_id: string | null; raw_answer: string | null; confidence: string;
  }>(
    'SELECT vendor_id, question_id, raw_answer, confidence FROM questionnaire_answer WHERE rfx_id = ?',
    [rfxId],
  );

  const rows = qs.map((q) => [
    `Q${q.q_no}${q.gate_json ? ' *' : ''}`,
    q.question,
    ...vs.map((v) => {
      const a = answers.find((x) => x.vendor_id === v.id && x.question_id === q.id);
      return a?.raw_answer ?? '— not answered —';
    }),
  ]);

  const gate = await qualityGate(rfxId);
  return {
    kind: 'questionnaire',
    filtersApplied: ['all questionnaire questions', '* marks a question that gates compliance'],
    caveats: [
      'Answers are quoted as the vendor wrote them. Where a vendor did not answer, the cell says so rather than defaulting to a pass.',
      ...gate.filter((g) => !g.cleared).map((g) => `${g.vendorName} does NOT clear the gate: ${[...g.failures, ...g.unanswered].join('; ')}`),
    ],
    columns: ['#', 'Question', ...vs.map((v) => v.name)],
    rows,
    chart: null,
    meta: { gate },
  };
}

export async function lineDetail(rfxId: string, lineCode: string): Promise<QueryResult> {
  const line = await one<{ id: string; code: string; description: string; canonical_uom: string }>(
    'SELECT id, code, description, canonical_uom FROM rfx_line WHERE rfx_id = ? AND UPPER(code) = ?',
    [rfxId, lineCode.toUpperCase()],
  );
  if (!line) {
    return {
      kind: 'line_detail', filtersApplied: [`line ${lineCode}`],
      caveats: [`No RFx line with code ${lineCode}.`], columns: [], rows: [], chart: null, meta: {},
    };
  }

  const rows = await all<{
    vendor_name: string; raw_description: string; raw_price: string; raw_uom: string | null;
    normalized_price: number | null; normalization_note: string | null; match_tier: string;
    match_score: number | null; extraction_confidence: string; blocked: number; source_ref_json: string;
  }>(
    `SELECT v.name AS vendor_name, ql.raw_description, ql.raw_price, ql.raw_uom, ql.normalized_price,
            ql.normalization_note, ql.match_tier, ql.match_score, ql.extraction_confidence,
            ql.blocked, ql.source_ref_json
       FROM quote_line ql JOIN vendor v ON v.id = ql.vendor_id
      WHERE ql.rfx_id = ? AND ql.matched_line_id = ? ORDER BY v.name`,
    [rfxId, line.id],
  );

  return {
    kind: 'line_detail',
    filtersApplied: [`line ${line.code}: ${line.description}`, `priced per ${line.canonical_uom}`],
    caveats: rows.some((r) => r.blocked === 1)
      ? ['Rows marked "held" are excluded from every comparison until the review item is resolved.']
      : [],
    columns: ['Vendor', 'As written by vendor', 'Raw price', 'Raw basis', 'Normalised (INR)', 'How', 'Match tier', 'Confidence', 'Status'],
    rows: rows.map((r) => [
      r.vendor_name, r.raw_description, r.raw_price, r.raw_uom, r.normalized_price,
      r.normalization_note, `${r.match_tier}${r.match_score !== null ? ` (${r.match_score})` : ''}`,
      r.extraction_confidence, r.blocked ? 'held for review' : 'in comparison',
    ]),
    chart: null,
    meta: {
      lineCode: line.code,
      provenance: rows.map((r) => ({
        vendor: r.vendor_name,
        ref: j.parse<SourceRef | null>(r.source_ref_json, null),
      })),
    },
  };
}

export async function commercialNotes(rfxId: string): Promise<QueryResult> {
  const rows = await all<{ vendor_name: string; commercial_notes_json: string }>(
    `SELECT v.name AS vendor_name, q.commercial_notes_json FROM quote q
       JOIN vendor v ON v.id = q.vendor_id WHERE q.rfx_id = ? ORDER BY v.name`,
    [rfxId],
  );

  const out: (string | number | null)[][] = [];
  for (const r of rows) {
    const notes = j.parse<{ kind: string; text: string; percent: number | null }[]>(r.commercial_notes_json, []);
    for (const n of notes) out.push([r.vendor_name, n.kind, n.percent, n.text]);
  }

  return {
    kind: 'commercial_notes',
    filtersApplied: ['every discount, rebate, surcharge and condition found in the vendor documents'],
    caveats: [
      'None of these are applied to any price anywhere in this system. Applying a conditional discount is a commercial judgement, not an extraction result.',
      'Percentages are recorded only where the vendor stated one unambiguously.',
    ],
    columns: ['Vendor', 'Type', 'Percent', 'As written'],
    rows: out,
    chart: null,
    meta: { count: out.length },
  };
}

export async function reviewQueueSummary(rfxId: string): Promise<QueryResult> {
  const rows = await all<{ kind: string; status: string; n: number }>(
    'SELECT kind, status, COUNT(*) AS n FROM review_item WHERE rfx_id = ? GROUP BY kind, status ORDER BY n DESC',
    [rfxId],
  );
  return {
    kind: 'review_queue',
    filtersApplied: ['all review items for this RFx'],
    caveats: ['Open items mean some vendor lines are deliberately excluded from every comparison above.'],
    columns: ['Issue', 'Status', 'Count'],
    rows: rows.map((r) => [r.kind.replace(/_/g, ' '), r.status, r.n]),
    chart: null,
    meta: {},
  };
}

export function formatCell(v: string | number | null, column: string): string {
  if (v === null) return '—';
  if (typeof v === 'number' && /INR|price|cost|saving/i.test(column)) return formatMoney(v);
  return String(v);
}
