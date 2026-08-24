---
id: SPEC-148
type: spec
role: spec
title: "Phase writes are version-less BY DESIGN (SPEC-023) — the root CLAUDE.md lifecycle paragraph contradicts it, and the premise that phase history is dispensable has moved"
status: approved
priority: medium
created: 2026-08-24
updated: 2026-08-24
tags: []
parent: PRD-001
---
## Overview/Goal

⛔ CORRECTED 2026-08-24, same day this spec was created. The first version framed the
version-less phase write as a DEFECT and prescribed routing it through the version-logging
path. That was wrong: the behaviour is a DELIBERATE, documented decision, and this spec had
not read its rationale before indicting it.

The fence and its reason, both measured in source:

- `packages/lore/src/service/phase-service.ts:5` — "Phases are soft groupings stored in
  `plan.extra.phases` … They are NOT a doc type — no ID, no lifecycle, **no version
  history**." Source: SPEC-023 §4, §9.1.
- `packages/lore/src/service/ac-service.ts:8` — AC declarations "ride the parent spec's own
  version log (**unlike PhaseService's version-less writes** — AC declarations are
  judge-consumed data (SPEC-026/038), so history matters more here)."

So the asymmetry was reasoned, written down at BOTH sites, and traced to a spec. What
remains true after reading it is narrower and different from a bug report.

### What actually survives

**S1 — a documentation falsehood, not a code defect.** The root `CLAUDE.md` Document
Lifecycle paragraph states: "Editing an `approved` doc resets it to `draft` automatically —
content/title AND `extra`". Measured on an approved plan: `lore phase add` changed
`extra.phases`, the plan stayed `approved`, and `lore log` gained no row. The code is doing
what SPEC-023 decided; the memory file asserts a universal that was never universal.

**S2 — the decision's premise deserves re-examination, on the record.** SPEC-023 justified
version-less writes by calling phases "soft groupings". Since then `extra.phases[]` became
load-bearing for governance: `taskExtraSchema.phase` is validated cross-entity against the
MEMBER plan's `phases[].name`; `lore ready` groups by it; the plan-close family reasons over
"every child task archived", where an EMPTY phase is exactly the vacuous-truth case. ⛔ That
is a question about whether a past trade-off still holds — NOT evidence that it never did.

**S3 — what this spec measured and must NOT overclaim.** Sibling `extra` writers were
measured in a throwaway corpus (`mktemp -d` + `lore init`, deleted after — never this repo's
live `.lore/`): `lore anchor add` v1→v2, `lore scope add` v2→v3, `lore red-first` v3→v4, and
`phase add`/`phase rm` stayed at v1. Those numbers stand. ⛔ The INFERENCE originally drawn
from them — "five siblings log, so this one forgot" — does not: `ac-service.ts:8` names the
distinction on purpose.

⛔ Also not a defect, checked before asserting: `DocType` does include `"phase"`
(`packages/core/src/types.ts:19`) and `lore gate phase-claim` exists (SPEC-056), so "phase"
names TWO things — `plan.extra.phases[]` soft groupings and a `phase` DOC TYPE (of which this
corpus currently holds zero). `phase-service.ts:5` is about the former and remains true of it.
An earlier reading of this spec's own draft treated that comment as stale; it is not.

## Scope

In: reconciling S1 — the lifecycle paragraph must stop asserting a universal that three
writers already break (`ac add`, `phase add`, `phase rm`). Either it enumerates the
exceptions or it states the rule narrowly.

In: forcing S2 to be DECIDED AND RECORDED rather than left implicit — whether phase-set
history is still dispensable now that phase names gate task validation and plan-close
reasoning. ⛔ This spec deliberately does not pick the answer; picking it here would
re-litigate SPEC-023 without its authors' inputs. What it refuses is leaving the question
unasked while the premise has visibly moved.

Out: ⛔ changing `PhaseService`'s write path as a foregone conclusion. That is what the
corrected version of this spec exists to prevent. Any such change must first record why
SPEC-023's rationale no longer holds.

Out: `renamePhase` — UNMEASURED. It shares the family and is presumed version-less, but
presuming a neighbour's behaviour is the exact error this spec already made once.

Out: F1–F5 of `knowledge-five-governance-findings-measured-while-closing-the`. F1 is owned by
`spec-lore-issues-falls-through-to-the-local-corpus-on-a`.

## Module Boundary

- Read-only for this spec: `packages/lore/src/service/phase-service.ts` (`addPhase`,
  `removePhase`, `renamePhase` — all write via `this.store.update` with no `insertVersion`,
  ⛔ by design, contrast `ac-service.ts`'s `insertVersion` at its own documented rationale).
- The artifact this spec DOES change is the root `CLAUDE.md` Document Lifecycle paragraph,
  plus whatever record S2's decision lands in (an ADR is the natural home if the answer is
  "revisit"; `lore create adr`).
- ⛔ If S2 ever resolves toward versioning phase writes, the demotion half MUST call
  `resolveStatusAfterContractEdit` (`packages/core/src/schemas.ts`) rather than writing a
  `"draft"` literal — the demotion-rule SSOT test already pins that contract for its two
  existing callers.

## Design Decisions

| # | Decision | Choice | Rejected | Rationale |
|---|---|---|---|---|
| D1 | What is wrong here | the DOCUMENTATION (S1); the code follows SPEC-023 | "the writer forgot to log" | measured: both sites document the asymmetry and give its reason |
| D2 | The premise question | ask it explicitly, record the answer, do not answer it here | silently re-implement, or silently drop it | re-litigating SPEC-023 inside a defect spec would decide a trade-off without engaging its authors |
| D3 | Oracle shape | assert the DOC now matches measured behaviour, not that behaviour changed | assert a version row appears | asserting a row would hard-code the outcome D2 refuses to pick |
| D4 | `renamePhase` | MEASURE before any claim | assume it matches add/rm | this spec already made that error once, in its own first version |

## Risks

- ⛔ The strongest risk is this spec's own first version: a defect spec that reads plausibly
  while indicting a deliberate design. Anything that reintroduces "route it through the
  versioning path" as settled must be refused until D2 is recorded.
- If S2 resolves toward versioning, every existing workflow that adds a phase to an approved
  plan may start requiring re-approval — a real behaviour change, and the reason D2 exists.
- The back-catalogue is unrecoverable either way: phase mutations already applied left no
  rows. Anywhere plan version history is presented as complete, that limit MUST be stated.

## Acceptance Criteria

Typed ACs authored via `lore ac add` (script mode). Coverage contract: the lifecycle
paragraph in the root `CLAUDE.md` must be assertable against measured behaviour — a check
that the paragraph does NOT claim `extra` edits universally demote, paired with a live
measurement that `phase add` against an approved plan leaves status and version log
untouched, so the doc and the code are pinned to agree. Plus a MEASURED verdict for
`renamePhase`, and a recorded decision artifact for S2.


## Acceptance Criteria (structured)

- [·] [script] AC-PHASEVER-1: The lifecycle paragraph and the measured behaviour are pinned to AGREE, in either direction. The suite asserts BOTH halves in one run: (a) the root CLAUDE.md Document Lifecycle paragraph does NOT assert that editing an approved doc's extra universally resets it to draft — three writers already break that universal (lore ac add, phase add, phase rm); and (b) a LIVE measurement in a throwaway corpus (mkdtemp + lore init, never this repo's .lore/) that 'lore phase add' against an APPROVED plan leaves both its status and its version-row count unchanged. ⛔ Half (b) asserts CURRENT behaviour on purpose: this criterion must NOT presuppose that phase writes start logging, because D2 explicitly declines to decide that. If S2 later resolves toward versioning, this AC is re-baselined then, with the reason recorded. Baseline measured 2026-08-24: status stayed approved, log stayed at v1, and the paragraph did assert the false universal — so half (a) is red today and half (b) green.
  script: test — bunx vitest run packages/lore/tests/integration/phase-write-lifecycle-doc-parity.test.ts 2>&1 && echo 'AC-PHASEVER-1 PASS: the lifecycle paragraph claims no universal extra-demotion AND phase add against an approved plan was measured to leave status and version count untouched'
- [·] [script] AC-PHASEVER-2: renamePhase is MEASURED, and S2's premise question has a recorded answer. Two conjuncts: (a) a live throwaway-corpus measurement of 'lore phase rename' against an approved plan, asserting its status and version-row behaviour explicitly — ⛔ D4 forbids assuming it matches add/rm, and this spec's own first version is the cautionary case for assuming a neighbour's behaviour; and (b) an ADR exists, linked to this spec, recording whether SPEC-023's 'phases are soft groupings, history is dispensable' rationale still holds now that extra.phases[] gates taskExtraSchema.phase cross-entity validation, lore ready's grouping, and plan-close's every-child-archived reasoning. ⛔ Either answer satisfies (b); an ABSENT answer does not. The oracle asserts the ADR is reachable from this spec and that its decision_status is 'accepted', never that it reached a particular conclusion — this spec declines to pick, and an oracle that demanded one outcome would decide by the back door.
  script: test — bunx vitest run packages/lore/tests/integration/phase-write-lifecycle-doc-parity.test.ts -t 'rename measured and premise recorded' 2>&1 && echo 'AC-PHASEVER-2 PASS: phase rename status/version behaviour measured explicitly, and an accepted ADR linked to this spec records the SPEC-023 premise verdict either way'
