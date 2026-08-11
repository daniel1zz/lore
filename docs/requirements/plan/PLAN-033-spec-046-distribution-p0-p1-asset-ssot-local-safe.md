---
id: PLAN-033
type: plan
role: plan
title: "SPEC-046 Distribution P0+P1 — asset SSOT + local safe installer"
status: archived
priority: high
created: 2026-07-16
updated: 2026-07-26
tags: [distribution, installer, p17, setup]
parent: SPEC-046
phases:
  - {name: "P0-assets", description: "Vendor the assets/ SSOT tree (skills/agents/hooks/project) + author the standalone corpus-workflow.md governance snippet FRESH + assets-ssot conformance test (AC-046-D). Independent of the code branch (D3)."}
  - {name: "core-pure", description: "@lore/core pure browser-safe setup modules: setup-manifest.ts (schema + planInstall), merge-settings.ts (narrow input), register-mcp.ts (args builder), barrel export; one six-dimension vitest (AC-046-A)."}
  - {name: "services", description: "service/setup-service.ts (SetupService: planInstall/install/uninstall; split reader/writer ports, AssetSource, McpRegistrar; resolved targetDir param) + service/project-setup-service.ts + flows/setup-project-flow.ts. AC-046-B, AC-046-C. Blocked by core-pure."}
  - {name: "cli-adapter", description: "Real port impls (asset-source/fs/mcp-registrar) + adapters/cli/setup-render.ts receipt + adapters/cli/commands/setup.ts (flags + targetDir resolution + wiring in app.ts/loader) + full regression AC-046-E."}
  - {name: "verification", description: "Owner sandbox smoke AC-046-F (human oracle) — install into mktemp claude-dir, verify receipt, re-run all-skipped, uninstall restores. Left UNCLAIMED for the owner; never run against real ~/.claude."}
links:
  - {id: SPEC-046, type: implements}
---
## Overview

Executable decomposition of SPEC-046 (Distribution part 1: asset SSOT + local safe installer, P0+P1). Delivers (P0) an in-repo `assets/` SSOT tree + a freshly-authored standalone governance snippet, and (P1) the `lore setup` CLI command family — idempotent, reversible, manifest-authoritative install of the Lore-governed workflow into an existing Claude Code install (macOS + Linux). No npm, no cross-compile, no win32.

Parent spec: spec-spec-046-distribution-part-1-asset-ssot-local-safe-installe (approved, 6 structured ACs AC-046-A…F).

## Invariants (each carries a dedicated test in AC-046-B)

- I1 — Malformed pre-existing `settings.json` → `mergeSettings` returns `err(VALIDATION_ERROR)` AND the whole install run performs ZERO writer-port calls (fail loud, no partial write).
- I2 — Re-run idempotency: byte-identical target state → every entry reported `skipped`, zero writes.
- I3 — `--uninstall` restores user-owned merge-target content byte-identically from `<claude-dir>/.lore-backups/<timestamp>/`.
- I4 — `--dry-run` fires zero writer-port calls.
- I5 — `SetupEntry.sha256` is computed over FINAL ON-DISK BYTES (post-merge), never the raw payload.
- I6 (test-safety) — Test constructor guard refuses a `targetDir` inside the real `~/.claude` or the repo's own `.lore/` (2026-07-07 pollution-incident rule); all fs tests use `mkdtemp`.

## Architecture constraints (from spec Design, all binding)

- `@lore/core` setup modules are PURE + browser-safe (Zod only, NO node builtins) — belong in the default barrel.
- Services return `Promise<Result<T, LoreError>>`; ports constructor-injected (FsProbe/GateEnforcer precedent).
- SPLIT fs ports: `planInstall()` receives `SetupFsReader` ONLY (structurally cannot write); `install()`/`uninstall()` get `SetupFsWriter`.
- `targetDir` is a RESOLVED string param — resolution (`--claude-dir` > `$CLAUDE_CONFIG_DIR` > `homedir()`) lives in the CLI adapter; services contain zero `homedir()`/env reads.
- `commands/setup.ts` and `commands/init.ts` never import each other. Global-machine vs repo-target split → two services (`SetupService` / `ProjectSetupService`), mirroring DriftCheck/TaskWorkflow anchor-command precedent.
- MCP registration delegated to `claude mcp add/remove -s user lore -- lore --mcp-server` (verified surface); `claude` absent → loud error naming manual command, file-asset install still completes, exit ≠ 0.
- Atomic fs write (tmp + rename); backup-before-overwrite; restore-from-backup IS the uninstall mechanism for merge-target files.
- Governance snippet authored FRESH as a standalone file — NEVER copied from the owner's private global CLAUDE.md (R2).
- Test framework: vitest throughout (zero store / `bun:sqlite` involvement; no `.bun.test.ts`).

## Risk Register (inherited from spec R1–R4)

| Id | Sev | Risk | Mitigation task |
|---|---|---|---|
| R1 | H | settings.json merge bug corrupts a live Claude Code config | I1 zero-write-on-error + atomic tmp+rename + backup — enforced by SetupService task (AC-046-B, I1 dedicated test) + core mergeSettings task (AC-046-A malformed→err) |
| R2 | M | governance extraction drags private rules into the distributable | governance-authoring task authors FRESH; conformance test asserts standalone parse + negative-grep for private markers (AC-046-D) |
| R3 | M | `claude mcp` CLI surface changes shape | registration delegated to CLI (not file writes); failure loud + receipt-visible; real-mcp-registrar task + command task surface manual command on error |
| R4 | L | assets/ SSOT drifts from owner's live ~/.claude | post-install SSOT is authoritative — owner re-runs `lore setup` (dogfooding); out of plan scope |

## Critical Path

core-pure → SetupService → real-ports → setup command+wiring → owner smoke.
~10 session-units of inherent dependency depth (types → service → ports → wiring → integration smoke). P0-assets, ProjectSetupService, and setup-render are parallel slack branches. (Updated with slugs after task creation.)

## Exit Criteria

- AC-046-A..E all script-oracle GREEN (`lore verify` attested).
- AC-046-F owner sandbox smoke passes (install → receipt → re-run all-skipped → uninstall restores).
- Full regression (`bun run typecheck && bun run test`) GREEN.
- `assets/` is the only new top-level repo artifact.

## Governance Mode

attended — phase gates require confirmation; invariant violations hard-block regardless.

## Decisions Log

- D1 — core-pure kept as ONE task (3 pure modules + one six-dimension test file). AC-046-A binds a SINGLE test file (`setup-pure.test.ts`) as its oracle → a single anchor owner; splitting would force shared-test-file cross-task contention for no parallelism gain. Deviation from strict TDD-injection justified: pure modules, internal (no user-facing Integration AC), one AC = one test file.
- D2 — Each service (SetupService, ProjectSetupService) bundles impl + its dedicated test file in one task. Same rationale: the AC oracle is a single test file per service; invariant tests (I1–I5) are tightly coupled to the impl; internal services are Integration-AC-exempt.
- D3 — P0-assets is INDEPENDENT of core-pure/services (planInstall takes payload + existingFiles as params, never reads `assets/`; services use the AssetSource PORT + fake fs). → P0 vendoring and the code branch run fully in parallel. Only the final full-regression task (AC-046-E runs assets-ssot.test.ts) and owner smoke consume the real `assets/` tree.
- D4 — The `lore setup` command is the user entry point; its integration proof is a dry-run reachability AC in the command task PLUS the owner smoke (AC-046-F) — not a mere "command registered" assertion.
