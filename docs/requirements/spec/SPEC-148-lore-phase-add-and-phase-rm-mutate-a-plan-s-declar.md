---
id: SPEC-148
type: spec
role: spec
title: "lore phase add and phase rm mutate a plan's declared phases with no version row, so a review stays current for a document that changed"
status: approved
priority: medium
created: 2026-08-24
updated: 2026-08-24
tags: []
parent: PRD-001
---
## Overview/Goal

`lore phase add` and `lore phase rm` mutate a plan's `extra.phases` and write NO row to the
version log. Measured 2026-08-24 in a THROWAWAY corpus (`mktemp -d` + `lore init`, deleted
afterwards — never this repo's live `.lore/`): a freshly created plan sat at `v1`, a phase
was added, the phase list changed, and `lore log` still showed exactly `v1 create`. `phase rm`
behaved identically.

Every sibling `extra` writer already logs:

| Writer | Field | Version row |
|---|---|---|
| `lore anchor add` | `extra.file_anchors` | v1 → v2 |
| `lore scope add` | `extra.ac_scope` | v2 → v3 |
| `lore red-first` | `extra.red_first` | v3 → v4 |
| `lore ac add` / `ac set` | spec criteria | logged (`ac set` also demotes) |
| **`lore phase add` / `phase rm`** | `extra.phases` | **none** |

⛔ Scope is therefore ONE command family, not the `extra`-writer class. The five siblings are
the green control: the version-logging write path exists and works; `phase add`/`rm` does
not use it.

## Scope

In: `lore phase add`, `lore phase rm`, and `lore phase rename` (same writer family, same
suspicion — ⛔ rename is UNMEASURED as of this spec and MUST be measured before the fix, not
assumed) routed through the same version-logging write path the sibling `extra` writers use.

In: forcing the demotion question to be DECIDED AND RECORDED — by the implementing plan, not
here. ⛔ This spec deliberately does not pick the answer, because either answer is defensible
and picking one here would settle a behaviour change without the measurement D4 demands;
what it does refuse is a third silent exception. AC-PHASEVER-2 is the enforcement: it pins
BOTH branches and fails a run that asserts neither. The root `CLAUDE.md` Document Lifecycle
paragraph claims "editing an `approved` doc resets it to `draft` — content/title AND
`extra`". That is already false for `lore ac add` (documented) and false for this family
(measured: an approved plan stayed `approved`). Either this family demotes like `ac set`, or
the lifecycle paragraph names it as a documented exception. ⛔ Deciding by omission is what
produced the current state.

Out: changing what a phase IS, phase schema limits (`phases[]` max 30, unique name), and the
`taskExtraSchema.phase` cross-entity validation — all already specified elsewhere.

Out: the other four findings recorded alongside this one in
`knowledge-five-governance-findings-measured-while-closing-the` (F1–F5). F1 is already owned
by `spec-lore-issues-falls-through-to-the-local-corpus-on-a`.

## Module Boundary

- The phase writers live in the CLI adapter's `phase` command family; the corpus write they
  must route through is the same `CorpusService` path that versions every other `extra`
  mutation. ⛔ The fix belongs in the SERVICE layer, not in the CLI command, so MCP and HTTP
  callers get it identically — the standing rule that gates and lifecycle effects run in the
  service layer applies here.
- No new public type. `VALID_TRANSITIONS` and `resolveStatusAfterContractEdit`
  (`packages/core/src/schemas.ts`) already own the demotion rule; if this family demotes, it
  MUST call that function rather than writing a `"draft"` literal — the demotion-rule SSOT
  test already pins that contract for its two existing callers.

## Design Decisions

| # | Decision | Choice | Rejected | Rationale |
|---|---|---|---|---|
| D1 | Where the fix lands | service-layer write path shared with sibling `extra` writers | patch the CLI command | CLI-only leaves MCP/HTTP writes unversioned; gates and lifecycle effects belong in the service layer |
| D2 | Demotion | decide EXPLICITLY in this spec's implementation, and record whichever way in the lifecycle paragraph | leave as-is | "decided by omission" is the defect's own cause; a third silent exception is worse than either answer |
| D3 | Oracle shape | assert a version ROW appears, not that prose says so | assert the CLI prints a version number | the printed `(vN)` is a render; the log is the artifact a later session reads |
| D4 | `phase rename` | MEASURE before fixing | assume it behaves like add/rm | assuming the neighbour's behaviour is exactly the over-broad framing F1 cost us |

## Risks

- Adding version rows changes `lore log`/`lore diff` output for plans, which some AC oracles
  may pin by count. ⛔ Grep for tests asserting a plan's version count before landing.
- If the family is made to demote, every existing workflow that adds a phase to an approved
  plan starts requiring re-approval. That is a real behaviour change and is the reason D2
  demands an explicit decision rather than a default.
- The back-catalogue is unrecoverable: phase mutations already applied left no rows, so no
  migration can reconstruct when they happened. This spec fixes forward only, and that
  limitation MUST be stated wherever plan version history is presented as complete.

## Acceptance Criteria

Typed ACs authored via `lore ac add` (script mode). Coverage contract: a throwaway-corpus
test that creates a plan, records its version count, runs `lore phase add`, and asserts the
count increased AND that the newest row names the phase write — paired with the sibling
green control (`lore anchor add` on a task in the same corpus) so a test that silently stops
exercising the write path cannot pass. Plus a measured verdict for `phase rename`, and,
whichever way D2 lands, an assertion on the plan's status after a phase write against an
APPROVED plan.


## Acceptance Criteria (structured)

- [·] [script] AC-PHASEVER-1: A phase write leaves a version row, proven against a sibling green control. In a throwaway corpus (mkdtemp + lore init, never this repo's .lore/): create a plan, count its version rows, run 'lore phase add', and assert the count INCREASED by exactly 1 and that the newest row's action names the phase write; then in the SAME corpus run 'lore anchor add' on a task and assert its count also increased. The sibling control is mandatory because a test that silently stops exercising the write path yields 'no new rows' for both the broken and the fixed build, and because the five sibling extra writers were measured ALREADY logging (anchor add v1->v2, scope add v2->v3, red-first v3->v4) — they are what proves the version path exists rather than being absent repo-wide. Also assert 'lore phase rm' the same way. ⛔ Assert on the version LOG, never on the CLI's printed (vN), which is a render. No falsifier is declared yet: the implementation site does not exist, and naming a literal in a file that is not written would be fabricated — declare it when the service-layer write lands.
  script: test — bunx vitest run packages/lore/tests/integration/phase-write-versioning.test.ts 2>&1 && echo 'AC-PHASEVER-1 PASS: phase add and phase rm each add exactly one version row, sibling anchor-add control also logged, assertions read the version log not the CLI render'
- [·] [script] AC-PHASEVER-2: The demotion question is answered explicitly and the third writer family is measured, not assumed. The suite asserts (a) a MEASURED verdict for 'lore phase rename' — it is UNMEASURED as of this spec and D4 forbids assuming it matches add/rm; and (b) the status of an APPROVED plan after a phase write, pinning whichever way D2 landed: either it became 'draft' via resolveStatusAfterContractEdit (⛔ never a hand-written "draft" literal — the demotion-rule SSOT test pins that contract) or it stayed 'approved' AND the root CLAUDE.md Document Lifecycle paragraph names this family as a documented exception. ⛔ A run that asserts neither branch passes vacuously and does not satisfy this criterion. Measured baseline 2026-08-24: an approved plan stayed 'approved' with no version row, so today BOTH halves are unpinned.
  script: test — bunx vitest run packages/lore/tests/integration/phase-write-versioning.test.ts -t 'demotion and rename' 2>&1 && echo 'AC-PHASEVER-2 PASS: phase rename verdict measured and the approved-plan status branch asserted per D2'
