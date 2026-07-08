---
id: KN-035
type: knowledge
role: knowledge
title: "Retro — SPEC-038 + SPEC-039 double delivery (multi-agent orchestration learnings)"
status: approved
priority: medium
created: 2026-07-08
updated: 2026-07-08
tags: [retro, orchestration, spec-038, spec-039, verify]
parent: PRD-001
---
# Retro — SPEC-038 + SPEC-039 double delivery session (2026-07-08)

> Session retro: from a loop-engineering discussion to two landed, assessed, self-verified specs
> in one continuous run. Captured for future sessions driving similar multi-agent deliveries.

## What was delivered

- **SPEC-038 AC-as-code** (PLAN-018, 6 tasks): structured `acceptance_criteria` on specs,
  `ORACLE_KINDS` SSOT consolidation (3 copies → 1), evidence `ac_ref` + cross-entity port,
  `lore ac` verbs, assess judges against the declared AC set (prompt v4), AC checklist projection.
  Assessed: **met 88/100**.
- **SPEC-039 trusted runner** (PLAN-019, 5 tasks): `lore verify` executes script-AC commands,
  result derived from exit code, attestation with a single injection site
  (`recordVerifiedEvidence`), public write paths reject forged attestation loud, `⚑✔` rendering,
  MCP `lore_verify` (24 tools), assess prompt v5. Assessed: **met 88/100**. Closing move:
  `lore verify` ran its own spec's 12 ACs — 12/12 attested pass.
- PRD v0.7, ADR "AC-as-code", research digest (KN-032), two assessments (KN-033/034).

## What worked (keep doing)

1. **Per-merge oracle re-runs by the orchestrator caught every integration break.**
   Three incidents, none survived past the merge gate:
   - SPEC-038 T2/T3 semantic conflict (both green solo; T3's fail-loud validation correctly
     broke T2's pre-validation fixtures) → fix agent, +1 NEGATIVE test.
   - SPEC-039 V1 made `AcCoverageFact` counts required → two SPEC-038-era fixture literals
     broke at tsc (vitest passed — esbuild strips types; tsc is the oracle that caught it).
   - V1 agent reported "full typecheck exit 0" inaccurately — re-verification exposed it.
   Rule confirmed: **agent self-reports are claims; the orchestrator re-runs the oracles.**
   This is precisely the failure class SPEC-039 now mechanizes for task evidence.
2. **Structured ACs declared BEFORE implementation (SPEC-039) beat retrofit (SPEC-038).**
   V-tasks referenced AC ids in dispatch bundles; `lore verify` closed them mechanically.
3. **4-perspective design review paid for itself twice**, catching with code evidence:
   a fabricated precedent (no SIGKILL escalation exists in claude-cli-provider), the
   `extractEvidence` whole-array fail-closed trap (required attestation would have silently
   zeroed ALL legacy evidence), the attestation spoofing hole via `EvidenceInput`'s `Omit`,
   and process-group kill semantics.
4. **File-anchor mutual exclusion enabled 4-way (038) / 2-way (039) parallel worktrees**
   with zero textual merge conflicts across 11 merges; conflicts that did occur were
   semantic and caught by the oracle gate (see #1).
5. **Judge feedback was consumed, not archived**: assess gap "dogfood coverage thin" →
   per-AC evidence recorded same-session → 11/11 ✔. This manual loop is the working
   preview of §14 R2's automation.

## What to fix next time

1. **`get --raw` round-trip trap**: CLI decorates raw output with a header block AND a
   navigation footer; writing it back via `set --content-file` baked the header into PRD v9
   (caught by diff review, fixed in v10). Rule: strip BOTH ends, and always `lore diff`
   after content-file writes. (Candidate hardening: a `--raw --body-only` flag.)
2. **Evidence output tails should be distinct per assertion** (judge gap, KN-034): two ACs
   sharing one command got byte-identical tails; record per-AC tails or split commands.
3. **Full-suite evidence tails should carry the summary line**, not server-log noise
   (`bun run test` tail truncation hid the pass counts from the judge).
4. **Subagent CLAUDE.md updates are uneven** (T1/V1 skipped core CLAUDE.md; caught in
   T6/V5 sweeps). Keep the closing docs sweep as a mandatory phase task.

## Calibration reality check

`lore calibration --stats` mid-session: N=1. PRD §14's data gate (freeze at assist,
R2 ADR-gated on weekly volume ≥10) is confirmed correct — no autonomy expansion until
judgment volume exists. The 10 approve decisions this session now seed the dataset.

## Pointers

SPEC-038 / SPEC-039 / PLAN-018 / PLAN-019 / ADR "AC-as-code" / KN-032 (research) /
KN-033, KN-034 (assessments). Loop framing: effectiveness = feedback ×
feedback-trustworthiness × loop-closure; pieces ①② landed, ③④ remain §14 R2 data-gated.
