'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Badge, ConfidenceBadge, Coverage, Panel, TierBadge, Caveats } from './ui';

export interface GridCell {
  rawDescription: string;
  rawPrice: string;
  rawUom: string | null;
  parsedPrice: number | null;
  normalizedPrice: number | null;
  normalizationNote: string | null;
  matchTier: string;
  matchScore: number | null;
  matchReason: string | null;
  confidence: string;
  flags: string[];
  blocked: boolean;
  sourcePage: number | null;
  sourceLocator: string | null;
  snippet: string;
  docUrl: string | null;
}

export interface GridVendor {
  id: string;
  name: string;
  currency: string | null;
  incoterm: string | null;
  validity: string | null;
  filename: string;
  docUrl: string;
  comparable: number;
  held: number;
  gateCleared: boolean;
  gateDetail: string[];
  /** What the vendor said about the lines they did not price. */
  unquotedNote: string | null;
}

interface Line {
  id: string;
  lineNo: number;
  code: string;
  description: string;
  uom: string;
  annualQty: number;
}

function money(n: number): string {
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Did the number on screen actually change from what the vendor wrote?
 *
 * "Rs 25.40 per piece" rendered as "25.40, from 25.40 per piece" tells the buyer
 * nothing and repeated on 100+ cells it buries the handful that did convert.
 * A currency or unit change always moves the number or the unit, so compare
 * both and stay quiet when neither moved.
 */
function wasConverted(
  c: { rawPrice: string | null; rawUom: string | null; normalizedPrice: number | null },
  lineUom: string,
): boolean {
  if (c.normalizedPrice === null) return true;
  const m = String(c.rawPrice ?? '').match(/[0-9]+(?:[.][0-9]+)?/);
  const rawNum = m === null ? NaN : Number(m[0]);
  const sameNumber = Number.isFinite(rawNum) && Math.abs(rawNum - c.normalizedPrice) < 0.005;
  const rawU = String(c.rawUom ?? '').replace(/^per\s+/i, '').trim().toLowerCase();
  const lineU = lineUom.replace(/_/g, ' ').toLowerCase();
  const sameUom = rawU.length === 0 || rawU === lineU || (rawU === "pc" && lineU === "piece");
  return !(sameNumber && sameUom);
}

/**
 * A match badge on every cell is 100+ repetitions of "fuzzy 1.00". Show one only
 * where it changes what the buyer should do: a model proposal, an unmatched line,
 * or a deterministic score that is not a clean 1.00. The full tier and score stay
 * one click away in the provenance drawer.
 */
function needsMatchBadge(c: { matchTier: string; matchScore: number | null }): boolean {
  if (c.matchTier === "semantic" || c.matchTier === "unmatched") return true;
  return c.matchScore !== null && c.matchScore < 1;
}

export default function CompareGrid({
  rfxId,
  lines,
  vendors,
  grid,
  openReviews,
  unmatchedCount,
  commercialNotes,
}: {
  rfxId: string;
  baseCurrency: string;
  lines: Line[];
  vendors: GridVendor[];
  grid: Record<string, Record<string, GridCell>>;
  openReviews: number;
  unmatchedCount: number;
  commercialNotes: { vendor: string; kind: string; text: string; percent: number | null }[];
}) {
  const [drawer, setDrawer] = useState<{ cell: GridCell; line: Line; vendor: GridVendor } | null>(null);
  const [clearedOnly, setClearedOnly] = useState(false);
  const [showHeld, setShowHeld] = useState(true);

  const shown = useMemo(
    () => (clearedOnly ? vendors.filter((v) => v.gateCleared) : vendors),
    [clearedOnly, vendors],
  );

  // The cheapest comparable price per line, computed here for highlighting only.
  const cheapest = useMemo(() => {
    const out: Record<string, { vendorId: string; price: number } | null> = {};
    for (const l of lines) {
      const row = grid[l.id] ?? {};
      let best: { vendorId: string; price: number } | null = null;
      for (const v of shown) {
        const c = row[v.id];
        if (!c || c.blocked || c.normalizedPrice === null) continue;
        if (!best || c.normalizedPrice < best.price) best = { vendorId: v.id, price: c.normalizedPrice };
      }
      out[l.id] = best;
    }
    return out;
  }, [lines, grid, shown]);

  if (vendors.length === 0) {
    return (
      <Panel>
        <div className="px-6 py-16 text-center">
          <h3 className="text-sm font-semibold text-slate-900">Nothing extracted yet</h3>
          <p className="mx-auto mt-1.5 max-w-md text-sm text-slate-500">
            Vendor documents are in, but none have been read. Run extraction from the RFx &amp;
            responses tab and the grid fills in.
          </p>
          <Link
            href={`/rfx/${rfxId}`}
            className="mt-4 inline-block rounded-lg bg-slate-900 px-3.5 py-2 text-[13px] font-medium text-white"
          >
            Go to responses
          </Link>
        </div>
      </Panel>
    );
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-[13px] text-slate-700">
          <input
            type="checkbox"
            checked={clearedOnly}
            onChange={(e) => setClearedOnly(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-slate-300"
          />
          Only vendors that cleared the quality questionnaire
        </label>
        <label className="flex items-center gap-2 text-[13px] text-slate-700">
          <input
            type="checkbox"
            checked={showHeld}
            onChange={(e) => setShowHeld(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-slate-300"
          />
          Show lines held for review
        </label>
        <div className="ml-auto flex items-center gap-2">
          {(['comparison', 'split', 'provenance'] as const).map((t) => (
            <a
              key={t}
              href={`/api/export?rfxId=${rfxId}&type=${t}&cleared=${clearedOnly ? '1' : '0'}`}
              className="rounded-md border border-slate-300 px-2.5 py-1.5 text-[12px] font-medium text-slate-700 transition hover:bg-slate-50"
            >
              Export {t}
            </a>
          ))}
        </div>
      </div>

      {openReviews > 0 && (
        <div className="mb-4">
          <Caveats
            label="Some lines are held for review"
            items={[
              `${openReviews} review item(s) are open. Every line behind them is held out of the comparison rather than shown as a number nobody has checked.`,
              ...(unmatchedCount > 0
                ? [`${unmatchedCount} vendor line(s) could not be matched to any RFx line at all.`]
                : []),
            ]}
          />
        </div>
      )}

      <Panel>
        <div className="max-h-[70vh] overflow-auto">
          <table className="grid text-[13px]">
            <thead>
              <tr>
                <th className="sticky-col min-w-[300px]" style={{ zIndex: 20 }}>
                  RFx line
                </th>
                <th className="whitespace-nowrap">Basis</th>
                {shown.map((v) => (
                  <th key={v.id} className="min-w-[170px]">
                    <div className="space-y-1 py-0.5">
                      <div className="text-[13px] font-semibold normal-case tracking-normal text-slate-900">
                        {v.name}
                      </div>
                      <div className="flex flex-wrap items-center gap-1">
                        <Coverage quoted={v.comparable} total={lines.length} />
                        {v.held > 0 && <Badge tone="warn">{v.held} held</Badge>}
                      </div>
                      <div className="flex flex-wrap items-center gap-1">
                        {v.gateCleared ? (
                          <Badge tone="ok" title="Answered every gating question the required way.">
                            quality cleared
                          </Badge>
                        ) : (
                          <Badge tone="bad" title={v.gateDetail.join(' · ')}>
                            gate NOT cleared
                          </Badge>
                        )}
                        {v.currency ? (
                          <Badge tone="neutral">{v.currency}</Badge>
                        ) : (
                          <Badge tone="bad" title="The document never stated a currency. Nothing was assumed.">
                            no currency stated
                          </Badge>
                        )}
                        {v.incoterm === null && (
                          <Badge
                            tone="warn"
                            title="No delivery basis stated, so these prices are not comparable with delivered quotes on a landed-cost basis."
                          >
                            no incoterm
                          </Badge>
                        )}
                      </div>
                      {v.unquotedNote && (
                        <p
                          className="max-w-[170px] text-[10.5px] font-normal normal-case leading-snug tracking-normal text-amber-800"
                          title={v.unquotedNote}
                        >
                          {v.unquotedNote.length > 90 ? `${v.unquotedNote.slice(0, 89)}…` : v.unquotedNote}
                        </p>
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const row = grid[l.id] ?? {};
                const best = cheapest[l.id];
                return (
                  <tr key={l.id}>
                    <td className="sticky-col">
                      <div className="font-medium text-slate-900">{l.code}</div>
                      <div className="mt-0.5 max-w-[300px] text-[12px] leading-snug text-slate-500">
                        {l.description}
                      </div>
                    </td>
                    <td className="whitespace-nowrap text-[11px] text-slate-500">
                      per {l.uom.replace('_', ' ')}
                      <div className="num mt-0.5 text-[11px] text-slate-400">
                        {l.annualQty.toLocaleString('en-IN')}/yr
                      </div>
                    </td>

                    {shown.map((v) => {
                      const c = row[v.id];

                      if (!c) {
                        return (
                          <td key={v.id} className="bg-slate-50/50">
                            <span
                              className="text-[12px] font-medium text-slate-400"
                              title="This vendor did not quote this line. It is not zero, and it is not estimated."
                            >
                              Not quoted
                            </span>
                          </td>
                        );
                      }

                      if (c.blocked) {
                        if (!showHeld) {
                          return (
                            <td key={v.id} className="bg-slate-50/50">
                              <span className="text-[12px] text-slate-400">—</span>
                            </td>
                          );
                        }
                        return (
                          <td key={v.id} className="bg-amber-50/40">
                            <button
                              onClick={() => setDrawer({ cell: c, line: l, vendor: v })}
                              className="w-full text-left"
                            >
                              <div className="num text-amber-800 line-through decoration-amber-300">
                                {c.normalizedPrice !== null ? money(c.normalizedPrice) : c.rawPrice}
                              </div>
                              <div className="mt-1 flex flex-wrap gap-1">
                                <Badge tone="warn" title="Held out of every comparison until a human resolves it.">
                                  held
                                </Badge>
                                <TierBadge tier={c.matchTier} score={c.matchScore} />
                              </div>
                            </button>
                          </td>
                        );
                      }

                      const isBest = best?.vendorId === v.id;
                      return (
                        <td
                          key={v.id}
                          className={
                            isBest
                              ? 'bg-emerald-50 border-l-2 border-l-emerald-500'
                              : undefined
                          }
                        >
                          <button
                            onClick={() => setDrawer({ cell: c, line: l, vendor: v })}
                            className="w-full text-left"
                            title="Click for the source document, page, and the verbatim text this number came from."
                          >
                            <div className={`num font-semibold ${isBest ? 'text-emerald-800' : 'text-slate-900'}`}>
                              {c.normalizedPrice !== null ? money(c.normalizedPrice) : '—'}
                            </div>
                            {isBest && (
                              <div className="mt-0.5 text-[10.5px] font-medium uppercase tracking-wide text-emerald-700">
                                lowest
                              </div>
                            )}
                            {c.normalizationNote && wasConverted(c, l.uom) && (
                              <div className="mt-0.5 text-[10.5px] leading-tight text-slate-400">
                                from {c.rawPrice}
                                {c.rawUom ? ` ${c.rawUom}` : ''}
                              </div>
                            )}
                            {(needsMatchBadge(c) || c.confidence !== 'high') && (
                              <div className="mt-1 flex flex-wrap gap-1">
                                {needsMatchBadge(c) && (
                                  <TierBadge tier={c.matchTier} score={c.matchScore} />
                                )}
                                {c.confidence !== 'high' && <ConfidenceBadge level={c.confidence} />}
                              </div>
                            )}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel
          title="Discounts and conditions found in the documents"
          subtitle="Recorded, never applied. Applying a conditional discount is a commercial judgement, not an extraction result."
        >
          {commercialNotes.length === 0 ? (
            <p className="px-4 py-4 text-[13px] text-slate-500">Nothing recorded yet.</p>
          ) : (
            <ul className="divide-y divide-[var(--line)]">
              {commercialNotes.map((n, i) => (
                <li key={i} className="flex gap-3 px-4 py-2.5">
                  <span className="w-32 shrink-0 text-[12px] font-medium text-slate-700">{n.vendor}</span>
                  <Badge tone={n.kind === 'discount' ? 'accent' : n.kind === 'surcharge' ? 'warn' : 'neutral'}>
                    {n.kind}
                    {n.percent !== null ? ` ${n.percent}%` : ''}
                  </Badge>
                  <span className="flex-1 text-[12px] leading-relaxed text-slate-600">{n.text}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="How to read this grid">
          <ul className="space-y-2.5 px-4 py-3.5 text-[12.5px] leading-relaxed text-slate-600">
            <li className="flex gap-2">
              <TierBadge tier="exact" />
              <span>The vendor quoted against our own line code. No inference at all.</span>
            </li>
            <li className="flex gap-2">
              <TierBadge tier="fuzzy" score={0.94} />
              <span>
                Matched by deterministic scoring on ply, dimensions in mm and product type. No model
                involved — the same input always scores the same, and the score is shown.
              </span>
            </li>
            <li className="flex gap-2">
              <TierBadge tier="semantic" score={0.8} />
              <span>
                A model proposal. Always held out of the comparison until a buyer confirms it in the
                review queue.
              </span>
            </li>
            <li className="flex gap-2">
              <Badge tone="neutral">Not quoted</Badge>
              <span>
                The vendor did not offer this line. Never rendered as zero, never estimated, never
                carried over from last year.
              </span>
            </li>
          </ul>
        </Panel>
      </div>

      {drawer && (
        <ProvenanceDrawer
          cell={drawer.cell}
          line={drawer.line}
          vendor={drawer.vendor}
          onClose={() => setDrawer(null)}
        />
      )}
    </>
  );
}

function ProvenanceDrawer({
  cell,
  line,
  vendor,
  onClose,
}: {
  cell: GridCell;
  line: Line;
  vendor: GridVendor;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-slate-900/20" onClick={onClose} />
      <aside className="relative flex h-full w-full max-w-lg flex-col overflow-y-auto bg-white shadow-2xl">
        <header className="sticky top-0 flex items-start justify-between gap-4 border-b border-[var(--line)] bg-white px-5 py-4">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-slate-500">Where this number came from</p>
            <h3 className="mt-0.5 text-sm font-semibold text-slate-900">
              {line.code} · {vendor.name}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="rounded-md px-2 py-1 text-[13px] text-slate-500 hover:bg-slate-100"
          >
            Close
          </button>
        </header>

        <div className="space-y-5 px-5 py-4">
          <section>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Verbatim from the document
            </p>
            <blockquote className="num mt-1.5 whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-[12px] leading-relaxed text-slate-800">
              {cell.snippet || '(no snippet recorded)'}
            </blockquote>
            <p className="mt-1.5 text-[11px] text-slate-500">
              {vendor.filename}
              {cell.sourcePage !== null ? ` · page ${cell.sourcePage}` : ''}
              {cell.sourceLocator ? ` · ${cell.sourceLocator}` : ''}
            </p>
            {cell.docUrl && (
              <a
                href={cell.docUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-1.5 inline-block text-[12px] font-medium text-indigo-700 hover:underline"
              >
                Open the source document →
              </a>
            )}
          </section>

          <section className="grid grid-cols-2 gap-3 text-[12px]">
            <Field label="As the vendor wrote it" value={cell.rawDescription} />
            <Field label="Raw price" value={`${cell.rawPrice}${cell.rawUom ? ` ${cell.rawUom}` : ''}`} />
            <Field
              label="Normalised"
              value={cell.normalizedPrice !== null ? `${money(cell.normalizedPrice)} per ${line.uom.replace('_', ' ')}` : 'not normalised'}
            />
            <Field label="Extraction confidence" value={<ConfidenceBadge level={cell.confidence} />} />
          </section>

          {cell.normalizationNote && (
            <section>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Conversion applied
              </p>
              <p className="mt-1.5 rounded-lg border border-indigo-200 bg-indigo-50/60 px-3 py-2 text-[12px] leading-relaxed text-indigo-900">
                {cell.normalizationNote}
              </p>
            </section>
          )}

          <section>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              How it was matched to {line.code}
            </p>
            <div className="mt-1.5 flex items-center gap-2">
              <TierBadge tier={cell.matchTier} score={cell.matchScore} />
            </div>
            {cell.matchReason && (
              <p className="mt-1.5 text-[12px] leading-relaxed text-slate-600">{cell.matchReason}</p>
            )}
          </section>

          {cell.flags.length > 0 && (
            <section>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Ambiguity flagged by the extractor
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {cell.flags.map((f) => (
                  <Badge key={f} tone="warn">
                    {f.replace(/_/g, ' ')}
                  </Badge>
                ))}
              </div>
            </section>
          )}

          {cell.blocked && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-[12px] leading-relaxed text-amber-900">
              This line is held out of every comparison and every total until it is resolved in the
              review queue.
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <div className="mt-1 text-[12px] leading-relaxed text-slate-800">{value}</div>
    </div>
  );
}
