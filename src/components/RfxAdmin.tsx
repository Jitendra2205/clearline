'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface RfxDetails {
  id: string;
  title: string;
  category: string;
  delivery_location: string | null;
  incoterm: string | null;
  payment_terms: string | null;
  closes_at: string | null;
}

const FIELDS: { key: keyof Omit<RfxDetails, 'id'>; label: string; hint?: string; wide?: boolean }[] = [
  { key: 'title', label: 'Title', wide: true },
  { key: 'category', label: 'Category' },
  { key: 'closes_at', label: 'Closes', hint: 'YYYY-MM-DD' },
  { key: 'delivery_location', label: 'Delivery location', wide: true },
  { key: 'incoterm', label: 'Incoterm' },
  { key: 'payment_terms', label: 'Payment terms' },
];

/**
 * Edit and delete controls for an RFx.
 *
 * Line items are not editable. Changing a line vendors have already quoted
 * against would invalidate every match pointing at it, and doing that quietly
 * is exactly the behaviour this product argues against — so the header is
 * editable and the lines are not.
 */
export default function RfxAdmin({
  rfx,
  documentCount,
}: {
  rfx: RfxDetails;
  documentCount: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<RfxDetails>(rfx);
  const [busy, setBusy] = useState<'save' | 'delete' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save() {
    setBusy('save');
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/rfx/${rfx.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: form.title,
          category: form.category,
          delivery_location: form.delivery_location ?? '',
          incoterm: form.incoterm ?? '',
          payment_terms: form.payment_terms ?? '',
          closes_at: form.closes_at ?? '',
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? 'Could not save.');
        return;
      }
      setSaved(true);
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    const warning =
      documentCount > 0
        ? `Delete "${rfx.title}"?\n\nThis also deletes ${documentCount} vendor repl${documentCount === 1 ? 'y' : 'ies'} and everything extracted from them. It cannot be undone.`
        : `Delete "${rfx.title}"?\n\nThis cannot be undone.`;
    if (!confirm(warning)) return;

    setBusy('delete');
    setError(null);
    try {
      const res = await fetch(`/api/rfx/${rfx.id}`, { method: 'DELETE' });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? 'Could not delete.');
        setBusy(null);
        return;
      }
      router.push('/');
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  }

  return (
    <div className="mb-5">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => {
            setForm(rfx);
            setOpen((v) => !v);
            setError(null);
          }}
          className="rounded-md border border-slate-300 px-2.5 py-1 text-[12px] font-medium text-slate-700 transition hover:bg-slate-50"
        >
          {open ? 'Cancel' : 'Edit details'}
        </button>
        <button
          onClick={remove}
          disabled={busy !== null}
          className="rounded-md border border-slate-300 px-2.5 py-1 text-[12px] font-medium text-slate-600 transition hover:border-red-300 hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
        >
          {busy === 'delete' ? 'Deleting…' : 'Delete this RFx'}
        </button>
        {saved && !open && (
          <span className="text-[12px] text-emerald-700">Saved.</span>
        )}
        <span className="text-[12px] text-[var(--muted)]">
          Line items are fixed once vendors have quoted — editing them would invalidate every match.
        </span>
      </div>

      {error && (
        <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800">
          {error}
        </div>
      )}

      {open && (
        <div className="panel mt-3 px-4 py-3.5">
          <div className="grid gap-3 md:grid-cols-2">
            {FIELDS.map((f) => (
              <div key={f.key} className={f.wide ? 'md:col-span-2' : undefined}>
                <label htmlFor={f.key} className="mb-1 block text-[12px] font-medium text-[var(--muted)]">
                  {f.label}
                  {f.hint ? <span className="ml-1 font-normal text-slate-400">({f.hint})</span> : null}
                </label>
                <input
                  id={f.key}
                  value={form[f.key] ?? ''}
                  onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                  className="w-full rounded-lg border border-[var(--line)] bg-white px-3 py-1.5 text-[13px] outline-none focus:border-slate-400"
                />
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={save}
              disabled={busy !== null || !form.title.trim() || !form.category.trim()}
              className="rounded-lg bg-slate-900 px-3 py-1.5 text-[13px] font-medium text-white transition hover:bg-slate-800 disabled:opacity-50"
            >
              {busy === 'save' ? 'Saving…' : 'Save changes'}
            </button>
            <span className="text-[12px] text-[var(--muted)]">
              Every change is written to the audit log, before and after.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
