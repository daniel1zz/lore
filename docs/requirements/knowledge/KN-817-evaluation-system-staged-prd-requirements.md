---
id: KN-817
type: knowledge
role: knowledge
title: "Evaluation system — staged PRD requirements"
status: approved
priority: medium
created: 2026-10-25
updated: 2026-10-26
tags: [evaluation, metrics, requirements, staged]
parent: PRD-001
links:
  - {id: KN-825, type: implements}
---
# Evaluation system — staged PRD requirements

Staged requirements for the root PRD `prd-lore-internal-first-ai-team-knowledge-platform`, numbered after its last requirement (R-28, read 2026-10-25 with `lore requirement list`). They are NOT yet in the PRD: `lore requirement add` demotes the approved root PRD and blocks every concurrent session's task claims, so they are applied in one batch at S4 approval.

Upstream: OST `knowledge-evaluation-questions-answerable-from-honest-machine` (outcome: evaluation questions A–K answerable from honestly labelled machine facts, 1/11 → 11/11), benchmark teardown `knowledge-evaluation-systems-for-ai-native-development` (row numbers below), user decisions D1–D9 (S1 interview, 2026-10-25).

Validation: no experiment has run yet (D9: the OST experiments are phase 1 of the plan, each kill condition pre-registered there). Every requirement is ⚠️ unvalidated; R-42 is 🎲 accepted bet (O6 has no instrumented evidence; the user kept it in scope, D3).

## Requirements

| Id | Priority | Statement | Source | Validation |
|---|---|---|---|---|
| R-29 | P0 | `lore metrics` MUST list all 11 evaluation questions A–K (AI decision quality, delivery efficiency, delivery quality, concurrency, unattended autonomy, governance cost, corpus health, cost, knowledge reuse, spec stability, safety), each with at least 1 named metric computed from recorded facts with no hand-written query. A question is **answered** when at least 1 of its metrics has status ok and a recorded baseline; it is **explicit no_data** when every metric is no_data because the project has no source for it, with the cause stated; otherwise it is unanswered (with reason `no metric registered` while its slice has not landed). Outcome measure: answered x/11 and explicit no_data y/11 reported separately, target x + y = 11 with every ok metric baselined (1 of 11 answerable on 2026-10-25). | OST outcome; D2, D3; S3 EU2 | ⚠️ unvalidated |
| R-30 | P0 | Every judgment-comparison, outcome or audit fact MUST carry exactly 1 origin from {human, agent, machine-event, unknown}, derived from the party the write is attributed to (BR-1055: run → agent, HTTP bearer key → agent, human session → human, dashboard login → human; rows written by the product's own recorders with no party → machine-event); no metric pools origins, and 0 agent-written rows are counted as human. | O1-S1; #406; benchmark row 5 | ⚠️ unvalidated |
| R-31 | P0 | Every metric value MUST carry its sample size, time window, the timestamp of the newest fact read, a one-line action for when it turns yellow or red, its stored baseline or none, and a status from {ok, insufficient, no_data}; no_data only when its source is absent or switched off, with that cause (source_absent / source_off) stated; a present but empty source or a sample below the minimum gives insufficient — neither is ever shown as 0 or as green. | O1-S2; benchmark row 17; S3 EU3 | ⚠️ unvalidated |
| R-32 | — | **Withdrawn (S3 PS1):** an issue fix, not a product requirement; carried by the task that resolves #411 (criterion AC-EM-6 stays as that task's oracle). | — | — |
| R-33 | — | **Withdrawn (S3 PS1):** an issue fix; carried by the task that resolves #409 (criterion AC-EM-5). | — | — |
| R-34 | P0 | Every review judgment MUST be labelled from machine after-events once it reaches day 30 (inclusive) — approve judgments always, reject judgments only after an observed action (an override or a revised version) — or be counted unlabelled; autonomy decisions MUST use the stood/reversed outcomes the approved observe sweep already records (7-day rule, AC-AU-8), never a second labelling. Label coverage is printed beside every number using labels. | O2-S1; D5; benchmark row 11; S3 crossdoc 1, eng 2 | ⚠️ unvalidated |
| R-35 | P0 | Per document type and judging-instruction version, `lore metrics` MUST report the Brier score and a 5-bin reliability table over labelled judgments only, with the per-verdict scoring table stated and each label's origin counted separately. | O2-S1; benchmark row 10 | ⚠️ unvalidated |
| R-36 | P0 | Judgments MUST be sampled deterministically (a fixed hash bucket of about 5% per ISO week) and, when an agent already asks a person through the ask channel (BR-1375), that ask carries at most 1 sampled audit question; nothing is queued. Only the person's answer records a verdict (agent attempt refused, exit 4). Judge-vs-human agreement is Cohen's κ after mapping the verdict to approve/reject, with prevalence and PABAK beside it, and audit completion (audited / sampled over 4 weeks) is reported. Differs from the queued audit removed by AC-LG-14 (36 queued, 0 answered in 4 months): no item waits in a queue; the question rides on an ask that already has a person's attention. | O2-S2; D10; benchmark rows 6, 7 | ⚠️ unvalidated |
| R-37 | P0 | An approval or rejection that overrides the latest judgment of the version MUST carry a non-empty calibration note, else it is refused with exit 4 and writes nothing; the override is detected from the latest judgment, never declared, and the decision and its note are written together (a failed note write fails the command, exit 1). The override share per document type is reported. | O2-S4; #407; S3 DA4 | ⚠️ unvalidated |
| R-38 | — | **Withdrawn as a shipped metric (S3 PS2):** judge AUC is a phase-1 experiment output (O2-S3), not a v1 metric. | O2-S3 | — |
| R-39 | P1 | Over a chosen window `lore metrics` MUST report, from recorded facts with no manual labelling: median lead time (first claim → done after landing), landings per day, change fail rate (red main-red records over decided landings, a record covering the landings in its commit range from the last commit checked green to the commit checked red, counted once, with no time window; S3 round 2 aligned to the successor spec, BR-1438), rework rate (fix tasks resolving issues filed against landed work) and median recovery time (first landing in the red range → recorded green), each reported as no_data source_absent while its recorder does not cover the window, where a landing is an integrate merge commit read from main's never-rewritten history, so any past window can be re-read with the same result. | O3-S1; benchmark rows 1, 2, 4; S3 eng 1 | ⚠️ unvalidated |
| R-40 | P1 | `lore metrics` MUST report concurrency: live runs per hour (median and max, a never-ended run counted live only until its last attributed write, with the count of never-ended runs shown), and integrate conflict and lost-race rates over all attempt outcomes from an attempt history that keeps every attempt younger than 30 days with start time and step exit codes; older windows report these two rates as no_data, never as an undercount. | O4-S1; benchmark row 13; S3 PS2, eng 8 | ⚠️ unvalidated |
| R-41 | P1 | `lore metrics` MUST report unattended autonomy from the decision record: the share of settled decisions lore decided from facts versus those a person answered, and the median wait for a person. | OST question E (no separate opportunity row; closest O4); D2 | ⚠️ unvalidated |
| R-42 | P2 | `lore metrics` MUST report tokens per landed task (one metric) from the harness's local session records joined to runs, apportioned without double counting, and no_data naming the missing or unjoinable source otherwise. | O6-S1; D3 | 🎲 accepted bet |
| R-43 | P1 | Every gate and hook outcome, hook-ingested ones included, MUST record the deciding party, the subject and its content fingerprint, and `lore metrics` MUST report per check the deny rate and the false-deny rate (a deny followed within 24 hours by a pass of the same party on the same unchanged subject). | O5-S1; benchmark row 15 | ⚠️ unvalidated |
| R-44 | P2 | `lore metrics` MUST report knowledge reuse (one metric): the share of documents served to a run that the same run's task later links, cites or anchors. | O7-S1; benchmark row 24 | ⚠️ unvalidated |
| R-45 | P2 | `lore metrics` MUST report spec stability (one metric): approved → draft cycles per spec per 30 days. | O7-S2; benchmark row 25; S3 PS2 | ⚠️ unvalidated |
| R-46 | P2 | `lore metrics` MUST report safety (one metric): automatic decisions later reversed, per decision class, from the observe sweep's outcomes. | O8-S1; S3 PS2 | ⚠️ unvalidated |
| R-47 | P1 | Question G (corpus health) MUST be answered by the existing `lore eval` scenarios' results, deep-equal, not by a second implementation. | OST baseline (G answerable today; no opportunity row) | ⚠️ unvalidated |
| R-48 | P1 | Each metric's colour MUST be pre-registered before it colours anything: a baseline measured over the 30 days before recording, stored once as an append-only epoch in the corpus with its audit entry in one transaction (no update or delete; replacing it needs a reasoned rebaseline that appends a new epoch); yellow when worse than the baseline by ≥ 10%, red by ≥ 25%, coloured only when the metric's 95% interval lies wholly past the band edge (a bound exactly on the edge counts as past it; a zero baseline needs the interval strictly beyond 0 in the bad direction), never green below n = 20. No composite score exists anywhere. | D4, D8; benchmark rows 17, 21; S3 eng 5, DA4 | ⚠️ unvalidated |
| R-49 | P1 | Only question-A metrics backed by audited items MAY be read by a gate, and only with ≥ 30 audited items and the 95% lower bound of κ ≥ 0.6; any other request is refused (exit 4). A machine-only reliability proof for other metrics is out of v1. | D6; S3 DA2, eng 4 | ⚠️ unvalidated |
| R-50 | P2 | The dashboard MUST show a trend page per question with each metric's status colour, sample size and no_data/insufficient state, rendering the same values `lore metrics --json` returns for the same window. | D7; benchmark row 19 | ⚠️ unvalidated |
| R-51 | P1 | The session-start snapshot (`lore bootstrap`) MUST print one line per metric whose colour is red or yellow (metric, value, baseline, its action line), and nothing when none is; this stays report-only (D6). | S3 EU1; D6 | ⚠️ unvalidated |
| R-52 | P1 | Beside every metric computed from facts agents themselves write (after-event labels, rework, reuse), `lore metrics` MUST report two guard figures over the same window: issues filed per landed task and links created per document created. | S3 DA1 | ⚠️ unvalidated |

X = 10% and Y = 25% (R-48), n = 20 (R-48), the ~5% sample bucket (R-36), the 30-day horizon (R-34), the commit-range attribution (R-39, which replaced the 7-day fail window) and κ lower bound ≥ 0.6 over ≥ 30 items (R-49) are AI-proposed values awaiting the user's confirmation at S4; D8 fixes the rule form, not the numbers. Ids R-32, R-33 and R-38 are withdrawn, not renumbered, because acceptance criteria already cite the surrounding ids.

## Initiative kill criterion (pre-registered)

Eight weeks after this repo's baselines are recorded, the initiative is paused (no new metric work; existing metrics keep reporting) when either holds: (a) no red or yellow metric led to a task or issue naming that metric id, or (b) audit completion (R-36) stayed below 50% over the last 4 weeks — in case (b) the audit alone stops and question A falls back to machine after-events only (D10). Owned by the plan-5 task "Eight-week initiative review".

## Non-goals (benchmark trap rows)

| Row | Non-goal | Why |
|---|---|---|
| 8 | Blind multi-reviewer review | A 3–5 person team cannot staff it; the sampled single-human audit (R-36) gives the calibration signal at a cost one person can carry. |
| 18 | Push alert delivery (Slack, PagerDuty, webhook) | Lore is one local binary; status is read on demand (CLI, dashboard) and only proven metrics reach gates (R-49). |
| 20 | Per-individual leaderboard or ranking | SPACE names it a pitfall; per-actor breakdown stays a diagnostic filter, never a ranking; human audit verdicts are attributed but not scored. |
| 21 | Single composite score | Excluded by D4: raw metrics plus red/yellow/green only. |
| 22 | Activity counts (lines of code, commits) as productivity | Noisy and gameable by agents; delivery is measured by landings, lead time and failure rates (R-39). |

## Where this extends existing surfaces

| Existing | Use |
|---|---|
| Baseline leaf `baseline-measure-corpus-usage` (usage report) | Kept as is; BR-993 and BR-1013 are corrected to opt-in telemetry (R-33). The usage report stays; `lore metrics` reads its counts for questions F and I instead of re-counting. |
| `lore calibration --stats` (leaf `baseline-read-calibration-statistics`) | Kept; it gains origin separation (R-30). Brier, reliability bins, AUC and κ are new metrics under question A, read from the same comparisons. |
| `lore checks stats [--quality]` | Kept; its denials and escaped-defect counts feed questions F and C. |
| `lore trace stats` | Kept; its served-document records feed question I. |
| `lore eval` scenarios | Kept; read as question G (R-47). |
| `lore calibration --observe` (autonomy outcome sweep) | Kept; its stood/reversed outcomes are one after-event source of R-34. |
| New | `lore metrics` command, the Evaluation baseline branch, the audit queue, thresholds config, dashboard trend page. |
