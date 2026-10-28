---
id: KN-825
type: knowledge
role: knowledge
title: "Evaluation Questions Answerable From Honest Machine Facts Opportunity Solution Tree"
status: approved
priority: medium
created: 2026-10-25
updated: 2026-10-25
tags: [ost, evaluation, metrics, calibration]
parent: PRD-001
links:
  - {id: KN-826, type: implements}
---
# Opportunity Solution Tree: Lore evaluation questions answerable from honest machine facts

Upstream: benchmark teardown `knowledge-evaluation-systems-for-ai-native-development`; user decisions D1–D9 (2026-10-25 S1 interview). Per D9 no separate validate run: every experiment below is executed as phase 1 of the downstream plan, against the existing `.lore` data, with the kill condition fixed here.

Deviation recorded: the mode asks for one solution-generating subagent per opportunity; solutions were generated in the main session instead, to keep 8 near-identical dispatches (each needing the same data context) out of the token budget.

## Outcome (exactly one)

**Evaluation questions answerable from honestly-labelled, machine-recorded facts without hand-written queries: 1 of 11 → 11 of 11, each with a recorded baseline value.**

The 11 questions, one per dimension fixed by the user (D2, D3):
A AI decision quality · B delivery efficiency · C delivery quality · D concurrency · E unattended autonomy · F governance cost · G corpus health · H cost (tokens / money) · I knowledge reuse · J spec stability · K safety.

Baseline (2026-10-25, measured in this session): only G is answerable (`lore eval`). F and C are partial (`lore checks stats [--quality]`). A has a command (`lore calibration --stats`) whose number is mostly agent-vs-agent (#406), so it does not count. Answering A even partially took ~40 tool calls of ad-hoc `sqlite3` (E3: time invested coping).

## Opportunities

| # | Opportunity (the maintainer's or orchestrator's words) | Evidence | Tier |
|---|---|---|---|
| O1 | "The numbers I would read can be wrong and nothing tells me" | 94% of "human" calibration rows are agent actors (#406); telemetry is documented on but silently off (#409); 72 test-session runs sit in the repo corpus and would inflate any run count (#411) | E1 ×3 |
| O2 | "I can't tell whether an AI judgment or decision was right, or whether its confidence means anything" | 59/59 task rejects overridden (#408); 125/127 overrides carry no reason (#407); average confidence 0.77 never compared with outcomes; 2026 judgments, 45 human outcomes; this session's ad-hoc SQL | E1 ×3, E3 |
| O3 | "I can't tell whether AI-driven delivery is getting faster or slower, more or less stable" | Recurring "regression: main red" issues (#339, #351, #388); `lore checks stats --quality` was built to count post-close issues (time invested) but has no trend or speed side | E1, E3 |
| O4 | "I don't know whether more parallel agents help or just collide" | 735 runs, 158 integrate-attempt records, integrate exit 4/75 paths exist, yet no rate is computed; concurrency is the CLAUDE.md north star | E1 ×2 |
| O5 | "I don't know which governance checks block correct work, or what they cost" | `hook:subagent-stop-commit-guard` denies 512 of 910 runs (56%); #226 (advisory verdict printed without reasons); removal-candidate logic already built in `checks stats` | E1, E5, E3 |
| O6 | "I don't know what a task costs in tokens or money" | User directive D3 (warm source, discounted below E6); no instrumented pain observed | ⚠️ unevidenced |
| O7 | "I can't tell whether the corpus actually gives agents the right context, or keeps changing under them" | Issue #6: 227 of 232 judged docs hold a judgment for a version that no longer exists (spec churn); the usage report (never-read docs, zero-hit searches) was built as a coping tool | E1, E3 |
| O8 | "I can't tell whether dangerous operations are caught before they do damage" | `decision_log`: 39 worktree-remove and 20 governance-loosen escalations; #189 (branch code silently migrated the shared live corpus) | E1, E5 |

Independence check: O1 is a prerequisite of every other opportunity (each metric reads the same mislabelled tables), so it is the root need, not a sibling; it is sequenced first rather than merged.

Rejected as solution-in-disguise: "we need a metrics dashboard" (names a surface; the need is any of O2–O8); "we need a Lore score" (one obvious implementation, and a user-excluded trap, D4).

## Solutions and experiments

Every experiment runs on existing data in plan phase 1 unless stated; the kill condition is fixed now.

### O1 — numbers can lie silently

| # | Solution | Axis | Experiment | Kill condition |
|---|---|---|---|---|
| O1-S1 | Every outcome/score row carries an origin (`human` / `agent` / `machine-event`) derived from the resolved identity, never from a caller-chosen field; metrics never mix origins | Remove | Re-derive origin for the 1209 calibration rows from `actor` | >5% rows with undecidable origin → origin needs a new write-time field, not a backfill |
| O1-S2 | Each metric prints its sample size, window and source freshness; NO_DATA is distinct from 0 (borrowed: Langfuse alert NO_DATA modes) | Assist | Compute all 11 questions on the current DB | Fails to flag the two known silent holes (#409 telemetry, #411 test rows) → design is insufficient |
| O1-S3 | Test and foreign runs cannot enter the repo corpus (fix #411 at the write) | Defaults | Root-cause #411 | Cause not located in one task → keep S2's provenance filter as the guard |
| O1-S4 | Two independent implementations of every metric, diffed | Absurd | — (exposes the constraint: cost doubles; S2 covers the risk) | Not pursued |

### O2 — AI decision correctness

| # | Solution | Axis | Experiment | Kill condition |
|---|---|---|---|---|
| O2-S1 | Outcome attribution: link each judgment / autonomy decision to later machine events (reopen, revert, issue resolving it, main-red after landing) and compute Brier score + binned hit rate against confidence (benchmark gap row 10–11) | Automate | Label existing judgments from versions, links and issues over a 30-day horizon | <30% of judgments older than 30 days get any label → after-events too sparse; S2 must carry calibration |
| O2-S2 | Rule-based sampled human audit (e.g. 5% per week) whose verdicts are the calibration ground truth, reported with Cohen's κ and confusion matrix (borrowed: LangSmith rules + sampling_rate, Langfuse Score Analytics) | Borrow | Concierge: a human audits 20 sampled judgments | Median >3 min per item, or the human cannot decide on >25% → audit unit is wrong |
| O2-S3 | Retire confidence where it carries no signal (e.g. the task judge, #408) | Remove | AUC of confidence vs outcome on rows labelled by S1/S2 | AUC ≥0.65 for a doc type → keep that judge; below → retire or redesign it |
| O2-S4 | Overrides require a reason; reasons become few-shot corrections for the judge prompt (borrowed: LangSmith few-shot evaluators) | Assist | Mandatory reason on the next 20 overrides | >50% boilerplate reasons → reasons need a structured form |

### O3 — delivery speed and stability

| # | Solution | Axis | Experiment | Kill condition |
|---|---|---|---|---|
| O3-S1 | DORA mapped to Lore: lead time = task claim → landed on main; deploy = an `integrate` landing; change fail rate = landings followed by main-red / regression issue within N days; rework rate = fix tasks resolving issues filed against landed work; recovery = main red → green | Borrow | Compute the five for the last 30 days from git + corpus | Any of the five needs manual labelling → that metric is redesigned or dropped |
| O3-S2 | Extend `lore checks stats --quality` (per closed plan) with trend over time | Assist | Compare with S1 | <10 closed plans in the window → per-plan granularity cannot show a trend |
| O3-S3 | `integrate` records the floor outcome per landing, so stability is captured at the source | Automate | Inspect the 158 attempt records | Floor result already recorded → no new capture needed (S1 reads it) |

### O4 — concurrency

| # | Solution | Axis | Experiment | Kill condition |
|---|---|---|---|---|
| O4-S1 | Concurrency ledger: parallel live runs over time, integrate conflict (exit 4) and lost-race (exit 75) rates, queue wait, landings per hour vs active runs | Automate | Parse the 158 attempt records + `runs` | <80% of records carry timestamps and exit codes → capture first |
| O4-S2 | Ingest Claude Code OTel `session.count` / `subagent_completed` | Borrow | Spike: receive OTel locally | Needs an external collector service → rejected (Lore is one binary) |
| O4-S3 | Throttle parallelism automatically when the conflict rate rises | Absurd | Correlate conflict rate with parallel runs | r <0.3 → no basis for throttling |

### O5 — governance cost

| # | Solution | Axis | Experiment | Kill condition |
|---|---|---|---|---|
| O5-S1 | False-deny rate: a deny followed by the same actor passing with no content change, or a deny later filed as a defect | Automate | Compute on `check_outcomes` | Table has no actor/subject (schema today: id, check_id, outcome, ts) → capture must add them first |
| O5-S2 | Hook overhead from `hook_execution_*` timing | Borrow | Measure 1 day of hook timings | Median overhead <50 ms per tool call → report-only, low priority |
| O5-S3 | Deny → retry → success per checkpoint extended from gates (BR-488) to hooks | Assist | Compute for gates today | Already answers the question → S1 unnecessary |

### O6 — cost (⚠️ unevidenced; carried as 🎲 accepted bet per D3)

| # | Solution | Axis | Experiment | Kill condition |
|---|---|---|---|---|
| O6-S1 | Read token usage from the harness's local session transcripts, joined to runs by session id | Automate | Parse one session's transcript | Usage fields absent or not per request → S2 |
| O6-S2 | Claude Code OTel `cost.usage` / `token.usage` with a `task.id` resource attribute | Borrow | Spike as O4-S2 | Needs an external collector → rejected |
| O6-S3 | Estimate cost from run duration × model price | Defaults | Compare with S1 on 5 sessions | Error >30% → rejected |

### O7 — context quality and spec stability

| # | Solution | Axis | Experiment | Kill condition |
|---|---|---|---|---|
| O7-S1 | Reuse rate: docs served by feed/search that the receiving task later links, cites or anchors | Automate | Join `trace_events` to links/evidence | <10% of served docs ever linkable → signal too weak, use S3 |
| O7-S2 | Spec stability: approved → draft cycles and AC rewrites per spec per month from `versions` | Automate | Compute for 30 days | — (cheap, informative either way) |
| O7-S3 | Remove never-read docs instead of measuring reuse | Remove | — | Not pursued: deletion is a corpus decision, out of a measurement initiative |

### O8 — safety

| # | Solution | Axis | Experiment | Kill condition |
|---|---|---|---|---|
| O8-S1 | Safety ledger from `decision_log`: escalations, refusals, reversed auto decisions per class | Automate | Compute from 601 rows | — (data exists) |
| O8-S2 | Incident count: issues labelled as corpus/data loss incidents per month | Assist | Label existing issues | <3 incidents ever → report count only, no rate |
| O8-S3 | Rehearse destructive operations in a throwaway corpus | Absurd | — | Not pursued (testing concern, not measurement) |

## Prioritization

| Opp | Evidence | Leverage | Disproof cost | Mean |
|---|---|---|---|---|
| O1 | 5 | 5 (every metric reads it) | 5 | **5.0** |
| O2 | 5 | 5 (user priority A, D2 order) | 5 | **5.0** |
| O3 | 4 | 4 | 5 | 4.3 |
| O4 | 4 | 4 | 4 | 4.0 |
| O5 | 4 | 3 | 4 | 3.7 |
| O7 | 3 | 3 | 4 | 3.3 |
| O8 | 4 | 2 | 5 | 3.7 |
| O6 | 1 (unevidenced) | 3 | 4 | 2.7 |

The user put all 11 questions in v1 scope (D2, D3), so the labels below set **order and depth**, not inclusion:

- **Recommended (first):** O1 then O2 — O1 is the prerequisite of every number; O2 is the user's first priority and the clearest benchmark gap.
- **Alternative (next, in order):** O3, O4 — promoted ahead of O2's later solutions if O2-S1's kill condition fires (after-events too sparse), because their data is denser.
- **Not recommended as solutions:** O1-S4, O4-S3, O7-S3, O8-S3 (reasons in their rows). O6 enters the PRD only as a 🎲 accepted bet; its experiment runs before any build work.

## Assumptions

| Assumption | Confidence |
|---|---|
| Machine after-events (reopen / revert / issue / main-red) are dense enough to label ≥30% of judgments | 0.5 — O2-S1 tests it |
| A human can audit one sampled judgment in ≤3 minutes | 0.6 — O2-S2 tests it |
| `integrate` attempt records carry timestamps and exit codes | 0.7 — O4-S1 tests it |
| Session transcripts hold per-request token usage | 0.7 — O6-S1 tests it |
| `check_outcomes` lacks actor/subject, so false-deny needs new capture | 0.9 — schema read 2026-10-25 |

## Cross-cutting concerns

- Privacy: metrics aggregate per dimension; per-actor breakdown is a diagnostic filter, never a ranking (trap row 20). Raw search text stays behind an explicit flag, as `lore trace stats` already does.
- Ethics: no metric is used to rank individual humans; human audit verdicts are attributed but not scored.
- Accessibility: CLI text + JSON is the primary surface; the dashboard page follows the existing dashboard's a11y bar.
