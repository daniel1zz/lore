---
id: PLAN-112
type: plan
role: plan
title: "Implementation — dashboard production packaging (F5a one-command lore dashboard)"
status: archived
priority: medium
created: 2026-07-28
updated: 2026-07-28
tags: [dashboard, packaging, f5a]
parent: SPEC-105
phases:
  - {name: "Phase 1: Build & assets", description: "scripts/build.ts dashboard step (bun run --filter '@lore/dashboard' build so prebuild routeTree gen fires; content-digest short-circuit; generate git-ignored packages/lore/src/generated/dashboard-assets.ts) + committed dashboard-assets-loader.ts with {available:true,manifest}|{available:false,reason} union. Spike bun compile-time file embedding first (H-risk mitigation)."}
  - {name: "Phase 2: HTTP serving & auth", description: "Static-serving module in packages/lore/src/adapters/http/ (DD-4 dispatch order, immutable/no-cache headers, SPA fallback), one-time-nonce endpoint /auth/bootstrap (DD-2: in-memory single-use 60s TTL, Sec-Fetch guards, 410 on replay), allowlist computed from actual ports (DD-3), machine-auth degradation rules (never blanket 500)."}
  - {name: "Phase 3: CLI & delivery", description: "commands/dashboard.ts: packaged mode default (loader-guarded, exit non-zero naming bun run build / --dev when assets unavailable), nonce mint + stdout handshake, browser open at nonce URL, --dev retains vite topology with real-port allowlist threading."}
  - {name: "Phase 4: E2E & docs", description: "playwright.static.config.ts + global-setup-static.ts (throwaway corpus, no-vite assert, freshness digest assert, nonce auth via stdout handshake) + test:e2e:static script + CI wiring note; CLAUDE.md updates (packages/dashboard retire stale out-of-scope claims; http adapter module doc)."}
  - {name: "Phase 5: Verification", description: "Main-orchestrator: lore verify (all 8 script ACs attested), bun run typecheck, full two-runner suite on main after merges, dist/lore size delta recorded, lore assess, spec code anchors declared post-landing."}
---
# Plan: Implementation — dashboard production packaging (F5a one-command lore dashboard)

Governing spec: spec-dashboard-production-packaging-one-command-lore-dashboard (approved, AC-F5A-1..8).

## Overview

Land F5a: dashboard static bundle embedded in dist/lore, served by the HTTP adapter, one-time-nonce auth, `lore dashboard` default flip to packaged mode, single-process e2e harness. Artifact chain: build/loader → static serving+nonce → CLI flip → e2e+docs → verification.

## Governance Mode

unattended (autopilot). Invariant violations hard-block regardless of mode.

## Invariants

1. No `packages/dashboard/src/**` changes (DD-2 keeps the SPA byte-identical) — `git diff --stat` on that path stays empty.
2. `packages/lore/src/generated/dashboard-assets.ts` is git-ignored; the committed loader `dashboard-assets-loader.ts` is the ONLY importer (grep: no other static import of the generated module).
3. Unknown `/api/*` always answers JSON 404 — never index.html (AC-F5A-4).
4. The machine key never appears in any HTTP response body (DD-2) — secret-free oracle (AC-F5A-3).
5. Fresh-clone `bun run typecheck` passes without a dashboard build (AC-F5A-6).
6. All existing test suites stay green (two-runner: test:vitest + test:bun; existing e2e config untouched).
7. Repo `.lore/` corpus never touched by tests — throwaway corpora only (repo standing rule).

## Risk Register

- [H] Bun compile-time embedding of many hashed files via generated `with {type:"file"}` imports is under-documented — Trigger: manifest gen or compiled binary can't resolve embedded paths. Mitigation: T1 spikes the mechanism FIRST against bun official docs (context7) with a minimal two-file proof inside the task before full wiring. Contingency: switch to `Bun.embeddedFiles`-based enumeration or single-archive embed; DD-1 interface (loader union) is mechanism-agnostic by design.
- [M] Static e2e harness port contention with existing two-process suite (both use 8787) — Trigger: phantom failures when both configs run concurrently. Mitigation: reuse assertPortFree + serialize configs in CI (never parallel); static harness uses the same fixed-port discipline.
- [M] `bun run build` tax from vite build degrades the edit-build-test loop (`.bun.test.ts` freshness precheck path) — Mitigation: content-digest short-circuit is part of T1's AC, measured in evidence.
- [L] Headless environments can't open a browser — `--no-open` prints the nonce URL; covered in T3 AC.

## Estimation Summary

Phase 1: 3 (S+M) | Phase 2: 3 (S+L falls to M+M via spike in T1) | Phase 3: 3 (S+M) | Phase 4: 3 (M+S) | Phase 5: 1 (S). Total ≈ 13 S-units. Critical path ≈ 9 S-units (see Critical Path); RED tasks are parallel roots with slack.

## Critical Path

task-skill-implement-f5a-build-step-embed-manifest-and → task-skill-implement-f5a-static-serving-nonce-endpoint-and → task-skill-implement-f5a-lore-dashboard-packaged-mode-default → task-skill-test-f5a-single-process-static-e2e-harness → task-skill-review-f5a-final-verification-and-assessment.

## Exit Criteria

- All 8 spec ACs carry attested pass evidence (`lore verify` on this plan).
- DoD checklist (SKILL.md) met; `lore assess` run; spec code anchors declared post-landing.
- dist/lore size delta recorded in evidence (domain doc D6 observation).

## Phase Descriptions

- Phase 1: Build & assets — scripts/build.ts dashboard step (bun run --filter build, digest short-circuit, manifest gen, .gitignore) + committed loader with availability union.
- Phase 2: HTTP serving & auth — static-serving module (dispatch order DD-4, cache headers), nonce endpoint (DD-2), allowlist threading (DD-3), degradation rules.
- Phase 3: CLI & delivery — `lore dashboard` packaged default + nonce mint + stdout handshake + `--dev` retention + source-run guard.
- Phase 4: E2E & docs — playwright.static config pair + test:e2e:static script; CLAUDE.md updates (dashboard + http adapter).
- Phase 5: Verification — main-orchestrator: lore verify, typecheck, full two-runner suite, size delta, assess.

## Decisions Log

- Strategy: Artifact-chain serial (over Interface-first parallel) — shared http-adapter file anchors nullify parallel-impl gains; RED tasks already provide parallel roots.
- Clarification sprint satisfied by same-session spec design round (3-perspective review + owner grill decisions D4-D8); full-auto authorization on record.
- DD-2 nonce-redirect reversal (security review) inherited from spec — no re-litigation at plan level.

## Decisions Log — closure addenda (2026-07-28)

- **Invariant 6 (all existing suites green) — EXPLICITLY ACCEPTED WITH ATTRIBUTION, not silently waived.** The full two-runner suite on a clean isolated worktree at commit 014a3c3 recorded 6570 passed / 7 failed / 4 skipped. All 7 failures are FOREIGN to this plan: 6 in `packages/lore/tests/unit/assets-ssot.test.ts` and 1 in `packages/lore/tests/unit/adapters/real-setup-ports.test.ts`, every one referencing `skills/lore-to-prd`, broken by a CONCURRENT session's skill rename landed in commit `01a383a`.
  Attribution proof (run verbatim): `git log --oneline 2797126..HEAD -- assets/ packages/lore/tests/unit/assets-ssot.test.ts packages/lore/tests/unit/adapters/real-setup-ports.test.ts` returns ONLY `01a383a docs: standing lesson — full-suite verdicts need a clean tree at a named commit` — not an F5a commit. Additionally both test files were uncommitted-modified in the main checkout by that same session at closure time, i.e. it was actively repairing them. Zero F5a-attributable regressions.
  The verdict was taken on a CLEAN tree at a named commit per the repo standing lesson (a dirty concurrent checkout inflates foreign failures into apparent self-regressions).

- **Two root causes captured as knowledge (per `lore assess` recommendation)**: `knowledge-a-session-row-is-only-as-real-as-the-api-keys-row-it` (packaged sessions minted against a non-existent api_keys owner → every /api read 401s; `sessionStore.create` does not validate its FK precondition) and `knowledge-a-test-that-reads-its-precondition-from-ambient-state` (the source-run guard's verdict was decided by ambient build state).

- **Open follow-up accepted at closure**: AC-F5A-3's dist-grep clause had no dedicated evidenced run (the secret-free case tested a fixture manifest, not the shipped `packages/dashboard/dist`). A dedicated task with a non-vacuous negative control was dispatched at closure; until it lands, "built artifact is secret-free" rests on a fixture, and that limitation is recorded rather than papered over.

- **Residual coverage trade-off (AC-F5A-5)**: forcing the unavailable-assets precondition via a seam means the production availability path is no longer exercised by that case. Recorded as an accepted minor; a separate test driving the real loader against a genuinely absent module would close it.
