---
id: KN-162
type: knowledge
role: knowledge
title: "SPEC-080 triple numbering collision — resolution protocol + gate mechanization candidate"
status: draft
priority: medium
created: 2026-07-26
updated: 2026-07-26
tags: []
---
## Incident

2026-07-26: THREE specs simultaneously titled "SPEC-080" exist in the corpus, created by concurrent sessions that each independently derived "next number = 080" from the same snapshot:

1. `spec-080-bootstrap-injection-projection-tier-1-tier-2-payload` — Bootstrap injection projection (created ~12:47, EARLIEST)
2. `spec-080-prd-as-outline-contract-…` (01KYEGPX9N) — PRD-as-outline contract (~13:57)
3. `spec-080-audit-hardening-part-2-…` (01KYEK3FV5) — Audit hardening part 2 (~14:33)

Git history now interleaves commits tagged "SPEC-080" from at least two different plans (bootstrap-injection and PRD-outline/audit chains), and both in-flight plans declare AC ids in the same `AC-080-*` namespace on DIFFERENT specs (e.g. two unrelated "AC-080-3"s). AC refs are per-spec so nothing is mechanically broken, but human/agent readability of history is degraded.

## Root cause

Spec human-numbers are TITLE-DECLARED, not corpus-allocated. Nothing at `lore create spec` time checks whether the self-declared `SPEC-NNN` prefix is already claimed (the uniqueness machinery lives only in `ExportDocsService.buildOrExtendIndex` — SPEC-021 A1: title-declared number adopted iff free, else silently renumbered at export time). Concurrent sessions each read "highest existing = 079" before any of the three creates landed.

## Hazard (why this must be resolved before the next `lore export-docs`)

The export allocator will keep the number for whichever doc it reconciles first and silently renumber the other two — file names/human_ids on disk will diverge from the titles inside the corpus AND from the "SPEC-080" tags baked into immutable git commit messages. Resolve titles BEFORE exporting.

## Resolution protocol (execute when both other sessions quiesce)

Creation-order priority (earliest keeps its number): bootstrap-injection keeps SPEC-080; retitle PRD-as-outline → SPEC-081 and audit-hardening-part-2 → SPEC-082 (verify 081/082 are still free at execution time; the audit-hardening session may prefer renumbering its own docs — coordinate via handoff, do NOT edit another session's in-flight spec while its plan is executing: a title edit resets approved→draft and breaks their plan-promote/claim chain).

## Mechanization candidate (prevents recurrence)

Add a `spec-create` gate predicate: if the candidate title matches `^SPEC-(\d+)\b` and any existing non-deleted spec title claims the same number → VALIDATION_ERROR with the next-free-number suggestion in the feeding pack. Cheap (one title scan over `type=spec`), deterministic, closes the race window at write time instead of export time.
