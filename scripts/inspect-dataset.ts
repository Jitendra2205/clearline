/** One-off: dump the Aerchain dataset so the seeder can be written against it. */
import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';
import mammoth from 'mammoth';

const DIR = 'C:/Users/jiten/Downloads';
const which = process.argv[2] ?? 'all';

function dumpXlsx(file: string) {
  const wb = XLSX.read(fs.readFileSync(path.join(DIR, file)), { type: 'buffer', cellText: true });
  console.log(`\n########## ${file} ##########`);
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws || !ws['!ref']) continue;
    console.log(`\n--- SHEET: ${name} ---`);
    const r = XLSX.utils.decode_range(ws['!ref']);
    for (let row = r.s.r; row <= r.e.r; row++) {
      const cells: string[] = [];
      for (let c = r.s.c; c <= r.e.c; c++) {
        const addr = XLSX.utils.encode_cell({ r: row, c });
        const cell = ws[addr];
        if (!cell) continue;
        const v = cell.w ?? cell.v;
        if (v === undefined || v === null || String(v).trim() === '') continue;
        cells.push(`${addr}=${String(v).replace(/\s+/g, ' ').trim()}`);
      }
      if (cells.length) console.log(`r${row + 1}: ${cells.join(' | ')}`);
    }
  }
}

async function dumpDocx(file: string) {
  const buf = fs.readFileSync(path.join(DIR, file));
  const { value } = await mammoth.convertToHtml({ buffer: buf });
  const text = value
    .replace(/<\/t[dh]>\s*<t[dh][^>]*>/gi, ' | ')
    .replace(/<tr[^>]*>/gi, '\n')
    .replace(/<\/(p|h[1-6]|li|table|tr)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');
  console.log(`\n########## ${file} ##########`);
  console.log(text.split('\n').map((l) => l.trim()).filter(Boolean).map((l, i) => `p${i + 1}: ${l}`).join('\n'));
}

function dumpPdfRaw(file: string) {
  // Just report size; the PDF goes to the model natively at runtime.
  const buf = fs.readFileSync(path.join(DIR, file));
  console.log(`\n########## ${file} ########## (${buf.length} bytes, sent natively to the model)`);
}

async function main() {
  if (which === 'all' || which === 'rfx') dumpXlsx('00_BUYER_RFx_RFQ-2026-PKG-0417.xlsx');
  if (which === 'all' || which === 'packrite') dumpXlsx('01_PackRite_Quotation.xlsx');
  if (which === 'all' || which === 'shakti') await dumpDocx('03_ShaktiPackaging_Offer.docx');
  if (which === 'all' || which === 'apex') await dumpDocx('06_ADVERSARIAL_Apex_injection.docx');
  if (which === 'all' || which === 'gc') dumpPdfRaw('02_GlobalCorrugates_Offer.pdf');
}

main().catch((e) => { console.error(e); process.exit(1); });
