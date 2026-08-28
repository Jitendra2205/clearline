import Link from 'next/link';
import { all, ready } from '@/lib/db/client';
import { isAuthed, authEnabled } from '@/lib/security/auth';
import LoginForm from '@/components/LoginForm';

export const dynamic = 'force-dynamic';

export default async function Home() {
  if (authEnabled() && !(await isAuthed())) return <LoginForm />;

  await ready();
  const rfxs = await all<{
    id: string; title: string; category: string; status: string; closes_at: string | null;
  }>('SELECT id, title, category, status, closes_at FROM rfx ORDER BY created_at DESC');

  const counts = await all<{ rfx_id: string; lines: number }>(
    'SELECT rfx_id, COUNT(*) AS lines FROM rfx_line GROUP BY rfx_id',
  );
  const docs = await all<{ rfx_id: string; n: number }>(
    'SELECT rfx_id, COUNT(*) AS n FROM vendor_document GROUP BY rfx_id',
  );

  return (
    <div className="mx-auto max-w-4xl px-6 py-16">
      <div className="flex items-center gap-2.5">
        <span className="grid h-8 w-8 place-items-center rounded bg-slate-900 text-xs font-bold text-white">
          CL
        </span>
        <h1 className="text-xl font-semibold tracking-tight">Clearline</h1>
      </div>
      <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-slate-600">
        Drafts an RFx, reads whatever vendors send back — a spreadsheet, a letterhead PDF, Word
        prose, a phone photo of a rate card, a two-line email — and lands them all in one
        comparison a buyer can interrogate in plain language.
      </p>
      <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-slate-500">
        The design rule throughout: never silently resolve ambiguity. Surface it, attribute it,
        make it reversible.
      </p>

      <div className="mt-9 space-y-3">
        {rfxs.length === 0 && (
          <div className="panel px-5 py-8 text-center">
            <p className="text-sm text-slate-600">
              No RFx yet. Seed the demo dataset with{' '}
              <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">npm run seed</code>, or
              draft one with the co-pilot.
            </p>
          </div>
        )}

        {rfxs.map((r) => (
          <Link
            key={r.id}
            href={`/rfx/${r.id}`}
            className="panel block px-5 py-4 transition hover:border-slate-300 hover:shadow-sm"
          >
            <div className="flex items-baseline justify-between gap-4">
              <h2 className="text-sm font-semibold text-slate-900">{r.title}</h2>
              <span className="text-[11px] uppercase tracking-wide text-slate-400">
                {r.status.replace(/_/g, ' ')}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {r.category} · {counts.find((c) => c.rfx_id === r.id)?.lines ?? 0} line items ·{' '}
              {docs.find((d) => d.rfx_id === r.id)?.n ?? 0} vendor responses
              {r.closes_at ? ` · closes ${r.closes_at}` : ''}
            </p>
          </Link>
        ))}
      </div>

      <div className="mt-8 flex items-center gap-4">
        <Link
          href="/draft"
          className="rounded-lg bg-slate-900 px-3.5 py-2 text-[13px] font-medium text-white transition hover:bg-slate-800"
        >
          Draft a new RFx with the co-pilot
        </Link>
        <Link href="/security" className="text-[13px] font-medium text-slate-600 hover:text-slate-900">
          Security &amp; guardrails
        </Link>
      </div>
    </div>
  );
}
