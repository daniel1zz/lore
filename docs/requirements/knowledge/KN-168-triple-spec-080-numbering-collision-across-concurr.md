---
id: KN-168
type: knowledge
role: knowledge
title: "Triple SPEC-080 numbering collision across concurrent sessions (2026-07-26)"
status: draft
priority: medium
created: 2026-07-26
updated: 2026-07-26
tags: []
parent: PRD-001
---
## What happened
Three concurrent Claude sessions on the same machine each derived 'next spec number' independently and minted a SPEC-080 within the same hours: (1) audit-hardening part 2 (this session; renumbered to SPEC-081, slug spec-081-audit-hardening-part-2-gate-skip-observability-push), (2) spec-080-prd-as-outline-contract-structured-outline-domain, (3) spec-080-bootstrap-injection-projection-tier-1-tier-2-payload. All three were independently approved before anyone noticed. Git history additionally interleaves commits labeled 'SPEC-080' from three different feature families, and RED-scenario test files from the prd-as-outline session made main's typecheck fail while their implementation tasks were still in flight — a full-repo regression AC (this plan's AC-080-5) became temporarily unsatisfiable through no fault of the plan's own changes.

## Root cause
Spec numbers are derived by reading the current max at authoring time. There is no reservation/claim step, so the read-derive-write race collides exactly like unanchored task claims did pre-SPEC-042. The title-declared-number rule in ExportDocsService (SPEC-021 A1) will also make the two remaining SPEC-080s contend for the SPEC-080 human_id at export time (first claimer wins, the other silently falls to sequential allocation).

## Resolution taken
This session's spec yielded the number (SPEC-081; slug + title + content header renamed; AC ids retain the AC-080-* prefix — evidence continuity over cosmetic renaming, SPEC-071 precedent). The other two specs have live in-flight sessions and were NOT touched; their owners must deconflict between themselves (one keeps SPEC-080, the other renumbers) before the next lore export-docs run, or the export index will hand SPEC-080 to whichever exports first.

## Standing lesson (candidate for mechanization)
Next-free-number derivation is a read-modify-write race. Options: (a) number reservation via a corpus counter doc CAS-incremented at create time; (b) gate advisory on spec-create detecting a title-number already claimed by another doc (cheap: exact prefix match over existing spec titles); (c) drop human numbers from titles entirely and let export allocation be the sole numbering authority. (b) is the smallest: spec-create already loads sibling context.
