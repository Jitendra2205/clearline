import { nanoid } from 'nanoid';
import { all, batch, j, run } from '../db/client';
import type { Extraction } from '../ai/schemas';
import { proposeMatches } from '../ai/semanticMatch';
import { exactMatch, fuzzyMatch, type RfxLineForMatch } from './match';
import { convertCurrency, convertUom, priceBandCheck, FX_RATES } from './units';
import type { LineSpec, MatchTier } from '../types';

/**
 * Turns one validated extraction into comparison rows.
 *
 * Nothing in here is a model call except tier-3 matching, and nothing a model
 * says is trusted without a human. Every value that reaches the comparison grid
 * either came straight out of the document or was produced by a conversion the
 * buyer can read back in plain language.
 */

export interface PipelineResult {
  quoteId: string;
  linesWritten: number;
  reviewItems: number;
  blocked: number;
}

interface DbRfxLine {
  id: string;
  code: string;
  description: string;
  spec_json: string;
  canonical_uom: string;
  annual_qty: number;
}

export async function normalizeExtraction(opts: {
  rfxId: string;
  vendorId: string;
  docId: string;
  extraction: Extraction;
  modelVersion: string;
  provenanceFailures: string[];
  baseCurrency: string;
  /** Skip the tier-3 model call (used by the eval harness for tier isolation). */
  skipSemantic?: boolean;
}): Promise<PipelineResult> {
  const { rfxId, vendorId, docId, extraction: ex } = opts;

  const rows = await all<DbRfxLine>(
    'SELECT id, code, description, spec_json, canonical_uom, annual_qty FROM rfx_line WHERE rfx_id = ? ORDER BY line_no',
    [rfxId],
  );
  const rfxLines: RfxLineForMatch[] = rows.map((r) => ({
    id: r.id,
    code: r.code,
    description: r.description,
    spec: j.parse<LineSpec>(r.spec_json, {} as LineSpec),
  }));
  const uomByLineId = new Map(rows.map((r) => [r.id, r.canonical_uom]));

  // Replace any prior extraction of this document — re-running must be safe.
  const prior = await all<{ id: string }>('SELECT id FROM quote WHERE doc_id = ?', [docId]);
  for (const p of prior) {
    await run('DELETE FROM review_item WHERE quote_id = ?', [p.id]);
    await run('DELETE FROM quote_line WHERE quote_id = ?', [p.id]);
    await run('DELETE FROM questionnaire_answer WHERE quote_id = ?', [p.id]);
    await run('DELETE FROM quote WHERE id = ?', [p.id]);
  }

  const quoteId = `q_${nanoid(12)}`;
  const now = new Date().toISOString();

  await run(
    `INSERT INTO quote (id, rfx_id, vendor_id, doc_id, currency, incoterm, validity, payment_terms,
       commercial_notes_json, unquoted_note, model_version, extracted_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      quoteId, rfxId, vendorId, docId, ex.currency, ex.incoterm, ex.validity, ex.payment_terms,
      j.stringify(ex.commercial_notes.map((n) => ({ ...n, autoApplied: false }))),
      ex.unquoted_note, opts.modelVersion, now,
    ],
  );

  // ---- pass 1: deterministic tiers -----------------------------------------
  interface Staged {
    id: string;
    idx: number;
    matchedLineId: string | null;
    tier: MatchTier;
    score: number | null;
    reason: string | null;
  }
  const staged: Staged[] = [];
  const needSemantic: { id: string; rawDescription: string; rawUom: string | null }[] = [];

  ex.lines.forEach((line, idx) => {
    const id = `ql_${nanoid(12)}`;
    // The buyer's own line code often sits in a neighbouring column, which
    // lands in the snippet rather than the description.
    const searchText = `${line.raw_description} ${line.source_ref.snippet}`;
    const m = exactMatch(searchText, rfxLines) ?? fuzzyMatch(line.raw_description, rfxLines);

    if (m) {
      staged.push({ id, idx, matchedLineId: m.lineId, tier: m.tier, score: m.score, reason: m.reason });
    } else {
      staged.push({ id, idx, matchedLineId: null, tier: 'unmatched', score: null, reason: null });
      needSemantic.push({ id, rawDescription: line.raw_description, rawUom: line.raw_uom });
    }
  });

  // ---- pass 2: tier 3, proposals only --------------------------------------
  if (needSemantic.length > 0 && !opts.skipSemantic) {
    try {
      const proposals = await proposeMatches(needSemantic, rfxLines);
      for (const p of proposals) {
        const s = staged.find((x) => x.id === p.vendorLineId);
        if (!s || p.lineId === null) continue;
        s.matchedLineId = p.lineId;
        s.tier = 'semantic';
        s.score = p.confidence;
        s.reason = p.reasoning;
      }
    } catch {
      // A tier-3 failure must not lose the other four vendors' work. The lines
      // simply stay unmatched and land in the review queue, which is the
      // correct conservative outcome anyway.
    }
  }

  // ---- pass 3: conversion, blocking, review --------------------------------
  const writes: { sql: string; args: (string | number | null)[] }[] = [];
  const reviews: { sql: string; args: (string | number | null)[] }[] = [];
  let blocked = 0;

  for (const s of staged) {
    const line = ex.lines[s.idx];
    const canonicalUom = s.matchedLineId ? (uomByLineId.get(s.matchedLineId) ?? 'piece') : 'piece';

    const notes: string[] = [];
    const flags = new Set(line.ambiguity_flags);
    let value: number | null = line.parsed_price;
    let isBlocked = false;
    const reviewKinds: { kind: string; detail: string }[] = [];

    // 1. unit of measure, against the matched line's canonical basis
    if (s.matchedLineId) {
      const u = convertUom(value, line.raw_uom ?? line.parsed_uom, canonicalUom);
      notes.push(u.note);
      value = u.value;
      if (u.review) {
        reviewKinds.push(u.review);
        isBlocked = true;
      }
    }

    // 2. currency
    if (value !== null) {
      const c = convertCurrency(value, ex.currency, opts.baseCurrency, FX_RATES);
      notes.push(c.note);
      value = c.value;
      if (c.review) {
        reviewKinds.push(c.review);
        isBlocked = true;
      }
    } else if (ex.currency === null) {
      reviewKinds.push({
        kind: 'currency_not_stated',
        detail: 'The document never states a currency. Confirm it before this line enters the comparison.',
      });
      isBlocked = true;
    }

    // 3. the model's own confidence
    if (line.extraction_confidence === 'low') {
      isBlocked = true;
      reviewKinds.push({
        kind: 'low_confidence_extraction',
        detail: `Extractor reported low confidence${flags.size ? ` (${[...flags].join(', ')})` : ''}. Source snippet: "${line.source_ref.snippet.slice(0, 120)}".`,
      });
    }

    // 4. tier-3 matches are proposals, never results
    if (s.tier === 'semantic') {
      isBlocked = true;
      reviewKinds.push({
        kind: 'semantic_match_unconfirmed',
        detail: `Proposed match (confidence ${(s.score ?? 0).toFixed(2)}): ${s.reason ?? ''} Confirm or reassign before this line counts.`,
      });
    }

    if (s.tier === 'unmatched') {
      isBlocked = true;
      reviewKinds.push({
        kind: 'unmatched_line',
        detail: `Could not match "${line.raw_description}" to any RFx line. Assign it by hand or mark it as out of scope.`,
      });
    }

    if (isBlocked) blocked++;

    writes.push({
      sql: `INSERT INTO quote_line (id, quote_id, rfx_id, vendor_id, raw_description, raw_price, raw_uom, raw_qty,
              parsed_price, parsed_uom, source_ref_json, extraction_confidence, ambiguity_flags_json,
              matched_line_id, match_tier, match_score, match_reason, normalized_price, normalization_note, blocked)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [
        s.id, quoteId, rfxId, vendorId, line.raw_description, line.raw_price, line.raw_uom, line.raw_qty,
        line.parsed_price, line.parsed_uom, j.stringify({ docId, ...line.source_ref }),
        line.extraction_confidence, j.stringify([...flags]),
        s.matchedLineId, s.tier, s.score, s.reason,
        isBlocked ? null : value, notes.filter(Boolean).join(' · '), isBlocked ? 1 : 0,
      ],
    });

    for (const r of reviewKinds) {
      reviews.push({
        sql: `INSERT INTO review_item (id, rfx_id, quote_id, quote_line_id, kind, detail, status, created_at)
              VALUES (?,?,?,?,?,?, 'open', ?)`,
        args: [`rv_${nanoid(12)}`, rfxId, quoteId, s.id, r.kind, r.detail, now],
      });
    }
  }

  // A quote with no delivery basis is not comparable on a landed-cost basis,
  // however good its unit prices look. Flag it at quote level rather than
  // letting it sit in the grid looking like a like-for-like number.
  const mentionsFreight = /freight|carriage|transport/i.test(
    [ex.unquoted_note ?? '', ...ex.commercial_notes.map((n) => n.text)].join(' '),
  );
  if (ex.incoterm === null) {
    reviews.push({
      sql: `INSERT INTO review_item (id, rfx_id, quote_id, quote_line_id, kind, detail, status, created_at)
            VALUES (?,?,?,NULL,?,?, 'open', ?)`,
      args: [
        `rv_${nanoid(12)}`, rfxId, quoteId, 'incoterm_not_stated',
        mentionsFreight
          ? 'The quote states no delivery basis but does mention freight as an extra. Until the incoterm is confirmed these prices are not comparable with delivered quotes on a landed-cost basis.'
          : 'The quote states no delivery basis. Confirm the incoterm before comparing these prices with delivered quotes.',
        now,
      ],
    });
  }

  // Provenance failures are quote-level: the model claimed a snippet that is
  // not in the document we rendered.
  for (const f of opts.provenanceFailures) {
    reviews.push({
      sql: `INSERT INTO review_item (id, rfx_id, quote_id, quote_line_id, kind, detail, status, created_at)
            VALUES (?,?,?,NULL,?,?, 'open', ?)`,
      args: [
        `rv_${nanoid(12)}`, rfxId, quoteId, 'snippet_mismatch',
        `A cited source snippet could not be found in the document — ${f}`, now,
      ],
    });
  }

  // ---- questionnaire answers ----------------------------------------------
  const questions = await all<{ id: string; question: string }>(
    'SELECT id, question FROM questionnaire_question WHERE rfx_id = ? ORDER BY q_no',
    [rfxId],
  );
  for (const a of ex.questionnaire_answers) {
    const q = bestQuestion(a.question_text, questions);
    writes.push({
      sql: `INSERT INTO questionnaire_answer (id, quote_id, rfx_id, vendor_id, question_id, question_text,
              raw_answer, parsed_answer, source_ref_json, confidence)
            VALUES (?,?,?,?,?,?,?,?,?,?)`,
      args: [
        `qa_${nanoid(12)}`, quoteId, rfxId, vendorId, q?.id ?? null, a.question_text,
        a.raw_answer, a.parsed_answer, j.stringify({ docId, ...a.source_ref }), a.confidence,
      ],
    });
  }

  await batch(writes);
  await batch(reviews);

  await runPriceBandCheck(rfxId);

  // Count priced lines, not total inserts — `writes` also carries the
  // questionnaire answers, which made every extraction look like it had found
  // eight more lines than the document contains.
  return { quoteId, linesWritten: staged.length, reviewItems: reviews.length, blocked };
}

/**
 * Cross-vendor sanity check, run after every extraction because it needs peers.
 *
 * This is the check that catches a successful prompt injection that changed a
 * number: an injected price still has to look like the other four quotes for
 * the same physical item, and it will not.
 */
export async function runPriceBandCheck(rfxId: string): Promise<number> {
  const lines = await all<{
    id: string; quote_id: string; matched_line_id: string; normalized_price: number;
  }>(
    `SELECT id, quote_id, matched_line_id, normalized_price FROM quote_line
      WHERE rfx_id = ? AND matched_line_id IS NOT NULL AND normalized_price IS NOT NULL AND blocked = 0`,
    [rfxId],
  );

  const byLine = new Map<string, typeof lines>();
  for (const l of lines) {
    const arr = byLine.get(l.matched_line_id) ?? [];
    arr.push(l);
    byLine.set(l.matched_line_id, arr);
  }

  const existing = new Set(
    (
      await all<{ quote_line_id: string }>(
        `SELECT quote_line_id FROM review_item WHERE rfx_id = ? AND kind = 'price_outside_band'`,
        [rfxId],
      )
    ).map((r) => r.quote_line_id),
  );

  const now = new Date().toISOString();
  const inserts: { sql: string; args: (string | number | null)[] }[] = [];

  for (const [, group] of byLine) {
    if (group.length < 3) continue;
    for (const l of group) {
      const peers = group.filter((p) => p.id !== l.id).map((p) => p.normalized_price);
      const check = priceBandCheck(l.normalized_price, peers);
      if (!check.ok && !existing.has(l.id)) {
        inserts.push({
          sql: `INSERT INTO review_item (id, rfx_id, quote_id, quote_line_id, kind, detail, status, created_at)
                VALUES (?,?,?,?, 'price_outside_band', ?, 'open', ?)`,
          args: [`rv_${nanoid(12)}`, rfxId, l.quote_id, l.id, check.detail, now],
        });
        inserts.push({
          sql: 'UPDATE quote_line SET blocked = 1 WHERE id = ?',
          args: [l.id],
        });
      }
    }
  }

  await batch(inserts);
  return inserts.length / 2;
}

/** Cheap token-overlap match of an answer to the buyer's question wording. */
function bestQuestion(
  text: string,
  questions: { id: string; question: string }[],
): { id: string } | null {
  const toks = (s: string) =>
    new Set(
      s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 3),
    );
  const a = toks(text);
  let best: { id: string; score: number } | null = null;
  for (const q of questions) {
    const b = toks(q.question);
    let hits = 0;
    for (const t of a) if (b.has(t)) hits++;
    const score = hits / Math.max(1, Math.min(a.size, b.size));
    if (!best || score > best.score) best = { id: q.id, score };
  }
  return best && best.score >= 0.34 ? { id: best.id } : null;
}
