'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge, Caveats, Panel } from './ui';

const MONEY = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

export default function AwardPanel({
  rfxId,
  canAward,
  openReviews,
  split,
  totals,
  existingAwards,
}: {
  rfxId: string;
  canAward: boolean;
  openReviews: number;
  split: {
    awardedLines: number;
    totalLines: number;
    splitTotal: number;
    byVendor: Record<string, { lines: number; value: number }>;
    caveats: string[];
  } | null;
  totals: { columns: string[]; rows: (string | number | null)[][]; caveats: string[]; basisLines: number; scheduleLines: number } | null;
  existingAwards: { id: string; strategy: string; rationale: string | null; decided_by: string; decided_at: string }[];
}) {
  const router = useRouter();
  const [strategy, setStrategy] = useState<'split_cheapest_per_line' | 'single_lowest_total'>('split_cheapest_per_line');
  const [rationale, setRationale] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function record() {
    setBusy(true);
    setError(null);
    const res = await fetch('/api/award', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rfxId, strategy, rationale, clearedOnly: true }),
    });
    setBusy(false);
    if (!res.ok) {
      setError(((await res.json()) as { error?: string }).error ?? 'Could not record the award.');
      return;
    }
    setRationale('');
    router.refresh();
  }

  if (!canAward) {
    return (
      <Panel title="Award">
        <p className="px-4 py-6 text-center text-[13px] text-slate-500">
          Nothing has been extracted yet, so there is nothing to award.
        </p>
      </Panel>
    );
  }

  const singleBest = totals?.rows[0];

  return (
    <>
      <Panel
        title="Two defensible options"
        subtitle="Both are computed over vendors that cleared the quality gate, over lines those vendors quoted comparably. Neither applies any vendor discount."
      >
        <div className="grid gap-0 sm:grid-cols-2 sm:divide-x sm:divide-[var(--line)]">
          <button
            onClick={() => setStrategy('split_cheapest_per_line')}
            className={`px-4 py-4 text-left transition ${strategy === 'split_cheapest_per_line' ? 'bg-indigo-50/60' : 'hover:bg-slate-50'}`}
          >
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-semibold text-slate-900">Split, cheapest per line</span>
              {strategy === 'split_cheapest_per_line' && <Badge tone="accent">selected</Badge>}
            </div>
            {split && (
              <>
                <p className="num mt-2 text-xl font-semibold text-slate-900">{MONEY(split.splitTotal)}</p>
                <p className="mt-0.5 text-[12px] text-slate-500">
                  annual, across {split.awardedLines} of {split.totalLines} lines
                </p>
                <ul className="mt-2.5 space-y-1">
                  {Object.entries(split.byVendor)
                    .sort((a, b) => b[1].value - a[1].value)
                    .map(([name, v]) => (
                      <li key={name} className="flex items-baseline justify-between gap-3 text-[12px]">
                        <span className="text-slate-700">{name}</span>
                        <span className="num text-slate-500">
                          {v.lines} lines · {MONEY(v.value)}
                        </span>
                      </li>
                    ))}
                </ul>
              </>
            )}
          </button>

          <button
            onClick={() => setStrategy('single_lowest_total')}
            className={`px-4 py-4 text-left transition ${strategy === 'single_lowest_total' ? 'bg-indigo-50/60' : 'hover:bg-slate-50'}`}
          >
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-semibold text-slate-900">Single supplier, lowest total</span>
              {strategy === 'single_lowest_total' && <Badge tone="accent">selected</Badge>}
            </div>
            {singleBest && (
              <>
                <p className="num mt-2 text-xl font-semibold text-slate-900">
                  {MONEY(Number(singleBest[2] ?? 0))}
                </p>
                <p className="mt-0.5 text-[12px] text-slate-500">
                  annual to {String(singleBest[0])}, over {totals?.basisLines} like-for-like lines
                </p>
                <ul className="mt-2.5 space-y-1">
                  {totals?.rows.map((r, i) => {
                    const quoted = Number(r[3] ?? 0);
                    const partial = quoted < (totals.scheduleLines ?? quoted);
                    return (
                      <li key={i} className="flex items-baseline justify-between gap-3 text-[12px]">
                        <span className="text-slate-700">
                          {String(r[0])}
                          {partial && (
                            <span
                              className="ml-1.5 text-[11px] text-amber-700"
                              title="This vendor did not quote the whole schedule, so they cannot take a single-supplier award."
                              >
                              quoted {quoted}/{totals.scheduleLines}
                            </span>
                          )}
                        </span>
                        <span className="num text-slate-500">{MONEY(Number(r[2] ?? 0))}</span>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </button>
        </div>

        <div className="space-y-3 border-t border-[var(--line)] px-4 py-3.5">
          <Caveats
            items={(strategy === 'split_cheapest_per_line' ? split?.caveats : totals?.caveats) ?? []}
          />

          <label className="block">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">
              Rationale for the record
            </span>
            <textarea
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              rows={3}
              placeholder="Why this option, and what you accepted in choosing it."
              className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-[13px] outline-none focus:border-slate-900"
            />
          </label>

          <div className="flex items-center gap-3">
            <button
              onClick={record}
              disabled={busy}
              className="rounded-lg bg-slate-900 px-3.5 py-2 text-[13px] font-medium text-white transition hover:bg-slate-800 disabled:opacity-50"
            >
              {busy ? 'Recording…' : 'Record this award decision'}
            </button>
            {openReviews > 0 && (
              <span className="text-[12px] text-amber-800">
                {openReviews} review item(s) still open — this will be recorded with the decision.
              </span>
            )}
          </div>
          {error && <p className="text-[12px] text-red-700">{error}</p>}
        </div>
      </Panel>

      {existingAwards.length > 0 && (
        <Panel title="Decisions recorded" subtitle="Each one snapshots the numbers exactly as they stood at the moment it was made.">
          <ul className="divide-y divide-[var(--line)]">
            {existingAwards.map((a) => (
              <li key={a.id} className="px-4 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[13px] font-medium text-slate-900">
                    {a.strategy.replace(/_/g, ' ')}
                  </span>
                  <span className="num text-[11px] text-slate-400">
                    {a.decided_at.slice(0, 19).replace('T', ' ')}
                  </span>
                </div>
                {a.rationale && (
                  <p className="mt-1 text-[12px] leading-relaxed text-slate-600">{a.rationale}</p>
                )}
                <p className="mt-1 text-[11px] text-slate-500">by {a.decided_by}</p>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </>
  );
}
