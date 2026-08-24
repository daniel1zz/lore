---
id: KN-538
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: archived
priority: medium
created: 2026-08-24
updated: 2026-08-24
tags: []
parent: PLAN-140
---
# Handoff — agent:main-orchestrator

SCOPE: 6 decisions + 6 next steps = 12 items to account for

## Plan

plan-make-lore-issues-refuse-a-retired-shape-upstream-as-loudly

## Task Refs

(none)

## Modified Files

(none)

## Key Decisions

| ID | Judgment | Confidence |
|---|---|---|
| KD1 | The retired-shape refusal LANDED for the two CLI verbs, verified end-to-end on the rebuilt binary: retired+issues exit 4 (was 0), retired+--local exit 0, github+issues exit 4, and the original defect signature (--local vs no --local byte-identical stdout) is GONE. | 98 |
| KD2 | NOT CLOSED, only NARROWED. adapters/mcp/tools.ts:2908,2919 and scripts/migrate-issue-reports.ts:100,537 still derive shape policy from isGithubUpstreamCfg. lore report-issue via MCP - the AGENT surface - can still disagree with the CLI verbs. | 96 |
| KD3 | Why that was missed: AC-IS-4's structural grep and the spec's anchors were the SAME narrow set, each derived from the other. The MCP consumer arrives via dynamic await import(), which test:changed cannot see. lore assess caught it, above every AC. | 95 |
| KD4 | I wrote CLOSED into root CLAUDE.md and that knowledge's F1 note BEFORE running assess; both were wrong and are corrected to NARROWED. Lesson: run assess before writing any closure claim into a shipped governance doc. | 97 |
| KD5 | Two lore done gates fired correctly: a test-file anchor needs an UNFILTERED attested pass (-t filtered verify runs do not count), and a task declaring ac_scope needs red-first evidence OR --declare-no-new-tests. Red-first split across two tasks means each gate wants what the other task holds. | 94 |
| KD6 | Full-repo typecheck was EXIT=2 because I merged the tester's file without running typecheck; 2 of 3 errors came from MY bundle saying check result.error (Node semantics) while it used Bun.spawnSync. Now EXIT=0 / 0 errors, verified by me on main. | 97 |

## Failing Oracle

(none)

## Next Steps

- NS1: NS-A: open a follow-up spec/plan routing adapters/mcp/tools.ts and scripts/migrate-issue-reports.ts through classifyFeedbackUpstream. Its AC MUST grep the WHOLE consumer set, not a hand-listed subset — derive it with 'grep -rn isGithubUpstreamCfg --include=*.ts packages/ scripts/' and assert the count outside report-issue-wiring.ts is 0. Name the dynamic-import consumer explicitly since test:changed cannot see it.
- NS2: NS-B: AC-IS-2 (green control) asserts only expect(exitCode).toBe(4) — one expect — while its statement promises the refusal names the later-phase gap. Any unrelated exit-4 satisfies it. Strengthen with a stderr substring assertion in the follow-up, NOT by editing the archived plan's AC in place.
- NS3: NS-C: the plan is NOT archived. Both tasks archived, ready(true)=0, ready(false)=2 matching the 2 merged tasks, assess recorded (outcome 91 / evidence_integrity 84 / scope_fidelity 93). I did not run the tool-printed 'lore set --status archived' — closure claims are exactly what assess disproved once this session. Decide deliberately.
- NS4: NS-D: assess flagged an evidence-attribution mistake of mine — I ran lore verify against the RED-FIRST task too, so AC-IS-1..4 attested PASS rows sit on the task whose contribution was the RED. Keep post-fix attestations on the implementing task only, so red-then-green stays auditable from the bundle.
- NS5: NS-E: STILL UNDECIDED, bit this session twice — local main is 60+ commits ahead of origin/main and the harness builds worktrees from origin/main. Either push, or keep writing 'git rebase main' into every dispatch bundle. Root CLAUDE.md now states this as an ASSERTION (git rev-list --count origin/main..main == 0), not a pull command. knowledge-worktree-agents-are-built-from-origin-main-not-local
- NS6: NS-F: ticket 121's NS1/NS2/NS3 plus the mirror content-parity design (resolved-vs-resolved + normalising volatile expansion state) remain deferred with decisions recorded in knowledge-handoff-agent-main-orchestrator-122.
