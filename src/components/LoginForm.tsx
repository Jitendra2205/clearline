'use client';

import { useState } from 'react';

export default function LoginForm() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    setBusy(false);
    if (res.ok) window.location.reload();
    else setError(((await res.json()) as { error?: string }).error ?? 'Login failed.');
  }

  return (
    <div className="grid min-h-screen place-items-center px-6">
      <form onSubmit={submit} className="panel w-full max-w-sm px-6 py-7">
        <div className="flex items-center gap-2.5">
          <span className="grid h-7 w-7 place-items-center rounded bg-slate-900 text-[11px] font-bold text-white">
            CL
          </span>
          <h1 className="text-base font-semibold tracking-tight">Clearline</h1>
        </div>
        <p className="mt-3 text-[13px] leading-relaxed text-slate-500">
          Vendor pricing is commercially sensitive. Every route in this application is behind
          this gate.
        </p>

        <label className="mt-5 block text-xs font-medium text-slate-700">
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
          />
        </label>

        {error && <p className="mt-2.5 text-xs text-red-700">{error}</p>}

        <button
          type="submit"
          disabled={busy}
          className="mt-4 w-full rounded-lg bg-slate-900 px-3 py-2 text-[13px] font-medium text-white transition hover:bg-slate-800 disabled:opacity-50"
        >
          {busy ? 'Checking…' : 'Enter'}
        </button>
      </form>
    </div>
  );
}
