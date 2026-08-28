/**
 * Does deterministic matching work on the vendor prose?
 *
 * Scores tiers 1 and 2 against the ground-truth descriptions — i.e. the strings
 * exactly as they appear in the vendor documents. This measures the MATCHER in
 * isolation, with a perfect reading of each document. It is an upper bound:
 * the real figure, over what the extractor actually reads off a blurred photo,
 * is measured by `npm run eval`. Do not quote this number as end-to-end
 * accuracy.
 */
import { buildGroundTruth, RFX_LINES } from './dataset';
import { exactMatch, fuzzyMatch, parseAttrs } from '../src/lib/normalize/match';

const lines = RFX_LINES.map((l) => ({ id: l.code, code: l.code, description: l.description, spec: l.spec }));
const gt = buildGroundTruth();

let exact = 0, fuzzy = 0, miss = 0, wrong = 0;
const misses: string[] = [];

for (const q of gt) {
  let vExact = 0, vFuzzy = 0, vMiss = 0, vWrong = 0;
  for (const l of q.lines) {
    const m = exactMatch(l.vendorDescription, lines) ?? fuzzyMatch(l.vendorDescription, lines);
    if (!m) {
      vMiss++; miss++;
      misses.push(`${q.vendorKey.padEnd(10)} MISS  ${l.rfxCode}  "${l.vendorDescription}"  ${JSON.stringify(parseAttrs(l.vendorDescription))}`);
    } else if (m.lineId !== l.rfxCode) {
      vWrong++; wrong++;
      misses.push(`${q.vendorKey.padEnd(10)} WRONG ${l.rfxCode} -> ${m.lineId} (${m.tier} ${m.score})  "${l.vendorDescription}"`);
    } else if (m.tier === 'exact') { vExact++; exact++; }
    else { vFuzzy++; fuzzy++; }
  }
  console.log(`${q.vendorKey.padEnd(10)} exact=${vExact} fuzzy=${vFuzzy} miss=${vMiss} wrong=${vWrong}  (of ${q.lines.length})`);
}

const total = exact + fuzzy + miss + wrong;
console.log(`\nTOTAL ${total}: exact=${exact} fuzzy=${fuzzy} miss=${miss} WRONG=${wrong}`);
console.log('  (matcher in isolation, against a perfect reading of each document — end-to-end accuracy is npm run eval)');
console.log(`deterministic coverage ${(((exact + fuzzy) / total) * 100).toFixed(1)}%, precision ${((exact + fuzzy) / (exact + fuzzy + wrong) * 100).toFixed(1)}%\n`);
misses.slice(0, 40).forEach((m) => console.log(m));
