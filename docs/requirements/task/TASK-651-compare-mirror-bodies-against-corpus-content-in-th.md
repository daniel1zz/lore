---
id: TASK-651
type: task
role: plan
title: "Compare mirror bodies against corpus content in the spec-mirror check"
status: archived
priority: medium
phase: "mirror-content"
created: 2026-08-11
updated: 2026-08-17
tags: []
parent: PLAN-121
plan: PLAN-121
---
Implements AC-BFI-8 of spec-bootstrap-fixpoint-integrity-binary-provenance-an-anchor.

## Objective

Make the spec-mirror `--check` compare mirror BODIES against their corpus documents.

The mirror is the corpus's projection onto git — the only surface a consumer without `.lore/` can
read — and its body is the one part nothing verifies. Three layers already exist and stay untouched:
AC-FR-6 count parity, AC-FR-7 drift detection that must not self-repair, AC-FR-10 filename vs
frontmatter-id byte-identity. The residual is quoted verbatim from the tool's own 2026-08-11 output:

    export-spec-mirror --check: OK — every corpus spec has a mirror file
    (count and slug parity; file CONTENT is not compared).

## AC-BFI-8

Exit EXACTLY 2 on detected body divergence — `MIRROR_DRIFT_EXIT_CODE`, already defined at
`scripts/export-spec-mirror-core.ts:63`. ⛔ NOT 4: that is `MIRROR_HARD_FAILURE_EXIT_CODE` (line 65)
for an unreadable or erroring export, and reusing it would make a crash indistinguishable from a
detection. Output NAMES the divergent slug. Run twice consecutively, it reports the same drift both
times — the check must never regenerate what it inspects.

Declared RED: (a) make the check call the exporter first, so the second consecutive run reports
clean — must fail; (b) restore the body to match the corpus and the identical run exits EXACTLY 0,
proving the red came from body divergence rather than a crash.

## ⛔ Dependency — a LIVE foreign claim, re-read it before starting

Measured 2026-08-11T02:50Z: `agent:mirror-id-unify` holds
`task-unify-mirror-identifiers-on-zero-padded-form-export-all` in worktree
`worktree-agent-a9f801dd0f61837b2`, anchoring `scripts/export-spec-mirror.ts`,
`scripts/export-spec-mirror-core.ts`, `scripts/tests/spec-mirror-export.test.ts`, `package.json` —
intersecting this task. `lore ready` already reports the conflict.

Also: `main` was RED at that time (`links_broken` = 43, `migration-coverage.test.ts` exit 1). That
red belongs to the foreign task, not to this one. Do not start until it is merged and green, and
⛔ re-read the claim at dispatch time rather than trusting this snapshot.

## UPDATE 2 (2026-08-11, after the merge landed) — the sequencing blocker is GONE; a harder one replaced it

The mirror-identifier work merged at `cedb29db` and its session ended. Verified here, not assumed:
`packages/lore/tests/unit/eval/migration-coverage.test.ts` now passes 6/6 exit 0 (it was
`links_broken` = 43, exit 1), and `bun run check:spec-mirror` exits 0 across all six type
directories (1365 mirror files). So the wait-for-the-merge instruction below is satisfied.

⛔ **The replacement blocker is what this task must be designed around: an ordinary `bun run test`
rewrites the mirror tree, from inside the suite, on a clean checkout.** Measured on `main` at
`cedb29db`: one full run moved the mirror fingerprint `45ea1381` → `4c84f428` and left
`docs/requirements/` and `.lore/export-index.json` modified. The cause is NOT the script chain —
that is clean (`check:spec-mirror` is `--check` only, `mirror:export` is chained from nothing, and
the run was killed at `test:bun` before `check:spec-mirror` was ever reached). The cause is the
sibling file `scripts/tests/spec-mirror-export.ts`, which runs the REAL exporter against the REAL
production corpus deliberately, because AC-FR-6/7/10 require assertion against this repo's
production corpus rather than a fixture. vitest runs files concurrently.

Consequences for this task, all mandatory:

1. This test MUST be isolated from that sibling exporter, and AC-BFI-8 condition (ii) — hash the
   mutated file immediately after mutating, re-read immediately before asserting, require equality —
   is what PROVES the isolation held. ⛔ Do not treat an export-free setup in your own file as
   sufficient; it is not, and that is measured, not theoretical.
2. RED (c) is a FORCED interleave: invoke the real exporter between the mutation and the assertion.
   ⛔ Never a concurrency race — a scheduling-dependent red that may not occur is not a red.
3. Expect the working tree to be dirty in `docs/requirements/` after any full-suite run. That is the
   suite's designed behaviour here, not your bug, and not corpus pollution: the diffs are the mirror
   catching up to corpus documents that legitimately changed.

## Superseded context (kept for provenance) — the original claim-based blocker

Verified at the time: `agent:mirror-id-unify` had released (`lore ready` on that plan reported
`Sessions (0)`). ⛔ That was not clearance either. The blocker then changed shape rather than lifting:

1. **That work's merge is still pending, and it rewrites this task's entire baseline.** It moves
   every mirror identifier to the zero-padded form and exports all six type directories for the
   first time — **813 files**. A content-comparison oracle written against today's mirror tree would
   be measuring a tree that is about to be replaced wholesale. Wait for that merge to land on `main`
   and for `main` to be green.
2. **It also edits files adjacent to this task's anchors**: `scripts/export-spec-mirror.ts`,
   `scripts/export-spec-mirror-core.ts` (this task's own anchor),
   `packages/lore/src/service/export-docs-service.ts`, `packages/core/src/ordinal.ts`,
   `package.json`, and `.lore/export-index.json` (which IS git-tracked — `.gitignore` whitelists it
   per SPEC-021; verified here with `git ls-files --error-unmatch`).
3. ⛔ **No gate protects this.** The anchor mutex is plan-scoped
   (`buildAnchorGateContext` ← `getPlanBundle`), and so is `lore ready`'s `anchor_conflicts`, so a
   collision with that other plan is invisible to both the gate AND the pre-dispatch check.
   Coordinate explicitly; `anchor_conflicts: []` is not evidence of safety here.
   See `knowledge-five-findings-from-planning-the-bootstrap-fixpoint` §1.

## Known unresolved seam nearby — do NOT treat it as your bug

`OrdinalMigrationService`'s `human_id` write-back emits the UNPADDED form, and that behaviour is
pinned by **AC-084-4**, a currently-attested structured AC:
`packages/lore/tests/unit/store/migrate-ordinals.bun.test.ts:205` asserts
`new_human_id === "SPEC-1"` (and `suggested_file_path` likewise unpadded). The peer session's
implementer found this conflict with the new zero-padded canon and correctly did NOT override it.

Consequence for THIS task: a future `lore migrate ordinals --apply` will write unpadded ids, and the
exporter self-heals them on its next run — so there exists a legitimate, transient window in which a
mirror body diverges from its corpus document for a reason that is neither drift nor a defect in
your comparison. Do not "fix" it here and do not weaken the oracle to tolerate it; flag it if you
hit it, and record which side you observed.
