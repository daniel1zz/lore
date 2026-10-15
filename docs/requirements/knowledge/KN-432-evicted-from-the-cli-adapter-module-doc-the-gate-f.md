---
id: KN-432
type: knowledge
role: knowledge
title: "Evicted from the CLI adapter module doc: the gate/feed pre-flight pair and why LORE_GATE_BYPASS is gate-scoped"
status: archived
priority: medium
created: 2026-08-11
updated: 2026-10-10
tags: []
parent: PRD-001
---
# Overview

Evicted verbatim from `packages/lore/src/adapters/cli/CLAUDE.md`'s Key Invariants on
2026-08-11 because that file reached its byte eviction floor (0.97 of 16384) while a
correction about knowledge-target anchors needed room. Per that file's own content
contract, an over-ceiling module doc is fixed by moving a BLOCK here and leaving a
one-line pointer — never by raising the ceiling, never by trading lines for bytes,
never by relocating the fact into another module's doc.

⛔ Nothing here is historical. Every clause below is a LIVE invariant of the CLI
adapter. The pointer left in `adapters/cli/CLAUDE.md` names this document.

# The block, verbatim

**`gate`/`feed` are pre-flight/advisory pairs**: `gate <checkpoint>` runs a candidate
write through the SAME `../../service/checkpoint-registry.js` predicates the service
layer enforces, before the doc exists (`LORE_GATE_BYPASS=1` short-circuits exit 0,
best-effort audits the bypass); `feed <checkpoint>` PULLs the governing rule/context
ahead of writing. Both dispatch via checkpoint-name tables in their command files,
never if/else chains. ⛔ `LORE_GATE_BYPASS=1` is scoped to `gate <checkpoint>` ONLY —
it is NEVER honored by `GateEnforcer.enforce()` (`../../service/gate-enforcer.ts`),
the SAME predicates running inline inside `CorpusService.create`/`set`,
`ReviewService.approve`, `TaskWorkflowService.claim` (CLI writes, MCP, HTTP
dashboard). That scoping is deliberate: a bare env var governs the whole OS process,
so honoring it in the write path too would silently disarm gates for every remote
caller sharing a long-lived `lore serve` process's environment. The one supported
write-path escape is `workflow.gates.<checkpoint>.enabled: false`.

# Why the rationale travelled with the rule

The final two sentences are the load-bearing half, not commentary. Without them a
future reader sees an inconsistency — an env var honored at one surface and ignored at
another — and "fixes" it by making `GateEnforcer` honor it too, which silently
disarms every gate for every caller sharing a `lore serve` process's environment. A
rule whose reason is deleted is a rule that gets simplified away. That is why this
eviction moved the whole block rather than keeping the imperative and dropping the
explanation to save bytes.

# Related

- `packages/lore/src/adapters/cli/CLAUDE.md` — carries the one-line pointer here.
- Earlier evictions from the same file: `knowledge-module-claude-md-snapshot-cli-adapter-pre-eviction`,
  `knowledge-module-claude-md-snapshot-packages-lore-src-adapters`.
