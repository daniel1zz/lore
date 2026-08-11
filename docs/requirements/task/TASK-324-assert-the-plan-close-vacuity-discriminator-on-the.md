---
id: TASK-324
type: task
role: plan
title: "Assert the plan-close vacuity discriminator on the RENDER surface, restore the coverage the exempt-flag sweep removed, and resolve the both-ends probe timing discrepancy"
status: archived
priority: medium
phase: "visibility"
created: 2026-08-10
updated: 2026-08-10
tags: []
parent: PLAN-078
plan: PLAN-078
---
Three findings from `lore assess` on the merged phase work (see
`knowledge-assessment-make-three-governance-outcomes-legible-vacuo`). ⛔ Finding 1 is an AC DESIGN
defect (one AC spanning two layers), not an implementer failure.

**1 (major, now AC-GV-6) — the render surface is unasserted.** The landed oracle asserts
`checkPlanClose`'s returned verdict objects and `JSON.stringify` of those same objects. No renderer
or CLI surface is touched, so "the human render shows it" passed BY ASSUMPTION. Write
`packages/lore/tests/unit/adapters/plan-close-render-provenance.test.ts` with a
`surface-discriminator` case that drives the ACTUAL render/CLI path.
⛔ Record BOTH reds: (a) make the human render print vacuous and satisfied identically → must fail;
(b) drop the discriminator from the `--json` payload → must fail.
⛔ Re-serialising the predicate objects does NOT satisfy AC-GV-6 — that is the exact shortcut that
produced this gap.

**2 (minor, evidence_integrity) — a real coverage regression.** Seven existing fixtures gained
`assessmentFreshnessExempt: true` so the newly-visible no-evidence entry stays out of their verdict
counts. The comments are honest, but the net effect is that the suites most focused on COUNTING gate
verdicts no longer exercise the new entry at all. Add at least one fixture that does NOT set the
exempt flag and asserts the no-evidence entry's presence and shape, so the new path has positive
coverage somewhere in the verdict-counting suites.

**3 (minor, AC-GV-5) — an unexplained timing discrepancy worth resolving.** The implementer reported
the both-ends probe at 13062ms; `lore verify` on the merged tree measured 2326ms for the same command.
`lore assess` flagged the short duration as implausible for a real `lore init` subprocess and could not
confirm the fresh-corpus end ran at all. ⛔ Establish which reading is right by measuring directly —
assert a POSITIVE trace of execution inside the test (the fresh corpus's own init output or db path),
not merely that the assertion passed. An empty/skipped probe end is the same SHAPE as a clean one.

**4 (minor, scope_fidelity) — a named runtime side effect to confirm is intended.** `checkPlanClose`
now emits an extra `notApplicable` verdict that reaches GateEnforcer's advisory/audit path, adding
gate-skip audit rows for assessment-less plans. Confirm this is acceptable (and if so, say so in a
comment), or scope it out.
