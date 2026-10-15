---
id: PLAN-151
type: plan
role: plan
title: "A spec carries its rule changes; the baseline takes them only when the spec lands"
status: approved
priority: medium
created: 2026-10-12
updated: 2026-10-12
tags: []
parent: SPEC-176
phases:
  - {name: "changeset", description: "T1 change set + gate + views"}
  - {name: "apply", description: "T2 apply + plan close"}
---
# Plan — A spec carries its rule changes; the baseline takes them only when the spec lands

Implements `spec-a-spec-carries-its-rule-changes-the-baseline-takes-them` (AC-CS-1..6). Issue #183. User decisions 2026-10-12 ("baseline永远是快照", "开始") — S1 decision and S4 approval.

## Tasks and order

| Task | ACs | Blocked by | Why |
|---|---|---|---|
| T1 change set, propose/changes/show, citation gate, snapshot views | AC-CS-1, 4, 6 | — | apply needs the change set to exist |
| T2 apply, plan-close wiring, abandonment, no new deprecated | AC-CS-2, 3 | T1 | |
| Migration (orchestrator, lore commands on the live corpus after T1+T2 merge) | AC-CS-5 | T2 | needs propose/apply/retire to exist |

## Then

`plan-archiving-the-work-that-resolves-a-defect-report-closes` is dispatched after the migration (its BR-1080/1081 become proposed by its spec). This spec's own change set (Migration step 4) is applied with `lore rule apply` once every criterion citing a changed id (BR-86, BR-257, BR-626, BR-641, BR-643 — i.e. all of AC-CS-1..6) has a runner-attested pass.

## Invariants

| # | Invariant | How it is checked |
|---|---|---|
| I1 | Rule ids never reissued; a citation from a locked record always resolves | AC-CS-1(a), AC-CS-2(d) |
| I2 | The tree changes from a change set only through apply | AC-CS-2(a), AC-CS-4 |
| I3 | No test writes the live `.lore/`; AC-CS-5 only reads it | mkdtemp + lore init; sqlite -readonly |

## Risk register

| # | Risk | Impact | Mitigation |
|---|---|---|---|
| R1 | Existing consumers read `extra.rules` lifecycle `deprecated` | M | T1 greps every reader; deprecated stays readable until migration retires/revives the 7 |
| R2 | Plan close refused for plans whose spec has an unprovable change | M | the refusal names the criteria; `lore rule propose … --correction` can drop a change |

## Decisions Log

- 2026-10-12 — model chosen over a `planned` lifecycle: a snapshot holds no future state.
