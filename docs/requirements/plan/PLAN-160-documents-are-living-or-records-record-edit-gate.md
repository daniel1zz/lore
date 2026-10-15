---
id: PLAN-160
type: plan
role: plan
title: "Documents are living or records — record-edit gate"
status: archived
priority: medium
created: 2026-10-11
updated: 2026-10-11
tags: []
parent: SPEC-167
phases:
  - {name: "core-and-gate", description: "Classification table + record-edit gate on every rewrite path, with the correction exit"}
  - {name: "exits-and-surfaces", description: "Reopen exit, get/impact rendering, compiled e2e"}
  - {name: "prose", description: "Shipped prose stops prescribing in-place spec rewrites"}
links:
  - {id: SPEC-167, type: implements}
---
# Plan — Documents are living or records

Implements `spec-documents-are-living-or-records-a-locked-record-is-never` (AC-DR-1..10), baseline leaf `baseline-keep-a-record-unchanged` (BR-1046..1054). Upstream issue #155. Governance: batched — S1 decided with the user 2026-10-11 (lock point = settled, refuse + correction exit, reopen before evidence, plan living while open); this plan is the S2 draft; S3 bundle review and S4 single approval follow.

## Overview

One core table classifies every document kind living | record; a service-layer `record-edit` gate refuses body/title/restore/criterion rewrites of a locked record; two audited exits (correction, reopen-before-evidence); `lore get` and `lore rule impact` show the split; shipped prose stops prescribing in-place spec rewrites.

## Invariants (checked at every phase gate)

| # | Invariant | How it is checked |
|---|---|---|
| I1 | Exactly one classification table; no second standing list anywhere | `grep -rn "\"living\"" packages/*/src --include=*.ts` hits only `doc-standing.ts` and its importers' type positions |
| I2 | Every body-rewriting write path calls `assertEditable` before writing | AC-DR-2 + AC-DR-3 (each path has a refusal case) |
| I3 | Non-rewrite writes on locked docs are never refused | AC-DR-3 REGRESSION cases |
| I4 | No test writes the repository's live `.lore/` | new tests use InMemoryStore or `mkdtemp` + `lore init` |
| I5 | After each merge wave on main: typecheck exit 0, both runners green for changed scope, `bun run build` exit 0 | orchestrator, `--force`, unscoped re-verify on main |

## Risk register

| # | Risk | Impact | Trigger | Mitigation | Contingency |
|---|---|---|---|---|---|
| R1 | A write path that rewrites content is missed (e.g. dashboard route, AI rewrite in set) | H | AC-DR-2/3 green but a path bypasses | T2 anchors every adapter that reaches `CorpusService.set`; the gate sits in the service, not adapters | add the path to `assertEditable` callers + a refusal case |
| R2 | In-flight approved specs (baseline/run-identity) blocked mid-iteration after landing | M | refusals on those specs | reopen (no evidence) / correction / new spec | none needed — intended behaviour; B1 watches correction misuse |
| R3 | `everClaimed` from audit is slow on large corpora | L | `lore set` latency on tasks | single indexed audit query per task edit | cache per process |

## Pre-registered branch

B1 (spec D-branch): 14 days after landing, corrections ÷ (corrections + refusals) on specs > 50% → report the list to the user; ≤ 50% → keep.

## Decisions Log

- 2026-10-11 — S1 answers recorded in the spec's Design Decisions D1, D3, D4, D5.
