---
id: KN-783
type: knowledge
role: knowledge
title: "Inventory 2026-10-23: checks, gates, human stop points and batch verbs (measured)"
status: draft
priority: medium
created: 2026-10-23
updated: 2026-10-23
tags: []
parent: ADR-058
---
# Inventory 2026-10-23: checks, gates, human stop points and batch verbs

Read-only measurement of this repo (sqlite3 -readonly on .lore/lore.db; hooks timed in a throwaway corpus). Data window 2026-07-28 .. 2026-10-23. Verdicts: DELETE (serves neither Q1 nor Q2, or redundant), MERGE (move to a milestone), KEEP-LOCAL (cheap, write-time invariant).

## Small-granularity checks (hooks, gates, landing floor)

| Check | Granularity | Cost | Real catches | Verdict |
|---|---|---|---|---|
| integrate floor: 10 `check:*` scripts with 0 failures | per landing | ~4-5 s + tails | 0 in 156 runs | DELETE or plan-close/nightly |
| `check:baseline-coverage`, `check:ac-oracle-ownership` | per landing | 18 s median / 349 s max; 306 s max | 17, 7 (corpus state, not branch) | MERGE to plan close |
| typecheck + build in floor | per landing | 50 s median | 3, 1 | KEEP, incremental, batch landings |
| AI judge before each `lore approve` (spec/adr/plan by config, denials also on baseline/task/knowledge) | per doc | one LLM call | 1338 denials: 1237 "no judgment yet", 40 reject, 61 escalate | MERGE: one bundle judgment at phase end / plan close; spec+adr keep it |
| `pre-tool-harness-run` | per lore call | +215 ms | no log | MERGE into binary |
| `stop-turn-review` (b) anchor drift, (c) CLAUDE.md budget | per turn | 0.4-4 s incl. turn snapshot | duplicates own-diff and check:memory-files | DELETE (b)(c); keep (a)(d) |
| `post-edit-bindings` | per edit | 336 ms | none recorded | MERGE into integrate own-diff |
| `subagent-context` | per subagent | 749 ms (2 processes) | n/a | MERGE to one call |
| `stop-handoff-coverage` | per turn | 234 ms | serves neither | DELETE |
| SessionStart detached `lore setup --check` | per session | process | serves neither | DELETE |
| trace row per `lore get` | per read | 132,067 rows, 2.5 GB db | no reader | MERGE to counts/sample |
| pre-push `--check-claude-md`, prose-pins | per push | dup of floor | duplicate | DELETE |
| git safety gate, claim/anchor gates (28 overlaps), done floors, own-diff, audit chain, main-ref guard | write time | ms | real | KEEP-LOCAL |

Gap: no shipped hook records its verdicts, so no hook can show it ever caught anything.

## Human stop points and review steps

- 1 of 442 decisions answered by a human; 1856/2107 approvals by agents; 35 audit items, 2 decisions, 95 drafts unanswered.
- override-judgment / override-attestation / ac-exempt: Wilson lower bound at prior 0.5 gives C=0.366, max ~0.66 after 50/50 good outcomes, never ≥0.8; escalating classes collect no outcomes. Never auto by construction. FOLD into milestone review.
- worktree-remove (31 escalations), stash-drop (11): AI-decidable (regenerability check; archive-first). DELETE the human step.
- report-issue in human-always: reversible, deduped. DELETE from human-always. push-force: KEEP.
- Task-level judge: agreement with human 0.000 (v6 n=30). DELETE. AC-quantifiability advisory: DELETE.
- `lore assess` verdict is advisory; only freshness binds plan close. FOLD as the binding correctness lens.
- Missing review dimensions: design necessity for code, concurrency safety, security, cross-doc contradiction; regression only per task.
- Self-improvement: calibration_records (1192), trace_events (1646 denials), review_judgments are display-only; decision_log feeds confidence but can only tighten and has 0 human audit input.

## Batch verbs

- No verb takes many ids or a filter and prints one summary. `lore_batch` (MCP) sequences create/get/set/delete/list/search/link only.
- `lore archive --apply` covers R2-R4 only (handoffs, leftover tasks of closed plans); never assessment/uat/retro; always exits 0.
- No plan-close verb (`lore set --status archived`); blocked by attestation floor and assessment freshness, not by open tasks.
- No abandon verb with a reason; draft→deprecated is not a valid transition.
- No MCP `lore_done` / `lore_reject`.
