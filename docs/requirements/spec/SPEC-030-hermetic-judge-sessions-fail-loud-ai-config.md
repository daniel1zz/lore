---
id: SPEC-030
type: spec
role: spec
title: "Hermetic judge sessions + fail-loud AI config"
status: deprecated
priority: high
created: 2026-07-03
updated: 2026-10-10
tags: [assess, reliability, spec-030]
---
# SPEC-030 — Hermetic Judge Sessions + Fail-Loud AI Config

> Origin: round-3 self-hosted loop findings (knowledge doc 01KWKC1T1SWXPJQMBQ8XG66116, 2026-07-03). All three defects reproduced live.

## 1. Problem

1. **Judge session contamination.** `ClaudeCliProvider` spawns `claude -p` via `Bun.spawn` with inherited cwd and env. The judge session therefore loads the host machine's Claude Code configuration — project CLAUDE.md, global hooks. A host Stop-hook that forces marker-formatted final messages REPLACED the judge's JSON (`claude -p` returns only the last assistant message), failing `lore assess` nondeterministically (observed 4 clean runs, then 3 polluted, same materials). The evaluation loop's stability currently depends on the host's personal hook configuration — unacceptable for a team tool.
2. **Silent AI-config fallback.** One unknown key under `ai:` (strict Zod) fails the whole `ai` block parse and lore silently reverts to ALL defaults — observed live: `max_diff_chars` 80000→24000 and `timeout_ms` 180000→60000 with zero warning. Directly contradicts the project's fail-loud principle (D-007 precedent).
3. **Timeout knob discoverability.** The provider-timeout error says only "process killed after 60000ms". The correct knob is `ai.providers.<name>.timeout_ms`, and a provider entry REPLACES the built-in (command/args must be restated) — none of which the error mentions; a wrong guess at the shape triggers defect 2.

## 2. Acceptance Criteria

- **AC-HJ-1 (hermetic spawn)** `ClaudeCliProvider` spawns the judge hermetically: neutral cwd (OS tmpdir) and a sanitized env that strips Claude-Code session/hook variables (`CLAUDECODE`, `CLAUDE_*`) while preserving what the CLI needs to run and authenticate (`PATH`, `HOME`, `TERM`, locale vars). If `claude --help` (probe on the implementing machine) exposes official isolation flags (e.g. `--setting-sources`), prefer the official mechanism and document the choice in code comments. Unit-testable: spawn parameters (cwd/env/args) are built by a pure exported function with tests; the Bun.spawn callsite consumes it.
- **AC-HJ-2 (no behavior change for output handling)** stdin piping, timeout kill, stdout/stderr collection, and error taxonomy are unchanged.
- **AC-HJ-3 (fail-loud ai config)** A config file whose `ai` block fails schema validation causes config loading to return a loud error naming the offending key path (e.g. `ai.cli: unrecognized key — did you mean ai.providers.<name>?`) instead of silently using defaults. A config with NO `ai` block remains valid (defaults apply). Behavior for other blocks unchanged.
- **AC-HJ-4 (timeout error guidance)** The provider-timeout error message names the configured timeout value and points at `ai.providers.<name>.timeout_ms`, including the entry-REPLACES-built-in semantics (restate `command`/`args`). Test pins the message.
- **AC-HJ-5 (six-dimension tests)** New/changed logic (env-sanitizer pure function, config fail-loud path) carries HAPPY/NEGATIVE/BOUNDARY/ERROR/STATE/REGRESSION coverage with explicitly labeled dimensions (round-3 judge feedback: never-throws cases must be labeled ERROR, not folded into NEGATIVE).
- **AC-HJ-6 (root-cure verification)** After rebuild, `lore assess` on this plan succeeds WITHOUT any workaround env vars (`CLAUDE_STATE_BASE_OVERRIDE` / `CLAUDE_PROMPT_FILE_OVERRIDE` unset) on the machine where contamination was reproduced — the closeout records this run as evidence.
- **AC-HJ-7 (rendered-clip assertion, R3 housekeeping)** One end-to-end assertion verifies the persisted assessment doc's rendered content includes the clipped-reasoning line when clipping occurred (closes the round-3 judge's remaining AC-AR-3 rendering gap).

## 3. Non-goals

- Switching the default judge to the HTTP provider (remains a config choice).
- Sandboxing beyond env/cwd (no containers, no seccomp).
- Config fail-loud for non-`ai` blocks (separate sweep if wanted later).

## 4. Constraints

- `claude-cli-provider.ts` is bun-only (Bun.spawn) — its tests run under `bun test`; the pure spawn-spec builder must be vitest-testable if placed in a shared module.
- `@lore/core` stays browser-safe; config loading lives in `@lore/core/node`.
- Fail-loud error must use the existing LoreError taxonomy (no new error codes unless justified).


## Code anchors

- packages/lore/src/ai/hermetic-spawn.ts
