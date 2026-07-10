---
id: TASK-086
type: task
role: plan
title: "T2: lore feed command + lore_feed MCP (pull, SSOT with gate pack)"
status: archived
priority: high
phase: Core: governs + feed
created: 2026-07-09
updated: 2026-07-09
tags: []
parent: PLAN-021
plan: PLAN-021
links:
  - {id: TASK-084, type: blocks}
---
## Task Objective
Add `lore feed <checkpoint> [--parent <id-or-slug>] [--json]` CLI command + a `lore_feed` MCP tool — the deterministic feed-before-produce PULL surface. Behavior: derive produced-type from checkpoint (`spec-create -> "spec"`); `app.corpusService.findFeedingSkill(type)`; if found, assemble + render the feed via `service/gate-feeding.ts` (`buildFeedingPack` + `renderFeedingPack`), including the `--parent` doc summary when given; if none, print a clear "no approved governing skill for <type>" note. Exit 0 ALWAYS (feed is advisory, never a gate). `--json` returns `{checkpoint, type, skill:{slug,title}|null, feed}`.

## Spec Reference
§5.1, §2 IN(1), §7 boundary 2. ⛔ SSOT: the pulled pack MUST equal the pack `lore gate spec-create` emits on violation for the same corpus — reuse the SAME findFeedingSkill + gate-feeding primitives, do not re-implement pack assembly.

## Acceptance Criteria
- AC-P4-1: `lore feed spec-create --parent <prd>` with an approved knowledge/skill (applies_to=spec) -> stdout has the skill rule slice + parent summary + `[source…trust…]` header; exit 0; equals the gate feeding pack for the same corpus.
- AC-P4-2: no approved governing skill -> graceful "no governing skill for spec" note; exit 0.
- MCP `lore_feed` returns the structured shape.
- Full suites + typecheck green. Tests on throwaway corpus.

## Context Digest
`CorpusService.findFeedingSkill(appliesTo)` (`corpus-service.ts:960`) returns newest approved knowledge/skill with `extra.skill.applies_to===appliesTo`, `ok(null)` if none. `gate.ts:358` shows the exact reuse pattern (`findFeedingSkill(app, "spec")` then buildFeedingPack/renderFeedingPack). `gate-feeding.ts`: `buildFeedingPack({ruleDoc, parentDoc?, missing})`, `renderFeedingPack(pack)`, `DEFAULT_FEEDING_MAX_CHARS`. MCP tools live in `packages/lore/src/adapters/mcp/tools.ts` (see `lore_claim`/`lore_create` registration for the pattern). No blocking, no gate.

## File Anchors
- NEW `packages/lore/src/adapters/cli/commands/feed.ts`
- EDIT MCP tools registration (`packages/lore/src/adapters/mcp/tools.ts`) + wherever the CLI subcommands are registered
- READ `packages/lore/src/adapters/cli/commands/gate.ts` (feed reuse pattern), `service/gate-feeding.ts`, `service/corpus-service.ts:960`
- NEW tests (throwaway corpus, `*.bun.test.ts` if it spins a real corpus)
