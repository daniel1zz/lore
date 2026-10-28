---
id: KN-826
type: knowledge
role: knowledge
title: "Evaluation Systems for AI-Native Development Benchmark Teardown"
status: approved
priority: medium
created: 2026-10-25
updated: 2026-10-25
tags: [benchmark, evaluation, metrics, calibration]
parent: PRD-001
---
# Benchmark Teardown: evaluation systems for AI-native development governance

Scoped question: **what must Lore measure to know (a) whether each AI decision was right and (b) how efficient, high-quality, concurrent, cheap and unattended its AI-driven development is?** Teardown date 2026-10-25; re-run after ~2 quarters.

## Benchmarks selected

| Slot | Product | Why | Evidence tier reached |
|---|---|---|---|
| Category leader (delivery metrics) | DORA metrics + Four Keys (+ SPACE framework) | The metrics most engineering orgs name first for throughput/stability | B2 (dora.dev, github.com/dora-team/fourkeys METRICS.md, SPACE CACM reprint PDF); 2024 tier numbers B4 only |
| Category leader (AI judgment evaluation) | Langfuse, with Braintrust and LangSmith as comparators | Score/annotation/judge-alignment model for evaluating LLM outputs | B2 (official docs + pricing pages); a few rows search-summary only, marked |
| Closest analogue (AI coding analytics) | Claude Code analytics + OpenTelemetry, GitHub Copilot usage metrics, LinearB AI Insights | Measure AI agents doing development work — Lore's actual scenario | B2 (code.claude.com, docs.github.com, linearb.helpdocs.io); Jellyfish not covered (no official docs) |
| Substitute | Ad-hoc `sqlite3` queries over `.lore/lore.db` + `lore calibration --stats` / `lore checks stats` / `lore trace stats` | What was actually done on 2026-10-25 to answer "is AI confidence recorded?" | B1 (run in this session) |

No benchmark was used hands-on (B1); all product rows are docs-derived.

## Feature Matrix

Legend: ✅ present · ⚠️ partial · ❌ absent · ? unverified.

| # | Feature | DORA / Four Keys | Langfuse (+Braintrust/LangSmith) | CC / Copilot / LinearB | Substitute | Ours (Lore today) | Class |
|---|---|---|---|---|---|---|---|
| 1 | Throughput: lead time (commit→deploy), deploy frequency | ✅ defined + SQL | ❌ | ✅ Copilot median minutes-to-merge (AI vs all) | ⚠️ manual SQL | ⚠️ raw data only (runs, versions, `.lore/integrate-attempts`) | table-stakes |
| 2 | Instability: change fail rate, rework rate | ✅ CFR; rework rate added 2024 | ❌ | ⚠️ LinearB Rework Rate (method undocumented) | ⚠️ | ⚠️ `lore checks stats --quality` (issues ≤14d after plan close, reopened/fix tasks) | table-stakes |
| 3 | Recovery time after a change-caused failure | ✅ (renamed from MTTR 2023) | ❌ | ❌ | ❌ | ❌ (main-red → green not measured) | differentiator |
| 4 | Linking change → deploy → incident (attribution) | ✅ changes[] / incident change ids | n/a | ⚠️ CC matches merged-PR lines to session output | ❌ | ⚠️ task anchors, issue fingerprints, `resolves` links | table-stakes |
| 5 | One score record with origin (API / EVAL / ANNOTATION) and one target | ❌ | ✅ Langfuse `source`; LangSmith `feedback_source.type` | ❌ | ❌ | ⚠️ `review_judgments` + `calibration_records`, origin mislabelled (agent outcomes stored as `human_outcome`, #406) | table-stakes |
| 6 | Judge-vs-human agreement (κ, F1, confusion matrix) | ❌ | ✅ Langfuse Score Analytics (beta); ⚠️ LangSmith % match | ❌ | ❌ | ⚠️ raw agreement + Wilson LB, no chance correction, mostly agent-vs-agent | table-stakes |
| 7 | Rule-based sampled human audit queue | ❌ | ✅ LangSmith filter + `sampling_rate`; ⚠️ Langfuse manual add | ❌ | ❌ | ❌ | table-stakes |
| 8 | Blind multi-reviewer review | ❌ | ✅ Braintrust | ❌ | ❌ | ❌ | trap |
| 9 | Human corrections fed back into the judge (few-shot) | ❌ | ✅ LangSmith few-shot evaluators; ⚠️ Langfuse corrections | ❌ | ❌ | ❌ (and override reasons are empty, #407) | differentiator |
| 10 | Confidence calibration (Brier, ECE, reliability bins) | ❌ | ❌ ("calibration" = label agreement) | ❌ | ❌ | ❌ | **gap** |
| 11 | Decision-level outcome attribution (decision → later reopen / revert / issue / main-red) | ⚠️ change-level only | ❌ | ⚠️ LinearB rework, PR-level | ❌ | ⚠️ autonomy observe sweep (stood / reversed) for `decision_log` only | **gap** |
| 12 | Cost and tokens per unit of work | ❌ | ✅ per trace, ingested beats inferred | ✅ CC OTel `cost.usage`, `token.usage` (by model, main/subagent); LinearB cost per effective PR | ❌ | ❌ | table-stakes |
| 13 | Concurrency effectiveness (parallel runs, merge conflict / lost-race rates, queue wait) | ❌ | ❌ | ⚠️ CC `session.count`, `subagent_completed` only | ⚠️ | ⚠️ raw (runs, integrate attempts, claim conflicts) | **gap** |
| 14 | Autonomy decision record (who decided, why, factors) | ❌ | ❌ | ✅ CC `tool_decision` (source, permission_mode), `safety_event` | ❌ | ✅ `decision_log` with factors, score, threshold, channel, hash chain | differentiator (ours) |
| 15 | Governance cost: gate deny rate, false-deny rate, hook overhead | ❌ | ❌ | ⚠️ CC `hook_execution_*` events | ⚠️ | ⚠️ `lore checks stats` (runs, denials, removal candidates); no false-deny measure | **gap** |
| 16 | Prompt-version regression comparison of the judge | ❌ | ✅ all three (baseline, deltas) | ❌ | ❌ | ⚠️ calibration stats split by `prompt_version` | differentiator |
| 17 | Two-level thresholds (warning / alert) with explicit NO_DATA handling | ⚠️ colour buckets, no alerting | ✅ Langfuse, Braintrust, LangSmith | ⚠️ LinearB goals (Enterprise); CC spend limits | ❌ | ❌ | table-stakes |
| 18 | Push alert delivery (Slack / PagerDuty / webhook) | ❌ | ✅ | ⚠️ | ❌ | ❌ | trap |
| 19 | Metrics dashboard + query API | ✅ Grafana | ✅ dashboards, Metrics API | ✅ | ❌ | ⚠️ dashboard exists, no metrics page; CLI stats scattered over 3 commands | table-stakes |
| 20 | Per-individual leaderboard / ranking | ❌ explicitly discouraged (SPACE) | ❌ | ✅ per user | ❌ | ❌ | trap |
| 21 | Single composite score | ❌ "one metric to rule them all" is a named pitfall | ❌ | ❌ | ❌ | ❌ | trap |
| 22 | Activity counts (LOC, commits) as productivity | ⚠️ SPACE flags LOC as noisy | ❌ | ✅ CC/Copilot LOC | ❌ | ❌ | trap |
| 23 | Perceptual measure (survey of the humans) | ✅ SPACE requires ≥1 | ❌ | ⚠️ CC `feedback_survey` event | ❌ | ❌ | differentiator |
| 24 | Knowledge reuse: delivered context actually used downstream | ❌ | ❌ | ❌ | ❌ | ⚠️ `trace_events` feed/search, never-read docs, zero-hit searches | **gap** |
| 25 | Spec stability: churn of approved specs / ACs | ❌ | ❌ | ❌ | ❌ | ⚠️ raw `versions` table | **gap** |

## Table stakes (scope floor)

Rows 1, 2, 4, 5, 6, 7, 12, 17, 19. Lore holds raw data for most of them but turns almost none into a metric. Rows 5–7 are the ones that matter most: every AI-eval benchmark keeps judge and human verdicts in one record with an honest origin, measures agreement with a chance-corrected statistic, and samples items into a human audit queue by rule. Lore mislabels the origin (#406), so its only judge-quality number is mostly agent-vs-agent.

## Differentiators observed

- Langfuse/LangSmith bet on closing the loop from human correction to judge prompt (row 9) and on prompt-version regression views (row 16).
- Claude Code bets on cost and decision telemetry (rows 12, 14) via OpenTelemetry, joinable on `session.id`; a custom resource attribute (e.g. a task id) makes cost per task possible.
- Lore already leads on row 14: a tamper-evident decision log with factors and verdicts, which no benchmark has.
- DORA's recovery time (row 3) maps to "main red → green" for Lore and nobody in the AI-analytics set measures it.

## Traps (explicit non-goals)

- **Row 8 blind multi-reviewer**: Lore's humans are 3–5 people; multi-reviewer blinding has no reviewer pool to work with.
- **Row 18 push alert delivery**: the consumers are unattended agents reading CLI/JSON; Slack/PagerDuty routing serves an on-call human Lore does not have.
- **Row 20 per-individual ranking**: DORA and SPACE name it as a gaming driver; per-actor breakdown stays a diagnostic filter, never a ranking.
- **Row 21 composite score**: named DORA pitfall; also user decision D4.
- **Row 22 activity counts**: LOC/commit counts reward volume, which is cheap for agents.

## Gaps (opportunity candidates)

- **Row 10 confidence calibration**: no benchmark checks whether a 0.9-confidence judgment is right 90% of the time. Lore's judges and autonomy decisions both emit a confidence, so this is a direct, unserved need.
- **Row 11 decision-level outcome attribution**: everyone attributes outcomes to code changes or PRs; nobody attributes them to an individual AI decision (approve, claim, autonomy verdict).
- **Row 13 concurrency effectiveness**: many-concurrent-agent development is Lore's north star; no benchmark measures conflict, lost-race or queue-wait rates.
- **Row 15 false-deny rate of governance checks**: denial counts exist, but no one measures how often a check blocks correct work (e.g. `subagent-stop-commit-guard` denies 56% of its runs).
- **Rows 24–25 knowledge reuse and spec stability**: specific to a corpus-as-coordination design.

## Evidence ledger

| Claim | Tier | Source |
|---|---|---|
| DORA five metrics, definitions, rework rate added 2024, MTTR rename 2023 | B2 | https://dora.dev/guides/dora-metrics/ , https://dora.dev/guides/dora-metrics/history/ |
| Four Keys pipeline, tables, SQL, no alerting, archived 2024-01-23 | B2 | https://github.com/dora-team/fourkeys , METRICS.md |
| 2024 performance tiers | B4 | https://octopus.com/blog/2024-devops-performance-clusters |
| SPACE dimensions, ≥3 dimensions, ≥1 perceptual, aggregate not individual | B2 content | CACM 64(6) reprint PDF (people.uncw.edu course copy) |
| DORA pitfalls (Goodhart, one metric, cross-team comparison) | B2 | https://dora.dev/guides/dora-metrics/ |
| AI adoption: throughput −1.5%, stability −7.2% (2024); stability still negative (2025) | B2 | cloud.google.com DORA 2024 and 2025 announcement posts |
| Langfuse score model, source field, annotation queues, Score Analytics κ/F1, alerts | B2 | langfuse.com/docs/evaluation/... , /docs/observability/features/alerts |
| LangSmith rule sampling_rate → queue, align evaluator, few-shot corrections | B2 | docs.langchain.com/langsmith/rules , /improve-judge-evaluator-feedback , /create-few-shot-evaluators |
| Braintrust blind multi-reviewer human review | B2 | https://www.braintrust.dev/docs/annotate/human-review |
| No Brier/ECE/reliability calibration in any of the three | B2 (absence in docs read) | as above |
| Claude Code OTel metrics/events/attributes, PR attribution method | B2 | https://code.claude.com/docs/en/monitoring-usage , /analytics , /costs |
| Copilot usage metrics names | B2 | https://docs.github.com/en/copilot/reference/copilot-usage-metrics/copilot-usage-metrics |
| LinearB AI Insights, Rework Rate, Cost Per Effective PR | B2 | linearb.helpdocs.io AI Insights / AI ROI pages |
| Lore's own data (2026 judgments, 1209 calibration rows ~94% agent, 125/127 overrides without reason, 59/59 task rejects overridden, 56% deny on subagent-stop-commit-guard) | B1 | sqlite3 over `.lore/lore.db`, 2026-10-25; issues #406–#409 |

## Coverage gaps

- No benchmark was used hands-on; all rows are docs-derived.
- DORA's own 2024 tier table, its 2025 team profiles and AI capability names: unverified.
- Langfuse rule-based sampling into annotation queues and Score Analytics tier: unverified. Braintrust queueing and metrics API: unverified. LangSmith compare view details: search summary only.
- LinearB rework detection method and retention: undocumented. Jellyfish: no official docs, not covered.
