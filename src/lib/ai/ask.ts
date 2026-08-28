import type Anthropic from '@anthropic-ai/sdk';
import { anthropic, MODEL, FALLBACK_OPTS } from './client';
import {
  cheapestPerLine, commercialNotes, comparePrices, coverageReport, lineDetail,
  listRfxLines, questionnaireReport, reviewQueueSummary, totalCost, type QueryResult,
} from '../query/engine';

/**
 * Loop 3 — analyst Q&A.
 *
 * The model may only see the data by calling one of the query tools below.
 * It has no arithmetic to do: it picks the query, reads the result, and writes
 * the sentence. Every figure it can quote is a figure the application computed
 * and is showing the buyer directly underneath the answer.
 */

const SYSTEM = `You are a procurement analyst assistant working over a normalised RFx comparison dataset.

## How you answer

You cannot see the data. You reach it only by calling the query tools. Call as many as the question needs, then answer in prose.

**You do not do arithmetic.** Never add, average, multiply or rank numbers yourself. If a question needs a computation, there is a tool that performs it — call that tool. If no tool computes what was asked, say so plainly rather than working it out in your head. Every number in your answer must appear verbatim in a tool result you received in this turn.

## What a good answer looks like

- Lead with the direct answer in one or two sentences.
- Name the vendors and the figures the tools returned.
- State the basis you used: which vendors, which lines, like-for-like or not.
- Surface the caveats the tool returned. They are not boilerplate — they say which lines were excluded and why, and a buyer acting on this answer needs them.
- Be short. The buyer is reading a table directly below your answer; do not narrate the whole table back to them.

## Refusing well

Some questions cannot be answered from this data — a vendor's manufacturing capacity in a city they did not mention, a price for a line nobody quoted, next year's board prices. Say "I can't answer that from this data" and say what is missing. An invented answer here ends up in an award decision.

When coverage is partial, say so rather than quietly comparing different baskets. "Pacific is cheapest" is misleading if Pacific quoted 9 lines and the others quoted 30.

## Uncertainty

Some lines are held out of the comparison because a human has not yet confirmed them. The tools report this. If open review items could change your answer, say which way.`;

export const QUERY_TOOLS: Anthropic.Tool[] = [
  {
    name: 'list_rfx_lines',
    description: 'List every line item in the RFx with its code, description, unit of measure and annual quantity. Use this to find line codes before calling other tools.',
    input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    name: 'coverage_report',
    description: 'Per vendor: how many RFx lines they quoted comparably, how many are held for review, and whether they cleared the quality questionnaire. Use this whenever coverage or completeness matters.',
    input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    name: 'compare_prices',
    description: 'A price matrix: normalised unit price per RFx line per vendor. Use for "what does each vendor charge for X".',
    input_schema: {
      type: 'object',
      properties: {
        line_codes: { type: ['array', 'null'], items: { type: 'string' }, description: 'RFx line codes to limit to, or null for all.' },
        vendor_names: { type: ['array', 'null'], items: { type: 'string' }, description: 'Vendor name fragments to limit to, or null for all.' },
        only_quality_cleared: { type: ['boolean', 'null'], description: 'True to include only vendors that cleared the gating questionnaire questions.' },
      },
      required: ['line_codes', 'vendor_names', 'only_quality_cleared'],
      additionalProperties: false,
    },
  },
  {
    name: 'total_cost',
    description: 'Total annual cost per vendor (normalised unit price x RFx annual quantity), ranked cheapest first. By default compares only lines every included vendor quoted, so the comparison is like-for-like.',
    input_schema: {
      type: 'object',
      properties: {
        vendor_names: { type: ['array', 'null'], items: { type: 'string' } },
        only_quality_cleared: { type: ['boolean', 'null'] },
        line_codes: { type: ['array', 'null'], items: { type: 'string' } },
        common_lines_only: { type: ['boolean', 'null'], description: 'Default true. Set false ONLY if the buyer explicitly wants each vendor scored on their own coverage, which is not like-for-like.' },
      },
      required: ['vendor_names', 'only_quality_cleared', 'line_codes', 'common_lines_only'],
      additionalProperties: false,
    },
  },
  {
    name: 'cheapest_per_line',
    description: 'Split-award analysis: the cheapest vendor for every line, the annual saving over the next cheapest, and the resulting value awarded to each vendor. Use for "what if we split it, cheapest per line".',
    input_schema: {
      type: 'object',
      properties: {
        only_quality_cleared: { type: ['boolean', 'null'] },
        vendor_names: { type: ['array', 'null'], items: { type: 'string' } },
        line_codes: { type: ['array', 'null'], items: { type: 'string' } },
      },
      required: ['only_quality_cleared', 'vendor_names', 'line_codes'],
      additionalProperties: false,
    },
  },
  {
    name: 'questionnaire_report',
    description: 'Every questionnaire question with each vendor’s answer as written, plus which vendors clear the gating questions.',
    input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    name: 'line_detail',
    description: 'For one RFx line: every vendor’s quote with the raw text as written, the raw price, the normalisation applied, the match tier and the extraction confidence. Use when the buyer asks how a number was arrived at.',
    input_schema: {
      type: 'object',
      properties: { line_code: { type: 'string' } },
      required: ['line_code'],
      additionalProperties: false,
    },
  },
  {
    name: 'commercial_notes',
    description: 'Every discount, rebate, surcharge and condition stated in the vendor documents, including ones buried in footnotes. None are applied to prices.',
    input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    name: 'review_queue_summary',
    description: 'Counts of open and resolved review items by issue type. Use when asked what the system is unsure about.',
    input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
];

type ToolInput = Record<string, unknown>;

export async function runQueryTool(
  rfxId: string,
  name: string,
  input: ToolInput,
): Promise<QueryResult> {
  switch (name) {
    case 'list_rfx_lines': return listRfxLines(rfxId);
    case 'coverage_report': return coverageReport(rfxId);
    case 'compare_prices': return comparePrices(rfxId, input as never);
    case 'total_cost': return totalCost(rfxId, input as never);
    case 'cheapest_per_line': return cheapestPerLine(rfxId, input as never);
    case 'questionnaire_report': return questionnaireReport(rfxId);
    case 'line_detail': return lineDetail(rfxId, String(input.line_code ?? ''));
    case 'commercial_notes': return commercialNotes(rfxId);
    case 'review_queue_summary': return reviewQueueSummary(rfxId);
    default: throw new Error(`Unknown query tool: ${name}`);
  }
}

export interface AskEvent {
  type: 'tool_call' | 'tool_result' | 'text' | 'done' | 'error';
  name?: string;
  input?: unknown;
  result?: QueryResult;
  text?: string;
  error?: string;
}

/**
 * Manual loop rather than the SDK tool runner, because the UI renders the tool
 * results itself — the buyer sees the table the model saw, not the model's
 * retelling of it.
 */
export async function* ask(
  rfxId: string,
  history: Anthropic.MessageParam[],
  question: string,
): AsyncGenerator<AskEvent> {
  const client = anthropic();
  const messages: Anthropic.MessageParam[] = [
    ...history,
    { role: 'user', content: question },
  ];

  for (let turn = 0; turn < 8; turn++) {
    let msg: Anthropic.Message;
    try {
      msg = (await client.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        system: SYSTEM,
        thinking: { type: 'adaptive' },
        tools: QUERY_TOOLS,
        messages,
        ...FALLBACK_OPTS,
      })) as unknown as Anthropic.Message;
    } catch (e) {
      yield { type: 'error', error: e instanceof Error ? e.message : String(e) };
      return;
    }

    if (msg.stop_reason === 'refusal') {
      yield { type: 'error', error: 'The model declined to answer this question.' };
      return;
    }

    for (const block of msg.content) {
      if (block.type === 'text' && block.text.trim()) {
        yield { type: 'text', text: block.text };
      }
    }

    const toolUses = msg.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
    );

    if (toolUses.length === 0) {
      yield { type: 'done' };
      return;
    }

    messages.push({ role: 'assistant', content: msg.content });

    // All results go back in ONE user message, per the parallel tool contract.
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      yield { type: 'tool_call', name: tu.name, input: tu.input };
      try {
        const r = await runQueryTool(rfxId, tu.name, tu.input as ToolInput);
        yield { type: 'tool_result', name: tu.name, result: r };
        results.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: JSON.stringify(compactForModel(r)),
        });
      } catch (e) {
        results.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          is_error: true,
          content: e instanceof Error ? e.message : String(e),
        });
      }
    }
    messages.push({ role: 'user', content: results });
  }

  yield { type: 'error', error: 'Query loop exceeded its step budget without producing an answer.' };
}

/** Keeps large matrices from eating the context window on a 30x5 grid. */
function compactForModel(r: QueryResult): unknown {
  const MAX = 40;
  return {
    kind: r.kind,
    filters_applied: r.filtersApplied,
    caveats: r.caveats,
    columns: r.columns,
    rows: r.rows.slice(0, MAX),
    rows_truncated: r.rows.length > MAX ? r.rows.length - MAX : 0,
    meta: r.meta,
  };
}
