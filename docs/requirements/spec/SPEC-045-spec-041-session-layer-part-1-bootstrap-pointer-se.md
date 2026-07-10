---
id: SPEC-045
type: spec
role: spec
title: "SPEC-041 — Session layer part 1: bootstrap pointer-set + lossless handoff (S1+S2)"
status: approved
priority: high
created: 2026-07-10
updated: 2026-07-10
tags: [session, bootstrap, handoff, spec-041, context-continuity]
parent: PRD-001
---
# SPEC-041 — Session layer part 1: bootstrap pointer-set + lossless handoff (PRD §15 S1+S2)

> spec_kind: feature. Upstream: PRD-001 §15 (committed v0.8, G10). S3 (session registry +
> file-anchor claim safety) is deliberately OUT — its own follow-up spec; S2's handoff docs
> are its data prerequisite.
> v2 — revised after 3-lens adversarial review (schema-seams / agent-UX / testability);
> revision log in §Review.

## Overview/Goal

Two of the three highest-ranked unsolved pain points from the 2026-07-10 strategic review are
context-continuity failures: cross-session amnesia (a new session re-derives project state from
scratch or a human re-briefs it) and the context-drift-vs-`/clear`-loss dilemma. Lore has no
session-facing read surface (`knowledge-docman-replacement-assessment` names "session bootstrap
injection" as an unreplaced DocMan capability) and no typed working-state carrier.

**Goal**: (S1) one deterministic, read-only verb emits the volatile pointer-set a fresh session
needs — injectable by a SessionStart hook; (S2) a typed, reviewable handoff document makes
`/clear` lossless. Both read-side computed — no daemon (SPEC-025 ethos); pointers + summaries,
never full dump (IoC ADR boundary 2).

**Division of labor (review U1)**: bootstrap owns the VOLATILE delta only — plans, claims,
queue, gates, handoffs. The static layer (architecture, module map, conventions, invariants)
lives in CLAUDE.md/AGENTS.md projections and is explicitly NOT bootstrap's job; the spec's hook
example documents the pairing. Bootstrap makes the volatile half queryable; it does not compete
with the static half.

## Design Decisions

- **D1 — `SessionService`** (new, `packages/lore/src/service/session-service.ts`). Stateless,
  store-injected; owns `bootstrap()`, `writeHandoff()`, `resume()`. Composes existing reads
  (`evaluateReadiness`/`isClaimStale` from `@lore/core` — dependency-graph leaf, no cycle);
  constructor takes `claimTtlMinutes` + `handoffTtlMinutes` resolved from config in `app.ts`
  (the `resolveClaimTtlMinutes` precedent) — core stays config-free, staleness is precomputed
  by the service (review S4).
- **D2 — S1 pointer-set** (Zod SSOT `bootstrapReportSchema` in `@lore/core`):
  `{root: {slug, title} | null, active_plans: [{slug, title, task_counts: {ready, claimed, done}}],
  pending_reviews: {count, slugs: [≤10]}, my_claims: [{task_slug, plan_slug, claimed_at, stale}],
  armed_gates: [{checkpoint, feeding_source_slug}], latest_handoffs: [{plan_slug, handoff_slug,
  by, at}], resume_hint: {plan_slug, handoff_slug} | null, corpus: {total_docs, last_updated}}`.
  `feeding_source_slug` points each armed checkpoint at its governing skill/rules doc (the
  `lore feed` source) so a fresh session knows WHAT to consult before producing, not just that
  a gate exists; `resume_hint` names the newest handoff overall (review U1). Every string a
  slug/title — NEVER doc content; titles ≤120 chars. Empty corpus is legal: `root: null`,
  empty arrays, exit 0. CLI `lore bootstrap [--by] [--json]`; MCP `lore_bootstrap {by}` (by
  required). Read-only: zero store writes, no version bumps, no audit events.
- **D3 — S2 handoff doc = knowledge sub_type `handoff`** (additive member in
  `KNOWLEDGE_SUB_TYPES`, `packages/core/src/types.ts`). Typed SSOT `extra.handoff`
  (`handoffExtraSchema`, `@lore/core`): `{by, plan_ref?, task_refs: string[], modified_files:
  string[], key_decisions: [{judgment ≤300, confidence?: 0-100}], failing_oracle?: {command,
  output_tail ≤2000}, next_steps: string[] (≥1 — a handoff naming no next step is a status
  report, not a handoff)}`. `content` is a deterministic rendering of `extra.handoff`
  (assessment precedent: extra SSOT, content projection). **Parent resolution (pinned, review
  S3)**: `plan_ref` given → that plan (must resolve to a live plan; nonexistent or soft-deleted
  → `VALIDATION_ERROR`); no `plan_ref` + exactly one PRD → that PRD; no PRD in corpus →
  parentless (legal for knowledge); multiple PRDs → `VALIDATION_ERROR` requiring `plan_ref`.
- **D4 — Write-path exclusivity via writer-identity guard (review S1/T1 — the ATTESTATION
  precedent, not assessment).** `CorpusService.create`'s public path rejects
  `sub_type: "handoff"` with `VALIDATION_ERROR` whose message names `lore handoff` as the sole
  write path — enforced in `_createImpl` alongside the phase/ac_scope cross-entity checks
  (Zod cannot see the caller; a presence-check superRefine is forgeable because `extra.handoff`
  is user-supplied data, unlike an LLM assessment blob). `SessionService.writeHandoff` is
  constructor-injected with a `createHandoffDoc` port bound to CorpusService's internal
  creation method (the `recordVerifiedEvidence` sole-injection-site pattern, SPEC-039).
  **Drive-by SSOT repair (review T1)**: `create.ts`'s hardcoded CLI sub-type list has already
  drifted (missing `prompt`/`skill`) — it is replaced by the `KNOWLEDGE_SUB_TYPES` SSOT import
  so CLI validation can never diverge again (REGRESSION-tested); the CLI therefore forwards
  `--sub-type handoff` to the service seam, which produces the naming error. Handoff docs are
  created `draft` and enter the normal review loop (unreviewed = advisory, PRD §15).
- **D5 — S2 resume: an explicit branch in the shared feed flow, NOT a
  `CHECKPOINT_PRODUCED_TYPE` entry (review S2/T5** — that map is `Record<string, string>` with
  gate-produced types; an unknown key yields the one-line advisory note, not resume output).
  `flows/feed-flow.ts` gains an exported session-resume branch that both adapters (CLI
  `feed.ts`, MCP `lore_feed`) dispatch to BEFORE the gate-checkpoint path — single-sited,
  CLI/MCP parity preserved. Targeting: `--plan <id|slug>` (newest-wins) or `--handoff <slug>`
  (direct, skips derivation — review U3); `--by` filters to one actor. Output: the handoff's
  full rendered content (bounded digest — the one deliberate pointers-only exception) + a live
  readiness pointer block + **an age line, with a warning past `workflow.handoff_ttl_minutes`
  (config, default 10080 = 7 days; claim-TTL precedent — review U4)**. Multi-actor: `--by`
  omitted and >1 actor has handoffs on the plan → return the newest PER ACTOR with a
  "N actors have handoffs" header — divergent state is surfaced, never silently collapsed
  (review U4). No handoff found → "(no handoff recorded)", exit 0. Read-only; no consumption
  receipts (S3 material).
- **D6 — Authoring surfaces: `--json-file` is the PRIMARY agent path (review U2).**
  `lore handoff --json-file <path>` reads a `handoffExtraSchema`-validated JSON document — the
  JSON IS the `extra.handoff` SSOT (no fork; content stays the deterministic projection).
  Rationale: at realistic sizes (10-30 files, 5-19 scored decisions) flag-per-item assembly is
  shell-quoting hell; the shipped `/handoff` skill precedent authors via file-write. Repeatable
  flags (`--file`, `--decision "<judgment>[@<conf>]"`, `--next`, `--failing-command` +
  `--failing-tail-file` mutually required) remain as the human convenience path; `--json-file`
  is mutually exclusive with the field flags. `--plan`/`--by` work with both. MCP
  `lore_handoff` takes the typed fields directly (by required). No `--content`/`--content-file`
  ever — a hand-authored body would fork the SSOT.
- **D7 — Handoff is agent-authored; hooks remind, never author (review U5).** A Stop/PreCompact
  shell hook cannot compute `key_decisions`/`next_steps` — they exist only in the agent's
  context. The honest integration model, documented in the spec's hook example: (a)
  SessionStart hook → `lore bootstrap --json` (+ optional `lore feed session-resume` pipe via
  `resume_hint` — script-authorable, deterministic); (b) Stop/PreCompact hook → REMINDS the
  agent to run `lore handoff` (blocking prompt), or captures a degraded git-only record
  (`modified_files` from `git status`, no decisions) explicitly marked `degraded: true` in
  `extra.handoff`. Lore does not install or manage hooks.
- **D8 — MCP tool count 24 → 26** (`lore_bootstrap`, `lore_handoff`; `lore_feed` gains the
  resume branch). tools.ts additions follow pre-declared-schema discipline (tsc-hotspot ADR).

## Scope

**In**: `@lore/core` (`KNOWLEDGE_SUB_TYPES` + `handoffExtraSchema` + `bootstrapReportSchema` +
handoff renderer + `degraded` flag), `SessionService` (new) + `createHandoffDoc` internal port,
`_createImpl` handoff guard, `create.ts` sub-type list → SSOT import (drive-by repair),
feed-flow resume branch, CLI `bootstrap`/`handoff` + feed wiring, MCP `lore_bootstrap`/
`lore_handoff`, `workflow.handoff_ttl_minutes` config, docs (hook example with honest D7
framing).

**Out**: S3 registry / presence / file-anchor claim predicate / consumption receipts; hook
installation; memory-hygiene fields (§16 spec); dashboard session views; any daemon.

## Acceptance Criteria

Runner assignments explicit (review T3/T4): service/core/MCP tests are vitest on
InMemoryStore (MCP handlers invoked in-process via `_registeredTools` — the existing
`mcp-tools*.test.ts` pattern); CLI exit-code tests spawn the binary under bun test.

- AC-SL-1 (vitest) bootstrap completeness incl. `feeding_source_slug` per armed gate +
  `resume_hint`; content-freedom (no body text, titles ≤120).
- AC-SL-2 (vitest) read-only proof via a StoreInterface counting proxy over the mutating
  methods (insert/update/softDelete/addLink/removeLink/insertVersion/appendAuditEntry/
  insertJudgment/insertCalibrationRecord): zero calls during bootstrap AND resume.
- AC-SL-3 (vitest) handoff write path at service level: Zod-valid extra, deterministic
  projection, draft status; parent resolution all four ways (plan_ref → plan; single PRD;
  zero PRD → parentless; multi PRD → VALIDATION_ERROR).
- AC-SL-4 (vitest + bun) exclusivity: direct `CorpusService.create` and MCP `lore_create`
  → VALIDATION_ERROR naming `lore handoff`; spawned CLI `lore create knowledge --sub-type
  handoff` → exit 2, stderr names `lore handoff`. REGRESSION: CLI accepts every
  `KNOWLEDGE_SUB_TYPES` member for its other sub-types (prompt/skill divergence repaired).
- AC-SL-5 (vitest) resume: newest-wins targeting by --plan, direct --handoff targeting, age
  line + TTL warning past threshold, output_tail cap, "(no handoff recorded)" exit 0.
- AC-SL-6 (vitest) MCP parity: lore_bootstrap/lore_handoff require by; payloads deep-equal
  CLI --json shapes on the same seeded corpus.
- AC-SL-7 (vitest) round-trip: handoff written via --json-file with all fields → resume
  reproduces every field verbatim; flags path and json-file path produce identical docs for
  equivalent input.
- AC-SL-8 (human) fresh-session test: operator supplies no project facts beyond the two
  documented commands; the session names the active plan, next steps, and failing oracle.
- AC-SL-9 (bun) CLI contract: missing --next → exit 2; --failing-command without
  --failing-tail-file (and inverse) → exit 2; --json-file mutually exclusive with field
  flags → exit 2.
- AC-SL-10 (vitest) boundary: empty corpus bootstrap → root null, empty arrays, exit 0.
- AC-SL-11 (vitest) state: two handoffs same (plan, actor) → newest wins; --by isolates
  actors; --by omitted with two actors → newest per actor + multi-actor header.
- AC-SL-12 (vitest) error: plan_ref nonexistent or soft-deleted → VALIDATION_ERROR; degraded
  git-only handoff (no decisions, degraded: true) validates and renders with a degraded
  marker.

## Review

3-lens adversarial review applied 2026-07-11 (schema-seams, agent-UX, testability):
- HIGH fixed: D4 rebased from assessment presence-check (forgeable for user-supplied extra) to
  attestation-style writer-identity guard + internal port; CLI sub-type list SSOT repair;
  bootstrap division-of-labor + feeding_source/resume_hint; --json-file primary authoring path;
  D7 reframed to agent-authored handoffs (hooks remind or capture degraded git-only records).
- MED fixed: resume is an explicit feed-flow branch (not a CHECKPOINT_PRODUCED_TYPE entry);
  parent resolution pinned four-way; age line + handoff TTL warning; multi-actor surfacing;
  AC-SL-2 mechanism named (mutation-counting proxy); runner split corrected (MCP = vitest
  in-process, CLI exit codes = bun spawned); +4 dimension-coverage ACs (empty corpus,
  newest-wins state, actor isolation, dead plan_ref).
- Confirmed sound: gate/feed enum isolation (no leak into GateCheckpoint), readiness/staleness
  reuse from core, extra-as-SSOT + content projection, S3 deferral.


## Acceptance Criteria (structured)

- [·] [script] AC-SL-1: Bootstrap pointer-set on a seeded corpus contains root, active plans with task counts, pending slugs (max 10), caller claims with staleness, armed gates each with feeding_source_slug, latest handoff pointers, and resume_hint; no field contains doc body text; titles capped at 120 chars
  script: test — bunx vitest run packages/lore/tests/unit/service/session-bootstrap.test.ts
- [·] [script] AC-SL-2: bootstrap and resume record zero calls on a StoreInterface mutation-counting proxy covering insert/update/softDelete/addLink/removeLink/insertVersion/appendAuditEntry/insertJudgment/insertCalibrationRecord
  script: test — bunx vitest run packages/lore/tests/unit/service/session-readonly.test.ts
- [·] [script] AC-SL-3: writeHandoff produces a draft knowledge doc with Zod-valid extra.handoff and deterministic content projection; parent resolution: plan_ref to live plan, single-PRD fallback, zero-PRD parentless, multi-PRD VALIDATION_ERROR requiring plan_ref
  script: test — bunx vitest run packages/lore/tests/unit/service/session-handoff-write.test.ts
- [·] [script] AC-SL-4: Direct CorpusService.create and MCP lore_create with sub_type handoff fail VALIDATION_ERROR naming lore handoff; spawned CLI create exits 2 with stderr naming lore handoff; CLI accepts every KNOWLEDGE_SUB_TYPES member for non-handoff sub-types (prompt/skill divergence repaired, REGRESSION)
  script: test — bunx vitest run packages/lore/tests/unit/service/session-handoff-exclusivity.test.ts && cd packages/lore && bun test tests/unit/adapters/cli-handoff.bun.test.ts
- [·] [script] AC-SL-5: Resume supports newest-wins --plan targeting and direct --handoff targeting; renders an age line and warns past workflow.handoff_ttl_minutes; enforces output_tail cap; returns '(no handoff recorded)' with exit 0 when none exists
  script: test — bunx vitest run packages/lore/tests/unit/service/session-resume.test.ts
- [·] [script] AC-SL-6: lore_bootstrap and lore_handoff reject a missing by argument; their JSON payloads deep-equal the CLI --json shapes for the same seeded corpus (in-process _registeredTools invocation)
  script: test — bunx vitest run packages/lore/tests/unit/adapters/mcp-session-tools.test.ts
- [·] [script] AC-SL-7: A handoff written via --json-file with all fields populated is reproduced field-for-field by resume; the flags path and json-file path produce identical docs for equivalent input
  script: test — bunx vitest run packages/lore/tests/unit/service/session-roundtrip.test.ts
- [·] [human] AC-SL-8: A fresh session given only the documented bootstrap and resume output names the active plan, the declared next steps, and the failing oracle with zero human re-briefing
  human: Operator supplies no project facts beyond the two documented commands (bootstrap + feed session-resume)
- [·] [script] AC-SL-9: Spawned CLI: missing --next exits 2; --failing-command without --failing-tail-file (and inverse) exits 2; --json-file combined with any field flag exits 2
  script: test — cd packages/lore && bun test tests/unit/adapters/cli-handoff.bun.test.ts
- [·] [script] AC-SL-10: Bootstrap on an empty corpus returns root null with empty arrays and succeeds (exit 0 semantics at service level: ok result, no throw)
  script: test — bunx vitest run packages/lore/tests/unit/service/session-bootstrap.test.ts
- [·] [script] AC-SL-11: Two handoffs for the same plan and actor resolve newest-wins; --by isolates actors; --by omitted with two actors returns newest per actor under a multi-actor header
  script: test — bunx vitest run packages/lore/tests/unit/service/session-resume.test.ts
- [·] [script] AC-SL-12: plan_ref to a nonexistent or soft-deleted plan fails VALIDATION_ERROR; a degraded git-only handoff (degraded true, no decisions) validates and renders with a visible degraded marker
  script: test — bunx vitest run packages/lore/tests/unit/service/session-handoff-write.test.ts
