import { notFound } from 'next/navigation';
import { all, one, ready, j } from '@/lib/db/client';
import { signDocToken } from '@/lib/security/signed';
import { Shell } from '@/components/ui';
import ReviewQueue, { type ReviewRow } from '@/components/ReviewQueue';
import type { SourceRef } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await ready();

  const rfx = await one<{ id: string }>('SELECT id FROM rfx WHERE id = ?', [id]);
  if (!rfx) notFound();

  const rows = await all<{
    id: string; kind: string; detail: string; status: string; resolution: string | null;
    resolved_by: string | null; resolved_at: string | null; created_at: string;
    quote_line_id: string | null; vendor_name: string; code: string | null;
    raw_description: string | null; raw_price: string | null; raw_uom: string | null;
    parsed_price: number | null; match_tier: string | null; match_score: number | null;
    match_reason: string | null; confidence: string | null; source_ref_json: string | null;
    doc_id: string; filename: string; currency: string | null;
  }>(
    `SELECT r.id, r.kind, r.detail, r.status, r.resolution, r.resolved_by, r.resolved_at, r.created_at,
            r.quote_line_id, v.name AS vendor_name, rl.code,
            ql.raw_description, ql.raw_price, ql.raw_uom, ql.parsed_price, ql.match_tier,
            ql.match_score, ql.match_reason, ql.extraction_confidence AS confidence,
            ql.source_ref_json, q.doc_id, d.filename, q.currency
       FROM review_item r
       JOIN quote q ON q.id = r.quote_id
       JOIN vendor v ON v.id = q.vendor_id
       JOIN vendor_document d ON d.id = q.doc_id
       LEFT JOIN quote_line ql ON ql.id = r.quote_line_id
       LEFT JOIN rfx_line rl ON rl.id = ql.matched_line_id
      WHERE r.rfx_id = ?
      ORDER BY CASE r.status WHEN 'open' THEN 0 ELSE 1 END, r.created_at`,
    [id],
  );

  const lineCodes = await all<{ code: string; description: string }>(
    'SELECT code, description FROM rfx_line WHERE rfx_id = ? ORDER BY line_no', [id],
  );

  const tokens = Object.fromEntries(
    [...new Set(rows.map((r) => r.doc_id))].map((d) => [d, signDocToken(d)]),
  );

  const items: ReviewRow[] = rows.map((r) => {
    const ref = j.parse<SourceRef | null>(r.source_ref_json ?? '', null);
    return {
      id: r.id,
      kind: r.kind,
      detail: r.detail,
      status: r.status,
      resolution: r.resolution,
      resolvedBy: r.resolved_by,
      resolvedAt: r.resolved_at,
      vendorName: r.vendor_name,
      lineCode: r.code,
      rawDescription: r.raw_description,
      rawPrice: r.raw_price,
      rawUom: r.raw_uom,
      parsedPrice: r.parsed_price,
      matchTier: r.match_tier,
      matchScore: r.match_score,
      matchReason: r.match_reason,
      confidence: r.confidence,
      currency: r.currency,
      snippet: ref?.snippet ?? null,
      locator: ref?.locator ?? null,
      page: ref?.page ?? null,
      filename: r.filename,
      docUrl: `/api/doc/${r.doc_id}?t=${tokens[r.doc_id]}`,
    };
  });

  const open = items.filter((i) => i.status === 'open').length;

  return (
    <Shell
      rfxId={id}
      active="review"
      title="Review queue"
      subtitle={
        open > 0
          ? `${open} thing(s) the system is not confident about. Each one is holding a line out of the comparison — deliberately, rather than showing a number nobody has checked.`
          : 'Nothing open. Every extracted line has either cleared automatically or been resolved by a human.'
      }
    >
      <ReviewQueue items={items} lineCodes={lineCodes} />
    </Shell>
  );
}
