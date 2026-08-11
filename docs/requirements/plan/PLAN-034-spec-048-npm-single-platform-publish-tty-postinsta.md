---
id: PLAN-034
type: plan
role: plan
title: "SPEC-048 npm single-platform publish + TTY postinstall"
status: archived
priority: medium
created: 2026-07-17
updated: 2026-07-26
tags: []
parent: SPEC-048
phases:
  - {name: "Phase 1: Core modules", description: "Pure/foundational modules with disjoint anchors: platform-map SSOT extraction (+build.ts parity), buildPublishPlan assembler, zero-dep postinstall, setup-args realpath hardening. Each task owns its source + its tests/unit/distribution suite. Parallel except assemble (blocked by platform-map for the PlatformInfo type SSOT)."}
  - {name: "Phase 2: Publish pipeline + install simulation", description: "Dry-run-default publish orchestrator (scripts/publish-npm.ts) with injected Publisher port (real=node:child_process, fake in tests), staging via buildPublishPlan, verify stages a-c; then registry-free npm i <.tgz> integration simulation proving symlink --version + staged-asset resolution + postinstall nudge."}
  - {name: "Phase 3: Regression & verification", description: "Repo-wide typecheck + both test runners green; attested lore verify runs of every script AC; final DoD gate before completion."}
links:
  - {id: SPEC-048, type: implements}
---
── 01KXPZYT… SPEC-048 npm single-platform publish + TTY postinstall ────────────────────────────────────────
Type: plan | Status: approved | Priority: medium | v3
Created: 2026-07-17 by system | Updated: 2026-07-17

# Plan — SPEC-048 npm single-platform publish + TTY postinstall

## Overview
Decomposes SPEC-048 (Distribution part 2) into an executable task tree: extract the
platform-detection SSOT, build the pure `buildPublishPlan` assembler, ship a zero-dep
TTY-gated `postinstall.mjs`, harden `setup-args` for the npm symlink layout, then wire
the dry-run-default publish orchestrator and prove the whole path with a registry-free
`npm i <.tgz>` simulation. Every task is bound to a script/build oracle; the only
production-code diff outside new files is the `setup-args.ts` realpath hardening.

Parent spec: spec-spec-048-distribution-part-2-npm-single-platform-publish-tt (approved v7, 5 ACs).

## Governance Mode
attended — phase gates require confirmation from the orchestrator/owner. Invariant
violations hard-block regardless of mode.

## Invariants (verified at every Phase Gate)
- INV-1 (dry-run default): `scripts/publish-npm.ts` NEVER calls the Publisher's publish path
  without an explicit `--publish` flag. Oracle: unit test asserts `npmPublish` fake is never
  invoked on a bare/`--pack-only`/`--tag`-only run.
- INV-2 (platform SSOT): platform detection exists in exactly ONE place
  (`scripts/platform-map.ts`); `scripts/build.ts` consumes it and its libsql-target
  resolution stays byte-identical. Oracle: build.ts REGRESSION parity test over all 5
  supported platform/arch pairs + the unsupported-throw case.
- INV-3 (generated package.json has one writer): the staged `package.json` is produced only
  by `buildPublishPlan` in `assemble.ts`; `bin: {lore:"dist/lore"}`, `os`/`cpu` pinned to the
  ONE built target, `files` allowlist, version lockstep. Oracle: assemble unit test.
- INV-4 (postinstall is inert): `postinstall.mjs` imports node builtins ONLY, never runs
  `lore setup`, never touches `~/.claude`/settings.json/MCP, and exits 0 ALWAYS. Oracle:
  zero-dep conformance test (no non-builtin specifiers) + decide() TTY×CI matrix test.
- INV-5 (npm-pkg is NOT under assets/ SSOT): `npm-pkg/` never appears in the
  `assets-ssot.test.ts` manifest; the assets conformance suite stays green unchanged.
- INV-6 (no SPEC-046 contract change): `SetupService`, `RealAssetSource`, `McpRegistrar` and
  the assets manifest are untouched; the sole production diff is `setup-args.ts` realpath +
  its module-doc invariant note. Oracle: AC-048-D repo-wide regression.
  AMENDED 2026-07-17 (accepted second production diff, assessment recommendation): the AC-048-D
  regression gate exposed a latent whole-CLI stdout truncation defect (Bun 1.3.10 fd1 O_NONBLOCK
  on `process.stdout` instantiation — see knowledge-bun-1-3-10-process-stdout-instantiation-sets-fd1-o-non);
  its fix added `adapters/cli/stdio-sync.ts` + a minimal `src/index.ts` CLI-branch wiring
  (tracked task: task-skill-implement-cli-stdout-non-blocking-truncation-fix-writ). SPEC-046
  service contracts remain untouched; the invariant's intent (no SetupService/asset-contract drift) holds.
- INV-7 (workspace root stays private): root `package.json` keeps `private: true`. Oracle:
  explicit assertion in T7's AC that root `package.json`.`private === true` (a publish-focused
  work stream must never flip it) — same rigor as INV-1..INV-6, not Phase-Gate eyeballing.

## Risk Register (inherited from spec, mapped to mitigation tasks)
| ID | Risk | Sev | Mitigation task |
|----|------|-----|-----------------|
| R1 | npm 0644 exec-bit drop on the shipped binary | H | T5 (`tar -tvf` mode oracle in stage c) + T6 (symlink-path `--version` smoke) |
| R2 | execPath symlink breaks asset resolution | H | T4 (realpath hardening) + T6 (real `npm i` simulation) |
| R3 | accidental live publish | M | T5 (dry-run default, INV-1; `--publish` explicit) |
| R4 | tarball size creep | L | T5 (<150MB tripwire in stage c) |
| R5 | postinstall breaks `npm install` | M | T3 (exit-0-always wrapper + decide() matrix) |
| R6 | two "assets" dir confusion | L | T3 anchors `npm-pkg/` (INV-5) |
All H-impact risks (R1,R2) have mitigation tasks in the tree.

## Critical Path
T1 → T2 → T5 → T6 → T7  (platform SSOT → assembler → orchestrator → install-sim → regression)
Duration ≈ 9 session-units. T3 and T4 are slack (parallel with T1 in Phase 1).
Critical path > 6 units is intrinsic to a serial build→stage→pack→install→verify pipeline;
flagged, not splittable without fabricating false parallelism.

## Estimation Summary
Phase 1: T1(S=1)+T2(M=2)+T3(S=1)+T4(S=1) = 5
Phase 2: T5(L=3)+T6(M=2) = 5
Phase 3: T7(S=1) = 1
Total ≈ 11 session-units | Critical path ≈ 9.

## Exit Criteria
- All 7 tasks archived with pass evidence.
- AC-048-A/B/C/D carry attested evidence (`lore verify` for script ACs; exit code decides).
- AC-048-E (human owner beta install) deferred to owner — NOT an agent task; tracked as open.
- `lore assess <plan>` reviewed; gaps fixed or accepted.
- Spec code anchors declared AFTER code lands (platform-map, assemble, publish-npm,
  postinstall, setup-args) — `lore status --check-drift` exit 0.

## Decisions Log
- Strategy: Dependency-Ordered + Interface-First (spec pre-defines the module boundary graph
  and 9 design decisions D1–D9; decomposition follows that graph 1:1).
- TDD handling: these deliverables are pure functions whose six-dimension unit suites ARE the
  AC-048-A oracle. Rather than split a separate cross-worktree RED test task per module
  (which would force test↔impl serialization + merge churn across worktrees for zero added
  safety, since the unit suite is the AC regardless of authoring order), each core-module
  task OWNS both its source file AND its dedicated `tests/unit/distribution/*.test.ts` suite
  in one worktree; the task AC mandates the suite exist and be GREEN (six dimensions). This
  matches the repo's established implementer-writes-tests-in-worktree convention.
- Serialization edges are justified by concrete artifacts only (see each task's Blocks).


── Navigation ──────────────────────────────────────────────────
Parent:   01KXNSWQ… SPEC-048 — Distribution part 2: npm single-platform publish + TTY postinstall (P2)
Siblings: (none)
Children: 01KXQ6GB… Assessment: SPEC-048 npm single-platform publish + TTY postinstall (2026-07-17), 01KXQ6KZ… Assessment: SPEC-048 npm single-platform publish + TTY postinstall (2026-07-17), 01KXQ02K… [Skill:verify] repo-wide regression gate (typecheck + both runners), 01KXQ51B… [Skill:implement] CLI stdout non-blocking truncation fix (writeSync drain chokepoint), 01KXQ02K… [Skill:test] registry-free npm i install simulation
Related:  01KXNSWQ… SPEC-048 — Distribution part 2: npm single-platform publish + TTY postinstall (P2) (implements), 01KXQ6GB… Assessment: SPEC-048 npm single-platform publish + TTY postinstall (2026-07-17) (informs), 01KXQ6KZ… Assessment: SPEC-048 npm single-platform publish + TTY postinstall (2026-07-17) (informs)
