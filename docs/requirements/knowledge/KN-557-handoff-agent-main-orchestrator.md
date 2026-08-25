---
id: KN-557
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: approved
priority: medium
created: 2026-08-25
updated: 2026-08-25
tags: []
parent: PLAN-145
---
# Handoff — agent:main-orchestrator

SCOPE: 4 decisions + 6 next steps = 10 items to account for

## Plan

plan-close-the-read-side-a-github-filed-defect-becomes

## Task Refs

(none)

## Modified Files

- /tmp/claude-501/-Users-apple-Projects-zz-lore/8d78972a-28cf-4fae-8699-80dab5bf1b31/scratchpad/handoff-detail.md

## Key Decisions

| ID | Judgment | Confidence |
|---|---|---|
| KD1 | Addendum's 'restore never runs on timeout' is FALSE, probe-measured: a synchronous vitest body cannot be interrupted, so finally ALWAYS runs. Real mechanism is cross-worker concurrency over the shared real mirror. Both filed defects are ONE root cause; a faster file only makes the race rarer.@0.97 | — |
| KD2 | 90951390 absorbed the content probe into --check and re-measured no caller. Split measured by importing both halves: runCheck 302ms, runContentCheck 11457ms, 97% content. Anchors byte-identical across the 251 commits since, so the read-side slice is exonerated by measurement.@0.96 | — |
| KD3 | All three defects were approved prior art from 2026-08-24; my retrieval never searched ENOBUFS so a day-old finding was re-derived. The false 'not previously recorded' heading is RETRACTED in place. Read the correcting CHILD doc before citing the parent.@0.98 | — |
| KD4 | Write authority by ROLE is UNENFORCED, measured: gate spec-create never receives an actor and no hook references LORE_ACTOR/role/subagent. Composed with created_by:'system', an out-of-authority write is neither refused nor attributable.@0.95 | — |

## Failing Oracle

(none)

## Next Steps

- NS1: NS1/NS3 are IN FLIGHT, not landed: two lore-implementer worktrees (mirror-oracle-budget-isolation on the three test-file defects; duplicate-slug-existing-id on the store false label). On return merge with the task slug in the message, then run git branch -a AND git log --oneline main..<branch> UNCONDITIONALLY — a sub-subagent's branch never appears in the parent's return.
- NS2: dist/lore is ~2h stale against HEAD. bun run build is part of landing the batch, after the last agent returns, never mid-wave: pre-push --check-binary-provenance exits 3 on a dist older than HEAD and runs FIRST, blocking every later check.
- NS3: P5 stays unarchived until its criteria are met. Verification protocol is KD3's: mirror:export does NOT reconcile bodies (measured again — parity printed OK while --check still exited 2; lore export-docs --force converged the two files), so converge, commit, then run BOTH halves with ZERO lore writes in between.
- NS4: DECIDE the disposition of spec-the-mirror-oracles-two-command-surfaces-are-o-corpus-by (draft, AC-MOS-1..5). Authored out-of-authority by the implementer I dispatched; I told it not to touch the doc again. Content is strong and covers ticket 121's list --fields and --type items. Do not let it drift into governing unplanned work, and do not discard it for provenance alone.
- NS5: Four new adhoc tasks filed, all draft and unclaimed: task-the-mirror-check-absorbed-the-content-probe-in-90951390; task-one-unknown-key-discards-the-whole-lore-config-yaml-and; task-lore-create-by-is-accepted-and-ignored-cli-content-writes; task-48-files-fabricate-an-exit-code-from-spawnsync-so-every (48 is a lexical LOWER bound, not a sweep list).
- NS6: The authority-plus-attribution composition finding has no home yet. Its right SSOT is knowledge-the-nine-unenforced-standing-lessons-evicted-from, NOT a new root CLAUDE.md line: the root file is 202/220 lines and 23761/24576 bytes with BOTH metrics on advisory warning, so any addition must evict first.
