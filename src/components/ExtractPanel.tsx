'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Panel, Badge, Coverage } from './ui';

export interface VendorCard {
  vendorId: string;
  name: string;
  country: string;
  email: string;
  docId: string | null;
  filename: string | null;
  mime: string | null;
  bytes: number | null;
  sha256: string | null;
  docUrl: string | null;
  jobStatus: string | null;
  jobMs: number | null;
  jobError: string | null;
  tokens: string | null;
  comparable: number;
  blocked: number;
}

const FORMAT_LABEL: Record<string, string> = {
  'application/pdf': 'PDF',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word',
  'image/jpeg': 'Photo',
  'image/png': 'Photo',
  'message/rfc822': 'Email',
  'text/plain': 'Text',
};

export default function ExtractPanel({
  rfxId,
  vendors,
  totalLines,
}: {
  rfxId: string;
  vendors: VendorCard[];
  totalLines: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);

  async function extract(docId?: string) {
    setBusy(docId ?? 'all');
    setError(null);
    setLog([]);
    try {
      const res = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(docId ? { docId, force: true } : { rfxId, force: false }),
      });
      const data = (await res.json()) as {
        error?: string;
        kind?: string;
        results?: {
          filename?: string; ok?: boolean; lines?: number; blocked?: number;
          reviewItems?: number; ms?: number; cached?: boolean; error?: string;
        }[];
      };
      if (!res.ok) {
        setError(
          data.kind === 'no_api_key'
            ? 'No provider API key is set. The extraction loop is real and will not run without one — add GEMINI_API_KEY (or ANTHROPIC_API_KEY) to .env.local and restart.'
            : (data.error ?? 'Extraction failed.'),
        );
        return;
      }
      setLog(
        (data.results ?? []).map((r) =>
          r.ok === false
            ? `${r.filename ?? 'document'} — FAILED: ${r.error}`
            : `${r.filename ?? 'document'} — ${r.cached ? 'cached' : `${r.lines} lines, ${r.blocked} held, ${r.reviewItems} to review, ${((r.ms ?? 0) / 1000).toFixed(1)}s`}`,
        ),
      );
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function removeDoc(docId: string, vendorName: string) {
    // Deleting extracted work is not reversible here — there is no undo, and
    // the file itself is gone with it. Worth one question first.
    if (!confirm(`Remove the reply from ${vendorName}?\n\nThe file and everything extracted from it will be deleted. The supplier record stays.`)) {
      return;
    }
    setBusy(`del:${docId}`);
    setError(null);
    setLog([]);
    try {
      const res = await fetch(`/api/document/${docId}`, { method: 'DELETE' });
      const data = (await res.json()) as { error?: string; vendor?: string; quoteLinesRemoved?: number };
      if (!res.ok) {
        setError(data.error ?? 'Could not remove the reply.');
        return;
      }
      setLog([`${data.vendor} removed — ${data.quoteLinesRemoved ?? 0} quoted line(s) taken out of the comparison.`]);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const pending = vendors.filter((v) => v.docId && v.jobStatus !== 'succeeded').length;

  return (
    <Panel
      title="Vendor responses"
      subtitle="Five vendors, five formats, none of them the template we sent. Extraction runs one document at a time — a failure on one never costs the buyer the other four."
      right={
        <button
          onClick={() => extract()}
          disabled={busy !== null}
          className="rounded-lg bg-slate-900 px-3 py-1.5 text-[13px] font-medium text-white transition hover:bg-slate-800 disabled:opacity-50"
        >
          {busy === 'all' ? 'Reading documents…' : pending > 0 ? `Extract ${pending} document(s)` : 'Re-check all'}
        </button>
      }
    >
      {error && (
        <div className="border-b border-red-200 bg-red-50 px-4 py-2.5 text-[13px] text-red-800">{error}</div>
      )}
      {log.length > 0 && (
        <div className="border-b border-[var(--line)] bg-slate-50 px-4 py-2.5">
          {log.map((l, i) => (
            <p key={i} className="num text-[12px] text-slate-600">
              {l}
            </p>
          ))}
        </div>
      )}

      <div className="divide-y divide-[var(--line)]">
        {vendors.map((v) => (
          <div key={v.vendorId} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
            <div className="min-w-[220px] flex-1">
              <p className="text-[13px] font-medium text-slate-900">{v.name}</p>
              <p className="text-[11px] text-slate-500">
                {v.email} · {v.country}
              </p>
            </div>

            {v.docId ? (
              <>
                <Badge tone="neutral" title={v.mime ?? undefined}>
                  {FORMAT_LABEL[v.mime ?? ''] ?? 'File'}
                </Badge>
                <a
                  href={v.docUrl ?? '#'}
                  target="_blank"
                  rel="noreferrer"
                  className="max-w-[240px] truncate text-[12px] font-medium text-indigo-700 underline-offset-2 hover:underline"
                  title="Opens through a short-lived signed link. Vendor documents are never on a public path."
                >
                  {v.filename}
                </a>
                <span className="num text-[11px] text-slate-400" title="SHA-256 prefix. Identical re-uploads hit the extraction cache.">
                  {v.sha256}
                </span>

                {v.jobStatus === 'succeeded' ? (
                  <>
                    <Coverage quoted={v.comparable} total={totalLines} />
                    {v.blocked > 0 && (
                      <Badge tone="warn" title="Held out of the comparison until a human resolves the review item.">
                        {v.blocked} held
                      </Badge>
                    )}
                    <span className="text-[11px] text-slate-400">{v.tokens}</span>
                  </>
                ) : v.jobStatus === 'failed' ? (
                  <Badge tone="bad" title={v.jobError ?? undefined}>
                    extraction failed
                  </Badge>
                ) : (
                  <Badge tone="neutral">not read yet</Badge>
                )}

                <button
                  onClick={() => extract(v.docId!)}
                  disabled={busy !== null}
                  className="rounded-md border border-slate-300 px-2.5 py-1 text-[12px] font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                >
                  {busy === v.docId ? 'Reading…' : v.jobStatus === 'succeeded' ? 'Re-extract' : 'Extract'}
                </button>

                <button
                  onClick={() => removeDoc(v.docId!, v.name)}
                  disabled={busy !== null}
                  title="Removes this reply and everything extracted from it. The supplier record stays."
                  className="rounded-md border border-slate-300 px-2.5 py-1 text-[12px] font-medium text-slate-600 transition hover:border-red-300 hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
                >
                  {busy === `del:${v.docId}` ? 'Removing…' : 'Remove'}
                </button>
              </>
            ) : (
              <Badge tone="neutral">no response</Badge>
            )}
          </div>
        ))}
      </div>
    </Panel>
  );
}
