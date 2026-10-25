---
id: SPEC-046
type: spec
role: spec
title: "Distribution part 1: asset SSOT + local safe installer (P0+P1)"
status: approved
priority: high
created: 2026-07-16
updated: 2026-10-18
tags: [distribution, installer, p17, setup]
---
**spec_kind:** feature · **implements →** PRD §17 Distribution & Adoption (P0+P1 slice)

## Overview/Goal

Deliver the first two phases of PRD §17: **P0 asset SSOT** (vendor the distributable workflow assets into an in-repo `assets/` tree; author the `<corpus-workflow>` governance snippet as a standalone versioned file) and **P1 local safe installer** (`lore setup` — one command that wires the full Lore-governed workflow into an existing Claude Code install on the current platform, macOS + Linux, idempotent, reversible, manifest-authoritative). NO npm, NO cross-compile, NO win32 (P2/P3, separate specs).

Design provenance: user-approved brainstorm (2026-07-16) → PRD §17 v0.9 (5-stakeholder review applied) → module design (4-perspective review applied: Coupling / Cohesion / Reuse / Testing — 9 revisions absorbed, see Design).

## Scope

**IN:**
- **P0** — `assets/` SSOT tree at repo root: `assets/skills/` (lore, lore-kickoff, lore-session, lore-doctor, lore-autopilot), `assets/agents/` (lore-explorer, lore-planner, lore-implementer, lore-reviewer), `assets/hooks/` (session-start-resume.mjs, stop-doc-sync.mjs, subagent-context.mjs, pre-subagent-gate.mjs, pre-no-general-agent-gate.mjs, lore-gate g1–g4), `assets/governance/corpus-workflow.md` (authored FRESH as a standalone versioned file — the governance snippet extracted clean of the owner's private global CLAUDE.md personal rules), `assets/project/` (project-level g1–g4 hooks, pre-push, lore.tree.yaml template).
- **P1 installer** — new `lore setup` CLI command family: `lore setup` (install), `--dry-run` (plan only, zero writes), `--uninstall` (reverse strictly via manifest), `--project` (repo scaffold), `--claude-dir <path>` (target-dir override), `--yes` (skip confirmation ONLY — pinned semantics; P2 postinstall contract).
- Authoritative manifest `<claude-dir>/.lore-setup-manifest.json`: every written path/entry recorded (`SetupEntry {path, kind: skill|agent|hook|governance|settings-hook|mcp, sha256, written_at}`); `sha256` computed over FINAL ON-DISK BYTES (post-merge), never the raw payload — the invariant future three-way upgrade diffing depends on.
- `settings.json` merge: pure `mergeSettings({loreEntries, existing})` returns the COMPLETE new content or `err` — malformed pre-existing JSON → `err(VALIDATION_ERROR)`, and the whole install run performs ZERO writes (fail loud, no partial write). Atomic write in the fs layer (tmp + rename).
- Global MCP registration via `claude mcp add -s user lore -- lore --mcp-server` (verified surface: user-scope servers persist in `~/.claude.json` `mcpServers`; delegating the file format to the claude CLI). Uninstall via `claude mcp remove -s user lore`. Recorded in the manifest as kind `mcp` (this is why the `mcp` kind stays in P1 — uninstall consumes it). `claude` binary absent → loud error naming the manual command, install of file assets still completes (MCP step reported as skipped in the receipt, exit ≠ 0).
- Backup-before-overwrite into `<claude-dir>/.lore-backups/<timestamp>/`; `--uninstall` restores backed-up files byte-identically (restore-from-backup is THE uninstall mechanism for merge-target files).
- Post-run receipt (rendered in `adapters/cli/setup-render.ts`): binary found, N skills/agents/hooks written/skipped, MCP registered ✓/skipped, manifest path, backup path.
- `lore setup --project`: `lore init` (existing service path) + `assets/project/` hooks + pre-push + `lore.tree.yaml` + `git config core.hooksPath hooks` — via `ProjectSetupService` + `flows/setup-project-flow.ts`.

**OUT (later specs):** P2 npm publish + TTY postinstall trigger; P3 cross-compile + binary-embedded assets (spike-gated); win32; upgrade-conflict resolution UI (manifest schema is future-proofed, logic deferred); redistribution of any skill we don't own (tdd/to-prd/brainstorming = external deps, documented only).

## Design

Module structure (4-perspective review synthesis, all revisions absorbed):

- **`@lore/core` (pure, browser-safe):** `setup-manifest.ts` — `setupManifestSchema`/`setupEntrySchema` (Zod), `planInstall(currentManifest, payload, existingFiles) → InstallPlan {writes, skips, backups, removals}`; `merge-settings.ts` — `mergeSettings({existing, loreEntries}) → Result<object>` (NARROW input — never the manifest object); `register-mcp.ts` — MCP args builder (pure). Six-dimension vitest.
- **`service/setup-service.ts`** — `SetupService` (stateless, `Result<T, LoreError>`): `planInstall()` / `install()` / `uninstall()`. Constructor ports: `AssetSource {load(): Promise<Result<AssetPayload>>}` (P1 impl reads `assets/` dir; P3 swaps to binary-embed WITHOUT touching SetupService), `SetupFsReader {read, stat}` + `SetupFsWriter {write, mkdir, backup, remove}` (SPLIT ports — `planInstall()` receives reader ONLY, structurally cannot write), `McpRegistrar {add, remove}` (P1 impl shells `claude mcp`). `targetDir` is a RESOLVED string parameter — resolution (`--claude-dir` > `$CLAUDE_CONFIG_DIR` > `homedir()`) lives in the CLI adapter; the service contains zero `homedir()`/env reads.
- **`service/project-setup-service.ts`** — `ProjectSetupService` (repo-target scaffold), consuming `flows/setup-project-flow.ts`. SEPARATE service (global-machine vs repo target-type split, mirroring the anchor-command DriftCheck/TaskWorkflow precedent). `commands/setup.ts` and `commands/init.ts` never import each other.
- **`adapters/cli/commands/setup.ts`** (thin citty adapter: flag parsing, target-dir resolution, service calls) + **`adapters/cli/setup-render.ts`** (receipt rendering, vitest-testable — assess-render.ts precedent).
- Verb naming: `planInstall/install/uninstall` — avoids collision with lore `plan` docs.
- Invariants (each carries a dedicated test): (I1) malformed existing `settings.json` → zero write calls across the entire run; (I2) re-run idempotency — byte-identical target state → all entries reported `skipped`, zero writes; (I3) uninstall restores user-owned content byte-identically via backup; (I4) `--dry-run` fires zero writer-port calls; (I5) `sha256` = final on-disk bytes.
- Test strategy: fake `SetupFs` for fault-injection (write #2 of 3 throws → file 1 committed, file 3 never attempted, receipt honestly reports partial, re-run converges); real `mkdtemp` fs for the plan→install→uninstall lifecycle roundtrip; vitest throughout (zero store/`bun:sqlite` involvement); test constructor guard refuses a `targetDir` inside the real `~/.claude` or the repo's own `.lore/` (2026-07-07 pollution-incident rule).

## Acceptance Criteria

Deterministic oracles (structured ACs added via `lore ac add`, script-mode, executable by `lore verify`):

- AC-046-A [script/test] Pure-fn suite green (manifest schema, planInstall, mergeSettings incl. malformed→err, register-mcp args): `bunx vitest run packages/lore/tests/unit/core/setup-pure.test.ts`
- AC-046-B [script/test] SetupService lifecycle green (fake-fs fault injection + mkdtemp roundtrip, invariants I1–I5): `bunx vitest run packages/lore/tests/unit/service/setup-service.test.ts`
- AC-046-C [script/test] ProjectSetupService scaffold green (init + hooks + tree.yaml + hooksPath in a throwaway git repo): `bunx vitest run packages/lore/tests/unit/service/project-setup-service.test.ts`
- AC-046-D [script/test] Asset SSOT conformance green (assets/ tree contains every declared skill/agent/hook/governance file; governance snippet parses standalone): `bunx vitest run packages/lore/tests/unit/assets-ssot.test.ts`
- AC-046-E [script/build] Full regression stays green: `bun run typecheck && bun run test`
- AC-046-F [human] Sandbox smoke on the owner's machine: `lore setup --claude-dir $(mktemp -d)` → receipt correct → re-run reports all-skipped → `--uninstall` → target dir returns to pre-install state (manifest absent, backups restored).

## Risks

| Id | Sev | Risk | Mitigation |
|---|---|---|---|
| R1 | H | settings.json merge bug corrupts a live Claude Code config | I1 zero-write-on-error invariant + atomic tmp+rename + backup-before-overwrite + PRD hard-gate metric (zero corruption incidents) |
| R2 | M | governance snippet extraction drags private rules into the distributable | P0 authors it FRESH; AC-046-D asserts standalone parse; review pass before approve |
| R3 | M | `claude mcp` CLI surface changes shape | registration delegated to the CLI (not file writes); failure is loud + receipt-visible; manual command named in error |
| R4 | L | assets/ SSOT drifts from the owner's live ~/.claude copies | post-install the SSOT is authoritative — owner re-runs `lore setup` like everyone else (dogfooding) |

## Boundaries

Thin glue over existing conventions: services return `Result`, ports injected (FsProbe/GateEnforcer precedent), flows for cross-command reuse, render split for vitest. No new storage tables, no store involvement at all, no daemon. The ONLY new top-level repo artifact is `assets/`.


## Acceptance Criteria (structured)

- [⚑] [script] AC-046-A: Pure-fn suite green: setup-manifest schema, planInstall, mergeSettings (malformed existing JSON returns err), register-mcp args builder — six-dimension coverage
  script: test — bunx vitest run packages/lore/tests/unit/core/setup-pure.test.ts
- [⚑] [script] AC-046-B: SetupService lifecycle green: fake-fs fault injection (partial-write honesty, re-run convergence) + mkdtemp roundtrip; invariants I1-I5 each have a dedicated test
  script: test — bun run test:file packages/lore/tests/unit/service/setup-service.test.ts
  other_command=2
- [⚑] [script] AC-046-C: ProjectSetupService scaffold green: init + g1-g4 hooks + pre-push + lore.tree.yaml + core.hooksPath in a throwaway git repo
  script: test — bunx vitest run packages/lore/tests/unit/service/project-setup-service.test.ts
- [⚑] [script] AC-046-D: Asset SSOT conformance: assets/ tree contains every declared skill/agent/hook/governance/project file; governance snippet parses standalone
  script: test — bunx vitest run packages/lore/tests/unit/assets-ssot.test.ts
- [⊘] [script] AC-046-E: Full regression stays green (typecheck + both test runners)
  script: build — bun run typecheck && bun run test
- [·] [human] AC-046-F: Sandbox smoke on owner machine: lore setup --claude-dir $(mktemp -d) → receipt correct → re-run all-skipped → --uninstall returns dir to pre-install state
  human: Never run against the real ~/.claude; mktemp sandbox only
- [·] [script] AC-046-SG1: lore setup --dry-run --json output contains exactly 1 hook-file write entry with path ending 'subagent-stop-commit-guard.mjs' AND exactly 1 SubagentStop settings.json hook-command entry containing 'subagent-stop-commit-guard.mjs'
  script: other — bun run dev -- setup --dry-run --json --claude-dir /tmp/fake-claude-dir-sg
  other_command=1
- [○] [script] AC-046-SG2: bunx vitest run packages/lore/tests/unit/assets-ssot.test.ts packages/lore/tests/unit/adapters/real-setup-ports.test.ts reports 'Test Files 2 passed (2)' with 0 failures after subagent-stop-commit-guard.mjs is added to both manifests
  script: test — bunx vitest run packages/lore/tests/unit/assets-ssot.test.ts packages/lore/tests/unit/adapters/real-setup-ports.test.ts
- [·] [script] AC-046-SG3: sha256 of assets/hooks/subagent-stop-commit-guard.mjs equals sha256 of ~/.claude/hooks/subagent-stop-commit-guard.mjs, 0 byte diff
  script: other — cmp assets/hooks/subagent-stop-commit-guard.mjs ~/.claude/hooks/subagent-stop-commit-guard.mjs && echo 'AC-046-SG3 PASS: installed subagent-stop-commit-guard.mjs is byte-identical to the asset'
  other_command=1

## Code anchors

- packages/core/src/setup-manifest.ts
- packages/core/src/merge-settings.ts
- packages/core/src/register-mcp.ts
- packages/lore/src/service/setup-service.ts
- packages/lore/src/service/project-setup-service.ts
- packages/lore/src/flows/setup-project-flow.ts
- packages/lore/src/adapters/cli/commands/setup.ts
- packages/lore/src/adapters/real-asset-source.ts
- assets/
