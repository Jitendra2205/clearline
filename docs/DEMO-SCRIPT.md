# Demo script — the recorded walkthrough

Target length **8–10 minutes**. The brief asks specifically for a recording of
the *analyst conversation*, so budget half the time for section 4.

Before you record:

```bash
npm run fixtures && npm run seed -- --reset && npm run dev
```

Leave extraction **un-run**. Reading the documents live is the demo.

---

## 1 · The problem, on screen (60s)

Open `/rfx/rfx_fy26_corrugated`. Five vendors, five formats.

Click through to the actual documents — they open through short-lived signed
links, so say that in passing. Show the Shakti photo in particular: it is a real
angled phone photo of a printed rate card, two rows are genuinely blurred, and
**it never states a currency anywhere.**

> "Thirty line items, five vendors, and not one of them used our template. This
> is the week a category buyer loses."

## 2 · Extraction, live (90s)

Press **Extract 5 documents**. While it runs, say what is being constrained:

- one document, one strict schema, `null` when a value is absent
- a mandatory verbatim `source_ref` on every field
- the extractor has no field for a rank, a score or a recommendation

When it finishes, read the per-document line out loud — lines found, lines held,
review items raised, tokens.

## 3 · The trust layer (3 min)

**Comparison grid.** Point at:

- coverage badges — Nova quoted 27 of 30, and the three gaps say **"Not quoted"**, not zero
- the tier badge on every cell — most of the grid is `fuzzy`, meaning deterministic scoring with no model involved, and the score is shown
- Pacific's cells: `₹38.40` with `from USD 0.46 per pc` underneath. A converted number never appears without its original.
- Shakti's column: **held**, because the rate card states no currency and we refuse to assume one.

**Click a cell.** The drawer shows the source document, the page, and the
verbatim text the number came from, plus the conversion in plain words.

**Review queue.** Three kinds worth showing:

1. Sristi quoted the die-cut mailer **per box** and never said how many are in a box. We refuse to convert. Supply a factor with a note — it goes into the audit trail.
2. Shakti's rate card has no currency. Set it to INR and watch the whole quote re-normalise and 14 lines rejoin the comparison in one action.
3. A blurred row the extractor marked `low` confidence. It is blocked despite matching cleanly, because a confident wrong number is the failure we are designing against.

> "The system is 85% sure about some of this, and it knows which 15%. That is
> worth more than being 95% right and confident about everything."

## 4 · The analyst conversation (4 min)

This is the part they asked to see. Go to **Ask**.

**Q1 — the VP's question from the brief.**
> *"What if we split it, cheapest per line, but only among vendors who cleared
> the quality questionnaire?"*

Point out that the model called `cheapest_per_line` with
`only_quality_cleared: true`, that the table below the answer is the actual
query result, and that Shakti was excluded for answering "No" to ISO 9001 — with
the reason shown.

**Q2 — the coverage trap.**
> *"Who is cheapest overall, and is that a like-for-like comparison?"*

The interesting part is the caveat: Pacific has the lowest total but quoted
9 of 30 lines, so a single-supplier award to them is not a thing that exists.
The answer says so.

**Q3 — provenance through the conversation.**
> *"Show me line CP-016 across all vendors and explain how the per-kg price was
> arrived at."*

Sristi quoted per metric tonne. The conversion is stated in words, with the
factor.

**Q4 — the footnote.**
> *"What discounts did any vendor offer, and are they reflected in the prices I
> am seeing?"*

Nova's 3% settlement discount is buried in a PDF footnote. It is recorded, and
it is explicitly **not** applied — applying a conditional discount is a
commercial judgement, not an extraction result.

**Q5 — the one it must refuse.**
> *"What is Shakti Board Works' production capacity in Chennai?"*

Nothing in the dataset answers this. If it invents a number, the demo has
failed. Say that out loud before you press enter.

## 5 · Award and audit (60s)

Two options, both computed over gate-clearing vendors. Note that Kraftline is
the only vendor who quoted the whole schedule, which is what makes a single-
supplier award possible at all.

Record a decision with a rationale. Show that it snapshots the numbers *and* the
count of review items still open at that moment.

Export the provenance CSV — every line with its source document, page, locator
and verbatim snippet.

## 6 · Security (45s)

Open `/security`.

Run the injection fixture through real extraction. The point is not that the
model resisted — it is that **the schema has no field for an award**, so a fully
successful injection has nowhere to land. Ranking is application code.

Then the formula-injection table, which needs no model at all:
`=cmd|' /C calc'!A0` in a vendor description field, neutralised on export.

## 7 · Close (30s)

> "The interesting problem isn't extraction — it's specification. All of this
> mess exists because our line items are written in a spec language no vendor
> shares. The higher-leverage product pushes canonicalisation upstream: a shared
> spec library the RFx is built from, so responses match on a structured ID
> instead of prose. Extraction becomes the fallback for non-compliant vendors.
> That's an organisational problem more than a technical one, which is exactly
> why it's the moat rather than the demo."
