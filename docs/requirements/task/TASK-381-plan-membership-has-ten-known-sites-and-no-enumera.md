---
id: TASK-381
type: task
role: plan
title: "plan-membership has ten known sites and no enumeration guard: the single-definition test keys on one literal form, leaving arrow-const/inline comparisons and parent_id-keyed plan resolution invisible"
status: archived
priority: high
created: 2026-08-03
updated: 2026-08-03
tags: []
parent: PRD-001
links:
  - {id: ADR-029, type: relates-to}
---
# Defect — plan-membership has ten known sites and no enumeration guard

Plan-membership is this corpus's deepest recurring defect family: **ten** sites have been
found one at a time, the tenth (`task-the-tenth-plan-member-site-is-a-write-path-create-time`)
filed 2026-08-03 and still open. Every fix so far closed ONE site. Nothing enumerates the
population, so site 11 is found the same way site 10 was.

`plan-membership.ts` is now the single definition (three copies consolidated at `3577660`,
header corrected at `23bb6bf`), and `tests/unit/service/isplanmember-single-definition.test.ts`
pins that. **But that test keys on the literal string `"function isPlanMember"`** — and the
shared module's own JSDoc already states the residual verbatim:

> Stated RESIDUAL on the SSOT note above: `function isPlanMember` counts DEFINITION SITES, so
> an arrow-const or differently-named inline `t.extra["plan_id"] === planId` would satisfy the
> count while violating the property. The wider grep for the raw comparison,
> `grep -rn 'extra\["plan_id"\] ===' packages/lore/src/`, is the companion check

That companion check exists only as a sentence in a comment. Three concrete gaps:

1. `const isPlanMember = (t, p) => t.extra["plan_id"] === p` passes the existing test.
2. A plan-scoped resolution keyed on **`parent_id`** — the tenth site's exact shape
   (create-time `extra.phase` validation resolves the owning plan by `parent_id` while every
   phase-scoped read resolves it by membership) — is invisible to every current mechanism.
3. The existing test scans `packages/lore/src` only. `packages/core/src` is unscanned.

# Required fix

Add `scripts/check-plan-membership-sites.ts`, an allowlist-by-file grep oracle modelled
EXACTLY on `scripts/check-ordinal-write-sites.mjs` (conservative textual rules + a plain
exported allowlist array + per-entry written reason), armed by a real-tree test.

Rules to flag, scanning `packages/lore/src/**` AND `packages/core/src/**` (excluding
`*.test.ts`):

- **R1 — a second definition of the predicate in ANY form.** Not only `function isPlanMember`:
  also `const isPlanMember =`, `let/var isPlanMember =`, and an object/class member
  `isPlanMember(`/`isPlanMember:`. Sanctioned file: `service/plan-membership.ts` only.
- **R2 — a raw membership comparison outside the shared module**: `extra["plan_id"] ===` /
  `extra.plan_id ===` (and the `!==` forms). Allowlist, with the reason recorded per entry:
  - `service/export-docs-service.ts` — `typeof doc.extra["plan_id"] === "string"` is a STRING
    NARROWING for an `index.mappings` key, adjudicated NOT a membership test in
    `plan-membership.ts`'s JSDoc; routing it through the predicate would be a type error.
- **R3 — a plan-scoped resolution keyed on the `parent_id` proxy**: `parent_id === plan.id` /
  `parent_id === planId` (and `!==`). Allowlist, per-entry reason:
  - `service/task-workflow-service.ts` — the DIVERGENCE DETECTOR
    (`t.parent_id === plan.id && !isPlanMember(t, plan.id)`) deliberately compares both keys;
    that is the one legitimate use and it must stay.

  ⛔ R3 is the rule that would have caught site 10. Derive its allowlist by running the rule
  and adjudicating each hit IN WRITING — never by assuming the list above is complete.

Contract requirements:

- `export function main(repoRoot: string = REPO_ROOT): number` that RETURNS its exit code;
  `process.exit` only inside `if (import.meta.main)`. Exit codes: `0` clean, `3` violations
  (each printed `file:line: <rule> — <text>`), `4` the scan itself failed. Same contract as
  the ordinal script — do not invent a new numbering.
- ⛔ **loud-zero**: if the scan walks zero files, or a rule's regex matches nothing ANYWHERE in
  the tree (including inside `plan-membership.ts` itself, which must always hit R2), exit `4`,
  never `0`. A path typo or a rewritten field name must not read as "clean". Assert this.
- Register `check:plan-member-sites` in `package.json` next to the existing `check:*` entries.
- Add `scripts/tests/check-plan-membership-sites.test.ts` with a real-tree arming assertion —
  `main()` with NO injected root — copying `scripts/tests/check-no-nul-bytes.test.ts`'s
  `describe("... real repo tree (task oracle)")` shape.

⛔ Do NOT change any production source file. This task adds an oracle; it does not fix site 10
(`task-the-tenth-plan-member-site-is-a-write-path-create-time` owns that, and it is a
write-path behaviour change with its own retroactive-policy requirement). If the new oracle
flags site 10, that is CORRECT and the expected outcome — see below.

# ⛔ The one outcome that must NOT be engineered away

R3 is expected to flag the tenth site, because the tenth site is real and unfixed.

- ⛔ Do NOT add site 10 to the R3 allowlist to make the run green, and do NOT weaken R3.
- ⛔ Do NOT "fix" site 10 here.
- Ship the oracle with the arming assertion authored against the REAL current state, and
  record the COMPLETE violation list verbatim in your completion report (file:line + rule).
  If that means the arming assertion cannot be green today, STOP and report — the
  orchestrator decides whether the tenth-site fix lands first. Do not resolve that tension
  yourself by editing the rule, the allowlist, or the production code.

# Oracle

- RED first: a fixture file containing `const isPlanMember = (t, p) => t.extra["plan_id"] === p`
  is flagged by R1 (assert it, and assert the existing
  `isplanmember-single-definition.test.ts` does NOT flag it — that contrast IS the defect).
- RED first: a fixture containing a bare `t.parent_id === plan.id` plan-scoped filter is
  flagged by R3.
- CONTROL: `plan-membership.ts` itself is never reported.
- CONTROL: each allowlisted file is not reported, and REMOVING it from the allowlist makes it
  reported — so an allowlist entry is proven load-bearing rather than decorative.
- CONTROL (loud-zero): pointing the scan at an empty directory exits `4`, not `0`; assert the
  exit VALUE, not merely non-zero.
- CONTROL: `bun run typecheck` stays 0; the existing
  `isplanmember-single-definition.test.ts` is byte-unchanged and still passes.
- Measure every exit code WITHOUT a pipe (`cmd > out 2>&1; echo $?`).

Distribution surface: this repo's own `scripts/` + test tree — a dev-repo oracle, not shipped
consumer surface, so it does not belong in `assets/`.
