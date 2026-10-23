---
id: TASK-1728
type: task
role: plan
title: "lore done's no-new-tests refusal suggests a captured red that lore evidence --capture refuses for non-test commands"
status: draft
priority: medium
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PRD-001
---
Found 2026-10-19 closing task-root-claude-md-architecture-pointer-names-base-095-which (doc-only). `lore done` refused with [floor: no-new-tests] and told the caller to "record a red run via `lore evidence <task> --oracle <kind> --command "<cmd that exits nonzero>" --result expected-fail --capture`" for any oracle kind. Following that, `lore evidence ... --oracle test --command "lore get BASE-095 > /dev/null && echo X" --result expected-fail --capture` was refused: "--capture cannot record a "expected-fail" for oracle test: the stored output tail carries no runner summary this check recognises ... (BR-1077)". So the first remedy the done refusal offers is unreachable for any red that is not a vitest/bun test run, and the only path left is --declare-no-new-tests.

Expected: the `lore done` no-new-tests refusal names only remedies the evidence gate accepts for the caller's situation (state that a captured red must be a test-runner run, or name --declare-no-new-tests first for non-test tasks). Oracle: a test that feeds the done refusal's suggested command, for a non-test red, to `lore evidence` and asserts it is accepted, or asserts the refusal text no longer suggests it.
