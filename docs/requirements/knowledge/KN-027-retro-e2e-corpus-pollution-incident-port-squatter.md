---
id: KN-027
type: knowledge
role: knowledge
title: "Retro — e2e corpus-pollution incident (port-squatter absorbed write suite)"
status: approved
priority: medium
created: 2026-07-07
updated: 2026-07-07
tags: [retro, e2e, test-isolation, spec-036]
parent: PRD-001
links:
  - {id: SPEC-036, type: relates-to}
---
# Retro — e2e corpus-pollution incident (2026-07-07)

## What happened
During SPEC-036 implementation, 6 foreign docs landed in the team corpus and the export-index allocated them human_ids (one stole `SPEC-036` from the real spec, pushing it to `SPEC-037`):

1. **Backend task**: the implementer's manual smoke test (`prd-smoke-prd`, `plan-smoke-plan`) ran corpus-writing CLI/HTTP calls that resolved to the REAL repo corpus instead of a throwaway.
2. **Frontend task**: a stale `lore dashboard` process (serving the real corpus) was squatting port 8787. Playwright's global-setup spawned its own throwaway-corpus server, whose child died on port-in-use — but the readiness probe was answered by the squatter, so the e2e suite wrote its fixtures (`*-e2e-breadcrumb-*` prd/spec/plan/task chain) straight into the team corpus.

## Cleanup (same day)
- 6 docs soft-deleted (recoverable until 2026-08-06); export mappings + exported files removed; real spec remapped SPEC-037→SPEC-036. Oracle: export-docs dry-run 139/139 clean.

## Prevention (landed)
- `global-setup.ts`: fail-loud port guard (8787/5173 occupied → abort before any spawn) + post-spawn server-identity check (verify the responder is OUR throwaway server, never a survivor squatter).
- Repo CLAUDE.md: hard rule — tests/smoke checks must NEVER write to the repo's own `.lore/`; throwaway corpus (`mkdtemp` + `lore init`) is mandatory.

## Transferable lessons
- A readiness probe that only checks "port answers" cannot distinguish YOUR server from a foreign one — identity must be part of readiness when ports are fixed.
- Fixed ports + shared dev machines = collision by design; if ports can't be parameterized (vite proxy + auth Origin allowlist pin them), the guard must move to fail-loud detection.
- Human-id allocation downstream of corpus writes means test pollution corrupts NUMBERING, not just content — blast radius is bigger than the polluted rows themselves.
