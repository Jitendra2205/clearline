import Link from 'next/link';
import { isAuthed, authEnabled } from '@/lib/security/auth';
import LoginForm from '@/components/LoginForm';
import DraftCopilot from '@/components/DraftCopilot';

export const dynamic = 'force-dynamic';

export default async function DraftPage() {
  if (authEnabled() && !(await isAuthed())) return <LoginForm />;

  return (
    <div className="min-h-screen">
      <header className="border-b border-[var(--line)] bg-white">
        <div className="mx-auto flex max-w-[1400px] items-center gap-3 px-6 py-3">
          <Link href="/" className="flex items-center gap-2">
            <span className="grid h-6 w-6 place-items-center rounded bg-slate-900 text-[11px] font-bold text-white">
              CL
            </span>
            <span className="text-sm font-semibold tracking-tight">Clearline</span>
          </Link>
          <span className="text-sm text-slate-400">/</span>
          <span className="text-sm text-slate-600">RFx drafting co-pilot</span>
        </div>
      </header>
      <main className="mx-auto max-w-[1400px] px-6 py-6">
        <div className="mb-5">
          <h1 className="text-lg font-semibold tracking-tight">Talk an RFx into existence</h1>
          <p className="mt-0.5 max-w-3xl text-sm leading-relaxed text-slate-500">
            Describe what you need. The co-pilot returns a structured RFx — canonicalised
            specifications, a declared unit of measure per line, and a questionnaire — through a
            strict schema, not prose that gets parsed afterwards. It proposes; you own every line
            before anything is dispatched.
          </p>
        </div>
        <DraftCopilot />
      </main>
    </div>
  );
}
