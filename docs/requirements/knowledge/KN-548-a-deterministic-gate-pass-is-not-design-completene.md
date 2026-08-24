---
id: KN-548
type: knowledge
role: knowledge
title: "A deterministic gate:pass is not design completeness, raw fan-in inverts blast radius, and an absent JSON key is not an absent field"
status: approved
priority: medium
created: 2026-08-24
updated: 2026-08-24
tags: []
parent: PRD-001
links:
  - {id: SPEC-151, type: informs}
  - {id: SPEC-152, type: informs}
---
## F1 — a deterministic `gate: pass` is not evidence that a spec's design is complete

Measured while authoring two specs 2026-08-24. `lore gate spec-promote` returned
`gate: pass` on BOTH specs at every revision. The advisory judge — which never changes
the exit code — returned `escalate` twice on the grading spec and named five holes, all
of which were real:

1. `gradeOf`'s inputs were specified, its **codomain and thresholds were not**, so the
   spec's own reproducibility goal was unfalsifiable.
2. "class-II predicates are scaled by grade" shipped with **no table**.
3. **No AC asserted that grading changes behaviour** — only that the grade computes.
   That is exactly the capability-implemented-wiring-absent false green this repo has
   already measured four times.
4. The grade table was **not total**: `PERIPHERAL` layer + 3 anchors matched no row.
5. Multi-layer anchor resolution was undefined, and the barrel-exclusion rule the design
   promised had **no AC covering it**.

⛔ Consequence for the workflow, not just for this spec: `lore ac add|set` after approval
demotes the spec to draft and HARD-BLOCKS every descendant claim, so the cheapest moment
to absorb the judge's blocking questions is BEFORE `lore approve`. Running
`gate spec-promote` as a pre-flight and answering every blocking question is therefore
not optional politeness — skipping it converts five design holes into an approved
contract plus a later demotion. The judge's advisory status means nothing refuses this
on your behalf.

## F2 — raw fan-in is not a risk proxy; a barrel scores 670 and the Zod boundary scores 8

Measured over 502 non-test source files via `buildImportGraph`'s own `reverse` edges
(`scripts/changed-tests.ts`), 2026-08-24:

`p50=1  p75=4  p90=10  p95=24  p99=85  max=670`; 133 files have zero fan-in.

Top of the distribution is barrels and composition roots — `packages/core/src/index.ts`
670, `in-memory-store.ts` 200, `corpus-service.ts` 189, `app.ts` 132. The files whose
semantics the whole corpus depends on sit LOW: `packages/core/src/schemas.ts` **8**,
`store-shared.ts` 12, `task-workflow.ts` 14, `acceptance.ts` 15, `gate-predicates.ts` 24,
`checkpoint-registry.ts` 29.

⛔ So a design that ranks blast radius by raw fan-in inverts the real ordering: it calls a
re-export barrel structural and the Zod write boundary peripheral. Layer must dominate;
fan-in may only subdivide within a layer, and pure re-export files must be excluded from
the count. This measurement was taken BEFORE the thresholds were authored and it changed
them — the same measure-before-you-pin rule this repo already learned for AC oracles.

## F3 — the same capability, gated on one side and not the other, is used 97 to 0

`lore anchor add` accepts a knowledge doc's `code_anchors` and `DriftCheckService`
scans by `type`; both landed 2026-08-12. Live usage measured 2026-08-24:
**`spec` 97, `knowledge` 0.**

The spec side has two things demanding it — a standing rule in `CLAUDE.md` and the
`scripts/check-anchor-coverage.ts` ratchet in `hooks/pre-push`. The knowledge side has
neither. Downstream cost: of 192 conclusion-bearing docs (154 `retro` + 38 `adr`), 23
carry a `supersedes` edge and exactly **1 retro has ever been retracted** — nothing can
turn a conclusion red, so nothing does.

⛔ When a capability shows a lopsided adoption ratio, look for the gate on the busy side
before concluding the quiet side lacks the capability. The gap is an OBLIGATION, not a
feature.

## F4 — an absent key in `--json` output does not mean the field does not exist

I reported that `lore search` provides no invalidation signal, having read its `--json`
output and found no `validity` key. Reading the type instead: `SearchHit.validity?:
Validity` has existed since SPEC-043 D3, and search already filters invalidated hits by
default. The key was absent because it is OPTIONAL and none of the sampled docs were
invalidated.

⛔ An optional field is invisible in any sample that does not populate it, so an observed
JSON payload is evidence about that payload, never about the schema. Read the type
definition (or a record that populates the field) before asserting a field is missing.
The same turn produced the mirror-image error: I reported `knowledge` cannot declare
`code_anchors` from a stale reading, when the capability had shipped 12 days earlier
(F3). Both errors shared one shape — inferring a CAPABILITY's absence from an
OBSERVATION's absence.
