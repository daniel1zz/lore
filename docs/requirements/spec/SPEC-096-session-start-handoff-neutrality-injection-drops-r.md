---
id: SPEC-096
type: spec
role: spec
title: "Session-start handoff neutrality — injection drops resume_hint, neutral open-thread directory"
status: approved
priority: medium
created: 2026-07-27
updated: 2026-07-27
tags: []
parent: PRD-001
links:
  - {id: SPEC-095, type: implements}
---
# Session-start handoff neutrality — injection drops resume_hint, neutral open-thread directory

## Overview/Goal

At session start the system cannot know which thread of work a fresh session is for — that information exists only in the user's head. Any injected "resume this" directive is therefore a guess, and in the personal multi-session workflow (one user, several parallel sessions on different plans — the PRIMARY design target, team scoping is a later layer) the guess misdirects all but one session: an eager agent follows `resume_hint` into another session's thread (goal drift / context invasion). Heuristics over corpus state (handoff count, distinct actors) cannot repair this — neither signal has any necessary relation to "is this a multi-session workflow" (single actor routinely runs many threads; a single handoff proves nothing about the new session's intent).

Design principle: **the user is the router**. The auto-injected surface must present only a neutral directory of open threads (discovery: "these exist"); thread SELECTION happens exclusively through the user — pasting a handoff ticket (`lore feed session-resume --handoff <slug>`) or explicitly instructing resumption. The one exception where a hint is NOT a guess: seat sessions (SPEC-057), whose resume scope derives from the session's own worktree branch.

Byproduct hygiene fix (discovered 2026-07-26): the `latest_handoffs` derivation applies no status/validity filter, so archiving or invalidating a handoff doc does not remove it from bootstrap/injection — manual cleanup is currently ineffective against the injected surface.

## Design Decisions

- **D1 — injection drops `resume_hint`; full report keeps it.** `buildBootstrapInjection` (tier-1 projection, `packages/core/src/session.ts`) omits `resume_hint` for ordinary sessions. The full `BootstrapReport` (`lore bootstrap --json`, MCP) RETAINS the field — those are explicit pull surfaces the caller invoked deliberately, not ambient injection; removing it there is an unnecessary breaking change.
- **D2 — seat exception.** When the bootstrap run is seat-scoped (SPEC-057 seat-aware resolution succeeded — the hint derives from the seat's own branch, not a corpus-wide guess), the injection KEEPS the seat-scoped resume hint. `seat_unresolved: true` or no seat signal → treated as ordinary (D1 applies).
- **D3 — derivation hygiene filter.** The handoff-pair collection in `SessionService.bootstrap` skips docs whose `status` is `archived`/`deprecated` and docs invalidated per `extra.validity` — in BOTH the full report and the injection (one derivation site). Archiving a handoff becomes an effective cleanup action everywhere it surfaces.
- **D4 — prose discipline.** `assets/governance/corpus-workflow.md` (runtime-served since SPEC-083): the FEED section's bootstrap bullet describes `latest_handoffs` as a neutral open-thread directory and adds an explicit prohibition — an agent must NEVER begin resuming work from injected handoff pointers on its own; resumption happens only on the user's ticket or explicit instruction. `bootstrapInjectionSchema` makes `resume_hint` optional (present only in the seat case).

## Scope

In: `packages/core/src/session.ts` (`buildBootstrapInjection`, `bootstrapInjectionSchema`), `packages/lore/src/service/session-service.ts` (derivation filter), `assets/governance/corpus-workflow.md` (+ manifest regen), affected pins (`bootstrap-injection-compiled.bun.test.ts` key-order/9-key regressions, session-service unit suites).

Out: full `BootstrapReport` shape for `--json`/MCP (unchanged except D3's data hygiene), seat resolution mechanics (SPEC-057 untouched), team/actor-scoped filtering (explicit later layer), plan-close handoff cascade (separate decision), dashboard surfaces.

## Acceptance Criteria

Structured via `lore ac add`. Sketch: (1) compiled injection e2e — ordinary-session injection contains NO `resume_hint` key, key-order regression updated, seat-scoped run retains it; (2) unit — archived and invalidated handoff docs appear in neither `latest_handoffs` nor the injection; approved/draft ones still do; (3) prose pins — corpus-workflow text contains the never-auto-resume prohibition and neutral-directory wording, zero "resume_hint is only a fallback" stale phrasing; (4) `bun run typecheck` exit 0.


## Acceptance Criteria (structured)

- [⚑] [script] AC-096-1: Compiled injection e2e: ordinary-session lore bootstrap --injection output contains zero resume_hint keys; key-order regression updated; a seat-scoped run retains its seat-derived resume hint
  script: e2e — cd packages/lore && bun test tests/e2e/bootstrap-injection-compiled.bun.test.ts
- [⚑] [script] AC-096-2: Unit: handoff docs with status archived or deprecated, and docs invalidated via extra.validity, appear in neither latest_handoffs nor the injection; draft and approved handoffs still appear
  script: test — bunx vitest run packages/lore/tests/unit/service/session-service.test.ts
- [⚑] [script] AC-096-3: Prose pins: assets/governance/corpus-workflow.md contains the never-auto-resume prohibition and neutral open-thread directory wording, and zero occurrences of the stale resume-hint-as-fallback phrasing
  script: test — bunx vitest run packages/lore/tests/unit/setup-governance-retirement.test.ts
- [⚑] [script] AC-096-4: bun run typecheck exits 0 across all packages
  script: tsc — bun run typecheck
