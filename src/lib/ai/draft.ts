import type Anthropic from '@anthropic-ai/sdk';
import { anthropic, MODEL, FALLBACK_OPTS } from './client';
import { DRAFT_TOOL, zDraft, type Draft } from './schemas';

/**
 * Loop 1 — the RFx drafting co-pilot.
 *
 * The buyer describes what they need in plain language; the model returns a
 * structured RFx object through a strict tool schema. Not free text that gets
 * parsed afterwards — the schema is the interface.
 *
 * The co-pilot proposes and the buyer owns. Every generated line is editable
 * before dispatch, and `assumptions` forces the model to declare in writing
 * everything it invented that the buyer never said.
 */

const SYSTEM = `You help a category buyer turn a plain-language description into a structured RFx for packaging or industrial procurement.

Call \`propose_rfx\` exactly once.

## Rules

**Canonicalise the specification.** This is the single most valuable thing you do. Every dimension goes into the schema in millimetres, whatever unit the buyer used. Ply, GSM, board grade and product type go into their own fields, never left buried in prose. A downstream system matches vendor responses against these structured attributes, and prose it has to reverse-engineer is what makes that matching unreliable.

**Write descriptions a supplier would recognise.** Use the trade vocabulary — RSC, die-cut mailer, telescopic, layer pad, edge protector, ply, GSM, kraft/semi-kraft.

**Declare the unit of measure per line, deliberately.** Boxes are priced per piece, divider sets per set, roll stock per kg, thin separator sheets per 100 pieces. Getting this right at authoring time is what makes vendor responses comparable later.

**Fill the gaps, then confess them.** If the buyer asks for 30 lines and describes 6, generate a sensible full schedule around what they said. Then list every one of those inventions in \`assumptions\` — quantities you chose, sizes you picked, terms you assumed. The buyer must be able to see exactly what came from them and what came from you. Under-reporting assumptions is the failure mode here; be exhaustive.

**Questionnaire questions must be answerable.** Concrete and checkable — certifications with numbers, lead times in days, capacity in units. Mark a question as gating (\`gate_requires: "yes"\`) only when a "no" should genuinely disqualify a supplier.

If the buyer's description is too thin to build anything meaningful, still produce your best structured proposal and put the missing information at the top of \`assumptions\`.`;

export interface DraftOutcome {
  draft: Draft;
  inputTokens: number;
  outputTokens: number;
}

export async function draftRfx(
  history: { role: 'user' | 'assistant'; content: string }[],
  brief: string,
): Promise<DraftOutcome> {
  const client = anthropic();

  const messages: Anthropic.MessageParam[] = [
    ...history.map((h) => ({ role: h.role, content: h.content } as Anthropic.MessageParam)),
    { role: 'user', content: brief },
  ];

  const msg = (await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    system: SYSTEM,
    thinking: { type: 'adaptive' },
    tools: [DRAFT_TOOL],
    tool_choice: { type: 'tool', name: 'propose_rfx' },
    messages,
    ...FALLBACK_OPTS,
  })) as unknown as Anthropic.Message;

  if (msg.stop_reason === 'refusal') {
    throw new Error('The model declined to draft this RFx.');
  }

  const toolUse = msg.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'propose_rfx',
  );
  if (!toolUse) throw new Error('The co-pilot returned no RFx proposal.');

  const parsed = zDraft.safeParse(toolUse.input);
  if (!parsed.success) {
    throw new Error(
      `The proposed RFx did not validate: ${parsed.error.issues.slice(0, 3).map((i) => i.path.join('.') + ' ' + i.message).join('; ')}`,
    );
  }

  return {
    draft: parsed.data,
    inputTokens: msg.usage?.input_tokens ?? 0,
    outputTokens: msg.usage?.output_tokens ?? 0,
  };
}
