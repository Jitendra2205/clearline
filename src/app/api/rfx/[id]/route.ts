import { NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { requireAuth } from '@/lib/security/auth';
import { one, run, j } from '@/lib/db/client';
import { deleteRfxDeep } from '@/lib/db/cascade';

export const runtime = 'nodejs';

interface RfxRow {
  id: string;
  title: string;
  category: string;
  base_currency: string;
  delivery_location: string | null;
  incoterm: string | null;
  payment_terms: string | null;
  closes_at: string | null;
  status: string;
}

const EDITABLE = [
  'title',
  'category',
  'delivery_location',
  'incoterm',
  'payment_terms',
  'closes_at',
] as const;

/**
 * Edits the RFx header.
 *
 * Line items are not editable here. Changing a line after vendors have quoted
 * against it would silently invalidate every match pointing at it, and the
 * honest fix is a new round, not a quiet rewrite.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = await requireAuth();
  if (denied) return denied;

  const { id } = await ctx.params;
  const before = await one<RfxRow>(
    `SELECT id, title, category, base_currency, delivery_location, incoterm,
            payment_terms, closes_at, status FROM rfx WHERE id = ?`,
    [id],
  );
  if (!before) return NextResponse.json({ error: 'Unknown RFx.' }, { status: 404 });

  const body = (await req.json()) as Record<string, unknown>;

  const sets: string[] = [];
  const args: (string | null)[] = [];
  for (const field of EDITABLE) {
    if (!(field in body)) continue;
    const raw = body[field];
    const value = typeof raw === 'string' ? raw.trim() : raw === null ? null : undefined;
    if (value === undefined) {
      return NextResponse.json({ error: `${field} must be text.` }, { status: 400 });
    }
    if ((field === 'title' || field === 'category') && !value) {
      return NextResponse.json({ error: `${field} cannot be empty.` }, { status: 400 });
    }
    sets.push(`${field} = ?`);
    args.push(value || null);
  }

  // The base currency is what every conversion in the comparison was computed
  // against. Changing it once quotes exist would leave converted values that
  // are arithmetically correct and mean nothing. Allowed only while empty.
  if (typeof body.base_currency === 'string' && body.base_currency !== before.base_currency) {
    const quoted = await one<{ n: number }>('SELECT COUNT(*) AS n FROM quote WHERE rfx_id = ?', [id]);
    if ((quoted?.n ?? 0) > 0) {
      return NextResponse.json(
        {
          error:
            'The base currency cannot change once vendor quotes have been extracted — every converted price in the comparison was computed against it. Delete the responses first, or start a new RFx.',
        },
        { status: 409 },
      );
    }
    sets.push('base_currency = ?');
    args.push(body.base_currency.trim().toUpperCase());
  }

  if (sets.length === 0) {
    return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 });
  }

  args.push(id);
  await run(`UPDATE rfx SET ${sets.join(', ')} WHERE id = ?`, args);

  const after = await one<RfxRow>(
    `SELECT id, title, category, base_currency, delivery_location, incoterm,
            payment_terms, closes_at, status FROM rfx WHERE id = ?`,
    [id],
  );

  await run(
    `INSERT INTO audit_log (id, rfx_id, actor, action, entity, entity_id, before_json, after_json, at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [
      `au_${nanoid(10)}`, id, 'buyer@demo', 'rfx.updated', 'rfx', id,
      j.stringify(before), j.stringify(after), new Date().toISOString(),
    ],
  );

  return NextResponse.json({ ok: true, rfx: after });
}

/**
 * Deletes an RFx and everything derived from it.
 *
 * The audit entry is written before the rows go, and audit_log has no foreign
 * key back to rfx — so the trail survives the deletion rather than disappearing
 * with it.
 */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = await requireAuth();
  if (denied) return denied;

  const { id } = await ctx.params;
  const rfx = await one<RfxRow>('SELECT id, title, category, status FROM rfx WHERE id = ?', [id]);
  if (!rfx) return NextResponse.json({ error: 'Unknown RFx.' }, { status: 404 });

  const docs = await one<{ n: number }>(
    'SELECT COUNT(*) AS n FROM vendor_document WHERE rfx_id = ?', [id],
  );

  await run(
    `INSERT INTO audit_log (id, rfx_id, actor, action, entity, entity_id, before_json, after_json, at)
     VALUES (?,?,?,?,?,?,?,NULL,?)`,
    [
      `au_${nanoid(10)}`, id, 'buyer@demo', 'rfx.deleted', 'rfx', id,
      j.stringify({ ...rfx, documents: docs?.n ?? 0 }), new Date().toISOString(),
    ],
  );

  await deleteRfxDeep(id);

  return NextResponse.json({ ok: true, deleted: id, documents: docs?.n ?? 0 });
}
