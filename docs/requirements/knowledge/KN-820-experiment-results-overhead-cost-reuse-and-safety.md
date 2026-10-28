---
id: KN-820
type: knowledge
role: knowledge
title: "Experiment results: overhead, cost, reuse and safety sources (O5, O6, O7, O8)"
status: draft
priority: medium
created: 2026-10-26
updated: 2026-10-26
tags: [evaluation, experiment, o5]
links:
  - {id: PLAN-256, type: informs}
---
# Experiment results O5-S1/S3, O6-S1, O7-S1, O8-S2

Run 2026-10-26, read-only, against the live corpus DB (`sqlite3 -readonly /Users/apple/Projects/zz/lore/.lore/lore.db`), `lore trace stats --json`, `lore issues --all --json`, and the harness session files under `~/.claude/projects/` (field names, counts and join rates only; no transcript content copied). Branch `worktree-agent-ad89f3c3a54f2c58f`. Governing table: plan-evaluation-1 Decisions Log rows O5-S1, O5-S3, O6-S1, O7-S1, O8-S2.

## Summary

| Row | Measured | Pre-registered trigger | Fired path |
|---|---|---|---|
| O5-S1 | `check_outcomes` columns: id, check_id, outcome, ts. No actor, no subject. | record has no actor/subject | Trigger met: capture added by the check-outcome task |
| O5-S3 | Existing estimate: 1711 denies, 171 followed by a same-actor success (10.0%); `review-judgment` 1351 denies, 0 retried | estimate already separates false denials | Branch not fired (as expected); BR-488 retired either way |
| O6-S1 | Usage fields present on 135612/135612 assistant records; 659/659 subagent runs join by agent id; 24/43 real main sessions join by session id | fields missing or ids join no run | Not fired: token task as specified. R-42's bet survives, with two caveats below |
| O7-S1 | 19.3% (44/228) of served (event, doc) pairs are linkable by the same actor; 3.5% for links alone | < 10% | Not fired on the headline: reuse metric as specified. Fragile, see caveat |
| O8-S2 | 4 incidents by declared category (data-loss, data-integrity), 5 by the wider title reading | no trigger | Experiment output only; 4 and 5 are both at or above 3 |

## O5-S1: check outcome record

Query: `.schema check_outcomes`. Result: `id INTEGER PK, check_id TEXT, outcome TEXT CHECK in (pass,deny,error), ts TEXT`, index on (check_id, ts). Confirmed: no actor, no subject, no run.

Sizes: `select count(*),min(ts),max(ts) from check_outcomes` gives 14980 rows, 2026-10-23T09:30:33Z to 2026-10-26T01:52:00Z.

Guard rows named in the brief: `select check_id,outcome,count(*) from check_outcomes group by 1,2` gives `hook:subagent-stop-commit-guard` deny 512, pass 398 (910 total, 56.3% deny). Correction to the brief: these rows are dated 2026-10-23 (deny 440, pass 309) and 2026-10-24 (deny 72, pass 89), none on 2026-10-25 (`select substr(ts,1,10),outcome,count(*) ... where check_id='hook:subagent-stop-commit-guard' group by 1,2`). Because the record has no actor or subject, whether a deny was false cannot be read from it.

## O5-S3: existing refusal-then-success estimate (BR-488 comparison point)

Command: `lore trace stats --json`, key `deny_retry_gap` (computed in `packages/lore/src/service/trace-stats-service.ts` `computeDenyRetryGap`, keyed by checkpoint and actor). Source is `trace_events` kind `gate_deny` (1711 rows), not `check_outcomes`.

| checkpoint | denies | retried_success |
|---|---|---|
| review-judgment | 1351 | 0 |
| plan-close | 123 | 122 |
| task-create | 71 | 0 |
| spec-create | 59 | 10 |
| record-edit | 54 | 0 |
| task-claim | 40 | 29 |
| spec-promote | 7 | 7 |
| plan-promote | 6 | 3 |
| total | 1711 | 171 (10.0%) |

Reading: the estimate groups by checkpoint and actor only. It cannot say whether a deny was wrong, because it ignores subject and content. The plan-close row (122/123) is the artifact BR-488 already names: an archive action no write records, so only approvals count. The review-judgment row (0/1351) says nothing either way. Branch "estimate already separates false denials": not fired.

## O6-S1: token usage from harness session records

Method: Python scan of `~/.claude/projects/` directories whose name contains `Projects-zz-lore` (7 directories), top-level `<session>.jsonl` plus `<session>/subagents/agent-<id>.jsonl`; joined to `runs`.

Counts:
- Top-level session files: 50. Subagent files: 1024 (1021 distinct agent ids). Total 1074.
- Record types seen: assistant 135612, user 81980, attachment 405011, api-request 41477, api-request-blob 71036, cost-state 56, others.
- Assistant records carrying `message.usage`: 135612 of 135612 (100%); files with usage: 1074 of 1074.
- `usage` keys and counts: input_tokens, cache_creation_input_tokens, cache_read_input_tokens, output_tokens, service_tier, cache_creation, inference_geo (each 135612); speed 114378; output_tokens_details, server_tool_use, iterations, fallback_credit (each 87554).
- Caveat 1: records repeat. Distinct `message.id` 66182 of 135612 records; 69430 records repeat an earlier id. A sum over records double counts; the token task must dedupe by message id.
- Join, subagent runs: `runs.agent_ref` matches a `subagents/agent-<id>.jsonl` file name for 659 of 659 subagent runs (100%). The first record's `sessionId` equals the parent session directory in 1024 of 1024 files.
- Join, main runs: `runs.session_ref` (and `cc:<session>`) matches a top-level file for 24 of 124 main runs (19%). Of the 124, 81 have `test-session-*` references (test fixtures, issue #411); of the other 43, 24 join (56%). Distinct `session_ref` values 123, with a file 24.
- All runs: 683 of 783 join (87%); the 100 that do not are all main runs.
- Caveat 2: only 50 top-level files exist for 123 distinct session refs (the 43 non-fixture sessions: 24 have files; 19 do not). Earliest file mtime 2026-10-10, earliest run 2026-10-11, so retention is not the obvious cause of the 19; not investigated further. The token metric must report the unjoined share and say "no usage record" for those runs.

Fired path: the trigger (fields missing, or ids join no run) did not fire. Token task as specified. R-42's bet (the harness's local session records can supply per-request usage joined to runs) survived.

## O7-S1: reuse of served documents

Sources: `trace_events` kind `feed` (431 events; `details.docs_served` slugs resolved through `docs.slug`), kind `search` (1059 events), `audit` actions `link` and `anchors`, `links`, `ac_cites`. Script held in the session scratchpad, queries equivalent to: served pair = (feed event, doc in docs_served); linkable = same actor has a later audit `link` (doc as from or `details.to_id`) or `anchors` row on that doc.

Findings:
- Only feed records name documents. 228 of 431 feed events served at least one doc, giving 228 (event, doc) pairs over 181 distinct docs and 128 actors. All 228 slugs resolved.
- Search events record only the query and hit count; 2 of 1059 mention a doc in details. Search-served documents cannot be joined.
- `trace_events.session_id` is the constant `trace-feed` or `trace-search`; there is no run id. The brief says "by the same run"; the only possible key is `actor`. `audit.harness_run` is set on 21980 of 76491 rows (28.7%), 3123 of 5598 for link and anchors, so a same-run join is not available on the trace side.
- Linkable pairs: 44 of 228 = 19.3% (any later time); 43 (18.9%) within 24 h; 41 (18.0%) within 4 h. Distinct docs: 31 of 181 = 17.1%.
- Caveat 3: 36 of the 44 are `anchors` writes by the actor on the same task document that task-start served to it; 8 are `link` writes. Links alone: 8/228 = 3.5%, below 10%. The headline 19.3% is mostly the actor editing its own task.
- Citations: `ac_cites` has no actor or timestamp, so a cited-by-same-run join is impossible; 1 served doc is cited by any AC.
- Never-read count (BR-482 pairing): of 3243 live docs, 3062 were never served by a feed event.

Fired path: trigger (< 10%) not fired on the headline: reuse metric as specified. Outside the branch: the headline holds only because of own-task anchors; under the stricter reading (links only) the trigger would fire. The spec task should choose its linkable definition explicitly and show the never-read count beside it.

## O8-S2: corpus or data-loss incident issues

Command: `lore issues --all --json` (456 issues in daniel1zz/lore; severity: medium 245, low 115, high 84, critical 12).

- By declared category `data-loss` or `data-integrity`: 4 issues: #189 (critical, closed), #222 (high, closed), #115 (medium, closed), #279 (high, open).
- Wider title reading (adds a shared mirror overwritten outside any lease, open): 5.
- The category `migrated-from-local-corpus` (22) is a migration label, not an incident class, and was excluded.

Threshold 3: met under both readings. The plan row names no branch; this is experiment output only (K ships one metric: reversed automatic decisions).

## Notes for the metric work

- Question K overlaps question A (issue #415): noted, no redesign here.
- Everything outside a pre-registered branch: (1) the 2026-10-25 date for the commit-guard denies is 2026-10-23/24; (2) the O7 headline versus link-only split; (3) 19 non-fixture main sessions without a local file.
