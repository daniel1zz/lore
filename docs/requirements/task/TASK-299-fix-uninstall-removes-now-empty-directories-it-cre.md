---
id: TASK-299
type: task
role: plan
title: "FIX: uninstall removes now-empty directories it created (AC-046-F finding)"
status: archived
priority: medium
phase: "cli-adapter"
created: 2026-07-16
updated: 2026-07-16
tags: []
parent: PLAN-033
plan: PLAN-033
---
AC-046-F sandbox smoke finding (2026-07-16): after uninstall, files + manifest are fully removed but 10 empty directory skeletons remain (agents/, hooks/, governance/, skills/**). The reversibility promise ('returns dir to pre-install state') requires removing now-empty directories the install created. Fix: at the end of SetupService.uninstall, walk each removed entry's parent directory chain (up to but excluding targetDir), rmdir any directory that is now empty — only ever removing dirs that are empty (never force). Needs SetupFsWriter surface check: if the port lacks a rmdir/removeDir capability, extend it + fakes + real impl. Oracle: setup-service.test.ts STATE roundtrip test tightened to assert ZERO residual entries (find mindepth 1 == empty) + regression that a PRE-EXISTING user dir (present before install) is NOT removed even when empty.
