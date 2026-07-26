---
id: ADR-005
type: adr
role: decision
title: "LoreConfig carriage for MCP tools — getter param now, App-field as structural fix"
status: draft
priority: medium
created: 2026-07-24
updated: 2026-07-24
tags: []
parent: SPEC-070
---
# ADR — LoreConfig carriage for MCP tools: getter param now, App-field as the structural fix

## Context
SPEC-070's review (architecture finding 2, cross-validated by Codex finding 3) identified that MCP `registerTools` carries parsed `LoreConfig` as a bolted-on optional parameter rather than on `App`, the codebase's established single carrier for cross-cutting dependencies. Pre-existing workarounds ("MCP carries no parsed LoreConfig" hardcoded-default literals at tools.ts staleness/drift call sites) share the same root cause. The review-fix wave (plan-spec-070-review-fix-wave, FixB) shipped the minimal freshness fix: `registerTools(server, app, getConfig?: () => LoreConfig | undefined)` with per-call resolution via `loadProjectConfig()` — closing the long-lived-server config-staleness parity gap (AC-070-15) without touching App's shape.

## Decision (proposed)
Adopt `App.getConfig?: () => LoreConfig | undefined` (a getter FIELD on App, set once in the composition root / `loadLoreApp`) as the target shape, and migrate the three current config side-channels onto it:
1. `registerTools`' third param (SPEC-070 FixB) — becomes a read of `app.getConfig`.
2. tools.ts staleness/drift hardcoded-default literals — resolve from `app.getConfig()` instead.
3. Any future MCP/HTTP tool needing config — reads App, no new params.
A getter (not a snapshot field) preserves the per-call freshness AC-070-15 pinned. CLI paths keep constructing config at process start (their processes are short-lived; the getter simply returns the already-loaded value).

## Consequences
- Kills the "second reference to the same fact" anti-pattern at ~39 registerTools call sites' signature surface without breaking them during migration (field is optional; param can be deprecated then removed).
- One migration pass over tools.ts's existing default-literal sites; each gains real config behavior — needs its own regression pins per site (these literals are currently load-bearing defaults).
- Not executed in the SPEC-070 fix wave deliberately: App-shape changes fan out to every adapter and deserve their own spec/plan with per-site oracles, not a rider on a review-fix.

## Status tracking
Supersedes nothing. Blocks nothing. Next step when picked up: a small tech spec amending app.ts + the three consumer sites, with AC-070-15's test as the freshness regression floor.
