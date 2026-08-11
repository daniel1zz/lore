---
id: TASK-516
type: task
role: plan
title: "T6 upstream ADR revision clause + decision_status accepted"
status: archived
priority: medium
phase: "Close-out"
created: 2026-07-30
updated: 2026-07-30
tags: []
parent: PLAN-102
plan: PLAN-102
---
## Task Objective

Land the upstream ADR's revision clause, so the corrected decision is never separated from the implementation that acts on it.

Deliver, on `adr-plan-close-predicates-must-measure-invariants-not-proxies`:

1. Append a section whose heading is exactly `## Revision 2026-07-30` (AC-PCI-15 greps for `^## Revision 2026-07-30`; the heading is the machine-readable pin, so do not reword it).
2. Its body states, in the ADR's own register:
   - The measured correction: the observed `prdOutlineSynced` block on `plan-implementation-context-provenance-scope-declaring` was caused by domain-doc ABSENCE (`resolvePrdSyncDomainDoc` returning `ok(null)` for a spec whose parent is the root PRD with no `implements` edge), which `CorpusService.set` folded into a violation via `let synced = false` — not by the window proxy this ADR's item 2 diagnosed.
   - The correction's consequence: for a plan whose ancestor spec has no domain doc the correct instrument is a not-applicable verdict plus a `plan-promote` advisory, NOT a `prd_sync_exempt`. The §Consequences claim that mechanism-fix plans "still need `prd_sync_exempt`" is narrowed to the case where a domain doc EXISTS and the plan has nothing to write into it.
   - What is unchanged: item 1 (per-claimed-AC coverage, ratio opt-in) and item 2(a) (the relatedness conjunct) stand exactly as decided; the deferred `plan-promote` domain-affecting declaration stays deferred.
3. Flip `extra.decision_status` from `proposed` to `accepted` — the decision is now implemented. Use the dedicated path; `lore set --extra` replaces `extra` wholesale and is rejected by the dropped-field guard, so fetch-merge-set or use whatever narrow verb exists rather than clobbering `extra`.
4. Re-approve the ADR. Editing an approved `adr` demotes it to `draft`, and `adr` is in `workflow.review.judgment_required_types`, so it needs a fresh non-rejecting `lore review` judgment on the NEW version before `lore approve` will pass. If the judge returns `reject`, fix the content and bump the version — never re-run the review hoping for a better sample (measured: same bytes gave reject 0.72 then approve 0.78; rejection precedence exists precisely to stop that loop).

## Spec Reference

`spec-plan-close-predicates-measure-invariants-an-applicability` §Relation to upstream decisions — the contradiction is already stated there in full; this task moves it into the ADR itself so the ADR stops asserting something measurement contradicts.

## Acceptance Criteria

- AC-PCI-15 `lore get adr-plan-close-predicates-must-measure-invariants-not-proxies | grep -q '^## Revision 2026-07-30'`

Record it as `--oracle other`. Also verify by hand that `lore get` renders the heading unwrapped on its own line (the grep is anchored, so a wrapped or re-indented heading fails loud).

## Context Digest

- This is a corpus-only task: no source files change. Its evidence is the grep above plus the ADR's own version log.
- The ADR is currently doc-status `approved`, `decision_status: proposed`, v5.
- ⛔ Do not use `LORE_GATE_BYPASS=1`. If a gate denies, read the feeding pack and satisfy it.
- ⛔ Never redirect lore's stdout to `/dev/null` — `lore set`/`approve` print the state transition and the next gate's preconditions, and an approved→draft demotion silently freezes downstream `task-claim` until re-approval. Pipe through `| tail -N` if the output is long.

## File Anchors

(none — corpus-only task)
