import { notFound } from 'next/navigation';
import { all, one, ready, j } from '@/lib/db/client';
import { signDocToken } from '@/lib/security/signed';
import { Shell, Panel, Badge, Stat } from '@/components/ui';
import ExtractPanel from '@/components/ExtractPanel';
import type { LineSpec } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function RfxOverview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await ready();

  const rfx = await one<{
    id: string; title: string; category: string; base_currency: string; delivery_location: string | null;
    incoterm: string | null; payment_terms: string | null; closes_at: string | null; status: string;
  }>('SELECT * FROM rfx WHERE id = ?', [id]);
  if (!rfx) notFound();

  const lines = await all<{
    line_no: number; code: string; description: string; spec_json: string;
    canonical_uom: string; annual_qty: number;
  }>('SELECT line_no, code, description, spec_json, canonical_uom, annual_qty FROM rfx_line WHERE rfx_id = ? ORDER BY line_no', [id]);

  const questions = await all<{ q_no: number; question: string; gate_json: string | null }>(
    'SELECT q_no, question, gate_json FROM questionnaire_question WHERE rfx_id = ? ORDER BY q_no', [id],
  );

  const vendors = await all<{
    id: string; name: string; country: string; email: string;
    doc_id: string | null; filename: string | null; mime: string | null; bytes: number | null;
    sha256: string | null;
  }>(
    `SELECT v.id, v.name, v.country, v.email, d.id AS doc_id, d.filename, d.mime, d.bytes, d.sha256
       FROM vendor v
       LEFT JOIN vendor_document d ON d.vendor_id = v.id AND d.rfx_id = ?
      WHERE v.org_id = (SELECT org_id FROM rfx WHERE id = ?)
      ORDER BY v.name`,
    [id, id],
  );

  const jobs = await all<{ doc_id: string; status: string; ms: number | null; input_tokens: number | null; output_tokens: number | null; error: string | null }>(
    'SELECT doc_id, status, ms, input_tokens, output_tokens, error FROM extraction_job WHERE rfx_id = ?', [id],
  );

  const quoteStats = await all<{ vendor_id: string; total: number; comparable: number; blocked: number }>(
    `SELECT vendor_id, COUNT(*) AS total,
            SUM(CASE WHEN blocked = 0 AND matched_line_id IS NOT NULL THEN 1 ELSE 0 END) AS comparable,
            SUM(blocked) AS blocked
       FROM quote_line WHERE rfx_id = ? GROUP BY vendor_id`,
    [id],
  );

  const openReviews = await one<{ n: number }>(
    "SELECT COUNT(*) AS n FROM review_item WHERE rfx_id = ? AND status = 'open'", [id],
  );
  const extracted = jobs.filter((x) => x.status === 'succeeded').length;

  return (
    <Shell
      rfxId={id}
      active="overview"
      title={rfx.title}
      subtitle={`${rfx.category} · ${rfx.delivery_location ?? ''} · base currency ${rfx.base_currency}${rfx.closes_at ? ` · closes ${rfx.closes_at}` : ''}`}
    >
      <div className="panel mb-5 grid grid-cols-2 divide-x divide-[var(--line)] md:grid-cols-5">
        <Stat label="Line items" value={lines.length} />
        <Stat label="Vendors invited" value={vendors.length} />
        <Stat label="Responses received" value={vendors.filter((v) => v.doc_id).length} />
        <Stat label="Documents extracted" value={`${extracted} / ${vendors.filter((v) => v.doc_id).length}`} />
        <Stat
          label="Open review items"
          value={openReviews?.n ?? 0}
          tone={(openReviews?.n ?? 0) > 0 ? 'warn' : 'ok'}
        />
      </div>

      <ExtractPanel
        rfxId={id}
        vendors={vendors.map((v) => {
          const job = jobs.find((x) => x.doc_id === v.doc_id);
          const stat = quoteStats.find((s) => s.vendor_id === v.id);
          return {
            vendorId: v.id,
            name: v.name,
            country: v.country,
            email: v.email,
            docId: v.doc_id,
            filename: v.filename,
            mime: v.mime,
            bytes: v.bytes,
            sha256: v.sha256 ? v.sha256.slice(0, 12) : null,
            docUrl: v.doc_id ? `/api/doc/${v.doc_id}?t=${signDocToken(v.doc_id)}` : null,
            jobStatus: job?.status ?? null,
            jobMs: job?.ms ?? null,
            jobError: job?.error ?? null,
            tokens: job ? `${job.input_tokens ?? 0} in / ${job.output_tokens ?? 0} out` : null,
            comparable: stat?.comparable ?? 0,
            blocked: stat?.blocked ?? 0,
          };
        })}
        totalLines={lines.length}
      />

      <div className="mt-5 grid gap-5 lg:grid-cols-[1.6fr_1fr]">
        <Panel
          title="RFx line items"
          subtitle="Specifications are canonicalised at authoring time — every dimension in millimetres, ply and GSM in their own fields. This is what makes deterministic matching possible later."
        >
          <div className="max-h-[560px] overflow-auto">
            <table className="grid text-[13px]">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Code</th>
                  <th>Description</th>
                  <th>Spec</th>
                  <th>Priced per</th>
                  <th className="text-right">Annual qty</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => {
                  const s = j.parse<LineSpec>(l.spec_json, {} as LineSpec);
                  const dims = [s.lengthMm, s.widthMm, s.heightMm].filter(Boolean).join(' × ');
                  return (
                    <tr key={l.code}>
                      <td className="text-slate-400">{l.line_no}</td>
                      <td className="font-medium text-slate-900">{l.code}</td>
                      <td className="max-w-[380px] text-slate-700">{l.description}</td>
                      <td className="whitespace-nowrap text-[11px] text-slate-500">
                        {s.ply ? `${s.ply}-ply · ` : ''}
                        {dims ? `${dims} mm` : '—'}
                        {s.gsm ? ` · ${s.gsm} GSM` : ''}
                      </td>
                      <td>
                        <Badge>{l.canonical_uom.replace('_', ' ')}</Badge>
                      </td>
                      <td className="num text-right text-slate-700">{l.annual_qty.toLocaleString('en-IN')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>

        <div className="space-y-5">
          <Panel
            title="Pre-qualification questionnaire"
            subtitle="Questions marked as gating disqualify a vendor on a wrong answer — and on no answer at all."
          >
            <ul className="divide-y divide-[var(--line)]">
              {questions.map((q) => (
                <li key={q.q_no} className="px-4 py-2.5">
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 text-[11px] font-medium text-slate-400">Q{q.q_no}</span>
                    <p className="flex-1 text-[13px] leading-relaxed text-slate-700">{q.question}</p>
                    {q.gate_json && (
                      <Badge tone="accent" title="A vendor must answer this correctly to be considered compliant.">
                        gates
                      </Badge>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="Commercial terms sought">
            <dl className="divide-y divide-[var(--line)] text-[13px]">
              {[
                ['Delivery', rfx.delivery_location],
                ['Incoterm', rfx.incoterm],
                ['Payment', rfx.payment_terms],
                ['Base currency', rfx.base_currency],
                ['Closes', rfx.closes_at],
              ].map(([k, v]) => (
                <div key={k} className="flex gap-4 px-4 py-2.5">
                  <dt className="w-28 shrink-0 text-slate-500">{k}</dt>
                  <dd className="text-slate-800">{v ?? '—'}</dd>
                </div>
              ))}
            </dl>
          </Panel>
        </div>
      </div>
    </Shell>
  );
}
