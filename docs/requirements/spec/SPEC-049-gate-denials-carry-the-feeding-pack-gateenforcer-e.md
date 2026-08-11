---
id: SPEC-049
type: spec
role: spec
title: "Gate denials carry the feeding pack (GateEnforcer error enrichment)"
status: approved
priority: medium
created: 2026-07-17
updated: 2026-07-27
tags: []
parent: PRD-001
---
# SPEC-049 — Gate denials carry the feeding pack (GateEnforcer error enrichment)

## Overview

The four service-layer gate checkpoints (`spec-create` / `spec-promote` / `plan-promote` / `task-claim`) currently deny with ONLY the machine discriminator (`Gate "task-claim" blocked: ANCHOR_OVERLAP`), while the SAME state probed via `lore gate <checkpoint>` renders the full feeding pack — conflicting task/holder/overlapping paths, a literal `lore release … --force` recovery command, the rule-doc slice. The corpus-governed workflow's core promise ("exit 4 + feeding pack; agents self-correct from the denial itself") is therefore true only on the PreToolUse-hook path; MCP tools, HTTP dashboard routes, and every CLI invocation whose hook failed open get a bare discriminator and no recovery guidance. Empirically confirmed 2026-07-17 on a fresh demo corpus across all four checkpoints and on the MCP surface (`lore_create` error payload). Source finding: `knowledge-dogfood-retro-full-lifecycle-fresh-corpus-run-snip-dem` (F2).

## Goal

Every GateEnforcer denial carries the SAME feeding-pack text `lore gate` would print for the identical state, embedded in the `LoreError` — so CLI, MCP, and HTTP callers all receive actionable recovery guidance with zero caller changes.

## Design

### D1 — enforce() renders the checkpoint's own feed callback on deny

`checkpointRegistry[checkpoint].feed(ctx, failures)` is already a pure function and `GateEnforcer.enforce` already holds both arguments at the deny site. On a blocked verdict, `enforce` calls `feed` and appends its rendered text to the error message:

```
Gate "<checkpoint>" blocked: <reasons>

<feeding pack text>
```

`code` (`VALIDATION_ERROR`), `field` (`gate:<checkpoint>[:<sub>]`), and `value` (reasons array) stay byte-identical — scripted consumers keying on those fields are unaffected (REGRESSION). Only `message` grows a `\n\n`-separated pack block.

### D2 — enforce() stays pure

No IO is added inside `GateEnforcer`. All feed callbacks consume only the `GateContext` the calling service already assembled. For `task-claim` (anchor-overlap) the ctx already carries `siblingClaims`/`candidateAnchors` — the recovery command renders with zero new inputs. Same for `plan-promote`/`task-claim` upstream (`parentSpecPointer`) and `spec-promote` (`specIdOrSlug`).

### D3 — spec-create rule-slice parity via caller pre-fetch

`spec-create`'s pack quotes the governing rule doc (`ruleSource`/`ruleMarkdown`) plus a parent slice (`parentMarkdown`) — IO that `gate.ts::runSpecCreateGate` performs but `CorpusService._createImpl` today does not. `_createImpl` (spec path only, and only when `gateEnforcer?.isEnabled("spec-create")`) pre-fetches via the existing `findFeedingSkill(SPEC_CREATE_PRODUCED_TYPE)` and threads `ruleSource`/`ruleMarkdown`/`parentMarkdown` into the `GateContext` — the identical ctx shape `gate.ts` builds. Cost: one extra store read per gated spec-create (a rare, human-scale operation; `lore gate` already pays it). No feeding skill found → ctx fields stay absent and the pack renders with `[source: unknown]` + the `Missing:` list — still strictly more information than today.

### D4 — surfaces inherit for free

CLI already prints `LoreError.message` verbatim (multi-line safe); MCP serializes the whole `LoreError` into the tool-error payload; HTTP returns it as the error body. No adapter changes.

## Scope

- `packages/lore/src/service/gate-enforcer.ts` — deny-path feed rendering (D1).
- `packages/lore/src/service/corpus-service.ts` — spec-create ctx enrichment (D3).
- Unit tests: enforcer embeds pack per checkpoint; corpus-service enrichment (found/absent feeding skill); task-claim denial message contains the literal recovery command; existing exact-message assertions updated.

## Out of scope

- Hook cwd derivation (F3 — separate spec).
- New LoreError fields/codes; adapter rendering changes; `lore gate` CLI behavior (already correct).

## Acceptance criteria

Declared as structured ACs (`lore ac add`): typecheck clean; gate-related vitest suites green; full dual-runner suite green; live-repro manual AC — an anchor-overlap `lore claim` denial on a scratch corpus prints the conflicting holder and the literal `lore release <slug> --by <holder> --force` line.


## Acceptance Criteria (structured)

- [✔] [script] AC-049-1: TypeScript strict typecheck passes across all packages
  script: tsc — bun run typecheck
- [✔] [script] AC-049-2: Gate-related unit suites pass (enforcer feed embedding, corpus-service spec-create enrichment, checkpoint registry regression)
  script: test — bunx vitest run packages/lore/tests/unit/service/gate-enforcer.test.ts packages/lore/tests/unit/service/checkpoint-registry.test.ts packages/lore/tests/unit/service/gate-feeding.test.ts
- [✔] [script] AC-049-3: Full dual-runner suite green (vitest + bun test)
  script: test — bun run test
- [✔] [human] AC-049-4: Live repro: anchor-overlap lore claim denial on a scratch corpus prints conflicting holder + literal 'lore release <slug> --by <holder> --force' recovery command
  human: Reproduce on a throwaway corpus (mkdtemp + lore init), never the repo corpus

## Code anchors

- packages/lore/src/service/gate-enforcer.ts#GateEnforcer
- packages/lore/src/service/corpus-service.ts
