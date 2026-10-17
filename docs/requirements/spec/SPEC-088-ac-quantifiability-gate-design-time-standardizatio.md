---
id: SPEC-088
type: spec
role: spec
title: "SPEC — AC-Quantifiability Gate (design-time standardization enforcement)"
status: draft
priority: medium
created: 2026-07-17
updated: 2026-10-17
tags: []
---
# SPEC — AC-Quantifiability Gate (design-time standardization enforcement)

## Overview/Goal

Close the highest-leverage gap in Lore's acceptance chain: **the spec itself is AI-authored, and the only gate on it (`spec-create` g1) checks structural skeleton, not whether its acceptance criteria are quantifiable/oracle-bindable.** Every downstream layer (`lore verify`, `lore assess`, `lore-uat`) verifies *conformance to the spec*; none can verify the spec's own ACs are measurable. An AI can therefore write a structurally-conformant spec whose ACs say "the UI is clean" or "it should be fast" — unverifiable prose that passes every gate.

This spec adds a **deterministic AC-quantifiability lint** (zero-LLM, CI-safe) wired into the `spec-create` and `spec-promote` checkpoints, plus an **advisory AI supplement** for nuanced vagueness the wordlist can't catch. It mechanizes the CLAUDE.md "抽象词必量化" discipline that currently lives only as prompt guidance — turning design-time standardization from convention into a corpus gate, consistent with Lore's own philosophy ("纪律在 corpus 里,确定性 gate 拦截,AI judge 永远 advisory").

Goal is not to force every AC into `script` mode — `ai`/`human` verify modes remain legal — but to reject an AC whose **statement** asserts a subjective/abstract quality with no measurable anchor, and to nudge weak verify bindings.

## Scope

**In scope:**
- A pure core module `packages/core/src/ac-quality.ts`: `lintAcQuantifiability(criteria: AcceptanceCriterion[]): AcQualityFinding[]` — deterministic, zero IO, zero provider calls. Detects abstract-quality words in an AC `statement` with no accompanying measurable token (numeric threshold, unit, comparison operator, percentile, named oracle binding), and flags weak verify bindings. `severity: "block" | "warn"`.
- A curated `AC_ABSTRACT_WORDS` list (fast/slow/clean/simple/robust/modern/elegant/intuitive/seamless/scalable/performant/efficient/secure/high-quality/good/better/optimal/nice/user-friendly + the zh set 快/简洁/优雅/现代化/高质量/健壮/好用) and a `MEASURABLE_TOKEN` recognizer (digits+unit, `P95`/`P99`, `<=`/`>=`/`<`/`>`, `ms`/`s`/`%`/`MB`, an explicit oracle/threshold clause).
- A new pure gate predicate `acQuantifiable` in `gate-predicates.ts`, wired into `spec-create` and `spec-promote` in `checkpoint-registry.ts`, with a feeding-pack renderer (`gate-feeding.ts`) naming each offending AC id + the offending word + the fix. Enforced identically at the service layer (`GateEnforcer`) and the g1/g2 hooks.
- Config knob `workflow.gates.<checkpoint>.ac_quantifiable.enabled` (default `true`), mirroring the `anchor_overlap` sub-predicate escape shape.
- An advisory AI supplement surfaced on `lore review <spec>` (never in the deterministic gate path): flags vague ACs the wordlist missed. Advisory only — a provider-absent run still passes the deterministic gate.

**Out of scope (later specs):**
- Requirement→AC completeness oracle (PRD requirement coverage) — needs structured PRD requirements first.
- UIUX high-quality ceiling / design-spec conformance.
- Calibration wiring for the AI supplement judge.

## Acceptance Criteria

- **AC-ACQ-1** (core lint, script) — `lintAcQuantifiability` returns ≥1 `block` finding for an AC whose statement contains an `AC_ABSTRACT_WORDS` member with no measurable token, and exactly 0 findings for the same statement rewritten with a numeric threshold. Verified by a unit test in `packages/core` (`bunx vitest run packages/core` exits 0).
- **AC-ACQ-2** (zero-LLM, script) — `ac-quality.ts` imports no AI/provider symbol and performs 0 provider calls: a source-scan test asserts `grep` finds no `AIProvider`/`generate(` in the module, and the lint runs to completion with no provider injected. `bun test` exits 0.
- **AC-ACQ-3** (gate rejects, script) — `lore create spec` (and the service-layer `CorpusService.create`) with an AC statement carrying an unquantified abstract word exits 4 with a feeding pack naming the offending AC id; the same spec with all ACs quantified exits 0. Integration test exits 0.
- **AC-ACQ-4** (config escape, script) — with `workflow.gates.spec-create.ac_quantifiable.enabled: false`, a spec that AC-ACQ-3 would block instead passes (exit 0). Integration test exits 0.
- **AC-ACQ-5** (AI supplement is advisory-only, script) — a `spec-create`/`spec-promote` with a provider absent (`--no-ai`/no config) still passes the deterministic gate for a quantified spec; the AI vagueness check runs only under `lore review <spec>`. Test asserts the gate path issues 0 provider calls. Exit 0.
- **AC-ACQ-6** (dogfood self-application, script) — this spec's own declared `acceptance_criteria` produce 0 `block` findings from `lintAcQuantifiability`. A test loads this spec's ACs and asserts `findings.filter(f => f.severity === "block").length === 0`. Exit 0.
- **AC-ACQ-7** (false-positive bound, script) — running `lintAcQuantifiability` over every existing corpus spec's already-declared `script`-mode ACs yields 0 `block` findings (script-oracle-bound ACs are quantified by construction; any block finding on them is a false positive to fix before merge). Test exits 0.

## Design

The lint is the hard gate; the AI judge is advisory. `lintAcQuantifiability` mirrors `computeAcCoverage`/`runDeterministicChecks` (pure, browser-safe, no wall-clock). The gate predicate consumes only the AC array already in the `GateContext` — no new store reads. Feeding-pack text names `AC-<id>: abstract word "<w>" has no measurable anchor — add a threshold (e.g. "P95 < 200ms"), bind an oracle, or restate measurably`. The predicate is order-inserted after `hasSkeleton` in both checkpoints so a skeleton-missing spec still reports skeleton first.


## Acceptance Criteria (structured)

- [⚑] [script] AC-ACQ-1: lintAcQuantifiability returns >=1 block finding for an AC statement with an abstract word and 0 measurable token, and exactly 0 findings when rewritten with a numeric threshold
  script: test — bunx vitest run packages/core/tests/unit/ac-quality.test.ts
- [⚑] [script] AC-ACQ-2: ac-quality.ts imports no AIProvider/generate symbol and issues 0 provider calls; source-scan test asserts grep finds no AIProvider in the module
  script: test — bunx --bun vitest run packages/core/tests/unit/ac-quality-no-llm.bun.test.ts
- [⚑] [script] AC-ACQ-3: spec-create with an AC carrying an unquantified abstract word exits 4 with a feeding pack naming the offending AC id; same spec with all ACs quantified exits 0
  script: test — bunx vitest run packages/lore/tests/unit/service/ac-quantifiable-gate.test.ts
- [⚑] [script] AC-ACQ-4: with workflow.gates.spec-create.ac_quantifiable.enabled false, a spec that AC-ACQ-3 would block passes with exit 0
  script: test — bunx vitest run packages/lore/tests/unit/service/ac-quantifiable-gate.test.ts -t config-escape
- [⚑] [script] AC-ACQ-5: a spec-create with provider absent still passes the deterministic gate for a quantified spec; the gate path issues 0 provider calls; AI vagueness check runs only under lore review
  script: test — bunx vitest run packages/lore/tests/unit/service/ac-quantifiable-gate.test.ts -t advisory-only
- [⚑] [script] AC-ACQ-6: this spec's own declared acceptance_criteria produce 0 block findings from lintAcQuantifiability
  script: test — bunx vitest run packages/core/tests/unit/ac-quality.test.ts -t dogfood-self-application
- [⚑] [script] AC-ACQ-7: lintStatement rejects a match hyphen-adjacent to a bare AC_ABSTRACT_WORDS entry (e.g. "fast-track", "best-effort") while still blocking that same word standalone (e.g. "the dashboard loads fast") and continuing to clear suffix collisions ("breakfast", "faster")
  script: test — bunx vitest run packages/core/tests/unit/ac-quality.test.ts -t hyphen-adjacency-bound
