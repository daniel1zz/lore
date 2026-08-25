---
id: TASK-857
type: task
role: plan
title: "The Turso half of the DUPLICATE_SLUG fix has no committed oracle: the anchors circled the SQLite test file only"
status: draft
priority: medium
created: 2026-08-25
updated: 2026-08-25
tags: [anchor-design, oracle-gap, store, turso]
parent: PRD-001
links:
  - {id: TASK-835, type: relates-to}
---
MEASURED 2026-08-25. `task-skill-implement-duplicate-slug-existing-id-names-the` landed (`de24ecbd`, merged `eb59448f`) and fixed `DUPLICATE_SLUG.existing_id` in BOTH SQL stores. Only the SQLite half has a committed regression oracle.

⛔ **This is an ANCHOR-DESIGN gap, not an execution gap, and the author of the anchors was the orchestrator — not the implementer.** The task's anchors listed `packages/lore/tests/unit/store/sqlite-store.bun.test.ts` and both store sources, while the task BODY said the fix spans both SQL stores. `packages/lore/tests/unit/store/turso-store.bun.test.ts` was never anchored, so the implementer could not commit a case there and correctly said so rather than reaching outside its scope. Root CLAUDE.md's own lesson names this shape: the spec's file anchors MUST circle the capability implementation AND the place that proves it, and "四次都不是 implementer 失职，是锚与 AC 的设计漏洞".

## What IS verified, and by what

The implementer measured all four `TursoStore` insert paths returning an `existing_id` that resolves to the winner, via a **throwaway probe in its scratchpad**, plus `turso-store.bun.test.ts` and five other store suites at 149 pass / 0 fail (runner-attested, exit 0). `TursoStore` runs in local `file:` mode with no credentials (`new TursoStore({ localPath })`), so this needed no remote setup.

⛔ So the fix is EXERCISED but has NO PERMANENT ORACLE on the Turso side. The distinction matters: a scratchpad probe proves the behaviour today and refuses nothing tomorrow. A revert of any of Turso's paths would be caught by nothing.

⛔ Remote/replica mode (a real `remote_url` + `LORE_SYNC_TOKEN`) was not exercised AT ALL, by anyone. Do not read the local-`file:` pass as covering it.

## What partially covers the gap already

`sqlite-store.bun.test.ts` carries a SOURCE CENSUS over the whole `src/store` directory: zero `existing_id: doc.id` outside comments, exactly one construction site per store file, exactly 3 total, with a positive control asserting all three files were scanned. That census DOES refuse a reintroduced literal in `turso-store.ts`. ⛔ But it is structural only — it cannot tell whether `TursoStore.findSlugConflictId` returns the WINNER's id or merely that a lookup call exists. Behaviour on the Turso paths is unoracled.

## Scope

- A committed behavioural case in `packages/lore/tests/unit/store/turso-store.bun.test.ts` asserting, for EACH of the four insert paths (`insert`, `insertWithAllocatedOrdinal`, `insertWithProvenance`, `insertWithAllocatedOrdinalAndProvenance`), that the returned `existing_id` RESOLVES to a doc whose slug equals the conflicting slug. ⛔ Assert resolution, not id-shape: the original defect already produced an id-shaped string.
- ⛔ The two transaction-scoped paths read through the still-open `tx` and the other two through `this.client`, deliberately and asymmetrically (see `turso-store.ts`'s own header). A case that only covers one executor kind certifies half the fix. Cover both.
- Decide explicitly whether remote/replica mode gets an oracle or a written exemption. ⛔ An undecided third state is what let this gap exist.

## Falsifier

Revert `TursoStore.findSlugConflictId` to `existing_id: doc.id` at ONE of the four sites. The new case MUST go red naming THAT path. ⛔ Green control in the same run: the other three still pass, so the case discriminates per-path rather than failing wholesale. Smallest mutation that turns the oracle useless: assert only that `existing_id` is a non-empty string — that passes against the original defect.
