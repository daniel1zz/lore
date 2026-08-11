---
id: KN-312
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: archived
priority: medium
created: 2026-07-30
updated: 2026-07-31
tags: []
parent: PLAN-100
---
# Handoff — agent:main-orchestrator

## Plan

plan-implementation-resume-ticket-coverage-floor-ordinal-render

## Task Refs

- task-t3-turn-state-ticket-recording-stop-handoff-coverage-hook
- task-t5-stop-handoff-coverage-hook-as-blind-pipe
- task-t4-governance-rule-manifest-regeneration-fresh-install-e2e

## Modified Files

- .claude/settings.json
- packages/core/src/session.ts
- packages/lore/src/flows/feed-flow.ts
- packages/lore/src/adapters/cli/commands/handoff.ts
- packages/core/tests/unit/resume-coverage-constants.test.ts
- packages/core/tests/unit/handoff-content-ordinals.test.ts
- packages/lore/tests/unit/feed-resume-coverage.test.ts
- packages/lore/tests/unit/handoff-coverage-check.test.ts

## Key Decisions

| Judgment | Confidence |
|---|---|
| Root cause settled and mechanized: the resume ticket had an UPPER bound (RESUME_SCOPE_CLOSURE) and no LOWER bound, so under-coverage produced zero signal. Verified live on handoff-40 itself, which now renders a cardinality line, KD/NS ordinals, and a COVERAGE FLOOR block. | 95 |
| T1 (3751eea) and T2 (12b3556) are merged, re-verified independently in a clean tree, and archived. T3 (1e8c36f) is committed and released but NOT verified and NOT done: its 12 tests have never been run by anyone except its own implementer. | 95 |
| MY ERROR: all three dispatches omitted isolation:'worktree', so no worktrees were ever created. T1/T2 self-rescued on finding the checkout occupied; T3 worked in the shared one. Isolation rested on agent judgment, not mechanism. Nothing corrupted, but 8 concurrent commits landed mid-run. | 95 |
| lore setup follows dev symlinks into assets/ and DELETES the repo SSOT: a 336-line SKILL.md died TWICE this session. rmdir then hits ENOTDIR on the symlink, so the irreversible step commits and the run calls itself non-authoritative while --check reports exit 0 in-sync. | 95 |
| CLAUDE.md's 'Hook enforced' dispatch regime is doubly false: the hook was registered nowhere (I wired it), and pre-subagent-gate.mjs is self-documented ADVISORY with every path exiting 0. Its intact bypass logic is fossil evidence it once meant to deny. pre-no-general-agent-gate does deny. | 90 |

## Failing Oracle

(none)

## Next Steps

- T3 verification CANNOT run in the shared checkout — a concurrent session switched its HEAD to main (60de416), so the T3 files are absent there. Create your OWN worktree from fix/governance-never-discard-lore-output (tip was 8227dd1, re-check it), then: bun install, bun run typecheck, bunx vitest run packages/lore/tests/unit/handoff-coverage-check.test.ts (expect 12 tests; assert the matched count is non-zero), then lore done task-t3-turn-state-ticket-recording-stop-handoff-coverage-hook.
- Dispatch T5 (task-t5-stop-handoff-coverage-hook-as-blind-pipe) and it MUST carry isolation:'worktree' on the Agent tool — that is the exact parameter I omitted three times. AC-RC-10: the hook holds zero grammar (zero hits for every exported id prefix and disposition token), AND a stub binary on PATH exiting 3 makes the hook exit 3 reproducing that stderr verbatim.
- Dispatch T4 last (blocked by T2+T5): AC-RC-4 (compiled CLI stdout AND the MCP lore_feed response both carry ordinals + cardinality line + floor, asserted PER SURFACE) and AC-RC-8 (installed hook byte-identical to its assets SSOT after lore setup into a throwaway --claude-dir; both changed assets' manifest digests current). Run bun run build first — a stale dist/lore is a measured false-oracle vector here.
- After T4: lore verify plan-implementation-resume-ticket-coverage-floor-ordinal-render, then lore assess, then lore anchor add the two still-undeclared landed symbols (the coverage-check verb, the stop hook) to the spec. Also check lore ac list for AC-RC-12 — it is the deferred verb half of AC-RC-11 and T3 may not have covered it.
- .claude/settings.json holds UNCOMMITTED work: I wired pre-subagent-gate.mjs (PreToolUse Edit|Write|MultiEdit) and pre-no-general-agent-gate.mjs (PreToolUse Agent|Task), both pointing at $CLAUDE_PROJECT_DIR/assets/hooks/ so a teammate who never ran lore setup still gets them rather than silently losing the gate. It currently sits on the main branch in the shared checkout. Decide where it lands — the user has NOT approved committing to main.
- OPEN SPEC 1 (user-approved, not started): a dispatch-isolation gate that DENIES when subagent_type is a writing agent and isolation !== 'worktree'. Template is assets/hooks/pre-no-general-agent-gate.mjs, measured to work as PreToolUse on Agent|Task reading payload.tool_name and payload.tool_input.subagent_type. It MUST really deny (exit 2), never copy pre-subagent-gate's advisory pattern. MEASURE FIRST: whether payload.tool_input actually carries the isolation field. Do NOT add it to lore's auto-registration — distribution-hooks.ts lines 14-19 is an owner decision deliberately excluding orchestration-policy hooks; hand-wire it in this repo instead.
- OPEN SPEC 2 (user-approved, not started): harden lore setup against dev symlinks. User decision: KEEP the ~40 symlinks (editing assets/ live is the point), fix the tool. The removal path must lstat each target and unlink the LINK for symlinks — never resolve through it, never delete what it points at. Removals need the backup treatment writes already get. And lore setup exit 1 must not coexist with lore setup --check exit 0.
- STILL BLEEDING: the symlink ~/.claude/skills/lore-init-context -> <repo>/assets/skills/lore-init-context is live, and its target sits in lore's own RETIRED_FROM_INSTALL_PATHS. I restored the file, but the NEXT lore setup by anyone deletes it again. Two options were offered and neither chosen: unlink just that one symlink (consistent with lore's own retirement intent, leaves the other 39 untouched), or ship OPEN SPEC 2 first.
