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


## F5 — the review loop converges by DEFECT TYPE, not by the judge falling silent

F1 recorded one advisory round. The same two specs then took **12** rounds, and the judge
found something real in every single one while the deterministic gate said `pass` from
round 1. The useful finding is not "run more rounds" — it is that the findings arrive in a
fixed order, and the order tells you when to stop:

1. **Design holes** — a table promised in prose and never written; an enumeration whose
   members are unnamed; a capability with no AC asserting it is WIRED.
2. **Unquantifiable oracles** — a recognizer left to prose ("a live read", "a code symbol",
   "a violating fixture"), a threshold with no literal, a baseline artifact with no path.
3. **Observation-granularity false greens** — the sharpest class. One aggregate observation
   over a conjunction of two claims: mutate one shared definition, observe one exit code,
   and the AC goes green when only ONE of two consumers actually calls it. Mutation strength
   was already pinned; the hole was the OBSERVATION being scalar. Fix: one named suite per
   conjunct.
4. **Unnamed referents** — every remaining finding is "this AC cites a symbol/path/slug it
   never names". Cheap, mechanical, and once you are only getting these, the loop is done.

⛔ Stop when the TYPE stops changing, not when the judge stops talking — it never stops
talking, and rounds 11-12 were still producing type-4 findings after every type-3 hole was
closed. Two rounds of type-4-only is convergence.

⛔ Corollary measured twice this session: a fix can INTRODUCE a higher-class defect. Pinning
the behavioural half to a declared falsifier (a type-2 fix) created the type-3 scalar-
observation hole; constraining the falsifier's exit code (another type-2 fix) created a
state where nothing constrained WHAT the code should be. Re-read the amended AC as an
adversary, not as its author.

## F6 — sweep the pattern yourself; the judge samples

Rounds 9-11 were spent answering findings of the same two shapes one at a time. Grepping
all 20 ACs for those two shapes at once — negative assertions with no recognizer, and set
claims bounded only from below — found 8 candidates in one pass, of which 6 were real and
were fixed together. ⛔ An LLM judge samples; it does not enumerate. Once it names a SHAPE
twice, stop answering instances and go scan for that shape across every criterion.

## F7 — three more measurements that changed a decision

- **Anchor counts** over 822 live tasks: p50=2, p75=3, p90=5, p95=7, p99=12, max=21 — and
  **193 (24%) declare ZERO anchors**. The zero bucket is not a rounding error, it is a
  quarter of the corpus, and `noAnchorOverlap` is **vacuously satisfied** for every one of
  them: today those tasks are invisible to the file mutex they are supposed to be governed
  by. Unowned; named here so the next session does not rediscover it.
- **Barrels are rare**: exactly 4 tree-wide (`packages/core/src/index.ts` 670,
  `packages/core/src/node.ts` 54, `packages/dashboard/src/types.ts` 0,
  `packages/lore/src/eval/index.ts` 1). Excluding them moves adjusted fan-in p75 from 4 to 3
  and the max from 670 to 200, leaving p90/p99 unchanged.
- **`packages/core/src/schemas.ts:701`** lists 8 knowledge sub_types and omits `uat`, which
  is legal — `KNOWLEDGE_SUB_TYPES` (`packages/core/src/types.ts:222`) holds 9 and 7 `uat`
  docs exist. A user hitting that refusal is shown an incomplete set of legal values.
