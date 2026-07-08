---
id: TASK-080
type: task
role: plan
title: "V1 core: attestation schema + resolveTargetTask + attested coverage + verify config"
status: draft
priority: critical
phase: core
created: 2026-07-08
updated: 2026-07-08
tags: []
parent: PLAN-019
plan: PLAN-019
links:
  - {id: TASK-079, type: blocks}
  - {id: TASK-078, type: blocks}
  - {id: TASK-077, type: blocks}
---
Objective: land the entire @lore/core layer of SPEC-039. ACs: AC-VRF-1, AC-VRF-4 (pure mapper lives in lore pkg — only its INPUT types here), AC-VRF-7, AC-VRF-8 (core half), AC-VRF-12.
Work:
1. packages/core/src/task-workflow.ts — export const ATTESTATION_RUNNERS = ["lore-cli"] as const; evidenceEntrySchema += attestation: z.object({runner: z.enum(ATTESTATION_RUNNERS), exit_code: z.number().int(), duration_ms: z.number().int().min(0), timed_out: z.boolean()}).optional() ⛔ MUST be optional — extractEvidence is whole-array fail-closed (task-workflow.ts:188-193): a required field silently zeroes ALL legacy evidence. Add resolveTargetTask(tasks: DocRecord[], opts: {explicitTaskIdOrSlug?: string, nowIso: string, ttlMinutes: number}): Result<DocRecord, LoreError> — pure fn composing extractClaim + isClaimStale: explicit override wins (must be in tasks, else err); else exactly one task with a fresh claim → it; zero or >1 → err(VALIDATION_ERROR) whose message lists candidate slugs.
2. packages/core/src/acceptance.ts — verify.script branch += timeout_ms: z.number().int().positive().optional(); computeAcCoverage facts extend: refs[] items += attested?: boolean (true when the evidence entry has attestation), plus attested_pass/attested_fail counts per fact. Single derivation point — no consumer re-derives.
3. packages/core/src/config.ts — new verify section: { default_timeout_ms: number, default 300000 } (independent section like audit.*; Zod schema + default materialization following existing config section precedent).
4. Tests (vitest, packages/core): six-dimension. MANDATORY REGRESSION oracle: a verification_evidence array MIXING one legacy entry (no attestation) + one new entry (with attestation) parses via extractEvidence in full (this failure mode has NO existing oracle). resolveTargetTask full matrix (0/1/n fresh claims, stale excluded, explicit override, explicit-not-in-plan err). Coverage attested counts with mixed evidence.
Oracle: bunx vitest run packages/core + bun run typecheck. ⛔ only packages/core.
File anchors: packages/core/src/task-workflow.ts, acceptance.ts, config.ts, index.ts (exports), packages/core tests.
