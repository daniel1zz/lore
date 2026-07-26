---
id: TASK-302
type: task
role: plan
title: "[Skill:implement] Real setup ports (asset-source / fs / mcp-registrar)"
status: archived
priority: high
phase: "cli-adapter"
created: 2026-07-16
updated: 2026-07-16
tags: []
parent: PLAN-033
plan: PLAN-033
links:
  - {id: TASK-301, type: blocks}
---
Estimate: M
Approach: Implement the P1 CONCRETE port impls behind the SetupService interfaces — real fs (node:fs, atomic tmp+rename, backup dir), real AssetSource (reads the repo assets/ tree), real McpRegistrar (shells `claude mcp add/remove`) — PLUS a dedicated vitest exercising all three directly. Mirror adapters/real-fs-probe.ts precedent (shared by CLI + MCP).
Source: SPEC-046 Design (P1 port impls); real-fs-probe.ts precedent.
Dimensions: D-FUNC, D-CODE
Scope-Alt: none.
Covers: AC-046-E (real-port behaviors folded into full regression; the dedicated test below is the direct automated oracle these three impls otherwise lack — they are NOT covered by setup-service.test.ts, which uses FAKE ports)

Files:
- packages/lore/src/adapters/real-asset-source.ts — AssetSource reading assets/ (skills/agents/hooks/governance/project), computing kinds.
- packages/lore/src/adapters/real-setup-fs.ts — SetupFsReader + SetupFsWriter: read/stat + atomic write (tmp+rename), mkdir, backup into <claude-dir>/.lore-backups/<timestamp>/, remove.
- packages/lore/src/adapters/real-mcp-registrar.ts — McpRegistrar shelling `claude mcp add -s user lore -- lore --mcp-server` / `claude mcp remove -s user lore` using the register-mcp args builder; `claude` absent → err naming the manual command.
- packages/lore/tests/unit/adapters/real-setup-ports.test.ts — dedicated direct-behavior vitest (mkdtemp only; NEVER real ~/.claude).

AC:
- Given real-setup-fs.write() over a mkdtemp dir, When it writes a file, Then a tmp path is written then renamed (atomic — assert no leftover tmp file remains AND no partial/zero-byte file is observable mid-write), and the final on-disk bytes equal the requested bytes.
- Given real-mcp-registrar with `claude` NOT on PATH (PATH stubbed to exclude it), When add() runs, Then it returns err naming the exact manual command `claude mcp add -s user lore -- lore --mcp-server` (never silent, never throws).
- Given real-asset-source over the repo `assets/` tree, When load() runs, Then it returns an AssetPayload enumerating every skill/agent/hook/governance/project entry with the correct `kind` (assert the enumerated set matches the P0-vendor declared set).
- Six-dimension shape in the dedicated test: HAPPY/NEGATIVE(claude-absent err)/BOUNDARY(empty subdir)/ERROR(unreadable path surfaced as err, not thrown)/STATE(backup dir created before overwrite)/REGRESSION(no leftover tmp).
- Oracle: `bunx vitest run packages/lore/tests/unit/adapters/real-setup-ports.test.ts` exits 0; also swept by AC-046-E `bun run typecheck && bun run test`.
