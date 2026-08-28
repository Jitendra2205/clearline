/**
 * The schema, as a module rather than a file read at runtime.
 *
 * A .sql file reads better, but resolving it from disk breaks the moment the
 * app is bundled into a standalone server or a container image. This is the
 * single source of truth.
 */

export const SCHEMA_SQL = `-- Clearline schema. libSQL/SQLite dialect.
-- Idempotent: safe to run on every cold start.

CREATE TABLE IF NOT EXISTS org (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rfx (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  base_currency TEXT NOT NULL DEFAULT 'INR',
  delivery_location TEXT,
  incoterm TEXT,
  payment_terms TEXT,
  closes_at TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rfx_line (
  id TEXT PRIMARY KEY,
  rfx_id TEXT NOT NULL REFERENCES rfx(id),
  line_no INTEGER NOT NULL,
  code TEXT NOT NULL,
  description TEXT NOT NULL,
  spec_json TEXT NOT NULL,
  canonical_uom TEXT NOT NULL,
  annual_qty INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rfx_line_rfx ON rfx_line(rfx_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rfx_line_code ON rfx_line(rfx_id, code);

CREATE TABLE IF NOT EXISTS questionnaire_question (
  id TEXT PRIMARY KEY,
  rfx_id TEXT NOT NULL REFERENCES rfx(id),
  q_no INTEGER NOT NULL,
  question TEXT NOT NULL,
  answer_type TEXT NOT NULL,
  gate_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_qq_rfx ON questionnaire_question(rfx_id);

CREATE TABLE IF NOT EXISTS vendor (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  name TEXT NOT NULL,
  country TEXT NOT NULL,
  email TEXT NOT NULL,
  currency_hint TEXT
);

CREATE TABLE IF NOT EXISTS dispatch (
  id TEXT PRIMARY KEY,
  rfx_id TEXT NOT NULL REFERENCES rfx(id),
  vendor_id TEXT NOT NULL REFERENCES vendor(id),
  channel TEXT NOT NULL,
  subject TEXT,
  body TEXT,
  sent_at TEXT NOT NULL,
  -- SMTP is stubbed per the brief; this records what *would* have been sent.
  transport TEXT NOT NULL DEFAULT 'stub'
);

CREATE TABLE IF NOT EXISTS vendor_document (
  id TEXT PRIMARY KEY,
  rfx_id TEXT NOT NULL REFERENCES rfx(id),
  vendor_id TEXT NOT NULL REFERENCES vendor(id),
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  content TEXT NOT NULL,
  received_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_doc_rfx ON vendor_document(rfx_id);
CREATE INDEX IF NOT EXISTS idx_doc_sha ON vendor_document(sha256);

CREATE TABLE IF NOT EXISTS extraction_job (
  id TEXT PRIMARY KEY,
  rfx_id TEXT NOT NULL,
  doc_id TEXT NOT NULL REFERENCES vendor_document(id),
  -- content hash + prompt version; lets us cache and dedupe re-uploads
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  ms INTEGER,
  created_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_job_idem ON extraction_job(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_job_rfx ON extraction_job(rfx_id, status);

CREATE TABLE IF NOT EXISTS quote (
  id TEXT PRIMARY KEY,
  rfx_id TEXT NOT NULL REFERENCES rfx(id),
  vendor_id TEXT NOT NULL REFERENCES vendor(id),
  doc_id TEXT NOT NULL REFERENCES vendor_document(id),
  currency TEXT,
  incoterm TEXT,
  validity TEXT,
  payment_terms TEXT,
  commercial_notes_json TEXT NOT NULL DEFAULT '[]',
  unquoted_note TEXT,
  model_version TEXT NOT NULL,
  extracted_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_quote_rfx ON quote(rfx_id);

CREATE TABLE IF NOT EXISTS quote_line (
  id TEXT PRIMARY KEY,
  quote_id TEXT NOT NULL REFERENCES quote(id),
  rfx_id TEXT NOT NULL,
  vendor_id TEXT NOT NULL,
  raw_description TEXT NOT NULL,
  raw_price TEXT NOT NULL,
  raw_uom TEXT,
  raw_qty TEXT,
  parsed_price REAL,
  parsed_uom TEXT,
  source_ref_json TEXT NOT NULL,
  extraction_confidence TEXT NOT NULL,
  ambiguity_flags_json TEXT NOT NULL DEFAULT '[]',
  matched_line_id TEXT REFERENCES rfx_line(id),
  match_tier TEXT NOT NULL DEFAULT 'unmatched',
  match_score REAL,
  match_reason TEXT,
  normalized_price REAL,
  normalization_note TEXT,
  blocked INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_ql_quote ON quote_line(quote_id);
CREATE INDEX IF NOT EXISTS idx_ql_rfx_line ON quote_line(rfx_id, matched_line_id);
CREATE INDEX IF NOT EXISTS idx_ql_vendor ON quote_line(rfx_id, vendor_id);

CREATE TABLE IF NOT EXISTS questionnaire_answer (
  id TEXT PRIMARY KEY,
  quote_id TEXT NOT NULL REFERENCES quote(id),
  rfx_id TEXT NOT NULL,
  vendor_id TEXT NOT NULL,
  question_id TEXT,
  question_text TEXT NOT NULL,
  raw_answer TEXT,
  parsed_answer TEXT,
  source_ref_json TEXT,
  confidence TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_qa_rfx ON questionnaire_answer(rfx_id);

CREATE TABLE IF NOT EXISTS review_item (
  id TEXT PRIMARY KEY,
  rfx_id TEXT NOT NULL,
  quote_id TEXT NOT NULL,
  quote_line_id TEXT,
  kind TEXT NOT NULL,
  detail TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  resolution TEXT,
  resolved_by TEXT,
  resolved_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_review_rfx ON review_item(rfx_id, status);

CREATE TABLE IF NOT EXISTS fx_rate (
  id TEXT PRIMARY KEY,
  from_ccy TEXT NOT NULL,
  to_ccy TEXT NOT NULL,
  rate REAL NOT NULL,
  source TEXT NOT NULL,
  as_of TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS uom_factor (
  id TEXT PRIMARY KEY,
  from_uom TEXT NOT NULL,
  to_uom TEXT NOT NULL,
  factor REAL NOT NULL,
  note TEXT NOT NULL
);

-- Append-only. No UPDATE or DELETE statement in the codebase touches this table.
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  rfx_id TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_rfx ON audit_log(rfx_id, at);

CREATE TABLE IF NOT EXISTS award (
  id TEXT PRIMARY KEY,
  rfx_id TEXT NOT NULL,
  strategy TEXT NOT NULL,
  decision_json TEXT NOT NULL,
  rationale TEXT,
  decided_by TEXT NOT NULL,
  decided_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS qa_turn (
  id TEXT PRIMARY KEY,
  rfx_id TEXT NOT NULL,
  question TEXT NOT NULL,
  plan_json TEXT,
  result_json TEXT,
  answer TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_qa_turn_rfx ON qa_turn(rfx_id, created_at);
`;
