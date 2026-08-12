---
id: TASK-711
type: task
role: plan
title: "The oracle-file-existence precheck understands only the 'cd <dir> &&' form the repo's own discipline forbids, so a compliant command is refused as a missing file"
status: draft
priority: medium
created: 2026-08-12
updated: 2026-08-12
tags: []
parent: PRD-001
---
packages/core/src/oracle-file-existence.ts::extractCdPrefixTarget derives the working directory a script-mode oracle will resolve its paths against. Its only recognizer is CD_SEGMENT_PATTERN = /^\s*cd\s+("[^"]*"|'[^']*'|\S+)\s*$/ (line 200) — a literal 'cd <dir> &&' prefix. It has no recognizer for the '--cwd <dir>' flag form used by 'bun test --cwd packages/lore <relative-path>'.

The two governance layers contradict each other. This repo's CLAUDE.md forbids putting a 'cd' in front of a measurement, because zoxide shims 'cd' and the following '&&' can then short-circuit silently — a documented false-oracle vector. But the precheck understands ONLY that forbidden form. An author who follows the discipline writes '--cwd', the precheck resolves the bare filename against the wrong roots, and 'lore evidence' refuses with 'Oracle file(s) not found' for a file that demonstrably exists.

Measured cost: an implementer on task-bind-ownership-a-claim-records-its-branch-commits-carry first mis-diagnosed the refusal as worktree dirt, then recorded three pass rows using the forbidden 'cd &&' form to get past it. Those rows are unattested and carry a 100-byte output tail with no summary line. They remain in the append-only ledger alongside the three later attested rows, so the task's evidence history now contains a self-reported pass whose only reason for existing is this defect.

The workaround that does succeed is 'lore verify', which spawns the AC's stored verify.command as a real subprocess and bypasses this precheck entirely. That is the stronger path anyway, but nothing in the refusal message points to it.
