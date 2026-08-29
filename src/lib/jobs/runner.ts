import { nanoid } from 'nanoid';
import { all, one, run, j } from '../db/client';
import { extractQuote } from '../ai/extract';
import { normalizeExtraction } from '../normalize/pipeline';
import { PROMPT_VERSION, model, provider } from '../ai/provider';
import type { SniffedType } from '../security/files';

/**
 * Per-document extraction job.
 *
 * Idempotency key = content hash + model + prompt version. Re-uploading the
 * same file is free; changing a prompt invalidates every cache entry, which is
 * what you want when you are trying to measure whether a prompt change helped.
 */

export interface JobResult {
  jobId: string;
  quoteId: string | null;
  lines: number;
  blocked: number;
  reviewItems: number;
  ms: number;
  inputTokens: number;
  outputTokens: number;
  cached: boolean;
}

export async function runExtractionJob(opts: {
  docId: string;
  force?: boolean;
}): Promise<JobResult> {
  const doc = await one<{
    id: string; rfx_id: string; vendor_id: string; filename: string;
    mime: string; sha256: string; content: string;
  }>(
    'SELECT id, rfx_id, vendor_id, filename, mime, sha256, content FROM vendor_document WHERE id = ?',
    [opts.docId],
  );
  if (!doc) throw new Error(`Document ${opts.docId} not found`);

  const idem = `${doc.sha256}:${provider()}:${model()}:${PROMPT_VERSION}`;

  const prior = await one<{ id: string; status: string }>(
    'SELECT id, status FROM extraction_job WHERE idempotency_key = ?',
    [idem],
  );

  if (prior && prior.status === 'succeeded' && !opts.force) {
    const q = await one<{ id: string }>('SELECT id FROM quote WHERE doc_id = ?', [doc.id]);
    const [{ n: lines }] = await all<{ n: number }>(
      'SELECT COUNT(*) as n FROM quote_line WHERE quote_id = ?',
      [q?.id ?? ''],
    );
    return {
      jobId: prior.id, quoteId: q?.id ?? null, lines, blocked: 0, reviewItems: 0,
      ms: 0, inputTokens: 0, outputTokens: 0, cached: true,
    };
  }

  const jobId = prior?.id ?? `job_${nanoid(12)}`;
  const now = new Date().toISOString();

  if (prior) {
    await run("UPDATE extraction_job SET status='running', attempts=attempts+1, error=NULL WHERE id=?", [jobId]);
  } else {
    await run(
      `INSERT INTO extraction_job (id, rfx_id, doc_id, idempotency_key, status, attempts, created_at)
       VALUES (?,?,?,?, 'running', 1, ?)`,
      [jobId, doc.rfx_id, doc.id, idem, now],
    );
  }

  try {
    const rfx = await one<{ base_currency: string }>(
      'SELECT base_currency FROM rfx WHERE id = ?', [doc.rfx_id],
    );
    const vendor = await one<{ name: string }>('SELECT name FROM vendor WHERE id = ?', [doc.vendor_id]);
    const questions = await all<{ question: string }>(
      'SELECT question FROM questionnaire_question WHERE rfx_id = ? ORDER BY q_no', [doc.rfx_id],
    );
    const uoms = await all<{ canonical_uom: string }>(
      'SELECT DISTINCT canonical_uom FROM rfx_line WHERE rfx_id = ?', [doc.rfx_id],
    );

    const buf = Buffer.from(doc.content, 'base64');

    const outcome = await extractQuote({
      buf,
      mime: doc.mime as SniffedType,
      filename: doc.filename,
      vendorName: vendor?.name ?? 'Unknown vendor',
      questions: questions.map((q) => q.question),
      canonicalUomHint: uoms.map((u) => u.canonical_uom),
    });

    const result = await normalizeExtraction({
      rfxId: doc.rfx_id,
      vendorId: doc.vendor_id,
      docId: doc.id,
      extraction: outcome.extraction,
      modelVersion: outcome.modelVersion,
      provenanceFailures: outcome.provenanceFailures,
      baseCurrency: rfx?.base_currency ?? 'INR',
    });

    await run(
      `UPDATE extraction_job SET status='succeeded', input_tokens=?, output_tokens=?, ms=?, finished_at=?
       WHERE id=?`,
      [outcome.usage.inputTokens, outcome.usage.outputTokens, outcome.ms, new Date().toISOString(), jobId],
    );

    // Audit log records job identity and aggregates only — never prices.
    // Vendor pricing is commercially sensitive and does not belong in logs.
    await run(
      `INSERT INTO audit_log (id, rfx_id, actor, action, entity, entity_id, before_json, after_json, at)
       VALUES (?,?,?,?,?,?,NULL,?,?)`,
      [
        `au_${nanoid(10)}`, doc.rfx_id, 'system', 'extraction.completed', 'document', doc.id,
        j.stringify({
          jobId,
          model: outcome.modelVersion,
          strategy: outcome.strategy,
          lines: result.linesWritten,
          blocked: result.blocked,
          reviewItems: result.reviewItems,
          provenanceFailures: outcome.provenanceFailures.length,
          observations: outcome.observations,
        }),
        new Date().toISOString(),
      ],
    );

    return {
      jobId,
      quoteId: result.quoteId,
      lines: result.linesWritten,
      blocked: result.blocked,
      reviewItems: result.reviewItems,
      ms: outcome.ms,
      inputTokens: outcome.usage.inputTokens,
      outputTokens: outcome.usage.outputTokens,
      cached: false,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await run(
      "UPDATE extraction_job SET status='failed', error=?, finished_at=? WHERE id=?",
      [message.slice(0, 500), new Date().toISOString(), jobId],
    );
    // One vendor's document failing must never block the other four.
    throw e;
  }
}
