---
id: TASK-1832
type: task
role: plan
title: "Refresh fails loud on a malformed package file, refuses unused options, and drops the fingerprint-less legacy path"
status: archived
priority: medium
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PLAN-206
plan: PLAN-206
---
Source: review of baseline-refresh-the-managed-part, 2026-10-19 (reject 0.72; earlier reject 0.80 by session c1ffea04). The leaf describes the code accurately; the design_necessity findings are code defects:
1. BR-883 — silent fallback: a missing or malformed package file, or a malformed scripts list, is read as "no scripts" with no message (packages/lore/src/service/context-facts.ts readCommands: `raw === null`, JSON.parse catch, schema failure all return ok({})). BR-1294 already refuses a malformed documented-scripts marker, so the same input class is handled two ways.
2. BR-889 — options that do nothing for `context refresh` (the force option, AI options) are accepted silently.
3. BR-881 — a managed part with no fingerprint at all (written by an older lore version) takes a separate legacy path that replaces it whole.

End state: (1) a malformed package file or scripts list makes the refresh fail naming the file and the parse/schema error (a missing package file in a project with no documented-scripts marker lists none and says so in the section — decide and state which); (2) refresh refuses options it does not use, naming them (exit 4); (3) the fingerprint-less legacy path is removed by a one-time migration of existing memory files (or refused with a named repair), so only one managed-part format is accepted. Restate BR-883/BR-889/BR-881 accordingly, map any new census sites, and re-review + approve the leaf.

AC: red-first tests for each of (1)-(3) asserting the exact exit code and the named file/option/repair; falsifier: today's silent behaviour.
