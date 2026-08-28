/**
 * Does deterministic matching place the Aerchain vendors' own descriptions?
 *
 * Scores tiers 1 and 2 against the descriptions exactly as they appear in the
 * supplied documents — i.e. with a perfect reading of each file. This measures
 * the MATCHER in isolation; end-to-end accuracy over what the extractor
 * actually reads off the angled photo is what `npm run eval` reports.
 *
 * Run: npm run test:match
 */

import { all, ready, j } from '../src/lib/db/client';
import { exactMatch, fuzzyMatch, parseAttrs, type RfxLineForMatch } from '../src/lib/normalize/match';
import type { LineSpec } from '../src/lib/types';

/** Verbatim item text from each supplied document, with the line it belongs to. */
const CASES: { vendor: string; expect: number; text: string }[] = [
  // --- PackRite xlsx: own codes, own order, near-identical wording ---
  ...[
    [3, 'RSC Shipper Carton 350x250x150mm, 3-ply'], [4, 'RSC Shipper Carton 300x200x150mm, 3-ply'],
    [5, 'RSC Shipper Carton 250x200x120mm, 3-ply'], [1, 'RSC Shipper Carton 450x300x200mm, 5-ply'],
    [2, 'RSC Shipper Carton 400x280x180mm, 5-ply'], [6, 'Die-Cut Mailer Box 320x240x80mm, 3-ply'],
    [7, 'Die-Cut Mailer Box 260x180x60mm, 3-ply'], [8, 'Die-Cut Mailer Box 200x150x50mm, 3-ply'],
    [15, 'Corrugated Sheet Pad 450x300mm, 3-ply'], [16, 'Corrugated Sheet Pad 350x250mm, 3-ply'],
    [13, 'Partition Insert 4-cell, 350x250mm, 3-ply'], [14, 'Partition Insert 6-cell, 400x300mm, 3-ply'],
    [30, 'Corrugated Divider Set 450x300mm, 9-cell, 3-ply'], [9, 'Heavy Duty Export Carton 600x400x400mm, 7-ply'],
    [10, 'Heavy Duty Export Carton 500x400x300mm, 7-ply'], [11, 'Telescopic Lid Carton 450x350x250mm, 5-ply'],
    [12, 'Telescopic Lid Carton 380x300x200mm, 5-ply'], [20, 'Printed Shipper Carton 400x300x250mm, 5-ply, 2-col'],
    [21, 'Printed Shipper Carton 350x280x200mm, 5-ply, 2-col'], [22, 'Printed Mailer Box 300x220x100mm, 3-ply, 4-col'],
    [23, 'Fruit Tray Carton 500x300x120mm, 5-ply'], [24, 'Fruit Tray Carton 400x300x100mm, 5-ply'],
    [25, 'Pizza Style Fold Box 300x300x40mm, 3-ply'], [26, 'Layer Pad Full Pallet 1150x950mm, 3-ply'],
    [27, 'Layer Pad Half Pallet 1150x475mm, 3-ply'], [28, 'Edge Protector L-Profile 50x50x1000mm'],
    [29, 'Edge Protector L-Profile 35x35x800mm'], [17, 'Corrugated Roll 1200mm width, 3-ply'],
    [18, 'Corrugated Roll 1000mm width, 3-ply'], [19, 'Corrugated Roll 800mm width, 2-ply'],
  ].map(([n, t]) => ({ vendor: 'packrite', expect: n as number, text: t as string })),

  // --- Global Corrugates PDF: same wording, spec in a separate column ---
  ...[
    [1, 'RSC Shipper Carton 450x300x200mm, 5-ply BF-18, 180gsm'],
    [9, 'Heavy Duty Export Carton 600x400x400mm, 7-ply BF-22, 220gsm'],
    [15, 'Corrugated Sheet Pad 450x300mm, 3-ply BF-14, 140gsm'],
    [17, 'Corrugated Roll 1200mm width, 3-ply BF-16, 150gsm'],
    [19, 'Corrugated Roll 800mm width, 2-ply BF-14, 140gsm'],
    [28, 'Edge Protector L-Profile 50x50x1000mm EP-STD'],
    [30, 'Corrugated Divider Set 450x300mm, 9-cell, 3-ply BF-16, 150gsm'],
  ].map(([n, t]) => ({ vendor: 'globalcorr', expect: n as number, text: t as string })),

  // --- Shakti docx: prose, so the extractor emits a phrase, not a row ---
  { vendor: 'shakti', expect: 1, text: 'The 450x300x200mm 5-ply carton' },
  { vendor: 'shakti', expect: 2, text: 'the 400x280x180mm 5-ply' },
  { vendor: 'shakti', expect: 3, text: 'the 350x250x150mm' },
  { vendor: 'shakti', expect: 4, text: 'the 300x200x150mm' },
  { vendor: 'shakti', expect: 5, text: 'the smaller 250x200x120mm' },
  { vendor: 'shakti', expect: 6, text: 'die-cut mailer boxes 320x240x80mm' },
  { vendor: 'shakti', expect: 11, text: 'telescopic lid cartons 450x350x250mm size' },
  { vendor: 'shakti', expect: 13, text: 'Partition inserts 4-cell 350x250mm' },
  { vendor: 'shakti', expect: 14, text: 'Partition inserts 6-cell 400x300mm' },
  { vendor: 'shakti', expect: 30, text: 'The 9-cell divider set at 450x300mm' },
  { vendor: 'shakti', expect: 15, text: 'the 450x300mm 3-ply pad' },
  { vendor: 'shakti', expect: 16, text: 'the 350x250mm 3-ply pad' },
  { vendor: 'shakti', expect: 17, text: 'The 1200mm width 3-ply roll' },
  { vendor: 'shakti', expect: 18, text: 'the 1000mm width 3-ply roll' },
  { vendor: 'shakti', expect: 20, text: 'the 400x300x250mm 5-ply two-colour shipper' },
  { vendor: 'shakti', expect: 22, text: 'the 300x220x100mm four-colour mailer' },
  { vendor: 'shakti', expect: 23, text: 'Fruit tray cartons 500x300x120mm' },
  { vendor: 'shakti', expect: 25, text: 'The pizza-style fold box at 300x300x40mm' },
  { vendor: 'shakti', expect: 26, text: 'Full pallet layer pads at 1150x950mm' },
  { vendor: 'shakti', expect: 27, text: 'half pallet at 1150x475mm' },
  { vendor: 'shakti', expect: 28, text: 'Edge protectors 50x50x1000mm L-profile' },
  { vendor: 'shakti', expect: 29, text: 'Edge protectors 35x35x800mm profile' },

  // --- MetroBoard photo: description + a separate SIZE (MM) column ---
  ...[
    [1, 'RSC Shipper Carton 450x300x200mm, 5-ply'], [6, 'Die-Cut Mailer Box 320x240x80mm, 3-ply'],
    [13, 'Partition Insert 4-cell, 350x250mm, 3-ply'], [15, 'Corrugated Sheet Pad 450x300mm, 3-ply'],
    [20, 'Printed Shipper Carton 400x300x250mm, 5-ply,..'], [23, 'Fruit Tray Carton 500x300x120mm, 5-ply'],
    [25, 'Pizza Style Fold Box 300x300x40mm, 3-ply'],
  ].map(([n, t]) => ({ vendor: 'metroboard', expect: n as number, text: t as string })),

  // --- NovaPack email: the terse ones ---
  { vendor: 'novapack', expect: 1, text: '450x300x200 5ply' },
  { vendor: 'novapack', expect: 3, text: '350x250x150 3ply' },
  { vendor: 'novapack', expect: 9, text: '600x400x400 7ply export carton' },
  { vendor: 'novapack', expect: 17, text: '1200mm 3ply roll' },
];

async function main() {
  await ready();
  const rows = await all<{ id: string; code: string; description: string; spec_json: string; line_no: number }>(
    'SELECT id, code, description, spec_json, line_no FROM rfx_line ORDER BY line_no',
  );
  if (rows.length === 0) {
    console.error('  No RFx lines. Run: npm run seed');
    process.exit(1);
  }

  const lines: RfxLineForMatch[] = rows.map((r) => ({
    id: r.id, code: r.code, description: r.description,
    spec: j.parse<LineSpec>(r.spec_json, {} as LineSpec),
  }));
  const byId = new Map(rows.map((r) => [r.id, r.line_no]));

  const per: Record<string, { exact: number; fuzzy: number; miss: number; wrong: number }> = {};
  const problems: string[] = [];

  for (const c of CASES) {
    per[c.vendor] ??= { exact: 0, fuzzy: 0, miss: 0, wrong: 0 };
    const m = exactMatch(c.text, lines) ?? fuzzyMatch(c.text, lines);
    if (!m || m.lineId === null) {
      per[c.vendor].miss++;
      problems.push(`${c.vendor.padEnd(11)} MISS  want L${c.expect}  "${c.text}"  ${JSON.stringify(parseAttrs(c.text))}`);
    } else if (byId.get(m.lineId) !== c.expect) {
      per[c.vendor].wrong++;
      problems.push(`${c.vendor.padEnd(11)} WRONG want L${c.expect} got L${byId.get(m.lineId)} (${m.tier} ${m.score})  "${c.text}"`);
    } else if (m.tier === 'exact') per[c.vendor].exact++;
    else per[c.vendor].fuzzy++;
  }

  console.log('\n  Deterministic matching — Aerchain dataset (RFQ-2026-PKG-0417)\n');
  let E = 0, F = 0, M = 0, W = 0;
  for (const [v, s] of Object.entries(per)) {
    const n = s.exact + s.fuzzy + s.miss + s.wrong;
    console.log(`    ${v.padEnd(12)} exact=${s.exact} fuzzy=${s.fuzzy} miss=${s.miss} wrong=${s.wrong}   (of ${n})`);
    E += s.exact; F += s.fuzzy; M += s.miss; W += s.wrong;
  }
  const total = E + F + M + W;
  console.log(`\n    TOTAL ${total}: placed=${E + F}  missed=${M}  WRONG=${W}`);
  console.log(`    coverage ${(((E + F) / total) * 100).toFixed(1)}%   precision ${(((E + F) / Math.max(1, E + F + W)) * 100).toFixed(1)}%`);
  console.log('    (matcher in isolation, against a perfect reading of each document)\n');
  problems.forEach((p) => console.log(`    ${p}`));

  process.exit(W > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
