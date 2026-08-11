---
id: TASK-457
type: task
role: plan
title: "IC spec: discharge the startup-write contention gap AC-IC-1/AC-IC-2 leave open, and enumerate the classifier decision table"
status: draft
priority: high
created: 2026-08-01
updated: 2026-08-01
tags: []
parent: PRD-001
---
## Origin

`lore review spec-report-issue-has-no-specified-concurrency-contract-ac-072`
(run 2026-08-01, `agent:main-orchestrator`) returned **escalate, confidence 0.68**
with one blocking question. This closes V3 of
`knowledge-session-process-review-2026-07-31-ten-agent-two-wave`, which recorded that
the spec had been re-promoted via `set --status approved` and never passed a judgment
gate. It has now passed one, and the gate found a real specification gap.

## The gap, confirmed against the source

The spec's own §Contract Details (line ~90) states:

> Every `lore` command writes its own corpus at startup. `buildAppFromSqlite`
> constructs `new SessionStore(db)` unconditionally, and that constructor runs
> `db.exec(CREATE_TABLE_SQL)` followed by `pruneExpired()` — two writes against the
> same file as the corpus, before the command does anything the caller asked for.
> Two concurrent invocations therefore contend at STARTUP, not only at the report
> write.

It then requires the T2 harness to "account for" this, and D3 forbids the obvious
mitigations (retry / sleep / raised timeout). But **it never states what accounting
is permitted**, and the acceptance criteria contradict the allowance:

- **AC-IC-1** classifies any non-zero exit whose stderr does not match the declared
  template as a failure. A startup-phase refusal produces exactly that shape — generic
  `Storage failure: database is locked`, exit 1 — because `app.ts` and the session
  store are NOT in D3's enforcement path list.
- **AC-IC-2** is worse: an externally held write transaction blocks the startup write
  FIRST, so the observed failure may never carry the declared template at all, while
  the criterion demands the declared loud failure in all 10 control runs.

The judge phrased this as "point me at where this is resolved" because it was reading
a truncated body. The orchestrator read the untruncated section: **it is not resolved
anywhere — the spec states the requirement and never discharges it.**

## Resolution to implement (judge's option (b))

Give AC-IC-1 / AC-IC-2 an explicit, mechanically checkable rule that classifies a
startup-phase refusal as OUT-OF-CONTRACT rather than as a failure. The carrier already
exists: **AC-IC-6's pure classifier** maps `{exitCode, stderr}` → D2 verdict. A
startup-phase refusal should become an explicit verdict branch of that classifier
rather than a harness-side special case, so the rule is unit-testable with no spawn.

Option (a) — folding `app.ts` / the session store into D3's path list and under the
same declared bound and stderr template — was the alternative offered. It is the wider
change (it makes every lore command's startup a party to the report-issue concurrency
contract) and should be adopted only if (b) proves insufficient. State which was chosen
and why.

## Also fold in (judge advisory, non-blocking)

AC-IC-6's oracle is "unit-tested over the decision table", but no decision table is
enumerated anywhere in the spec body — D6 gives the classifier's signature without the
input rows. Enumerate them so suite completeness stops resting on reviewer judgment:
both-zero · one-zero + template-matching stderr · one-zero + non-matching stderr ·
both non-zero · unknown-source literal present/absent · **and the new startup-phase
branch**.

## Dependency

Editing AC-IC-1 / AC-IC-2 / AC-IC-6 statements requires `lore ac set`
(`spec-lore-ac-set-in-place-edit-of-a-declared-acceptance`). Those three ids carry
live `ac_ref` evidence, so `lore ac rm --force` is NOT an acceptable path — it is
precisely the mechanism that produced the three dangling refs measured in this corpus
on 2026-08-01. **Do not start before `lore ac set` has merged.**

## Oracle

- The revised spec passes `lore review` with decision `approve` (not `escalate`), and
  the blocking question above is absent from the new judgment.
- The classifier's unit suite covers every enumerated decision-table row, including the
  startup-phase branch, with a control proving a mis-classified row FAILS the suite.
- Re-promotion goes through `lore approve` after the review — never `set --status
  approved`, which is the original V3 defect.
