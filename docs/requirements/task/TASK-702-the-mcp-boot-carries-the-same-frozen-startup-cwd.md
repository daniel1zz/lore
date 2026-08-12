---
id: TASK-702
type: task
role: plan
title: "The MCP boot carries the same frozen-startup-cwd provenance the HTTP fix removed, and no oracle can reach it"
status: draft
priority: high
created: 2026-08-12
updated: 2026-08-12
tags: []
parent: PRD-001
---
Disclosed unprompted by the implementer of `task-the-http-exemption-is-conditional-on-where-lore-serve-was` while fixing the HTTP half, and confirmed by direct inspection on merged main.

## The defect

`packages/lore/src/index.ts:20`'s `--mcp-server` branch calls `loadLoreApp()` with no `surface` option, so it takes the fail-closed `"cli"` default and resolves the MCP server's own frozen startup cwd into the AMBIENT `CorpusService` foreign-write context.

MCP's *per-call* `caller_cwd` check is unaffected and remains correct — that is the mechanism §D5's MCP row names, and it is not in question here. The problem is the ambient layer underneath it: an MCP server launched from inside a nested worktree carries a `git_common_dir` provenance for its whole lifetime, so `lore_create` is refused even when the request's `caller_cwd` points at a tree the caller legitimately owns. The per-call signal cannot rescue a write the ambient context already refused.

This is the same shape as the HTTP lockout that task just fixed — one long-lived process, a cwd frozen at boot, and requests that carry their own directory (MCP) or none at all (HTTP). The HTTP fix introduced `loadLoreApp({surface})` and wired all three HTTP mounts; MCP was deliberately left out of that change because removing the ambient layer under MCP is a behaviour change that needs its own acceptance criterion, not a silent widening of an exemption table that names exactly one row.

## Why no existing oracle covers it

Two independent reasons, both structural:

1. `spec-corpus-resolution-carries-provenance-and-a-foreign-write` §D5's matrix gives MCP the row "provenance derived from `caller_cwd` when supplied". It says nothing about the ambient context beneath the per-call one, so no AC cell asserts anything about it.
2. `packages/lore/src/index.ts:11` reaches the loader through `await import("./adapters/cli/loader.js")` inside a function body. `bun run test:changed`'s reverse-dependency walk follows STATIC imports only — this is a documented residual in its module header. So a change to `loader.ts` NEVER selects the MCP boot's consumers, and the worktree oracle is blind to this file by construction, not by oversight.

## What must land

1. Decide, and record in §D5, what the MCP row's AMBIENT provenance should be — distinct from the per-call `caller_cwd` fact the row already names. `null` (matching HTTP, per-call signal governs alone) is the obvious candidate but must be argued, not assumed: unlike HTTP, MCP does have a per-call directory, so the two adapters are not automatically the same case.
2. Wire the decision at `packages/lore/src/index.ts:20` in the SAME change as the capability. An unwired boot surface is a capability with no consumer.
3. An AC asserts it two-sidedly against a nested-worktree fixture: an MCP write whose `caller_cwd` names an owned tree LANDS, and one whose `caller_cwd` names a foreign tree is REFUSED with exit 4 and the `gate:corpus-write:foreign-provenance` token. One direction alone cannot distinguish a live guard from an absent one.
4. Because `test:changed` structurally cannot select this path, the AC's command must name the MCP test file EXPLICITLY rather than relying on change-based selection — and that reasoning belongs in a comment at the call site, phrased so it can be grep-checked.
