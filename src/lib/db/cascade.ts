import { all, run } from './client';

/**
 * Deletion that takes the derived rows with it.
 *
 * SQLite here has no ON DELETE CASCADE, so every dependant is removed
 * explicitly. Keeping that in one place matters: the upload route and the
 * delete routes both need it, and two hand-written copies of a nine-table
 * teardown drift within a week — leaving orphaned quote lines that still show
 * up in the comparison after the document behind them is gone.
 */

/**
 * Removes a vendor document and everything extracted from it.
 *
 * Order matters. `quote` and `extraction_job` both reference
 * `vendor_document`, and `quote_line`, `review_item` and
 * `questionnaire_answer` hang off `quote`. This is the same order the
 * extraction pipeline uses when it re-extracts a document, and the two must
 * not diverge.
 */
export async function deleteDocumentDeep(docId: string): Promise<void> {
  const quotes = await all<{ id: string }>('SELECT id FROM quote WHERE doc_id = ?', [docId]);
  for (const q of quotes) {
    await run('DELETE FROM review_item WHERE quote_id = ?', [q.id]);
    await run('DELETE FROM quote_line WHERE quote_id = ?', [q.id]);
    await run('DELETE FROM questionnaire_answer WHERE quote_id = ?', [q.id]);
    await run('DELETE FROM quote WHERE id = ?', [q.id]);
  }
  await run('DELETE FROM extraction_job WHERE doc_id = ?', [docId]);
  await run('DELETE FROM vendor_document WHERE id = ?', [docId]);
}

/**
 * Removes an RFx and everything hanging off it — except the audit log.
 *
 * `audit_log.rfx_id` deliberately carries no foreign key. The record of what
 * was done outlives the thing it was done to, which is the point of keeping it
 * append-only: a deleted RFx leaves a trail showing it existed and was removed,
 * rather than vanishing as though it never happened.
 *
 * Vendors are not removed either. A supplier is an organisation-level record
 * that may hold documents against other RFx, and deleting one request is not a
 * statement about the supplier.
 */
export async function deleteRfxDeep(rfxId: string): Promise<void> {
  const docs = await all<{ id: string }>('SELECT id FROM vendor_document WHERE rfx_id = ?', [rfxId]);
  for (const d of docs) await deleteDocumentDeep(d.id);

  // Anything keyed straight to the RFx that the per-document sweep could not
  // reach — rows written before a document existed, or after it was removed.
  await run('DELETE FROM review_item WHERE rfx_id = ?', [rfxId]);
  await run('DELETE FROM quote_line WHERE rfx_id = ?', [rfxId]);
  await run('DELETE FROM questionnaire_answer WHERE rfx_id = ?', [rfxId]);
  await run('DELETE FROM quote WHERE rfx_id = ?', [rfxId]);
  await run('DELETE FROM extraction_job WHERE rfx_id = ?', [rfxId]);
  await run('DELETE FROM vendor_document WHERE rfx_id = ?', [rfxId]);

  await run('DELETE FROM qa_turn WHERE rfx_id = ?', [rfxId]);
  await run('DELETE FROM award WHERE rfx_id = ?', [rfxId]);
  await run('DELETE FROM dispatch WHERE rfx_id = ?', [rfxId]);
  await run('DELETE FROM questionnaire_question WHERE rfx_id = ?', [rfxId]);
  await run('DELETE FROM rfx_line WHERE rfx_id = ?', [rfxId]);
  await run('DELETE FROM rfx WHERE id = ?', [rfxId]);
}
