# Demo script — the recorded walkthrough

Target length **8–10 minutes**. The brief asks specifically for a recording of
the *analyst conversation*, so budget half the time for section 4. The questions
below are taken from the supplied `eval_question_set.json`, so what you show on
camera is what the eval grades.

Before you record:

```bash
npm run seed -- --reset && npm run dev
```

Leave extraction **un-run**. Reading the documents live is the demo.

---

## 1 · The problem, on screen (60s)

Open the RFx. **RFQ-2026-PKG-0417**, Nexora Consumer Products, 30 lines, five
vendors, five formats.

Worth saying out loud: the RFx on screen was **parsed from the buyer's own
workbook at seed time**, not typed into the codebase. Click through to the
documents — they open through short-lived signed links.

Show the MetroBoard photo in particular: an angled phone shot of a printed rate
card, 18 of 30 lines legible.

> "Thirty line items, five vendors, and not one of them used our template. This
> is the week a category buyer loses."

## 2 · Extraction, live (90s)

Press **Extract 5 documents**. While it runs, say what is being constrained:

- one document, one strict schema, `null` when a value is absent
- a mandatory verbatim `source_ref` on every field
- the extractor has no field for a rank, a score or a recommendation

Read the per-document line out loud when it lands — lines found, lines held,
review items raised, tokens.

## 3 · The trust layer (3 min)

**Comparison grid.** Point at:

- coverage badges — PackRite and Global Corrugates 30/30, Shakti 27/30,
  MetroBoard 18/30, Nova Pack 4/30. Shakti's three gaps read **"Not quoted"**,
  not zero.
- Nova Pack's column header carries their own words: *"rest same as last year"* —
  and a **no incoterm** badge, because "freight extra" with no delivery basis is
  not a landed-cost comparable price.
- Global Corrugates' cells: `₹24.2985` with `from USD 0.291 @ 83.5` underneath.
  A converted number never appears without its original — and it is not rounded
  to paise, because ₹24.30 × 120,000 is ₹180 wrong on line 1 alone.
- the tier badge on every cell — most of the grid is `fuzzy`, deterministic
  scoring with no model involved, and the score is shown.

**Click a cell.** The drawer shows the source document, the page or sheet cell,
and the verbatim text the number came from, plus the conversion in plain words.

**Review queue.** Worth showing:

1. Shakti quoted the sheet pads **per 100 pieces** against a per-piece schedule.
   ₹610.00 becomes ₹6.10 with the arithmetic shown — and the two prose lines the
   matcher declined to place, because "the 450x300mm 3-ply pad" is genuinely
   ambiguous against a partition line of the same size.
2. The MetroBoard photo's illegible rows, marked `low` confidence and blocked
   despite matching cleanly.

> "The system is sure about most of this and it knows which part it isn't. That
> is worth more than being confident about everything."

## 4 · The analyst conversation (4 min)

This is the part they asked to see. Go to **Ask**. These are graded questions.

**Q-02 — the headline test, and the VP's question from the brief.**
> *"What if we split the award, cheapest per line, but only among vendors who
> cleared the quality questionnaire?"*

The eligible set is PackRite, Global Corrugates and Shakti. Point out **why the
other two are out**: MetroBoard holds ISO 9001 but reports 89.5% on-time
delivery against a 90% floor, and Nova Pack returned no questionnaire at all —
which makes them unassessable, not compliant. Expected basket: **₹4,47,16,859**.

**Q-08 — the coverage trap.**
> *"Give me the total annual spend if we award everything to a single vendor."*

Only PackRite (₹4,63,47,510) and Global Corrugates (₹4,56,06,857) quoted all 30
lines, so only they can be totalled. Shakti, MetroBoard and Nova Pack must come
back labelled with their coverage, never as a comparable total.

**Q-04 — the footnote.**
> *"Does the Global Corrugates offer include any discount?"*

4% settlement discount, footnote 4, conditional on payment within 15 days of
bill of lading — and **not reflected in the tabulated unit rates**. Silently
applying it is a graded failure.

**Q-05 — the unit-of-measure trap.**
> *"Shakti quoted the sheet pads differently — is their price actually
> competitive?"*

₹610.00 per 100 → ₹6.10 per piece, against PackRite ₹6.20 and Global Corrugates
₹6.012. Comparing 610.00 to 6.20 unconverted is a graded failure.

**Q-07 — the one it must refuse.**
> *"What is Nova Pack's price for line 5?"*

Not quoted. Their email covers four lines. Any number here is an automatic fail.
Say that out loud before you press enter.

**Q-06 — the other refusal.**
> *"Can we award the whole basket to Nova Pack?"*

No: 26 of 30 lines are unpriced, "same as last year" refers to a price list that
is not in this dataset, and they stated freight extra with no incoterm.

## 5 · Award and audit (60s)

Two options, both over gate-clearing vendors. Note that only PackRite and Global
Corrugates quoted the whole schedule, which is what makes a single-supplier
award possible at all.

Record a decision with a rationale. It snapshots the numbers **and** the count
of review items still open at that moment.

Export the provenance CSV — every line with its source document, page, locator
and verbatim snippet.

## 6 · Security (45s)

Open `/security`.

Run the Apex injection fixture through real extraction. Its instruction is set
in **white 1pt text** between two ordinary price lines — invisible in Word,
fully visible to anything reading the document. The point is not that the model
resisted: **the schema has no field for an award**, so a fully successful
injection has nowhere to land. Ranking is application code, and Apex never
appears in it.

Then the formula-injection table, which needs no model at all:
`=cmd|' /C calc'!A0` in a vendor description field, neutralised on export.

## 7 · Close (30s)

> "The interesting problem isn't extraction — it's specification. All of this
> mess exists because the buyer's line items are written in a spec language no
> vendor shares. The higher-leverage product pushes canonicalisation upstream: a
> shared spec library the RFx is built from, so responses match on a structured
> ID instead of prose. Extraction becomes the fallback for non-compliant
> vendors. That's an organisational problem more than a technical one, which is
> exactly why it's the moat rather than the demo."
