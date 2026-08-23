---
id: TASK-752
type: task
role: plan
title: "Declare a falsifier per criterion, drive lore verify --falsify over all eight, and close the anchor record"
status: archived
priority: medium
phase: "P4-declare-falsifiers"
created: 2026-08-23
updated: 2026-08-23
tags: []
parent: PLAN-135
plan: PLAN-135
---
The eight criteria were authored before their implementation existed, so no --falsifier-* could be declared at ac add time — the falsifier path did not exist on disk. This task pays that off, and in doing so becomes the first end-to-end use of the very mechanism the plan repairs.

1. For EACH of AC-SD-1..8, declare a falsifier with lore ac set --falsifier-path/--falsifier-find/--falsifier-replace/--falsifier-exit-code, choosing the mutation from that criterion own RED clauses (they are already written as concrete mutations). ⛔ --falsifier-exit-code must be the EXACT observed value, never a guess and never "non-zero" — run the mutation by hand once to read the real code.
2. Drive lore verify <plan> --task <this task> --falsify <AC-ID> for all eight. An inconclusive here is a FINDING, not a pass: it means the materializer did not make the environment usable for that criterion command, and it must be reported rather than accepted.
3. ⛔ lore ac set drops the spec to draft. After ALL eight declarations land, re-run lore review + lore approve in the same session, or every later claim against this spec is hard-blocked.
4. Declare the spec code_anchors with lore anchor add for the module and the wiring site, and RETIRE the spec row from scripts/anchor-coverage-ledger.json in the SAME commit — the ledger fails loud both when an unanchored spec has no row and when a row spec has since been anchored. Note the ledger currently carries 60 entries and the checker enforces SET EQUALITY against a fresh measurement, so re-run bun scripts/check-anchor-coverage.ts and expect 59 rows dispositioned.
5. Report, do not fix: spec-falsifiability-reachability still has ZERO code_anchors and its own ledger row stays — only AC-FR-11/12 landed there, and anchoring it partially would erase the record that its other ten criteria are unanchored. Leave that row alone.

This task declares NO ac_scope: it produces no new criterion of its own, it redeems the declarations of the other eight. Its own oracle is the eight verify runs plus a green check-anchor-coverage.
