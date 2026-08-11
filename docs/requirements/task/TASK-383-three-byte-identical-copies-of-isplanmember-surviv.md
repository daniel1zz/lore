---
id: TASK-383
type: task
role: plan
title: "Three byte-identical copies of isPlanMember survive because the shared module's own JSDoc records a false module-boundary blocker"
status: archived
priority: high
created: 2026-08-03
updated: 2026-08-03
tags: []
parent: PRD-001
---
# Defect

`isPlanMember` — the one-line plan-membership predicate — exists in THREE byte-identical
copies:

    packages/lore/src/service/plan-membership.ts:65   export function isPlanMember(...)
    packages/lore/src/service/task-workflow-service.ts:865   function isPlanMember(...)   ← private
    packages/lore/src/service/phase-workflow-service.ts:238  function isPlanMember(...)   ← private

All three bodies are `return task.extra["plan_id"] === planId;`. Measured 2026-08-03 on
`main @ 5b38008`:

    grep -rl 'function isPlanMember' packages/lore/src/ | wc -l   →  3

Six services already import the shared module (`ac-service`, `corpus-service`,
`outline-service`, `phase-service`, `session-service`,
`verification-projection-service`). Only these two carry private duplicates.

# Mechanism root — the module's OWN JSDoc encodes a false blocker

`plan-membership.ts:20-32` states the consolidation is a "NAMED FOLLOW-UP, not resolved
here" and gives this reason verbatim:

> this file's module boundary (`service/CLAUDE.md`: "Service per concern, no
> cross-service imports") forbids either this module or those two services importing
> each other's private symbols

⛔ **That reason is factually wrong, and being wrong IN THE SHARED MODULE'S OWN HEADER is
what keeps the duplication alive** — the next reader who considers consolidating finds a
written justification not to.

`plan-membership.ts` is **not a service**. It is a pure predicate module with no store
dependency, no class, and no service surface — exactly the shape "no cross-service
imports" exists to permit as shared infrastructure. The proof is already in the tree:
SIX services import it today without violating that boundary. Importing
`./plan-membership.js` from `TaskWorkflowService` / `PhaseWorkflowService` is therefore
the SAME import the six landed services already make, not a cross-service import.

The second stated reason — "neither of those two files is anchored to the task that
created this module" — is a scoping fact about a PAST task, not a property of the code.
It explains why the earlier slice stopped; it is not a reason the duplication should
persist.

# Required fix

1. `task-workflow-service.ts`: delete the private `isPlanMember` (line ~865), import
   `{ isPlanMember } from "./plan-membership.js"`. All 8 call sites in this file keep
   working unchanged (identical signature).
2. `phase-workflow-service.ts`: same — delete the private copy (line ~238), import from
   the shared module. 3 references in this file.
3. `plan-membership.ts`: **rewrite the "SSOT note" paragraph** (lines 20-32). It must no
   longer claim other copies exist, and must NOT be silently deleted — replace it with a
   note recording that the three-copy state was consolidated and WHY the module boundary
   permits it (a pure predicate module is not a service), so the false blocker cannot be
   re-derived by the next reader.
4. Preserve every existing JSDoc cross-reference to
   `task-plan-membership-is-extra-plan-id-but-the-last-task` at the call sites — those
   document WHY membership keys on `extra.plan_id` and are unrelated to this
   consolidation.

Distribution surface: binary-side (`packages/lore/**`) — ships with the compiled `lore`.

# Acceptance criteria

- **AC-1** (structural, deterministic): exactly ONE file defines the predicate.
  `grep -rl 'function isPlanMember' packages/lore/src/ | wc -l` prints `1`, and that file
  is `packages/lore/src/service/plan-membership.ts`.
- **AC-2** (import wiring): both `task-workflow-service.ts` and
  `phase-workflow-service.ts` contain `from "./plan-membership.js"`.
- **AC-3** (JSDoc no longer carries the false blocker): `plan-membership.ts` contains
  neither the string `NOT the only copy` nor `NAMED FOLLOW-UP`.
- **AC-4** (behaviour unchanged): `bun run typecheck` clean, and the scoped oracle
  `bun run test:changed <base>` passes with a NON-ZERO selection count (a zero-selection
  green is a refusal per the loud-zero rule).
- **AC-5** (regression, six-dimension): the existing plan-membership freshness fixtures
  in the service test suites still pass unmodified — this is a pure de-duplication, so a
  test edit is evidence the refactor changed behaviour.

# Proxy / Silence / Opt-in (binding — adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the)

**Proxy.** AC-1's `grep -rl` counts DEFINITION SITES as a proxy for "one source of
truth". Input that satisfies the proxy while violating the property: a fourth copy
written as an arrow const (`const isPlanMember = (t, p) => ...`) or a differently-named
inline `t.extra["plan_id"] === planId` comparison — neither matches
`function isPlanMember`. ACCEPTED with a stated residual: this AC pins the THREE KNOWN
copies, and the reviewer must additionally grep the raw comparison
(`grep -rn 'extra\["plan_id"\] ===' packages/lore/src/`) and report any site not routed
through the shared module. The residual is recorded rather than hidden.

**Silence.** The failure mode is a no-match grep reading as success (the
contiguous-substring / loud-zero family). AC-1 asserts a POSITIVE count of `1`, never
"no matches" — and AC-2 independently asserts the import exists, so a file deleted
outright cannot pass both. AC-4 requires a non-zero selection count for the same reason.

**Opt-in.** None. The shared predicate is invoked unconditionally at all 11 call sites;
there is no flag, config key, or env var gating it.
