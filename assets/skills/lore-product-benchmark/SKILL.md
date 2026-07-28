---
name: lore-product-benchmark
description: "Tear down 1-3 benchmark products into an evidence-backed Feature Matrix before designing anything. Use when starting a new product/feature, when asked 'what features should this have', 'what do competitors have', 'benchmark this', 'teardown', '对标', '标杆产品', '竞品功能拆解', or whenever a feature list is about to be invented from memory. Upstream of ideation/opportunity/PRD — supplies the raw feature inventory that those stages reason over."
---

# Product Benchmark Teardown

The software industry is mature: for nearly every scenario, someone has already shipped a market-validated answer. This skill converts that fact into a **Feature Matrix** — a per-feature, per-benchmark inventory where every cell carries a source URL or a captured observation.

## Why this exists

The default failure mode of AI product work is inventing a feature list from the model's memory, then dressing it up as analysis. That list is a blurry average of everything the model has read — plausible, generic, and untethered to what actually ships today. A teardown replaces recall with observation.

⛔ **LLM memory is NOT a source.** It may generate *candidates to verify*, never matrix cells. Every cell needs a URL, a screenshot, or a recorded interaction.

📎 **Read [references/example-feature-matrix.md](references/example-feature-matrix.md) before building one** — a fully worked teardown at the expected granularity, including an unreachable benchmark handled honestly and a section on how the matrix gets misused.

## Phase 1: Pick benchmarks

Select **1-3** products. More than 3 dilutes depth into a shallow sweep.

| Slot | What to pick | Why |
|------|-------------|-----|
| **Category leader** (required) | The product most users would name first | Defines table stakes — what users will assume exists |
| **Closest analogue** (required) | Whoever serves *our* specific user in *our* specific scenario, even if smaller | Leader is often too broad; the analogue shows the real shape |
| **Adjacent disruptor** (optional) | A newer product attacking the category from a different angle | Reveals where the category is heading, not where it has been |

Also record **non-obvious substitutes** — spreadsheets, a Notion template, a shell script, doing nothing. Most products lose to these, not to the leader.

State the selection and why each was chosen before proceeding.

## Phase 2: Gather evidence

Source priority — never skip to a lower tier while a higher one is reachable:

| Tier | Source | How |
|------|--------|-----|
| **B1** | Hands-on use of the live product | `agent-browser` (see the agent-browser skill; use `--session` per CLAUDE.md discipline). Sign-up-free tiers, public demos, sandbox environments |
| **B2** | Official surface | Docs site, changelog/release notes, pricing page, help center, API reference — via WebFetch/context7 |
| **B3** | Product-generated media | Official demo videos, onboarding walkthroughs, published screenshots |
| **B4** | Third-party teardowns, review sites (G2/Capterra), community threads | WebSearch |
| **B5** | LLM recall | **Candidate generation only.** Must be promoted to B1-B4 or dropped |

Pricing pages are disproportionately informative: how a company *packages* features tells you which ones it believes carry willingness-to-pay.

⛔ If a benchmark cannot be reached above B4, say so explicitly in the output rather than filling cells with confident guesses.

### What to extract per benchmark

1. **Feature inventory** — every user-visible capability, named in the product's own vocabulary
2. **Information architecture** — top-level navigation, how the product organizes its own concepts
3. **Core flow step count** — literal number of steps from entry to primary value; note where friction sits
4. **State coverage** — empty, loading, error, first-run, and "lots of data" states (this is where quality bars actually live)
5. **Onboarding path** — what the product forces you to do before letting you succeed once
6. **Pricing packaging** — which features gate which tier

## Phase 3: Build the Feature Matrix

```markdown
## Feature Matrix — {category}

| # | Feature | {Benchmark A} | {Benchmark B} | Substitute | Ours | Class | Evidence |
|---|---------|---------------|---------------|------------|------|-------|----------|
| 1 | ... | ✅ core | ✅ paid tier | ⚠️ manual | ❌ | table-stakes | [url] |
```

Classify every row into exactly one class:

| Class | Definition | Consequence |
|-------|-----------|-------------|
| **table-stakes** | Present in ALL benchmarks AND its absence makes the product unusable for the core job | Must be in scope. Absence is a defect, not a differentiator |
| **differentiator** | Present in some, and plausibly tied to why users choose that one | Candidate for our bet — must survive validation |
| **trap** | Present but low-frequency, legacy, or existing only to justify a pricing tier | Explicitly list as a non-goal so it does not get copied by reflex |
| **gap** | Absent everywhere, yet the job clearly demands it | The most valuable rows. Feed straight into opportunity mapping |

⛔ **Feature parity is not a strategy.** A matrix that concludes "build everything column A has" has failed. The output must name what we deliberately will NOT build.

## Phase 4: Handoff

The matrix is an **input**, not a decision. Route it:

| Consumer | What it takes | Command |
|----------|--------------|---------|
| `lore-product opportunity` | `gap` rows + user pain observed during teardown | Becomes opportunity candidates (needs, not features) |
| `lore-product ideation` | Full matrix as shared context for role agents | Grounds brainstorm in what exists |
| `lore-product prd` | `table-stakes` rows → baseline requirements; `trap` rows → non-goals | Scope floor and ceiling |
| `lore-design-ui` | IA, flow step counts, state coverage | Visual/interaction baseline |
| `lore-product-lens` | Competitive dimension source material | Replaces recalled competitor claims |

## Persist (MANDATORY)

```bash
lore search "{category} benchmark" --json          # may already exist — update instead
lore create knowledge --sub-type research \
  --title '{category} Benchmark Teardown' --content ...
```

Re-run rather than trust an old teardown when it is more than ~2 quarters old; benchmark products ship continuously and a stale matrix is worse than none because it reads as current.

## Output Structure

```markdown
# Benchmark Teardown: {category}

## Benchmarks Selected
{each with rationale + evidence tier actually achieved}

## Feature Matrix
{table}

## Table Stakes (scope floor)
{numbered — absence = defect}

## Differentiators Observed
{who bets on what, and the visible evidence they are right}

## Traps (explicit non-goals)
{what NOT to copy, and why}

## Gaps (opportunity candidates)
{what nobody serves well — the highest-value output of this skill}

## Evidence Ledger
| Claim | Tier | Source |

## Coverage Gaps
{what could not be verified above B4, stated plainly}
```

## Common Mistakes

| Mistake | Why it fails | Fix |
|---------|-------------|-----|
| Listing features from memory | Produces a generic average of the category, not today's reality | Every cell gets a URL or a captured interaction |
| Only comparing to the category leader | Leader's scope is shaped by its scale, not by our user | Always include the closest analogue |
| Ignoring non-product substitutes | Real competition is often a spreadsheet | Add a substitute column |
| Concluding "achieve parity" | Parity means arriving second with no reason to switch | Output must name traps and gaps, not just table stakes |
| Treating an old teardown as current | Stale matrix reads as verified truth | Re-run past ~2 quarters |
