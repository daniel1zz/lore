---
id: SPEC-103
type: spec
role: spec
title: "Tiered review — ledger fast-track, judgment-required promote, pending-as-promises"
status: approved
priority: medium
created: 2026-07-28
updated: 2026-07-28
tags: []
parent: PRD-001
links:
  - {id: SPEC-094, type: informs}
  - {id: SPEC-094, type: implements}
---
## Overview/Goal

Measured reality (grill review + cross-corpus retro, 2026-07-28): the last 40 approvals on this corpus are the writer-side orchestrator self-approving; SPEC-034's judgment machinery is landed but `judgment: null` everywhere; ledger-shaped system docs (assessments/retros/handoffs) sit in the pending queue that no one reviews (28 here, 147 in babyai, 3 orphaned handoffs in guyin); in guyin, escalate judgments block nothing — "advisory-everything decays to ignored".

Goal: make `approved` mean something again by splitting the review surface in two — ledger RECORDS exit the review pipeline (their trust source is writer identity + the tamper-evident audit chain), durable PROMISES (spec/adr) cannot be approved without independent judgment. This spec fixes queue integrity and self-certification ONLY. It deliberately does NOT fix the consumption gap (nobody reads assessments/handoffs) — that is measured by the trace layer (SPEC-102) and addressed by §14's L1 feed-forward when its preconditions land. Upstream: `knowledge-grill-review-2026-07-28-seven-product-direction` decision 4 (refined here: judgment independence replaces actor-string distinctness, which is trivially forgeable by exporting a different LORE_ACTOR).

## Scope

IN: M1 ledger fast-track (knowledge sub_types assessment/retro/handoff/uat ONLY — task type is EXCLUDED, see D1); M2 judgment-required promote for durable types (default spec+adr) with anti-lottery worst-decision-wins protocol and I1 provenance check; M3 pending-queue default filter; ai_provenance recording at the AI-generation seam; one-shot idempotent ledger backfill verb; config kill-switches restoring legacy behavior exactly.

OUT: any change to task lifecycle (TaskWorkflowService untouched — tasks never belonged to the review-object universe; adversarial finding L1 confirmed claim/done have implicit draft preconditions); §14 staged-unlock machinery for durable types (unchanged, still data-gated); human sampling floors / calibration accumulation (SPEC-035 R2 territory); handoff consumption wiring; new trace kinds (approve analytics read the existing audit table).

## Mechanisms

### M1 — Ledger fast-track (knowledge assessment/retro/handoff/uat)

- `CorpusService.create` for these sub_types transitions draft→approved in the SAME write (legal fast-track transition), audited with `details.auto = "ledger-fast-track"`.
- Edits to an approved ledger doc keep uniform edit-reset semantics: reset-to-draft THEN re-fast-track-to-approved, both audited — version history stays consistent with every other type (adversarial finding L3: no special-cased status rule, one extra audit row instead). CORRECTED 2026-07-28 (P3-hardening, verified against `corpus-service.ts`): these are TWO separate, individually-atomic writes, NOT one transaction — the original 'atomically' wording here was false. Accepted residual: a crash between them leaves the doc `draft` at the reset version carrying only the untagged update audit row; the next edit or an explicit approve heals it. This mirrors `ReviewService.approve`'s own documented residual-window precedent. Making it one write would require a new cross-write StoreInterface primitive — deliberately not built for a self-healing residual.
- Handoff trust caveat (adversarial finding F4): handoffs carry forward-looking directives, not just facts. They stay in the ledger set (session-resume consumption is direct-address and already shows by/at provenance), but the session-resume feed pack MUST label them `writer-asserted, unreviewed`. Feed trust labels are part of this spec.
- Backfill: `lore review backfill-ledger` — idempotent one-shot that fast-tracks EXISTING draft ledger docs (29 on this corpus), so post-M1 state is uniform (adversarial finding L4).

### M2 — Judgment-required promote (durable types, default spec+adr)

- `ReviewService.approve` for a type in `workflow.review.judgment_required_types` additionally requires a ReviewJudgment row (SPEC-034 table, `lore review <doc>`) for the CURRENT doc version with `decision = 'approve'`. Deny is a gate deny (exit 4) whose feeding pack names the exact command: `lore review <doc>`.
- **Anti-lottery protocol (adversarial finding F2, guyin escalate-ignored evidence)**: judgments for the same doc version are monotone — the gate evaluates the WORST decision recorded for that version (reject > escalate > approve). A reject/escalate on version N cannot be outrolled by re-running the judge on version N. Unlock paths: (a) edit the doc addressing findings (version bump) + fresh approve-judgment, or (b) an audited, named escape — the escalation-to-human protocol — in TWO forms, because the denial has two distinct shapes: `lore approve --override-judgment <id>` overrides a specific recorded judgment (audit records the overridden judgment id), while `lore approve --override-no-judgment` covers the NO_JUDGMENT denial, which by definition has no id to name (audit records `override_no_judgment: true`). The second form is legal ONLY when the doc has zero judgments recorded at all — a doc carrying even a stale-version judgment is rejected loud and pointed at `--override-judgment`. The two flags are mutually exclusive. THIRD SHAPE, answering a review-judgment escalation (2026-07-28): a doc carrying judgments only on PRIOR versions and none on the current one is covered by `--override-judgment <id>` — the id is validated against every judgment recorded for the doc, deliberately including older versions, since the blocking judgment is frequently the stale one (verified in `review-service.ts`). So all three denial shapes have a sanctioned, audited escape and none falls through to `LORE_GATE_BYPASS`. (Added 2026-07-28 P3-hardening: the original single-flag design made the escape unreachable for the most common denial — a never-judged doc — which is exactly the case the escape exists for.)
- **I1 provenance (adversarial finding F3)**: AI-generated docs record `extra.ai_provenance = {provider, model, prompt_version}` at the AIProviderService generation seam. When present, a judgment whose judge tuple equals the authoring tuple is treated as non-existent for gate purposes (deny names the collision). When absent (human/agent-typed docs), the check is N/A and only judgment-required applies — the spec does NOT claim author-independence for provenance-less docs.
- AI availability (adversarial finding L2): `lore review` defaults AI-on on every surface and has no non-AI mode, so agent surfaces CAN produce judgments. Environments with no AI provider at all must either disable via config (visible, auditable drift) or use the existing audited `LORE_GATE_BYPASS` escape. Fail-loud beats silent self-approval; no implicit skip.

### M3 — Pending = promises

- `lore pending` default excludes: task type + ledger knowledge sub_types. `lore pending --all` restores the full draft list (help text states exactly what the default hides). Type/author/since filters unchanged.

### Config (LoreConfigSchema, workflow.review.*)

- `ledger_auto_approve: boolean` (default true)
- `judgment_required_types: string[]` (default `["spec","adr"]`)
- Both at legacy values (`false`, `[]`) → behavior byte-identical to today.

## §14 reconciliation (amendment, adversarial finding F1)

Ledger sub_types are EXEMPT from §14's staged-unlock state machine entirely: they exit the review-object universe, so there is no approval decision to automate and no calibration data to accumulate for them — by design, not by omission. §14's shadow→assist→auto machinery continues to govern durable types unchanged; M2 is I1's deterministic enforcement arriving early, not a replacement for data-gated unlock. This spec `informs` the domain overview; the domain overview's §14.4 I1 row gains a pointer here.

## Design Decisions

| ID | Decision | Rationale | Dissent recorded |
|---|---|---|---|
| D1 | task type excluded from M1 | claim/ready/done have implicit draft preconditions (task-workflow-service walk); approved-at-create silently corrupts the archive walk and readiness | original grill decision included tasks; lifecycle review refuted |
| D2 | judgment independence, not actor-string distinctness | same orchestrator can export any LORE_ACTOR — actor names are theater; hermetic-judge process independence (SPEC-030) is real | grill decision 4 phrased as writer≠approver; refined |
| D3 | worst-decision-wins per version | deterministic anti-lottery; re-roll cannot flip a reject; override is explicit + audited | none |
| D4 | uniform edit-reset + re-fast-track (two audited writes, NOT one transaction — see M1) | version history semantics stay type-uniform; one extra audit row plus a self-healing crash residual is the cost | bypass-the-reset alternative rejected (history inconsistency); single-transaction alternative rejected (needs a new cross-write store primitive) |
| D5 | no implicit AI-off skip of M2 | an implicit skip recreates silent self-approval exactly where it happens most (agent surfaces) | lifecycle reviewer proposed skip-when-AI-absent; rejected, config/bypass are the explicit paths |
| D6 | consumption gap explicitly out of scope | wrong-bottleneck finding (F5) is correct: approval ceremony does not make anyone read assessments; trace (SPEC-102) measures consumption, L1 feed-forward addresses it | none |

## As-built reality of I1 (measured 2026-07-28, P3-hardening)

`ai_provenance` is stamped ONLY when the active provider can report a real model id, via the structural `ModelAwareProvider` capability. It is deliberately OMITTED — never filled with the provider name — when it cannot. Consequence on this repo's own corpus, stated plainly rather than left for a reader to discover: the active provider is `claude-cli`, which shells out to `claude -p` and genuinely cannot know which model served the call, so `ai_provenance` is absent on every doc generated here and **I1 collision detection is N/A for them**. What actually protects those docs is the judgment-required gate (M2) alone. The earlier implementation stamped `{provider, model: <provider name>, prompt_version: "v1"}`, which looked like provenance and could never meaningfully collide — a dishonest tuple is worse than an honest absence.

## Adoption / migration note (default-on blast radius)

M2 ships default-ON for `spec` and `adr`. On any existing corpus this immediately denies `lore approve` for those types until a current-version approve-judgment exists — including in automation that previously approved unattended. Landing it here required amending eight pre-existing test fixtures, which is the honest measure of the blast radius. Adopters have three sanctioned paths: run `lore review <doc>` before approving (the intended flow), narrow `workflow.review.judgment_required_types` (visible, auditable config), or use the audited override flags above. `LORE_GATE_BYPASS` remains the last resort and stays audited.

## AC register vs. this document (structural note, 2026-07-28)

The P3-hardening corrections above changed WORDING that two already-registered ACs carry: AC-TIER-2 says "atomic reset + re-fast-track" and AC-TIER-5 predates `--override-no-judgment`. Those registrations cannot be edited, by design: `lore ac rm` refuses an AC that evidence references, and `lore ac add` refuses a duplicate id (both measured 2026-07-28) — evidenced ACs are immutable so a passing oracle can never be retro-fitted to a changed claim. The resolution is additive and is what the register now reflects: their COMMANDS (the enforceable part) were always correct and still pass unchanged, because the corrections were to prose, not to verified behavior; and the genuinely NEW behavior got its own enforceable ACs — AC-TIER-9 (the `--override-no-judgment` escape, all three cases) and AC-TIER-10 (`ai_provenance` real-model-id-or-omission). Where this document and an older AC statement disagree, THIS document is binding and the AC's command is the oracle.

## Acceptance Criteria

Structured ACs via `lore ac add` (script:test):

- AC-TIER-1 ledger create: creating knowledge assessment/retro/handoff/uat lands status=approved in the same write with a `ledger-fast-track` audit row; creating spec/adr/prd and knowledge reference/research/ideation lands draft.
- AC-TIER-2 ledger edit: editing an approved ledger doc ends approved (reset + re-fast-track, both audited — two writes, see D4); editing an approved spec still resets to draft.
- AC-TIER-3 pending filter: default `lore pending` excludes task + ledger sub_types; `--all` restores them.
- AC-TIER-4 judgment gate: approve of a spec with zero judgments for the current version exits 4 naming `lore review`; after an approve-judgment for the current version, approve succeeds.
- AC-TIER-5 anti-lottery: with a reject judgment on version N, a later approve-judgment on version N still denies; version bump + fresh approve-judgment approves; `--override-judgment <id>` approves with an audit row recording the overridden judgment id; `--override-no-judgment` approves a never-judged doc with an audit row recording `override_no_judgment: true`, and is rejected loud on a doc that has any judgment.
- AC-TIER-6 provenance: a doc with extra.ai_provenance equal to the judgment's judge tuple denies naming the collision; a provenance-less doc passes on judgment-required alone.
- AC-TIER-7 kill-switches: ledger_auto_approve=false and judgment_required_types=[] reproduce legacy behavior (ledger docs land draft; spec approve needs no judgment).
- AC-TIER-8 backfill: `lore review backfill-ledger` fast-tracks existing draft ledger docs exactly once; a second run is a no-op reporting zero changes.


## Acceptance Criteria (structured)

- [⚑] [script] AC-TIER-1: Creating knowledge assessment/retro/handoff/uat lands status=approved in the same write with a ledger-fast-track audit row; spec/adr/prd and knowledge reference/research/ideation land draft
  script: test — bunx vitest run packages/lore/tests/unit/service/tiered-review.test.ts -t AC-TIER-1
- [⚑] [script] AC-TIER-2: Editing an approved ledger doc ends approved via atomic reset + re-fast-track (both audited); editing an approved spec still resets to draft
  script: test — bunx vitest run packages/lore/tests/unit/service/tiered-review.test.ts -t AC-TIER-2
- [⚑] [script] AC-TIER-3: Default lore pending excludes task type and ledger sub_types; --all restores them
  script: test — bunx vitest run packages/lore/tests/unit/service/tiered-review.test.ts -t AC-TIER-3
- [⚑] [script] AC-TIER-4: Approve of a spec with zero judgments for the current version exits 4 naming lore review; with a fresh approve-judgment for the current version approve succeeds
  script: test — cd packages/lore && bun test tests/integration/cli/tiered-review-gate.bun.test.ts -t AC-TIER-4
- [⊘] [script] AC-TIER-5: Worst-decision-wins per version: reject on version N cannot be outrolled by a later approve-judgment on N; version bump + fresh approve-judgment approves; --override-judgment approves with audit row recording overridden judgment id
  script: test — cd packages/lore && bun test tests/integration/cli/tiered-review-gate.bun.test.ts -t AC-TIER-5
- [⚑] [script] AC-TIER-6: Judgment whose judge tuple equals doc extra.ai_provenance denies naming the collision; provenance-less doc passes on judgment-required alone
  script: test — bunx vitest run packages/lore/tests/unit/service/tiered-review.test.ts -t AC-TIER-6
- [⚑] [script] AC-TIER-7: ledger_auto_approve=false and judgment_required_types=[] reproduce legacy behavior byte-identically
  script: test — bunx vitest run packages/lore/tests/unit/service/tiered-review.test.ts -t AC-TIER-7
- [⚑] [script] AC-TIER-8: lore review backfill-ledger fast-tracks existing draft ledger docs exactly once; second run is a no-op reporting zero changes
  script: test — cd packages/lore && bun test tests/integration/cli/tiered-review-gate.bun.test.ts -t AC-TIER-8
- [⚑] [script] AC-TIER-9: lore approve --override-no-judgment approves a never-judged doc and writes an audit row carrying override_no_judgment=true; the same flag is rejected loud on a doc that has any judgment (pointing at --override-judgment); the two override flags together exit non-zero as mutually exclusive
  script: test — cd packages/lore && bun test tests/integration/cli/tiered-review-gate.bun.test.ts -t override-no-judgment
- [⚑] [script] AC-TIER-10: ai_provenance carries a real model id when the active provider exposes one via the ModelAwareProvider capability, and is OMITTED entirely (never filled with the provider name) when it does not; prompt_version comes from the GENERATE_PROMPT_VERSION registry constant, not a literal
  script: test — bunx vitest run packages/lore/tests/unit/service/tiered-review.test.ts -t ai_provenance

## Code anchors

- packages/lore/src/service/review-service.ts
- packages/lore/src/service/checkpoint-registry.ts
