import { startToolLoop, ModelRefusedError, type ToolSpec } from './provider';
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

Some questions cannot be answered from this data — a vendor's capacity in a city they did not mention, a price for a line nobody quoted, next year's board prices. Say "I can't answer that from this data" and say what is missing. An invented answer here ends up in an award decision.

A vendor who wrote "rest same as last year" has not given you those prices. There is no prior-year price list in this dataset, so those lines are unknown and must stay unknown.

When coverage is partial, say so rather than quietly comparing different baskets. A vendor who quoted 4 of 30 lines is not "cheapest overall" in any sense a buyer can act on.

## Uncertainty

Some lines are held out of the comparison because a human has not yet confirmed them. The tools report this. If open review items could change your answer, say which way.`;

export const QUERY_TOOLS: ToolSpec[] = [
  {
    name: 'list_rfx_lines',
    description: 'List every line item in the RFx with its code, description, unit of measure and annual quantity. Use this to find line codes before calling other tools.',
    schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'coverage_report',
    description: 'Per vendor: how many RFx lines they quoted comparably, how many are held for review, and whether they cleared the quality questionnaire. Use this whenever coverage or completeness matters.',
    schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'compare_prices',
    description: 'A price matrix: normalised unit price per RFx line per vendor. Use for "what does each vendor charge for X".',
    schema: {
      type: 'object',
      properties: {
        line_codes: { type: ['array', 'null'], items: { type: 'string' }, description: 'RFx line codes such as L01, or null for all.' },
        vendor_names: { type: ['array', 'null'], items: { type: 'string' }, description: 'Vendor name fragments to limit to, or null for all.' },
        only_quality_cleared: { type: ['boolean', 'null'], description: 'True to include only vendors that cleared the gating questionnaire questions.' },
      },
      required: ['line_codes', 'vendor_names', 'only_quality_cleared'],
    },
  },
  {
    name: 'total_cost',
    description: 'Total annual cost per vendor (normalised unit price x RFx annual quantity), ranked cheapest first, with each vendor’s own coverage shown. By default compares only lines every included vendor quoted, so the comparison is like-for-like.',
    schema: {
      type: 'object',
      properties: {
        vendor_names: { type: ['array', 'null'], items: { type: 'string' } },
        only_quality_cleared: { type: ['boolean', 'null'] },
        line_codes: { type: ['array', 'null'], items: { type: 'string' } },
        common_lines_only: { type: ['boolean', 'null'], description: 'Default true. Set false to score each vendor on their own coverage, which is NOT like-for-like — say so if you do.' },
      },
      required: ['vendor_names', 'only_quality_cleared', 'line_codes', 'common_lines_only'],
    },
  },
  {
    name: 'cheapest_per_line',
    description: 'Split-award analysis: the cheapest vendor for every line, the annual saving over the next cheapest, and the resulting value awarded to each vendor. Use for "what if we split it, cheapest per line".',
    schema: {
      type: 'object',
      properties: {
        only_quality_cleared: { type: ['boolean', 'null'] },
        vendor_names: { type: ['array', 'null'], items: { type: 'string' } },
        line_codes: { type: ['array', 'null'], items: { type: 'string' } },
      },
      required: ['only_quality_cleared', 'vendor_names', 'line_codes'],
    },
  },
  {
    name: 'questionnaire_report',
    description: 'Every questionnaire question with each vendor’s answer as written, plus which vendors clear the gating questions and why the others do not.',
    schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'line_detail',
    description: 'For one RFx line: every vendor’s quote with the raw text as written, the raw price, the normalisation applied, the match tier and the extraction confidence. Use when the buyer asks how a number was arrived at.',
    schema: {
      type: 'object',
      properties: { line_code: { type: 'string', description: 'An RFx line code such as L01.' } },
      required: ['line_code'],
    },
  },
  {
    name: 'commercial_notes',
    description: 'Every discount, rebate, surcharge and condition stated in the vendor documents, including ones buried in footnotes. None are applied to prices.',
    schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'review_queue_summary',
    description: 'Counts of open and resolved review items by issue type. Use when asked what the system is unsure about.',
    schema: { type: 'object', properties: {}, required: [] },
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
 * A hand-rolled loop rather than an SDK helper, because the UI renders the tool
 * results itself — the buyer sees the table the model saw, not the model's
 * retelling of it.
 */
export async function* ask(
  rfxId: string,
  history: { role: 'user' | 'assistant'; content: string }[],
  question: string,
): AsyncGenerator<AskEvent> {
  let loop;
  try {
    loop = startToolLoop({ system: SYSTEM, history, question, tools: QUERY_TOOLS });
  } catch (e) {
    yield { type: 'error', error: e instanceof Error ? e.message : String(e) };
    return;
  }

  for (let turn = 0; turn < 8; turn++) {
    let step;
    try {
      step = await loop.next();
    } catch (e) {
      yield {
        type: 'error',
        error: e instanceof ModelRefusedError
          ? 'The model declined to answer this question.'
          : e instanceof Error ? e.message : String(e),
      };
      return;
    }

    if (step.text) yield { type: 'text', text: step.text };

    if (step.calls.length === 0) {
      yield { type: 'done' };
      return;
    }

    const results: { id: string; name: string; output: unknown }[] = [];
    for (const call of step.calls) {
      yield { type: 'tool_call', name: call.name, input: call.input };
      try {
        const r = await runQueryTool(rfxId, call.name, call.input);
        yield { type: 'tool_result', name: call.name, result: r };
        results.push({ id: call.id, name: call.name, output: compactForModel(r) });
      } catch (e) {
        results.push({
          id: call.id,
          name: call.name,
          output: { error: e instanceof Error ? e.message : String(e) },
        });
      }
    }
    loop.push(results);
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
