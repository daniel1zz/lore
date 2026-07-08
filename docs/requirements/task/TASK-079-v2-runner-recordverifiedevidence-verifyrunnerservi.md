---
id: TASK-079
type: task
role: plan
title: "V2 runner: recordVerifiedEvidence + VerifyRunnerService + spawn split"
status: draft
priority: critical
phase: runner
created: 2026-07-08
updated: 2026-07-08
tags: []
parent: PLAN-019
plan: PLAN-019
links:
  - {id: TASK-078, type: blocks}
  - {id: TASK-076, type: blocks}
---
Objective: service layer of SPEC-039 — the anti-spoofing write path and the runner orchestration. ACs: AC-VRF-2 (service half), AC-VRF-3, AC-VRF-4, AC-VRF-5, AC-VRF-6.
Work:
1. packages/lore/src/service/task-workflow-service.ts — EvidenceInput becomes Omit<EvidenceEntry, "recorded_at" | "attestation"> (& {source?}); addEvidence fail-loud: if the raw candidate object carries an attestation key → err(VALIDATION_ERROR "attestation is runner-issued; use lore verify") — explicit check, NOT silent strip. NEW recordVerifiedEvidence(idOrSlug, entry: Omit<EvidenceEntry,"recorded_at">, nowIso) — the SOLE attestation injection site; same append/version/audit path as addEvidence (share the impl internals, do not duplicate); NOT registered on any CLI/MCP surface.
2. NEW packages/lore/src/service/verify-spawn.ts — PURE (vitest-safe, no Bun API): buildVerifySpawnSpec(criterion, verifyConfig) → {cmd: ["sh","-c",command], cwd: <repo root passed in>, env: "inherit", timeoutMs: criterion.verify.timeout_ms ?? config.default_timeout_ms, killGraceMs: 5000}; deriveVerifyResult(exitCode: number|null, timedOut: boolean) → "pass"|"fail".
3. NEW packages/lore/src/service/verify-executor.ts — bun-only (file header comment like adapters/cli/loader.ts): executes a spawn spec via Bun.spawn with detached new process group; on timeout kill(-pid, SIGTERM) → 5000ms grace → kill(-pid, SIGKILL) (⚠ NEW behavior, no existing precedent — claude-cli-provider only sends SIGTERM; document this in the file header). Captures merged stdout+stderr tail (≤4000 chars), durationMs, exitCode, timedOut. Launch failure (ENOENT etc.) → err, distinguishable from nonzero exit.
4. NEW packages/lore/src/service/verify-runner-service.ts — VerifyRunnerService: constructor-injected THREE deps: getPlanBundle (bound fn), recordVerifiedEvidence (bound fn), executor (fn). verifyPlan(planIdOrSlug, {acIds?, explicitTask?, by, nowIso}): bundle → filter script-mode ACs (respect acIds filter; list skipped ai/human ACs in the result) → resolveTargetTask (core) → per AC: executor → deriveVerifyResult → recordVerifiedEvidence with ac_ref + attestation {runner:"lore-cli", exit_code, duration_ms, timed_out}. Spec status draft → include warning string in result (no hard gate). Launch-failure → err for that AC, no evidence, continue or abort? → abort whole run with err listing completed ACs (fail-loud, no partial ambiguity).
5. packages/lore/src/app.ts — wire VerifyRunnerService (bound fns from corpusService/taskWorkflowService + real executor).
6. Tests: vitest with double executor covers HAPPY/NEG/BOUND/STATE/REGR (runner service + spawn pure fns + addEvidence rejection). EXACTLY 2 real-spawn bun tests in NEW packages/lore/tests/integration/verify-executor.bun.test.ts (mirror tests/integration/ai-timeout.bun.test.ts stub-binary technique): (a) SIGTERM-honoring sleep stub times out fast; (b) trap '' TERM stub survives grace → SIGKILLed (~5s real time, the only slow test). ENOENT real test included in (a) file.
Oracle: bun run typecheck + bunx vitest run (affected) + cd packages/lore && bun test (affected).
Depends: V1 merged. File anchors: packages/lore/src/service/task-workflow-service.ts, verify-spawn.ts (new), verify-executor.ts (new), verify-runner-service.ts (new), app.ts, service/CLAUDE.md, matching tests. ⛔ do not touch adapters/ or ai/.
