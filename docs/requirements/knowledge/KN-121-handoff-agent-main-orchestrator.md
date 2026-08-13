---
id: KN-121
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: archived
priority: medium
created: 2026-07-21
updated: 2026-07-31
tags: []
parent: PLAN-062
links:
  - {id: KN-092, type: relates-to}
---
# Handoff — agent:main-orchestrator

## Plan

plan-implementation-spec-062-config-write-layer

## Task Refs

- task-t4-open-deny-check-ancestor-subtree-coverage-reject-patches

## Modified Files

- packages/lore/src/flows/setup-project-flow.ts
- packages/lore/src/flows/setup-project-uninstall.ts
- packages/core/src/attestation-completeness.ts
- packages/core/src/config-editability.ts
- packages/lore/src/service/config-service.ts
- packages/lore/src/adapters/http/config-routes.ts
- packages/core/src/verify-execution-root.ts
- packages/lore/src/service/verify-runner-service.ts
- packages/core/src/distribution-hooks.ts
- assets/hooks/subagent-stop-commit-guard.mjs
- assets/project/gitignore.template
- assets/project/CLAUDE.md.template
- CLAUDE.md

## Key Decisions

| Judgment | Confidence |
|---|---|
| CLAUDE.md stub uses backup-then-overwrite (owner directive), NOT the hooks step's conflict-never-overwrite. A CLAUDE.md filled in by lore-init-context WILL be overwritten on a setup re-run, recoverable only from .lore/.lore-backups/<iso>/. D6's loud backup-path reporting is the mandated mitigation. | 90 |
| Owner's 'CLAUDE.md into the manifest' choice could not be implemented literally — that manifest governs ~/.claude only, and CLAUDE.md is a repo file. Implemented the INTENT (rollbackability) via a new repo-level ledger .lore/.lore-project-manifest.json instead. | 95 |
| 4 config keys are structurally unwritable over HTTP (ai.providers.*.command/.args, ai.http.headers.*, verify.env.passthrough_all) — browser-reachable write there IS browser-reachable RCE/secret-exfil. Verified adversarially across 5 attack shapes including whole-ancestor replacement. | 95 |
| Four distinct false-oracle vectors found: mistyped AC paths, under-match, wrong execution root, stale dist/lore binary. Unifying lesson: exit-code-derived evidence proves a command ran and returned a status, NOT that it ran the right thing in the right tree against the right build. | 90 |
| A claude-code-guide research pass fabricated a SubagentStop field table (worktree_path, exit_code) with an official-looking URL. Official docs have NO SubagentStop input schema; an empirical probe hook proved cwd is the worktree path. Never build a mechanism on an un-probed field contract. | 95 |
| bun test failures at load 38-44 are 100% 5000ms hard-coded timeouts with 0 assertion failures — environment, not regression. The 1 vitest failure was independently re-verified correct via real CLI. Zero regressions across all 4 specs. | 85 |

## Failing Oracle

(none)

## Next Steps

- P0 [ESCALATED — recommended in the 2026-07-20 retro, still not built] Extend pre-bash-git-safety-gate.mjs with the consumer-side twin of the SubagentStop guard: on a NON-force `git worktree remove`, resolve the worktree's branch and block when `git rev-list --count main..<branch>` is 0 AND the branch is unmerged. This is the merge-verify half of the data-loss class; the producer half shipped this session. Do this FIRST — a twice-recommended, un-built gate is itself a governance failure, and this session's safety came only from manual `git log` checks before all 12 merges.
- P0 [user's original request, still unfinished] Dashboard Settings UI — the CONFIG BACKEND is complete (ConfigService + GET /api/config + PATCH /api/dashboard/config with If-Match + expectedHash CAS + audit), but there is no UI. Needs its own spec with spec_kind=design (verification profile requires e2e oracle + requires_uat=true, which then arms SPEC-054's plan-close gate). Import the SAME @lore/core config-editability tables the server enforces so the UI cannot offer an edit the server will reject; render the 4 deny keys read-only with an 'edit via YAML' note; surface restart_required per key (PRD R-3) rather than an undifferentiated success toast. Hard UI requirement: visually separate git-tracked team config (.lore/config.yaml, changes commit to the whole team) from machine-local settings — mixing them in one page makes a misclick's blast radius unreadable.
- P1 Run `lore ready plan-implementation-spec-062-config-write-layer` and execute task-t4-open-deny-check-ancestor-subtree-coverage-reject-patches: the deny-check only inspects LEAF paths, so a patch replacing a protected SUBTREE ROOT ({ai:{providers:null}} / [] / {}) is not denied. Currently bounded by Zod validate-then-write (0 bytes written), so it is defence-in-depth, not an open hole — but it becomes one the moment the schema loosens.
- P1 Mechanize the 4th false-oracle vector (the only one still unmechanized): a slice of packages/lore's .bun.test.ts files Bun.spawn the COMPILED dist/lore, so after source changes with no `bun run build` they exercise a stale binary. Add a build-freshness precheck (newest source mtime > dist/lore mtime → fail loud) in the spawn-based test helpers, or in lore verify when an AC command references dist/lore. Until then: ALWAYS `bun run build` before trusting any .bun.test.ts result.
- P1 Re-run the full `cd packages/lore && bun test .bun.test` on an idle machine to get a clean baseline. This session could not: Chrome held ~500% CPU (load 38-44) and bun test's per-test timeout is a hard-coded 5000ms, producing 164 failures that were ALL timeouts with 0 assertion failures. Verified zero regressions by other means, but there is no clean green record.
- P2 Close the three session-review findings that are policy/mechanism changes, not code: (a) CLAUDE.md 分发制 exemption has no size ceiling — the hooks/ clause let a 247-line security-critical guard ship with no spec/task/claim/review; bound it (~50 lines, or any change adding a test suite → treat as source). (b) `lore assess` should emit suggest_archive when every task under a plan is archived — 5 plans sat at `approved` after full completion this session because nothing downstream breaks when a plan is never closed. (c) `lore verify`/`lore evidence` should print a non-blocking advisory when the resolved actor is the OS username rather than an agent:/ai: prefix — the orchestrator recorded every attested row as `apple` this session while correctly enforcing actor identity on its subagents.
- P2 Add plan-terminal-status as a 5th I11 sub-check in ~/.claude/skills/lore-session-review/references/invariants.md — the catalog's four sub-checks (anchor add / spec status / assess / invalidate) reproduced the exact blind spot that let 5 plans sit unarchived; the judge found it only via the floor-not-ceiling instruction.
- P2 SPEC-061's completeness guard compares FILE counts only — a `-t 'REPRO'` oracle running 1 of N cases in a matched file still judges `complete`. Consider extending judgeCompleteness to also parse the runner's matched-CASE count when a -t filter is present, so attestation depth matches what the counts imply.
- P3 SPEC-063 has three ACs whose tests substitute stubs for the behaviour the AC statement demands (judge-flagged, evidence_integrity 66). Revisit with lore-test.
- P3 Owner decision needed: a 2026-06-15 git stash (`autopilot-pre-merge-cleanup`) is safe to `git stash drop` — its content (INVALID_PARENT_TYPE) has long been in packages/core/src/errors.ts:20 and its target path src/core/errors.ts no longer exists post-monorepo. Left undeleted because stash drop is irreversible.
- P3 `lore status --check-tree` exits 3 on 6 orphan knowledge docs (no parent, not a root type). Pre-existing, unrelated to this session's work — decide whether to parent them, adjust lore.tree.yaml, or accept the exit-3.
