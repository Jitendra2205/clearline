import { NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { requireAuth } from '@/lib/security/auth';
import { all, one, run, j } from '@/lib/db/client';
import { runPriceBandCheck } from '@/lib/normalize/pipeline';
import { convertCurrency, convertUom } from '@/lib/normalize/units';

export const runtime = 'nodejs';

type Action =
  | { action: 'accept'; itemId: string; note?: string }
  | { action: 'dismiss'; itemId: string; note?: string }
  | { action: 'set_currency'; itemId: string; currency: string }
  | { action: 'set_uom_factor'; itemId: string; factor: number; note: string }
  | { action: 'reassign'; itemId: string; lineCode: string }
  | { action: 'set_price'; itemId: string; price: number };

/**
 * Resolving a review item.
 *
 * Every branch writes an audit entry with before and after. A procurement
 * decision gets challenged months later, and "the system decided" is not an
 * answer a buyer can give — "I overrode it on the 4th, here is the before and
 * after" is.
 */
export async function POST(req: Request) {
  const denied = await requireAuth();
  if (denied) return denied;

  const body = (await req.json()) as Action;
  const actor = 'buyer@demo';
  const now = new Date().toISOString();

  const item = await one<{
    id: string; rfx_id: string; quote_id: string; quote_line_id: string | null; kind: string; detail: string;
  }>('SELECT id, rfx_id, quote_id, quote_line_id, kind, detail FROM review_item WHERE id = ?', [body.itemId]);

  if (!item) return NextResponse.json({ error: 'Review item not found.' }, { status: 404 });

  const line = item.quote_line_id
    ? await one<{
        id: string; parsed_price: number | null; raw_uom: string | null; matched_line_id: string | null;
        normalized_price: number | null; normalization_note: string | null; blocked: number;
        match_tier: string; extraction_confidence: string;
      }>(
        `SELECT id, parsed_price, raw_uom, matched_line_id, normalized_price, normalization_note,
                blocked, match_tier, extraction_confidence
           FROM quote_line WHERE id = ?`,
        [item.quote_line_id],
      )
    : null;

  const before = line ? { ...line } : null;
  let resolution = '';

  switch (body.action) {
    case 'accept': {
      if (!line) { resolution = `Acknowledged: ${body.note ?? 'no note'}`; break; }
      // Accepting means the human vouches for the value as extracted.
      const value = await recompute(item.rfx_id, item.quote_id, line, null);
      await run(
        'UPDATE quote_line SET blocked = 0, normalized_price = ?, normalization_note = ? WHERE id = ?',
        [value.price, `${line.normalization_note ?? ''} · confirmed by ${actor}`, line.id],
      );
      resolution = `Confirmed by ${actor}. ${body.note ?? ''}`.trim();
      break;
    }

    case 'dismiss': {
      if (line) await run('UPDATE quote_line SET blocked = 1 WHERE id = ?', [line.id]);
      resolution = `Excluded from the comparison by ${actor}. ${body.note ?? ''}`.trim();
      break;
    }

    case 'set_currency': {
      if (!line) break;
      await run('UPDATE quote SET currency = ? WHERE id = ?', [body.currency, item.quote_id]);
      // Re-normalise every line on this quote, not just the flagged one.
      const siblings = await all<{
        id: string; parsed_price: number | null; raw_uom: string | null; matched_line_id: string | null;
        extraction_confidence: string; match_tier: string;
      }>(
        `SELECT id, parsed_price, raw_uom, matched_line_id, extraction_confidence, match_tier
           FROM quote_line WHERE quote_id = ?`,
        [item.quote_id],
      );
      for (const s of siblings) {
        const v = await recompute(item.rfx_id, item.quote_id, s, body.currency);
        const stillBlocked =
          v.price === null || s.extraction_confidence === 'low' || s.match_tier === 'semantic' || s.match_tier === 'unmatched';
        await run(
          'UPDATE quote_line SET normalized_price = ?, normalization_note = ?, blocked = ? WHERE id = ?',
          [stillBlocked ? null : v.price, `${v.note} · currency set to ${body.currency} by ${actor}`, stillBlocked ? 1 : 0, s.id],
        );
      }
      // Any other open currency flags on this quote are now answered.
      await run(
        `UPDATE review_item SET status='resolved', resolution=?, resolved_by=?, resolved_at=?
          WHERE quote_id = ? AND kind = 'currency_not_stated' AND status = 'open'`,
        [`Currency set to ${body.currency} by ${actor}`, actor, now, item.quote_id],
      );
      resolution = `Currency set to ${body.currency} by ${actor}; the whole quote was re-normalised.`;
      break;
    }

    case 'set_uom_factor': {
      if (!line || line.parsed_price === null) break;
      const price = Math.round(line.parsed_price * body.factor * 100) / 100;
      const quote = await one<{ currency: string | null }>('SELECT currency FROM quote WHERE id = ?', [item.quote_id]);
      const rfx = await one<{ base_currency: string }>('SELECT base_currency FROM rfx WHERE id = ?', [item.rfx_id]);
      const c = convertCurrency(price, quote?.currency ?? null, rfx?.base_currency ?? 'INR');
      await run(
        'UPDATE quote_line SET normalized_price = ?, normalization_note = ?, blocked = 0 WHERE id = ?',
        [
          c.value,
          `converted from ${line.parsed_price} ${line.raw_uom ?? ''} using a factor of ${body.factor} supplied by ${actor} (${body.note}) · ${c.note}`,
          line.id,
        ],
      );
      resolution = `Conversion factor ${body.factor} supplied by ${actor}: ${body.note}`;
      break;
    }

    case 'reassign': {
      if (!line) break;
      const target = await one<{ id: string; code: string }>(
        'SELECT id, code FROM rfx_line WHERE rfx_id = ? AND UPPER(code) = ?',
        [item.rfx_id, body.lineCode.toUpperCase()],
      );
      if (!target) return NextResponse.json({ error: `No RFx line ${body.lineCode}.` }, { status: 400 });
      const v = await recompute(item.rfx_id, item.quote_id, { ...line, matched_line_id: target.id }, null);
      await run(
        `UPDATE quote_line SET matched_line_id = ?, match_tier = 'exact', match_score = 1,
           match_reason = ?, normalized_price = ?, normalization_note = ?, blocked = 0 WHERE id = ?`,
        [
          target.id,
          `Assigned to ${target.code} by ${actor}.`,
          v.price,
          `${v.note} · assigned by ${actor}`,
          line.id,
        ],
      );
      resolution = `Assigned to ${target.code} by ${actor}.`;
      break;
    }

    case 'set_price': {
      if (!line) break;
      await run(
        'UPDATE quote_line SET parsed_price = ?, normalized_price = ?, normalization_note = ?, blocked = 0 WHERE id = ?',
        [body.price, body.price, `Value entered directly by ${actor} after reading the source document.`, line.id],
      );
      resolution = `Price corrected to ${body.price} by ${actor}.`;
      break;
    }
  }

  await run(
    `UPDATE review_item SET status = ?, resolution = ?, resolved_by = ?, resolved_at = ? WHERE id = ?`,
    [body.action === 'dismiss' ? 'dismissed' : 'resolved', resolution, actor, now, item.id],
  );

  const after = line
    ? await one('SELECT normalized_price, normalization_note, blocked, matched_line_id FROM quote_line WHERE id = ?', [line.id])
    : null;

  await run(
    `INSERT INTO audit_log (id, rfx_id, actor, action, entity, entity_id, before_json, after_json, at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [
      `au_${nanoid(10)}`, item.rfx_id, actor, `review.${body.action}`, 'review_item', item.id,
      j.stringify({ item: { kind: item.kind, detail: item.detail }, line: before }),
      j.stringify({ resolution, line: after }), now,
    ],
  );

  await runPriceBandCheck(item.rfx_id);

  return NextResponse.json({ ok: true, resolution });
}

/**
 * Re-runs the same conversion chain the pipeline uses, so a line the buyer
 * confirms is normalised exactly the way an automatic one would have been.
 * The currency comes from the quote unless the buyer is setting it right now.
 */
async function recompute(
  rfxId: string,
  quoteId: string,
  line: { parsed_price: number | null; raw_uom: string | null; matched_line_id: string | null },
  currencyOverride: string | null,
): Promise<{ price: number | null; note: string }> {
  const rfx = await one<{ base_currency: string }>('SELECT base_currency FROM rfx WHERE id = ?', [rfxId]);
  const quote = await one<{ currency: string | null }>('SELECT currency FROM quote WHERE id = ?', [quoteId]);
  const currency = currencyOverride ?? quote?.currency ?? null;

  const canonical = line.matched_line_id
    ? (await one<{ canonical_uom: string }>('SELECT canonical_uom FROM rfx_line WHERE id = ?', [line.matched_line_id]))?.canonical_uom
    : null;

  const notes: string[] = [];
  let value = line.parsed_price;

  if (canonical) {
    const u = convertUom(value, line.raw_uom, canonical);
    notes.push(u.note);
    value = u.value;
  }
  if (value !== null) {
    const c = convertCurrency(value, currency, rfx?.base_currency ?? 'INR');
    notes.push(c.note);
    value = c.value;
  }
  return { price: value, note: notes.filter(Boolean).join(' · ') };
}
