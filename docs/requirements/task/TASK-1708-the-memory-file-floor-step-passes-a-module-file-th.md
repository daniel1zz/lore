---
id: TASK-1708
type: task
role: plan
title: "The memory-file floor step passes a module file that status reports over its byte ceiling"
status: deprecated
priority: high
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PRD-001
---
Problem: two oracles disagree on the same memory file. On main 350ad2c9, `lore status --check-claude-md` exits 3 with "[max_bytes] packages/lore/src/store/CLAUDE.md is 16448 bytes, exceeding the module max_bytes ceiling of 16384", while the integrate floor step `bun run check:memory-files` (`lore context refresh --check`) exits 0 printing "every target is already refreshed and within its ceiling". So a branch that pushes a module memory file past its ceiling lands, and the violation is found only afterwards by a turn-end review.

End state: one ceiling verdict, computed once (runMemoryFileChecks is meant to be the sole composition entry), consumed by both status and the floor step; the floor refuses a module file past max_bytes.

AC: on a throwaway repo whose module CLAUDE.md exceeds max_bytes by 1 byte, `lore context refresh --check` exits exactly 1 naming the file and 'max_bytes', and `lore status --check-claude-md` reports the same finding.
