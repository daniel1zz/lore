---
id: TASK-847
type: task
role: plan
title: "A deferral reason with no destination must not close its resume-ticket item (S4)"
status: archived
priority: high
created: 2026-08-25
updated: 2026-08-25
tags: []
parent: PRD-001
---
# Task Objective

Land S4 of `spec-resume-coverage-floor-the-satisfaction-boundaries-a`: a deferral
whose reason names no DESTINATION must not close its resume-ticket item, and its
refusal must be distinguishable from S1's bare-deferral refusal.

Today `deferred:out of scope for this session` closes an item and the deferred
work enters no queue. Measured 2026-08-25 across all 139 handoff docs in this
corpus: 696 next-step items, 458 of them (65.8%) bare prose that parks nothing
anywhere. That is the propagation vector this task closes.

# Spec Reference

`spec-resume-coverage-floor-the-satisfaction-boundaries-a` (approved v18) —
decision **S4**, Overview **Hole 3**, and the Scope section's now-MANDATORY
`packages/core/src/session.ts` bullet. Read S4 in full before writing code: it
records the grammar-only boundary, the known false pass, and the AC-RCS-1
re-baseline this task must honour.

# AC

Three criteria are in this task's `ac_scope`. Run each with `lore verify --task`,
never by hand-reporting.

- **AC-RCS-4** (new) — the five fronts. Front (b) is the one to read twice: it
  asserts the stderr the verb ACTUALLY EMITS startsWith the destination-refusal
  prefix constant, AND that constant is not byte-equal to S1's bare-deferral
  prefix. Both conjuncts. A constants-only comparison has no discriminating
  power and is explicitly forbidden by the criterion.
- **AC-RCS-1** (RE-BASELINED, must be RE-ATTESTED) — its non-empty-reason
  control arm now requires the reason to ALSO carry a destination token. Its
  pre-amendment attestation certifies the old assertion and does not carry
  forward. `verify.command` did not change, so `oracle_generation` did NOT bump:
  nothing but this task re-running it will make the record honest.
- **AC-RCS-3** (RE-BASELINED) — the anti-vacuity floor now sums three describe
  blocks, and each of the three titles must be substring-unique across the whole
  suite (assert with a repo grep reporting exactly 1 occurrence per title BEFORE
  taking the sum).

# Context Digest

- `lore handoff coverage-check` is the SOLE parser of the ticket render and the
  disposition lines. `assets/hooks/stop-handoff-coverage.mjs` is a blind relay
  and MUST NOT be edited — it deliberately holds no grammar (SPEC-083; an
  installed copy cannot be identity-asserted against the binary's exports).
- The verb must compose from `@lore/core` exports, never inline literals
  (SPEC-112 D7/D9). Both the destination grammar and the new refusal prefix are
  new exports in `packages/core/src/session.ts`.
- The predicate MUST be reached through EXACTLY ONE call site written literally
  as `!hasDeferralDestination(` in `handoff.ts` — AC-RCS-4's declared falsifier
  mutates that literal, and a second call site or a renamed symbol makes the
  falsifier stale, which is refused loud.
- Destination grammar per S4: an issue reference (`#<digits>` or a
  `/issues/<digits>` URL path) OR a corpus slug
  (`prd|spec|adr|plan|task|knowledge` + `-` + kebab tail).
- Existing routing to mirror: S1's bare/whitespace deferral already lands on
  `UNDISPOSITIONED_ITEM_STDERR_PREFIX`; an unrecognized token lands on
  `UNRECOGNIZED_DISPOSITION_STDERR_PREFIX`. S4 needs a THIRD, distinct prefix.
- `@lore/core`'s default barrel must never top-level-import a Node builtin.
  Pure string/regex work only here, so this is a non-issue — stated so it stays one.
- CONCURRENCY: another session is active in this repo. `git rebase main` FIRST
  (the harness builds worktrees from `origin/main`, which is 1 commit behind
  local main), then verify `git -C <wt> log --oneline -1` before trusting any
  measurement.
- Scoped oracle only inside the worktree: `bun run test:changed <base>` plus the
  three AC commands. The full suite runs on main after merge, not here.

# File Anchors

- `packages/core/src/session.ts` — new exported destination grammar + refusal prefix
- `packages/lore/src/adapters/cli/commands/handoff.ts` — the single
  `!hasDeferralDestination(` call site and its refusal routing
- `packages/lore/tests/unit/handoff-coverage-check.test.ts` — describe
  `deferral destination` (new) + the re-baselined `deferral reason` control arm
