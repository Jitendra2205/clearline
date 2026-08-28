import crypto from 'node:crypto';

/**
 * File intake guard.
 *
 * The declared extension is a claim by whoever uploaded the file. The bytes are
 * the fact. Everything here works off the bytes.
 */

export const MAX_BYTES = 12 * 1024 * 1024;

export type SniffedType =
  | 'application/pdf'
  | 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  | 'image/jpeg'
  | 'image/png'
  | 'image/webp'
  | 'image/gif'
  | 'text/plain'
  | 'message/rfc822';

export interface SniffResult {
  ok: boolean;
  mime: SniffedType | null;
  reason: string;
}

const startsWith = (b: Buffer, sig: number[], off = 0) =>
  sig.every((v, i) => b[off + i] === v);

/**
 * ZIP-based OOXML files (xlsx/docx) share the same PK header, so the container
 * has to be inspected to tell them apart. Reading the central directory
 * properly would need a zip parser; scanning for the marker entry names is
 * sufficient and cheap, and either way the file is only ever handed to a
 * parser that matches the sniffed type.
 */
function ooxmlKind(buf: Buffer): SniffedType | null {
  const head = buf.subarray(0, Math.min(buf.length, 64 * 1024)).toString('latin1');
  if (head.includes('xl/workbook.xml') || head.includes('xl/_rels')) {
    return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  }
  if (head.includes('word/document.xml') || head.includes('word/_rels')) {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  const tail = buf.subarray(Math.max(0, buf.length - 64 * 1024)).toString('latin1');
  if (tail.includes('xl/workbook.xml')) {
    return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  }
  if (tail.includes('word/document.xml')) {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  return null;
}

export function sniff(buf: Buffer, filename: string): SniffResult {
  if (buf.length === 0) return { ok: false, mime: null, reason: 'File is empty.' };
  if (buf.length > MAX_BYTES) {
    return { ok: false, mime: null, reason: `File exceeds the ${MAX_BYTES / 1024 / 1024} MB limit.` };
  }

  if (startsWith(buf, [0x25, 0x50, 0x44, 0x46])) return ok('application/pdf');
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return ok('image/jpeg');
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return ok('image/png');
  if (startsWith(buf, [0x47, 0x49, 0x46, 0x38])) return ok('image/gif');
  if (startsWith(buf, [0x52, 0x49, 0x46, 0x46]) && startsWith(buf, [0x57, 0x45, 0x42, 0x50], 8)) {
    return ok('image/webp');
  }

  if (startsWith(buf, [0x50, 0x4b, 0x03, 0x04])) {
    const kind = ooxmlKind(buf);
    if (kind) return ok(kind);
    return {
      ok: false,
      mime: null,
      reason: 'ZIP container is not a recognised .xlsx or .docx. Legacy .xls/.doc and arbitrary archives are not accepted.',
    };
  }

  // Text-ish: must decode as UTF-8 without control-character garbage.
  const text = buf.subarray(0, 4096).toString('utf8');
  const controlChars = (text.match(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g) ?? []).length;
  if (controlChars === 0) {
    // SVG and HTML are script vectors and are rejected outright, even though
    // they are technically text. Nothing in this product needs to render them.
    if (/<\s*svg[\s>]/i.test(text)) {
      return { ok: false, mime: null, reason: 'SVG is not accepted (scriptable content).' };
    }
    if (/<\s*(html|script|iframe|object|embed)[\s>]/i.test(text)) {
      return { ok: false, mime: null, reason: 'HTML is not accepted (scriptable content).' };
    }
    const looksLikeEmail = /^(from|to|subject|date|received|message-id):/im.test(text);
    if (looksLikeEmail || filename.toLowerCase().endsWith('.eml')) return ok('message/rfc822');
    return ok('text/plain');
  }

  return {
    ok: false,
    mime: null,
    reason: 'Unrecognised binary format. Accepted: pdf, xlsx, docx, png, jpg, webp, gif, txt, eml.',
  };
}

function ok(mime: SniffedType): SniffResult {
  return { ok: true, mime, reason: '' };
}

export function sha256(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/** Filenames are attacker-controlled. Never let one address the filesystem. */
export function safeFilename(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? 'upload';
  return base.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120) || 'upload';
}
