'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge, ConfidenceBadge, Panel, TierBadge, EmptyState } from './ui';

export interface ReviewRow {
  id: string;
  kind: string;
  detail: string;
  status: string;
  resolution: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  vendorName: string;
  lineCode: string | null;
  rawDescription: string | null;
  rawPrice: string | null;
  rawUom: string | null;
  parsedPrice: number | null;
  matchTier: string | null;
  matchScore: number | null;
  matchReason: string | null;
  confidence: string | null;
  currency: string | null;
  snippet: string | null;
  locator: string | null;
  page: number | null;
  filename: string;
  docUrl: string;
}

const KIND_LABEL: Record<string, { title: string; why: string }> = {
  currency_not_stated: {
    title: 'Currency not stated',
    why: 'The document never says what currency these prices are in. The vendor’s country is not evidence, so nothing was assumed.',
  },
  uom_not_convertible: {
    title: 'Unit of measure cannot be converted',
    why: 'The vendor priced on a basis with no declared conversion factor. Inventing one would invent the price.',
  },
  low_confidence_extraction: {
    title: 'Extractor was not confident',
    why: 'The value was partly illegible or reconstructed. The extractor said so rather than guessing confidently.',
  },
  semantic_match_unconfirmed: {
    title: 'Model-proposed line match',
    why: 'Deterministic matching could not place this line, so a model proposed one. Proposals never count until a human agrees.',
  },
  price_outside_band: {
    title: 'Price far outside the peer range',
    why: 'This number does not look like the other quotes for the same physical item. That is what a bad extraction — or a tampered document — looks like.',
  },
  snippet_mismatch: {
    title: 'Cited source text not found in the document',
    why: 'The extractor claimed a verbatim quote that is not in the file we rendered. Provenance failed, so the value is not trusted.',
  },
  unmatched_line: {
    title: 'Could not match to any RFx line',
    why: 'No tier could place this vendor line against the schedule. It is excluded rather than guessed at.',
  },
};

export default function ReviewQueue({
  items,
  lineCodes,
}: {
  items: ReviewRow[];
  lineCodes: { code: string; description: string }[];
}) {
  const [showResolved, setShowResolved] = useState(false);
  const visible = items.filter((i) => (showResolved ? true : i.status === 'open'));

  if (items.length === 0) {
    return (
      <Panel>
        <EmptyState
          title="No review items"
          body="Either nothing has been extracted yet, or every line cleared automatically. Run extraction from the RFx & responses tab."
        />
      </Panel>
    );
  }

  return (
    <>
      <label className="mb-4 flex items-center gap-2 text-[13px] text-slate-700">
        <input
          type="checkbox"
          checked={showResolved}
          onChange={(e) => setShowResolved(e.target.checked)}
          className="h-3.5 w-3.5 rounded border-slate-300"
        />
        Show resolved items ({items.filter((i) => i.status !== 'open').length})
      </label>

      {visible.length === 0 ? (
        <Panel>
          <EmptyState
            title="Queue is clear"
            body="Every flagged line has been resolved. The comparison grid is now complete to the extent the source documents allow."
          />
        </Panel>
      ) : (
        <div className="space-y-3">
          {visible.map((item) => (
            <ReviewCard key={item.id} item={item} lineCodes={lineCodes} />
          ))}
        </div>
      )}
    </>
  );
}

function ReviewCard({
  item,
  lineCodes,
}: {
  item: ReviewRow;
  lineCodes: { code: string; description: string }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currency, setCurrency] = useState('INR');
  const [factor, setFactor] = useState('');
  const [factorNote, setFactorNote] = useState('');
  const [reassign, setReassign] = useState(item.lineCode ?? '');
  const [price, setPrice] = useState('');

  const meta = KIND_LABEL[item.kind] ?? { title: item.kind.replace(/_/g, ' '), why: '' };
  const resolved = item.status !== 'open';

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const res = await fetch('/api/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, itemId: item.id }),
    });
    setBusy(false);
    if (!res.ok) {
      setError(((await res.json()) as { error?: string }).error ?? 'Action failed.');
      return;
    }
    router.refresh();
  }

  return (
    <section className={`panel ${resolved ? 'opacity-70' : ''}`}>
      <header className="flex flex-wrap items-center gap-2 border-b border-[var(--line)] px-4 py-3">
        <Badge tone={resolved ? 'neutral' : 'warn'}>{meta.title}</Badge>
        <span className="text-[13px] font-medium text-slate-900">{item.vendorName}</span>
        {item.lineCode && <span className="text-[13px] text-slate-500">→ {item.lineCode}</span>}
        <div className="ml-auto flex items-center gap-1.5">
          {item.matchTier && <TierBadge tier={item.matchTier} score={item.matchScore} />}
          {item.confidence && <ConfidenceBadge level={item.confidence} />}
          {resolved && <Badge tone="ok">{item.status}</Badge>}
        </div>
      </header>

      <div className="grid gap-4 px-4 py-3.5 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-3">
          <p className="text-[13px] leading-relaxed text-slate-700">{item.detail}</p>
          {meta.why && <p className="text-[12px] leading-relaxed text-slate-500">{meta.why}</p>}

          {item.snippet && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Verbatim from the document
              </p>
              <blockquote className="num mt-1 whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] leading-relaxed text-slate-800">
                {item.snippet}
              </blockquote>
              <p className="mt-1 text-[11px] text-slate-500">
                {item.filename}
                {item.page !== null ? ` · page ${item.page}` : ''}
                {item.locator ? ` · ${item.locator}` : ''}
                {' · '}
                <a href={item.docUrl} target="_blank" rel="noreferrer" className="font-medium text-indigo-700 hover:underline">
                  open source
                </a>
              </p>
            </div>
          )}

          {item.rawDescription && (
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-[12px]">
              <span className="text-slate-500">
                As written: <span className="text-slate-800">{item.rawDescription}</span>
              </span>
              <span className="text-slate-500">
                Raw price:{' '}
                <span className="num text-slate-800">
                  {item.rawPrice}
                  {item.rawUom ? ` ${item.rawUom}` : ''}
                </span>
              </span>
            </div>
          )}

          {item.matchReason && (
            <p className="rounded-lg border border-indigo-200 bg-indigo-50/60 px-3 py-2 text-[12px] leading-relaxed text-indigo-900">
              {item.matchReason}
            </p>
          )}
        </div>

        <div className="space-y-2.5">
          {resolved ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2.5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-800">Resolved</p>
              <p className="mt-1 text-[12px] leading-relaxed text-emerald-900">{item.resolution}</p>
              <p className="mt-1 text-[11px] text-emerald-700">
                {item.resolvedBy} · {item.resolvedAt?.slice(0, 19).replace('T', ' ')}
              </p>
            </div>
          ) : (
            <>
              {item.kind === 'currency_not_stated' && (
                <Action label="Set the currency for this whole quote">
                  <div className="flex gap-2">
                    <select
                      value={currency}
                      onChange={(e) => setCurrency(e.target.value)}
                      className="flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-[12px]"
                    >
                      {['INR', 'USD', 'EUR', 'GBP', 'SGD'].map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                    <Btn onClick={() => act({ action: 'set_currency', currency })} busy={busy}>
                      Apply
                    </Btn>
                  </div>
                </Action>
              )}

              {item.kind === 'uom_not_convertible' && (
                <Action label="Supply the conversion factor">
                  <p className="mb-1.5 text-[11px] leading-relaxed text-slate-500">
                    The vendor quoted {item.rawUom ? `"${item.rawUom}"` : 'on an unstated basis'}. Enter
                    what to multiply their price by, and say where the number came from — it is
                    written into the audit trail.
                  </p>
                  <input
                    value={factor}
                    onChange={(e) => setFactor(e.target.value)}
                    placeholder="e.g. 0.02 for a 50-piece box"
                    className="mb-1.5 w-full rounded-md border border-slate-300 px-2 py-1.5 text-[12px]"
                  />
                  <input
                    value={factorNote}
                    onChange={(e) => setFactorNote(e.target.value)}
                    placeholder="Source, e.g. confirmed by phone with vendor 04/09"
                    className="mb-1.5 w-full rounded-md border border-slate-300 px-2 py-1.5 text-[12px]"
                  />
                  <Btn
                    onClick={() => act({ action: 'set_uom_factor', factor: Number(factor), note: factorNote })}
                    busy={busy}
                    disabled={!Number.isFinite(Number(factor)) || Number(factor) <= 0 || !factorNote.trim()}
                  >
                    Apply factor
                  </Btn>
                </Action>
              )}

              {(item.kind === 'semantic_match_unconfirmed' || item.kind === 'unmatched_line') && (
                <Action label="Assign to an RFx line">
                  <div className="flex gap-2">
                    <select
                      value={reassign}
                      onChange={(e) => setReassign(e.target.value)}
                      className="flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-[12px]"
                    >
                      <option value="">Choose a line…</option>
                      {lineCodes.map((l) => (
                        <option key={l.code} value={l.code}>
                          {l.code} — {l.description.slice(0, 52)}
                        </option>
                      ))}
                    </select>
                    <Btn onClick={() => act({ action: 'reassign', lineCode: reassign })} busy={busy} disabled={!reassign}>
                      Assign
                    </Btn>
                  </div>
                </Action>
              )}

              {(item.kind === 'low_confidence_extraction' || item.kind === 'price_outside_band' || item.kind === 'snippet_mismatch') && (
                <Action label="Correct the value from the source">
                  <div className="flex gap-2">
                    <input
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                      placeholder={item.parsedPrice !== null ? String(item.parsedPrice) : 'price'}
                      className="flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-[12px]"
                    />
                    <Btn
                      onClick={() => act({ action: 'set_price', price: Number(price) })}
                      busy={busy}
                      disabled={!Number.isFinite(Number(price)) || price.trim() === ''}
                    >
                      Set
                    </Btn>
                  </div>
                </Action>
              )}

              <div className="flex gap-2 pt-1">
                <Btn onClick={() => act({ action: 'accept' })} busy={busy} variant="primary">
                  Confirm as extracted
                </Btn>
                <Btn onClick={() => act({ action: 'dismiss' })} busy={busy} variant="ghost">
                  Exclude this line
                </Btn>
              </div>
              <p className="text-[11px] leading-relaxed text-slate-400">
                Every action here is recorded with who, when, and the value before and after.
              </p>
            </>
          )}

          {error && <p className="text-[12px] text-red-700">{error}</p>}
        </div>
      </div>
    </section>
  );
}

function Action({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2.5">
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-600">{label}</p>
      {children}
    </div>
  );
}

function Btn({
  children,
  onClick,
  busy,
  disabled,
  variant = 'default',
}: {
  children: React.ReactNode;
  onClick: () => void;
  busy: boolean;
  disabled?: boolean;
  variant?: 'default' | 'primary' | 'ghost';
}) {
  const cls = {
    default: 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
    primary: 'bg-slate-900 text-white hover:bg-slate-800',
    ghost: 'border border-slate-200 text-slate-500 hover:bg-slate-50',
  }[variant];
  return (
    <button
      onClick={onClick}
      disabled={busy || disabled}
      className={`whitespace-nowrap rounded-md px-2.5 py-1.5 text-[12px] font-medium transition disabled:opacity-40 ${cls}`}
    >
      {children}
    </button>
  );
}
