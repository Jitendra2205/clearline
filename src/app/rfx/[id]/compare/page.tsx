import { notFound } from 'next/navigation';
import { all, one, ready, j } from '@/lib/db/client';
import { signDocToken } from '@/lib/security/signed';
import { qualityGate } from '@/lib/query/engine';
import { Shell } from '@/components/ui';
import CompareGrid, { type GridCell, type GridVendor } from '@/components/CompareGrid';
import type { SourceRef } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function ComparePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await ready();

  const rfx = await one<{ id: string; title: string; base_currency: string }>(
    'SELECT id, title, base_currency FROM rfx WHERE id = ?', [id],
  );
  if (!rfx) notFound();

  const lines = await all<{ id: string; line_no: number; code: string; description: string; canonical_uom: string; annual_qty: number }>(
    'SELECT id, line_no, code, description, canonical_uom, annual_qty FROM rfx_line WHERE rfx_id = ? ORDER BY line_no',
    [id],
  );

  const vendorRows = await all<{ id: string; name: string; currency: string | null; incoterm: string | null; validity: string | null; doc_id: string; filename: string }>(
    `SELECT v.id, v.name, q.currency, q.incoterm, q.validity, q.doc_id, d.filename
       FROM quote q JOIN vendor v ON v.id = q.vendor_id JOIN vendor_document d ON d.id = q.doc_id
      WHERE q.rfx_id = ? ORDER BY v.name`,
    [id],
  );

  const cells = await all<{
    vendor_id: string; matched_line_id: string | null; raw_description: string; raw_price: string;
    raw_uom: string | null; parsed_price: number | null; normalized_price: number | null;
    normalization_note: string | null; match_tier: string; match_score: number | null;
    match_reason: string | null; extraction_confidence: string; ambiguity_flags_json: string;
    blocked: number; source_ref_json: string;
  }>(
    `SELECT vendor_id, matched_line_id, raw_description, raw_price, raw_uom, parsed_price,
            normalized_price, normalization_note, match_tier, match_score, match_reason,
            extraction_confidence, ambiguity_flags_json, blocked, source_ref_json
       FROM quote_line WHERE rfx_id = ?`,
    [id],
  );

  const gate = await qualityGate(id);
  const openReviews = await one<{ n: number }>(
    "SELECT COUNT(*) AS n FROM review_item WHERE rfx_id = ? AND status = 'open'", [id],
  );

  const notes = await all<{ name: string; commercial_notes_json: string }>(
    `SELECT v.name, q.commercial_notes_json FROM quote q JOIN vendor v ON v.id = q.vendor_id WHERE q.rfx_id = ?`,
    [id],
  );

  const docTokens = Object.fromEntries(
    [...new Set(vendorRows.map((v) => v.doc_id))].map((d) => [d, signDocToken(d)]),
  );

  const vendors: GridVendor[] = vendorRows.map((v) => {
    const mine = cells.filter((c) => c.vendor_id === v.id);
    const g = gate.find((x) => x.vendorId === v.id);
    return {
      id: v.id,
      name: v.name,
      currency: v.currency,
      incoterm: v.incoterm,
      validity: v.validity,
      filename: v.filename,
      docUrl: `/api/doc/${v.doc_id}?t=${docTokens[v.doc_id]}`,
      comparable: mine.filter((c) => c.blocked === 0 && c.matched_line_id).length,
      held: mine.filter((c) => c.blocked === 1).length,
      gateCleared: g?.cleared ?? false,
      gateDetail: [...(g?.failures ?? []), ...(g?.unanswered ?? []).map((u) => `${u} (unanswered)`)],
    };
  });

  const grid: Record<string, Record<string, GridCell>> = {};
  for (const c of cells) {
    if (!c.matched_line_id) continue;
    grid[c.matched_line_id] ??= {};
    // If a vendor somehow has two lines matched to the same RFx line, keep the
    // unblocked one — and never silently merge them into a single number.
    const existing = grid[c.matched_line_id][c.vendor_id];
    if (existing && existing.blocked === false) continue;
    const ref = j.parse<SourceRef | null>(c.source_ref_json, null);
    grid[c.matched_line_id][c.vendor_id] = {
      rawDescription: c.raw_description,
      rawPrice: c.raw_price,
      rawUom: c.raw_uom,
      parsedPrice: c.parsed_price,
      normalizedPrice: c.normalized_price,
      normalizationNote: c.normalization_note,
      matchTier: c.match_tier,
      matchScore: c.match_score,
      matchReason: c.match_reason,
      confidence: c.extraction_confidence,
      flags: j.parse<string[]>(c.ambiguity_flags_json, []),
      blocked: c.blocked === 1,
      sourcePage: ref?.page ?? null,
      sourceLocator: ref?.locator ?? null,
      snippet: ref?.snippet ?? '',
      docUrl: ref?.docId ? `/api/doc/${ref.docId}?t=${docTokens[ref.docId] ?? signDocToken(ref.docId)}` : null,
    };
  }

  const unmatched = cells.filter((c) => !c.matched_line_id).length;

  return (
    <Shell
      rfxId={id}
      active="compare"
      title="Side-by-side comparison"
      subtitle="Same lines, same units, same currency. Every cell shows which tier matched it and every converted value carries the original alongside."
    >
      <CompareGrid
        rfxId={id}
        baseCurrency={rfx.base_currency}
        lines={lines.map((l) => ({
          id: l.id, lineNo: l.line_no, code: l.code,
          description: l.description, uom: l.canonical_uom, annualQty: l.annual_qty,
        }))}
        vendors={vendors}
        grid={grid}
        openReviews={openReviews?.n ?? 0}
        unmatchedCount={unmatched}
        commercialNotes={notes.flatMap((n) =>
          j.parse<{ kind: string; text: string; percent: number | null }[]>(n.commercial_notes_json, []).map((x) => ({
            vendor: n.name, ...x,
          })),
        )}
      />
    </Shell>
  );
}
