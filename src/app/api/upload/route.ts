import { NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { requireAuth } from '@/lib/security/auth';
import { sniff, sha256, safeFilename, MAX_BYTES } from '@/lib/security/files';
import { one, run, j } from '@/lib/db/client';

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
  const vendorId = String(form.get('vendorId') ?? '');

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file supplied.' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: `File exceeds the ${MAX_BYTES / 1024 / 1024} MB limit.` }, { status: 413 });
  }
  if (!rfxId || !vendorId) {
    return NextResponse.json({ error: 'rfxId and vendorId are required.' }, { status: 400 });
  }

  const vendor = await one<{ id: string }>('SELECT id FROM vendor WHERE id = ?', [vendorId]);
  if (!vendor) return NextResponse.json({ error: 'Unknown vendor.' }, { status: 400 });

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
