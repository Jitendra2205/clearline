import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/security/auth';
import { runExtractionJob } from '@/lib/jobs/runner';
import { all } from '@/lib/db/client';
import { ModelUnavailableError } from '@/lib/ai/provider';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * Kicks off extraction for one document, or for every document in an RFx.
 *
 * Documents are processed one at a time and a failure on one is reported
 * without stopping the others — one unreadable vendor file must never cost the
 * buyer the other four responses.
 */
export async function POST(req: Request) {
  const denied = await requireAuth();
  if (denied) return denied;

  const body = (await req.json()) as { docId?: string; rfxId?: string; force?: boolean };

  try {
    if (body.docId) {
      const r = await runExtractionJob({ docId: body.docId, force: body.force });
      return NextResponse.json({ ok: true, results: [{ docId: body.docId, ...r }] });
    }

    if (!body.rfxId) {
      return NextResponse.json({ error: 'docId or rfxId is required.' }, { status: 400 });
    }

    const docs = await all<{ id: string; filename: string }>(
      'SELECT id, filename FROM vendor_document WHERE rfx_id = ? ORDER BY received_at',
      [body.rfxId],
    );

    const results: unknown[] = [];
    for (const d of docs) {
      try {
        const r = await runExtractionJob({ docId: d.id, force: body.force });
        results.push({ docId: d.id, filename: d.filename, ok: true, ...r });
      } catch (e) {
        results.push({
          docId: d.id,
          filename: d.filename,
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    return NextResponse.json({ ok: true, results });
  } catch (e) {
    if (e instanceof ModelUnavailableError) {
      return NextResponse.json({ error: e.message, kind: 'no_api_key' }, { status: 503 });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
