// Domain types for Clearline — RFx-to-award.
// Kept deliberately explicit: `null` always means "not stated in the source",
// never "zero" and never "unknown but probably X".

export type Confidence = 'high' | 'medium' | 'low';
export type MatchTier = 'exact' | 'fuzzy' | 'semantic' | 'unmatched';
export type ReviewStatus = 'open' | 'resolved' | 'dismissed';
export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

/** Canonical units of measure the buyer may declare on an RFx line. */
export const CANONICAL_UOMS = [
  'piece',
  'set',
  'kg',
  '100_pieces',
  'sqm',
  'metre',
] as const;
export type CanonicalUom = (typeof CANONICAL_UOMS)[number];

export interface RfxLine {
  id: string;
  rfxId: string;
  lineNo: number;
  code: string;
  description: string;
  /** Structured spec — the thing that makes deterministic matching possible. */
  spec: LineSpec;
  canonicalUom: CanonicalUom;
  annualQty: number;
}

export interface LineSpec {
  productType: string; // 'rsc' | 'die_cut_mailer' | 'sheet' | 'roll' | ...
  ply: number | null;
  gsm: number | null;
  boardGrade: string | null;
  /** Always millimetres. Normalising at authoring time is the whole point. */
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
  print: string | null;
  notes: string | null;
}

export interface QuestionnaireQuestion {
  id: string;
  rfxId: string;
  qNo: number;
  question: string;
  answerType: 'boolean' | 'text' | 'number';
  /**
   * If set, this question participates in the pass/fail quality gate — either
   * as a yes/no answer or as a numeric threshold (e.g. on-time delivery >= 90%).
   */
  gate: { requires: string } | { minNumeric: number; unit?: string } | null;
}

export interface Vendor {
  id: string;
  name: string;
  country: string;
  email: string;
  currencyHint: string | null;
}

export interface VendorDocument {
  id: string;
  rfxId: string;
  vendorId: string;
  filename: string;
  mime: string;
  bytes: number;
  sha256: string;
  /** base64 payload; served only through a short-TTL signed route. */
  content: string;
  receivedAt: string;
}

/** Verbatim pointer back into the source document. Mandatory on every field. */
export interface SourceRef {
  docId: string;
  page: number | null;
  /** Sheet name / paragraph index / line number — whatever locates it. */
  locator: string | null;
  /** Verbatim text from the document. Never paraphrased. */
  snippet: string;
}

export interface ExtractedQuoteLine {
  id: string;
  quoteId: string;
  rawDescription: string;
  rawPrice: string;
  rawUom: string | null;
  rawQty: string | null;
  parsedPrice: number | null;
  parsedUom: string | null;
  sourceRef: SourceRef;
  extractionConfidence: Confidence;
  ambiguityFlags: string[];

  // --- filled by the normalisation pipeline, never by the model ---
  matchedLineId: string | null;
  matchTier: MatchTier;
  matchScore: number | null;
  matchReason: string | null;
  /** Price in the RFx's canonical UoM and base currency. */
  normalizedPrice: number | null;
  normalizationNote: string | null;
  blocked: boolean;
}

export interface Quote {
  id: string;
  rfxId: string;
  vendorId: string;
  docId: string;
  currency: string | null;
  incoterm: string | null;
  validity: string | null;
  paymentTerms: string | null;
  /** Discounts the vendor stated anywhere in the document, including footnotes. */
  commercialNotes: CommercialNote[];
  unquotedNote: string | null;
  modelVersion: string;
  extractedAt: string;
}

export interface CommercialNote {
  kind: 'discount' | 'surcharge' | 'condition' | 'other';
  text: string;
  /** Only set when the vendor stated an unambiguous, applicable percentage. */
  percent: number | null;
  appliesTo: string | null;
  sourceRef: SourceRef;
  /** Discounts are NEVER auto-applied to prices. The buyer decides. */
  autoApplied: false;
}

export interface QuestionnaireAnswer {
  id: string;
  quoteId: string;
  questionId: string | null;
  questionText: string;
  rawAnswer: string | null;
  parsedAnswer: string | null;
  sourceRef: SourceRef | null;
  confidence: Confidence;
}

export interface ReviewItem {
  id: string;
  rfxId: string;
  quoteLineId: string | null;
  quoteId: string;
  kind:
    | 'currency_not_stated'
    | 'uom_not_convertible'
    | 'low_confidence_extraction'
    | 'semantic_match_unconfirmed'
    | 'price_outside_band'
    | 'snippet_mismatch'
    | 'unmatched_line'
    | 'incoterm_not_stated';
  detail: string;
  status: ReviewStatus;
  resolution: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

export interface AuditEntry {
  id: string;
  rfxId: string;
  actor: string;
  action: string;
  entity: string;
  entityId: string;
  before: unknown;
  after: unknown;
  at: string;
}

export interface FxRate {
  from: string;
  to: string;
  rate: number;
  source: string;
  asOf: string;
}
