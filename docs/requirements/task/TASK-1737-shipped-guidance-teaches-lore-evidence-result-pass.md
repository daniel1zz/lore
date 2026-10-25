---
id: TASK-1737
type: task
role: plan
title: "Shipped guidance teaches 'lore evidence --result pass --output-tail-file', which the evidence gate refuses"
status: archived
priority: medium
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PRD-001
---
Found 2026-10-19: two lore-implementer runs in one batch both followed the shipped guidance `lore evidence <task> ... --result pass --output-tail-file <file>` and both were refused ("a self-reported result "pass" is not provable by a hand-authored output_tail alone ... Retry with --capture"). Each then ran `lore release`, which released with zero evidence (warning only), and had to re-claim to record evidence, leaving an extra claim/release pair in history.

Shipped surfaces still teaching the refused form (git grep "output-tail-file" without --capture): assets/context/corpus-workflow-3-execute.md:13 (rendered into .claude/rules/lore-corpus-workflow-execute.md:8), assets/skills/lore/SKILL.md:69, assets/skills/lore-plan/references/mode-update.md:26; fixture packages/lore/tests/fixtures/context-variables/pre-change-rules/corpus-workflow-execute.md:8.

Expected: every shipped instruction for a passing oracle uses the form the gate accepts (--capture); an oracle fails if shipped text teaches a `--result pass` evidence form the gate refuses. Also decide whether `lore release` with zero evidence after a refused evidence write in the same claim should refuse rather than warn.
