---
id: KN-457
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: approved
priority: medium
created: 2026-08-13
updated: 2026-08-13
tags: []
parent: PLAN-124
links:
  - {id: KN-456, type: supersedes}
---
# Handoff — agent:main-orchestrator

SCOPE: 13 decisions + 6 next steps = 19 items to account for

## Plan

plan-land-oracle-exclusivity-a-mirror-check-that-can-fail-a

## Task Refs

(none)

## Modified Files

(none)

## Key Decisions

| ID | Judgment | Confidence |
|---|---|---|
| KD1 | SUPERSEDES handoff-103, which is now invalidated: its NS2 said the bun half had never completed. It has. Everything else below is unchanged from 103 | 98 |
| KD2 | FULL-SUITE VERDICT at 269e415b, clean tree: vitest 510 files passed + 1 known-red (AC-OX-6 only); bun half run SEPARATELY because of the short-circuit — 2141 pass, 0 fail, 212 files, 837s, persisted exit 0. Tree unchanged by either half | 97 |
| KD3 | ⛔ lore list silently drops invalidated docs while total AND per-type sums stay self-consistent (1475 vs 1495 with --include-invalid, 20 live docs hidden). A census on it read 21 orphans against a TRUE 1 — 21x — and that figure reached an AC statement. Every census MUST pass --include-invalid | 98 |
| KD4 | ⛔ Both judge surfaces score text never shown them. review truncated the PARENT spec with NO notice, asked 'what is D8, never defined' (D8 is a section 1684B past the cut), escalated on 2 false findings of 3. Truncating the SUBJECT does emit a notice. assess has a manifest but no discount rule | 97 |
| KD5 | ⛔ AC-OX-6 is the ONLY red left: one orphan, KN-025, whose doc has deleted_at 2026-07-18. Prune retires an unclaimed FILE but not a mapping to a SOFT-DELETED doc. Owner task ready: task-the-mirror-prune-does-not-retire-a-mapping-whose-doc-was | 97 |
| KD6 | ⛔ bun run test is test:vitest && test:bun && check:spec-mirror, so AC-OX-6's red SHORT-CIRCUITS the bun half and the mirror check under the aggregate script. Verified by running test:bun directly. Until AC-OX-6 greens, a green 'bun run test' is unobtainable | 96 |
| KD7 | task-the-two-mirror-exporters CANNOT be done: AC-OX-5 attested pass but AC-OX-6 holds fail evidence and lore scope rm REFUSES to drop an ac id with evidence. Left released+unarchived deliberately; it archives once the prune task greens AC-OX-6 | 95 |
| KD8 | ⛔ The 203 status mismatches were repaired by W1's own 211-file commit — which it labelled a merge hazard — not by my post-merge sweep: its write-mode export fired AFTER it fixed export-docs-service.ts. Verified independently: status_mismatch 0 with --include-invalid | 96 |
| KD9 | ⛔ The CLAUDE.md mirror lesson was SUPERSEDED, not evicted: 'NO invocable command re-exports a status change' is now FALSE — mirror:export repairs status/frontmatter unconditionally, BODY drift still needs lore export-docs --force, and the suite no longer writes the mirror | 97 |
| KD10 | ⛔ A subagent cannot tell the orchestrator's concurrent corpus writes from pre-existing drift; one misattributed mine as 'pre-existing drift on main, stable across the session' though they were created WHILE it ran. Bundles naming a live baseline MUST forbid pinning literal counts | 96 |
| KD11 | ⛔ lore done printed a paste-ready archival command for plan-land-oracle-executability, whose 3 declared phases hold mechanism=4, corpus-cleanup=0, backlog-and-arm=0, with AC-OX-6/7/11 at zero evidence. 'Every child task archived' is trivially true of an empty phase | 96 |
| KD12 | ⛔ lore set --content-file silently accepted a 65%-shrinking replacement, deleting 3 of 5 sections from a task a running implementer was reading. Recovered to v9. 'Read back first' cannot catch this — I did; the loss was in assembly. Every later write asserted startswith | 98 |
| KD13 | ⛔ ac add does NOT demote an approved spec (re-verified v23-v25), so AC-OX-5/6 landed while the spec BODY still read 'AC-OX-1 … AC-OX-4' with no Scope entry for either. review correctly escalated. Adding an AC and updating its spec prose are ONE unit | 96 |

## Failing Oracle

(none)

## Next Steps

- NS1: Take task-the-mirror-prune-does-not-retire-a-mapping-whose-doc-was (ready, critical). ⛔ Fix the PRUNE — do NOT hand-delete KN-025's file+mapping, the next soft-delete recreates it. Retire the mapping, or report it DECLINED per AC-OX-5's honest-report clause
- NS2: After AC-OX-6 greens: lore done task-the-two-mirror-exporters-disagree-because-drift-detection, then confirm the AGGREGATE bun run test goes green end-to-end (the halves are individually green at 269e415b; only the && chain is blocked)
- NS3: ⛔ Do NOT close plan-land-oracle-executability despite lore done's suggestion: corpus-cleanup and backlog-and-arm hold ZERO tasks and AC-OX-6/7/11 zero evidence. Decompose those phases first
- NS4: Mechanizing the judge-truncation fix (reports 01KZWVCPCTKAVXZ3068HRZ8SGK + 01KZWW60FGGEC2GK1FB36A7BD5) needs a spec first: SPEC-028's AC count is 0 and its plan is archived, so run /lore-design. ⛔ Not writable inside a plan
- NS5: One worktree left: .claude/worktrees/agent-a979ef95371b82c35 (branch worktree-agent-a979ef95371b82c35, merged at e6a4a9f0). Blocked only by the 30-min reflog liveness window — remove when quiet
- NS6: Raw readiness, never inferred: oracle-exclusivity records=5 ready=2 archived=3; oracle-executability records=5 ready=0 archived=5; multi-session-p1 records=9 ready=0 archived=9
