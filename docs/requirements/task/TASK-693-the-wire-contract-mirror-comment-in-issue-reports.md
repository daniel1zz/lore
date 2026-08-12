---
id: TASK-693
type: task
role: plan
title: "The wire-contract mirror comment in issue-reports-routes.ts describes a gap that AC-DC-12 already closed"
status: draft
priority: medium
created: 2026-08-12
updated: 2026-08-12
tags: []
parent: PRD-001
---
Machine-verified 2026-08-12 by the main orchestrator, after lore assess flagged it and the path check confirmed it (assess findings that name a path are decidable, so this one was checked rather than scored on trust).

packages/lore/src/adapters/http/issue-reports-routes.ts:85-101 still reads: '⛔ WIRE-CONTRACT MIRROR, currently STALE ... the dashboard cannot import that type (it depends on @lore/core only), so it MIRRORS the union by hand at packages/dashboard/src/lib/api.ts ... Those three sites do NOT yet know the two new members ... Nothing type-checks that mirror (it is a hand copy across a network boundary), so the drift is invisible to bun run typecheck.'

All three claims are now FALSE. AC-DC-12 landed the fix: packages/dashboard/src/lib/api.ts:57,64-65 imports IssueResolution and ISSUE_RESOLUTION_MEMBERS from @lore/core, its own header (api.ts:11) states 'reference-identical -- this module constructs no list', and packages/dashboard/tests/unit/issue-resolution-union-parity.test.ts pins the widening to a compile error inside both badge switches.

⛔ This is the exact failure mode the repo already records: a comment that honestly documented a gap becomes a FALSE assertion the moment the gap is fixed, and it survived because it sat outside the fixing task's declared anchors -- so its implementer could only flag it. The fix is to rewrite the comment to name what is now true in grep-checkable form (the @lore/core import site and the parity test), never to write 'fixed'. The anchor above is the file that must change.
