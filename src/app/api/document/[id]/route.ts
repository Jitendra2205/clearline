import { NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { requireAuth } from '@/lib/security/auth';
import { one, run, j } from '@/lib/db/client';
import { deleteDocumentDeep } from '@/lib/db/cascade';

export const runtime = 'nodejs';

/**
 * Removes a vendor reply, and everything extracted from it.
 *
 * Uploading a replacement already does this implicitly. This is the case where
 * the buyer wants the reply gone and nothing in its place — a file attached to
 * the wrong RFx, or a supplier who withdrew. The vendor record stays: it is an
 * organisation-level record that may hold documents against other requests.
 */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = await requireAuth();
  if (denied) return denied;

  const { id } = await ctx.params;

  const doc = await one<{
    id: string; rfx_id: string; filename: string; mime: string; bytes: number; vendor_name: string;
  }>(
    `SELECT d.id, d.rfx_id, d.filename, d.mime, d.bytes, v.name AS vendor_name
       FROM vendor_document d JOIN vendor v ON v.id = d.vendor_id
      WHERE d.id = ?`,
    [id],
  );
  if (!doc) return NextResponse.json({ error: 'Unknown document.' }, { status: 404 });

  const lines = await one<{ n: number }>(
    'SELECT COUNT(*) AS n FROM quote_line WHERE quote_id IN (SELECT id FROM quote WHERE doc_id = ?)',
    [id],
  );

  await run(
    `INSERT INTO audit_log (id, rfx_id, actor, action, entity, entity_id, before_json, after_json, at)
     VALUES (?,?,?,?,?,?,?,NULL,?)`,
    [
      `au_${nanoid(10)}`, doc.rfx_id, 'buyer@demo', 'document.deleted', 'document', id,
      j.stringify({ ...doc, quote_lines_removed: lines?.n ?? 0 }), new Date().toISOString(),
    ],
  );

  await deleteDocumentDeep(id);

  return NextResponse.json({
    ok: true,
    deleted: id,
    vendor: doc.vendor_name,
    quoteLinesRemoved: lines?.n ?? 0,
  });
}
