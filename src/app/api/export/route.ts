import { requireAuth } from '@/lib/security/auth';
import { toCsv } from '@/lib/security/csv';
import { all } from '@/lib/db/client';
import {
  cheapestPerLine, commercialNotes, comparePrices, coverageReport,
  questionnaireReport, totalCost,
} from '@/lib/query/engine';

export const runtime = 'nodejs';

/**
 * CSV exports. Everything routes through toCsv, which sanitises formula
 * injection — there is no path in the codebase that writes a CSV without it.
 */
export async function GET(req: Request) {
  const denied = await requireAuth();
  if (denied) return denied;

  const url = new URL(req.url);
  const rfxId = url.searchParams.get('rfxId');
  const type = url.searchParams.get('type') ?? 'comparison';
  const clearedOnly = url.searchParams.get('cleared') === '1';
  if (!rfxId) return Response.json({ error: 'rfxId is required.' }, { status: 400 });

  let columns: string[] = [];
  let rows: (string | number | null)[][] = [];
  let filename = 'clearline-export.csv';
  let preamble: string[][] = [];

  switch (type) {
    case 'comparison': {
      const r = await comparePrices(rfxId, { line_codes: null, vendor_names: null, only_quality_cleared: clearedOnly });
      columns = r.columns; rows = r.rows; filename = 'clearline-comparison.csv';
      preamble = [['Filters applied'], ...r.filtersApplied.map((f) => [f]), [''], ['Caveats'], ...r.caveats.map((c) => [c]), ['']];
      break;
    }
    case 'totals': {
      const r = await totalCost(rfxId, { vendor_names: null, only_quality_cleared: clearedOnly, line_codes: null, common_lines_only: true });
      columns = r.columns; rows = r.rows; filename = 'clearline-totals.csv';
      preamble = [['Filters applied'], ...r.filtersApplied.map((f) => [f]), [''], ['Caveats'], ...r.caveats.map((c) => [c]), ['']];
      break;
    }
    case 'split': {
      const r = await cheapestPerLine(rfxId, { only_quality_cleared: clearedOnly, vendor_names: null, line_codes: null });
      columns = r.columns; rows = r.rows; filename = 'clearline-split-award.csv';
      preamble = [['Filters applied'], ...r.filtersApplied.map((f) => [f]), [''], ['Caveats'], ...r.caveats.map((c) => [c]), ['']];
      break;
    }
    case 'coverage': {
      const r = await coverageReport(rfxId);
      columns = r.columns; rows = r.rows; filename = 'clearline-coverage.csv';
      break;
    }
    case 'questionnaire': {
      const r = await questionnaireReport(rfxId);
      columns = r.columns; rows = r.rows; filename = 'clearline-questionnaire.csv';
      break;
    }
    case 'notes': {
      const r = await commercialNotes(rfxId);
      columns = r.columns; rows = r.rows; filename = 'clearline-commercial-notes.csv';
      break;
    }
    case 'audit': {
      // The audit trail is the artefact that survives a challenge months later.
      const entries = await all<{
        at: string; actor: string; action: string; entity: string; entity_id: string;
        before_json: string | null; after_json: string | null;
      }>(
        'SELECT at, actor, action, entity, entity_id, before_json, after_json FROM audit_log WHERE rfx_id = ? ORDER BY at',
        [rfxId],
      );
      columns = ['Timestamp', 'Actor', 'Action', 'Entity', 'Entity ID', 'Before', 'After'];
      rows = entries.map((e) => [e.at, e.actor, e.action, e.entity, e.entity_id, e.before_json, e.after_json]);
      filename = 'clearline-audit-trail.csv';
      break;
    }
    case 'provenance': {
      // Every extracted line with its source document, locator and snippet.
      const lines = await all<{
        vendor: string; code: string | null; raw_description: string; raw_price: string;
        raw_uom: string | null; normalized_price: number | null; normalization_note: string | null;
        match_tier: string; match_score: number | null; extraction_confidence: string;
        blocked: number; source_ref_json: string; filename: string;
      }>(
        `SELECT v.name AS vendor, rl.code, ql.raw_description, ql.raw_price, ql.raw_uom,
                ql.normalized_price, ql.normalization_note, ql.match_tier, ql.match_score,
                ql.extraction_confidence, ql.blocked, ql.source_ref_json, d.filename
           FROM quote_line ql
           JOIN vendor v ON v.id = ql.vendor_id
           JOIN quote q ON q.id = ql.quote_id
           JOIN vendor_document d ON d.id = q.doc_id
           LEFT JOIN rfx_line rl ON rl.id = ql.matched_line_id
          WHERE ql.rfx_id = ? ORDER BY v.name, rl.line_no`,
        [rfxId],
      );
      columns = [
        'Vendor', 'RFx line', 'As written by vendor', 'Raw price', 'Raw basis',
        'Normalised (INR)', 'Conversion applied', 'Match tier', 'Match score',
        'Extraction confidence', 'In comparison', 'Source document', 'Page', 'Locator', 'Verbatim snippet',
      ];
      rows = lines.map((l) => {
        const ref = JSON.parse(l.source_ref_json || '{}') as { page?: number; locator?: string; snippet?: string };
        return [
          l.vendor, l.code, l.raw_description, l.raw_price, l.raw_uom, l.normalized_price,
          l.normalization_note, l.match_tier, l.match_score, l.extraction_confidence,
          l.blocked ? 'no — held for review' : 'yes', l.filename,
          ref.page ?? null, ref.locator ?? null, ref.snippet ?? null,
        ];
      });
      filename = 'clearline-provenance.csv';
      break;
    }
    default:
      return Response.json({ error: `Unknown export type "${type}".` }, { status: 400 });
  }

  const body = preamble.length > 0
    ? toCsv([`Clearline export — ${type}`], preamble) + '\r\n' + toCsv(columns, rows)
    : toCsv(columns, rows);

  return new Response(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
