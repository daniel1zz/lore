---
id: SPEC-232
type: spec
role: spec
title: "Holder addresses hold on every store and a holder row never mixes two main runs"
status: draft
priority: medium
created: 2026-10-23
updated: 2026-10-23
tags: []
links:
  - {id: SPEC-231, type: relates-to}
---
## Overview/Goal

Close the two gaps `lore assess` found on plan-runs-carry-their-messaging-address-holder-listings-show-it (2026-10-20, verdict met 83): (1) the run address write and migration 030 were untested on TursoStore, and TursoStore's open path lacks the schema-version ceiling check SQLiteStore has; (2) deriveSessions groups claims by `by`/machine/worktree/session_id, so two different main runs whose session ids share an 8-character prefix land in one ReadySession row, which then shows one session's message address for the other (BR-1363 violated). Follows spec-runs-carry-their-messaging-address-holder-listings-show-it.

## Scope

In:
- A shared store suite for recordRunAddress run against SQLite, Turso (file mode) and in-memory; TursoStore refuses a corpus above LATEST_SCHEMA_VERSION with the SQLite ceiling error.
- deriveSessions' group key gains the claim's main run id (resolved as in the parent spec: harness_run -> run -> deriveRunId(harness, sessionRef)); a claim with no resolvable run keeps today's key. A main run and its subagents share a main run id, so they stay one row.

Out:
- Changing the `by` actor label format.
- Address liveness.

## Acceptance Criteria

Structured criteria: `lore ac list` on this spec (AC-MAH-1, AC-MAH-2).


## Acceptance Criteria (structured)

- [·] [script] AC-MAH-1: A shared store suite runs recordRunAddress against SQLiteStore, TursoStore (file mode, bun test) and InMemoryStore with identical assertions: store uds:/a, replace with uds:/b, clear to NULL, getRun().messageAddress reflects each step, and an unknown run id returns an error naming it. TursoStore opening a file corpus whose schema version is above LATEST_SCHEMA_VERSION refuses with the same ceiling error SQLiteStore gives.
  script: test — bun run test:file packages/lore/tests/unit/store/turso-store.bun.test.ts packages/lore/tests/unit/store/run-address.shared-suites.bun.test.ts && echo 'AC-MAH-1 PASS: run address writes and the schema ceiling hold identically on SQLite, Turso and in-memory'
