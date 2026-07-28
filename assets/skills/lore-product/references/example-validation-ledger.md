# Worked Example — Validation Ledger

The O1 branch from [example-ost.md](example-ost.md), actually executed. Same product: a B2B analytics SaaS, outcome 7-day activation 23% → 40%.

This is what "validated" looks like when it is earned. Note that **the headline result is a failure** — that is normal, and reporting it is the point.

---

## Part A — Problem score

| Dimension | Score | Evidence | Tier |
|-----------|-------|----------|------|
| Frequency | 5 | Every new team hits the empty canvas; 100% of 1,840 signups pass through it | E1 |
| Intensity | 4 | Median 6min idle then session end; 41% of non-activating teams never return | E1 |
| Workarounds | 4 | 3 teams rebuilt metrics in spreadsheets to get *something* on screen; 2 copied a dashboard from a public demo | E3 |
| Willingness to pay | 3 | Two teams on trial said they'd pay for "a done-for-you setup" — hypothetical, discounted | E6 → capped at 3 |

**5 × 4 × 4 × 3 = 240 → promising, not strong.** Weakest dimension is WTP, and it rests on E6. Before treating this as a revenue bet, get E2 evidence (does anyone already pay for onboarding/setup services?). For an activation bet — where the return is retention, not new revenue — 240 with three E1/E3 dimensions is sufficient to proceed.

> ⛔ Note what did NOT happen: the 3 was not rounded up to 4 to clear 250. The score reports what the evidence supports, and the gap is named.

## Assumption map — what got tested first

| Assumption | Importance | Evidence today | Order |
|-----------|-----------|----------------|-------|
| Teams want a suggested starting dashboard at all | High | None | **1st — riskiest** |
| They can complete a guided build unaided | High | None | 2nd |
| We can infer usable metrics from an arbitrary schema | High | None | 3rd (only matters if 1 passes) |
| Teams that activate retain better | High | Strong (E1 cohort data) | Not tested — already known |

Tested in risk order, not in solution order. S3's expensive spike was deliberately queued behind S1's cheap fake door.

## Part B/C — The ledger

| # | Solution | Risk | Experiment run | Result | Tier | Verdict |
|---|----------|------|---------------|--------|------|---------|
| S1 | Pre-populated dashboards | Value | Fake door "Start from a suggested dashboard", 412 new workspaces, 8 days | 27% clicked (kill line 10%) | E1 | ✅ validated |
| S1 | Pre-populated dashboards | Usability | Prototype, 5 target users, unassisted | 5/5 reached a usable dashboard; 3 immediately edited it | E1 | ✅ validated |
| S1 | Pre-populated dashboards | Feasibility | Eng spike, 3 days, 10 real customer schemas | Usable metrics inferred on 4/10; 6 needed manual mapping | E1 | ❌ **refuted as specified** |
| S1 | Pre-populated dashboards | Viability | Support-load estimate + data-access review | Reading customer schema at connect time needs an explicit consent step (privacy) | — | ⚠️ conditional |
| S2 | Guided 4-step build | Value | Same fake door, second variant, 412 workspaces | 9% clicked (below 10% kill line) | E1 | ❌ refuted |
| S2 | Guided 4-step build | Usability | — | not run (value refuted first — no reason to spend) | — | n/a |
| S3 | Remove blank canvas entirely | Feasibility | Covered by the S1 spike — same inference problem, harder | 4/10 | E1 | ❌ refuted |

## What this actually means

The cheap experiment passed and the expensive one killed the plan. Teams **do** want a suggested starting dashboard (27% — strong), and they **can** use one (5/5). We simply **cannot generate it automatically** for 6 out of 10 real schemas.

That is not "S1 failed". It is a **reshaped bet**: the value is proven, the auto-inference is not. The surviving option is a narrower one nobody had proposed before the evidence forced it — offer suggested dashboards only for the ~40% of schemas we can infer confidently, and fall back to the existing empty canvas for the rest.

⛔ That narrower option is itself **`⚠️ unvalidated`**. It was derived from these results, not tested by them. It goes back through a fake door before it becomes a P0.

## What carries into the PRD

| Requirement | Source | Validation |
|------------|--------|-----------|
| FR-001 Suggested dashboards for confidently-inferable schemas | OST O1/S1 | ✅ validated — value 27% CTR (n=412), usability 5/5 |
| FR-002 Explicit consent step before reading schema | Viability review | ✅ validated — privacy requirement, not a bet |
| FR-003 Confidence threshold + fallback to empty canvas | Derived from spike result | ⚠️ unvalidated — fake door queued as a plan task before P0 |
| ~~Guided 4-step build~~ | OST O1/S2 | ❌ refuted — 9% vs 10% kill line. **Recorded as a PRD non-goal with the number**, so it is not re-proposed as an obvious idea. |

## Failure modes this example is calibrated against

| What a rough ledger does | What happened here |
|-------------------------|-------------------|
| Reports only the passing experiments | The spike failure is the headline |
| Rounds a weak dimension up to clear the threshold | WTP stayed at 3; the gap was named |
| Marks the reshaped bet "validated" because it descends from a validated one | FR-003 is `⚠️ unvalidated` and queued |
| Runs the expensive test first because it is the interesting one | Fake door (hours) before spike (3 days) |
| Drops the refuted idea silently | S2 becomes a PRD non-goal carrying its number |
| Says "5/5 users loved it" | Records the behaviour: 5/5 reached a usable dashboard, 3 edited it |
