---
id: ADR-051
type: adr
role: decision
title: "Mapping a census site does not demote a baseline leaf; an owned-by exclusion is a checked reference"
status: approved
priority: medium
created: 2026-10-18
updated: 2026-10-18
tags: []
parent: PRD-001
links:
  - {id: SPEC-157, type: relates-to}
---
# ADR: Mapping a census site does not demote a baseline leaf; an owned-by exclusion is a checked reference

## Status
Proposed (2026-10-18). Owner choice 2026-10-18: "先改机制再写入" (change the mechanism before the restoration plan writes its site maps).

## Context
`lore baseline map` writes a leaf's `extra.site_map` (census site → BR-n | `non-business:<reason>`) and `extra.commands`. Every leaf write goes through `RuleService.writeLeafExtra`, which demotes an approved leaf to draft first (`rule-service.ts` header: "the one shared rule"). SPEC-157 §C1/C2 introduced `site_map` as a dedicated key written only by its verb but never decided whether writing it demotes; the shared rule was applied by default.

Measured 2026-10-18 (plan-baseline-completeness-restoration-every-verb-declared-0): 91 distinct unmapped sites spread over 109 of 114 leaves, most reached only through census over-approximation; mapping them would demote ~100 approved leaves whose rule text does not change, on top of a 464-item review queue. Re-approving them would be a rubber stamp.

Second finding: `computeLeafCoverage` accepts any non-empty `non-business:` reason. The convention `non-business:owned-by <leaf> BR-n — …` (the bulk of all mappings) is free text: nothing checks the named leaf exists, or that BR-n is live and belongs to it. The same audit found mappings to retired rules (BR-125, BR-916) and a site key for a deleted function; direct BR-n mappings to a retired rule are caught as gaps, but the same staleness inside an owned-by reason is invisible.

Precedent: spec-baseline-slice-1 Q3 — `ac cite` does not demote an approved spec ("demoting 164 specs during migration would be churn with no information"); it logs a version and an audit entry.

## Decision
- D1 A `baseline map` call that changes only site mappings (`--site` with `--rule`/`--non-business`, `--remove-site`) does NOT demote an approved leaf. It still writes one version and one audit entry (`operation: baseline-map`). A call that adds or removes a declared command (`--command`, `--remove-command`) changes the leaf's business scope and demotes as today.
- D2 An exclusion of the form `non-business:owned-by <leaf> BR-n[ BR-m…] — <reason>` is a structured reference. `baseline map` refuses it (exit 4, nothing written) when the named node is not a baseline leaf, a named id is not a live rule of that leaf, or the reason after the dash is empty. `baseline coverage` counts such a mapping as a gap when, at check time, the owner leaf is gone or any named id is no longer a live rule of it (retired, moved, unknown) — the same treatment a direct BR-n mapping to an inactive rule already gets.
- D3 Correctness of mappings stays with the mechanised checks: coverage (completeness, D2 reference validity) and `baseline fidelity --exclusions` (sampled faithfulness). Leaf approval certifies the leaf's rule text and scope, not its site map.

## Consequences
- Approval of a leaf keeps its information content through mapping maintenance; the review queue is not flooded.
- A wrong `--rule` mapping on an approved leaf is no longer surfaced by demotion; it is surfaced by fidelity sampling (sampled, not exhaustive). Accepted: demotion surfaced it only as an undifferentiated draft, which in practice was re-approved in bulk.
- Existing owned-by entries that name a retired rule or a missing leaf become coverage gaps after D2 lands; the restoration plan's P1 repairs them.
- Not changed: rule add/set/move, glossary, depends, set-label and node content edits still demote.
