---
id: TASK-495
type: task
role: plan
title: "SPEC-FIRST: require --ac-scope at task creation so the runner-attested evidence path stays reachable"
status: draft
priority: high
created: 2026-07-31
updated: 2026-07-31
tags: []
parent: PRD-001
---
## Task

Close the loop this wave opened: `lore verify` now REFUSES a task with no
`extra.ac_scope`, but nothing requires a task to declare one — so the
runner-attested evidence path is unreachable for any task authored without it.

**This task is SPEC-FIRST.** Per the skill-chain discipline a new gate is new
behaviour and needs a tech-spec before implementation. Write the spec, then
implement. Do not go straight to code.

## The trap, measured

All 10 tasks of this session's two waves were authored without `ac_scope`. All 21
script ACs were therefore recorded through `lore evidence` (self-reported), and
all four plan assessments independently reported
`attested_evidence_ratio = 0.00`. When close-out reached for `lore verify` — the
only surface that produces runner-attested evidence — it refused, because the
tasks it would verify declare no scope. The wave's own new gate blocked the wave's
own attestation path.

Root cause is authoring-time, not close-time: nothing at `lore create task`
requires the declaration that `lore verify` later demands.

## Proposed rule (to be settled in the spec, not assumed here)

`lore create task` requires `--ac-scope` when the parent plan's spec declares
script-mode acceptance criteria. Open questions the spec must decide:

- Gate or hard validation? A `checkpointRegistry` predicate composes with the
  existing service-layer enforcement and gets a `feed` pack for free; plain Zod
  validation does not. Prefer the gate.
- What about a task that legitimately claims no criterion? `ac_scope: []` already
  means "declared, claims nothing" and is distinct from absent — so the answer is
  probably an explicit empty declaration, never an exemption.
- Retroactive policy for the existing back-catalogue of scope-less tasks. Per
  `adr-a-newly-armed-structural-oracle-enforces-from-a-baseline`, budget this in
  the SAME slice; the archived tasks of this session are the first cohort. Note
  the escape that already exists: absent scope plus an explicit `--ac` runs the
  named ids, so legacy verification is not blocked.
- `--adhoc` tasks have no plan and therefore no spec — they must be exempt by
  construction, and the spec should say so rather than leave it implied.

## Oracle

- Creating a task under a plan whose spec has script ACs, without `--ac-scope`,
  is REFUSED naming the flag.
- The same create WITH `--ac-scope` succeeds and `lore get --json` reports exactly
  the ids passed.
- A plan whose spec has NO script ACs is unaffected (no new friction).
- An `--adhoc` task is unaffected.
- End-to-end: a task created under the new rule can be verified by
  `lore verify <plan>` and yields runner-ATTESTED evidence — the whole point.
  Assert the attested flag on the resulting entry, not merely a zero exit.

## Correction measured 2026-07-31 — "adhoc tasks are exempt by construction" is FALSE

The open question above proposes exempting `--adhoc` tasks because they "have no
plan and therefore no spec". Two independent measurements this session show the
premise is wrong, and the resulting state is *unreachable*, not *not applicable*:

1. `task-ac-ll-8-guards-the-loader-strip-not-the-no-sync-bearing` is an adhoc
   task (parent = root PRD, `plan_id: None`) whose work is governed by a spec —
   it implements `AC-LL-10`, declared on
   `spec-eager-libsql-load-makes-every-command-depend-on-a-healthy`. So an adhoc
   task CAN have a governing spec and a named criterion. `lore evidence <task>
   --ac AC-LL-10` is nonetheless rejected:
   `Validation failed on field 'type': Expected a plan document; got type 'prd'`
   — the `--ac` resolver walks task → parent expecting a plan, and an adhoc
   task's parent is the PRD. Evidence had to be recorded WITHOUT `--ac`, i.e.
   self-reported, for a criterion that has a perfectly good script command.

2. Same spec, same wave: `AC-LL-5` and `AC-LL-7` still render `[✘]` on the spec
   although both scripts pass (`cd packages/lore && bun test
   tests/integration/libsql-store-selection.bun.test.ts -t "AC-LL-5"` → exit 0,
   `1 pass / 4 filtered out`; whole file `5 pass / 0 fail`). The `✘` means
   "no attributed attested evidence", not "failed" — and re-attesting is closed
   off because the plan is archived: `lore verify <plan>` exits with
   `no task in this plan has a fresh claim — pass --task to select one
   explicitly`.

Consequences the spec must decide, replacing the "exempt by construction" bullet:

- An adhoc task needs a way to name the spec that governs it (an explicit
  `--spec`/`--ac-scope` pair, resolving the criterion from the SPEC rather than
  from `task → parent plan → spec`), or `--ac` must accept a spec-parented /
  PRD-parented task instead of hard-failing on document type.
- Exemption-by-construction would silently make self-reported evidence the ONLY
  reachable path for every adhoc task — the exact failure this task exists to
  close, re-created in a corner where nobody is looking for it.
- The `✘`-with-passing-script state needs a re-attestation path that does not
  require resurrecting an archived plan, or closing a plan must first prove
  every script AC is attested (which is the plan-close predicate's job).
