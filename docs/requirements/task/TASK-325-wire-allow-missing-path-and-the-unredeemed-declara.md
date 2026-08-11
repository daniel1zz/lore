---
id: TASK-325
type: task
role: plan
title: "Wire --allow-missing-path and the unredeemed-declaration count into the live CLI and MCP surfaces so production can reach the built mechanism"
status: archived
priority: medium
phase: "mechanism"
created: 2026-08-10
updated: 2026-08-10
tags: []
parent: PLAN-079
plan: PLAN-079
---
⛔ The mechanism this task wires is ALREADY BUILT and unit-tested at the service layer
(`AcService.addCriterion`/`setCriterion` `allowMissingPath` + `countUnredeemedAllowMissingPath`,
landed by task-promote-the-oracle-file-existence-primitives-into-lore). What is missing is the LIVE
CALL SITES. The implementer flagged this himself rather than letting it pass silently:

> CLI/MCP wiring is not live yet — `commands/ac.ts` (--allow-missing-path flag) and
> `commands/status.ts` (surfacing countUnredeemedAllowMissingPath in `lore status --json`) are
> outside this task's declared anchors and untouched. A real `lore ac add`/`lore status --json` call
> will not exercise it.

Deliver:

1. `commands/ac.ts` — add the `--allow-missing-path` flag plus its REQUIRED non-empty reason, passing
   a real `fileExists` port and cwd context into `AcService`.
2. `commands/status.ts` — surface `countUnredeemedAllowMissingPath` as a field in
   `lore status --json` (and in the human view, per the surface's own convention).
3. `adapters/mcp/tools.ts` — the same option on the MCP write path if that surface can declare ACs,
   so the three adapters stay gated identically (this repo's rule: gates live in the service layer so
   CLI/MCP/HTTP are gated the same; a flag reachable from only one adapter re-opens the asymmetry).

⛔ AC-OX-10's oracle MUST drive the CLI (subprocess or the command handler), never `AcService`
directly. Asserting the service method exists is precisely the false-green this task exists to close.
⛔ Use a throwaway `mkdtemp` + `lore init` corpus; NEVER write to this repo's own `.lore/`.
⛔ Record the RED by unwiring a call site and observing the failure — a green-only run is not
verification.

Context worth carrying: this is the THIRD instance of "capability implemented ≠ wired into
production" in one session (the others: the e2e tsconfig project's chain membership, and the
plan-close vacuity discriminator's render surface). All three took an attested pass before the gap
was noticed. When writing this task's own oracle, assume that shape is the default failure mode.
