---
id: TASK-713
type: task
role: plan
title: "mirror:export never rewrites an existing file whose rendered content changed, and check:spec-mirror compares only count and slug parity — so every archived task reads 'draft' in the mirror while both commands report OK"
status: draft
priority: medium
created: 2026-08-12
updated: 2026-08-12
tags: []
parent: PRD-001
---
The corpus mirror under docs/requirements/ is silently stale for any document whose CONTENT changed after its file was first written. Both the writer and the checker report success.

Measured 2026-08-12 on two tasks this session archived via 'lore done':

  corpus: task-bind-ownership-a-claim-records-its-branch-commits-carry  -> archived (v21)
  mirror: docs/requirements/task/TASK-708-...md                          -> status: draft

  corpus: task-add-the-two-ownership-read-surfaces-lore-territory-and   -> archived (v12)
  mirror: docs/requirements/task/TASK-710-...md                          -> status: draft

'bun run mirror:export' was run three times between those archivals and the measurement. Every run exited 0 and left 'git status --short docs/requirements' EMPTY. The files are present and were exported originally, so this is not an archived-doc exclusion policy — the export simply does not rewrite a file that already exists.

The second half is what makes it invisible. 'check:spec-mirror' prints its own limitation verbatim: 'OK - every corpus task has a mirror file (count and slug parity; file CONTENT is not compared)'. So the check cannot fail on stale content by construction, and the pre-push gate ('lore status --check-tree --check-drift') does not cover it either.

Net effect: docs/requirements/ is the repo's human-readable, git-diffable projection of the corpus, and every doc that changed after creation reads whatever it said at creation time. A reader diffing the mirror to see what a session did sees nothing, and two independent commands assure them the mirror is complete.

This was previously suspected and recorded as GAP-25 in an earlier session's handoff but not reproduced; this filing supersedes that suspicion with a decisive repro.
