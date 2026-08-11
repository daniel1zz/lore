---
id: PLAN-098
type: plan
role: plan
title: "git-safety-gate argument-aware probes"
status: archived
priority: medium
created: 2026-07-31
updated: 2026-07-31
tags: []
parent: SPEC-120
phases:
  - {name: "Fix"}
---
# Plan — git-safety-gate argument-aware probes

## Goal

Implement the approved spec `spec-git-safety-gate-probes-report-the-wrong-blast-radius`: make `probeStash` and `probePathArg` read their arguments, hand probes the raw (un-blanked) segment while trigger matching keeps the sanitized one, pin the fail-closed direction with a literal `[ARG-FALLBACK]` marker, and ship the change through the assets manifest so `lore setup` consumers receive it.

## Oracle

`lore verify` over AC-GS-1 … AC-GS-7. External oracles only — vitest exit code plus matched-case counts; no LLM self-judgement.

## Phases

Single phase (`Fix`) — one task. The change is confined to one SSOT hook file plus its test file and the generated manifest; splitting it would create a merge seam inside a single function's contract.

## Risks

- **Weakening SPEC-066 while obtaining the argument.** Handing probes raw text must not let quoted payloads reach trigger matching. AC-GS-2's paired control is the guard.
- **Regenerating the assets manifest as a byproduct.** `bun run build` rewrites `packages/lore/src/generated/assets-manifest.ts`; the regen is IN scope here (AC-GS-6) but must not pull in unrelated asset drift from a concurrent session.
- **Over-narrowing.** A parser bug that reports fewer entries than would die is strictly worse than today's over-report. D4 + AC-GS-5 pin the direction.
