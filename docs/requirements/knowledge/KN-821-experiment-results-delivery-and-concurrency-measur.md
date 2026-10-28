---
id: KN-821
type: knowledge
role: knowledge
title: "Experiment results: delivery and concurrency measures (O3-S1, O4-S1, O4-S3)"
status: draft
priority: medium
created: 2026-10-26
updated: 2026-10-26
tags: [evaluation, experiment, o3]
links:
  - {id: PLAN-256, type: informs}
  - {id: SPEC-253, type: informs}
---
## Summary

Read-only run of O3-S1, O4-S1 and O4-S3 on 2026-10-26 (window 2026-09-26T01:52Z to 2026-10-26T01:52Z, main at e5c9a8c3). Read only: `sqlite3 -readonly .lore/lore.db`, `.lore/integrate-attempts/*.json`, `git log main`, `lore issues`, `gh issue list`. Analysis scripts: scratchpad `o3/a.py` (ledger), `b.py` (git landings), `c.py` (claims, runs, issues).

| Row | Measured | Trigger | Fired path |
|---|---|---|---|
| O3-S1 | 3 of 5 measures cannot be computed without manual labelling (change_fail_rate, recovery_median, rework_rate) | any of 5 needs manual labelling | Path B: stop and re-review (S-C revised for those measures before the delivery task is claimed) |
| O4-S1 | started_at 237/237 = 100%; per-step exit codes 220/237 = 92.8%; max 7 attempts per branch | none (report only) | No branch. BR-1419 / AC-DC-7 retention work proceeds as specified |
| O4-S3 | 31 hourly observations, r = 0.66 (informational) | needs >= 50 observations | Fewer than 50: no decision, re-measure at the eight-week review |

## Data facts (verified)

- Attempt ledger: 164 files (the brief said about 158), 237 attempts, 2026-10-19T07:58Z to 2026-10-25T14:04Z (6.3 days). Outcomes: landed 166, floor_failed 33, lost_race 21, conflict 16, snapshot_migrate_failed 1. Command: `python3 -I a.py` over `.lore/integrate-attempts/*.json`.
- runs: `select count(*), sum(ended_at is null), sum(session_ref like '%test-session-%') from runs` gives 783 rows (781 when first queried, the table grows), 125 never ended. Test pollution (issue #411): 81 rows with `session_ref like '%test-session-%'` (stored without the `cc:` prefix, so the pattern `cc:test-session-%` matches 0 rows). All 81 never ended, registered 2026-10-19T16:41Z to 2026-10-25T13:01Z (brief said 72). Excluded below. Real runs: 702, never ended 46 (23 have an attributed write in audit or versions `harness_run`, 23 wrote nothing).
- decision_log: 643 rows, 2026-10-18 to 2026-10-26.

## O3-S1: the five delivery measures, last 30 days

Window facts: 710 tasks first reached status archived in the window (`select min(created_at) from versions where status='archived' group by doc_id`).

1. delivery.lead_time_median (mechanical, no label). First claim = `min(audit.timestamp) where action='claim' and doc_id=task` (claims exist since 2026-07-06). 683 tasks claimed and completed, 27 completed without a claim (excluded and counted). No claim after its archive. Median 0.30 h (mean 2.99 h, p90 1.49 h, max 150.5 h; 10 above 24 h). Caveat: 9 of the 710 archive versions are action `delete`, not a completion; the rule needs to state whether they count. Not a manual label, a definition to pin.
2. delivery.landings_per_day (mechanical). `git log main --first-parent --since=... --format=%H|%cI|%s`, subject `^merge\(`: 614 first-parent landings (650 merge commits match the pattern, 36 are side merges inside integration branches, so the spec must say first-parent). Per UTC day: 10-07 55, 10-08 26, 10-09 3, 10-10 43, 10-11 46, 10-12 38, 10-15 31, 10-16 51, 10-17 32, 10-18 90, 10-19 112, 10-20 27, 10-23 46, 10-24 8, 10-25 6; the other 16 days have none (the first merge in the window is 10-07). Check against the ledger: all 166 ledger landings (162 distinct branches) have a first-parent `merge(<branch>)` commit, so the git source is complete for the ledger's span. The ledger alone would show 166 landings in 5 days (10-19 79, 10-20 27, 10-23 46, 10-24 8, 10-25 6) against git's 614 in 15 days, confirming C-D13. False positives of the pattern: 2 first-parent subjects `merge(main...)` (hand merges), 0.3%.
3. delivery.change_fail_rate: NOT computable. No local main-red record exists: `recordMainRed(` is not in the source, no table holds one (`.tables`), and the 104 milestone-review knowledge docs carry no structured commit range or green time (`extra like '%commit_range%'` matches 35 docs, all prose such as "none recorded a commit range"). Their regression dimension: 55 fail, 49 pass, all plan-level. A figure for this window would need a person to read GitHub issues and decide which landing each red belongs to.
4. delivery.recovery_median: NOT computable for the same reason, plus no recorded green time anywhere.
5. delivery.rework_rate: NOT computable. `select count(*) from links where link_type='resolves'` is 0 (the type is allowed, nothing writes it). Issues tie to docs through `extra.issues` on 127 tasks and 14 plans, which are issue carriers, not tasks that resolve an issue. GitHub holds 438 issues filed in the window (`gh issue list -R daniel1zz/lore --state all --json number,createdAt,body`), 134 naming a repo file path in the body, but which completed task fixed which issue is only recoverable by hand. By the spec's definition the figure is a vacuous 0 of 710.

Fired path: trigger met (3 of 5 need a manual label for this window). Path B, stop and re-review. Note for the reviewer: the cause is that the S-C recorders (BR-1412 main-red record with commit range and green time, a `resolves` write on task completion) are the delivery task's own deliverables and do not exist yet, so the measures become mechanical for windows after they land. The pre-registered rule does not carve that out, so I record it as fired and leave the call to the orchestrator.

## O4-S1: ledger completeness

`python3 -I a.py`. Per attempt: started_at present 237/237 (100%). Per-step exit codes (`floor.steps[*].exit`) present 220/237 (92.8%): floor_failed 33/33, landed 166/166, lost_race 21/21, conflict 0/16, snapshot_migrate_failed 0/1. The 17 gaps are attempts that ended before the floor ran, so the field is structurally empty there, not lost. Both fields together: 220/237. Both readings clear the 80% trigger. Records per branch: max 7, mean 1.45, 0 of 164 files near the 20-per-branch bound, so the bound has not truncated anything yet. Schema version is 1 in all 164 files. No branch: the concurrency task still adds 30-day retention and complete records.

## O4-S3: live runs vs conflict + lost-race share

Live run = real run (test-session excluded), live from registered_at to ended_at; never-ended runs live until the last attributed write (max of `audit.timestamp` and `versions.created_at` where `harness_run` = run id) or their start. Hourly observation = a UTC hour with at least 1 ledger attempt (the share is undefined otherwise).

- Observations: 31 hours (of a 152-hour ledger span). Below the 50 needed.
- Pearson r = 0.66, Spearman 0.70 (31 hours); 0.73 over the 23 hours with at least 3 attempts. Live runs in those hours: median 11, max 30.
- Overall shares: conflict 16/237 = 6.8%, lost_race 21/237 = 8.9%, together 15.6%.
- Pre-registered result: fewer than 50 observations, no decision, re-measure at the eight-week review.
- Outside the branch, for the record only: if empty hours were scored 0 (152 hours), r = 0.65. The trigger text does not say whether empty hours are observations; this reading would reach 50 and exceed 0.3. Not used, because a share over zero attempts is not an observation. The reviewer should fix the definition before the eight-week re-measure. The ledger spans 6 days, so the sample is one busy stretch; autocorrelated hours also overstate the effective sample size.
- Parallelism over the last 720 hours (real runs): median 0 over all hours (351 hours with at least one live run), median 4 over those, max 31. Including the test-session rows would change 8 hours and raise the max to 32.

## Anything outside every pre-registered branch

1. The O4-S3 empty-hour reading above.
2. O3-S1: whether "needs manual labelling" applies when the missing input is a recorder the plan itself builds.
3. Pattern `/^merge\(/` also matches side merges (36) and 2 hand merges; AC-DC-1 should state first-parent.
4. Test-session pattern: stored `session_ref` has no `cc:` prefix.
