import Link from 'next/link';
import { all, ready } from '@/lib/db/client';
import { isAuthed, authEnabled } from '@/lib/security/auth';
import LoginForm from '@/components/LoginForm';
import SecurityConsole from '@/components/SecurityConsole';

export const dynamic = 'force-dynamic';

export default async function SecurityPage() {
  if (authEnabled() && !(await isAuthed())) return <LoginForm />;
  await ready();

  const rfxs = await all<{ id: string; title: string }>(
    'SELECT id, title FROM rfx ORDER BY created_at DESC LIMIT 1',
  );

  return (
    <div className="min-h-screen">
      <header className="border-b border-[var(--line)] bg-white">
        <div className="mx-auto flex max-w-[1100px] items-center gap-3 px-6 py-3">
          <Link href="/" className="flex items-center gap-2">
            <span className="grid h-6 w-6 place-items-center rounded bg-slate-900 text-[11px] font-bold text-white">
              CL
            </span>
            <span className="text-sm font-semibold tracking-tight">Clearline</span>
          </Link>
          <span className="text-sm text-slate-400">/</span>
          <span className="text-sm text-slate-600">Security &amp; guardrails</span>
        </div>
      </header>

      <main className="mx-auto max-w-[1100px] px-6 py-6">
        <h1 className="text-lg font-semibold tracking-tight">
          Vendor documents are untrusted input flowing into a purchasing decision
        </h1>
        <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-slate-500">
          A supplier who wants to win a ₹4 crore contract controls every byte of what they send.
          They can put instructions in a spreadsheet cell, white text in a PDF, or a formula in a
          description field that runs when the buyer opens the export. These are the defences, and
          both of them are runnable here.
        </p>

        <SecurityConsole rfxId={rfxs[0]?.id ?? null} />
      </main>
    </div>
  );
}
