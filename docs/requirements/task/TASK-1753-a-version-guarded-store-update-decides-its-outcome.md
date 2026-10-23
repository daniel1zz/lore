---
id: TASK-1753
type: task
role: plan
title: "A version-guarded store update decides its outcome from data, not bun's stale changes count inside a transaction"
status: archived
priority: medium
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PLAN-206
plan: PLAN-206
---
Found 2026-10-19 by the implementer of task-deprecating-a-spec-retires-its-proposed-rule-ids-in-the (measured, not inferred): inside a multi-statement SQLite transaction, bun's statement `.changes` for a zero-row `UPDATE` reports a stale non-zero count (measured 4 for an UPDATE that matched no row). packages/lore/src/store/sqlite-store.ts `updateDocSync` trusts `.changes` to detect a compare-and-swap version miss, so when such an UPDATE follows other writes in the same transaction a version miss is treated as success — a silent lost update. Any version-guarded update that runs after other writes in one transaction is exposed (e.g. moveRule, and the new atomic deprecate-and-retire).

End state: a version-guarded update never relies on `.changes` after other statements in the same transaction; it confirms the outcome from data (re-read the row's version, or use `UPDATE ... RETURNING` and count returned rows), and a miss is a STALE_VERSION refusal. Turso parity: same contract and test. Audit every `.changes` use in the stores and fix all of them.

AC: red-first — a cross-store test (SQLite and Turso) that, inside one transaction, writes another row and then performs a version-guarded update with a wrong version: it must report the miss (STALE_VERSION) and leave the row unchanged; falsifier: today's SQLite path reports success. Plus a grep/test proving no remaining `.changes`-based success decision in the stores.
