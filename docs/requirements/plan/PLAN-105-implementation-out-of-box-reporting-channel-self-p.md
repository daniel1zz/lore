---
id: PLAN-105
type: plan
role: plan
title: "Implementation — out-of-box reporting channel (self-provision + SPEC-073 hint unlock)"
status: archived
priority: high
created: 2026-07-29
updated: 2026-10-25
tags: [feedback-loop, distribution-first]
parent: SPEC-108
phases:
  - {name: "RED"}
  - {name: "GREEN"}
  - {name: "CLOSE"}
---
# Implementation — out-of-box reporting channel (self-provision + unlock the SPEC-073 hint)

## Goal

Make `lore report-issue` usable on a fresh consumer corpus with no hand-edited YAML, and break
the SPEC-072 ↔ SPEC-073 self-lock (the promotion hint's trigger condition is the configuration
nothing provisions). Governing spec:
`spec-out-of-box-reporting-channel-report-issue-self-provisions` (AC-OOB-1 … AC-OOB-7).

## Approach

Red-then-green, three phases. Phase 1 lands the failing oracles FIRST (both test files are
authored against behaviour that does not exist yet and must be observed RED before any
implementation lands). Phase 2 implements behind the existing `report-issue-wiring.ts` seam.
Phase 3 closes with the full two-runner suite and code-anchor declaration.

## Invariants

1. **No new config-read site.** `resolveFeedbackUpstreamCfg` (report-issue-wiring.ts) stays the
   ONLY place `feedback.upstream` is read. Verified by diff: no second `config.feedback` access
   path appears outside that module.
2. **`FeedbackConfigSchema` is unchanged.** This slice writes the existing shape; it does not
   add `transport` or any other key. Verified by diff on `packages/core/src/config.ts`.
3. **SPEC-073's configured-branch wording is byte-frozen.** Only the unconfigured branch of
   `buildReportIssueHint` changes behaviour (AC-OOB-6 asserts both directions).
4. **No writes to this repo's own `.lore/`** from any test — every provision test uses a
   `mkdtemp` throwaway corpus (canonical pattern:
   `packages/dashboard/tests/e2e/global-setup.ts`).

## Risks

- **[M] Binary-resolution fragility.** The installed `lore` may be a symlink, a compiled
  `dist/lore`, or run from source via `bun run dev` — the resolver must handle all three or
  fail LOUD, never guess. Mitigation: AC-OOB-3 and AC-OOB-5 are the negative oracles.
- **[M] `.bun.test.ts` files spawning a compiled binary need `bun run build` first** — a stale
  `dist/lore` silently tests old behaviour (a known false-oracle vector; `lore verify` now
  pre-checks build freshness, but a bare `bun test` run does not).
- **[L] Test-corpus pollution** if any provisioning test resolves upstream to this repo. The
  identity-pin path makes this observable rather than silent.

## Exit Criteria

All seven ACs attested via `lore verify` against a green run, plus the full two-runner suite
(`bun run test`) exit 0 on a CLEAN tree at a named commit.
