---
id: KN-822
type: knowledge
role: knowledge
title: "Experiment O1: honesty of the evaluation data"
status: draft
priority: medium
created: 2026-10-26
updated: 2026-10-26
tags: [evaluation, experiment, o1]
links:
  - {id: PLAN-256, type: informs}
---
## Summary

Read-only experiments O1-S1, O1-S2, O1-S3 for plan-evaluation-1-experiments-and-honest-metric-envelope, run 2026-10-26 on `/Users/apple/Projects/zz/lore/.lore/lore.db` (`sqlite3 -readonly`) and by reading code. No test was run, no repo file edited.

| Row | Measured | Trigger | Fired path |
|---|---|---|---|
| O1-S1 origin | 981 of 1225 comparison rows (80.1%) have no resolved run, and no human session is registered | > 5% | **Path B** (same write-time field; legacy rows read as unknown; the share is printed in the origin task's evidence) |
| O1-S2 envelope | #409 flagged; #411 NOT flagged by the five envelope fields (only by an extra session_ref census) | fails to flag #409 or #411 | **Path B by the literal trigger** (stop and re-review, reopen S-A). See "Outside the branches" |
| O1-S3 #411 | Write site located by reading code | not located | **Path A** (fix at the located write site, BR-1386), with one open concern: the existing guard does not stop the leak |

## O1-S1 origin of every comparison record

Comparison record = one `calibration_records` row (the human-vs-AI comparison written on approve/reject). Its resolved party is the audit entry of the same approve/reject (same doc, within 2 s of the row); that entry's `harness_run` is the attested run, looked up in `runs`.

Query (saved at /private/tmp/claude-501/-Users-apple-Projects-zz-lore/7903287b-1b2f-461b-a942-ac74a6a2a0c1/scratchpad/o1s1.sql):

```sql
with p as (
  select c.id as cid, c.actor as cactor, a.id as aid, a.harness_run as hr, a.session_id as sid,
    abs(julianday(a.timestamp) - julianday(c.created_at)) * 86400 as dt
  from calibration_records c
  left join audit a on a.doc_id = c.doc_id and a.action in ('approve','reject')
    and abs(julianday(a.timestamp) - julianday(c.created_at)) * 86400 < 2
), j as (select cid, cactor, hr, sid, aid, min(dt) as dt from p group by cid)
select case
    when aid is null then 'unmatched_audit'
    when hr is not null and hr <> '' and exists (select 1 from runs r where r.id = j.hr) then 'harness_run_resolved'
    when hr is not null and hr <> '' then 'harness_run_unresolved'
    when cactor like 'agent:%' then 'no_run_agent_named'
    else 'no_run_human_named' end as klass, count(*) from j group by 1 order by 2 desc;
```

Result (sums to `select count(*) from calibration_records` = 1225; every row matched an audit entry, 0 unmatched):

| Class | Rows | Share |
|---|---|---|
| harness run (resolves in `runs`; 17 main + 4 subagent distinct runs) | 244 | 19.9% |
| human session | 0 | 0% (`select count(*) from sessions` = 0, no human session was ever registered) |
| none, actor named `agent:*` (written before runs were attested) | 934 | 76.2% |
| none, actor named a person (daniel 21, apple 25, claude-main 1; session_id `review-...`) | 47 | 3.8% |

Undecidable (no resolved run) = 934 + 47 = 981 of 1225 = **80.1%**, trigger 5%: fired. Per BR-1055 a name cannot decide the origin, so the 47 person-named rows stay undecidable; even if they were counted as decided the share is 934/1225 = 76.2%.

Window check: the `runs` table starts 2026-10-11T11:43:20Z (`select min(registered_at) from runs`). Of the 337 rows created on or after that, 93 (27.6%) still have no resolved run (`created_at >= '2026-10-11T11:43:20'` with the same join). So the share is above 5% even in the attested era.

Fired path: **B**. Same write-time origin field; legacy rows read as `unknown` (AC-EM-2 unchanged); print 80.1% (981/1225) in the origin task's evidence.

## O1-S2 eleven questions A-K from the current DB

Question names from `knowledge-evaluation-system-staged-prd-requirements` R-29. Envelope fields: sample size (n), window, newest fact, origin, status (nominal minimum 20; baseline not recorded for any, so no question reaches "answered").

| Q | Source and query | n | Window | Newest fact | Origin | Status |
|---|---|---|---|---|---|---|
| A AI decision quality | `calibration_records`; AI judge rows `review_judgments where judge_provider<>'deterministic-checks'` = 1969 (claude-cli), deterministic-checks = 98 reported separately (BR-1422) | 1225 comparisons | 2026-07-06..2026-10-25 | 2026-10-25T12:30:27Z | agent 244, unknown 981, human 0 (O1-S1) | ok (n), unanswered (no baseline) |
| B delivery efficiency | `audit where action in ('claim','evidence')` | 1851 claims, 9684 evidence | 2026-07-06..2026-10-26 | 2026-10-26T01:52Z | by harness_run: 21976 of 76487 audit rows carry one | ok (n), no baseline |
| C delivery quality | `check_outcomes` | 14980 | 2026-10-23..2026-10-26 (3 days) | 2026-10-26T01:52Z | machine_event (no party) | ok (n), window 3 days |
| D concurrency | `runs`; open runs `ended_at is null` | 783 runs, 127 open | 2026-10-11..2026-10-26 | 2026-10-26T01:53Z | agent for all | ok (n); includes 81 test runs (see #411) |
| E unattended autonomy | `decision_log` (channel machine 633, human-tty 10, agent-asserted 0), `pending_asks` 60 (9 used) | 643 | 2026-10-18..2026-10-26 | 2026-10-26T00:58Z | machine_event | ok (n), no baseline |
| F governance cost | `check_outcomes` (554 deny), `audit action='gate_passed'` 7225, telemetry file | 14980 / 7225 | 2026-10-23..2026-10-26 | 2026-10-26 | machine_event | telemetry part: no_data (see #409) |
| G corpus health | existing `lore eval` scenario results (R-47); no table in the DB holds them | not computed from the DB | n/a | n/a | n/a | not answerable from this DB read; reads `lore eval` |
| H cost | no column named token/cost/usd in any of 21 tables (`pragma_table_info` search) | 0 | n/a | n/a | n/a | no_data, cause source_absent |
| I knowledge reuse | `trace_events` | 3199 | 2026-07-28..2026-10-26 | 2026-10-26T01:52Z | by `actor` | ok (n); telemetry source off |
| J spec stability | `versions` of docs where type='spec' | 6892 | 2026-06-08..2026-10-25 | 2026-10-25T15:28Z | by `created_by` | ok (n) |
| K safety | `check_outcomes where outcome='deny'` | 554 | 2026-10-23..2026-10-25 | 2026-10-25T13:57Z | machine_event | ok (n), window 3 days |

Result: 10 of 11 produce all five envelope fields (G does not come from this DB, H is no_data source_absent); 0 of 11 are "answered" because no baseline is stored.

### #409 telemetry off: flagged

- `ls /Users/apple/Projects/zz/lore/.lore/telemetry.jsonl` fails (no file); `grep -n -i telemetry .lore/config.yaml` finds no key. The source behind F and I's telemetry counts is therefore switched off, which the envelope reports as no_data with cause `source_off` (A-D15).
- `lore get baseline-measure-corpus-usage` still says "Telemetry recording ... on" and BR-993/BR-1013 say "on (the default)". The envelope's cause field contradicts the baseline text, so #409 is surfaced.

### #411 test runs: not flagged by the envelope fields

- `select count(*), count(distinct session_ref) from runs where session_ref like 'test-session-%'` = 81 / 81, all `kind=main`, `harness=claude-code`, all `ended_at is null`; 0 appear as `harness_run` in `audit` (so no comparison is polluted).
- Of 127 open runs 81 are test runs (63.8%); without them 46. Question D's open-run count is inflated 2.76x.
- The five envelope fields do not show it: n = 783, window and newest fact come from real runs, and the origin of a test run is `agent` like a real one (it carries the same harness and attested id form). Only a `session_ref like 'test-session-%'` census shows it, and that census is a provenance filter, which A-D6 rejects as a metric mechanism.

## O1-S3 write site of the cc:test-session-* runs

Read in the worktree (same HEAD as main), nothing run.

1. Id form: `packages/lore/tests/unit/feed-resume-same-session.test.ts:131` builds `test-session-${Date.now()}-${random}` in `beforeEach`; lines 187, 208, 230, 269, 284, 307, 351, 372, 401 set `process.env["CLAUDE_CODE_SESSION_ID"] = testSessionId`, and each then passes `identity: liveInvocation().identity` (lines 194, 215, 240, ...) with `cwd: process.cwd()`.
2. Entry: `packages/lore/tests/live-invocation.ts` `identity` getter (about lines 46-49) reads `CLAUDE_CODE_SESSION_ID`, builds run `cc:<session>`, and calls `registerRunInCurrentCorpus(run)` -> `registerTestRun(process.cwd(), run)` (`packages/lore/tests/helpers/test-run-identity.ts`, last function).
3. Root: `findCorpusRoot` walks parent directories and, from a linked worktree, hops to the main checkout (`mainCheckoutOfLinkedWorktree`, reading the `.git` file's `gitdir:`), so a test in a worktree resolves the main checkout's `.lore/lore.db`.
4. Write: `registerRunInDb` (`test-run-identity.ts:149-161`) runs `INSERT OR IGNORE INTO runs (...)` with `harness='claude-code'`, `session_ref=<session>`, `registered_at=now`.
5. Match with the data: all 81 `test-session-%` rows have the `test-session-<epoch>-...` form (`session_ref like 'test-session-1%'` = 81) and none has the `test-session-read-` form of session-start-read.test.ts (0). They arrive in bursts of 9 within about 20 ms (e.g. 2026-10-23T07:44:28.325Z), nine runs of the file: 10-19 (1 burst), 10-20 (3), 10-23 (3), 10-25 (2). `routes.test.ts` and `rule-service.test.ts` only use the literal `test-session-id` as an actor field and do not register runs.

Open concern (not a branch): two guards already exist (`findCorpusRoot` refuses the hop when `LORE_TEST_SANDBOX_REPO` covers the directory; `registerRunInDb` returns false when the db is inside that repo). The armed env comes from `vitest.shared.ts` / `scripts/test-isolation-env.ts`. All 81 rows were registered after those guards were committed (38b92bb6, 2026-10-19T16:08:52Z; first leak 2026-10-19T16:41:47Z), so each leaking execution ran with the env unarmed or with the sandbox repo not covering the db. Which invocation that was is not determined by reading (it would need a run); the fix at the write site must therefore make `registerRunInDb` refuse the repo's own corpus without depending on the env, and AC-EM-6's clone test measures exactly that.

Fired path: **A** (root cause located: the write site and the entry that reaches it).

## Outside the branches

- O1-S2 trigger wording: "fails to flag #409 or #411". With the envelope fields only, #411 is not flagged (origin of a test run is `agent`, n and window look normal). Read literally this fires Path B (stop and re-review, reopen S-A). If the intent was that #411 is closed by the write-site fix (A-D6, O1-S3) and is not meant to be flagged by the envelope, the trigger cannot be met by design, since the spec rejects the only detection that works (a session_ref filter). The orchestrator must choose; this experiment records the literal reading.
- O1-S1 uses the audit entry of the same approve/reject as the "resolved run" (calibration rows carry no run column).
- G's value was not computed (lore eval was not run; it is outside the DB).
