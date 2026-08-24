---
id: SPEC-082
type: spec
role: spec
title: "Audit hardening part 2: gate-skip observability + push-time chain verification"
status: approved
priority: medium
created: 2026-07-26
updated: 2026-07-27
tags: []
parent: PRD-001
---
# SPEC-081 — Audit hardening part 2: gate-skip observability + push-time chain verification

> Kind: tech. Parent: PRD root. Follow-on to SPEC-079 — closes the residual observability
> gaps found while converging it: (G4) a checkpoint skipped via config-disable or
> `LORE_GATE_BYPASS=1` leaves ZERO audit trace, so "the gate was off" is invisible in
> hindsight; (G5) the pre-push corpus gate checks tree+drift but never the audit chain,
> so a tampered chain rides a push undetected; (G6) T4's weakness report #3 — deletion of
> the genesis audit row is reasoned-correct but not test-pinned.
> Dependencies: SPEC-079 (chain + verify), SPEC-046 (assets SSOT pairing), SPEC-049 (gate
> feeding packs — untouched).

> Renumbered SPEC-080 → SPEC-081 on 2026-07-26: three concurrent sessions each minted a "SPEC-080" (triple collision; the other two — prd-as-outline, bootstrap-injection — keep the number, this doc yields). AC ids deliberately RETAIN the AC-080-* prefix — evidence continuity > cosmetic renaming (SPEC-071 precedent).

## Overview/Goal

1. **Gate-skip observability (G4)** — every time a gate decision is SKIPPED rather than
   evaluated, an audit entry records that fact: action `"gate_skipped"`, details
   `{checkpoint, mechanism: "config_disabled" | "env_bypass", target?}`, actor = resolved
   actor chain. Covers (a) `GateEnforcer.enforce` returning early because
   `workflow.gates.<checkpoint>.enabled === false`, and (b) the `lore gate` CLI's
   `LORE_GATE_BYPASS=1` short-circuit.
2. **Push-time chain verification (G5)** — the pre-push hook additionally runs
   `lore audit --verify`; a chain break or anchor mismatch blocks the push (same fail-open
   contract when `lore`/`.lore/` are absent; `--no-verify` bypass unchanged). BOTH copies
   of the hook (`hooks/pre-push` and `assets/project/pre-push`) are updated and a
   content-parity test pins them byte-identical.
3. **Genesis-deletion pin (G6)** — the tamper suite gains an explicit test: deleting the
   FIRST audit row makes the new first row report `prev_link_mismatch` (its stored
   `prev_hash` is not `""`).

## Scope

**In scope**

- `GateEnforcer` gains an OPTIONAL audit-writer port (constructor-injected, e.g.
  `recordGateSkip?: (entry) => Promise<void>` or the store itself), wired ONLY in
  `app.ts` from the existing store (`appendAuditEntry`). Bare test constructions stay
  unwired → no write, byte-identical behavior (the established optional-DI shape).
  The write is best-effort: a failed audit insert NEVER turns a skip into a block
  (stderr warning instead) — observability must not change gate semantics.
- `lore gate` CLI `LORE_GATE_BYPASS=1` path: currently exits 0 BEFORE any parsing/config
  load. New behavior: still guarantees exit 0, but best-effort attempts to open the
  corpus and write one `gate_skipped` entry (mechanism `"env_bypass"`) before exiting;
  if the store is unreachable/absent, print one stderr line
  (`gate bypass NOT audited: <reason>`) and still exit 0 — the escape hatch's
  reliability contract is preserved, only its silence is removed.
- `"gate_skipped"` joins NO `VERSION_ACTION_AUDIT_FAMILY` family (audit-only action,
  same rule as SPEC-079's `"link"`/`"unlink"`/`"tree-fix"`).
- Service-layer `GateEnforcer` does NOT honor `LORE_GATE_BYPASS` today; that stays
  unchanged (bypass remains a CLI-pre-flight-only mechanism) — this spec only makes
  existing skips visible, it does not add or extend any bypass.
- `hooks/pre-push` + `assets/project/pre-push`: append the `lore audit --verify` step
  after the existing `lore status --check-tree --check-drift` step (separate exit-code
  handling, distinct error message naming the chain/anchor failure and the repair
  surface). Content parity between the two copies is asserted by a new vitest suite
  (byte-identical + both contain the verify invocation) — the SSOT↔installed-pair
  lesson mechanized for this pair.
- Tamper suite addition (G6) in the existing `audit-tamper.bun.test.ts`.

**Out of scope**

- Auditing `.lore/config.yaml` hand-edits themselves (file-level change tracking stays a
  git/policy concern; this spec records gate-skip FACTS at decision time instead, which
  is the moment that matters).
- Extending `LORE_GATE_BYPASS` to the service layer.
- Any change to gate predicates, feeding packs, or checkpoint semantics.

## Design Decisions

- D1 — Observability never changes gate outcomes: skip-audit writes are best-effort,
  fail-open, loud on failure.
- D2 — `gate_skipped` details carry `checkpoint`, `mechanism`, and the target doc
  id/slug when the call site has one in hand; no new resolution logic.
- D3 — The CLI bypass keeps its exit-0 guarantee unconditionally; tracing is additive.
- D4 — Hook parity is enforced by test, not convention (bidirectional-divergence lesson).
- D5 — Pre-push verify reuses `lore audit --verify`'s existing exit semantics; the hook
  maps any non-zero to push-block with the specific failure text passed through.

## Acceptance Criteria

Structured ACs via `lore ac add` (all script-mode); canonical test paths are contract:

- AC-080-1 — GateEnforcer config-disabled skip writes a `gate_skipped` audit entry
  (mechanism `config_disabled`, correct checkpoint/actor/target details; unwired port →
  no write, no behavior change; failing port → skip still succeeds):
  `bunx vitest run packages/lore/tests/unit/service/gate-skip-audit.test.ts`
- AC-080-2 — `lore gate` env-bypass trace: bypass writes a `gate_skipped` entry
  (mechanism `env_bypass`) when the corpus is reachable, prints the not-audited stderr
  line and still exits 0 when it is not:
  `bunx vitest run packages/lore/tests/integration/cli/gate-bypass-audit.test.ts`
- AC-080-3 — hook pair parity + content: `hooks/pre-push` and `assets/project/pre-push`
  are byte-identical and both invoke `lore audit --verify`:
  `bunx vitest run packages/lore/tests/unit/assets/pre-push-parity.test.ts`
- AC-080-4 — genesis-deletion pin added and the whole tamper suite passes:
  `cd packages/lore && bun test tests/unit/store/audit-tamper.bun.test.ts`
- AC-080-5 — full regression: `bun run typecheck && bun run test` exits 0.


## Acceptance Criteria (structured)

- [⚑] [script] AC-080-1: GateEnforcer config-disabled skip writes a gate_skipped audit entry with mechanism config_disabled and correct checkpoint/actor/target; unwired port writes nothing; failing port never blocks the skip
  script: test — bunx vitest run packages/lore/tests/unit/service/gate-skip-audit.test.ts
- [⚑] [script] AC-080-2: lore gate LORE_GATE_BYPASS=1 writes a gate_skipped entry with mechanism env_bypass when the corpus is reachable, prints the not-audited stderr line and still exits 0 when unreachable
  script: test — bunx vitest run packages/lore/tests/integration/cli/gate-bypass-audit.test.ts
- [⚑] [script] AC-080-3: hooks/pre-push and assets/project/pre-push are byte-identical and both invoke lore audit --verify
  script: test — bunx vitest run packages/lore/tests/unit/assets/pre-push-parity.test.ts
- [⚑] [script] AC-080-4: tamper suite gains the genesis-row deletion pin (new first row reports prev_link_mismatch) and the whole suite passes
  script: test — cd packages/lore && bun test tests/unit/store/audit-tamper.bun.test.ts
- [⚑] [script] AC-080-5: full regression passes: typecheck and both test runners exit 0
  script: build — bun run typecheck && bun run test

## Code anchors

- packages/lore/src/service/gate-enforcer.ts#buildGateSkipAuditEntry
- packages/lore/src/adapters/cli/gate-bypass-audit.ts
- hooks/pre-push
