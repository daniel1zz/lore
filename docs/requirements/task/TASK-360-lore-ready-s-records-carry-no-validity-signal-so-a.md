---
id: TASK-360
type: task
role: plan
title: "lore ready's records carry no validity signal, so a dispatcher cannot tell no-retracted-tasks from validity-never-consulted"
status: draft
priority: medium
created: 2026-08-06
updated: 2026-10-27
tags: [defect, validity, ready, probe-signal, discriminated-union]
parent: PRD-001
links:
  - {id: TASK-359, type: relates-to}
---
# Defect — `lore ready`'s records carry no validity signal, so a dispatcher cannot tell "no retracted tasks in this set" from "validity was never consulted"

Measured 2026-08-06 on `main @ 9bb265e0`, after `task-validity-landed-on-lore-list-only-the-dispatch-surface` merged. That task closed `feed task-start`, `status`, `tree`, `get`, `pending`, and `--governed-by`. It closed HALF of `ready` and reported the rest rather than widening its anchors.

**What already holds** — the safety property. `TaskWorkflowService.ready` / `readyAdhoc` apply the SSOT validity predicate, so a retracted task is genuinely FILTERED OUT of the ready set. No dispatcher can be handed retracted work through this surface.

**What is missing** — the probe signal. A `ReadyRecord` carries no `validity_status`, so the payload cannot distinguish:

- *this set was validity-filtered and contained nothing retracted*, from
- *validity was never consulted for this set*

That is the exact distinction the sibling `anchor_resolution` field was built as a discriminated union to preserve (`{probed:false, reason}` vs `{probed:true, unresolved:[]}`), and the exact distinction this repo's own rule demands: an empty array and an absent probe must not be the same value. `ready` currently has neither shape — it has silence.

⛔ This is a WEAKER defect than its siblings and must not be inflated. Nothing unsafe reaches a worker. The cost is that a dispatcher reading `lore ready --json` cannot verify the filter ran, so the guarantee is only as trustworthy as the reader's memory of this document.

# Why it was correctly deferred rather than taken

Three files, one of them a shared core type, and the ripple is real:

- `packages/core/src/task-workflow.ts` — `ReadyRecord` gains the field
- `packages/lore/src/service/task-workflow-service.ts` — `withPreGatedLiveStatus` on `ready` + `readyAdhoc`
- `packages/lore/src/service/phase-workflow-service.ts` — emits `ReadyRecord` too and carries an explicit `@invariant` about it

⛔ **Read that fence precisely; do not act on a paraphrase.** Verbatim, `phase-workflow-service.ts:77-81`:

> `@invariant` `ready()`'s per-record shape stays `ReadyRecord` from `@lore/core`
> (`task-workflow.ts`) UNCHANGED, including the field literally named `.task` — see the RED
> test's CONTRACT NOTE §2 for why renaming it to `.phase` is deliberately out of THIS task's
> scope (it would ripple into every `ReadyRecord` consumer: CLI `lore ready`, `lore tree`
> badges, ...).

(Quote shortened on 2026-10-27: its last consumer was on the tool surface retired by `adr-retire-the-lore-mcp-server-the-cli-and-http-are-the-only`.)

The stated reason is scoped to **RENAMING `.task` → `.phase`** — a breaking change to an existing field that every consumer already reads. ADDING a field is a strictly weaker change: no existing reader loses anything. So the fence does **not** forbid this task, but its invariant text says `UNCHANGED`, which your change will contradict on its face.

Therefore: read `CONTRACT NOTE §2` in that module's RED test before touching anything, decide whether adding a field violates the invariant's INTENT or only its letter, and **update the `@invariant` wording to match reality** either way. ⛔ Leaving a stale `UNCHANGED` invariant next to a changed shape is the doc-drift this repo polices — and silently contradicting a fence you did not read is worse than the drift.

# Required fix

1. Add validity to `ReadyRecord` using the ALREADY-SHIPPED helper `withPreGatedLiveStatus` from `packages/lore/src/service/validity-service.ts`. ⛔ Do not write a second predicate — that helper is named for its assumption (the caller has already excluded at the injected instant), which is exactly `ready`'s situation.
2. **Enumerate every `ReadyRecord` consumer before changing the shape** — CLI `ready`, HTTP, dashboard — and state per consumer whether it breaks, ignores, or benefits. The `phase-workflow-service.ts` JSDoc names this ripple as its reason for deferring; discharge that reason explicitly rather than overruling it silently.
3. `phase-workflow-service.ts` emits the same record with no injected validity source in some paths. If a path genuinely cannot consult validity, it must say so structurally (`{probed:false, reason}`), NOT emit a bare empty value — mirror `anchor_resolution`'s discriminated union rather than inventing a third convention.

# Oracle

- `lore ready <plan> --json`: a record set that WAS validity-filtered reports so; a surface that cannot consult validity reports `probed:false` with a reason. Assert on the parsed object, and assert the two shapes are structurally distinguishable — a test that only checks "the key exists" passes against a field that is always the same value.
- **CONTROL**: a corpus with zero retracted tasks still reports *filtered, none found* — not absent, and not `probed:false`. Without this control, an implementation that hardcodes the absent case passes.
- REGRESSION: the ready SET is unchanged — same tasks in, same tasks out, same ordering. This task adds a signal; it must not move the filter. Assert the member list before/after.
- REGRESSION: every enumerated consumer still parses the payload. A shared-type change that typechecks but breaks the dashboard at runtime is the failure this deferral was protecting against.
- `bun run typecheck` clean; `bun run test:changed <base>` with a NON-ZERO selection.
- Six-dimension coverage: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION.

# Proxy / Silence / Opt-in (binding — `adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the`)

**Proxy.** "The ready set contains no retracted task" is a proxy for "validity was enforced on this set". Today the two coincide by implementation and nothing in the payload witnesses it, so a future refactor that drops the filter would be indistinguishable from correct behaviour at every reading surface. The field is what makes the enforcement observable rather than remembered.

**Silence.** Partial: the dangerous half (retracted work reaching a worker) is already closed. What is silent is the EVIDENCE of that closure.

**Opt-in.** None; the field must be unconditional. ⛔ A validity signal a caller must request is the inert `--include-invalid` flag all over again.
