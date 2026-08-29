# Clearline

**Kill the Quote Spreadsheet** — an RFx-to-award system for corrugated packaging
procurement.

A buyer talks an RFx into existence with an AI co-pilot. It goes out to five
vendors. They reply in whatever shape they like — a spreadsheet that ignores the
template, a letterhead PDF with the discount in a footnote, a Word doc where the
commercials are in a paragraph, a phone photo of a printed rate card taken at an
angle, and a two-line email quoting in USD. Everything lands in one side-by-side
comparison the buyer can interrogate in plain language, all the way to a
defensible award.

The design rule throughout: **never silently resolve ambiguity. Surface it,
attribute it, make it reversible.**

See [`docs/ONE-PAGER.md`](docs/ONE-PAGER.md) for what was decided and what was
deliberately left out.

---

## The dataset

The demo runs on **RFQ-2026-PKG-0417** — the dataset supplied with the
assignment, in `data/aerchain/`. Nexora Consumer Products, 30 line items,
five vendors, five formats:

| Vendor | Format | The edge it carries | Coverage |
|---|---|---|---|
| PackRite Industries | xlsx | Own codes, own column order, lines reordered | 30/30 |
| Global Corrugates FZE | pdf | **USD pricing**; 4% settlement discount in footnote 4 | 30/30 |
| Shakti Packaging | docx | **Commercials in prose**; sheet pads **per 100 pieces** | 27/30 |
| Metro Board & Pack | jpg | **Angled phone photo** of a printed rate card | 18/30 |
| Nova Pack | txt | **Two-line email**; "rest same as last year, freight extra" | 4/30 |

Plus `adversarial/06_ADVERSARIAL_Apex_injection.docx` — a prompt injection set
in white 1pt text, used as a permanent security regression fixture.

The RFx is **parsed out of the buyer's own workbook at seed time**, not
transcribed into code. This dataset arrived after the system was built and
nothing about it is hardcoded — which is the point of seeding it this way.

The buyer's qualification criterion for this RFx is **ISO 9001 held AND on-time
delivery ≥ 90%**, so the gate needs a numeric threshold as well as a yes/no:
MetroBoard fails at 89.5%, and NovaPack — who returned no questionnaire at all —
cannot be assessed and therefore does not clear it either.

## Run it

```bash
npm install
cp .env.local.example .env.local     # then add your ANTHROPIC_API_KEY
npm run seed                         # parses the buyer RFx, loads the 5 documents
npm run dev                          # http://localhost:3100
```

Then open the RFx and press **Extract 5 documents**, or run it from the CLI:

```bash
npm run extract
```

The AI loops are real. Without `ANTHROPIC_API_KEY` the app runs, the dataset
seeds and every screen renders — but extraction, the drafting co-pilot and the
analyst Q&A will tell you the key is missing rather than returning canned data.

### Everything else

```bash
npm run test:pipeline    # 28 assertions on normalisation, matching and refusals — no model calls
npm run test:match       # deterministic matcher against the supplied vendor descriptions
npm run eval             # scores against the supplied ground truth (run npm run extract first)
npm run eval -- --json   # machine-readable; non-zero exit on any failure
```

`npm run eval` scores against `data/aerchain/eval_question_set.json` and the
eleven expected behaviours in the dataset README — coverage per vendor, the
FX-converted line-1 prices, the per-100-pieces normalisation, the split-award
basket total, the single-vendor totals, the questionnaire gate membership, and
the adversarial cases that must be refused. Its five deterministic assertions
need no model and run before extraction has ever happened.

A second, synthetic dataset is kept for regression (`npm run seed:synthetic`,
`npm run eval:synthetic`, `npm run fixtures`). It is not the demo.

---

## Results

Measured, not asserted. `npm run eval` scores the database after a real
extraction against the supplied ground truth:

```
34/34 checks passed
```

Including the graded ones:

| | Expected | Got |
|---|---|---|
| Split award, cheapest per line among qualified vendors | ₹4,47,16,859 | ₹4,47,16,859 |
| Per-line winner and price, all 30 lines | 30/30 | 30/30 |
| Single-vendor total — PackRite | ₹4,63,47,510 | matches |
| Single-vendor total — Global Corrugates | ₹4,56,06,857 | matches |
| Coverage per vendor | 30 / 30 / 27 / 18 / 4 | 30 / 30 / 27 / 18 / 4 |
| Line 1 across all five vendors, incl. the FX-converted one | exact | exact |
| Shakti sheet pads, per 100 → per piece | 6.10 / 4.72 | 6.10 / 4.72 |

Deterministic matching against the supplied vendor descriptions: **97.1%
coverage at 100% precision**. Pipeline integration tests: **28/28**.

One discrepancy worth flagging: the ground truth excludes MetroBoard for
on-time delivery of 89.5%, but **that figure appears nowhere in the rate-card
photograph supplied** — the card states ISO 9001, the in-house lab, lead time,
payment terms and MOQ, and no delivery percentage. (The dataset README
references a `ground_truth.json` carrying it; that file was not in the set.) So
MetroBoard is excluded as *unassessable* on that question rather than as failing
it. Same outcome, and the only conclusion the supplied evidence supports.

## The three AI loops

| Loop | What it does | How it is constrained |
|---|---|---|
| **1 — Drafting co-pilot** | Plain-language brief → structured RFx | Strict tool schema. Every dimension canonicalised to mm at authoring time. The model must declare, in `assumptions`, everything it invented that the buyer never said. |
| **2 — Extraction** | One document → one filled schema | `null` when a value is absent, never a guess. A mandatory `source_ref` with a verbatim snippet on every field. Zod re-validation on ingest; off-schema output is rejected, not repaired. No field for a rank, score or recommendation. |
| **3 — Analyst Q&A** | Question → query → answer | The model picks one of nine queries. The application computes every number. The model narrates. It does no arithmetic. |

## Models

Two providers behind one interface (`src/lib/ai/provider.ts`). The loops call
`runTool` and `startToolLoop` and never learn which vendor answered.

| | Set | Default model |
|---|---|---|
| Gemini | `GEMINI_API_KEY` | `gemini-3.6-flash` |
| Anthropic | `ANTHROPIC_API_KEY` | `claude-opus-5` |

Whichever key is present is used; `CLEARLINE_PROVIDER` forces one. The numbers
above were produced on Gemini, which handles the PDF and the angled photograph
natively — both are sent as bytes, not pre-converted to text.

**Free-tier Gemini is capped at 20 requests per day per model.** Extracting all
five documents costs five. That is fine for preparing a demo and too tight to
leave a public link running live extraction — which is why the deploy ships a
snapshot of a completed run.

## Normalisation

Three separate problems, each handled explicitly:

- **Currency** — an explicit FX table with rate, source and as-of date. A converted value always displays next to its original: `₹38.40 (from USD 0.46 @ 83.5)`. A quote with no stated currency is not assumed to be INR.
- **Unit of measure** — a declared factor table. `per MT → per kg` converts and says why. `per box`, where the box size is never stated, does **not** convert; it goes to the review queue.
- **Line matching** — three tiers, visually distinguished in the grid: exact (the vendor cited our line code) · fuzzy (deterministic attribute scoring, score shown) · semantic (a model proposal, always requiring human confirmation).

## Layout

```
src/lib/ai/               the three loops, their prompts and their schemas
src/lib/normalize/        matching, currency, unit of measure, the pipeline
src/lib/query/            the analyst query engine — every number is computed here
src/lib/security/         file sniffing, CSV sanitisation, signed URLs, the auth gate
src/lib/db/               libSQL client and schema
data/aerchain/            the supplied dataset and its eval question set
scripts/seed-aerchain.ts  parses the buyer workbook and loads the documents
scripts/eval-aerchain.ts  scores against the supplied ground truth
scripts/                  extraction runner, pipeline tests, matcher tests
```

One detail worth knowing: the product vocabulary that classifies a line as an
`rsc`, a `sheet` or a `layer_pad` lives in **one** place
(`classifyProductType` in `src/lib/normalize/match.ts`) and is used both when
seeding the buyer's lines and when matching vendor lines. Two copies of that map
was the original design; they drifted within a day, and every line of the
affected product types silently stopped matching with no error anywhere.

## Deploy

Single container. No external database.

### Render (free plan)

1. **Run extraction, then snapshot it.** Render's free plan has no persistent
   disk, so a cold container would otherwise serve an empty comparison grid.

   ```bash
   npm run extract && npm run snapshot
   ```

   That writes `data/snapshot/clearline-seed.db` — a real extraction run, which
   is committed and restored on every cold start. Anyone can still re-run
   extraction live from the UI.

2. **Push to GitHub**, then in Render: **New → Blueprint** and pick the repo.
   It reads [`render.yaml`](render.yaml).

3. **Set two secrets in the dashboard** (never commit them):
   `ANTHROPIC_API_KEY` and `CLEARLINE_PASSWORD`. The password gates every route
   — the URL is public and vendor pricing is commercially sensitive.
   `CLEARLINE_SIGNING_KEY` is generated by Render.

What the free plan costs you: the container sleeps after ~15 minutes idle and
the filesystem resets on wake, so any extraction or review resolution done
*through the hosted app* is lost on the next cold start. The snapshot always
comes back. For a link a reviewer clicks through, that is the right trade;
for a real run it is not.

To make it durable, add a free [Turso](https://turso.tech) database and set
`LIBSQL_URL` (a `libsql://` URL) plus `LIBSQL_AUTH_TOKEN` in the dashboard.
No code changes — the snapshot restore steps aside on its own.

### Anywhere with a disk

```bash
docker build -t clearline .
docker run -p 3000:3000 \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  -e CLEARLINE_PASSWORD=choose-one \
  -e LIBSQL_URL=file:/var/data/clearline.db \
  -v clearline-data:/var/data \
  clearline
```

Mount the volume anywhere except `/app/data` — that directory holds the vendor
documents baked into the image, and a mount there would hide them.

`/api/health` is the health check. It is deliberately unauthenticated and
deliberately returns counts only: no vendor names, no prices, no key material.

## Environment

| Variable | Required | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | yes | The AI loops are real and will not run without it. |
| `CLEARLINE_PASSWORD` | on any shared deployment | Enables the auth gate. Unset means no gate — fine locally, not fine on a public URL. |
| `CLEARLINE_SIGNING_KEY` | recommended | HMAC key for document links. Generated per process if unset, so links break on restart. |
| `CLEARLINE_MODEL` | no | Defaults to `claude-opus-5`. `claude-sonnet-5` is a cheaper drop-in; `npm run eval` reports the difference. |
| `LIBSQL_URL` | no | Defaults to a file under the app root. |
