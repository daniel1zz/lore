---
id: TASK-401
type: task
role: plan
title: "getAssessTemplateReproducibility has zero production callers: the reproducible field is defined, schema'd and rendered but never stamped, so every real assess run leaves it absent and the reader still sees nothing"
status: archived
priority: high
created: 2026-08-02
updated: 2026-08-02
tags: []
parent: PRD-001
links:
  - {id: TASK-406, type: relates-to}
  - {id: ADR-028, type: relates-to}
---
Residual of `task-assess-templates-5-binds-the-projected-renderer-while-two` (merged as `a62a0dd`).
Flagged by that task's implementer, then VERIFIED by the orchestrator against merged `main` — the
verification is what turned it from "a follow-up edit" into a high-priority filing: the shipped
mechanism is currently INERT END-TO-END.

## Measured on merged main at a62a0dd

    $ grep -c "reproducible" packages/lore/src/service/ai-provider-service.ts
    0
    $ grep -rn "getAssessTemplateReproducibility" --include="*.ts" packages/lore/src packages/core/src
    → every hit is a JSDoc mention inside assess-template.ts itself, plus one JSDoc cross-reference
      in assessment.ts. The only non-comment hit is the function's own definition (:1176).

So `getAssessTemplateReproducibility` is an exported function with **zero production callers**, and
`_finalizeAssessment`'s `judgment: { … }` object literal (`ai-provider-service.ts:1606`) never writes
the field.

## Why this is not merely "a follow-up edit"

The slice that just landed delivered all three of: a registry field (`{fn, reproducible}`), a schema
field (`judgmentSchema.reproducible`, three-state), and rendering at all three sites. Every one of
its tests is green. But the tests construct judgment objects THEMSELVES and hand them to the
renderer — none drives a real assess run. Meanwhile the renderers are presence-guarded (deliberately,
to preserve legacy byte-identity), so an absent field renders nothing at all.

Net effect: **every real `lore assess` run produces a judgment with no `reproducible`, so the field
never renders, and the reader the whole slice exists to inform still sees nothing.** The reader was
built, the schema was built, the registry was built — the writer was not. That is the corpus's own
standing lesson verbatim: "a writer whose reader was retired, a reader without a writer … all fail
SILENT. Every distribution pipe and every gate-read field needs an install→visible / author→trip
end-to-end oracle."

Worse than a plain missing feature: absent is a LEGAL, DOCUMENTED third state in this design
("never coerced to true"), so the inert state is indistinguishable from a legitimately unrecorded
one. Nothing anywhere will ever complain.

## Required

- In `_finalizeAssessment` (`ai-provider-service.ts`), read `getAssessTemplateReproducibility(<the
  prompt version actually used for this run>)` and stamp the result into the `judgment` literal
  beside `prompt_version`. Use the SAME version value that is stamped as `prompt_version` — deriving
  it twice from different sources is how the two drift apart.
- Handle the `err(...)` branch explicitly (an unknown version). ⛔ Do NOT swallow it into an absent
  field: absent already means "legacy record", and overloading it with "lookup failed" recreates the
  exact conflation this task family keeps closing. Decide a distinct, loud outcome and document it.

## Proxy / Silence / Opt-in

- **Proxy** — the landed slice's green test suite is a proxy for "the field reaches readers". Concrete
  input satisfying the proxy while violating the property: every test in the slice, all of which
  inject the field directly and never traverse `_finalizeAssessment`. The gap is NOT accepted; it is
  the entire content of this task.
- **Silence** — total. Absent renders as nothing, is a legal state, and no test, gate, or check
  distinguishes "this run had no reproducibility recorded" from "this build never stamps it". The fix
  must include an oracle that fails if the stamping is removed again.
- **Opt-in** — n/a today, but note the shape: making the schema field optional is what allowed the
  producer to be omitted while everything compiled. Once stamping lands, consider whether new
  assessments should REQUIRE it (legacy docs stay optional), so a future producer omission is a type
  error rather than a silent absence.

## Oracle

- ⛔ RED first, and the oracle MUST drive a REAL assess run — a unit test over `_finalizeAssessment`
  reproduces this task's own defect at a smaller scale. Run `lore assess` against a fixture plan in a
  throwaway corpus (`mkdtemp` + `lore init`), then read `extra.assessment.judgment.reproducible` back
  out of the persisted document. Today it is absent; after the fix it equals the registry's
  declaration for the version actually used. Must fail before the change.
- CONTROL: the same read on a pre-existing assessment doc (authored before this lands) is still
  absent, and its rendering is byte-identical — the legacy third state must survive.
- CONTROL: the unknown-version path produces the chosen loud outcome, asserted by VALUE, not merely
  as "not true".
- CONTROL: every test landed by `a62a0dd` stays green — `packages/core/tests/judgment-reproducible.test.ts`, `packages/lore/tests/unit/ai/assess-prompt-version-freeze.test.ts`, `packages/lore/tests/unit/assess-render-sites.test.ts`.
- CONTROL: `packages/core` stays browser-safe (`packages/lore/tests/unit/core/barrel-isolation.test.ts`).
