---
id: TASK-688
type: task
role: plan
title: "The adapter matrix: MCP inherits the guard via caller_cwd, and the HTTP exemption is spied not assumed"
status: archived
priority: medium
phase: "guard"
created: 2026-08-12
updated: 2026-08-12
tags: []
parent: PLAN-128
plan: PLAN-128
---
Lands D5's adapter table. MCP derives provenance from its explicit caller_cwd parameter (tools.ts:561 -- the field exists solely because the server's own process.cwd() is frozen at startup) and emits the SAME literal token the CLI does. HTTP has no per-call caller directory (serve.ts:26 resolves the app once at boot; zero process.cwd reads under adapters/http) so it passes null and the predicate is inert -- a NAMED exemption, and AC-CP-5(c) makes it falsifiable with a typed spy asserting the predicate was invoked exactly once with provenance EXACTLY null, since via behaviour alone a null argument is indistinguishable from the predicate never being called. BLOCKED on the guard task.
