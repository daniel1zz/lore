---
id: KN-545
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: archived
priority: medium
created: 2026-08-24
updated: 2026-10-10
tags: []
parent: PLAN-143
---
# Handoff — agent:main-orchestrator

SCOPE: 6 decisions + 6 next steps = 12 items to account for

## Plan

plan-collapse-the-retired-shape-refusal-to-one-definition-and

## Task Refs

(none)

## Modified Files

(none)

## Key Decisions

| ID | Judgment | Confidence |
|---|---|---|
| KD1 | SUPERSEDES knowledge-handoff-agent-main-orchestrator-124, which is now stale (it said the plan was unarchived and MCP unfixed; both are done). Read THIS one, not 124. | 99 |
| KD2 | report-issue/issues is DONE and pushed (06aa81cb). Two specs closed: SPEC-147 (CLI behavioural defect) and SPEC-149 (SSOT collapse incl. the MCP copy). Both plans archived, all 4 tasks archived, my_claims 0, tree clean, origin in sync. | 98 |
| KD3 | Measured on main this session: repo-wide typecheck EXIT=0; full bun test EXIT=0; full vitest 1 failed of 9348 — that one is the DEFERRED ENOBUFS (lore list --type knowledge = 21.57 MiB vs 20 MiB maxBuffer), not a regression. | 97 |
| KD4 | The MCP copy of the refusal message had ALREADY DRIFTED ('to file' vs 'to file/list'). I asserted byte-identical in four places from grepping only the SHARED substring — a partial comparison is not an equality check. All four corrected. | 98 |
| KD5 | 9 of 10 red vitest tests were self-inflicted: mirror:export and 'lore export-docs --force' are NOT interchangeable (count/slug vs BODY). Nine failures dissolved with zero code changes. Full order: corpus writes then mirror:export then export-docs --force then commit then suites. | 97 |
| KD6 | AC-MS-2's behavioural half is now VACUOUS by construction — it compares the MCP message to the builder the MCP handler now calls. Durable protection is AC-MS-1's whole-tree definition count. An equality oracle over two copies dies when the copies merge. | 96 |

## Failing Oracle

(none)

## Next Steps

- NS1: NS-A: ticket 121's NS1/NS2/NS3 remain the largest open item, decisions already recorded: ENOBUFS -> 'lore list --fields' projection; the two 30s drift-check timeouts -> '--type' scoping on export-spec-mirror --check (first confirm the other five types' idempotency is covered elsewhere, else it is a WEAKENING needing explicit re-baseline); runLore must surface result.error instead of 'result.status ?? 1'. The spawnSync audit surface is 200+ files with 'status ?? N' in production code too — needs a check script, not a manual sweep.
- NS2: NS-B: mirror content-parity design still UNIMPLEMENTED: resolved-vs-resolved PLUS normalising volatile expansion state. This session added DIRECT proof it is unsatisfiable under concurrency — minutes after a clean check:spec-mirror, drift named three docs written by a CONCURRENT session (KN-542, SPEC-148, ADR-038). No action available to one session keeps it green. It is correctly absent from hooks/pre-push; do not adopt it as a release gate.
- NS3: NS-C: root CLAUDE.md is at 22951/24576 bytes with an 'approaching ceiling' advisory (22 lines left). It gained two standing lessons this session. Next substantive addition should be paired with an eviction.
- NS4: NS-D: a CONCURRENT session's worktree remains: worktree-agent-ab25e8547e82af95f, LOCKED, with 1 UNMERGED commit (b1916362). ⛔ Not mine, not touched, must not be removed by anyone but its owner. My four worktrees and branches are cleaned up.
- NS5: NS-E: assess left two open process recommendations I did not mechanise: record at least one consumer-suite run when editing a widely-imported module such as adapters/mcp/tools.ts (typecheck plus the two touched files leaves the blast radius unevidenced), and avoid recording the same lint oracle twice for one AC.
- NS6: NS-F: neither closed spec carries --falsifier-* declarations on any AC. Adding them post-landing would make 'the smallest mutation that turns this oracle red' machine-checkable, and would also expose AC-MS-2's vacuity mechanically rather than only in prose.
