---
id: TASK-420
type: task
role: plan
title: "Two more evidence consumers erase an expected-fail row: doc-type-meta counts it as neither pass nor fail, and the dashboard adjudication bar reports status=none"
status: archived
priority: high
created: 2026-08-01
updated: 2026-08-01
tags: []
parent: PRD-001
---
## Defect

Two more evidence-result consumers silently erase an `expected-fail` row. Both are the
same FALSE GREEN family as `task-lore-ready-renders-an-expected-fail-evidence-row-as-a`
(ready.ts), and neither was in that task's scope.

Measured at source 2026-08-01 by direct read, at HEAD f3242aa:

### Consumer 1 — `doc-type-meta.ts:120-121`

```ts
evidence_pass: evidence.filter((e) => e.result === "pass").length,
evidence_fail: evidence.filter((e) => e.result === "fail").length,
```

An `expected-fail` row is counted in NEITHER bucket. It does not appear as a pass and it
does not appear as a fail — it vanishes. A task carrying a deliberate RED pin reports
`evidence_pass: 0, evidence_fail: 0`, which is byte-identical to a task that recorded no
evidence at all. The same holds for `inconclusive`.

### Consumer 2 — `evidence-panel.ts:806-815` (dashboard adjudication bar)

```ts
const passCount = panel.evidence.filter((e) => e.result === "pass").length;
const failCount = panel.evidence.filter((e) => e.result === "fail").length;
...
status: failCount > 0 ? "fail" : passCount > 0 ? "pass" : "none",
```

Worse than consumer 1, because the counts feed a derived STATUS. A task whose only
evidence is a deliberate RED renders `status: "none"` — the adjudication workbench states
there is no evidence, when in fact the corpus holds a permanent, deliberately-recorded
red run. An auditor reading the dashboard is told the opposite of the truth.

## Why this was not caught — and why the count matters

`spec-workflow-hardening-evidence-red-vocabulary-claim-worktree` §M1 introduced the
`expected-fail` vocabulary and taught THREE consumers about it (`lore ac list`
coverageBadge, the task archive floor, the phase archive floor). `lore ready` was missed
and is being fixed separately. These two were missed by BOTH sweeps.

⛔ Standing lesson this re-proves, at a stronger reading than before: an exploration pass
over this same question REPORTED "beyond the known four: none found" while its own
enumeration listed nine call sites. The enumeration was right and the conclusion was
wrong. A consumer audit is only complete when every enumerated site is individually
judged against the new vocabulary value — a summary sentence asserting completeness is
not that judgement, and must not be accepted in place of it.

## Requirement

Every consumer that partitions evidence by `result` must handle the FULL vocabulary
(`pass` / `fail` / `expected-fail` / `inconclusive`), and a value outside that set must
fail loud rather than fall into a default bucket.

⛔ Do NOT fix these two and stop. The mechanism root is that the vocabulary lives in one
place and its consumers each re-derive a partition by hand. Prefer a single shared
classifier in `@lore/core` that every site calls, so the NEXT vocabulary value cannot
repeat this. If a shared classifier is rejected, state why in the completion report.

## Scope

- `packages/lore/src/service/doc-type-meta.ts` (or wherever `evidence_pass`/`evidence_fail` are derived)
- `packages/lore/src/service/evidence-panel.ts` (`summarizeForAdjudicationBar`)
- Any additional site the shared-classifier refactor reaches.

Out of scope (owned elsewhere): `ready.ts` (separate task, concurrent), `ac.ts`
coverageBadge, the task/phase archive floors — those three already know the vocabulary.

## Oracle

- A task whose only evidence row is `result=expected-fail` is reported by BOTH consumers
  in a form distinguishable from a task with zero evidence. Assert the distinguishing
  field directly, not a rendered phrase.
- CONTROL proving the assertion is not vacuous: the same task with a `pass` row, and a
  task with genuinely zero evidence, produce three mutually distinct outputs.
- REGRESSION: existing `pass`/`fail` counts and the derived `status` are unchanged for
  tasks carrying only those two values.
- NEGATIVE: an unrecognised result value fails loud at the classifier, and no call site
  silently buckets it.
- A grep for `result === "pass"` and `result === "fail"` across `packages/` returns no
  hand-rolled partition outside the shared classifier, or each survivor is justified in
  the completion report.
