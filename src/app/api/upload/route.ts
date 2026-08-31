import { NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { requireAuth } from '@/lib/security/auth';
import { sniff, sha256, safeFilename, MAX_BYTES } from '@/lib/security/files';
import { one, all, run, j } from '@/lib/db/client';

export const runtime = 'nodejs';

/**
 * Accepts a vendor response document.
 *
 * The file is sniffed on its actual bytes before anything touches it, and a
 * content hash is recorded — a re-upload of an identical file hits the
 * extraction cache instead of costing another model call.
 */
export async function POST(req: Request) {
  const denied = await requireAuth();
  if (denied) return denied;

  const form = await req.formData();
  const file = form.get('file');
  const rfxId = String(form.get('rfxId') ?? '');
  let vendorId = String(form.get('vendorId') ?? '');
  const vendorName = String(form.get('vendorName') ?? '').trim();

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file supplied.' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: `File exceeds the ${MAX_BYTES / 1024 / 1024} MB limit.` }, { status: 413 });
  }
  if (!rfxId || (!vendorId && !vendorName)) {
    return NextResponse.json({ error: 'rfxId, and either vendorId or vendorName, are required.' }, { status: 400 });
  }

  const rfx = await one<{ org_id: string }>('SELECT org_id FROM rfx WHERE id = ?', [rfxId]);
  if (!rfx) return NextResponse.json({ error: 'Unknown RFx.' }, { status: 400 });

  if (vendorId) {
    const vendor = await one<{ id: string }>('SELECT id FROM vendor WHERE id = ?', [vendorId]);
    if (!vendor) return NextResponse.json({ error: 'Unknown vendor.' }, { status: 400 });
  } else {
    // A buyer forwarding a reply from a supplier the system has never seen
    // should not have to go and create that supplier first. Match on name
    // within the org, so a second document from the same supplier lands
    // against the same record rather than creating a duplicate.
    const existing = await one<{ id: string }>(
      'SELECT id FROM vendor WHERE org_id = ? AND lower(name) = lower(?)',
      [rfx.org_id, vendorName],
    );
    if (existing) {
      vendorId = existing.id;
    } else {
      vendorId = `ven_${nanoid(12)}`;
      await run(
        'INSERT INTO vendor (id, org_id, name, country, email, currency_hint) VALUES (?,?,?,?,?,NULL)',
        [vendorId, rfx.org_id, vendorName, 'Not stated', ''],
      );
    }
  }

  // Replacing a supplier's file must not leave the previous one in the
  // comparison. vendor_document is referenced by quote and extraction_job, so
  // the dependants go first — the same order the extraction pipeline uses when
  // it re-extracts a document.
  const prior = await all<{ id: string }>(
    'SELECT id FROM vendor_document WHERE rfx_id = ? AND vendor_id = ?', [rfxId, vendorId],
  );
  for (const d of prior) {
    const quotes = await all<{ id: string }>('SELECT id FROM quote WHERE doc_id = ?', [d.id]);
    for (const q of quotes) {
      await run('DELETE FROM review_item WHERE quote_id = ?', [q.id]);
      await run('DELETE FROM quote_line WHERE quote_id = ?', [q.id]);
      await run('DELETE FROM questionnaire_answer WHERE quote_id = ?', [q.id]);
      await run('DELETE FROM quote WHERE id = ?', [q.id]);
    }
    await run('DELETE FROM extraction_job WHERE doc_id = ?', [d.id]);
    await run('DELETE FROM vendor_document WHERE id = ?', [d.id]);
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const filename = safeFilename(file.name);
  const s = sniff(buf, filename);

  if (!s.ok || !s.mime) {
    return NextResponse.json({ error: s.reason, kind: 'rejected_file' }, { status: 415 });
  }

  const hash = sha256(buf);
  const docId = `doc_${nanoid(12)}`;
  const now = new Date().toISOString();

  await run(
    `INSERT INTO vendor_document (id, rfx_id, vendor_id, filename, mime, bytes, sha256, content, received_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [docId, rfxId, vendorId, filename, s.mime, buf.length, hash, buf.toString('base64'), now],
  );

  await run(
    `INSERT INTO audit_log (id, rfx_id, actor, action, entity, entity_id, before_json, after_json, at)
     VALUES (?,?,?,?,?,?,NULL,?,?)`,
    [
      `au_${nanoid(10)}`, rfxId, 'buyer@demo', 'document.received', 'document', docId,
      j.stringify({ filename, mime: s.mime, bytes: buf.length, sha256: hash }), now,
    ],
  );

  return NextResponse.json({ ok: true, docId, mime: s.mime, bytes: buf.length, sha256: hash });
}
