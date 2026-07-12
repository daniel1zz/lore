---
id: TASK-114
type: task
role: plan
title: "T2 adapters + docs — CLI review --staleness/--list/--fail-on-candidate, MCP lore_staleness_probe, status/bootstrap visibility, superseded_candidate nudge rendering, CLAUDE.md"
status: archived
priority: high
created: 2026-07-12
updated: 2026-07-12
tags: [spec-044, t2]
parent: PLAN-028
plan: PLAN-028
---
Implements SPEC-044 D6, D7, D9, D10, D11(rendering), D14 → ACs AC-SP-5,6,7,8,12 (AC-SP-13 stays human/owner). Deliverables: CLI lore review --staleness [--limit] [--min-age-days] [--fail-on-candidate] [--list] [--json] + single-doc lore review <doc> --staleness (refuses invalidated target exit 4); synchronous mutexes BEFORE any IO (--staleness --no-ai exit 2, --pending --staleness exit 2); collect-and-continue partial-batch (exit 6 only if all fail); --json shape {probes[{doc,decision,confidence,priority,in_degree,age_days,reasons,blocking_questions,repair_command?,unresolved_supersede_note?,error?}], skipped{invalidated,too_young}, total_candidates, excluded_by_limit}; escalation rendering with literal repair command lore invalidate <slug> --reason '<=100 chars' + --superseded-by only when ref resolves; --list read-only fresh-escalate listing with [stale? 0.87 ✋N] badge; deterministic pre-checks explicitly NOT run for staleness; MCP lore_staleness_probe {limit?, min_age_days?, id_or_slug?, list?, by required} payload deep-equals CLI --json, expectedTools 29->30; lore status (text + --json open_stale_candidates) + lore bootstrap count via the SAME query --list uses (single derivation site); D11 superseded_candidate nudge rendering on regular lore review output (absent field = byte-identical REGRESSION); root CLAUDE.md SPEC-044 entry + adapters/service module CLAUDE.md updates. Oracles: bun test cli-staleness.bun.test.ts (fake claude-cli shell-script fixture, --min-age-days 0 load-bearing) + vitest mcp-staleness/staleness-visibility/staleness-escalation/review-superseded-candidate + bun run typecheck. ABSOLUTE worktree paths for every oracle invocation.
