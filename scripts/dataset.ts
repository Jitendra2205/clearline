/**
 * The demo dataset — single source of truth.
 *
 * IMPORTANT: the vendor documents in data/fixtures are GENERATED from the
 * ground truth below. They cannot drift apart, which means the eval harness is
 * scoring extraction against numbers that provably appear in the source files.
 */

import type { CanonicalUom, LineSpec } from '../src/lib/types';

export interface SeedLine {
  code: string;
  description: string;
  spec: LineSpec;
  uom: CanonicalUom;
  annualQty: number;
  basePrice: number;
}

const rsc = (
  ply: number,
  gsm: number,
  grade: string,
  l: number,
  w: number,
  h: number,
  print: string | null = null,
  notes: string | null = null,
): LineSpec => ({
  productType: 'rsc',
  ply,
  gsm,
  boardGrade: grade,
  lengthMm: l,
  widthMm: w,
  heightMm: h,
  print,
  notes,
});

const spec = (
  productType: string,
  ply: number | null,
  gsm: number | null,
  grade: string | null,
  l: number | null,
  w: number | null,
  h: number | null,
  notes: string | null = null,
): LineSpec => ({
  productType,
  ply,
  gsm,
  boardGrade: grade,
  lengthMm: l,
  widthMm: w,
  heightMm: h,
  print: null,
  notes,
});

export const RFX_LINES: SeedLine[] = [
  { code: 'CP-001', description: 'RSC shipper, 3-ply, 305 x 229 x 152 mm, 120 GSM virgin kraft, plain', spec: rsc(3, 120, 'virgin kraft', 305, 229, 152), uom: 'piece', annualQty: 240000, basePrice: 14.2 },
  { code: 'CP-002', description: 'RSC shipper, 3-ply, 400 x 300 x 200 mm, 140 GSM kraft, plain', spec: rsc(3, 140, 'kraft', 400, 300, 200), uom: 'piece', annualQty: 180000, basePrice: 21.8 },
  { code: 'CP-003', description: 'RSC shipper, 3-ply, 450 x 300 x 200 mm, 140 GSM kraft, plain', spec: rsc(3, 140, 'kraft', 450, 300, 200), uom: 'piece', annualQty: 150000, basePrice: 24.6 },
  { code: 'CP-004', description: 'RSC shipper, 5-ply, 450 x 300 x 200 mm, 150 GSM semi-kraft', spec: rsc(5, 150, 'semi-kraft', 450, 300, 200), uom: 'piece', annualQty: 120000, basePrice: 38.4 },
  { code: 'CP-005', description: 'RSC shipper, 5-ply, 500 x 400 x 300 mm, 150 GSM semi-kraft', spec: rsc(5, 150, 'semi-kraft', 500, 400, 300), uom: 'piece', annualQty: 96000, basePrice: 52.9 },
  { code: 'CP-006', description: 'RSC shipper, 5-ply, 600 x 400 x 400 mm, 180 GSM kraft', spec: rsc(5, 180, 'kraft', 600, 400, 400), uom: 'piece', annualQty: 72000, basePrice: 68.5 },
  { code: 'CP-007', description: 'RSC heavy duty shipper, 7-ply, 800 x 600 x 600 mm, 180 GSM kraft', spec: rsc(7, 180, 'kraft', 800, 600, 600), uom: 'piece', annualQty: 24000, basePrice: 142.0 },
  { code: 'CP-008', description: 'Die-cut mailer box, 3-ply, 250 x 180 x 60 mm, 120 GSM', spec: spec('die_cut_mailer', 3, 120, 'kraft', 250, 180, 60), uom: 'piece', annualQty: 300000, basePrice: 9.75 },
  { code: 'CP-009', description: 'Die-cut mailer box, 3-ply, 320 x 240 x 80 mm, 120 GSM', spec: spec('die_cut_mailer', 3, 120, 'kraft', 320, 240, 80), uom: 'piece', annualQty: 200000, basePrice: 13.4 },
  { code: 'CP-010', description: 'Die-cut tray, 5-ply, 400 x 300 x 100 mm, 150 GSM', spec: spec('die_cut_tray', 5, 150, 'semi-kraft', 400, 300, 100), uom: 'piece', annualQty: 80000, basePrice: 26.3 },
  { code: 'CP-011', description: 'Telescopic two-piece box, 5-ply, 900 x 300 x 300 mm', spec: spec('telescopic', 5, 150, 'semi-kraft', 900, 300, 300), uom: 'piece', annualQty: 36000, basePrice: 74.2 },
  { code: 'CP-012', description: 'Corrugated partition set, 3-ply, 6-cell, to suit CP-004', spec: spec('partition', 3, 120, 'kraft', 450, 300, 200, '6-cell divider set'), uom: 'set', annualQty: 120000, basePrice: 11.6 },
  { code: 'CP-013', description: 'Corrugated partition set, 3-ply, 12-cell, to suit CP-005', spec: spec('partition', 3, 120, 'kraft', 500, 400, 300, '12-cell divider set'), uom: 'set', annualQty: 60000, basePrice: 18.9 },
  { code: 'CP-014', description: 'Corrugated sheet, 3-ply, 1200 x 800 mm, 140 GSM', spec: spec('sheet', 3, 140, 'kraft', 1200, 800, null), uom: 'piece', annualQty: 90000, basePrice: 17.25 },
  { code: 'CP-015', description: 'Corrugated sheet, 5-ply, 1200 x 800 mm, 150 GSM', spec: spec('sheet', 5, 150, 'semi-kraft', 1200, 800, null), uom: 'piece', annualQty: 60000, basePrice: 28.7 },
  { code: 'CP-016', description: 'Corrugated roll, 2-ply, 1000 mm width, 120 GSM', spec: spec('roll', 2, 120, 'kraft', null, 1000, null), uom: 'kg', annualQty: 48000, basePrice: 46.5 },
  { code: 'CP-017', description: 'Corrugated roll, 2-ply, 1200 mm width, 120 GSM', spec: spec('roll', 2, 120, 'kraft', null, 1200, null), uom: 'kg', annualQty: 36000, basePrice: 45.8 },
  { code: 'CP-018', description: 'Layer pad, 3-ply, 1150 x 950 mm, 140 GSM', spec: spec('layer_pad', 3, 140, 'kraft', 1150, 950, null), uom: 'piece', annualQty: 110000, basePrice: 19.4 },
  { code: 'CP-019', description: 'Edge protector, L-profile 50 x 50 x 3 mm, 2000 mm length', spec: spec('edge_protector', null, null, 'laminated board', 2000, 50, 50), uom: 'piece', annualQty: 140000, basePrice: 22.1 },
  { code: 'CP-020', description: 'Angle board, 60 x 60 x 5 mm, 1800 mm length', spec: spec('angle_board', null, null, 'laminated board', 1800, 60, 60), uom: 'piece', annualQty: 70000, basePrice: 27.6 },
  { code: 'CP-021', description: 'RSC shipper, 5-ply, 355 x 355 x 355 mm, 2-colour flexo print', spec: rsc(5, 150, 'semi-kraft', 355, 355, 355, '2-colour flexo'), uom: 'piece', annualQty: 84000, basePrice: 44.8 },
  { code: 'CP-022', description: 'RSC shipper, 3-ply, 380 x 280 x 180 mm, 1-colour flexo print', spec: rsc(3, 140, 'kraft', 380, 280, 180, '1-colour flexo'), uom: 'piece', annualQty: 130000, basePrice: 23.15 },
  { code: 'CP-023', description: 'Export shipper, 7-ply, 1140 x 760 x 760 mm, ISPM-15 compliant pallet fit', spec: spec('export_box', 7, 180, 'kraft', 1140, 760, 760, 'ISPM-15 compliant'), uom: 'piece', annualQty: 12000, basePrice: 268.0 },
  { code: 'CP-024', description: 'Ventilated produce box, 5-ply, 400 x 300 x 140 mm, wax-free', spec: spec('ventilated_box', 5, 150, 'semi-kraft', 400, 300, 140, 'ventilation slots'), uom: 'piece', annualQty: 160000, basePrice: 31.2 },
  { code: 'CP-025', description: 'Folding carton, 3-ply, 300 x 300 x 40 mm, food-grade liner', spec: spec('folding_carton', 3, 120, 'food-grade kraft', 300, 300, 40), uom: 'piece', annualQty: 220000, basePrice: 15.9 },
  { code: 'CP-026', description: 'Corrugated pallet cap, 3-ply, 1200 x 1000 mm', spec: spec('pallet_cap', 3, 140, 'kraft', 1200, 1000, null), uom: 'piece', annualQty: 55000, basePrice: 24.8 },
  { code: 'CP-027', description: 'Stackable bin box, 5-ply, 600 x 400 x 220 mm', spec: spec('bin_box', 5, 150, 'semi-kraft', 600, 400, 220), uom: 'piece', annualQty: 65000, basePrice: 41.6 },
  { code: 'CP-028', description: 'Book wrap mailer, 3-ply, 330 x 250 x 80 mm', spec: spec('book_wrap', 3, 120, 'kraft', 330, 250, 80), uom: 'piece', annualQty: 175000, basePrice: 12.85 },
  { code: 'CP-029', description: 'Custom die-cut insert, 3-ply, per drawing DWG-2291', spec: spec('die_cut_insert', 3, 120, 'kraft', null, null, null, 'per drawing DWG-2291'), uom: 'piece', annualQty: 95000, basePrice: 16.7 },
  { code: 'CP-030', description: 'Separator sheet, 2-ply, 590 x 390 mm', spec: spec('separator', 2, 120, 'kraft', 590, 390, null), uom: '100_pieces', annualQty: 4200, basePrice: 340.0 },
];

export const QUESTIONS = [
  { qNo: 1, question: 'Are you ISO 9001:2015 certified? State certificate number and expiry.', answerType: 'boolean' as const, gate: { requires: 'yes' } },
  { qNo: 2, question: 'Do you hold FSC or PEFC chain-of-custody certification?', answerType: 'boolean' as const, gate: null },
  { qNo: 3, question: 'Do you supply burst-strength / ECT test reports with every production lot?', answerType: 'boolean' as const, gate: { requires: 'yes' } },
  { qNo: 4, question: 'What is your standard lead time for repeat orders, in days?', answerType: 'number' as const, gate: null },
  { qNo: 5, question: 'What is your maximum monthly production capacity, in pieces?', answerType: 'number' as const, gate: null },
  { qNo: 6, question: 'Do you offer vendor-managed inventory at the buyer plant?', answerType: 'boolean' as const, gate: null },
  { qNo: 7, question: 'Do you hold food-grade (BRCGS Packaging or equivalent) certification?', answerType: 'boolean' as const, gate: null },
  { qNo: 8, question: 'What payment terms do you offer?', answerType: 'text' as const, gate: null },
];

export interface SeedVendor {
  key: string;
  name: string;
  country: string;
  email: string;
  currencyHint: string | null;
  format: 'xlsx' | 'pdf' | 'docx' | 'photo' | 'email';
}

export const VENDORS: SeedVendor[] = [
  { key: 'sristi', name: 'Sristi Packaging Pvt Ltd', country: 'IN', email: 'exports@sristipack.co.in', currencyHint: 'INR', format: 'xlsx' },
  { key: 'nova', name: 'Nova Corrugators Ltd', country: 'IN', email: 'sales@novacorrugators.com', currencyHint: 'INR', format: 'pdf' },
  { key: 'kraftline', name: 'Kraftline Industries', country: 'IN', email: 'bids@kraftline.in', currencyHint: 'INR', format: 'docx' },
  { key: 'shakti', name: 'Shakti Board Works', country: 'IN', email: 'shaktiboard@gmail.com', currencyHint: null, format: 'photo' },
  { key: 'pacific', name: 'Pacific Pack Solutions Pte Ltd', country: 'SG', email: 'quotes@pacificpack.com.sg', currencyHint: 'USD', format: 'email' },
];

/** Deterministic jitter so "cheapest per line" genuinely splits across vendors. */
function jitter(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000; // 0..0.999
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export const USD_INR = 83.5;

/** Per-vendor price for an RFx line, in that vendor's own currency and UoM. */
export function vendorPrice(vendorKey: string, line: SeedLine): number {
  const factor: Record<string, number> = {
    sristi: 0.98,
    nova: 1.06,
    kraftline: 1.02,
    shakti: 0.91,
    pacific: 0.94,
  };
  const spread = 0.14; // +/-7% around the vendor's own level
  const base = line.basePrice * factor[vendorKey];
  const adj = base * (1 + (jitter(vendorKey + line.code) - 0.5) * spread);
  return round2(adj);
}

/** Lines each vendor chose not to quote — the coverage story. */
export const NOT_QUOTED: Record<string, string[]> = {
  sristi: [],
  // Nova declined the three lowest-margin lines.
  nova: ['CP-019', 'CP-020', 'CP-030'],
  kraftline: [],
  // Shakti sent a photo of a rate card that only covers their standard range.
  shakti: [
    'CP-007', 'CP-010', 'CP-011', 'CP-012', 'CP-013', 'CP-016', 'CP-017',
    'CP-019', 'CP-020', 'CP-021', 'CP-023', 'CP-026', 'CP-029', 'CP-030',
  ],
  // Pacific replied by email with a handful of headline prices only.
  pacific: [
    'CP-007', 'CP-010', 'CP-011', 'CP-012', 'CP-013', 'CP-014', 'CP-015',
    'CP-016', 'CP-017', 'CP-018', 'CP-019', 'CP-020', 'CP-021', 'CP-023',
    'CP-024', 'CP-025', 'CP-026', 'CP-027', 'CP-028', 'CP-029', 'CP-030',
  ],
};

/**
 * Deliberate unit-of-measure divergences. This is where the interesting
 * failure modes live — some are convertible with a declared factor, and some
 * are genuinely not convertible and MUST land in the review queue.
 */
export const UOM_OVERRIDE: Record<string, Record<string, { uom: string; multiplier: number; convertible: boolean }>> = {
  sristi: {
    // Quotes rolls per metric tonne. Deterministic 1000x factor.
    'CP-016': { uom: 'per MT', multiplier: 1000, convertible: true },
    'CP-017': { uom: 'per MT', multiplier: 1000, convertible: true },
    // "per box" where the box is an unstated bundle size. NOT convertible.
    'CP-008': { uom: 'per box', multiplier: 50, convertible: false },
  },
  kraftline: {
    // Quotes the separator per single piece; RFx canonical is per 100 pieces.
    'CP-030': { uom: 'per piece', multiplier: 0.01, convertible: true },
  },
  nova: {},
  shakti: {},
  pacific: {},
};

export interface GtLine {
  rfxCode: string;
  /** Exactly the description string that appears in the vendor document. */
  vendorDescription: string;
  /** Exactly the price string that appears in the vendor document. */
  rawPrice: string;
  /** Numeric value of rawPrice. */
  price: number;
  /** UoM string as written in the vendor document. */
  rawUom: string;
  /** Price in the RFx canonical UoM and base currency (INR). null when the
   *  system is EXPECTED to refuse to normalise it. */
  expectedNormalizedInr: number | null;
  expectedReview: string | null;
}

export interface GtQuote {
  vendorKey: string;
  vendorName: string;
  format: string;
  filename: string;
  currency: string | null;
  incoterm: string | null;
  validity: string | null;
  paymentTerms: string | null;
  lines: GtLine[];
  notQuoted: string[];
  answers: { qNo: number; answer: string }[];
  commercialNotes: { kind: string; text: string; percent: number | null }[];
  /** Lines the extractor is not expected to read at all (illegible in photo). */
  expectedIllegible: string[];
}

/** Vendor-specific ways of describing the same physical thing. */
function describe(vendorKey: string, line: SeedLine): string {
  const s = line.spec;
  const dims = [s.lengthMm, s.widthMm, s.heightMm].filter((d) => d !== null);
  switch (vendorKey) {
    case 'sristi': {
      // Uses centimetres and its own product codes.
      const cm = dims.map((d) => (d as number) / 10).join(' x ');
      const ply = s.ply ? `${s.ply}ply ` : '';
      return `${ply}${sristiType(s.productType)} ${cm} cm${s.gsm ? ` ${s.gsm}gsm` : ''}`;
    }
    case 'nova': {
      const ply = s.ply ? `${s.ply} Ply ` : '';
      return `${ply}${novaType(s.productType)} — ${dims.join('x')} mm${s.print ? `, ${s.print}` : ''}`;
    }
    case 'kraftline': {
      const ply = s.ply ? `${ordinal(s.ply)} ply ` : '';
      return `${ply}${kraftType(s.productType)}, size ${dims.join(' × ')} millimetre`;
    }
    case 'shakti': {
      const inch = dims.map((d) => ((d as number) / 25.4).toFixed(1)).join('x');
      return `${s.ply ?? ''}P ${shaktiType(s.productType)} ${inch}"`;
    }
    case 'pacific': {
      const ply = s.ply ? `${s.ply}-ply ` : '';
      return `${ply}${novaType(s.productType)} ${dims.join('x')}`;
    }
    default:
      return line.description;
  }
}

const ordinalWords = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven'];
function ordinal(n: number): string {
  return ordinalWords[n] ?? String(n);
}

function sristiType(t: string): string {
  const m: Record<string, string> = {
    rsc: 'RSC CARTON', die_cut_mailer: 'DIECUT MAILER', die_cut_tray: 'DIECUT TRAY',
    telescopic: 'TELESCOPIC BOX', partition: 'PARTITION SET', sheet: 'CORR SHEET',
    roll: 'CORR ROLL', layer_pad: 'LAYER PAD', edge_protector: 'EDGE PROTECTOR',
    angle_board: 'ANGLE BOARD', export_box: 'EXPORT CARTON', ventilated_box: 'VENTED CARTON',
    folding_carton: 'FOLDING CARTON', pallet_cap: 'PALLET CAP', bin_box: 'BIN BOX',
    book_wrap: 'BOOK WRAP', die_cut_insert: 'DIECUT INSERT', separator: 'SEPARATOR SHEET',
  };
  return m[t] ?? t.toUpperCase();
}
function novaType(t: string): string {
  const m: Record<string, string> = {
    rsc: 'Regular Slotted Container', die_cut_mailer: 'Die Cut Mailer', die_cut_tray: 'Die Cut Tray',
    telescopic: 'Telescopic Container', partition: 'Partition / Divider', sheet: 'Corrugated Sheet',
    roll: 'Corrugated Roll', layer_pad: 'Layer Pad', edge_protector: 'Edge Protector',
    angle_board: 'Angle Board', export_box: 'Export Container', ventilated_box: 'Ventilated Container',
    folding_carton: 'Folding Carton', pallet_cap: 'Pallet Cap', bin_box: 'Bin Box',
    book_wrap: 'Book Wrap Mailer', die_cut_insert: 'Die Cut Insert', separator: 'Separator Sheet',
  };
  return m[t] ?? t;
}
function kraftType(t: string): string {
  const m: Record<string, string> = {
    rsc: 'regular slotted carton', die_cut_mailer: 'die-cut mailer carton', die_cut_tray: 'die-cut tray',
    telescopic: 'two-piece telescopic carton', partition: 'divider set', sheet: 'flat corrugated sheet',
    roll: 'corrugated roll stock', layer_pad: 'layer pad', edge_protector: 'edge protection profile',
    angle_board: 'angle board profile', export_box: 'export grade carton', ventilated_box: 'ventilated carton',
    folding_carton: 'folding carton', pallet_cap: 'pallet cap sheet', bin_box: 'stackable bin carton',
    book_wrap: 'book wrap mailer', die_cut_insert: 'die-cut insert', separator: 'separator sheet',
  };
  return m[t] ?? t;
}
function shaktiType(t: string): string {
  const m: Record<string, string> = {
    rsc: 'RSC BOX', die_cut_mailer: 'MAILER', die_cut_tray: 'TRAY', sheet: 'SHEET',
    layer_pad: 'PAD', ventilated_box: 'VENT BOX', folding_carton: 'FOLD CARTON',
    bin_box: 'BIN BOX', book_wrap: 'BOOK WRAP', separator: 'SEP SHEET',
    partition: 'PARTITION', telescopic: 'TELE BOX',
  };
  return m[t] ?? t.toUpperCase();
}

const ANSWERS: Record<string, string[]> = {
  sristi: ['Yes — ISO 9001:2015, cert QMS/IN/22/4471, valid to 14 Mar 2027', 'Yes — FSC Mix, COC-841203', 'Yes, with every lot', '12', '4200000', 'Yes, at Bangalore plant only', 'Yes — BRCGS Packaging AA grade', '45 days from invoice'],
  nova: ['Yes — ISO 9001:2015, cert 01 100 084221, valid to 09 Aug 2026', 'Yes — PEFC/24-31-88', 'Yes, burst and ECT per lot', '10', '5800000', 'Yes', 'No', '30 days from invoice, 3% if settled in 15 days'],
  kraftline: ['Yes — ISO 9001:2015, certificate KL-QMS-19883', 'No', 'Yes, ECT reports issued per lot', '15', '3100000', 'No', 'No', '60 days from date of invoice'],
  // Shakti fails the quality gate — no ISO, no per-lot test reports.
  shakti: ['No', 'No', 'No — on request only, at extra cost', '7', '900000', 'No', 'No', 'Advance 50%, balance on delivery'],
  pacific: ['Yes — ISO 9001:2015, cert SG-QM-70412', 'Yes — FSC 100%', 'Yes', '21', '2600000', 'No', 'Yes — BRCGS Packaging A grade', 'Letter of credit at sight'],
};

const COMMERCIAL_NOTES: Record<string, { kind: string; text: string; percent: number | null }[]> = {
  sristi: [
    { kind: 'discount', text: 'Volume rebate of 2% on any line where annual offtake exceeds 200,000 pieces.', percent: 2 },
    { kind: 'condition', text: 'Prices firm for 90 days from date of offer. GST extra at applicable rate.', percent: null },
  ],
  nova: [
    // The footnote discount the brief calls out.
    { kind: 'discount', text: 'A settlement discount of 3% applies to all lines if payment is received within 15 days of invoice.', percent: 3 },
    { kind: 'discount', text: 'An additional 2.5% rebate applies to lines 1 to 10 where annual volume exceeds 200,000 units.', percent: 2.5 },
    { kind: 'condition', text: 'All prices ex-works Hosur. Freight to buyer plant charged at actuals.', percent: null },
  ],
  kraftline: [
    { kind: 'condition', text: 'Prices are inclusive of delivery to Bangalore plant but exclude GST.', percent: null },
    { kind: 'surcharge', text: 'A tooling charge of Rs 48,000 one-time applies to the custom die-cut insert.', percent: null },
  ],
  shakti: [
    { kind: 'condition', text: 'Rates valid for 30 days. Transport extra.', percent: null },
  ],
  pacific: [
    { kind: 'condition', text: 'Prices are FOB Singapore. Freight and duty to buyer account.', percent: null },
    { kind: 'condition', text: 'Balance of the schedule quoted at last year rates, subject to reconfirmation.', percent: null },
  ],
};

/** Lines Shakti's photo shows but which are too blurred to read confidently. */
const SHAKTI_ILLEGIBLE = ['CP-018', 'CP-022'];

export function buildGroundTruth(): GtQuote[] {
  const byCode = new Map(RFX_LINES.map((l) => [l.code, l]));

  return VENDORS.map((v) => {
    const skip = new Set(NOT_QUOTED[v.key]);
    const overrides = UOM_OVERRIDE[v.key] ?? {};
    const isUsd = v.key === 'pacific';

    const lines: GtLine[] = RFX_LINES.filter((l) => !skip.has(l.code)).map((l) => {
      const inrCanonical = vendorPrice(v.key, l);
      const ov = overrides[l.code];
      let price = inrCanonical;
      let rawUom = defaultUomLabel(v.key, l.uom);
      let expectedNormalized: number | null = inrCanonical;
      let expectedReview: string | null = null;

      if (ov) {
        price = round2(inrCanonical * ov.multiplier);
        rawUom = ov.uom;
        if (!ov.convertible) {
          expectedNormalized = null;
          expectedReview = 'uom_not_convertible';
        }
      }

      if (isUsd) {
        price = round2(inrCanonical / USD_INR);
        expectedNormalized = round2(price * USD_INR);
      }

      const rawPrice = isUsd ? `USD ${price.toFixed(2)}` : formatInr(v.key, price);

      return {
        rfxCode: l.code,
        vendorDescription: describe(v.key, byCode.get(l.code)!),
        rawPrice,
        price,
        rawUom,
        expectedNormalizedInr: expectedNormalized,
        expectedReview,
      };
    });

    return {
      vendorKey: v.key,
      vendorName: v.name,
      format: v.format,
      filename: fixtureName(v),
      currency: v.key === 'shakti' ? null : isUsd ? 'USD' : 'INR',
      incoterm: incotermFor(v.key),
      validity: validityFor(v.key),
      paymentTerms: ANSWERS[v.key][7],
      lines,
      notQuoted: NOT_QUOTED[v.key],
      answers: QUESTIONS.map((q) => ({ qNo: q.qNo, answer: ANSWERS[v.key][q.qNo - 1] })),
      commercialNotes: COMMERCIAL_NOTES[v.key],
      expectedIllegible: v.key === 'shakti' ? SHAKTI_ILLEGIBLE : [],
    };
  });
}

function defaultUomLabel(vendorKey: string, uom: CanonicalUom): string {
  const map: Record<string, Record<string, string>> = {
    sristi: { piece: 'per pc', set: 'per set', kg: 'per kg', '100_pieces': 'per 100 pcs' },
    nova: { piece: 'Per Piece', set: 'Per Set', kg: 'Per Kg', '100_pieces': 'Per 100 Pieces' },
    kraftline: { piece: 'each', set: 'per set', kg: 'per kilogram', '100_pieces': 'per hundred' },
    shakti: { piece: 'PC', set: 'SET', kg: 'KG', '100_pieces': '100PC' },
    pacific: { piece: 'per pc', set: 'per set', kg: 'per kg', '100_pieces': 'per 100' },
  };
  return map[vendorKey]?.[uom] ?? 'per piece';
}

function formatInr(vendorKey: string, n: number): string {
  if (vendorKey === 'nova') return `Rs. ${n.toFixed(2)}`;
  if (vendorKey === 'shakti') return n.toFixed(2);
  if (vendorKey === 'kraftline') return `Rs ${n.toFixed(2)}`;
  return n.toFixed(2);
}

function incotermFor(k: string): string | null {
  return { sristi: 'Ex-works Hosur', nova: 'Ex-works Hosur', kraftline: 'DDP Bangalore plant', shakti: null, pacific: 'FOB Singapore' }[k] ?? null;
}
function validityFor(k: string): string | null {
  return { sristi: '90 days from date of offer', nova: '60 days', kraftline: '45 days', shakti: '30 days', pacific: null }[k] ?? null;
}

export function fixtureName(v: SeedVendor): string {
  const base = v.key;
  switch (v.format) {
    case 'xlsx': return `${base}-quotation.xlsx`;
    case 'pdf': return `${base}-quotation.pdf`;
    case 'docx': return `${base}-offer.docx`;
    case 'photo': return `${base}-rate-card.jpg`;
    case 'email': return `${base}-reply.eml`;
  }
}

export const RFX_META = {
  title: 'FY26 Corrugated Packaging — Bangalore & Pune Plants',
  category: 'Corrugated packaging',
  baseCurrency: 'INR',
  deliveryLocation: 'Bangalore (Plant 1) and Pune (Plant 3), India',
  incoterm: 'DDP buyer plant preferred; ex-works acceptable with freight stated separately',
  paymentTerms: 'Net 45 days from date of invoice',
  closesAt: '2026-09-12',
};
