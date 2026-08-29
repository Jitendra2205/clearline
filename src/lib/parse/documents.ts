import * as XLSX from 'xlsx';
import mammoth from 'mammoth';
import type { Part } from '../ai/provider';
import type { SniffedType } from '../security/files';

/**
 * Turns a vendor document into the parts of an extraction request.
 *
 * Where a lossless text rendering exists (spreadsheets, Word, email) we build it
 * ourselves and keep cell/paragraph addresses, so the model can cite a precise
 * locator and so the provenance check has something to verify against. Where it
 * does not (PDF, photographs) the bytes go to the model natively —
 * re-typesetting a PDF into text throws away the layout that makes a rate table
 * readable in the first place.
 */

export interface PreparedDocument {
  parts: Part[];
  /** How the document was presented to the model — recorded on the job. */
  strategy: 'text' | 'native_pdf' | 'native_image';
  /** Plain-text rendering, when one exists. Used by the provenance verifier. */
  text: string | null;
}

export function prepareDocument(
  buf: Buffer,
  mime: SniffedType,
  filename: string,
): PreparedDocument {
  switch (mime) {
    case 'application/pdf':
      return {
        strategy: 'native_pdf',
        text: null,
        parts: wrapNative({ kind: 'file', mime: 'application/pdf', base64: buf.toString('base64') }, filename),
      };

    case 'image/jpeg':
    case 'image/png':
    case 'image/webp':
    case 'image/gif':
      return {
        strategy: 'native_image',
        text: null,
        parts: wrapNative({ kind: 'file', mime, base64: buf.toString('base64') }, filename),
      };

    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
      const text = renderWorkbook(buf);
      return { strategy: 'text', text, parts: [wrapText(text, filename)] };
    }

    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      // mammoth is async; the caller uses prepareDocumentAsync for docx.
      throw new Error('Use prepareDocumentAsync for .docx');

    case 'text/plain':
    case 'message/rfc822': {
      const text = renderPlainText(buf.toString('utf8'));
      return { strategy: 'text', text, parts: [wrapText(text, filename)] };
    }
  }
}

export async function prepareDocumentAsync(
  buf: Buffer,
  mime: SniffedType,
  filename: string,
): Promise<PreparedDocument> {
  if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    // HTML rather than raw text: it survives tables, which is where half of a
    // Word quotation's numbers live. It also preserves the white 1pt text an
    // injection hides in — which is exactly what we want to see and neutralise.
    const { value } = await mammoth.convertToHtml({ buffer: buf });
    const text = htmlToLocatedText(value);
    return { strategy: 'text', text, parts: [wrapText(text, filename)] };
  }
  return prepareDocument(buf, mime, filename);
}

/**
 * Every sheet rendered with real cell addresses, so `source_ref.locator` can be
 * "Quotation!F13" and a buyer can click through to the actual cell.
 */
function renderWorkbook(buf: Buffer): string {
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: true, cellNF: false, cellText: true });
  const out: string[] = [];

  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws || !ws['!ref']) continue;
    out.push(`### SHEET: ${name}`);
    const range = XLSX.utils.decode_range(ws['!ref']);

    for (let r = range.s.r; r <= range.e.r; r++) {
      const cells: string[] = [];
      for (let c = range.s.c; c <= range.e.c; c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        const cell = ws[addr];
        if (!cell) continue;
        const v = cell.w ?? cell.v;
        if (v === undefined || v === null || String(v).trim() === '') continue;
        cells.push(`${addr}=${String(v).replace(/\s+/g, ' ').trim()}`);
      }
      if (cells.length) out.push(`row ${r + 1}: ${cells.join(' | ')}`);
    }
    out.push('');
  }
  return out.join('\n');
}

function htmlToLocatedText(html: string): string {
  const withRows = html
    .replace(/<\/t[dh]>\s*<t[dh][^>]*>/gi, ' | ')
    .replace(/<tr[^>]*>/gi, '\n')
    .replace(/<\/tr>/gi, '')
    .replace(/<\/(p|h[1-6]|li|table)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));

  return withRows
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l, i) => `para ${i + 1}: ${l}`)
    .join('\n');
}

function renderPlainText(text: string): string {
  return text
    .split(/\r?\n/)
    .map((l, i) => `line ${i + 1}: ${l}`)
    .join('\n');
}

/**
 * The delimiter boundary.
 *
 * Everything between the markers is vendor-supplied and therefore untrusted.
 * The system prompt refers to these markers by name and states that content
 * inside them is data to be read, never instructions to follow.
 */
export const DOC_OPEN = '<<<BEGIN_UNTRUSTED_VENDOR_DOCUMENT>>>';
export const DOC_CLOSE = '<<<END_UNTRUSTED_VENDOR_DOCUMENT>>>';

function wrapText(text: string, filename: string): Part {
  // Strip any attempt to forge the boundary markers from inside the document.
  const cleaned = text.split(DOC_OPEN).join('[removed]').split(DOC_CLOSE).join('[removed]');
  return {
    kind: 'text',
    text: `${DOC_OPEN}\nfilename: ${filename}\n\n${cleaned}\n${DOC_CLOSE}`,
  };
}

function wrapNative(file: Part, filename: string): Part[] {
  return [
    { kind: 'text', text: `${DOC_OPEN}\nfilename: ${filename}\nThe attached file follows.` },
    file,
    { kind: 'text', text: DOC_CLOSE },
  ];
}
