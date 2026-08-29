/**
 * Currency and unit-of-measure normalisation.
 *
 * The rule that governs this whole file: a conversion the buyer cannot see is
 * a conversion the buyer cannot defend. Every function here returns the note
 * explaining what it did, and returns `null` rather than guessing.
 */

export interface FxRateRow {
  from: string;
  to: string;
  rate: number;
  source: string;
  asOf: string;
}

/** Seeded into the DB; shown in the UI with source and as-of date. */
export const FX_RATES: FxRateRow[] = [
  { from: 'USD', to: 'INR', rate: 83.5, source: 'RBI reference rate', asOf: '2026-09-01' },
  { from: 'EUR', to: 'INR', rate: 90.2, source: 'RBI reference rate', asOf: '2026-09-01' },
  { from: 'SGD', to: 'INR', rate: 62.1, source: 'RBI reference rate', asOf: '2026-09-01' },
  { from: 'GBP', to: 'INR', rate: 105.4, source: 'RBI reference rate', asOf: '2026-09-01' },
];

export interface ConversionResult {
  value: number | null;
  note: string;
  /** Set when the conversion could not be performed and a human must decide. */
  review: { kind: string; detail: string } | null;
}

export function convertCurrency(
  amount: number | null,
  from: string | null,
  to: string,
  rates: FxRateRow[] = FX_RATES,
): ConversionResult {
  if (amount === null) {
    return { value: null, note: 'No price value to convert.', review: null };
  }
  if (from === null) {
    // The single most important line in this file. A quote with no stated
    // currency is not an INR quote, it is an unknown quote.
    return {
      value: null,
      note: 'Currency not stated in the source document. Not assumed.',
      review: {
        kind: 'currency_not_stated',
        detail:
          'The document never states a currency. Confirm the currency before this line enters the comparison.',
      },
    };
  }
  if (from === to) {
    return { value: amount, note: `Already in ${to}.`, review: null };
  }
  const rate = rates.find((r) => r.from === from && r.to === to);
  if (!rate) {
    return {
      value: null,
      note: `No FX rate on file for ${from} to ${to}.`,
      review: { kind: 'currency_not_stated', detail: `Add an FX rate for ${from}/${to}.` },
    };
  }
  const value = roundInternal(amount * rate.rate);
  return {
    value,
    note: `converted from ${from} ${showExact(amount)} @ ${rate.rate} (${rate.source}, ${rate.asOf})`,
    review: null,
  };
}

// ---------------------------------------------------------------------------

export interface UomFactor {
  from: string;
  to: string;
  /** Multiply the vendor's price by this to express it in the canonical UoM. */
  factor: number;
  note: string;
}

/**
 * Only conversions with a single defensible factor live here.
 *
 * "per box" is deliberately absent. A box is whatever the vendor says it is,
 * and a system that silently decides a box is 50 pieces has invented ₹4 crore
 * of pricing out of nothing.
 */
export const UOM_FACTORS: UomFactor[] = [
  { from: 'tonne', to: 'kg', factor: 0.001, note: '1 tonne = 1000 kg' },
  { from: 'kg', to: 'tonne', factor: 1000, note: '1000 kg = 1 tonne' },
  { from: 'piece', to: '100_pieces', factor: 100, note: '100 pieces = 100 x the per-piece price' },
  { from: '100_pieces', to: 'piece', factor: 0.01, note: '1 piece = 1/100 of the per-100 price' },
  { from: 'gram', to: 'kg', factor: 1000, note: '1 kg = 1000 g' },
];

/** UoM strings a vendor may write, mapped to the canonical vocabulary. */
const UOM_ALIASES: Record<string, string> = {
  pc: 'piece', pcs: 'piece', piece: 'piece', pieces: 'piece', each: 'piece',
  ea: 'piece', nos: 'piece', no: 'piece', unit: 'piece', units: 'piece',
  'per pc': 'piece', 'per pcs': 'piece', 'per piece': 'piece', 'per each': 'piece',
  set: 'set', sets: 'set', 'per set': 'set',
  kg: 'kg', kgs: 'kg', kilogram: 'kg', kilograms: 'kg', 'per kg': 'kg', 'per kilogram': 'kg',
  mt: 'tonne', ton: 'tonne', tonne: 'tonne', tonnes: 'tonne', 'metric tonne': 'tonne', 'per mt': 'tonne',
  '100pc': '100_pieces', '100 pcs': '100_pieces', '100_pieces': '100_pieces',
  'per 100': '100_pieces', 'per 100 pcs': '100_pieces', 'per 100 pieces': '100_pieces',
  'per hundred': '100_pieces', hundred: '100_pieces',
  sqm: 'sqm', 'sq m': 'sqm', 'square metre': 'sqm', 'per sqm': 'sqm',
  m: 'metre', metre: 'metre', meter: 'metre', 'per metre': 'metre', 'running metre': 'metre',
  g: 'gram', gram: 'gram', grams: 'gram',
  // Deliberately mapped to a non-convertible token, not to 'piece'.
  box: 'box', boxes: 'box', 'per box': 'box', bundle: 'box', 'per bundle': 'box',
  carton: 'box', 'per carton': 'box', pack: 'box', 'per pack': 'box',
};

export function canonicaliseUom(raw: string | null): string | null {
  if (!raw) return null;
  const k = raw.trim().toLowerCase().replace(/[.]/g, '').replace(/\s+/g, ' ');
  if (UOM_ALIASES[k]) return UOM_ALIASES[k];

  // Vendors write the basis as a suffix as often as a phrase: "77/kg" arrives
  // as "/kg", and refusing that as unrecognised held a perfectly clear line out
  // of the comparison.
  const stripped = k.replace(/^per\s+/, '').replace(/^\/\s*/, '').trim();
  if (UOM_ALIASES[stripped]) return UOM_ALIASES[stripped];
  // "per 100 pieces" style with an explicit multiple
  const m = stripped.match(/^(\d+)\s*(pc|pcs|piece|pieces)$/);
  if (m && m[1] === '100') return '100_pieces';
  return null;
}

export function convertUom(
  price: number | null,
  fromRaw: string | null,
  toCanonical: string,
  factors: UomFactor[] = UOM_FACTORS,
): ConversionResult {
  if (price === null) {
    return { value: null, note: 'No price value to convert.', review: null };
  }
  const from = canonicaliseUom(fromRaw);

  if (from === null) {
    return {
      value: null,
      note: fromRaw
        ? `Basis "${fromRaw}" is not in the declared factor table.`
        : 'The document states no unit of measure for this line.',
      review: {
        kind: 'uom_not_convertible',
        detail: fromRaw
          ? `Vendor quoted "${fromRaw}"; the RFx line is priced per ${toCanonical}. No declared conversion factor exists. Confirm the basis with the vendor.`
          : `No unit of measure stated; the RFx line is priced per ${toCanonical}.`,
      },
    };
  }

  if (from === 'box') {
    return {
      value: null,
      note: `Vendor quoted "${fromRaw}". Box contents are not stated, so this cannot be converted to a per-${toCanonical} price.`,
      review: {
        kind: 'uom_not_convertible',
        detail: `Vendor quoted "${fromRaw}" but never states how many ${toCanonical}s are in a box. Ask the vendor for the pack quantity, or enter it here.`,
      },
    };
  }

  if (from === toCanonical) {
    return { value: price, note: `Already priced per ${toCanonical}.`, review: null };
  }

  const f = factors.find((x) => x.from === from && x.to === toCanonical);
  if (!f) {
    return {
      value: null,
      note: `No declared factor from ${from} to ${toCanonical}.`,
      review: {
        kind: 'uom_not_convertible',
        detail: `Vendor quoted per ${from}; the RFx line is priced per ${toCanonical}. No declared conversion factor exists.`,
      },
    };
  }

  return {
    value: roundInternal(price * f.factor),
    note: `converted from ${showExact(price)} per ${from} (${f.note})`,
    review: null,
  };
}

/**
 * Sanity band. Catches both a successful prompt injection that changed a number
 * and an ordinary extraction slip — a price two orders of magnitude away from
 * every other quote for the same line is not a price, it is a bug.
 */
export function priceBandCheck(
  value: number,
  peers: number[],
): { ok: boolean; detail: string } {
  if (peers.length < 2) return { ok: true, detail: '' };
  const sorted = [...peers].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  if (median <= 0) return { ok: true, detail: '' };
  const ratio = value / median;
  if (ratio > 5 || ratio < 0.2) {
    return {
      ok: false,
      detail: `Normalised price ${value.toFixed(2)} is ${ratio.toFixed(1)}x the median of ${median.toFixed(2)} across the other quotes for this line.`,
    };
  }
  return { ok: true, detail: '' };
}

/**
 * Converted unit prices are NOT rounded to paise.
 *
 * A USD 0.291 unit rate at 83.50 is ₹24.2985, and rounding that to ₹24.30
 * before multiplying by an annual quantity of 120,000 moves the line total by
 * ₹180 — then does it again on the next twenty-nine lines. Rounding belongs at
 * the display layer, not in the middle of the arithmetic. Six decimal places
 * is enough to hold the exact value and to absorb binary-float noise.
 */
function roundInternal(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/** Shows the original value at its own precision, without inventing digits. */
function showExact(n: number): string {
  return String(Math.round(n * 1e6) / 1e6);
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function formatMoney(n: number, ccy = 'INR'): string {
  const sym = { INR: '₹', USD: '$', EUR: '€', GBP: '£', SGD: 'S$' }[ccy] ?? '';
  return `${sym}${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
