---
id: TASK-511
type: task
role: plan
title: "T6 wire the Stop hook into settings.json auto-registration + declare the asset in every roster"
status: archived
priority: medium
phase: "ship"
created: 2026-07-31
updated: 2026-07-31
tags: []
parent: PLAN-100
plan: PLAN-100
---
## Objective

Close the last gap between "installed" and "actually fires". T4 proved the hook file lands byte-identically in a fresh install (AC-RC-8) — but `lore setup` writes no `settings.json` registration for it, so on a fresh `lore init` + `lore setup` project the coverage floor ships as governance prose plus an **unreachable hook**. That is precisely the silent-inertness class spec D6 warns about, and it defeats the spec's own Delivery constraint ("a fresh project must not be able to hit this").

Found independently twice: by the orchestrator reading `HOOK_REGISTRATIONS`, and by T4's own consumer audit.

## Deliverables

- `packages/core/src/distribution-hooks.ts`: add `stop-handoff-coverage.mjs` to `HOOK_REGISTRATIONS` as `{ runner: "node", event: "Stop" }` — no matcher (Stop does not scope by matcher). Owner classification decision (2026-07-31): it belongs to the **"core governance + security"** auto-registered set, NOT the deliberately-excluded orchestration-policy pair. Rationale to record in the module doc alongside the existing entries: it constrains "the consumer accounts for every ticket item" — a governance invariant of the same kind as `stop-doc-sync.mjs`'s turn-end doc-sync gate — not this team's subagent-routing preference. Extend that module's doc comment the way `subagent-stop-commit-guard.mjs` and `claude-md-guard.sh` each got a paragraph justifying their membership.
- `packages/lore/tests/unit/core/distribution-hooks.test.ts`: this file pins `HOOK_REGISTRATIONS` to exactly 10 hooks / 16 entries. Update both counts (→ 11 / 17) and add whatever per-entry assertion the file's existing shape uses.
- `packages/lore/tests/unit/assets-ssot.test.ts` and `packages/lore/tests/unit/adapters/real-setup-ports.test.ts`: each carries a hardcoded declared-asset roster (around line 383 in both) that `RealAssetSource`'s `assets/` enumeration is cross-checked against. Both are currently **RED** with an identical one-line diff `+ "hooks/stop-handoff-coverage.mjs"`. Add the entry to each roster.
- `packages/lore/tests/e2e/resume-coverage-compiled.bun.test.ts`: add the AC-RC-13 test under a name matched by `-t "stop hook registered"`.

## ACs

- **AC-RC-13** — after `lore setup` against a throwaway `--claude-dir`, the resulting `settings.json` carries a Stop registration whose command names `stop-handoff-coverage.mjs`, with the expected entry **derived from the exported `HOOK_REGISTRATIONS`** rather than a hand-written command string, plus a control assertion that the same parsed file carries the already-registered `stop-doc-sync` Stop entry so the positive half cannot pass vacuously.
  Oracle: `cd packages/lore && bun test tests/e2e/resume-coverage-compiled.bun.test.ts -t "stop hook registered"`
- **AC-RC-14** — the hook asset is declared in every hardcoded roster that cross-checks the directory enumeration, and the run reports exactly 2 matched test files.
  Oracle: `bunx vitest run packages/lore/tests/unit/assets-ssot.test.ts packages/lore/tests/unit/adapters/real-setup-ports.test.ts`

## Constraints

⛔ **Fix the rosters by DECLARING the asset, never by loosening the check.** Those hardcoded lists are a deliberate tripwire: they force every new shipped asset to be explicitly registered. Converting them to derive from the enumeration would make both tests permanently green and silently stop catching the next unregistered asset — it would remove the very mechanism that surfaced this gap. Chesterton's Fence applies; the RED is the fence working.

⛔ Every `lore setup` invocation MUST pass `--claude-dir <throwaway mkdtemp>`. A bare `lore setup` in this environment DELETES this repo's own source: 41 dev symlinks point from `~/.claude/` into `assets/`, and setup's removal path resolves THROUGH the symlink instead of unlinking the link. A 336-line SKILL.md died twice this way. The hardening fix is specced but unbuilt.

⛔ Never write to this repo's `.lore/` from a test or smoke check — throwaway `mkdtemp` + `lore init` only.

`packages/core` is a monorepo sub-package: after changing its exports, dependants cannot see them until it is built. Run `bun run build` before the `.bun.test.ts` oracle — the manifest is embedded in the binary and a stale `dist/lore` is a measured false-oracle vector. Sequence: edit → `bun scripts/embed-assets-manifest.mjs` if any asset content changed → `bun run build` → run the e2e.

Base: branch from the integration tip carrying T1–T5 (see the dispatch bundle for the exact sha) — `main` does not have this work.
