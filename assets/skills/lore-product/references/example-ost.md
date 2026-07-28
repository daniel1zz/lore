# Worked Example — Opportunity Solution Tree

A filled OST at the granularity this mode expects, followed by the same tree done badly. Read both. **The bad one is the more useful half** — it is what an OST degrades into when the discipline in [mode-opportunity.md](mode-opportunity.md) is applied loosely, and it looks reasonable at a glance.

This example threads through the whole chain: its feature matrix is in `lore-product-benchmark/references/example-feature-matrix.md`, and the experiments below are executed in [example-validation-ledger.md](example-validation-ledger.md).

**Product**: a B2B analytics SaaS. Teams connect a data source, build their first dashboard, invite colleagues.

---

## ✅ Good

### Outcome

**7-day activation rate: 23% → 40%** (activation = team has ≥1 dashboard with a real data source and ≥2 members active in week 1)

Baseline from product analytics, 6-month window, n=1,840 signups. Gap = ~310 teams/quarter that sign up and never activate.

> One outcome. Measurable. Has a baseline. Names what counts as activation, so the tree cannot drift into "engagement".

### Opportunities

| # | Opportunity (in the user's words) | Evidence | Tier |
|---|-----------------------------------|----------|------|
| O1 | "I connected the warehouse and then just sat there — I didn't know what a good first dashboard even looks like" | 4/7 onboarding interviews unprompted; session replays show median 6min idle on the empty canvas; 31 support tickets "what should I build first" | E1 ×2, E4 ×1 |
| O2 | "I got it working but I'm the only one who ever opens it" | Analytics: 68% of activated teams have exactly 1 active member at day 7; 3 interviews describe forwarding screenshots into Slack instead of inviting | E1, E4 |
| O3 | "I couldn't tell if the numbers were right, so I didn't dare show anyone" | 5/7 interviews; 2 teams rebuilt the same metric in a spreadsheet to cross-check (E3 — they spent hours on this) | E4 ×2, E3 |

Each is a need. None names a product noun. Each has ≥2 independent sources.

**Rejected as solution-in-disguise**: "users need a template gallery" → fails detector rule 1 (names a UI surface) and rule 3 (exactly one obvious implementation). The need underneath it is O1.

### Solutions — O1 ("don't know what a good first dashboard looks like")

| # | Solution | Axis | Experiment | Kill condition (set before running) |
|---|----------|------|-----------|-------------------------------------|
| S1 | Ship the workspace pre-populated with 3 dashboards built from the user's own connected data | Defaults | Fake door: "Start from a suggested dashboard" on the empty canvas | <10% click → drop |
| S2 | Guided 4-step build of one dashboard, with the metric chosen for them | Assist | Prototype + 5 target users, unassisted | <4/5 finish unaided → redesign |
| S3 | Remove the blank canvas entirely — infer 3 candidate dashboards at connect time and let them delete what they don't want | Remove | Eng spike: can we infer usable metrics from an arbitrary warehouse schema? | >2 weeks or accuracy <60% on 10 real schemas → not viable now |

Three materially different bets: one changes defaults, one adds guidance, one deletes the step. Not three variants of a wizard.

*(O2 and O3 each carry their own 3 solutions — omitted here for length; a real tree fills them all before selecting.)*

### Branch selection

| Opportunity | Evidence strength | Outcome leverage | Cheapest disproof | Score |
|-------------|------------------|------------------|-------------------|-------|
| O1 | 5 (E1 ×2 + E4) | 4 — idle-on-empty-canvas is the single largest drop-off step | 5 — fake door in hours | **4.7** |
| O2 | 4 | 3 — affects the 2-member half of the definition | 4 | 3.7 |
| O3 | 4 (incl. E3) | 2 — trust blocks sharing, but only after a dashboard exists | 2 — needs real usage to test | 2.7 |

**Pursue O1.** **Rejected now, with reasons** — O2: real, but downstream of O1 (nobody invites a colleague to an empty workspace), so it is partly a dependency, not a parallel bet. O3: real and evidenced (E3 spreadsheet rebuilds), but untestable until teams have dashboards to distrust; revisit after O1 ships.

> Rejections are recorded because they are what stops O3 being re-proposed next month as a fresh idea. The reason "downstream of O1" is a claim that will be re-checked, not a dismissal.

---

## ❌ Bad — the same tree, done the way it degrades

### Outcome
> **Improve onboarding**

No metric, no baseline. Nothing below can be prioritized because nothing can be shown to move it.

### Opportunities
> - O1: Users need a template gallery
> - O2: Users need better collaboration features
> - O3: Users need an AI assistant

All three are solutions wearing the word "need". O3 is a technology looking for a problem. None cites evidence — they are plausible, which is exactly why they survive review.

### Solutions
> **O1 → Solution: build a template gallery.**

One solution per opportunity, and it restates the opportunity. This is a decision that was already made before the tree was drawn; the tree is decoration.

### Experiments
> **Experiment: ship it and see if activation improves.**

Not an experiment. No kill condition, no smallest test, and it can only be run after paying the full build cost — which is the moment when nobody cancels.

### Why this passes casual review

Every line is defensible in isolation, the structure looks like an OST, and it is faster to produce. It fails on exactly four checks — measurable outcome, needs-not-features, ≥3 diverse solutions, disproving experiment with a kill condition — which is why those four are hard gates rather than advice.

---

## Self-check before leaving this mode

| Check | Good | Bad |
|-------|------|-----|
| Outcome has metric + baseline | ✅ 23%→40%, n=1,840 | ❌ "improve onboarding" |
| Opportunities are needs, ≥2 independent sources | ✅ all three | ❌ zero evidence, all solutions |
| ≥3 materially different solutions | ✅ defaults / assist / remove | ❌ one, restating the need |
| Experiment can disprove, kill condition pre-stated | ✅ all three | ❌ "ship and see" |
| Rejected branches recorded with reasons | ✅ O2, O3 | ❌ absent |
