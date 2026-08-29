import { NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { requireAuth } from '@/lib/security/auth';
import { draftRfx } from '@/lib/ai/draft';
import { ModelUnavailableError } from '@/lib/ai/provider';
import { batch, run, j } from '@/lib/db/client';
import type { Draft } from '@/lib/ai/schemas';

export const runtime = 'nodejs';
export const maxDuration = 300;

/** Loop 1: propose a structured RFx from a plain-language brief. */
export async function POST(req: Request) {
  const denied = await requireAuth();
  if (denied) return denied;

  const { brief, history } = (await req.json()) as {
    brief?: string;
    history?: { role: 'user' | 'assistant'; content: string }[];
  };
  if (!brief?.trim()) {
    return NextResponse.json({ error: 'Describe what you need to buy.' }, { status: 400 });
  }

  try {
    const { draft, inputTokens, outputTokens } = await draftRfx(history ?? [], brief);
    return NextResponse.json({ ok: true, draft, usage: { inputTokens, outputTokens } });
  } catch (e) {
    if (e instanceof ModelUnavailableError) {
      return NextResponse.json({ error: e.message, kind: 'no_api_key' }, { status: 503 });
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

/**
 * Commits an edited draft as a real RFx.
 *
 * The buyer's edits are what get saved — the model's proposal is never written
 * to the database without passing through the review screen first.
 */
export async function PUT(req: Request) {
  const denied = await requireAuth();
  if (denied) return denied;

  const { draft } = (await req.json()) as { draft?: Draft };
  if (!draft || !Array.isArray(draft.lines) || draft.lines.length === 0) {
    return NextResponse.json({ error: 'A draft with at least one line is required.' }, { status: 400 });
  }

  const rfxId = `rfx_${nanoid(12)}`;
  const now = new Date().toISOString();

  await run(
    `INSERT INTO rfx (id, org_id, title, category, base_currency, delivery_location, incoterm,
       payment_terms, closes_at, status, created_at) VALUES (?,?,?,?,?,?,?,?,?, 'draft', ?)`,
    [
      rfxId, 'org_demo', draft.title, draft.category, draft.base_currency,
      draft.delivery_location, draft.incoterm, draft.payment_terms, draft.closes_at, now,
    ],
  );

  const seen = new Set<string>();
  await batch(
    draft.lines.map((l, i) => {
      // Codes come from a model and must be unique — the DB has a unique index
      // on (rfx_id, code) and a duplicate would fail the whole batch.
      let code = l.code;
      let n = 2;
      while (seen.has(code)) code = `${l.code}-${n++}`;
      seen.add(code);

      return {
        sql: `INSERT INTO rfx_line (id, rfx_id, line_no, code, description, spec_json, canonical_uom, annual_qty)
              VALUES (?,?,?,?,?,?,?,?)`,
        args: [
          `rl_${nanoid(12)}`, rfxId, i + 1, code, l.description,
          j.stringify({
            productType: l.product_type, ply: l.ply, gsm: l.gsm, boardGrade: l.board_grade,
            lengthMm: l.length_mm, widthMm: l.width_mm, heightMm: l.height_mm,
            print: l.print, notes: l.notes,
          }),
          l.canonical_uom, l.annual_qty,
        ],
      };
    }),
  );

  await batch(
    draft.questions.map((q, i) => ({
      sql: `INSERT INTO questionnaire_question (id, rfx_id, q_no, question, answer_type, gate_json)
            VALUES (?,?,?,?,?,?)`,
      args: [
        `qq_${nanoid(12)}`, rfxId, i + 1, q.question, q.answer_type,
        q.gate_requires ? j.stringify({ requires: q.gate_requires }) : null,
      ],
    })),
  );

  await run(
    `INSERT INTO audit_log (id, rfx_id, actor, action, entity, entity_id, before_json, after_json, at)
     VALUES (?,?,?,?,?,?,NULL,?,?)`,
    [
      `au_${nanoid(10)}`, rfxId, 'buyer@demo', 'rfx.created', 'rfx', rfxId,
      j.stringify({
        title: draft.title,
        lines: draft.lines.length,
        questions: draft.questions.length,
        // The model's own declaration of what it invented, kept with the RFx.
        copilotAssumptions: draft.assumptions,
      }),
      now,
    ],
  );

  return NextResponse.json({ ok: true, rfxId });
}
