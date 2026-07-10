---
id: PLAN-024
type: plan
role: plan
title: "Implementation — corpus-governed spec-production loop (IoC slice)"
status: approved
priority: high
created: 2026-07-08
updated: 2026-07-08
tags: [implementation, ioc-slice, hook-gate]
parent: SPEC-044
phases:
  - {name: "Phase 1 — gate kernel", description: "Pure predicates + spec-create/spec-promote gate commands with paired RED tests"}
  - {name: "Phase 2 — feeding asset", description: "Seed write-spec rule doc + minimal-slice feeding-pack trimming"}
  - {name: "Phase 3 — hook bridge + loop", description: "Hook shims + settings wiring + e2e closed-loop and verify dogfood"}
---
**Implements:** `spec-corpus-governed-spec-production-loop-ioc-vertical-slice` (tech-spec, IoC vertical slice)

## Governance

`attended` — each Phase Gate requires user confirmation before proceeding. Invariant violations hard-block regardless of mode.

## Invariants (verified at every Phase Gate)

- **INV1** — Deterministic-zone decisions are 100% derived from exit codes; zero AI judgment enters the deterministic gate (boundary ①).
- **INV2** — Probabilistic zone (SPEC-034 judge) writes advisory/escalate to stderr ONLY; never alters an exit code.
- **INV3** — Feeding fires only on a gate violation and carries a minimal trimmed slice + `[source/trust]` tag, never a full dump (boundaries ②③).
- **INV4** — All tests/e2e run against a throwaway corpus (mkdtemp + `lore init`); ZERO writes to the repo `.lore` (project hard rule).
- **INV5** — Gate keeps a `LORE_GATE_BYPASS` escape hatch (anti-rigidity).

## Risk Register

| Id | Sev | Risk | Mitigation |
|---|---|---|---|
| R1 | H | Predicate bug deterministically false-blocks correct specs | T1 high-coverage unit tests (pure fns) + `LORE_GATE_BYPASS`; gate verifies INV1 |
| R2 | M | G2 Bash-path command parsing brittle | narrow regex + parse-fail → fail-open-with-log |
| R3 | M | Seed rule doc tampered | approved-only feedable + trust tag + SPEC-035 audit |
| R4 | L | Agent bypasses via direct .md write | out-of-scope this slice; documented |

## Phases & Critical Path

- **Phase 1 — gate kernel**: T1 predicates, T2 `spec-create`, T3 `spec-promote` (+ paired RED tests)
- **Phase 2 — feeding asset**: T4 seed rule doc + minimal-slice trimming
- **Phase 3 — hook bridge + loop**: T5 hook shims + settings wiring, T6 e2e loop + verify dogfood

**Critical path:** T1 → T2 → T3 → T5 → T6 (T4 parallelizable around T2). Dependencies enforced via lore `blocks` links; readiness computed by `lore ready`.

## Task Roster (AC = deterministic exit-code / vitest oracles; no vague verbs)

| Task | Est | Depends on (blocked by) | File anchor |
|---|---|---|---|
| T1-test | S | — | tests/unit/service/gate-predicates.test.ts |
| T1 predicates | S | T1-test | service/gate-predicates.ts |
| T2-test | M | T1 | tests/…/gate-spec-create.bun.test.ts |
| T2 spec-create | M | T1, T2-test | cli/commands/gate.ts |
| T3-test | S | T2 | tests/…/gate-spec-promote.bun.test.ts |
| T3 spec-promote | M | T2, T3-test | cli/commands/gate.ts (serial w/ T2) |
| T4-test | S | — | tests/…/gate-feeding.test.ts |
| T4 feeding+seed | M | T4-test | service/gate-feeding.ts, scripts/seed-write-spec-rule.ts |
| T5 hooks | M | T2, T3 | hooks/g1-*.sh, hooks/g2-*.sh, .claude/settings.json |
| T6 e2e+verify | M | T4, T5 | tests/e2e/spec-loop.e2e.ts |

Concurrency: T2 & T3 touch the same `gate.ts` → serial. T1 (service) and T4 (different service file) parallelizable before T2. T5 (settings/hooks) independent. Worktree isolation per task; merge on return.
