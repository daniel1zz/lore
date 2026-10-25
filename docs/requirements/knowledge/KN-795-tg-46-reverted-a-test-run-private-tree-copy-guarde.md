---
id: KN-795
type: knowledge
role: knowledge
title: "TG-46 reverted: a test-run private tree copy guarded the shared-checkout invariant; the cause (sessions sharing main's checkout) moves to AU-T15"
status: approved
priority: medium
created: 2026-10-18
updated: 2026-10-18
tags: []
---
TG-46 (task-skill-fix-tg-46-test-file-s-repo-write-check-blames-the) merged b9d0004b: test:file and run-tests executed vitest from a private copy of the tree so a concurrent session's edit could not fail the repo-write guard. Reverted d45029c6 the same day: the false red only exists because several sessions edit, test and merge in ONE shared main checkout; once each session works and integrates from its own worktree (AU-T15, task-skill-design-au-t15-concurrent-sessions-merging-in-one), a run cannot see another session's edits by construction and the copy is pure overhead (~3 s per run, .git linking, report path rewriting). Design-necessity v5 class (a): a guard on an invariant the end state establishes. Lesson: before fixing a concurrency symptom, ask which shared resource makes it possible and whether removing the sharing removes the symptom. Raised by peer session lore-fd.
