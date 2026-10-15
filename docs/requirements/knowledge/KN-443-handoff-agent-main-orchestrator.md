---
id: KN-443
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: archived
priority: medium
created: 2026-08-12
updated: 2026-10-10
tags: []
parent: PRD-001
---
# Handoff — agent:main-orchestrator

SCOPE: 3 decisions + 5 next steps = 8 items to account for

## Plan

(none)

## Task Refs

(none)

## Modified Files

(none)

## Key Decisions

| ID | Judgment | Confidence |
|---|---|---|
| KD1 | Three handoff-98 follow-ups merged and archived; spec v27 to v33 (D5 seam exemption named, AC-CP-3 now four cells), re-approved after review caught a stale assertion I had left in it; merged tree green: vitest 8976 pass, bun 2072 pass/0 fail, exit 0 read back from persisted files | 95 |
| KD2 | NS3 was half-obsolete: --capture already refuses a declared --result contradicting the observed exit code (measured: exit 4, records nothing). Real gap is that the exit code is validated then DISCARDED - captured rows carry no exit_code and no attestation | 95 |
| KD3 | Mirror export's UPDATE path is broken for spec, task AND knowledge; only the new-file path works. Refutes the prior task's control claiming specs re-render. 171 of 1294 files disagree on status alone, a lower bound. .lore/lore.db is gitignored, so git kept asserting a retired defect | 90 |

## Failing Oracle

(none)

## Next Steps

- NS1: SIX new adhoc tasks filed, all UNCLAIMED: task-the-mcp-boot-carries-the-same-frozen-startup-cwd, task-a-captured-evidence-row-observes-the-exit-code-validates, task-the-undetermined-provenance-value-has-no-policy-fail-open, task-the-clean-tree-floor-and-the-repo-s-own-test-selection, task-verify-execution-root-carries-a-byte-identical-copy-of-the
- NS2: AC id collision: ac_scope AC-CP-1/2/4 are declared on TWO specs, so lore verify --task refuses them as ambiguous; such tasks archive only via --override-attestation. AC-CP-3 and AC-CP-5 are unambiguous. Audit every spec's declared set before minting a new AC id
- NS3: 167 mirror files remain stale (171 measured minus 4 repaired). Do NOT bulk-repair before the root cause lands - the update path re-stales them on the next edit. Working repair: rm the file then re-export, routing it through the new-file path
- NS4: Cleanup pending: worktree .claude/worktrees/agent-a532c6b9988760725 and its merged branch (still inside the 30-min liveness window at session end), plus six stale stashes from five agents named mirror-export-side-effect - regenerable
- NS5: The user's global CLAUDE.md says a captured row's pass/fail is still typed by the recorder. That half is now FALSE by measurement; the no-attestation half still holds. Left unedited pending the user's decision
