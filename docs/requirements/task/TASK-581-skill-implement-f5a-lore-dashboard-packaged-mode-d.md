---
id: TASK-581
type: task
role: plan
title: "[Skill:implement] F5a lore dashboard packaged-mode default flip"
status: archived
priority: critical
phase: "Phase 3: CLI & delivery"
created: 2026-07-28
updated: 2026-07-28
tags: []
parent: PLAN-112
plan: PLAN-112
links:
  - {id: TASK-572, type: blocks}
  - {id: TASK-575, type: blocks}
  - {id: TASK-571, type: blocks}
---
Estimate: M
Approach: commands/dashboard.ts: default branch = packaged mode — loader availability check (unavailable → exit non-zero naming `bun run build` / `--dev`), startHttpServer with static serving enabled + allowlist from actual apiPort, mint nonce via static-serving module's mint API, emit stdout handshake line with nonce URL, open browser at nonce URL unless --no-open. `--dev` flag preserves today's vite-child topology (VITE_LORE_BOOTSTRAP_TOKEN flow untouched) with buildAllowedOrigins fed the REAL --dashboard-port (retires the 5173 hardcode defect). --api-port semantics unchanged.
Source: spec DD-5 + existing commands/dashboard.ts (ensureLocalApiKey, shutdown signals, open logic)
Dimensions: D-FUNC, D-UX
Scope-Alt: browser auto-open niceties (retry/fallback messaging) can be minimal — the printed nonce URL is the contract
Covers: AC-F5A-5

AC:
- Given the paired RED suite, When run after implementation, Then all scenarios GREEN with matched-count > 0.
- Given `--dev`, When launched, Then behavior is byte-compatible with today's two-process flow (existing e2e config still passes untouched).
- Integration: from a built checkout, `dist/lore dashboard --no-open` on a throwaway corpus prints the nonce URL and serves GET / with 200 HTML — the full packaged path is humanly reachable in one command (verified again by Phase 4 e2e, but must be manually smoke-checked here from the worktree binary).
