'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Panel } from './ui';

/**
 * Adds a vendor reply to an RFx.
 *
 * Without this the product only ever demonstrates the dataset it was seeded
 * with: drafting a new RFx produced a requirement with nowhere to send it and
 * nothing to compare. The upload endpoint existed and was never reachable from
 * the interface.
 *
 * A supplier is identified by name rather than picked from a list, because the
 * buyer forwarding an email does not care whether that supplier is already a
 * record in the system. The route matches on name within the org and creates
 * the supplier only when there is no match.
 */
export default function UploadPanel({
  rfxId,
  knownVendors,
}: {
  rfxId: string;
  knownVendors: string[];
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [vendorName, setVendorName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function upload() {
    if (!file || !vendorName.trim()) return;
    setBusy(true);
    setError(null);
    setDone(null);

    const body = new FormData();
    body.set('file', file);
    body.set('rfxId', rfxId);
    body.set('vendorName', vendorName.trim());

    try {
      const res = await fetch('/api/upload', { method: 'POST', body });
      const data = (await res.json()) as { ok?: boolean; error?: string; bytes?: number; mime?: string };
      if (!res.ok || !data.ok) {
        setError(data.error ?? 'Upload failed.');
        return;
      }
      const replaced = knownVendors.some((v) => v.toLowerCase() === vendorName.trim().toLowerCase());
      setDone(
        `${file.name} stored for ${vendorName.trim()}${replaced ? ' (replacing their previous file)' : ''}. ` +
          'Press Extract to read it.',
      );
      setVendorName('');
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';
      router.refresh();
    } catch {
      setError('Upload failed. The file may be too large, or the connection dropped.');
    } finally {
      setBusy(false);
    }
  }

  const ready = !!file && vendorName.trim().length > 0 && !busy;

  return (
    <Panel
      title="Add a vendor reply"
      subtitle="Whatever the supplier actually sent — a spreadsheet, a PDF, a Word file, a photo of a printed rate card, or a plain email saved as .txt. Nothing needs converting first."
    >
      <div className="px-4 py-3.5">
        <div className="flex flex-col gap-3 md:flex-row md:items-end">
          <div className="md:w-64">
            <label htmlFor="vendorName" className="mb-1 block text-[12px] font-medium text-[var(--muted)]">
              Supplier name
            </label>
            <input
              id="vendorName"
              list="known-vendors"
              value={vendorName}
              onChange={(e) => setVendorName(e.target.value)}
              placeholder="e.g. Nova Pack Enterprises"
              className="w-full rounded-lg border border-[var(--line)] bg-white px-3 py-1.5 text-[13px] outline-none focus:border-slate-400"
            />
            <datalist id="known-vendors">
              {knownVendors.map((v) => (
                <option key={v} value={v} />
              ))}
            </datalist>
          </div>

          <div className="flex-1">
            <label htmlFor="vendorFile" className="mb-1 block text-[12px] font-medium text-[var(--muted)]">
              Their reply
            </label>
            <input
              id="vendorFile"
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.csv,.pdf,.docx,.doc,.txt,.jpg,.jpeg,.png,.webp"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="w-full rounded-lg border border-[var(--line)] bg-white px-3 py-1.5 text-[13px] file:mr-3 file:rounded file:border-0 file:bg-slate-100 file:px-2 file:py-1 file:text-[12px] file:text-slate-700"
            />
          </div>

          <button
            onClick={upload}
            disabled={!ready}
            className="rounded-lg bg-slate-900 px-3 py-1.5 text-[13px] font-medium text-white transition hover:bg-slate-800 disabled:opacity-50"
          >
            {busy ? 'Uploading…' : 'Upload reply'}
          </button>
        </div>

        <p className="mt-2.5 text-[12px] text-[var(--muted)]">
          The file is checked on its actual bytes, not its extension. Uploading a second file for the
          same supplier replaces the first, along with anything already extracted from it.
        </p>

        {error && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800">
            {error}
          </div>
        )}
        {done && (
          <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[13px] text-emerald-800">
            {done}
          </div>
        )}
      </div>
    </Panel>
  );
}
