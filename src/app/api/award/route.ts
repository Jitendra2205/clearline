import { NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { requireAuth } from '@/lib/security/auth';
import { one, run, all, j } from '@/lib/db/client';
import { cheapestPerLine, totalCost, qualityGate } from '@/lib/query/engine';

export const runtime = 'nodejs';

/**
 * Records an award decision.
 *
 * The decision snapshot is stored with the numbers as they stood at the moment
 * of the decision, together with the open review count. A buyer who awards with
 * items still open should be able to see later that they did.
 */
export async function POST(req: Request) {
  const denied = await requireAuth();
  if (denied) return denied;

  const { rfxId, strategy, rationale, clearedOnly } = (await req.json()) as {
    rfxId?: string;
    strategy?: 'split_cheapest_per_line' | 'single_lowest_total';
    rationale?: string;
    clearedOnly?: boolean;
  };

  if (!rfxId || !strategy) {
    return NextResponse.json({ error: 'rfxId and strategy are required.' }, { status: 400 });
  }

  const gate = await qualityGate(rfxId);
  const openReviews = await one<{ n: number }>(
    "SELECT COUNT(*) AS n FROM review_item WHERE rfx_id = ? AND status = 'open'", [rfxId],
  );

  const decision =
    strategy === 'split_cheapest_per_line'
      ? await cheapestPerLine(rfxId, { only_quality_cleared: clearedOnly ?? true, vendor_names: null, line_codes: null })
      : await totalCost(rfxId, {
          only_quality_cleared: clearedOnly ?? true, vendor_names: null,
          line_codes: null, common_lines_only: true,
        });

  const now = new Date().toISOString();
  const awardId = `aw_${nanoid(12)}`;

  const snapshot = {
    strategy,
    clearedOnly: clearedOnly ?? true,
    decidedAt: now,
    filtersApplied: decision.filtersApplied,
    caveats: decision.caveats,
    columns: decision.columns,
    rows: decision.rows,
    meta: decision.meta,
    qualityGate: gate,
    openReviewItemsAtDecision: openReviews?.n ?? 0,
  };

  await run(
    `INSERT INTO award (id, rfx_id, strategy, decision_json, rationale, decided_by, decided_at)
     VALUES (?,?,?,?,?,?,?)`,
    [awardId, rfxId, strategy, j.stringify(snapshot), rationale ?? null, 'buyer@demo', now],
  );

  await run('UPDATE rfx SET status = ? WHERE id = ?', ['awarded', rfxId]);

  await run(
    `INSERT INTO audit_log (id, rfx_id, actor, action, entity, entity_id, before_json, after_json, at)
     VALUES (?,?,?,?,?,?,NULL,?,?)`,
    [
      `au_${nanoid(10)}`, rfxId, 'buyer@demo', 'award.decided', 'award', awardId,
      j.stringify({
        strategy,
        openReviewItemsAtDecision: openReviews?.n ?? 0,
        vendorsExcludedByGate: gate.filter((g) => !g.cleared).map((g) => g.vendorName),
        rationale: rationale ?? null,
      }),
      now,
    ],
  );

  return NextResponse.json({ ok: true, awardId, snapshot });
}

export async function GET(req: Request) {
  const denied = await requireAuth();
  if (denied) return denied;
  const rfxId = new URL(req.url).searchParams.get('rfxId');
  if (!rfxId) return NextResponse.json({ error: 'rfxId is required.' }, { status: 400 });

  const rows = await all<{ id: string; strategy: string; decision_json: string; rationale: string | null; decided_by: string; decided_at: string }>(
    'SELECT id, strategy, decision_json, rationale, decided_by, decided_at FROM award WHERE rfx_id = ? ORDER BY decided_at DESC',
    [rfxId],
  );
  return NextResponse.json({ awards: rows });
}
