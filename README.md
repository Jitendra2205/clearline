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

## Run it

```bash
npm install
cp .env.local.example .env.local     # then add your ANTHROPIC_API_KEY
npm run fixtures                     # generate the 5 vendor documents + ground truth
npm run seed                         # create the RFx, vendors and documents
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
npm run test:match       # deterministic matcher against every vendor description
npm run eval             # scores extraction against data/ground_truth.json (run npm run extract first)
npm run eval -- --json   # machine-readable; non-zero exit if a security assertion fails
```

---

## The three AI loops

| Loop | What it does | How it is constrained |
|---|---|---|
| **1 — Drafting co-pilot** | Plain-language brief → structured RFx | Strict tool schema. Every dimension canonicalised to mm at authoring time. The model must declare, in `assumptions`, everything it invented that the buyer never said. |
| **2 — Extraction** | One document → one filled schema | `null` when a value is absent, never a guess. A mandatory `source_ref` with a verbatim snippet on every field. Zod re-validation on ingest; off-schema output is rejected, not repaired. No field for a rank, score or recommendation. |
| **3 — Analyst Q&A** | Question → query → answer | The model picks one of nine queries. The application computes every number. The model narrates. It does no arithmetic. |

## Normalisation

Three separate problems, each handled explicitly:

- **Currency** — an explicit FX table with rate, source and as-of date. A converted value always displays next to its original: `₹38.40 (from USD 0.46 @ 83.5)`. A quote with no stated currency is not assumed to be INR.
- **Unit of measure** — a declared factor table. `per MT → per kg` converts and says why. `per box`, where the box size is never stated, does **not** convert; it goes to the review queue.
- **Line matching** — three tiers, visually distinguished in the grid: exact (the vendor cited our line code) · fuzzy (deterministic attribute scoring, score shown) · semantic (a model proposal, always requiring human confirmation).

## Layout

```
src/lib/ai/          the three loops, their prompts and their schemas
src/lib/normalize/   matching, currency, unit of measure, the pipeline
src/lib/query/       the analyst query engine — every number is computed here
src/lib/security/    file sniffing, CSV sanitisation, signed URLs, the auth gate
src/lib/db/          libSQL client and schema
scripts/dataset.ts   the demo dataset — the single source of truth
scripts/             fixture generation, seeding, extraction, eval, tests
```

`scripts/dataset.ts` generates both the vendor documents **and**
`data/ground_truth.json`, so the eval harness scores extraction against values
that provably appear in the source files. They cannot drift.

## Deploy

Single container, SQLite on a persistent disk — no external database.

```bash
docker build -t clearline .
docker run -p 3000:3000 \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  -e CLEARLINE_PASSWORD=choose-one \
  -e LIBSQL_URL=file:/var/data/clearline.db \
  -v clearline-data:/var/data \
  clearline
```

On Render: push to GitHub, then **New → Blueprint** and pick the repo — it reads
[`render.yaml`](render.yaml). Set `ANTHROPIC_API_KEY` and `CLEARLINE_PASSWORD`
in the dashboard. The disk mounts at `/var/data`, not `/app/data`, because
`/app/data` holds the vendor fixtures baked into the image.

The same code runs serverless against Turso instead — set `LIBSQL_URL` to a
`libsql://` URL plus `LIBSQL_AUTH_TOKEN`. Nothing else changes.

## Environment

| Variable | Required | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | yes | The AI loops are real and will not run without it. |
| `CLEARLINE_PASSWORD` | on any shared deployment | Enables the auth gate. Unset means no gate — fine locally, not fine on a public URL. |
| `CLEARLINE_SIGNING_KEY` | recommended | HMAC key for document links. Generated per process if unset, so links break on restart. |
| `CLEARLINE_MODEL` | no | Defaults to `claude-opus-5`. `claude-sonnet-5` is a cheaper drop-in; `npm run eval` reports the difference. |
| `LIBSQL_URL` | no | Defaults to a file under the app root. |
