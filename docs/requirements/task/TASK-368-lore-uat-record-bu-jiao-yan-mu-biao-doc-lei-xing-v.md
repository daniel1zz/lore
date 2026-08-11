---
id: TASK-368
type: task
role: plan
title: "lore uat record 不校验目标 doc 类型：verdict 挂到 knowledge/adr 上静默成功，plan-close gate 永远读不到"
status: archived
priority: high
created: 2026-07-30
updated: 2026-08-04
tags: []
parent: PRD-001
---
# Defect — `lore uat record` accepts any doc type, so a verdict is linked where no gate reads it

SPEC-054's UAT verdict has one consumer: the **plan-close** checkpoint, which looks for a UAT
verdict doc linked to a **plan** and feeds `uatP0Accepted(present, p0Accepted)`
(`packages/lore/src/service/gate-predicates.ts:867`, `PLAN_CLOSE_FIELD = "uat"`).

`UatService.record()` (`packages/lore/src/service/uat-service.ts`, 128 lines) does:

1. validate the verdict payload,
2. `createUatDoc(...)` — create a `knowledge` doc with `sub_type: "uat"` through the
   writer-identity-guarded `CorpusService.createUatDoc` seam (line 101),
3. `addLink({ link_type: "informs", ... })` to the target (line 105-111).

**Nothing between steps 1 and 2 checks the target's type.** The CLI declares the positional as a
plan (`packages/lore/src/adapters/cli/commands/uat.ts:25`, `:78` — "Plan doc id/slug"), and that
declaration is enforced nowhere: measured on `main @ 6788989`, `commands/uat.ts` contains no type
comparison at all (its only resolution work is `resolveActor`, line 53).

Reporter's measured evidence (`extra.issue_report`, guyin, 2026-07-30), two cases:

| input | result |
|---|---|
| an ADR slug | created `knowledge-uat-adr-…`, `informs` the ADR, "Recorded UAT verdict", zero warnings |
| an unrelated knowledge note's slug | created `knowledge-uat-knowledge-agent-browser-…` — a NESTED slug — same silent success |

Real cost that round: a complete UAT run (6 journeys / 13 subagents / verdict = reject / 2
blockers / a 20-row requirement-coverage matrix) was attached to an ADR, reported to the user as
PERSIST-complete, and is unreadable by the plan-close gate.

The trigger is not exotic: an owner-driven change often has an ADR and no plan. The operator has
nothing to attach the verdict to, the CLI neither refuses nor warns, and attaching it to the ADR
is the natural move.

# Mechanism root — a typed contract declared in help text and enforced nowhere

The doc-type requirement lives in a `description` string. Help text is not a mechanism: it is
read by humans at authoring time and by nothing at write time. This is lore's own fail-loud
principle violated on lore's own surface — silently accepting an input the sole consumer cannot
use, and additionally minting a nested-slug doc that pollutes the corpus.

Note the module already carries strong invariants about the OTHER half-failure (create ok, link
fails → LOUD `err` naming the exact `lore link` repair command, lines 112-123). The precedent for
loudness is established in this very file; only the input-type case was left silent.

# Required fix — enforce in the SERVICE layer, not the CLI

⛔ Put the check in `packages/lore/src/service/uat-service.ts`, NOT in `commands/uat.ts`.

Rationale (state it in the JSDoc): the CLI is one of three write surfaces. MCP exposes
`lore_uat_record` (`packages/lore/src/adapters/mcp/tools.ts`, SPEC-054's SOLE MCP write path) and
the HTTP dashboard reaches the same service. A CLI-only guard leaves two surfaces open — the "a
writer whose reader was retired" shape from the consumer/end-to-end audit lesson. Service-layer
enforcement is also how `GateEnforcer` already achieves identical gating across CLI, MCP and HTTP.

Practical consequence: **`mcp/tools.ts` should not need editing.** If you conclude it does, STOP
and report — that file is anchored by a concurrent task
(`task-the-ac-scope-re-keying-left-the-red-first-floor-unarmed`).

1. `record()` resolves the target and refuses a non-`plan` doc with a `VALIDATION_ERROR` (a
   `Result` err — no exception crosses the service boundary) **BEFORE `createUatDoc` runs**.
   ⛔ Ordering is load-bearing: refusing after the create would leave exactly the orphan doc this
   defect produces. Assert the ordering, not just the refusal (AC-4).
2. The refusal must be ACTIONABLE, matching the loudness already set by the half-failure branch:
   name the target's actual type, state that the plan-close checkpoint is the sole consumer and
   reads a verdict linked to a PLAN, and say what to do when no plan exists.
   ⛔ Do not emit a bare "invalid type".
3. Decide and state in the JSDoc: is there a legitimate no-plan path (the ADR-only scenario that
   produced this report) deserving a supported answer, or is "create a plan" the only correct
   advice? If the former, describe it in the refusal text. ⛔ Do NOT build a second storage
   location for verdicts in this task.
4. Update the CLI positional descriptions (`commands/uat.ts:25`, `:78`) so help text and
   enforcement agree.

# Acceptance criteria

- **AC-1** HAPPY: recording against a `plan` still creates the `knowledge`/`sub_type: "uat"` doc
  AND the `informs` link, unchanged. Assert BOTH the created doc's type/sub_type and the link's
  `link_type` + endpoints — an exit code alone would pass with the link missing.
- **AC-2** NEGATIVE: recording against each of `knowledge`, `adr`, `spec`, `prd`, `task` is
  REFUSED with `VALIDATION_ERROR` and a non-zero exit. Assert per type — a single representative
  type would pass even if the check keyed on one hard-coded slug.
- **AC-3** the refusal names (a) the actual doc type and (b) the plan-close consumer. Assert two
  independent lone tokens, never one remembered sentence (contiguous-substring rule).
- **AC-4** ORDERING / no orphan: after a refused call, NO `knowledge`/`uat` doc was created and NO
  link was added. Assert by corpus state (count before/after), not by the error message. This is
  the AC that distinguishes a real fix from a post-create refusal, and it is also the one that
  proves the nested-slug pollution (`knowledge-uat-knowledge-…`) can no longer be minted.
- **AC-5** SURFACE PARITY: the same refusal occurs through the MCP `lore_uat_record` path WITHOUT
  editing `mcp/tools.ts`. This AC proves the fix landed in the service layer rather than the
  adapter — a CLI-only fix fails it.
- **AC-6** REGRESSION: a verdict doc ALREADY mis-linked to a non-plan doc by the old behaviour
  still reads back fine and is not retro-actively invalidated. This changes the write boundary
  only. ⛔ Do not sweep or delete existing mis-linked verdicts in this task.
- **AC-7** STATE: the plan-close checkpoint is unchanged — a plan with a P0-accepted linked
  verdict still passes `uatP0Accepted`, one without still fails with `UAT_MISSING`. Assert BOTH
  directions. Note `requires_uat` is an opt-in short-circuit living in `checkPlanClose`; do not
  alter it.
- **AC-8** ERROR: an unresolvable id/slug still produces the pre-existing not-found error, not the
  new type error. Check order matters and must be asserted.
- **AC-9** `bun run typecheck` clean; `bun run test:changed <base>` passes with a NON-ZERO
  selection (loud-zero rule).
- Six-dimension coverage (HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION).

# Proxy / Silence / Opt-in (binding — `adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the`)

**Proxy.** "`lore uat record` printed 'Recorded UAT verdict'" is a proxy for "a verdict now exists
where the plan-close checkpoint reads it". Concrete input satisfying the proxy while violating the
property: both measured cases above — an ADR target and a knowledge-note target. The fix removes
the proxy by refusing the write when the property cannot hold.

**Silence.** Total today: the write succeeds, prints success, creates a real doc and a real link,
and the gap surfaces only much later as a plan that will not close for reasons that appear
unrelated. Everything the operator can see says it worked. The fix converts it to a refusal at the
moment of the mistake, while the operator still has the context to act.

**Opt-in.** None, and none should be added. ⛔ Do NOT add a `--force`/`--any-type` escape: the
checkpoint cannot read a verdict linked to a non-plan, so a forced write would be a
guaranteed-inert record — precisely the silently-inert-flag false-oracle vector.
