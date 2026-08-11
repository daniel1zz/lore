---
id: TASK-406
type: task
role: plan
title: "Settle the v5 registry policy: slot 5 is slot-frozen but output-unfrozen by explicit policy, and a stamped prompt_version 5 therefore does not reproduce"
status: archived
priority: high
created: 2026-08-01
updated: 2026-08-02
tags: []
parent: PRD-001
links:
  - {id: ADR-028, type: relates-to}
---
## The policy, verbatim

`packages/lore/src/ai/assess-template.ts:62-64` (SPEC-040 §T2 D6 — predates T3):

> `buildAssessPrompt` (v5) is now frozen as `ASSESS_TEMPLATES[5]` — kept for
> provenance/regression, **no byte-identical guarantee required going forward**, but its
> EXISTING tests must stay green.

Four clauses: (1) v5 is frozen AS A REGISTRY SLOT — key 5 is never renumbered or repurposed;
(2) its purpose is provenance/regression; (3) output byte-identity is EXPLICITLY disclaimed;
(4) the only binding obligation is that its existing tests stay green.

So "frozen" means slot-frozen, not output-frozen. The second JSDoc site (`:1011`) keeps the
distinction correctly: slot 6 is "the FROZEN pre-projection v6 entry … so `getAssessTemplate(6)`
stays reproducible forever", while slot 5 is only "the frozen v5 entry … kept for provenance"
— it makes NO reproducibility claim.

## ⛔ Two corrections to this task's earlier framing (author's own errors, corrected 2026-08-01)

**CORRECTION 1 — there is NO AC conflict.** The earlier version of this task claimed freezing
v5 would put AC-AEP-4 in conflict with AC-AEP-9. It would not. Measured bindings:

| function | renderer bound | registry slot |
|---|---|---|
| `buildAssessPrompt` (:513) | `renderTaskEvidence` (projected) | **5** |
| `buildAssessPromptV6` (:962) | `renderTaskEvidence` (projected) | not registered |
| `buildAssessPromptV7` (:979) | `renderTaskEvidence` (projected) | **7** |
| `buildAssessPromptV6Frozen` (:999) | `renderTaskEvidenceV6Frozen` (frozen) | **6** |

AC-AEP-4 constrains the two FUNCTIONS `buildAssessPrompt` and `buildAssessPromptV6` — both
projected, both unfrozen. Slot 6 binds a different function entirely. Freezing slot 5 means
adding a `buildAssessPromptV5Frozen`; AC-AEP-4 is untouched. **The "knot" was not real.**

**CORRECTION 2 — the SSOT citation was misattributed.** This task previously cited
`ai-provider-service.ts:457` as stating that a template and its stamped `prompt_version` "can
never drift apart (SSOT)". That comment lives at `:515` and is about `GENERATE_PROMPT_VERSION`
and the GENERATE templates, not assess. It only remarks "same precedent as assessPlan's
getAssessTemplate call below" — assess follows the same PATTERN, but no explicit SSOT invariant
is written for the assess path. So the argument "an explicit invariant is being violated" does
not hold and must not be reused.

## What the REAL remaining question is

Narrower than previously stated, and it is a policy call, not a defect:

`prompt_version` IS persisted into every assessment's provenance
(`packages/core/src/assessment.ts:214`) and printed in its report (`:1412`). Clause (3) above
means a reader who sees `prompt_version: 5` cannot reproduce that rendering — and after T3,
slot 5's output genuinely changed. That is PERMITTED by the policy as written. The question is
whether the permission should stand now that the version is a persisted provenance field.

Three options, no conflicts among them:

- **(a) Keep the policy.** Slot 5's output may drift; that is the documented intent. Then make
  the disclaimer visible WHERE the version is persisted (`assessment.ts` around `:214`), not
  only in the template module — a reader of an assessment doc is the person misled, and they
  never open `assess-template.ts`.
- **(b) Freeze slot 5** by adding `buildAssessPromptV5Frozen` bound to a
  `renderTaskEvidenceV5Frozen` captured from `a639485^`, mirroring exactly what T5 did for
  slot 6. No AC amendment needed (per Correction 1).
- **(c) Remove key 5** if nothing resolves version 5 for a live judge call. Requires
  confirming that first, and deciding what `getAssessTemplate(5)` then returns for a
  historical assessment doc that stamped 5.

Also worth settling while here: the two JSDoc sites use "frozen" in two different senses three
lines apart. Whichever option is chosen, disambiguate the word — say "slot-stable" vs
"output-frozen" — because this ambiguity is what produced both of the corrections above.

## Oracle

- The chosen option is pinned by a test extending
  `packages/lore/tests/unit/ai/assess-prompt-version-freeze.test.ts` to cover
  `getAssessTemplate(5)`, RED first.
- CONTROL: slot 6's freeze (AC-AEP-9) stays green and byte-identical.
- CONTROL: slot 7 keeps rendering the projected shape (AC-AEP-10 green).
- CONTROL: AC-AEP-4 stays green — if it does not, the change touched the two unfrozen
  functions, which no option above requires.
- If (a): a test asserts the disclaimer is reachable from the assessment-doc side, not only
  from the template module.


## Proxy / Silence / Opt-in — ADR three-question review (2026-08-01, agent:main-orchestrator)

Answered per `adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the`. This task is a
POLICY CALL, not a defect — the three questions still apply, and they select an option.

**Verdict: option (a), plus one GENERALIZATION the three options above do not offer.**

**Q1 Proxy — the gap is real, KNOWN, and ACCEPTED BY DESIGN; only its disclosure site is wrong.**
`prompt_version: 5` in an assessment's provenance is a proxy for "this rendering is
reproducible". The policy at `assess-template.ts:62-64` explicitly disclaims output byte-identity
for slot 5, so the proxy gap is accepted deliberately — and per the ADR, an accepted gap must be
NAMED WHERE THE READER IS. It is currently named in the template module, while the person misled
is the reader of an assessment doc, who never opens that file. Concrete input satisfying the
proxy while violating the property: any assessment stamped `prompt_version: 5` before commit
`a639485`, re-rendered today — slot 5's output genuinely changed at T3.

**Q2 Silence — `getAssessTemplate(5)` returns a drifting template with no signal that it drifts.**
Required: reproducibility becomes a FIRST-CLASS FIELD of the registry entry (`reproducible:
false` on slot 5; `true` on slots 6 and 7), stamped into provenance next to `prompt_version`
(`packages/core/src/assessment.ts:214`) and rendered in the report (`:1412`).
**This is why option (a) beats option (b).** Freezing slot 5 (option b) fixes exactly one slot
and postpones the identical ambiguity to slots 8, 9, …; a per-slot reproducibility field is
correct for every future slot at once, and it makes the drift permission legible instead of
merely permitted. Option (c) (remove key 5) is REJECTED: a historical assessment doc that
stamped 5 must still resolve to something.

**Q3 Opt-in — n/a.** No floor, no predicate, nothing to opt into.

**Vocabulary, to be settled in the same slice.** `assess-template.ts:62` and `:1011` use "frozen"
in two different senses three lines apart (slot-stable vs output-frozen). That ambiguity produced
BOTH of this task's own corrections above — it has already cost two wrong conclusions by the
same author. Rename in code and JSDoc: `slot-stable` for key permanence, `output-frozen` for
byte-identity. The new `reproducible` field then carries the meaning, and the adjective stops
having to.
