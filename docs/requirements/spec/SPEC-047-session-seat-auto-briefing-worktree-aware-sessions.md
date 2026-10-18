---
id: SPEC-047
type: spec
role: spec
title: "Session seat auto-briefing: worktree-aware SessionStart injection"
status: approved
priority: high
created: 2026-07-16
updated: 2026-10-10
tags: [session-layer, seat, worktree, hooks]
---
**spec_kind:** feature · **implements →** PRD §15 Session Layer (S3 extension) + §17 asset SSOT

## Overview/Goal

Eliminate the hand-carried "parallel-session seat briefing" (2026-07-16 finding: the orchestrator had to hand the owner a copy-paste discipline block for every parallel worktree session). Mechanize it: the SessionStart hook detects "this session was opened inside a LINKED git worktree of a lore-governed repo" and AUTO-INJECTS the seat discipline block — actor identity derived from the branch name, corpus location derived from the git common dir. Zero paste, zero conversation memory. Main-checkout sessions keep today's behavior (bootstrap + resume_hint) byte-identical.

## Scope

**IN:**
- New asset `assets/governance/seat-briefing.md` — the seat-discipline template (SSOT; team-generic English, mirrors corpus-workflow.md conventions). Placeholders `{{ACTOR}}`, `{{BRANCH}}`, `{{MAIN_CHECKOUT}}` substituted by the hook at injection time. Content contract: identity export (`LORE_ACTOR=agent:{{BRANCH}}`), single-plan focus rule, corpus-location note (worktrees carry no `.lore/`), claim discipline (`lore ready` first; claim with explicit `--worktree`/`--branch`; anchor-gate deny → follow the feeding pack, never `--steal`/bypass), branch-only commits (merge authority stays with the main-checkout session), mandatory `lore handoff --by {{ACTOR}}` on exit, opening move `lore feed session-resume --by {{ACTOR}}`.
- `assets/hooks/session-start-resume.mjs` (SSOT copy) + live `~/.claude/hooks/session-start-resume.mjs` gain worktree seat detection: cwd is a linked worktree iff `git rev-parse --git-common-dir` differs from `git rev-parse --git-dir` (resolved paths). When true AND the main checkout has a `.lore/` dir: read `<claude-dir>/governance/seat-briefing.md` (fall back to the repo-relative assets copy for dev machines without a `lore setup` install; final fallback = skip with a one-line stderr note, fail-open), substitute placeholders (ACTOR = `agent:<branch>` sanitized to slug charset), and inject the block ALONGSIDE the existing corpus-workflow/bootstrap injection. Bootstrap consultation runs against the MAIN checkout's corpus (cwd for the `lore bootstrap` spawn = main checkout).
- `assets-ssot.test.ts` manifest const extended (+1 file, 27 total); template placeholder-set asserted; cleanliness greps unchanged.
- New hook behavior test `packages/lore/tests/unit/hooks/session-seat-injection.test.ts` (vitest, mkdtemp): builds a throwaway git repo + linked worktree + fake `.lore/`, spawns `node assets/hooks/session-start-resume.mjs` with a PATH-stubbed `lore` shim, asserts (a) seat block present with `agent:<branch>` substituted, (b) main-checkout session (same repo, primary worktree) output contains NO seat block, (c) hook stays fail-open when the briefing file is absent (exit 0, no throw).

**OUT:** a `lore seat <slug>` worktree-creation verb (ergonomic sugar, later); any change to `lore setup` (the new asset flows through the existing governance kind automatically); Windows; altering merge-authority conventions (stays a documented human rule inside the briefing).

## Design

- Detection is PURE environment inference — no new state, no config: linked-worktree test via git plumbing; actor from branch; main checkout from `--git-common-dir`'s parent. Mirrors SPEC-042's "derived, never stored" session ethos.
- The briefing TEXT lives in the asset SSOT (governance kind, installed by `lore setup` to `<claude-dir>/governance/seat-briefing.md`), NEVER hardcoded in the hook — editing discipline means editing `assets/`, the SPEC-046 A4/P0 rule.
- Hook edits stay fail-open everywhere (g1-hook precedent): any git/fs/spawn error → inject nothing extra, exit 0.
- Placeholder substitution is dumb string replace of the three tokens; unknown `{{…}}` tokens pass through verbatim (no template engine).

## Acceptance Criteria

- AC-047-A [script/test] assets SSOT conformance incl. seat-briefing.md + placeholder assertions: `bunx vitest run packages/lore/tests/unit/assets-ssot.test.ts`
- AC-047-B [script/test] hook seat-injection behavior (worktree yes / main no / missing-file fail-open): `bunx vitest run packages/lore/tests/unit/hooks/session-seat-injection.test.ts`
- AC-047-C [script/build] full regression: `bun run typecheck && bun run test`
- AC-047-D [human] real-machine spot check: `git worktree add` a scratch branch in the lore repo, open a session (or spawn the hook manually), confirm the injected block names `agent:<branch>` and the main checkout path; main-checkout session unchanged.

## Risks

| Id | Sev | Risk | Mitigation |
|---|---|---|---|
| R1 | M | hook edit breaks existing SessionStart injection for ALL projects | fail-open wrapping + AC-047-B case (b) asserts main-checkout output unchanged + live-copy sync only after merge + backup |
| R2 | L | branch names with exotic chars break actor slug | sanitize to `[a-z0-9-]`, test covers a `feat/x_y` branch |

## Boundaries

Pure additive: one asset file, one hook enhancement, two test files. No service/store/CLI surface change; no new doc types; the mechanism is consumed by every future multi-session setup with zero per-session input.


## Acceptance Criteria (structured)

- [⚑] [script] AC-047-A: assets SSOT conformance green incl. seat-briefing.md manifest entry + placeholder-set assertions
  script: test — bunx vitest run packages/lore/tests/unit/assets-ssot.test.ts
  other_command=1
- [⚑] [script] AC-047-B: hook seat-injection behavior green: linked worktree injects agent:<branch> block; main checkout byte-unchanged; missing briefing file fail-open exit 0
  script: test — bunx vitest run packages/lore/tests/unit/hooks/session-seat-injection.test.ts
  other_command=1
- [⊘] [script] AC-047-C: full regression green (typecheck + both runners)
  script: build — bun run typecheck && bun run test
  other_command=1
- [○] [human] AC-047-D: real-machine spot check: scratch worktree session injects seat block with correct actor/main-checkout; main-checkout session unchanged
  human: owner or orchestrator-with-delegation; scratch worktree only

## Code anchors

- assets/governance/seat-briefing.md
- assets/hooks/session-start-resume.mjs
- packages/lore/tests/unit/hooks/session-seat-injection.test.ts
