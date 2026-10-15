---
id: KN-592
type: knowledge
role: knowledge
title: "Retro closing the product baseline migration 2026-10-11"
status: approved
priority: medium
created: 2026-10-11
updated: 2026-10-11
tags: []
parent: SPEC-164
---
# Retro: closing the product-baseline migration (2026-10-10 night → 2026-10-11)

Scope: P0 coverage plan, baseline close-out fixes plan, slice 3b plan, fresh-install probe fixes plan, the 84-spec mapping, census re-closure, main-red repair. Owner decisions D5-D8 taken before the owner went offline; everything else unattended.

## Assessment triage — fresh-install probe fixes (partially_met, 77)
- MAJOR evidence_integrity AC-FIP-1 (0 pass/0 fail in this plan): BY DESIGN — F1 blocked approving this very spec (its own review failed tree_position), so F1 landed first through the ad-hoc task `task-hotfix-f1-review-tree-position-rejects-every-parentless`, whose AC-FIP-1 verify is attested (`lore verify --task <adhoc>`, pass). Assess counts evidence by plan lineage, so an ad-hoc task's attestation is invisible to it (known: `knowledge-ac-coverage-counts-evidence-by-plan-lineage-and`).
- minor AC-FIP-5 (create-time refusal hint names `ac add` for a never-created spec): TRUE, filed #141.
- minor AC-FIP-6 (post-fix failing runs): run 5 = the probe's own over-strict predicate (any "first PRD" mention) — fixed to refuse only "default: first PRD"; run 6 = one verify run killed with exit 143 at 9.7 s, the rerun passed 35/35 in 10.1 s (attested). Cause of the 143 not determined.

## Lessons (each with the mechanism that would have caught it)
1. A contract change verified at its own surface missed a sibling surface: AC-BLS3B-1 proved create/link refuse a parent, but `lore review`'s mechanical tree_position check still required one, so after the migration NO spec anywhere could be approved (F1). Found only by the fresh-install probe. Mechanism now: `scripts/fresh-install-probe.ts` (AC-FIP-6) walks the whole loop from a fresh install. Same class as the standing lesson "capability ≠ production wiring".
2. A structural distribution oracle was only as wide as its grep: AC-BLS3B-9 matched `create spec` + `--parent` on one line, so a table cell (`spec | --parent`) and prose ("Every spec needs a parent") shipped (F2/F3). Widened in AC-FIP-2 (any spec↔parent pairing in any form, with a negative control).
3. My bulk-apply script truncated four-part `current_reality` at 400 chars and used the statement as the reality for 3 new AS rules; the reviews caught it (19 leaves rejected). Never auto-fill a field whose meaning is "what the code does today".
4. Rule edits demote their leaf; a night of rule edits demoted ~60 leaves in waves. Batch rule edits per leaf and re-review once.
5. Parallel branches with a semantic conflict (#117 fixture creating a parented spec vs the no-parent contract) merged cleanly and went red only on main; per-branch green is not main green — the full suite after the last merge of a wave is required (it was run; 33+27 reds fixed by one task).
6. `lore ac cite` deadlocks on a criterion that cites a retired rule (cannot add while the retired id is present, cannot remove the last id) — #135; `lore verify` cannot re-attest a criterion whose only task is archived without ac_scope — #138; mixed vitest+Playwright commands are "inconclusive" — #133.

## Issues filed this session
#128-#141 (all with repro); fixed tonight: #58, #117, #123, #125, #126, #128, #129, #130, #136, #137.
