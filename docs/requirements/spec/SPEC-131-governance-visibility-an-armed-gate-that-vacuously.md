---
id: SPEC-131
type: spec
role: spec
title: "Governance visibility: an armed gate that vacuously passes lends its authority to everything it waves through"
status: approved
priority: medium
created: 2026-08-10
updated: 2026-08-10
tags: []
parent: PRD-001
---
# Overview

Three governance surfaces in lore report an outcome that does not match the mechanism that
produced it. Each was recorded by a real session as a different defect than it actually is,
which is the pattern this spec targets: **an armed gate that vacuously passes lends its
authority to everything it waves through**, and is therefore worse than an absent gate.

# Scope

## In scope

### B1 — a vacuous plan-close pass is indistinguishable from no gate at all

⛔ The prevailing diagnosis is FALSE and correcting it changes the fix. Two independent
records — handoff-82 NS3-a and a standing rule in the root CLAUDE.md — assert that
`lore set <plan> --status archived` *"evaluates NO gate"*. Measured 2026-08-10:

- `corpus-service.ts:2029` reads
  `if (isPlanClosing && this.gateEnforcer && this.gateEnforcer.isEnabled("plan-close"))`
- `resolveGateEnabled` (`packages/core/src/config.ts:1115`) returns
  `gates?.[checkpoint]?.enabled !== false` — **enabled unless explicitly disabled**
- this repo's `.lore/config.yaml` carries a `plan-close` entry with no `enabled: false`
- the line has been present since at least `6d1b25f0` (2026-07-26)

The gate evaluates. The **cascade** is separately and deliberately ungated (documented in
place: it is a data-integrity mechanism independent of the advisory gate). The real defect is
named three lines below that comment: *"both `attestation_exempt` and
`assessment_freshness_exempt` shipped gate-read with no writer, and with the only sanctioned
opt-out unreachable, four plans were archived by riding a vacuous predicate instead."*

Deliverables:

- **B1.1** Every `plan-close` predicate reports WHY it passed. `satisfied` and
  `vacuous (no applicable data)` MUST NOT render alike, in human output and in `--json`.
- **B1.2** `tree-check-service.ts:183` prints a paste-ready
  `lore set <slug> --status archived` justified by *"The plan-close gate never evaluated it"*.
  That sentence is false under the default config. Correct the message AND the command it suggests.
- **B1.3** ⛔ SAME UNIT: the root CLAUDE.md standing rule built on the false clause is now a
  stale assertion. Locate it by grepping its wording, correct it, and phrase the replacement so
  it is mechanically checkable — name `corpus-service.ts:2029` and the vacuous-predicate
  mechanism. ⛔ Never phrase it as "fixed"; a claim with no oracle is what created this defect.

### B2 — `lore ac add` / `ac set` freeze every descendant claim in silence

`adapters/cli/commands/ac.ts:50` documents the `approved` → `draft` demotion in a CODE COMMENT
only; nothing is printed at runtime. The demotion hard-blocks EVERY descendant `claim`, so
tightening one AC silently freezes a whole plan's dispatch.

Evidence that this is not theoretical: authoring the sibling spec
`spec-oracle-executability-a-runner-s-discovery-refusal-is-not-a` required encoding an explicit
sequencing workaround around this exact behaviour. ⛔ Needing a workaround IS the signal.

Deliverable: `ac add` / `ac set` print the demotion and its blast radius (count of descendant
docs whose claims are now blocked) on the write that causes it. The demotion itself is correct
lifecycle behaviour and MUST NOT change — the silence is the defect.

### B3 — a fresh consumer install receives an empty feeding pack

`corpus-service.ts:1110` states its own posture: a missing rule-doc lookup *"leaves
ruleSource/ruleMarkdown absent — the pack degrades to `[source: unknown]`"*. The rule doc is
fetched by `findFeedingSkill(SPEC_CREATE_FEEDING_SCOPE)`, a CORPUS lookup. A project that just
ran `lore init` has an empty corpus, so the lookup always misses and the entire IoC design
("deny carries the feeding pack") degrades to a bare deny. The gate ships in the binary; the
rules that make its denial actionable do not.

`assets/governance/` already ships `claude-md-contract.md`, `corpus-workflow.md`,
`seat-briefing.md` — a distribution surface exists. Either seed the rule doc from `assets/` at
`lore init`, or compile a fallback rule slice into the binary.

⛔ The probe MUST construct BOTH ENDS — a `mkdtemp` + `lore init` corpus AND this repo's
populated corpus as a live control. A single-ended probe passes vacuously
(`knowledge-retro-a-fresh-install-probe-vacuously-passes`). ⛔ Never write to this repo's `.lore/`.

## Out of scope

- **Changing the plan-close cascade's ungated design.** It is deliberate and documented; B1
  makes its outcome legible, it does not re-gate it.
- **Changing the `approved` → `draft` demotion itself.** Correct lifecycle behaviour; only its
  silence is in scope.

# Acceptance Criteria

Declared structurally via `lore ac add` (AC-GV-1..5). Each carries a named way to make it red.


## Acceptance Criteria (structured)

- [⚑] [script] AC-GV-1: DATA LAYER: checkPlanClose emits, for every plan-close predicate, a distinct machine-readable discriminator separating a vacuous pass (no applicable data) from a satisfied one — asserted on the returned verdict objects. RED: make a vacuous predicate return a bare {ok:true} and this fails. ⛔ Re-baselined 2026-08-10 after lore assess rated the prior single-AC version a MAJOR outcome gap: it spanned BOTH this data layer and the render surface, while its oracle (plan-close-predicate-provenance.test.ts -t vacuous-vs-satisfied, attested pass, exit 0, 7/7) only ever asserted checkPlanClose's returned objects and JSON.stringify of those same objects — so the render half passed by assumption. Scope narrowed to what the oracle actually measures; the render half moved to AC-GV-6, which is purely additive. Nothing was removed.
  script: test — bunx vitest run packages/lore/tests/unit/service/plan-close-predicate-provenance.test.ts -t vacuous-vs-satisfied
- [⚑] [script] AC-GV-2: tree-check-service no longer emits the sentence claiming the plan-close gate never evaluated a doc, and the command it suggests is one whose gate behaviour matches the surrounding justification. RED: restore the old wording and the assertion on the emitted message fails.
  script: test — bunx vitest run packages/lore/tests/unit/service/tree-check-service.test.ts -t plan-close-hint-wording
- [⚑] [script] AC-GV-3: The root CLAUDE.md no longer asserts that lore set --status archived evaluates no gate; the replacement text names corpus-service.ts:2029 and the vacuous-predicate mechanism, so a future reader can verify it mechanically. RED: the assertion must fail while the old wording is still present anywhere in the file.
  script: other — test $(grep -c 'evaluates NO gate' CLAUDE.md) -eq 0 && grep -q 'corpus-service.ts:2029' CLAUDE.md
- [⚑] [script] AC-GV-4: lore ac add and lore ac set each print the approved-to-draft demotion AND a count of descendant docs whose claims the demotion now blocks, on the write that causes it. A write that does NOT cause a demotion prints neither. RED: the second half is load-bearing — an unconditional notice would pass a naive assertion while training readers to ignore it.
  script: test — bunx vitest run packages/lore/tests/unit/adapters/ac-demotion-notice.test.ts -t demotion-blast-radius
- [⚑] [script] AC-GV-5: A spec-create denial in a FRESH mkdtemp + lore init corpus carries a non-empty rule slice with a named source (never [source: unknown]), AND the same denial in this repo's populated corpus — used as a live control in the same test run — is also non-empty. ⛔ Both ends are required: a single-ended probe passes vacuously. The test MUST NOT write to this repo's own .lore/.
  script: test — bunx vitest run packages/lore/tests/unit/service/gate-feeding-fresh-install.test.ts -t both-ends
- [⚑] [script] AC-GV-6: SURFACE LAYER: the plan-close gate's USER-FACING output distinguishes a vacuous pass from a satisfied one in BOTH the human render and the --json payload — asserted by driving the actual CLI/render path, never by re-serialising the predicate objects the data layer already returns. RED: make the renderer print both cases identically (or drop the discriminator from the --json payload) and this must fail. ⛔ This AC exists because the prior AC-GV-1 covered this layer only by assumption — see its own re-baseline note. ⛔ Asserting on JSON.stringify of checkPlanClose's return value does NOT satisfy this criterion; the oracle MUST exercise the surface a human or a --json consumer actually reads.
  script: test — bunx vitest run packages/lore/tests/unit/adapters/plan-close-render-provenance.test.ts -t surface-discriminator
