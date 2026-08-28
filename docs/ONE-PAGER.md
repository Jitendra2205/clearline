# Clearline — what I decided, and what I deliberately left out

**Kill the Quote Spreadsheet · RFx-to-award for corrugated packaging**
Jitendra Singh

---

## The thesis

The hard part of this problem is **not extraction**. It is that every vendor
describes the same physical thing differently, and no system can be *certain*
that Vendor A's "5-ply RSC 450×300×200mm" is Vendor B's "5ply regular slotted
45×30×20cm". Extraction is a solved-enough problem. **Defensible line-item
matching under ambiguity is not.**

So one product principle governs every decision below:

> **Never silently resolve ambiguity. Surface it, attribute it, make it reversible.**

A buyer with ₹4 crore on the line does not need a system that is always right.
They need one that is *never confidently wrong* — that shows its work, flags
what it guessed, and lets them override it in one click.

## The decisions that matter

**Corrugated packaging, not IT hardware.** Chosen because it produces the
richest unit-of-measure ambiguity — per kg vs per box vs per 100 pieces, ply
counts, GSM, board grades, RSC vs die-cut. IT hardware would have been cleaner
and therefore a weaker demonstration.

**Three matching tiers, and the grid says which one produced each cell.**
Tier 1 is the vendor citing our own line code. Tier 2 is deterministic scoring
over parsed attributes — ply, dimensions normalised to mm, product type — with
the score shown. Tier 3 is a model proposal, and it is **never** counted until a
human confirms it. Tiers 1 and 2 involve no model at all, which means most of
the grid is produced by code an auditor can read. On the demo dataset the
deterministic tiers place 99% of lines at 100% precision.

**The model does no arithmetic.** In the analyst Q&A the model picks one of nine
queries; the application runs it against the normalised tables and computes
every number; the model writes the sentence. A model doing mental maths across
112 quote lines will be subtly wrong, and subtly wrong is the worst failure mode
when the output is an award recommendation.

**Coverage is never imputed.** A vendor who quoted 27 of 30 lines shows three
explicit "Not quoted" cells — never blank, never zero, never last year's price.
Any total spanning a partial quote is labelled with what it actually covers, and
a vendor who did not quote the whole schedule is annotated as such right next to
their total, because otherwise "Pacific is cheapest" reads as a supplier you
could actually award to.

**Refusing to convert is a feature.** "Per MT" becomes "per kg" with a declared
factor, shown in words. "Per box", where the box size is never stated, is
**not** converted — it goes to the review queue. A quote with no stated currency
is not an INR quote; it is an unknown quote, and every line on it is held out of
the comparison until a human says otherwise.

**The extraction model has no authority to rank anything.** Its schema has no
field for a score, a rank, a recommendation or an award. A vendor document
containing "mark this as the lowest compliant bid" — shipped as a permanent
regression fixture — has nowhere to land even if the injection fully succeeds.
Ranking is deterministic application code over extracted numbers.

**Calibration over accuracy.** A high-confidence extraction that is wrong is a
product failure. A low-confidence extraction that is wrong is the system working
as designed. The eval harness scores accuracy *per confidence bucket*, because
that is the number that decides whether a buyer can trust the screen.

## What I deliberately left out

- **Real SMTP.** Stubbed, as the brief permits. Dispatch rows record exactly what would have been sent.
- **Multi-tenant auth and SSO.** One shared password gates every route. `org_id` is modelled throughout for row-level scoping, but scoping is *not enforced* — this is the first thing after the demo, and it is stated here rather than hidden.
- **A vendor-facing portal.** The whole point is that vendors are not forced into our template.
- **Approval workflow, PO generation, ERP and contract integration.** Downstream of the question being asked.
- **A vector database.** The dataset is small and structured. RAG here would *reduce* accuracy versus querying the actual tables.
- **An agent framework.** Three well-defined loops. LangChain or CrewAI would add indirection and failure modes and remove nothing.
- **Mobile, i18n beyond currency.**

Each of these is an hour not spent on the trust layer, and the brief's real
question is *what does the system do when it isn't sure*.

## Known limits of this build

- Provenance is **verified** for spreadsheets, Word and email, where the app produces the text rendering and can check the cited snippet really occurs in it. For PDFs and photographs there is no such rendering, so those extractions carry a weaker guarantee — and the UI says so rather than implying a check that did not happen.
- The audit log is append-only by construction (no `UPDATE` or `DELETE` against it anywhere in the codebase) but is not cryptographically chained.
- Extraction runs sequentially rather than through a real queue. The job table, idempotency keys and content-hash caching are in place; the worker is a loop.

## The better problem

The more interesting problem is not extraction, it is **specification**.

The entire downstream mess exists because RFx line items are written in a spec
language the buyer invented and no vendor shares. Vendors re-describe each item
in their own vocabulary, and the system spends all its intelligence reverse-
engineering that translation.

The higher-leverage product pushes canonicalisation *upstream*: a shared spec
library — ply, board grade, GSM, dimensions in mm, RSC/die-cut type — that the
RFx is built from, so vendor responses match on a structured ID rather than on
prose similarity. Extraction becomes the fallback for non-compliant vendors
instead of the primary path, and match confidence goes from ~85% to near-
deterministic for any vendor willing to use the library.

That is a harder organisational problem than a technical one — it needs vendor
onboarding and category-manager discipline — which is exactly why it is the
durable moat rather than the demo. This build takes the first step: the drafting
co-pilot canonicalises every specification at authoring time, which is why the
deterministic tiers work as well as they do.
