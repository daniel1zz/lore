---
id: TASK-431
type: task
role: plan
title: "lore ready renders an expected-fail evidence row as a green ✔ — a deliberate RED reads as verified"
status: archived
priority: high
created: 2026-08-01
updated: 2026-08-01
tags: []
parent: PRD-001
links:
  - {id: TASK-435, type: blocks}
---
## Defect

`packages/lore/src/adapters/cli/commands/ready.ts:57-62` derives its evidence badge as:

```ts
record.latest_evidence?.result === "fail" ? ` ✘${count}` : ` ✔${count}`
```

Only `"fail"` is treated as non-green. Every other value falls to `✔` — including
`"expected-fail"` and `"inconclusive"`, both of which `latest_evidence.result` can
legitimately hold (`task-workflow-service.ts:251` states the type DOES include
`expected-fail`).

So a task whose most recent evidence row is a deliberate pre-implementation RED pin
renders in `lore ready` as `✔2` — indistinguishable from a task with two passing
oracles. This is a FALSE GREEN, the more dangerous direction of the same
misclassification family: the `✘` case over-reports a problem, this one erases one.

## Why this was not caught

`spec-workflow-hardening-evidence-red-vocabulary-claim-worktree §M1` built the
`expected-fail` vocabulary and taught THREE consumers about it — `lore ac list`
(`coverageBadge`, renders `⚑R(n)`, ac.ts:513-535), the task archive floor
(`task-workflow-service.ts:1191`), and the phase archive floor
(`phase-workflow-service.ts:972`). `lore ready` was not in that sweep. Measured
2026-08-01 during the design pass for
`task-red-first-discipline-is-asked-for-in-prose-but-never`.

This is the consumer/end-to-end audit gap CLAUDE.md already names: a new vocabulary
value needs an author→render oracle for EVERY surface that renders evidence, not for
the surfaces the implementing slice happened to touch.

## Blocking relationship

This is a PREREQUISITE of `task-red-first-discipline-is-asked-for-in-prose-but-never`.
That task proposes to REQUIRE a deliberate-RED evidence row from every task claiming
red-first discipline. Mandating those rows while this defect stands would
systematically manufacture false-green readiness lines — the mechanism would degrade
the signal it exists to strengthen.

## Oracle

- A task whose latest evidence row is `expected-fail` renders a distinct non-green
  badge in `lore ready` (reuse `⚑R`, the marker `lore ac list` already ships for this
  exact state — a second vocabulary for one state is its own defect).
- Same for `inconclusive` → reuse `⚑?`, again matching `lore ac list`.
- CONTROL, so the fix cannot silently turn every badge non-green: latest row `pass`
  still renders `✔n`, and latest row `fail` still renders `✘n`.
- The `--json` payload consumers are unaffected, or the change is deliberate and
  separately asserted (`ready --json` is read by dispatchers; a shape change there has
  its own blast radius).
- BOUNDARY: `evidence_count > 0` with `latest_evidence` absent/undefined must not
  crash and must not render green.
