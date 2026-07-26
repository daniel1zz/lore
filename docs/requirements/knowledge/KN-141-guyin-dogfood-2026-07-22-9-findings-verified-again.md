---
id: KN-141
type: knowledge
role: knowledge
title: "Guyin dogfood 2026-07-22 — 9 findings verified against main HEAD, hotfixes + spec dispositions"
status: approved
priority: medium
created: 2026-07-23
updated: 2026-07-24
tags: []
parent: PRD-001
links:
  - {id: KN-093, type: relates-to}
  - {id: SPEC-065, type: informs}
  - {id: SPEC-066, type: informs}
  - {id: SPEC-067, type: informs}
  - {id: SPEC-069, type: informs}
---
# Guyin dogfood 2026-07-22 — 9 findings verified against lore main HEAD (2026-07-23)

Source: external dogfood session (guyin project, hoisting-plan close-out: 3 parallel
implementers → merge → assess → close) filed 9 tool/process issues
(`/Users/apple/Projects/zz/guyin/lore-issues-20260722.md`). This retro records the
per-finding verification verdict against lore main HEAD (e9e5188), the byproduct
discoveries, and the disposition (hotfixed / spec'd / not-ours).

## Verification verdicts

| # | Finding | Verdict | Key evidence | Disposition |
|---|---|---|---|---|
| P0-1 | `create knowledge --sub-type handoff` unusable, error doesn't redirect | **Already fixed** (SPEC-041) | `commands/handoff.ts` full impl; `CorpusService._createImpl` writer-identity guard rejects create-path naming `lore handoff` | guyin hit a stale installed binary. Doc drift was real → hotfixed (see below) |
| P0-2 | `lore pending` prints 10-char truncated IDs; `approve` only accepts full ID/slug | **Still present** | `pending.ts:124` `d.id.slice(0, 10)`; `resolve.ts` `ULID_REGEX` demands 26 chars, no prefix matching; approve error has no truncation diagnostic | Spec'd (CLI ergonomics) |
| P0-3 | stop/cleanup hook suspected of deleting an ACTIVE subagent worktree ("0 commits" heuristic) | **Not lore's code** | No `git worktree remove` execution path exists anywhere in lore hooks/CLI; `subagent-stop-commit-guard.mjs` only blocks (exit 2), never deletes; non-force `git worktree remove` is refused by git itself for any uncommitted/untracked content (empirically probed 2026-07-21, `knowledge-non-force-git-worktree-remove-needs-no-hook-guard-git`) | Attribution: the deletion shape matches the Claude Code harness's worktree-isolation auto-clean ("auto-cleaned if unchanged") — after the agent stashed, the tree was clean + 0 commits = exactly the harness's "unchanged" predicate. The shared-stash recovery succeeding is consistent: stashes live in the common git dir and survive worktree removal. Not fixable lore-side; mitigation is discipline (don't leave work only in a stash inside a harness-managed worktree) |
| P1-4 | git-safety-gate blocks command EXAMPLES inside heredoc bodies | **Still present** (reproduced live) | `pre-bash-git-safety-gate.mjs` `preprocessForInspection` strips quoted strings but NOT heredoc bodies; heredoc lines become segments and match rules; SPEC-050 command-position matching covers only g1–g4 gate hooks, not this one | Spec'd (heredoc hardening) |
| P1-5 | `create task` missing-arg errors dribble out in two rounds; `--plan-id`/`--parent` overlap with no default inference | **Still present** | `create.ts:259-265` early exit-2 on `--plan-id`; `schemas.ts:433-438` (parent_id) + `484-493` (plan_id) fail separately | Spec'd (CLI ergonomics) |
| P1-6 | assess claude-cli default 60s timeout < judge's real ~73s; config provider entries replace (not merge) built-ins, partial entry silently breaks provider | **Still present** | `packages/core/src/ai.ts:136` `default(60_000)`; `ai/registry.ts:97-103` shallow spread (deliberate, commented); NO startup fail-loud for a partial provider entry — the missing-command failure only surfaces after the timeout | Spec'd (AI robustness). Replace-not-merge semantics stay (deliberate anti-surprise choice); the fix is raising the default + startup validation of merged entries |
| P1-7 | assess judge: `based_on="absence"` ungrounded (warning only, no downgrade); truncated tasks don't affect confidence/score | **Partially fixed** | `ai-provider-service.ts:180-227` `computeGroundingWarnings()` detects and stamps `rubric_warning` — but purely advisory; `truncated[]` recorded, `overall_score` unaffected | Spec'd (AI robustness) |
| P2-8 | 0% attested evidence chain — no gate demands ≥1 script-mode AC / attested oracle per task | **Confirmed gap** | SPEC-058 `oracleCoverage` is a PLAN-TIME check on spec-promote (declared ACs cover required oracle kinds) — not an EXECUTION-TIME evidence check; `attested_evidence_ratio` (assessment.ts:784) feeds judge facts only, no gate consumes it | Spec'd (execution-time attestation gate) |
| P2-9 | ad-hoc bugs have no lightweight task channel (plan_id + parent mandatory) → scope-drift by least resistance | **Still present** | `taskExtraSchema.plan_id` non-optional; no `--adhoc`/`--linkage` | Spec'd (same spec as P2-8, workflow-gate layer) |

## Byproduct discoveries (this verification session)

1. **SSOT↔installed hook divergence (real instance of the standing-lesson failure mode)**:
   the `--path-format=absolute` fix to `subagent-stop-commit-guard.mjs` (root-caused
   2026-07-21) landed ONLY in the installed copy `~/.claude/hooks/`; the SSOT
   `assets/hooks/` never got it. Hotfixed this session: SSOT backported, `diff` parity
   verified byte-identical, distribution-hooks + assets-ssot suites green (227/227).
   Root cause: hooks are installed by COPY (parity can rot), skills by SYMLINK
   (parity structural). The asymmetry itself is the hazard surface.
2. **Handoff doc drift**: global `~/.claude/CLAUDE.md` and the `lore-session-capture`
   skill (SSOT `assets/skills/`) still instructed the retired
   `lore create knowledge --sub-type handoff` path. All occurrences rewritten to
   `lore handoff` usage this session (skill installed copy is a symlink — single-point fix).

## Lessons

- **A dogfood report's "root cause" line is a hypothesis, not a verdict**: P0-1 was
  already fixed (stale binary), P0-3 was mis-attributed to lore hooks (the shape
  matches harness auto-clean; lore-side code has no delete path). Verify each claim
  against HEAD before spec'ing fixes.
- **Install-by-copy vs install-by-symlink determines whether parity can rot.** Every
  copy-installed asset pair needs a content-parity oracle; symlinked pairs are
  structurally immune.
- **Plan-time oracle coverage (SPEC-058) and execution-time attestation are different
  gates**: a spec can declare script-mode ACs and still close its plan with 0%
  attested evidence — nothing bridges declaration to execution today.
