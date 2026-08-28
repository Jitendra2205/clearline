import type { LineSpec, MatchTier } from '../types';

/**
 * Line-item matching — the hard problem.
 *
 * Three tiers, deliberately separated so the comparison grid can show the buyer
 * which tier produced each cell:
 *
 *   1. exact    — the vendor cited the buyer's own line code. Trustworthy.
 *   2. fuzzy    — deterministic scoring over parsed spec attributes. Auditable:
 *                 the same input always produces the same score, and the score
 *                 is shown.
 *   3. semantic — a model proposal. NEVER auto-accepted; always queued.
 *
 * Tiers 1 and 2 involve no model at all. That matters: the majority of the grid
 * is produced by code a buyer's auditor can read.
 */

export interface RfxLineForMatch {
  id: string;
  code: string;
  description: string;
  spec: LineSpec;
}

export interface MatchResult {
  lineId: string | null;
  tier: MatchTier;
  score: number | null;
  reason: string;
}

// ---------------------------------------------------------------------------
// Tier 1 — the vendor cited the buyer's line code
// ---------------------------------------------------------------------------

/**
 * `searchText` should include the verbatim source snippet as well as the
 * description — vendors often put the buyer's reference in a neighbouring
 * column, which lands in the snippet rather than in the description itself.
 */
export function exactMatch(
  searchText: string,
  lines: RfxLineForMatch[],
): MatchResult | null {
  const text = searchText.toUpperCase();
  for (const line of lines) {
    // Word-boundary match so CP-1 never matches CP-10.
    const re = new RegExp(`\\b${escapeRe(line.code.toUpperCase())}\\b`);
    if (re.test(text)) {
      return {
        lineId: line.id,
        tier: 'exact',
        score: 1,
        reason: `Vendor cited buyer line code ${line.code} in the description.`,
      };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Tier 2 — deterministic scoring over parsed attributes
// ---------------------------------------------------------------------------

export interface ParsedAttrs {
  ply: number | null;
  /** Always millimetres, sorted descending, so 450x300x200 == 300x200x450. */
  dimsMm: number[];
  productType: string | null;
  gsm: number | null;
}

/**
 * Order matters: the first pattern to hit wins, so the most specific product
 * names come first. "Book Wrap Mailer" must resolve to book_wrap, not to
 * die_cut_mailer — getting that ordering wrong silently mismatched a line at
 * a confident 0.92 score, which is exactly the failure this system exists to
 * prevent.
 */
const TYPE_KEYWORDS: [string, RegExp][] = [
  ['book_wrap', /\b(book\s?wrap)\b/i],
  ['edge_protector', /\b(edge\s?protector|edge\s?protection|l[\s-]?profile)\b/i],
  ['angle_board', /\b(angle\s?board)\b/i],
  ['export_box', /\b(export[\s-]?(grade\s+)?(box|carton|container|shipper)|ispm)\b/i],
  ['ventilated_box', /\b(vent|vented|ventilated)[\s-]*(box|carton|container)?\b/i],
  ['folding_carton', /\b(folding\s+carton|fold\s+carton)\b/i],
  ['pallet_cap', /\b(pallet\s?cap)\b/i],
  ['bin_box', /\b(bin\s?box|stackable)\b/i],
  ['telescopic', /\b(telescopic|tele\s?box|two[\s-]piece)\b/i],
  ['partition', /\b(partition|divider|cell)\b/i],
  ['separator', /\b(separator|sep\s+sheet)\b/i],
  ['layer_pad', /\b(layer\s?pad|\bpad\b)\b/i],
  ['die_cut_tray', /\b(die[\s-]?cut\s+tray|diecut\s+tray|tray)\b/i],
  ['die_cut_insert', /\b(die[\s-]?cut\s+insert|diecut\s+insert|insert)\b/i],
  ['die_cut_mailer', /\b(die[\s-]?cut\s+mailer|diecut\s+mailer|mailer\s+box|mailer)\b/i],
  ['roll', /\b(roll|roll\s?stock)\b/i],
  ['sheet', /\b(corr(ugated)?\s+sheet|flat\s+sheet|\bsheet\b)\b/i],
  ['rsc', /\b(rsc|regular\s+slotted|shipper|carton|box)\b/i],
];

export function parseAttrs(raw: string): ParsedAttrs {
  const s = raw.toLowerCase();

  // ply: "5-ply", "5ply", "5 ply", "five ply", "5P"
  let ply: number | null = null;
  const plyDigit = s.match(/(\d)\s*[-\s]?\s*ply\b/) ?? s.match(/\b(\d)p\b/);
  if (plyDigit) ply = Number(plyDigit[1]);
  if (ply === null) {
    const words: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 };
    const m = s.match(/\b(two|three|four|five|six|seven)\s+ply\b/);
    if (m) ply = words[m[1]];
  }

  const gsmMatch = s.match(/(\d{2,4})\s*gsm/);
  const gsm = gsmMatch ? Number(gsmMatch[1]) : null;

  let productType: string | null = null;
  for (const [type, re] of TYPE_KEYWORDS) {
    if (re.test(raw)) {
      productType = type;
      break;
    }
  }

  return { ply, gsm, productType, dimsMm: parseDims(raw) };
}

/**
 * Dimensions are the strongest signal, and the one vendors mangle most:
 * millimetres, centimetres and inches all appear, with x / × / X / * separators.
 */
export function parseDims(raw: string): number[] {
  const s = raw.replace(/[×✕✖]/g, 'x').replace(/\s*x\s*/gi, 'x');

  const groups = [...s.matchAll(/(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)(?:x(\d+(?:\.\d+)?))?/g)];

  if (groups.length === 0) {
    // Roll stock and web materials are specified by a single width. Only accept
    // a lone number when it carries an explicit unit, so GSM and quantities
    // never get mistaken for a dimension.
    const solo = s.match(/(\d{2,4}(?:\.\d+)?)\s*(mm|cm|millimetre|millimeter|centimetre|centimeter)\b/i);
    if (!solo) return [];
    const unit = /^m/i.test(solo[2]) ? 'mm' : 'cm';
    return [Math.round(Number(solo[1]) * (unit === 'mm' ? 1 : 10))];
  }

  // Take the longest group — a 3-dim match beats an incidental 2-number pair.
  const g = groups.sort((a, b) => (b[3] ? 3 : 2) - (a[3] ? 3 : 2))[0];
  const nums = [g[1], g[2], g[3]].filter(Boolean).map(Number);
  if (nums.length === 0) return [];

  const unit = detectDimUnit(s, g.index ?? 0, nums);
  const toMm = { mm: 1, cm: 10, inch: 25.4, m: 1000 }[unit];
  return nums.map((n) => Math.round(n * toMm)).sort((a, b) => b - a);
}

function detectDimUnit(s: string, at: number, nums: number[]): 'mm' | 'cm' | 'inch' | 'm' {
  // Look just after the dimension group for an explicit unit.
  const tail = s.slice(at, at + 60).toLowerCase();
  if (/\bmm\b|millimetre|millimeter/.test(tail)) return 'mm';
  if (/\bcm\b|centimetre|centimeter/.test(tail)) return 'cm';
  if (/["”]|\binch|\bin\b/.test(tail)) return 'inch';

  // No explicit unit: infer from magnitude. Corrugated packaging dimensions
  // are 40-2000 mm; the same box in cm is 4-200 and in inches is 1.5-80.
  const max = Math.max(...nums);
  if (max >= 150) return 'mm';
  if (max >= 60) return 'cm';
  return 'inch';
}

const W_TYPE = 0.3;
const W_PLY = 0.22;
const W_DIMS = 0.4;
const W_GSM = 0.08;

/** Accept threshold for tier 2. Below this the line goes to the model, then to a human. */
export const FUZZY_ACCEPT = 0.82;

export function fuzzyMatch(
  rawDescription: string,
  lines: RfxLineForMatch[],
): MatchResult | null {
  const attrs = parseAttrs(rawDescription);
  if (attrs.dimsMm.length === 0 && attrs.productType === null) return null;

  let best: { line: RfxLineForMatch; score: number; parts: string[] } | null = null;

  for (const line of lines) {
    const parts: string[] = [];
    // Score is normalised over the attributes that are actually *applicable* to
    // this pair. A line where neither side states a ply is not evidence against
    // the match, so it must not drag the score down — that bug silently pushed
    // perfectly good matches below the accept threshold.
    let score = 0;
    let weight = 0;

    // product type
    if (attrs.productType !== null || line.spec.productType !== null) {
      weight += W_TYPE;
      if (attrs.productType === line.spec.productType) {
        score += W_TYPE;
        parts.push(`type ${attrs.productType}`);
      } else if (attrs.productType === 'rsc') {
        // 'box'/'carton' is the catch-all keyword — a clash here is weak
        // evidence against, not proof against.
        score += W_TYPE * 0.25;
      }
    }

    // ply
    if (attrs.ply !== null || line.spec.ply !== null) {
      weight += W_PLY;
      if (attrs.ply === line.spec.ply) {
        score += W_PLY;
        if (attrs.ply !== null) parts.push(`${attrs.ply}-ply`);
      }
    }

    // dimensions — the decisive attribute
    const target = [line.spec.lengthMm, line.spec.widthMm, line.spec.heightMm]
      .filter((d): d is number => d !== null)
      .sort((a, b) => b - a);
    if (attrs.dimsMm.length > 0 && target.length > 0) {
      weight += W_DIMS;
      const d = dimSimilarity(attrs.dimsMm, target);
      score += W_DIMS * d;
      if (d > 0.9) parts.push(`dimensions ${attrs.dimsMm.join('x')} mm`);
    } else if (attrs.dimsMm.length > 0 !== target.length > 0) {
      // One side has dimensions and the other does not — genuine evidence
      // against, so charge the weight and award nothing.
      weight += W_DIMS;
    }

    // gsm
    if (attrs.gsm !== null && line.spec.gsm !== null) {
      weight += W_GSM;
      if (attrs.gsm === line.spec.gsm) {
        score += W_GSM;
        parts.push(`${attrs.gsm} GSM`);
      }
    }

    const normalised = weight === 0 ? 0 : score / weight;
    if (!best || normalised > best.score) best = { line, score: normalised, parts };
  }

  if (!best || best.score < FUZZY_ACCEPT) return null;

  return {
    lineId: best.line.id,
    tier: 'fuzzy',
    score: Math.round(best.score * 1000) / 1000,
    reason: `Matched on ${best.parts.join(', ')} (deterministic score ${best.score.toFixed(2)}).`,
  };
}

/** 1.0 when every dimension is within tolerance; falls off with relative error. */
function dimSimilarity(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  // Penalise a 2-dim quote against a 3-dim RFx line, but don't zero it.
  const shapePenalty = a.length === b.length ? 1 : 0.8;

  let acc = 0;
  for (let i = 0; i < n; i++) {
    const err = Math.abs(a[i] - b[i]) / Math.max(a[i], b[i]);
    // Vendors round: 305 mm becomes 30 cm becomes 300 mm. 4% tolerance is free.
    acc += err <= 0.04 ? 1 : Math.max(0, 1 - (err - 0.04) * 8);
  }
  return (acc / n) * shapePenalty;
}

/** Ranked shortlist handed to the model for tier-3 proposals. */
export function shortlist(
  rawDescription: string,
  lines: RfxLineForMatch[],
  n = 6,
): RfxLineForMatch[] {
  const attrs = parseAttrs(rawDescription);
  return lines
    .map((line) => {
      const target = [line.spec.lengthMm, line.spec.widthMm, line.spec.heightMm]
        .filter((d): d is number => d !== null)
        .sort((a, b) => b - a);
      let s = 0;
      if (attrs.productType === line.spec.productType) s += 1;
      if (attrs.ply !== null && attrs.ply === line.spec.ply) s += 1;
      if (attrs.dimsMm.length && target.length) s += dimSimilarity(attrs.dimsMm, target) * 2;
      return { line, s };
    })
    .sort((a, b) => b.s - a.s)
    .slice(0, n)
    .map((x) => x.line);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
