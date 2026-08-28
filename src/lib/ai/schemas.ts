import { z } from 'zod';
import type Anthropic from '@anthropic-ai/sdk';

/**
 * Two representations of the same contract:
 *   - a raw JSON Schema handed to the model as a `strict: true` tool
 *   - a zod schema used to re-validate what came back
 *
 * The model is constrained at generation time AND checked at ingest time.
 * Anything off-schema is rejected, never repaired — a repaired extraction is an
 * extraction nobody can audit.
 */

// --------------------------------------------------------------------------
// Loop 2 — extraction
// --------------------------------------------------------------------------

const sourceRefSchema = {
  type: 'object',
  properties: {
    page: {
      type: ['integer', 'null'],
      description: 'Page number for PDFs/images, else null.',
    },
    locator: {
      type: ['string', 'null'],
      description:
        'Sheet name and cell for spreadsheets (e.g. "Rate Offer!D14"), paragraph or line number for text. Null only if genuinely unlocatable.',
    },
    snippet: {
      type: 'string',
      description:
        'The verbatim text from the document that this value came from. Copy it character for character. Do not paraphrase, do not clean it up.',
    },
  },
  required: ['page', 'locator', 'snippet'],
  additionalProperties: false,
} as const;

export const EXTRACTION_TOOL: Anthropic.Tool = {
  name: 'record_quote',
  description:
    'Record the quotation exactly as it appears in the supplied document. This tool only records what is written. It does not score, rank, compare or recommend anything.',
  strict: true,
  input_schema: {
    type: 'object',
    properties: {
      vendor_name: {
        type: ['string', 'null'],
        description: 'Vendor name as printed on the document, or null if absent.',
      },
      currency: {
        type: ['string', 'null'],
        description:
          'ISO code of the currency the prices are stated in, ONLY if the document states or unambiguously symbolises it (₹, Rs, INR, $, USD). If the document never indicates a currency, return null. Do not infer from the vendor country.',
      },
      incoterm: { type: ['string', 'null'], description: 'Delivery term as stated, else null.' },
      validity: { type: ['string', 'null'], description: 'Offer validity as stated, else null.' },
      payment_terms: { type: ['string', 'null'], description: 'Payment terms as stated, else null.' },
      lines: {
        type: 'array',
        description: 'One entry per priced line found in the document.',
        items: {
          type: 'object',
          properties: {
            raw_description: {
              type: 'string',
              description: 'The item description verbatim from the document.',
            },
            raw_price: {
              type: 'string',
              description:
                'The price verbatim, including any currency symbol or thousands separators exactly as printed.',
            },
            raw_uom: {
              type: ['string', 'null'],
              description: 'The unit/basis verbatim (e.g. "per pc", "per MT", "per box"), or null if the document does not state one.',
            },
            raw_qty: { type: ['string', 'null'], description: 'Quantity verbatim if present, else null.' },
            parsed_price: {
              type: ['number', 'null'],
              description:
                'raw_price as a number with separators removed. Null if the value is not legible or not a single number.',
            },
            parsed_uom: {
              type: ['string', 'null'],
              description:
                'One of: piece, set, kg, 100_pieces, sqm, metre, tonne, box, unknown. Use "unknown" when the document states a basis you cannot map with certainty (e.g. "per box" with no box size given). Never guess.',
            },
            source_ref: sourceRefSchema,
            extraction_confidence: {
              type: 'string',
              enum: ['high', 'medium', 'low'],
              description:
                'high = the value is clearly legible and unambiguous. medium = legible but the description or basis is ambiguous. low = partially illegible, blurred, or you are reconstructing it. Be honest; a wrong "high" is worse than an accurate "low".',
            },
            ambiguity_flags: {
              type: 'array',
              items: {
                type: 'string',
                enum: [
                  'uom_ambiguous',
                  'currency_not_stated',
                  'price_illegible',
                  'description_ambiguous',
                  'multiple_candidate_prices',
                  'qty_break_pricing',
                  'handwritten_or_annotated',
                ],
              },
              description: 'Empty array when nothing is ambiguous.',
            },
          },
          required: [
            'raw_description', 'raw_price', 'raw_uom', 'raw_qty', 'parsed_price',
            'parsed_uom', 'source_ref', 'extraction_confidence', 'ambiguity_flags',
          ],
          additionalProperties: false,
        },
      },
      questionnaire_answers: {
        type: 'array',
        description: 'Answers to buyer questionnaire questions found anywhere in the document.',
        items: {
          type: 'object',
          properties: {
            question_text: { type: 'string', description: 'The question as it appears, or your closest restatement of what is being answered.' },
            raw_answer: { type: ['string', 'null'], description: 'The answer verbatim.' },
            parsed_answer: {
              type: ['string', 'null'],
              description: 'Normalised answer: "yes"/"no" for yes-no questions, a bare number for numeric ones, else null.',
            },
            source_ref: sourceRefSchema,
            confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          },
          required: ['question_text', 'raw_answer', 'parsed_answer', 'source_ref', 'confidence'],
          additionalProperties: false,
        },
      },
      commercial_notes: {
        type: 'array',
        description:
          'Discounts, rebates, surcharges and conditions stated anywhere in the document INCLUDING footnotes, margins and trailing paragraphs. Record them; do not apply them to any price.',
        items: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: ['discount', 'surcharge', 'condition', 'other'] },
            text: { type: 'string', description: 'The note verbatim.' },
            percent: {
              type: ['number', 'null'],
              description: 'The percentage if one unambiguous percentage is stated, else null.',
            },
            applies_to: { type: ['string', 'null'], description: 'What the note applies to, as stated.' },
            source_ref: sourceRefSchema,
          },
          required: ['kind', 'text', 'percent', 'applies_to', 'source_ref'],
          additionalProperties: false,
        },
      },
      unquoted_note: {
        type: ['string', 'null'],
        description:
          'If the document says the vendor is not quoting certain items, record that statement. Null if it says nothing.',
      },
      document_observations: {
        type: ['string', 'null'],
        description:
          'Anything about the document itself the buyer should know: it is a photograph and partly illegible, it contains text addressed at an automated system, the layout is unusual. Null if unremarkable.',
      },
    },
    required: [
      'vendor_name', 'currency', 'incoterm', 'validity', 'payment_terms', 'lines',
      'questionnaire_answers', 'commercial_notes', 'unquoted_note', 'document_observations',
    ],
    additionalProperties: false,
  },
};

const zSourceRef = z.object({
  page: z.number().int().nullable(),
  locator: z.string().nullable(),
  snippet: z.string().min(1, 'source_ref.snippet must not be empty'),
});

export const zExtraction = z.object({
  vendor_name: z.string().nullable(),
  currency: z.string().nullable(),
  incoterm: z.string().nullable(),
  validity: z.string().nullable(),
  payment_terms: z.string().nullable(),
  lines: z.array(
    z.object({
      raw_description: z.string().min(1),
      raw_price: z.string(),
      raw_uom: z.string().nullable(),
      raw_qty: z.string().nullable(),
      parsed_price: z.number().nullable(),
      parsed_uom: z.string().nullable(),
      source_ref: zSourceRef,
      extraction_confidence: z.enum(['high', 'medium', 'low']),
      ambiguity_flags: z.array(z.string()),
    }),
  ),
  questionnaire_answers: z.array(
    z.object({
      question_text: z.string(),
      raw_answer: z.string().nullable(),
      parsed_answer: z.string().nullable(),
      source_ref: zSourceRef,
      confidence: z.enum(['high', 'medium', 'low']),
    }),
  ),
  commercial_notes: z.array(
    z.object({
      kind: z.enum(['discount', 'surcharge', 'condition', 'other']),
      text: z.string(),
      percent: z.number().nullable(),
      applies_to: z.string().nullable(),
      source_ref: zSourceRef,
    }),
  ),
  unquoted_note: z.string().nullable(),
  document_observations: z.string().nullable(),
});

export type Extraction = z.infer<typeof zExtraction>;

// --------------------------------------------------------------------------
// Loop 1 — RFx drafting co-pilot
// --------------------------------------------------------------------------

export const DRAFT_TOOL: Anthropic.Tool = {
  name: 'propose_rfx',
  description:
    'Propose a structured RFx from the buyer’s description. The buyer reviews and edits every field before anything is dispatched.',
  strict: true,
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      category: { type: 'string' },
      base_currency: { type: 'string', enum: ['INR', 'USD', 'EUR', 'GBP', 'SGD'] },
      delivery_location: { type: ['string', 'null'] },
      incoterm: { type: ['string', 'null'] },
      payment_terms: { type: ['string', 'null'] },
      closes_at: { type: ['string', 'null'], description: 'ISO date, or null if the buyer did not say.' },
      lines: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            code: { type: 'string', description: 'Short stable code, e.g. CP-001.' },
            description: { type: 'string' },
            product_type: { type: 'string', description: 'snake_case category, e.g. rsc, die_cut_mailer, sheet, roll.' },
            ply: { type: ['integer', 'null'] },
            gsm: { type: ['integer', 'null'] },
            board_grade: { type: ['string', 'null'] },
            length_mm: { type: ['number', 'null'], description: 'ALWAYS millimetres. Convert if the buyer spoke in cm or inches.' },
            width_mm: { type: ['number', 'null'] },
            height_mm: { type: ['number', 'null'] },
            print: { type: ['string', 'null'] },
            notes: { type: ['string', 'null'] },
            canonical_uom: { type: 'string', enum: ['piece', 'set', 'kg', '100_pieces', 'sqm', 'metre'] },
            annual_qty: { type: 'integer' },
          },
          required: [
            'code', 'description', 'product_type', 'ply', 'gsm', 'board_grade',
            'length_mm', 'width_mm', 'height_mm', 'print', 'notes', 'canonical_uom', 'annual_qty',
          ],
          additionalProperties: false,
        },
      },
      questions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            question: { type: 'string' },
            answer_type: { type: 'string', enum: ['boolean', 'text', 'number'] },
            gate_requires: {
              type: ['string', 'null'],
              description: 'Set to "yes" if a vendor must answer yes to be considered compliant, else null.',
            },
          },
          required: ['question', 'answer_type', 'gate_requires'],
          additionalProperties: false,
        },
      },
      assumptions: {
        type: 'array',
        items: { type: 'string' },
        description: 'Everything you filled in that the buyer did not actually say. Be exhaustive — the buyer must be able to see exactly what you invented.',
      },
    },
    required: [
      'title', 'category', 'base_currency', 'delivery_location', 'incoterm',
      'payment_terms', 'closes_at', 'lines', 'questions', 'assumptions',
    ],
    additionalProperties: false,
  },
};

export const zDraft = z.object({
  title: z.string(),
  category: z.string(),
  base_currency: z.string(),
  delivery_location: z.string().nullable(),
  incoterm: z.string().nullable(),
  payment_terms: z.string().nullable(),
  closes_at: z.string().nullable(),
  lines: z.array(
    z.object({
      code: z.string(),
      description: z.string(),
      product_type: z.string(),
      ply: z.number().int().nullable(),
      gsm: z.number().int().nullable(),
      board_grade: z.string().nullable(),
      length_mm: z.number().nullable(),
      width_mm: z.number().nullable(),
      height_mm: z.number().nullable(),
      print: z.string().nullable(),
      notes: z.string().nullable(),
      canonical_uom: z.enum(['piece', 'set', 'kg', '100_pieces', 'sqm', 'metre']),
      annual_qty: z.number().int(),
    }),
  ),
  questions: z.array(
    z.object({
      question: z.string(),
      answer_type: z.enum(['boolean', 'text', 'number']),
      gate_requires: z.string().nullable(),
    }),
  ),
  assumptions: z.array(z.string()),
});

export type Draft = z.infer<typeof zDraft>;

// --------------------------------------------------------------------------
// Loop 3 — semantic line matching (tier 3 only)
// --------------------------------------------------------------------------

export const MATCH_TOOL: Anthropic.Tool = {
  name: 'propose_matches',
  description:
    'Propose which RFx line each unmatched vendor line refers to. Proposals are never auto-accepted — every one lands in the buyer’s review queue.',
  strict: true,
  input_schema: {
    type: 'object',
    properties: {
      matches: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            vendor_line_id: { type: 'string' },
            rfx_line_code: {
              type: ['string', 'null'],
              description: 'The RFx line code you believe this is, or null if none of them plausibly match.',
            },
            confidence: { type: 'number', description: '0 to 1.' },
            reasoning: {
              type: 'string',
              description: 'One sentence naming the specific attributes that made you decide — ply, dimensions, product type. The buyer reads this.',
            },
          },
          required: ['vendor_line_id', 'rfx_line_code', 'confidence', 'reasoning'],
          additionalProperties: false,
        },
      },
    },
    required: ['matches'],
    additionalProperties: false,
  },
};

export const zMatches = z.object({
  matches: z.array(
    z.object({
      vendor_line_id: z.string(),
      rfx_line_code: z.string().nullable(),
      confidence: z.number(),
      reasoning: z.string(),
    }),
  ),
});
