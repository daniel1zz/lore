---
id: TASK-386
type: task
role: plan
title: "Two independent copies of 'does this task have a claim' now exist — the service short-circuit made the MCP adapter's hasRecordedTaskClaim redundant, and AC5's redundancy judgement was never made"
status: archived
priority: medium
created: 2026-08-03
updated: 2026-08-03
tags: []
parent: PRD-001
links:
  - {id: TASK-394, type: relates-to}
  - {id: ADR-028, type: relates-to}
---
Residual of `task-the-uncommitted-worktree-guard-treats-no-claim-at-all-as-a` (merged `6d01100`).
That task's AC5 required a written judgement on whether the MCP adapter's own claim-existence check
becomes redundant once the service distinguishes the two states. Its implementer was killed by an
API connection error before reporting, so the judgement was never made — and the code was left with
both copies in place.

## Measured on merged main at 6d01100

- Service layer (`packages/lore/src/service/task-workflow-service.ts`): new `hasRecordedClaim(task)`
  reading `task.extra["claim"]`, with `if (!hasRecordedClaim(task)) return null` short-circuiting
  before the Q3 branch.
- MCP adapter (`packages/lore/src/adapters/mcp/tools.ts`): still carries `hasRecordedTaskClaim(corpusService, idOrSlug)`
  (5 references), which performs an extra `corpusService.get()` per call purely to force
  `resolveMcpCallerCwd`'s sentinel when no claim exists.

Two independent implementations of "does this task actually have a claim", against the same field,
in two layers. The service one is authoritative; the adapter one now guards a case the service
already short-circuits.

## Why this is worth closing rather than leaving

It is not currently a correctness bug — both agree today. It is the precondition for the next
divergence, and this corpus has already paid for that shape twice in two days: an optional parameter
let one adapter go silently unwired, twice, and the fix each time was to remove the duplication
rather than to keep the copies in sync. A duplicated predicate is the same hazard one level up:
whoever changes the service's definition of "has a claim" (stale leases? foreign claims? a
tombstoned claim?) will not know the adapter holds its own answer.

There is also a measurable cost: `hasRecordedTaskClaim` issues an extra `corpusService.get()` on
every MCP `lore_evidence_add` / `lore_release`, for information the service re-reads anyway.

## Required

- Confirm FIRST that the service short-circuit genuinely covers the MCP path — the service is shared,
  so it should, but ⛔ verify by measurement, not by reading: temporarily remove
  `hasRecordedTaskClaim` and assert `mcp-tools-uncommitted-worktree-guard.test.ts` (14 tests) and
  `mcp-tools-task-workflow.test.ts` stay green, especially the "AC-2.H1 (GREEN)" case that supplies a
  real `caller_cwd` on an unclaimed task — that exact case is what forced the adapter workaround into
  existence, so it is the one that proves the service now handles it.
- If green: remove `hasRecordedTaskClaim`, simplify `resolveMcpCallerCwd` accordingly, and keep its
  remaining parameter(s) REQUIRED so the wiring still cannot be silently dropped.
- If NOT green: that is a more interesting finding than the cleanup — it means the service
  short-circuit does not reach the MCP path, and the two layers disagree about something. Report the
  failing case rather than restoring the workaround silently.

## Proxy / Silence / Opt-in

- **Proxy** — `extra["claim"] !== null` is the property both copies read; neither is a proxy for the
  other. The hazard is duplication, not approximation.
- **Silence** — today the two agree, so a future divergence produces no error anywhere: MCP would
  simply behave differently from CLI for the same task, which is exactly the asymmetry the parent
  task was filed to remove. The removal IS the silence fix.
- **Opt-in** — n/a.

## Oracle

- RED-equivalent (inversion, since there is no user-visible defect to reproduce): with
  `hasRecordedTaskClaim` removed, the MCP guard suites stay green — assert by running them, and
  report the "AC-2.H1 (GREEN)" case's result explicitly by name.
- CONTROL: the CLI path is untouched — `packages/lore/tests/unit/service/task-workflow-uncommitted-worktree-guard.test.ts` stays green.
- CONTROL: after simplification, deleting an argument at an MCP call site still fails `bun run typecheck` (the required-parameter property must survive the cleanup). Report the exact compiler error, and ⛔ confirm your edit actually landed with a non-empty `git diff` before trusting any inversion result.
