---
id: KN-823
type: knowledge
role: knowledge
title: "Experiment O2: AI decision labels, AUC and audit cost"
status: draft
priority: medium
created: 2026-10-26
updated: 2026-10-26
tags: [evaluation, experiment, o2]
links:
  - {id: PLAN-256, type: informs}
  - {id: SPEC-248, type: informs}
---
# Experiment O2: AI decision labels, AUC and audit cost (O2-S1, O2-S3, O2-S2)

Task: task-experiment-ai-decision-labels-auc-and-audit-cost-o2-s1-o2. Plan: plan-evaluation-1-experiments-and-honest-metric-envelope. Feeds spec-ai-decision-correctness-outcome-attribution-and-audit. Read-only run on 2026-10-26 against the live corpus (`sqlite3 -readonly .lore/lore.db`, `gh issue list`, `git log`); no repo file edited, no test run. The analysis script is a throwaway (scratchpad o2.py); each figure's query is given below.

## Population and exclusions (BR-1422)

- review_judgments: 2067 rows, all kind=review. `select ... from review_judgments group by judge_provider`: 1969 AI-judge rows (claude-cli), 98 `deterministic-checks` rows (62 task, 25 knowledge, 10 adr, 1 spec). The 98 are excluded from every label, AUC and coverage figure below and reported only here.
- Calibration rows (`calibration_records` joined to `review_judgments`, grouped by actor prefix and deterministic flag): AI-judge rows: agent party 1116 (1048 confirmed, 68 overridden); human-named actors apple 25 confirmed, daniel 20 confirmed + 1 overridden (46); actor `claude` 1 overridden (party not decidable from the name). Deterministic rows: 62, all agent party, all overridden (matches the corrected #408 premise: those 62 are deterministic pre-check verdicts, not AI judgments). So about 96% of AI-judge calibration rows are agent party, 4% human-named; the two populations are reported separately and never pooled.
- All 1969 AI judgments were written by `ai:claude-cli:claude-cli:vN` (the judge itself); the human/agent split applies to the approving actor, not the judge.

## O2-S1 reversal-detection coverage (window 2026-07-28 to 2026-10-26, 90 days)

| after-event kind | events in window | query / source |
|---|---|---|
| reopen / set back from approved | 883 version rows on 307 docs (plus 37 audit `invalidate` rows) | `versions` with lag(status)='approved' and status in (draft,in-review), created_at >= 2026-07-28. Dominated by baseline (283+115 "Demoted to draft: ... edits approved content"), knowledge 128, spec 105. |
| revert | 8 revert-subject commits (11 if body-line matches count) | `git log --since=2026-07-28 -i --grep=^revert`, subject-starting-with-revert: 1ab75056, 67202eb3, 3181c7b5, 1381f5a4, 9fa69bbd, d45029c6, 42b48e66, 96c80c28 |
| issue naming the decision | 456 issues in window (GitHub intake only reaches back to 2026-08-25); 50 issue-after-judgment events name a judged document's slug within 30 days | `gh issue list --state all --search created:>=2026-07-28`, slug text match on title+body |
| local main-red record | 4 `main-red` task documents in window; no dedicated local main-red record store exists yet in this checkout (the spec builds it) | `docs` where title or slug like main-red (TASK-949, 975, 985 and one more) |

Kinds with at least one event: 4 of 4 (3 of 4 even if the main-red proxy is rejected, because that kind has no real store yet). Trigger: fewer than 3. Not met. Fired path: O2-S1 "Plan 2 proceeds".

Linked to a specific AI judgment within its 30-day horizon, only two kinds fired: set-back (587 event-judgment pairs on approve labels) and issue (50). Reverts and main-red tasks named no judged document's slug (0 pairs each). The raw-count trigger counts events in the window, as the task states; the linked figure is context for plan 2.

## O2-S3 AUC per AI judge (AI-judge rows only)

Labelling follows BR-1387/BR-1411 and B-D9, derived on read: horizon = judgment older than 30 days at 2026-10-26 (created <= 2026-09-26); approve reversed if a set-back, invalidate, issue naming its slug, revert naming its slug or main-red task naming its slug falls in (judgment, +30d], else stood; reject right if an approval of the same version later reversed in 30 days, or a later version was approved; wrong if the same-version approval stood 30 days; escalate not scored; reject without action unlabelled. y = 1 when the verdict matched (approve-stood, reject-right), score = stated confidence.

- AI rows 1969 = approve 1310 (210 reversed, 226 stood, 874 not yet past the 30-day horizon) + reject 450 (26 right, 0 wrong, 420 unlabelled inside the horizon, 4 unlabelled with no action) + escalate 209 (not scored).
- Eligible (approve + reject) 1760, labelled 462, coverage 462/1760 = 0.263. Labelled rows by judge version: v1 51, v2 411 (no v3+ row is old enough yet).
- Judges (doc type x instruction version) with labelled counts: adr v2 28 (21/7), knowledge v1 43 (43/0), knowledge v2 53 (52/1), plan v2 39 (32/7), prd v2 1, spec v1 8, spec v2 282 (88 y=1, 194 y=0), task v2 8. Single class: knowledge v1, prd v2, spec v1, task v2: no result. Below 10 per class: adr v2, knowledge v2, plan v2: not computed.
- Only one judge reaches 10 labelled per class: spec v2. AUC 0.406, SE 0.038, DeLong 95% lower bound 0.333, against 0.65: below.
- Sensitivity (not the pre-registered unit): the set-back kind dominates the events (587 of 637) because ordinary edits to an approved spec demote it to draft, and the literal BR-1387 reading counts that as a reopen. With set-back removed (issue/revert/main-red only), spec v2 approves: 269 labelled, 245 stood, 24 reversed, AUC 0.582, lower bound 0.486: still below 0.65. Mean confidence of matched vs unmatched spec v2 verdicts: 0.768 vs 0.783 (no separation).

Fired path: O2-S3 "A judge's lower bound < 0.65": open a spec on the review branch for that judge (spec v2). The pre-registered branch fires under both the literal and the strict labelling; no criterion was weakened. Caveat for the spec author: the literal labelling is confounded by edit-demotions, so the label definition (B-D9/BR-1387 "set back from approved") deserves review in that spec. The earlier #408 task-judge premise stays withdrawn.

## O2-S2 in-session audit cost

Not run. The audit is the in-session ask (D10): one sampled judgment attached to an ask put to a person present in the session. This experiment ran as an unattended subagent with no human present and no `lore pending --ask` answered by a person; simulating a human would invalidate the measure. Minutes per item: no value. Cannot-tell share: no value. Fired path: none (neither the audit-cost branch nor the completion branch has input). The row stays open until an in-session ask occurs.

## Outside every pre-registered branch

- O2-S2 produced no measurement (a "not run" the task allows).
- O2-S3 left 3 judges below the 10-per-class floor and 4 single-class: only one judge could be measured. Coverage of 0.263 is low because 874 approve and 420 reject judgments are still inside their 30-day horizon.
- The O2-S1 "local main-red record" has no store yet; the proxy is the 4 main-red task documents.
