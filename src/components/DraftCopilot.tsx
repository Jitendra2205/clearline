'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge, Caveats, Panel } from './ui';

interface DraftLine {
  code: string;
  description: string;
  product_type: string;
  ply: number | null;
  gsm: number | null;
  board_grade: string | null;
  length_mm: number | null;
  width_mm: number | null;
  height_mm: number | null;
  print: string | null;
  notes: string | null;
  canonical_uom: string;
  annual_qty: number;
}

interface Draft {
  title: string;
  category: string;
  base_currency: string;
  delivery_location: string | null;
  incoterm: string | null;
  payment_terms: string | null;
  closes_at: string | null;
  lines: DraftLine[];
  questions: { question: string; answer_type: string; gate_requires: string | null }[];
  assumptions: string[];
}

const EXAMPLE =
  'I need about 30 lines of corrugated packaging for our Bangalore and Pune plants for FY26. Mix of 3-ply and 5-ply RSC shippers from roughly 30x23x15 cm up to 60x40x40 cm, some die-cut mailers for e-commerce, partition sets, layer pads, and a couple of roll stock lines priced by weight. Volumes are high — the small mailer runs about 300,000 a year. I need a quality questionnaire: ISO 9001 and per-lot burst strength reports should both be pass/fail. Delivery to plant, net 45 days.';

const UOMS = ['piece', 'set', 'kg', '100_pieces', 'sqm', 'metre'];

export default function DraftCopilot() {
  const router = useRouter();
  const [brief, setBrief] = useState(EXAMPLE);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brief }),
      });
      const data = (await res.json()) as { draft?: Draft; error?: string; kind?: string };
      if (!res.ok) {
        setError(
          data.kind === 'no_api_key'
            ? 'ANTHROPIC_API_KEY is not set. The co-pilot is a real model call and will not run without it.'
            : (data.error ?? 'The co-pilot failed.'),
        );
        return;
      }
      setDraft(data.draft ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    const res = await fetch('/api/draft', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ draft }),
    });
    setSaving(false);
    const data = (await res.json()) as { rfxId?: string; error?: string };
    if (!res.ok || !data.rfxId) {
      setError(data.error ?? 'Could not save the RFx.');
      return;
    }
    router.push(`/rfx/${data.rfxId}`);
  }

  function editLine(i: number, patch: Partial<DraftLine>) {
    if (!draft) return;
    const lines = [...draft.lines];
    lines[i] = { ...lines[i], ...patch };
    setDraft({ ...draft, lines });
  }

  return (
    <div className="space-y-5">
      <Panel title="What do you need to buy?">
        <div className="px-4 py-3.5">
          <textarea
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            rows={5}
            className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-[13px] leading-relaxed outline-none focus:border-slate-900"
          />
          <div className="mt-3 flex items-center gap-3">
            <button
              onClick={generate}
              disabled={busy || !brief.trim()}
              className="rounded-lg bg-slate-900 px-3.5 py-2 text-[13px] font-medium text-white transition hover:bg-slate-800 disabled:opacity-50"
            >
              {busy ? 'Drafting…' : draft ? 'Redraft' : 'Draft the RFx'}
            </button>
            {error && <p className="text-[12px] text-red-700">{error}</p>}
          </div>
        </div>
      </Panel>

      {draft && (
        <>
          {draft.assumptions.length > 0 && (
            <Caveats
              label="What the co-pilot filled in that you never said"
              items={draft.assumptions}
            />
          )}

          <Panel
            title={draft.title}
            subtitle={`${draft.category} · ${draft.lines.length} lines · ${draft.questions.length} questions · base currency ${draft.base_currency}`}
            right={
              <button
                onClick={commit}
                disabled={saving}
                className="rounded-lg bg-slate-900 px-3.5 py-2 text-[13px] font-medium text-white transition hover:bg-slate-800 disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Accept and create RFx'}
              </button>
            }
          >
            <div className="max-h-[520px] overflow-auto">
              <table className="grid text-[12.5px]">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Description</th>
                    <th>Spec (canonicalised)</th>
                    <th>Priced per</th>
                    <th className="text-right">Annual qty</th>
                  </tr>
                </thead>
                <tbody>
                  {draft.lines.map((l, i) => (
                    <tr key={i}>
                      <td className="font-medium text-slate-900">{l.code}</td>
                      <td className="min-w-[280px]">
                        <input
                          value={l.description}
                          onChange={(e) => editLine(i, { description: e.target.value })}
                          className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-[12.5px] hover:border-slate-200 focus:border-slate-900 focus:outline-none"
                        />
                      </td>
                      <td className="whitespace-nowrap text-[11px] text-slate-500">
                        {l.ply ? `${l.ply}-ply · ` : ''}
                        {[l.length_mm, l.width_mm, l.height_mm].filter(Boolean).join(' × ') || '—'}
                        {[l.length_mm, l.width_mm, l.height_mm].some(Boolean) ? ' mm' : ''}
                        {l.gsm ? ` · ${l.gsm} GSM` : ''}
                      </td>
                      <td>
                        <select
                          value={l.canonical_uom}
                          onChange={(e) => editLine(i, { canonical_uom: e.target.value })}
                          className="rounded border border-slate-200 bg-white px-1 py-0.5 text-[11px]"
                        >
                          {UOMS.map((u) => (
                            <option key={u} value={u}>
                              {u.replace('_', ' ')}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="text-right">
                        <input
                          type="number"
                          value={l.annual_qty}
                          onChange={(e) => editLine(i, { annual_qty: Number(e.target.value) })}
                          className="num w-24 rounded border border-transparent bg-transparent px-1 py-0.5 text-right hover:border-slate-200 focus:border-slate-900 focus:outline-none"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel title="Questionnaire">
            <ul className="divide-y divide-[var(--line)]">
              {draft.questions.map((q, i) => (
                <li key={i} className="flex items-start gap-3 px-4 py-2.5">
                  <span className="mt-0.5 text-[11px] text-slate-400">Q{i + 1}</span>
                  <p className="flex-1 text-[13px] leading-relaxed text-slate-700">{q.question}</p>
                  <Badge>{q.answer_type}</Badge>
                  {q.gate_requires && <Badge tone="accent">gates</Badge>}
                </li>
              ))}
            </ul>
          </Panel>
        </>
      )}
    </div>
  );
}
