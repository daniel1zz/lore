---
id: SPEC-048
type: spec
role: spec
title: "Distribution part 2: npm single-platform publish + TTY postinstall (P2)"
status: approved
priority: medium
created: 2026-07-16
updated: 2026-07-27
tags: []
parent: PRD-001
links:
  - {id: SPEC-046, type: relates-to}
---
# SPEC-048 — Distribution part 2: npm single-platform publish + TTY postinstall (PRD §17 P2)

## Overview/Goal

Ship the `lore` CLI as an installable npm package for the CURRENT build platform only (macOS/Linux, single arch per tarball), carrying the SPEC-046 `lore setup` installer and asset SSOT tree, with a TTY-gated `postinstall` nudge. Distribution starts as a private/allowlist beta (packed-tarball artifact) proving install safety on owner + teammate machines, per PRD §17 positioning; public npm (`beta` dist-tag → `latest`) only after that gate. No cross-compile, no optionalDependencies platform-split, no binary-embedded assets — all P3 (spike-gated).

Evidence base: researcher report 2026-07-16 (Tier S/A: npm docs on lifecycle-script backgrounding, esbuild/biome/turbo package shapes, npm#1808 exec-bit hazard, npm#19548 EBADPLATFORM semantics, npm private-packages pricing) + 4-perspective module design review (coupling/cohesion/reuse/testability).

## Scope

**IN:**
1. `scripts/platform-map.ts` — shared platform-detection SSOT extracted from `scripts/build.ts`'s `resolveLibsqlTarget`: returns a STRUCTURED `{os, cpu, libc?, libsqlTarget}` object (never a fused string). Consumed by `build.ts` (libsql addon resolution — behavior byte-identical, REGRESSION) and by the publish pipeline (`os`/`cpu` package.json fields, package naming).
2. `scripts/publish-npm.ts` — publish pipeline ORCHESTRATOR (repo-side, never shipped): build → stage → verify → publish sequencing. Decision logic lives in extracted pure modules (see Design); npm invocation goes through an injected `Publisher` port. **Bare invocation is dry-run: live publish requires an explicit `--publish` flag.** Flags: `--publish`, `--tag <dist-tag>`, `--registry <url>`, `--pack-only` (emit the beta tarball artifact).
3. `packages/lore/src/distribution/assemble.ts` (pure) — `buildPublishPlan({version, platform, assetFiles, binaryPath}) → PublishPlan` (staging file map + generated package.json object). Target-parameterized from day one (`nameFor(target)`, staging path `dist-npm/<pkg>-<target>/`) — P2 calls it with exactly one target; P3 loops it.
4. `npm-pkg/postinstall.mjs` — the shipped postinstall: dependency-free single file (node builtins only), pure exported `decide({isTTY, env}) → {action, message}` + a `process.argv[1]` execution guard so vitest imports the pure fn. Behavior: nudge-only, NEVER runs `lore setup`, NEVER touches `~/.claude`/settings.json/MCP; try/catch-wrapped, exit 0 ALWAYS. Directory is `npm-pkg/`, deliberately NOT under the SSOT `assets/` tree (assets-ssot conformance oracle must not see it).
5. Generated staged `package.json`: `bin: {lore: "dist/lore"}` pointing DIRECTLY at the native binary (bin-links re-applies +x — sidesteps npm's 0644 exec-bit drop, npm#1808); `os` + `cpu` pinned to the ONE built platform/arch (required-package mismatch → hard EBADPLATFORM — a two-arch guard on a one-arch tarball is a lying guard); `files` allowlist (`dist/lore`, `assets/**`, `postinstall.mjs`, README); version lockstep with the workspace version; placeholder scoped name (final literal = owner decision at first publish).
6. `setup-args.ts` hardening: `realpathSync` the compiled binary path before deriving `assetsRoot` (npm bin link is a symlink — unresolved path derives `node_modules/.bin/../assets`, nonexistent). Module-doc invariant list gains an explicit note of exactly which npm-layout assumption this covers (and that a binary copied AWAY from its package dir remains unsupported until P3 embed).
7. Assets ship as PLAIN FILES in the tarball at `<pkg>/assets/` — shape-compatible with SPEC-046's sibling-assets convention (`dirname(realpath(execPath))/../assets`).
8. Zero-dep conformance test for `postinstall.mjs` (no non-builtin import/require specifiers — mirrors `assets-ssot.test.ts` pattern).

**OUT (P3+, spike-gated):** cross-compile `--target` matrix; optionalDependencies platform-split + thin parent launcher; binary-embedded assets; win32; Homebrew; self-update. OUT (never): interactive postinstall prompts (npm ≥7 backgrounds lifecycle scripts — stdio is piped, isTTY falsy; husky/playwright precedent), silent postinstall wiring of global config (PRD non-goal).

## Design

### Module boundary & dependency graph

```
scripts/publish-npm.ts (orchestrator, thin)
  → scripts/build.ts            (invoke existing build — unchanged contract)
  → scripts/platform-map.ts     (shared SSOT {os,cpu,libc?,libsqlTarget})
  → packages/lore/src/distribution/assemble.ts (pure PublishPlan builder)
  → Publisher port {npmPack, npmPublish}       (injected; real impl = node:child_process,
                                                mirroring RealMcpRegistrar; fake in tests)
npm-pkg/postinstall.mjs (shipped; zero deps; pure decide() + exec guard)
packages/lore/src/adapters/cli/setup-args.ts (realpath fix — existing module, small diff)
```
No cycles. `build.ts` and `assets/` gain no reverse dependency on publish concerns. Generated package.json has ONE writer (the assemble stage). Workspace root package.json stays `private: true` (publishing the workspace root is structurally blocked).

### Pipeline stages (each exit-code-verifiable → script ACs)

(a) `bun run build` (current platform); (b) assemble staging `dist-npm/<pkg>-<target>/` from PublishPlan (binary + assets tree + postinstall + generated manifest; `chmod +x` binary); (c) verify: staged binary `--version` smoke; `lore setup --dry-run --claude-dir <tmpdir>` against staged assets (proves sibling-assets resolution in the npm layout); `npm pack --dry-run` file-list check; `tar -tvf` mode assertion on `dist/lore` (+x preserved); tarball size < 150MB tripwire; (d) `npm publish` — ONLY under `--publish`.

### postinstall contract

`decide({isTTY, env})`: `env.CI` truthy OR `!isTTY` → `{action: "nudge-stderr", message: "<one line: lore installed — run `lore setup` to wire skills/hooks>"}`; TTY+non-CI (rare: `--foreground-scripts`) → same nudge to stdout. No other action exists. Wrapper: try/catch → exit 0 always (a failed nudge must never break `npm install`).

### Beta channel (D2)

`--pack-only` emits the `npm pack` tarball; distribute the artifact file directly (repo ACL/private share) — `npm i <path/URL>.tgz` exercises the IDENTICAL files/exec-bit/postinstall path as a registry install with zero infra. REJECTED alternatives: npm private scope (paid), GitHub Packages (per-teammate PAT `.npmrc` friction), public dist-tag (world-readable — violates allowlist gating), `npm i org/repo#tag` (binary not committed to git; would force build-on-install with a bun prerequisite on every machine).

### Design decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | nudge-only postinstall | npm ≥7 backgrounds scripts (S: docs.npmjs.com); interactivity not viable; PRD "no silent wiring" |
| D2 | beta = packed-tarball artifact | see above |
| D3 | scoped placeholder name; literal fixed at first publish | collision safety; P3 sub-package convention (`@<scope>/cli-<target>`) |
| D4 | os+cpu pinned to built arch only | truthful EBADPLATFORM guard (A: npm#19548) |
| D5 | bin → native binary directly | bin-links +x guarantee beats 0644 hazard (A: npm#1808) |
| D6 | assets = plain tarball files | SPEC-046 sibling-assets convention compatible; embed is P3 |
| D7 | staging `dist-npm/<pkg>-<target>/`, target-param'd | P3 loops targets with zero call-site refactor |
| D8 | realpath(execPath) in setup-args | npm bin symlink breaks sibling derivation on day one; probe = AC |
| D9 | dry-run default, explicit `--publish` | publish is the only irreversible stage; structurally opt-in |

## Acceptance Criteria

Structured ACs (AC-as-code) attached via `lore ac add`; summary:
- AC-048-A (script): `bunx vitest run` unit oracles green — platform-map structured output (+ build.ts REGRESSION parity), `buildPublishPlan` staging map + generated manifest (bin/os/cpu/files assertions), `postinstall decide()` full TTY×CI matrix, publish-pipeline orchestration with fake Publisher (dry-run default: `npmPublish` NEVER called without `--publish`), zero-dep postinstall conformance test.
- AC-048-B (script): `scripts/publish-npm.ts` (bare, dry-run) full pipeline (a)–(c) passes on this machine: staged binary `--version` OK, `lore setup --dry-run --claude-dir <tmp>` resolves STAGED assets, `npm pack --dry-run` file list exact, `tar -tvf` shows `dist/lore` executable, size < 150MB.
- AC-048-C (script): npm-layout install simulation WITHOUT a registry: `npm i <packed .tgz>` into a throwaway prefix → `node_modules/.bin/lore --version` works THROUGH the symlink (realpath fix proven), `lore setup --dry-run --claude-dir <tmp>` finds assets from the installed location, postinstall ran and emitted the one-line nudge (non-TTY branch) with install exit 0.
- AC-048-D (script): typecheck + both test runners green (repo-wide regression).
- AC-048-E (human): owner performs one real beta install from the packed tarball on a teammate-equivalent machine and records the receipt (deferred to owner acceptance — same supervised posture as the SPEC-046 real-machine install).

## Risks

| Risk | Sev | Mitigation |
|---|---|---|
| npm exec-bit drop on the binary | H | bin-target +x re-application (D5) + `tar -tvf` mode oracle in (c) + AC-048-C symlink-path smoke |
| execPath symlink breaks asset resolution | H | D8 realpath + AC-048-C real `npm i` simulation |
| Accidental live publish | M | D9 dry-run default; `--publish` explicit; workspace root `private: true` |
| Tarball size creep | L | <150MB pipeline tripwire (LOW-confidence official ceiling — flagged in research) |
| postinstall breaks `npm install` | M | exit-0-always wrapper + decide() matrix tests |
| Two "assets" dir confusion | L | shipped-pipeline dir named `npm-pkg/`, never under `assets/` SSOT |

## Boundaries

- This spec does NOT modify `SetupService`, `RealAssetSource`, or any SPEC-046 service contract — the only production-code diff is the `setup-args.ts` realpath hardening (+ module-doc invariant note).
- `npm-pkg/` is NOT part of the `assets/` SSOT tree; `assets-ssot.test.ts`'s manifest is unchanged.
- No new lore CLI command, no MCP tool changes, no corpus schema changes.
- Publish credentials/npm auth are the operator's ambient state — never stored in-repo or in-corpus.
- P3 (cross-compile, platform-split, embed) is a SEPARATE spec gated on its feasibility spike; this spec only keeps its seams open (D3/D7 target parameterization).


## Acceptance Criteria (structured)

- [✔] [script] AC-048-A: Unit oracles green: platform-map structured output (+build.ts REGRESSION parity), buildPublishPlan staging map + generated manifest (bin/os/cpu/files), postinstall decide() TTY×CI matrix, publish-pipeline orchestration with fake Publisher (npmPublish NEVER called without --publish), zero-dep postinstall conformance
  script: test — bunx vitest run packages/lore/tests/unit/distribution
- [✔] [script] AC-048-B: Bare (dry-run) publish pipeline stages a-c pass on this machine: staged binary --version OK, lore setup --dry-run resolves STAGED assets, npm pack --dry-run file list exact, tar -tvf shows dist/lore executable, size <150MB
  script: e2e — bun run scripts/publish-npm.ts
- [✔] [script] AC-048-C: npm-layout install simulation without registry: npm i <packed .tgz> into throwaway prefix; node_modules/.bin/lore --version works THROUGH the symlink (realpath fix proven); lore setup --dry-run finds assets from installed location; postinstall emitted one-line nudge (non-TTY), install exit 0
  script: e2e — bunx vitest run packages/lore/tests/integration/npm-install-simulation.test.ts
- [✘] [script] AC-048-D: Repo-wide regression green (typecheck + both test runners)
  script: build — bun run typecheck && bun run test
- [·] [human] AC-048-E: Owner performs one real beta install from the packed tarball on a teammate-equivalent machine and records the receipt
  human: supervised posture, same as SPEC-046 real-machine install; deferred to owner acceptance
