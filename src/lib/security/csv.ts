/**
 * CSV export with formula-injection sanitisation.
 *
 * Procurement teams open these in Excel. A vendor who writes
 * `=cmd|' /C calc'!A0` into a description field has written a payload that
 * executes when the buyer opens the export — the vendor never has to touch the
 * buyer's machine. This is a real and commonly missed vulnerability, and every
 * string in this system is supplier-controlled.
 */

// A leading =, +, -, @, tab or CR makes Excel and Google Sheets evaluate the cell.
const DANGEROUS_LEAD = /^[=+\-@\t\r]/;

// Control characters carry no meaning in a quotation and are a way to smuggle a
// payload past a leading-character check. Built with new RegExp so the escapes
// survive as escapes rather than as literal bytes in the source file.
const CONTROL_CHARS = new RegExp('[\\x00-\\x08\\x0b\\x0c\\x0e-\\x1f\\x7f]', 'g');

export function sanitizeCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  let s = String(value).replace(CONTROL_CHARS, '');

  // Prefixing with a single quote neutralises the formula and still displays
  // the original text to the buyer.
  if (DANGEROUS_LEAD.test(s)) s = `'${s}`;

  return s;
}

export function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function toCsv(columns: string[], rows: (string | number | null)[][]): string {
  const head = columns.map((c) => csvEscape(sanitizeCell(c))).join(',');
  const body = rows.map((r) => r.map((c) => csvEscape(sanitizeCell(c))).join(','));
  // BOM so Excel reads it as UTF-8 — the rupee sign is mojibake otherwise.
  return '﻿' + [head, ...body].join('\r\n') + '\r\n';
}
