# Worked Example — Feature Matrix

The teardown that feeds [example-ost.md](../../lore-product/references/example-ost.md). Category: **B2B analytics / dashboard tools**, scoped to the question that matters — *what does a team encounter between signing up and having a first useful dashboard?*

Scoping the teardown to a question is what keeps it from becoming an undifferentiated feature dump.

## Benchmarks selected

| Slot | Product | Why | Evidence tier reached |
|------|---------|-----|----------------------|
| Category leader | *Leader X* | First product named by 5/7 interviewees | **B1** — free tier, walked the full onboarding with a real warehouse |
| Closest analogue | *Analogue Y* | Same buyer (ops lead at a 20-80 person company), same "no data team" constraint | **B2** — no self-serve trial; docs + changelog + pricing + 2 demo videos |
| Adjacent disruptor | *Notebook Z* | Attacks the category from code-first notebooks rather than drag-and-drop | **B1** — OSS, ran locally |
| Substitute | Spreadsheet + scheduled CSV export | What 2 interviewed teams actually do today | **B1** — reproduced the workflow |

⛔ *Analogue Y* could not be reached above B2 — no sandbox exists. Its empty-state and error-state rows below are **unverified** and marked so. They are not scored as absences.

## Feature Matrix — signup → first useful dashboard

| # | Feature | Leader X | Analogue Y | Notebook Z | Substitute | Ours | Class | Evidence |
|---|---------|----------|-----------|-----------|-----------|------|-------|----------|
| 1 | Warehouse connect wizard | ✅ 6 sources | ✅ 12 sources | ⚠️ config file | n/a | ✅ 8 sources | table-stakes | docs/connect |
| 2 | **Non-empty first screen** (sample or inferred content) | ✅ 3 auto dashboards | ✅ industry templates | ❌ blank notebook | n/a | ❌ **blank canvas** | **table-stakes** | walked signup 2026-07 |
| 3 | Guided first-dashboard flow | ❌ | ✅ 5-step | ❌ | n/a | ❌ | differentiator | Y demo video 2:10 |
| 4 | Metric definition reuse / semantic layer | ✅ paid tier | ✅ paid tier | ✅ code | ❌ | ⚠️ partial | differentiator | pricing pages |
| 5 | Invite teammate during onboarding | ✅ step 4 | ✅ step 2 | ❌ | ❌ | ⚠️ buried in settings | table-stakes | walked signup |
| 6 | Freshness / correctness indicator on each chart | ✅ | unverified | ✅ | ❌ | ❌ | differentiator | walked X; Y B2 gap |
| 7 | AI natural-language chart builder | ✅ beta | ✅ | ❌ | ❌ | ❌ | **trap** | see below |
| 8 | Mobile dashboard app | ✅ | ✅ | ❌ | ❌ | ❌ | **trap** | G2 reviews cite low use |
| 9 | White-label embedding | ✅ enterprise | ✅ enterprise | ❌ | ❌ | ❌ | trap | pricing: enterprise-only |
| 10 | **"Is this number right?" verification path** | ❌ | ❌ | ⚠️ read the code | ✅ trivially | ❌ | **gap** | 5/7 interviews |
| 11 | **Recovering a half-finished setup next day** | ❌ resets | unverified | ✅ file persists | ✅ | ❌ | **gap** | walked X, left 24h |

## Table stakes — the scope floor

Rows 1, 2, 5. **Row 2 is the finding that matters**: every benchmark puts *something* on the first screen, and we ship a blank canvas. That is not a missing feature, it is a defect against category expectation — and it is what interviewees described independently as sitting there not knowing what to build.

## Differentiators observed

Y bets on guidance (row 3) and prices for it. X bets on breadth plus trust signals (row 6). Z bets on the code-first escape hatch. Nobody is winning on all three.

## Traps — explicit non-goals

Rows 7-9. The AI chart builder is present in both leaders and is the row most likely to be copied by reflex, but review mining shows it used for demos far more than for daily work, and it does nothing for the activation gap we are actually solving. Mobile is the same story with an older technology. **Copying these three would consume a quarter and move nothing.**

⛔ Trap classification is a claim about *our* outcome, not a claim the feature is bad. Re-evaluate if the outcome changes.

## Gaps — the highest-value output

- **Row 10** — nobody offers a path to verify a number. Two interviewed teams rebuilt metrics in a spreadsheet to cross-check (E3: they spent hours). Directly becomes opportunity **O3** in the OST.
- **Row 11** — every product except the ones with files loses a half-finished setup. Becomes the "I lose my place" need.

Gaps are where a category is uniformly weak, so they are the rows most likely to yield a differentiator rather than parity.

## Evidence ledger

| Claim | Tier | Source |
|-------|------|--------|
| X ships 3 auto dashboards on first load | B1 | walked signup with real warehouse, 2026-07 |
| Y has a 5-step guided flow | B3 | official demo video, 2:10 |
| Rows 7-8 are low-usage | B4 | G2 review mining, 40 reviews |
| Y empty/error states | — | **unverified, B2 ceiling** |

## Coverage gaps

Y was never used hands-on. Its rows are docs-derived and could be stale by a release. Re-run this teardown before any decision that hinges on Y specifically.

## How this matrix is misused

| Misuse | What it produces |
|--------|-----------------|
| Reading the ✅ column and building all of it | Feature parity — arriving second with no reason to switch |
| Treating trap rows as gaps | A quarter spent on a mobile app while the blank canvas stays blank |
| Filling unverified cells with confident guesses | A matrix that reads as observed and is recalled |
| Keeping the matrix past ~2 quarters | Stale rows that read as current, which is worse than no matrix |
