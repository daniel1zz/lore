---
id: TASK-371
type: task
role: plan
title: "capture_source is optional at the evidence write boundary with a silent self-report default, so a caller that never said is recorded as if it had"
status: archived
priority: high
created: 2026-08-03
updated: 2026-08-03
tags: []
parent: PRD-001
---
# Defect — `capture_source` is optional at the write boundary with a silent `?? "self-report"`

`EvidenceInput` (`packages/lore/src/service/task-workflow-service.ts:522`) leaves
`capture_source` optional, and the write path defaults it (`?? "self-report"` at ~line 1666).

This is a **no-silent-fallback violation on the field that decides whether an evidence row is
trustworthy**. A caller that forgets to pass it gets a row that *reads* as an honest
self-report — indistinguishable from one deliberately declared as such. The value that
matters most (runner vs self-report) is the one the type system currently lets you omit.

Reported by `agent:fix-mcp-claim-capture` as (i)(1) after both adapters were made to pass it
explicitly. The same agent measured that its task's premise — "rows arrive with the field
absent" — was FALSE precisely *because* of this default: the test asserting a defaulted value
passed before any fix. **The default is what makes the gap invisible.**

# Mechanism root

A required-for-correctness field modelled as optional-with-default. The default is not a
neutral convenience: `self-report` is the SAFE value, so defaulting looks harmless — and that
is exactly why it survived. Silent-safe defaults are still silent: they convert "the caller
never said" into "the caller said self-report", destroying the distinction between an
unattested row and an unasked question.

# Required fix

1. Make `capture_source` REQUIRED on the write boundary:
   `Omit<…, "capture_source"> & { capture_source: CaptureSource }` at
   `task-workflow-service.ts:522`.
2. Delete the `?? "self-report"` fallback (~line 1666). ⛔ Do not replace it with a throw at
   that line — the type must make omission unrepresentable; a runtime guard there is the
   second-best mechanism and invites the type to be loosened later.
3. Update the remaining callers: `phase-workflow-service.ts` and `verify-runner-service.ts`.
   Both adapters (CLI + MCP) already pass it explicitly, so the type change is safe —
   verify that claim rather than trusting this sentence.
4. Each updated caller must pass the value it can actually PROVE, never the convenient one:
   if the caller did not spawn the command, it is `self-report`.

Distribution surface: binary-side (`packages/lore/**`).

# Acceptance criteria

- **AC-1** the type refuses omission: a construction without `capture_source` fails
  `bun run typecheck`. Assert by a deliberately-broken fixture in a type-test, not by prose.
- **AC-2** the `?? "self-report"` fallback is gone —
  `grep -c '?? "self-report"' packages/lore/src/service/task-workflow-service.ts` prints `0`.
  ⚠ This is a contiguous-substring assertion; ALSO assert AC-1 independently, since a
  reformatted fallback would evade the grep.
- **AC-3** every caller passes a PROVABLE value: `verify-runner-service.ts` (which does spawn)
  passes `runner`; `phase-workflow-service.ts` passes what its own path can prove. Assert per
  caller with a test, not by reading the code.
- **AC-4** REGRESSION: an existing row already stored WITHOUT the field still reads back fine
  (this changes the write boundary only — stored data is untouched). Assert against a fixture
  row lacking it.
- **AC-5** `lore done`'s attestation logic is unchanged in behaviour by this refactor — a
  self-report row still cannot archive, a runner row still can. Assert both directions.
- **AC-6** `bun run typecheck` clean; `bun run test:changed <base>` passes with a NON-ZERO
  selection count (loud-zero rule).
- Six-dimension coverage (HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION).

⚠ **Anchor mutex**: `task-workflow-service.ts` and `phase-workflow-service.ts` are also
claimed by `task-three-byte-identical-copies-of-isplanmember-survive` and
`task-phaseworkflowservice-claim-captures-no-session-id-so-every`. Sequence all three.

# Proxy / Silence / Opt-in (binding — adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the)

**Proxy.** `capture_source` is a claim ABOUT provenance, and after this fix it is still only as
true as each caller's honesty — the field is a proxy for "a runner really captured this". What
makes it load-bearing is that no EXTERNAL caller can set it (the MCP surface has no such input
field; the CLI derives it). This task does not change that; it removes the case where NOBODY
set it. Residual, stated: an internal caller can still pass `runner` wrongly. A test per
caller (AC-3) is the only available check.

**Silence.** The defect IS a silence, and the fix is to make the omission a compile error —
the loudest available signal, and one that cannot be skipped under pressure. AC-1 pins it.

**Opt-in.** None. There is no flag; the field becomes mandatory for every internal caller.
