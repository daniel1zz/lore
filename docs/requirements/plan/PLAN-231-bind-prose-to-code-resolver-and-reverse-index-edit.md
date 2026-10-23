---
id: PLAN-231
type: plan
role: plan
title: "Bind prose to code: resolver and reverse index, edit-time notice, stable generated sections"
status: approved
priority: medium
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: SPEC-210
phases:
  - {name: "P1"}
  - {name: "P2"}
  - {name: "P3"}
---
## Overview

Implements spec-prose-about-code-is-bound-to-what-it-describes-one (D1-D5, AC-BIND-1..5). Read the spec for the incidents, goal, design and rejected alternatives.

## Phases

- P1 Resolver and reverse index (D1, D2; AC-BIND-1, -2, -3): one core resolver for memory-file and fragment references (paths, path#Symbol, package.json scripts), shared with spec code anchors; one reverse index; `lore refs <path>`.
- P2 Told at edit time (D3; AC-BIND-4): the PostToolUse hook over the P1 index. Depends on P1.
- P3 Generated sections hold only derivable, stable content (D4, D5; AC-BIND-5): documentedScripts with descriptions, the generated command table replacing the hand-written Commands block, the module-index count moved to refresh output, AC-MI-1's count clause changed per the AC-change rules. Independent of P1.

## Notes for implementers (from the spec review)

- D3 with a whole-file Write: the pre-edit content comes from git (HEAD or the index) for a tracked file; an untracked new file has no prior script commands, so every script binding it contains is new and nothing is reported for it.
- A bare backticked script name binds only while that script exists; the missing-script finding (AC-BIND-2) applies to the `bun run <name>` form. State this in the resolver's doc comment.
