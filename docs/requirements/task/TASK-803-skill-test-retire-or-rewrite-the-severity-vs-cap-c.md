---
id: TASK-803
type: task
role: plan
title: "[Skill:test] retire or rewrite the severity-vs-cap cases, whose premise the cap deletion removed"
status: archived
priority: high
phase: "P1: Cap removal"
created: 2026-08-23
updated: 2026-08-23
tags: []
parent: PLAN-138
plan: PLAN-138
links:
  - {id: TASK-775, type: blocks}
---
Estimate: S
Approach: same two-disposition rule as the AC-DC-17 task. This file's premise is "severity=critical must not bypass the open-report ceiling" — the ceiling is gone (SPEC-145), so that premise is unfalsifiable. Either retire the affected cases, or rewrite them to assert what survives: that severity remains ORDERING-ONLY and never changes whether a report is accepted.
Source: found 2026-08-23 by the verify/filters implementer as a pre-existing failure outside its anchor
Dimensions: D-FUNC
Scope-Alt: none — a red suite blocks P6's full-suite obligation
Covers: AC-GI-9

## Why this is the SECOND one, and what that says about the oracle

`task-skill-test-retire-or-rewrite-ac-dc-17-whose-subject-cap` fixed the same class of breakage in `issue-adopt-compiled.bun.test.ts`. This file is a second instance, and it exposes a real boundary in AC-GI-9's oracle:

**AC-GI-9 scans for six deleted SYMBOL names. This file references NONE of them** (measured: grep count 0). It asserts the cap's BEHAVIOUR — a config carrying `feedback.inbound.open_report_cap: 3` plus an `exit 4` refusal. A symbol scan is structurally incapable of finding a test that names no symbol.

⇒ Symbol-clearance and behaviour-assertion are complementary, and the second is only reachable by RUNNING the suite. AC-GI-9 remains correct about what it asserts; it simply cannot be the only check after a mechanism deletion. That is P6's full-suite obligation, and it is why P6 is not ceremony.

## AC

- Given `bun test packages/lore/tests/integration/cli/issue-severity-ordering-only.bun.test.ts`, When it runs, Then exit 0
- Given the diff, When read, Then it states which disposition was chosen (retire vs rewrite) and why. ⛔ Forbidden: loosening an assertion so it passes
- Given the surviving cases, When read, Then severity is still asserted to be ORDERING-ONLY — that property predates the cap and outlives it
- Given the six-symbol case-sensitive scan, When run after this change, Then still 0 (⛔ including in any comment you write)
- SCOPED typecheck exit 0
