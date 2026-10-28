---
id: PLAN-256
type: plan
role: plan
title: "Evaluation 1: experiments and honest metric envelope"
status: approved
priority: medium
created: 2026-10-25
updated: 2026-10-26
tags: [evaluation, metrics]
parent: SPEC-238
phases:
  - {name: "Experiments", description: "OST experiments on existing .lore data; each records which pre-registered branch fired"}
  - {name: "Honesty", description: "O1: metric envelope, origin, telemetry baseline (#409), test runs out of the repo corpus (#411)"}
---
## Goal

Run the OST experiments on the existing `.lore` data (D9: no separate validate run), then land the honest metric envelope and `lore metrics` command (OST O1) so every later metric is printed through it. First of five plans of the evaluation initiative, one per spec (task evidence and `lore verify` resolve criteria through the plan's single parent spec). Order is carried only by task-level `blocks` links on real dependencies: every metric task waits for this plan's envelope task and its experiment; plans 2, 3 and 4 then run in parallel (plan 4's check-outcome task waits for plan 2's audit task because both add a store migration); plan 5 comes last. There is no hard link from plan 2 to plan 3.

Upstream: OST `knowledge-evaluation-questions-answerable-from-honest-machine`; staged requirements `knowledge-evaluation-system-staged-prd-requirements`; spec `spec-evaluation-metric-envelope-and-honest-origins`.

## Preconditions

- The five evaluation specs approved (S4). The staged requirements R-29..R-50 added to the root PRD at S4.
- Phase 1 tasks read the repo corpus read-only (sqlite3 read-only connection or `lore` read commands); they never write to `.lore/` other than their own research knowledge doc.

## Phases

1. **Experiments** — each OST experiment run on existing data; each writes its measured value and which pre-registered branch fired into one research knowledge doc (`lore create knowledge --sub-type research`) linked `informs` to this plan.
2. **Honesty (O1)** — metric envelope and command, origin, telemetry baseline (#409), test runs out of the repo corpus (#411).

## Tasks

| Task | Phase | Covers |
|---|---|---|
| Experiment: honesty (O1-S1, O1-S2, O1-S3) | Experiments | — (closed by `lore evidence --capture` of `lore get <research doc>` plus a no-new-tests declaration) |
| Experiment: AI decisions (O2-S1 reversal-detection coverage, O2-S3 AUC per AI judge, O2-S2 in-session audit cost) | Experiments | — (same route) |
| Experiment: delivery and concurrency (O3-S1, O4-S1, O4-S3) | Experiments | — (same route) |
| Experiment: overhead, cost, reuse, safety (O5-S1/S3, O6-S1, O7-S1, O8-S2) | Experiments | — (same route) |
| Metric envelope, eleven-question registry and lore metrics command | Honesty | AC-EM-1, AC-EM-3, AC-EM-4 |
| Origin from the attributed party (#406), plus the one-time test-run repair (A-D17) | Honesty | AC-EM-2, AC-EM-7 |
| Telemetry rules and current values match opt-in (#409) | Honesty | AC-EM-5 |
| Test runs never reach the checkout's own corpus (#411) | Honesty | AC-EM-6 |

Registry design implementers follow: the envelope task creates `packages/lore/src/service/metrics/questions.ts` (the ordered A–K list) and one module per question, `packages/lore/src/service/metrics/questions/a.ts` … `k.ts`, each registering no metric until its slice lands, so the question is listed unanswered with reason "no metric registered" (A-D12, AC-EM-4). Later tasks edit only their question module, so their file anchors do not overlap and they can run in parallel.

## After landing (main agent)

`lore integrate` each branch; `lore done <task>`; `lore verify <plan>` for the script-bound criteria; `lore rule apply spec-evaluation-metric-envelope-and-honest-origins` once every citing criterion has an attested pass; at plan end `lore assess`.

## Decisions Log

Pre-registered branches (fixed before any experiment runs; the experiment task records which one fired and the named path is followed without a new decision). A branch never weakens a criterion or adds a fallback: where path B would need different behaviour it is marked **stop and re-review** (O1-S2, O1-S3, O2-S2 audit cost, O3-S1), so the named plan stops and the spec is revised, reviewed and approved again before any of its tasks is claimed.

| Experiment | Trigger (kill condition) | Path A — trigger not met | Path B — trigger met |
|---|---|---|---|
| O1-S1 origin | > 5% of the comparison rows have an undecidable origin | Legacy rows classified from their resolved party on read; new rows store origin at write | Same write-time field; legacy rows read as unknown (AC-EM-2 unchanged); the share is printed in the origin task's evidence |
| O1-S2 envelope | Computing all 11 questions on the current DB fails to flag #409 (telemetry off) or #411 (test runs) | Proceed to phase 2 | **Stop and re-review:** reopen S-A before any phase-2 task is claimed |
| O1-S3 #411 | Root cause not located within the experiment task | Fix at the located write site (BR-1386) | **Stop and re-review:** no filter and no known-defect close; plan 1 stops and S-A is re-reviewed with what the experiment found |
| O2-S1 reversal detection | Fewer than 3 of the 4 after-event kinds (reopen/set-back, revert, issue naming it, local main-red) produced at least one event in the last 90 days | Plan 2 proceeds | Plan 2's scoring task still lands (criteria unchanged) but question A is reported with the missing kinds named in its reason; plan 3 (already independent) is worked first |
| O2-S2 audit cost | Median > 3 min per audited judgment, or "cannot tell" > 25% | Audit unit = one judgment | **Stop and re-review:** audit unit becomes one criterion of a judgment; S-B revised before its audit tasks are claimed |
| O2-S2 completion (D10) | Audit completion < 50% over 4 full weeks after the audit task lands | Audit continues | Built in (BR-1410): audit stops, question A rests on machine outcomes only; no spec change |
| O2-S3 AUC (corrected 2026-10-25) | Measured once over AI-judge rows only (judge_provider not deterministic-checks; BR-1422), per document type and instruction version with ≥ 10 per class and the DeLong 95% lower bound; single class → no result | A judge's lower bound ≥ 0.65: keep it | A judge's lower bound < 0.65: open a spec on the review branch for that judge. The earlier #408 premise (task judge never confirmed) is withdrawn: its 62 rows were deterministic pre-check verdicts |
| O2-S4 reasons | > 50% of the first 20 override notes after the override task lands are boilerplate | Free-text note kept | New spec: a structured reason form (owned by the eight-week review task) |
| O3-S1 DORA | Any of the five measures needs manual labelling | Delivery task as specified | **Stop and re-review:** S-C revised for that measure before its task is claimed |
| O4-S1 ledger | Share of attempt records carrying started_at and step exit codes (measured for the record) | — | No branch: the concurrency task always adds 30-day retention and complete records (successor spec-delivery-concurrency-and-autonomy-metrics-fed-by-live BR-1450, AC-DC-7; S-C's BR-1419 is superseded); the experiment only reports the starting point |
| O4-S3 throttle | With ≥ 50 hourly observations, correlation of live runs with conflict + lost-race share r ≥ 0.3 | No throttling | New spec for automatic throttling; with < 50 observations: no decision, re-measured at the eight-week review |
| O5-S1 capture | The check outcome record has no actor/subject (schema read 2026-10-25: confirmed) | — | Capture added by the check-outcome task (already planned) |
| O5-S3 retry estimate | The existing refusal-then-success estimate already separates false denials | — | Not expected (it ignores subject and content); BR-488 is retired either way (S-D) |
| O6-S1 tokens | Session records lack per-request usage fields, or their session ids join no run (unjoinable) | Token task as specified | H reports no_data naming the cause; R-42 assessed as a failed bet; AC-GV-3 still passes (fixture + no_data) |
| O7-S1 reuse | < 10% of served documents are ever linkable | Reuse metric as specified | Reported, marked weak in its reason; the never-read count (BR-482) is shown beside it |
| O8-S2 incidents | — | — | Experiment output only (K ships one metric: reversed automatic decisions) |
| D6 gate | An audited question-A metric first passes eligibility | Report only | New spec wiring that metric into the named decision (owned by the eight-week review task) |
| Initiative kill | 8 weeks after baselines: no red/yellow metric led to a task or issue naming it, or audit completion < 50% | Continue | Pause the initiative (staged requirements doc, kill criterion) |

Fired 2026-10-26: O1-S2 path B (the envelope fields did not flag #411's 81 test runs). S-A was reopened and revised (A-D17, BR-1455, AC-EM-7: an audited one-time repair ends them with origin unknown, revised in S3 round 2); the #411 task now blocks the origin task. O3-S1 path B: S-C superseded by spec-delivery-concurrency-and-autonomy-metrics-fed-by-live (plan-evaluation-3b). O2-S3: spec-retired-judge-instruction-versions-stay-in-calibration.

Other decisions: one plan per spec, not one plan for the initiative (a plan has one parent spec; task evidence must name a criterion on it — `task-workflow-service.ts:2982`), rejected alternative: one plan whose tasks for S-B..S-E could never record criterion-bound evidence.
