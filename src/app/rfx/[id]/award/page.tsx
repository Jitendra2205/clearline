import { notFound } from 'next/navigation';
import { all, one, ready } from '@/lib/db/client';
import { cheapestPerLine, qualityGate, totalCost } from '@/lib/query/engine';
import { Shell, Panel, Badge, Caveats } from '@/components/ui';
import AwardPanel from '@/components/AwardPanel';

export const dynamic = 'force-dynamic';

export default async function AwardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await ready();

  const rfx = await one<{ id: string; title: string; status: string }>(
    'SELECT id, title, status FROM rfx WHERE id = ?', [id],
  );
  if (!rfx) notFound();

  const hasQuotes = (await one<{ n: number }>('SELECT COUNT(*) AS n FROM quote WHERE rfx_id = ?', [id]))?.n ?? 0;

  const [split, totals, gate, openReviews, audit, awards] = await Promise.all([
    hasQuotes ? cheapestPerLine(id, { only_quality_cleared: true, vendor_names: null, line_codes: null }) : null,
    hasQuotes ? totalCost(id, { only_quality_cleared: true, vendor_names: null, line_codes: null, common_lines_only: true }) : null,
    qualityGate(id),
    one<{ n: number }>("SELECT COUNT(*) AS n FROM review_item WHERE rfx_id = ? AND status = 'open'", [id]),
    all<{ at: string; actor: string; action: string; entity: string; entity_id: string; after_json: string | null }>(
      'SELECT at, actor, action, entity, entity_id, after_json FROM audit_log WHERE rfx_id = ? ORDER BY at DESC LIMIT 60',
      [id],
    ),
    all<{ id: string; strategy: string; rationale: string | null; decided_by: string; decided_at: string }>(
      'SELECT id, strategy, rationale, decided_by, decided_at FROM award WHERE rfx_id = ? ORDER BY decided_at DESC',
      [id],
    ),
  ]);

  return (
    <Shell
      rfxId={id}
      active="award"
      title="Award decision and audit trail"
      subtitle="A decision that can be defended months later: what was compared, what was excluded, who overrode what, and what was still unresolved at the moment of the call."
    >
      <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-5">
          <AwardPanel
            rfxId={id}
            canAward={hasQuotes > 0}
            openReviews={openReviews?.n ?? 0}
            split={
              split
                ? {
                    awardedLines: Number(split.meta.awardedLines ?? 0),
                    totalLines: Number(split.meta.totalLines ?? 0),
                    splitTotal: Number(split.meta.splitTotal ?? 0),
                    byVendor: (split.meta.byVendor ?? {}) as Record<string, { lines: number; value: number }>,
                    caveats: split.caveats,
                  }
                : null
            }
            totals={
              totals
                ? {
                    columns: totals.columns,
                    rows: totals.rows,
                    caveats: totals.caveats,
                    basisLines: Number(totals.meta.basisLines ?? 0),
                    scheduleLines: Number(totals.meta.scheduleLines ?? 0),
                  }
                : null
            }
            existingAwards={awards}
          />

          <Panel
            title="Quality gate"
            subtitle="Computed from the buyer’s own gating questions. A missing answer is never a pass."
          >
            <ul className="divide-y divide-[var(--line)]">
              {gate.map((g) => (
                <li key={g.vendorId} className="flex items-start gap-3 px-4 py-2.5">
                  <span className="w-56 shrink-0 text-[13px] font-medium text-slate-800">{g.vendorName}</span>
                  {g.cleared ? (
                    <Badge tone="ok">cleared</Badge>
                  ) : (
                    <div className="flex-1">
                      <Badge tone="bad">not cleared</Badge>
                      <ul className="mt-1 space-y-0.5">
                        {[...g.failures, ...g.unanswered.map((u) => `${u} — not answered`)].map((f, i) => (
                          <li key={i} className="text-[12px] leading-relaxed text-slate-600">
                            {f}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </Panel>
        </div>

        <div className="space-y-5">
          {(openReviews?.n ?? 0) > 0 && (
            <Caveats
              label="Deciding with open questions"
              items={[
                `${openReviews!.n} review item(s) are still open. Any award recorded now stores that fact alongside the decision, so a later challenge shows exactly what was and was not settled.`,
              ]}
            />
          )}

          <Panel
            title="Audit trail"
            subtitle="Append-only. No code path updates or deletes a row in this table."
            right={
              <a
                href={`/api/export?rfxId=${id}&type=audit`}
                className="rounded-md border border-slate-300 px-2.5 py-1 text-[12px] font-medium text-slate-700 hover:bg-slate-50"
              >
                Export CSV
              </a>
            }
          >
            <ul className="max-h-[560px] divide-y divide-[var(--line)] overflow-auto">
              {audit.map((a, i) => (
                <li key={i} className="px-4 py-2.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[12px] font-medium text-slate-800">{a.action}</span>
                    <span className="num text-[11px] text-slate-400">
                      {a.at.slice(0, 19).replace('T', ' ')}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    {a.actor} · {a.entity} {a.entity_id.slice(0, 20)}
                  </p>
                  {a.after_json && a.after_json !== 'null' && (
                    <p className="num mt-1 line-clamp-2 text-[11px] leading-relaxed text-slate-500">
                      {a.after_json.slice(0, 240)}
                    </p>
                  )}
                </li>
              ))}
              {audit.length === 0 && (
                <li className="px-4 py-6 text-center text-[13px] text-slate-500">Nothing recorded yet.</li>
              )}
            </ul>
          </Panel>

          <Panel title="Export the whole decision">
            <div className="flex flex-wrap gap-2 px-4 py-3.5">
              {[
                ['provenance', 'Every line with its source'],
                ['comparison', 'Price matrix'],
                ['split', 'Split award'],
                ['totals', 'Totals'],
                ['questionnaire', 'Questionnaire'],
                ['notes', 'Discounts'],
                ['coverage', 'Coverage'],
                ['audit', 'Audit trail'],
              ].map(([t, label]) => (
                <a
                  key={t}
                  href={`/api/export?rfxId=${id}&type=${t}`}
                  className="rounded-md border border-slate-300 px-2.5 py-1.5 text-[12px] font-medium text-slate-700 hover:bg-slate-50"
                >
                  {label}
                </a>
              ))}
            </div>
            <p className="border-t border-[var(--line)] px-4 py-2.5 text-[11px] leading-relaxed text-slate-500">
              Every cell is sanitised against spreadsheet formula injection before it is written.
              These files are opened in Excel by people who did not write them.
            </p>
          </Panel>
        </div>
      </div>
    </Shell>
  );
}
