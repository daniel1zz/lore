---
id: SPEC-097
type: spec
role: spec
title: "Lifecycle archival — plan-close cascade, deterministic archive sweep, injected candidate surfacing"
status: approved
priority: medium
created: 2026-07-27
updated: 2026-10-10
tags: []
---
# Lifecycle archival — plan-close cascade, deterministic archive sweep, injected candidate surfacing

## Overview/Goal

Corpus documents currently outlive their purpose: a plan finishes but its handoffs, tasks, and other execution-scoped docs stay in pre-archived statuses forever, polluting every derived surface (bootstrap directories, pending queues, staleness scans). Manual cleanup exists (`lore set --status archived`) but nothing DISCOVERS what is due, so it never happens.

Lore deliberately has no daemon (every state change must be attributable — SPEC-044's report-only principle). "Automatic" therefore means three attributable mechanisms:

1. **Event cascade** — when a plan is archived (the plan-close event), the docs that exist solely in service of that plan's execution are archived in the same action, attributed to the closer. Deterministic, zero guessing: their purpose is definitionally complete.
2. **Deterministic sweep** — an on-demand verb computes archive candidates from pure rules (no LLM), reports them with per-candidate reasons and literal repair commands by default, and applies them only under an explicit flag, each write audited.
3. **Injected surfacing** — the bootstrap injection carries the candidate COUNT (present only when > 0), so every session start automatically discovers that cleanup is due without any new hook machinery. Discovery is automatic; application stays explicit or event-driven.

## Candidate Rules (pure, versioned here)

- **R1 (cascade, auto-applied at plan-close)**: on a plan's transition to `archived`, archive (a) its child tasks that hold no fresh claim, and (b) handoff docs parented to it. Fresh-claimed tasks BLOCK nothing — they are skipped and reported in the cascade result (a claimed task under an archived plan is itself a smell the sweep re-surfaces).
- **R2 (superseded handoff)**: a handoff doc is a candidate when a NEWER handoff exists for the same (plan, actor) pair.
- **R3 (orphaned/expired handoff)**: a handoff doc is a candidate when its age exceeds `workflow.handoff_ttl_minutes` AND (its plan is archived/deprecated OR it has no plan).
- **R4 (done-plan stragglers)**: a task is a candidate when its parent plan is archived/deprecated and the task is unclaimed and not yet archived (catches pre-cascade history and R1's claimed-task skips after the claim expires).
- **Exclusions**: `knowledge` (non-handoff sub-types) and `adr` are NEVER auto-archive candidates — their lifecycle is invalidation (SPEC-043) and staleness probes (SPEC-044). Specs/PRDs/plans themselves are never candidates (plans close through the gated plan-close event only).

## Design Decisions

- **D1 — pure rule engine in core.** `computeArchiveCandidates(docs, nowIso, ttlMinutes)` in `@lore/core` (browser-safe, no IO) returns typed candidates `{doc_id, slug, rule: "superseded_handoff" | "expired_handoff" | "done_plan_straggler", reason}`. The SAME function backs the sweep verb and the injection count — one derivation site.
- **D2 — cascade in the plan-close write path.** Wherever the plan → `archived` transition commits (after the plan-close gate passes), the cascade runs in the same logical operation: each cascaded doc gets its own status write + audit entry (action includes a cascade marker, actor = the closer). Cascade failures on individual docs are LOUD in the result (listed as skipped with reason), never silent, and never roll back the plan's own archival.
- **D3 — `lore archive` verb.** `lore archive --sweep [--json]` = report-only: per-candidate rule, reason, and the literal `lore archive --apply` repair; exit 0 when zero candidates, exit 3 when candidates exist (CI-composable, mirrors `--check-drift` semantics). `lore archive --apply [--by <actor>]` applies all current candidates (each write audited individually); a second consecutive `--sweep` after `--apply` exits 0. Status transitions used must be legal per `VALID_TRANSITIONS`; if a required edge (e.g. draft → archived for never-promoted tasks/handoffs) is missing, EXTEND `VALID_TRANSITIONS` deliberately as part of this spec (documented in the schema comment) rather than routing through fake intermediate states.
- **D4 — injection surfacing.** `BootstrapReport` gains `archive_candidates: number` (computed via D1); `buildBootstrapInjection` includes it present-iff > 0 (the `seat_unresolved`/`budget_exceeded` present-iff-true convention keeps ordinary shapes byte-stable). The corpus-workflow prose maintenance-cadence bullet adds `lore archive --sweep`.
- **D5 — attribution.** Every applied archive (cascade or sweep) resolves its actor via the standard resolution chain and writes an audit entry; sweep `--apply` without resolvable intent still lands on the session/OS tier — never `"system"`.

## Scope

In: `@lore/core` rule engine + types, plan-close cascade at the plan-archival write path, new `commands/archive.ts` CLI verb (+ lazy registration), `SessionService.bootstrap` count + injection field, corpus-workflow prose bullet + manifest regen, `VALID_TRANSITIONS` extension if required, tests across all layers.

Out: any daemon/background application, knowledge/adr auto-archival (invalidation owns that), dashboard surfaces, MCP tool for the verb (CLI-only this slice), pending-review queue auto-drain (review workflow owns approval decisions).

## Acceptance Criteria

Structured via `lore ac add`. Sketch: (1) core unit — R2/R3/R4 six-dimension coverage incl. exclusions and boundary ages; (2) integration — plan archival cascades unclaimed tasks + plan handoffs with per-doc audit entries, skips fresh-claimed tasks loudly; (3) CLI e2e — sweep exit 3 with candidates + reasons + literal repair, apply then sweep exit 0; (4) compiled injection e2e — `archive_candidates` present-iff-positive, ordinary shape byte-stable when zero; (5) `bun run typecheck` exit 0.


## Acceptance Criteria (structured)

- [⚑] [script] AC-097-1: Core unit: computeArchiveCandidates covers superseded_handoff, expired_handoff (boundary at exactly TTL), done_plan_straggler, knowledge/adr exclusion, fresh-claim exclusion, and empty-corpus regression
  script: test — bunx vitest run packages/core/tests/unit/archive-candidates.test.ts
- [⚑] [script] AC-097-2: Integration: archiving a plan cascades unclaimed child tasks and plan-parented handoffs to archived with one audit entry per doc; fresh-claimed tasks are skipped and named in the result; plan archival itself never rolls back
  script: test — cd packages/lore && bun test tests/integration/plan-close-cascade.bun.test.ts
- [⚑] [script] AC-097-3: CLI e2e: lore archive --sweep exits 3 listing each candidate with rule and literal apply repair; lore archive --apply archives all candidates with audit entries; immediate re-sweep exits 0
  script: e2e — cd packages/lore && bun test tests/integration/archive-sweep-cli.bun.test.ts
- [⚑] [script] AC-097-4: Compiled injection e2e: archive_candidates key present in lore bootstrap --injection output iff count is positive; zero-candidate injection shape stays byte-stable vs the SPEC-096 key order
  script: e2e — cd packages/lore && bun test tests/e2e/bootstrap-injection-compiled.bun.test.ts
- [⚑] [script] AC-097-5: bun run typecheck exits 0 across all packages
  script: tsc — bun run typecheck
