---
id: SPEC-236
type: spec
role: spec
title: "A plan's progress is updated in the same write as its tasks; acceptance is a batched milestone review"
status: approved
priority: high
created: 2026-10-23
updated: 2026-10-25
tags: []
---
# A plan's progress is updated in the same write as its tasks; acceptance is a batched milestone review

## Overview/Goal

On 2026-10-23, 21 of 35 active plans had every task finished but were still "active". The plan's state was changed only by a separate manual step, and no session took it. Task state stays accurate because every task transition goes through the write path that sessions always use.

Owner's direction (2026-10-23): keep the plan's state stored, and every time a task's state is evaluated or changed, also evaluate its plan's state. This is cheap, deterministic program logic with no AI involved.

References:
- **Rails `counter_cache`, and denormalized aggregate columns maintained in the same transaction as the child row.** The parent's summary is written together with the child change, so the two cannot disagree.
- **GitHub merge queue.** One batched check run for many queued items, used for the AI review.

## Scope

### Plan progress, written with the task transition
- Every task or phase status transition goes through the single write path (CorpusService.set / workflow verbs / bulk). In the same store transaction, that write recomputes the parent plan's progress from the plan's current task rows and writes it.
- The progress is stored as `extra.progress = {state: in-progress | complete | empty, open: <n>, total: <n>, at}`.
- The recompute reads the task rows inside the transaction. Two tasks finishing concurrently therefore end with the count of the committed rows, and the plan write uses CAS like every other write. A transaction that fails rolls back both.
- **Backfill.** The migration that adds the field computes progress for every existing plan in the same change, so no plan ever lacks it and no reader handles a missing value. Import and every other task mutation go through the same write path, so there is no standing repair command.
- **empty** means the plan has no task and no phase. An empty plan is never reviewed or archived by this path. Bootstrap counts it as empty.
- `lore get`, `lore list`, `lore ready`, `lore bootstrap`, MCP and HTTP read the stored progress. Bootstrap lists only in-progress plans by name, and summarises the rest in exactly one line: `complete N (awaiting review M, awaiting owner K, oldest <age>)`.

### Acceptance (batched AI review, after landing)
- A complete plan needs review when its latest milestone review does not match its current fingerprint. The fingerprint is the SHA-256 of four inputs: the plan's id and version, the sorted list of its task (and phase) ids with their versions, the main commit that last landed one of its tasks, and the sorted list of its governing spec's live (not superseded) AC ids with their content hashes. No other input changes it, so restoring or retiring an AC changes it.
- Archived is terminal for a plan and its tasks. The write path refuses, with exit 4 and VALIDATION_ERROR, both creating a task or phase under an archived plan and moving an archived task to any other status, on every surface including import. Further work in that area is a new task in a new plan.
- `lore integrate`, after a landing, reads the stored progress and computes the trigger set: every complete plan that needs review, plus every awaiting-owner plan whose owner decision has been resolved. If that set is non-empty and no review batch holds the lease, it starts `lore assess --where needs-review --file-issues --close` detached from the shared checkout (the only place corpus writes are accepted), and returns. The batch runs its full suite and AC re-verification in a throwaway worktree of main, never in the shared checkout. The landing time includes no review.
- **The batch:**
  - a passing review archives the plan as **accepted**;
  - a failing review archives the plan as **accepted with known defects** (BR-1372), after its failed findings are filed **by root cause, not per plan and dimension**. Reference: Sentry error grouping by fingerprint.
    - Every failed finding gets a root-cause fingerprint, from its dimension plus a normalised cause:
      - regression: the sorted set of failing test files;
      - snapshot accuracy: the sorted set of contradicted rule ids;
      - other dimensions: the sorted structured cites the judge named for the finding (AC ids, rule ids, file paths, symbols), never its wording; a failed finding with no cite is a review error, retried.
    - A known defect is linked to its plan with its own link type (`known-defect`), never `resolves`, so archiving the plan never closes it.
    - The batch files **one** issue per fingerprint, carrying the fingerprint in its body, and links it to every plan that shares it.
    - Before filing, it searches the open issues for that fingerprint. A match is linked, never duplicated.
    - A failing full suite on main is one fingerprint, "main red: <files>", linked to each plan it is attributed to.
    - The same fingerprint therefore never opens a second issue while one is open, however many plans or batches hit it.
    - `lore assess --file-issues` uses the same grouping.
  - retired ACs produce one pending owner decision (adr-an-acceptance-criterion-retires-with-the-feature-it). The detached batch only creates it, because it has no session to ask. The next session's start shows pending owner decisions, and that agent asks them in-session (BR-1374, BR-1375).
  - While it waits, the plan is **awaiting owner**: complete, not archived, counted as awaiting owner in bootstrap's complete line, and not counted as an anomaly. After the owner accepts, the next batch archives it without a new review, provided its fingerprint is unchanged. If the fingerprint changed while it waited, the plan needs review again. The owner's decision is bound to the exact list of retired ACs, so an unchanged list is not asked again and a changed list is a new question. After the owner rejects, the listed ACs are restored (adr-an-acceptance-criterion-retires-with-the-feature-it), the plan's acceptance returns to needs review, and the next batch reviews it with the restored ACs in force.
- **Lease.** The batch holds a store lease with a 10-minute expiry and renews it every minute. A second start that sees a live lease does nothing. A dead holder's lease expires, and the next landing starts a new batch. Each plan is reviewed at most once per fingerprint.
- **Error.** A review error leaves the plan complete and not archived. The errored row is recorded, but it is not a review, so it does not count toward once-per-fingerprint, and the next batch reviews the plan again. A filing error after a valid verdict keeps the verdict and retries only the filing in the next batch. The error shows in bootstrap's complete summary and in `lore checks stats`.

### When the batch runs
- A batch starts after a landing, or by hand with `lore assess --where needs-review --file-issues --close`. Where no landing happens, a complete plan waits for the next landing or a manual run. This is accepted behaviour. The wait is visible in bootstrap's oldest age and in the >24 h anomaly.

### Self-measurement
- `lore checks stats` reports each plan's time from complete to accepted. A plan that has stayed complete, not accepted and not waiting on an unresolved owner decision for more than 24 h is listed as an anomaly with its last error. Only a plan whose owner decision is still unresolved is exempt.

### Out of scope
- Abandoning a plan stays `lore bulk deprecate`.
- In-progress plans are never reviewed by this path.

## Acceptance Criteria

AC-PCR-1..6 (`lore ac add`):
- AC-PCR-1: every task or phase transition path updates the plan's progress in the same transaction. A concurrent finish of two tasks ends with the correct count, and a failed transaction leaves both unchanged. Adding or reopening a task under an archived plan is refused with exit 4.
- AC-PCR-2: the migration backfills every plan. Import and every task mutation use the write path, and no recompute command exists.
- AC-PCR-3: integrate computes the trigger set, meaning complete plans needing review plus awaiting-owner plans with a resolved decision. It starts one detached batch when that set is non-empty and no lease is live. The landing has no review time.
- AC-PCR-4: in the batch, pass → accepted and archived; fail → one issue per failed dimension, linked, accepted with known defects and archived; retired ACs → one owner decision, archived after acceptance.
- AC-PCR-5: the lease renews and an expired lease is taken over. A review error is not a review, so the next batch reviews the plan again. A filing error keeps the verdict and retries only the filing. Each plan is reviewed once per fingerprint. An owner rejection restores the ACs and the plan needs review again.
- AC-PCR-6: bootstrap names only in-progress plans and prints `complete N (awaiting review M, awaiting owner K, oldest <age>)`. `lore checks stats` lists the time from complete to accepted per plan, and lists a plan complete, not accepted and not awaiting owner for more than 24 h as an anomaly with its last error.


## Acceptance Criteria (structured)

- [⚑] [script] AC-PCR-1: PROGRESS WRITTEN WITH THE TASK. lore done, lore bulk done|archive|deprecate, lore set --status and the phase workflow each update the parent plan's extra.progress {state, open, total, at} in the same transaction; two tasks finishing concurrently end with open=0 and state complete; a transaction failing after the task write leaves task and plan unchanged; creating a task under an archived plan, or moving an archived task to another status, is refused with exit 4 on every surface including import.
  script: test — bun run test:file packages/lore/tests/integration/plan-progress.test.ts -t 'progress written with the task' && echo 'AC-PCR-1 PASS'
  other_command=1
- [⚑] [script] AC-PCR-2: BACKFILL, NO REPAIR PATH. The migration adding extra.progress computes it for every existing plan (fixture: 3 plans of mixed task states → correct state, open, total for each); after migration no plan lacks progress; lore import and every task mutation path update progress through the write path; no standing recompute command exists.
  script: test — bun run test:file packages/lore/tests/integration/plan-progress.test.ts -t 'batch recompute' && echo 'AC-PCR-2 PASS'
- [⚑] [script] AC-PCR-3: LANDING STARTS THE REVIEW WITHOUT WAITING. lore integrate that lands a branch computes the trigger set (complete plans needing review, plus awaiting-owner plans whose owner decision is resolved) and, when it is non-empty and no lease is live, starts exactly one detached batch in a throwaway main worktree and returns; its phase table has no review time; an empty set or a live lease starts nothing.
  script: test — bun run test:file packages/lore/tests/integration/plan-progress.test.ts -t 'landing starts the review' && echo 'AC-PCR-3 PASS'
  other_command=1
- [⚑] [script] AC-PCR-4: BATCH OUTCOMES, ISSUES BY ROOT CAUSE. With a fake judge, suite and issue port: a passing plan is archived as accepted; two failing plans whose regression finding has the same failing-file set produce ONE issue (fingerprint in its body) linked to both, and both are archived as accepted with known defects; a second batch hitting the same fingerprint while the issue is open links it and files nothing; a plan with retired ACs gets one owner decision and is archived only after acceptance; the suite runs once per batch.
  script: test — bun run test:file packages/lore/tests/integration/plan-progress.test.ts -t 'batch outcomes' && echo 'AC-PCR-4 PASS'
  other_command=3
- [⚑] [script] AC-PCR-5: LEASE, RETRY, OWNER REJECT. The batch renews its lease while running; a start after expiry takes over; an injected review error records an errored row that is not a review, and the next batch reviews the plan again; an injected filing error keeps the verdict and the next batch retries only the filing; a plan is reviewed at most once per fingerprint; an owner rejection of retired ACs restores them and the plan needs review again.
  script: test — bun run test:file packages/lore/tests/integration/plan-progress.test.ts -t 'lease and retry' && echo 'AC-PCR-5 PASS'
  other_command=1
- [⚑] [script] AC-PCR-6: VISIBLE AND MEASURED. lore bootstrap names only in-progress plans and prints exactly one line 'complete N (awaiting review M, awaiting owner K, oldest <age>)'; lore checks stats lists time from complete to accepted per plan and lists a plan complete and not accepted for more than 24 h as an anomaly with its last error, unless its owner decision is still unresolved.
  script: test — bun run test:file packages/lore/tests/integration/plan-progress.test.ts -t 'visible and measured' && echo 'AC-PCR-6 PASS'
  other_command=1
