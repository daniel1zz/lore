---
id: KN-311
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: approved
priority: medium
created: 2026-07-31
updated: 2026-07-31
tags: []
parent: PLAN-100
---
# Handoff — agent:main-orchestrator

SCOPE: 5 decisions + 6 next steps = 11 items to account for

## Plan

plan-implementation-resume-ticket-coverage-floor-ordinal-render

## Task Refs

(none)

## Modified Files

- .claude/settings.json
- assets/hooks/stop-handoff-coverage.mjs
- assets/governance/corpus-workflow.md
- packages/core/src/distribution-hooks.ts
- packages/lore/src/generated/assets-manifest.ts
- packages/lore/tests/e2e/resume-coverage-compiled.bun.test.ts
- packages/lore/tests/unit/stop-handoff-coverage.test.ts
- packages/lore/tests/unit/core/distribution-hooks.test.ts
- packages/lore/tests/unit/assets-ssot.test.ts
- packages/lore/tests/unit/adapters/real-setup-ports.test.ts
- packages/lore/tests/unit/service/setup-service.test.ts

## Key Decisions

| ID | Judgment | Confidence |
|---|---|---|
| KD1 | Plan fully closed: 14/14 ACs runner-attested per-task, full vitest 402 files / 6836 passed / 0 failed on a clean tree, plan-close gate passed, main ff'd to 1a95551. Six tasks archived; plan text amended to declare 6 tasks / 14 ACs so it stays the scope SSOT. | 95 |
| KD2 | A binary-side mechanism is NOT delivered until someone rebuilds the SHARED checkout's dist/lore. The ticket that handed me this work had NO coverage floor: global lore symlinks to <repo>/dist/lore, whose mtime postdated my feed call. The render logic was never at fault. | 95 |
| KD3 | 'Installed' is not 'wired': T4 proved byte-identical install while HOOK_REGISTRATIONS never listed the hook, so lore setup wrote no Stop entry and it could never fire. Found twice independently. T6 closed it; verified via the rebuilt global binary into a throwaway claude-dir. | 95 |
| KD4 | isolation and base-correctness are independent axes; only the first has a mechanism. The harness cuts worktrees from the shared checkout's HEAD, so a correct isolation:'worktree' still lands on the WRONG BASE. Mitigated per-dispatch by git merge --ff-only plus a git log assertion. | 90 |
| KD5 | assess raised a correct objection I could not fully answer: for negative-constraint ACs a green run is equally consistent with the cheat, so the diff must be IN the evidence. I verified it pre-merge (additive only, comparison logic untouched) but recorded it in a knowledge doc. | 85 |

## Failing Oracle

(none)

## Next Steps

- NS1: OPEN SPEC 1 (user-approved, not started) — the dispatch-isolation gate must assert TWO conjuncts: (1) a writing subagent_type implies isolation==='worktree', AND (2) the dispatch declares an explicit base OR the shared checkout HEAD is an ancestor of the integration tip. Conjunct 2 is the newly measured half. MEASURE FIRST whether payload.tool_input carries the isolation field. Template: assets/hooks/pre-no-general-agent-gate.mjs (it really denies, exit 2 — do NOT copy pre-subagent-gate.mjs, self-documented advisory, every path exits 0). Do NOT add to lore auto-registration; distribution-hooks.ts deliberately excludes orchestration-policy hooks.
- NS2: OPEN SPEC 2 (user-approved, not started) — harden lore setup against dev symlinks. 41 links from ~/.claude/ into assets/ are still live; a bare lore setup still deletes this repo's source through them. The removal path must lstat each target and unlink the LINK, never resolve through it; removals need the backup treatment writes already get; and lore setup exit 1 must not coexist with lore setup --check exit 0. Until it ships every setup call MUST pass --claude-dir <throwaway> (plus --yes when non-interactive).
- NS3: Dogfooding gap: this repo's own .claude/settings.json does NOT register stop-handoff-coverage. Consumers get it automatically via lore setup (T6), but this repo can only hand-wire it, because a bare lore setup here is destructive until OPEN SPEC 2 ships. Decide whether to wire it at $CLAUDE_PROJECT_DIR/assets/hooks/ as done for the two pre-* gates in 46e1157. Note it would then judge coverage of the ticket this handoff creates.
- NS4: Act on the two persisted assess recommendations that outlive this plan: (a) record the working diff (or a scoped grep with its zero-hit output) as evidence for every AC carrying a negative constraint — AC-RC-6, AC-RC-10's grammar half and AC-RC-14 are all currently unfalsifiable from evidence alone; (b) require one unfiltered whole-file attested run per AC-backing test file in addition to -t filtered runs, recording selected/skipped counts, since a filtered tail cannot show multi-part assertion structure.
- NS5: Housekeeping: stash@{0} on main is a redundant copy of the settings.json hook registration, byte-identical to commit 46e1157 — safe to drop. The git-safety gate blocks git checkout -- <path> even for provably identical content; git stash push is the route it names.
- NS6: Branch decision for the owner: fix/governance-never-discard-lore-output is still at 8227dd1, now behind main (main was fast-forwarded past it), and is held checked out by a live concurrent session's worktree (81499892). Either advance it to main or retire it — main is strictly ahead and the branch name no longer describes the integration line.
