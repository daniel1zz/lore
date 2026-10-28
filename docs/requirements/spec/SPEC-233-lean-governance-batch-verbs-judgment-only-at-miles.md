---
id: SPEC-233
type: spec
role: spec
title: "Lean governance: batch verbs, judgment only at milestones, lean context"
status: approved
priority: critical
created: 2026-10-23
updated: 2026-10-27
tags: []
---
# Lean governance: batch verbs, judgment only at milestones, lean context

## Overview/Goal

Implements `adr-ai-decision-standard-four-checks-references-from-excellent`. The end goal is product quality, served by Q1 (the snapshot is valid and accurate) and Q2 (behaviour is auditable, traceable and fed back into self-improvement). The measured inventory `knowledge-inventory-2026-10-23-checks-gates-human-stop-points` shows checks, judge calls, human stop points and context that serve neither. This spec removes them, moves judgment to milestones, makes every N-object operation one batch, and makes every retained check count its catches.

## Scope

### Part A: batch verbs

- **Reference**: Terraform plan/apply (preview by default, per-resource result) and `kubectl apply` (per-object result, optimistic concurrency through resourceVersion).
- `lore bulk <verb> (<id>... | --where <filter>) [--reason <text>] [--apply] [--json]`. Verbs: `archive`, `deprecate`, `close` (plans), `done`.
  - `--where` reuses the `lore list` filters and adds `older-than=<N>d` and `open-tasks=0`.
  - Without `--apply` it prints the plan table and exits 3 when there are candidates, 0 when there are none.
  - With `--apply` each row is one audited write with that row's read version (CAS). A row is OK, SKIPPED or FAILED with a reason. A gated row fails alone, and the batch continues.
  - Exit codes: 0 all OK or SKIPPED, 1 any FAILED, 2 usage error (for example a missing `--reason`), 3 preview with candidates.
  - `--reason` is required for `archive`, `deprecate` and `close`, and it is written to every row's audit entry.
- Lifecycle: `draft → deprecated` becomes a valid transition for every doc type (abandoning a draft). `VALID_TRANSITIONS` stays the only authority.
- MCP: `lore_bulk` with the same contract, plus `lore_done` and `lore_reject`.
- `lore archive --apply` exits 1 when any candidate failed.

### Part B: judgment only at milestones; remove what serves neither Q1 nor Q2

- **Reference**: GitHub merge queue (required checks run once per queued batch) and Nx/Bazel affected builds.
- Integrate floor:
  - The floor command runs `bun install --frozen-lockfile`, build and typecheck. The own-diff judgment is not a floor step: `lore integrate` always runs it itself, before the floor.
  - Two checks caught real defects and catch them in a single branch's diff, so they run at landing, scoped to what the branch changed:
    - `check:baseline-coverage` (17 catches): runs only when the branch changes the command registry, and checks only the commands it adds or renames.
    - `check:ac-oracle-ownership` (7 catches): checks only the test files the branch deletes, renames or edits, and the ACs that name them.


    Each still runs over everything in the plan-close chain.
  - `check:test-budgets` is removed, together with its ledger. It required every spawn-heavy test to declare its own timeout. Instead, the vitest config sets one `testTimeout` (30 s) for the integration and e2e projects, so a slow-under-load test is no longer a false failure (reference: vitest `testTimeout`).
  - Every other `check:*` script runs only in the plan-close chain. The integrate ledger shows those 10 never failed in 156 runs.
  - The floor's step list is declared in one place and printed by `bun run check:floor --list`.
- Approval judge:
  - A review judgment is required for approve only on `spec` and `adr`.
  - `plan`, `task`, `knowledge` and baseline nodes approve without a judge call.
  - The task-level judge and the AC-quantifiability advisory are removed.
- Hooks removed:
  - `stop-handoff-coverage`;
  - the anchor-drift and CLAUDE.md-budget findings of `stop-turn-review` (duplicates of own-diff and `check:memory-files`);
  - the detached `lore setup --check` at SessionStart;
  - the per-edit `post-edit-bindings` hook, whose bound-prose report moves into the integrate own-diff output;
  - the pre-push `--check-claude-md` and prose-pins steps.
- `subagent-context` makes one lore call, not two.
- Reads stop writing one `trace_events` row per `lore get`. A per-day read counter keeps the count, and it is incremented atomically (a single upsert) so that concurrent readers lose no count.
- Autonomy:
  - `worktree-remove` and `stash-drop` decide without a human: a path that regenerates, or a stash archived first, is auto.
  - `report-issue` leaves the human-always set.
  - `override-judgment`, `override-attestation` and `ac-exempt` are decided by the milestone review instead of escalating forever.
  - The human-always set is exactly: `push-force`, `archive-ref-prune`, `governance-loosen`.

### Part C: lean context

- Handoff:
  - `## Changed Files` lists at most 150 files, one line each with the path and the count of runs that touched it. Beyond 150 files, the remaining files are grouped by their top-level directory, one line per directory with a file count. The full list stays in the audit trail.
  - Trail gaps are one summary line per gap kind with a count.
  - The rendered body is not stored a second time in `extra`.
  - A handoff body is at most 16 KB.
- `lore --help` lines are no wider than the terminal width (`COLUMNS`, or 100 when it is not a terminal), and no line is padded. An unknown subcommand prints that command's usage line and a pointer to `--help`, not the full help.
- `lore bootstrap` output is at most 3 KB on this repo:
  - plans with no ready or claimed task are a count;
  - pending reviews are a count;
  - handoffs are this seat's plus the newest 3.
- `lore status` prints counts for list-shaped findings; `--detail` prints the rows.
- `lore list --json` defaults to a limit of 200 rows and reports `truncated: true` with the total.

### Part D: milestone review and self-improvement

- **Reference**: Kayenta automated canary analysis (several metrics, each judged separately against a baseline; promotion is automatic when all pass) and Google's engineering code review guide (dimensions).
- `lore assess <plan>` becomes the binding milestone review.
  - It judges the plan's landed diff and documents on seven dimensions: correctness against ACs, spec conformance, regression, design necessity (with the external reference named for each technical choice), snapshot accuracy, concurrency safety and security.
  - Each dimension carries a verdict (pass, fail or n/a), a reason and a reference.
  - Plan close requires a passing review of the plan's current state, and nothing else. It replaces three plan-close predicates:
    - assessment freshness;
    - the plan-level attestation floor, which is already enforced per task at `lore done`; the review's correctness dimension reads the attested evidence;
    - the cited-rule state check, which the review's snapshot-accuracy dimension reads.

    The UAT requirement stays for plans that opt in with `requires_uat`.
  - Review inputs, measured once per batch:
    - The regression dimension reads the result of one plan-close-chain run, the full suite on main at the reviewed commit. `lore assess` runs that chain once for the whole batch, not once per plan.
    - The snapshot-accuracy dimension fails only on a cited rule that is **stale**, meaning the document and the code disagree. A rule whose state is unknown (no code anchor, a dirty tree at measurement, no recorded commit) is `n/a` with that reason.
  - **Accepted with known defects.** A plan whose review fails can close only when every failed dimension has at least one open issue linked to the plan, filed with the dimension's finding. The close records "accepted with known defects" and the issue numbers. Reference: merging with follow-up issues on GitHub. The owner chose this on 2026-10-23 as the deliberate loosening of the plan-close floor.
  - `lore assess` takes one or more plans, or `--where`, and reviews each one as a separate row with its own verdict (the Part A batch contract).
  - A plan's **current state** is a fingerprint over two things: the plan's version together with every task's id and version, and the main commit that last landed one of its tasks. A review is current when its stored fingerprint equals the fingerprint at close time.
  - Exit codes: a bulk command uses 0/1/2/3 as in Part A. A single-document refusal (a lifecycle transition, approve, plan close) keeps exit 4.
- Every retained gate and hook records one row per run with its outcome (pass, deny or error), keyed by check id. `lore checks stats` prints runs, denials and last denial per check. A check with at least 30 days and at least 50 runs and 0 denials is listed as a removal candidate.
- The 1-in-10 human sampling audit of automatic decisions (autonomy-calibration-service) is removed, together with its queue. In 4 months, 36 items were queued and none was answered. Ground truth for automatic decisions becomes the escaped-defect and rework measure below, and observed reversals keep tightening a class as before.
- Escaped defects: `lore checks stats --quality` prints, per closed plan, the issues filed within 14 days of plan close that cite the plan or its tasks, plus rework (reopened tasks, fix tasks citing the plan).

### Out of scope

- Write-time invariants stay: schema, lifecycle transitions, version CAS, claim and anchor conflict, the `lore done` evidence floors, the git safety gate, the main-ref guard and the audit hash chain.
- The `--where` filter grammar does not grow beyond the `lore list` filters plus the two named above.

### Supersedes

AC-AU-7's escalation of override classes is superseded by Part D. So is AC-AU-8's "loosens only by the human", but only for those three override classes. Loosening a governed threshold (`governance-loosen`) stays human-always. This is recorded with `lore ac supersede` when this spec is approved.

## Acceptance Criteria

AC-LG-1..14 (`lore ac add`). Each script-mode AC runs its own test file with `-t` and prints `<AC-ID> PASS: <fact>`.


## Acceptance Criteria (structured)

- [⚑] [script] AC-LG-1: BATCH PREVIEW THEN APPLY. lore bulk archive|deprecate|close|done takes ids or --where (lore list filters plus older-than=<N>d and open-tasks=0). Without --apply it prints one row per candidate and exits exactly 3 (0 when none). With --apply it writes each row once, prints one table with OK/SKIPPED/FAILED and a reason per row, records --reason on every row's audit entry, and exits 0 when no row failed. --reason missing on archive/deprecate/close exits 2.
  script: test — bun run test:file packages/lore/tests/integration/bulk-lifecycle.test.ts -t 'preview then apply' && echo 'AC-LG-1 PASS: bulk previews with exit 3 and applies with one audited row each'
  other_command=3
- [⚑] [script] AC-LG-2: A ROW FAILS ALONE. In a bulk --apply over 3 documents where one was changed after the preview (version moved) and one is refused by its gate, those two rows are FAILED with STALE_VERSION and the gate's rule name respectively, the third is written, and the command exits exactly 1. No retry and no partial write of a failed row.
  script: test — bun run test:file packages/lore/tests/integration/bulk-lifecycle.test.ts -t 'row fails alone' && echo 'AC-LG-2 PASS: stale and gated rows fail alone, exit 1'
  other_command=1
- [⚑] [script] AC-LG-3: A DRAFT CAN BE ABANDONED. VALID_TRANSITIONS allows draft -> deprecated for every doc type; lore bulk deprecate on a draft plan and a draft task writes deprecated with the reason; archived -> deprecated stays invalid (INVALID_TRANSITION, exit 4).
  script: test — bun run test:file packages/lore/tests/integration/bulk-lifecycle.test.ts -t 'draft can be abandoned' && echo 'AC-LG-3 PASS: draft->deprecated valid for all types, archived->deprecated refused'
  other_command=1
- [⊖] [script] AC-LG-4: MCP PARITY. MCP exposes lore_bulk with the same selector, preview/apply and per-row result as the CLI, plus lore_done and lore_reject; a lore_bulk call and the equivalent CLI call over the same corpus fixture return the same rows. lore archive --apply exits 1 when any candidate failed.
  script: test — bun run test:file packages/lore/tests/integration/bulk-lifecycle.test.ts -t 'mcp parity' && echo 'AC-LG-4 PASS: lore_bulk/lore_done/lore_reject match the CLI'
  other_command=1
- [·] [script] AC-LG-5: LEAN INTEGRATE FLOOR. bun run check:floor --list prints exactly install, build, typecheck, baseline-coverage:changed, ac-oracle-ownership:changed; the plan-close chain lists every check: script including the full baseline-coverage and ac-oracle-ownership; one declaration feeds run-chain.ts and --list; a check: script in package.json in neither list fails the test; check:test-budgets and its ledger no longer exist and the vitest config sets testTimeout 30000 for the integration and e2e projects. A branch adding an undeclared command fails baseline-coverage:changed, a branch deleting an AC's owner test fails ac-oracle-ownership:changed, and a branch touching neither runs each step in under 5 s with exit 0. lore integrate runs the own-diff judgment before the floor command.
  script: test — bun run test:file packages/lore/tests/unit/floor-steps.test.ts -t 'lean floor' && echo 'AC-LG-5 PASS: floor is install/build/typecheck; corpus checks run at plan close'
  other_command=4
- [·] [script] AC-LG-6: JUDGE ONLY SPEC AND ADR. With no review judgment on record, lore approve succeeds (exit 0) for a plan, a task, a knowledge doc and a baseline node, and is refused with exit 4 naming review-judgment for a spec and an ADR. The task-level judge prompt and the AC-quantifiability advisory no longer exist in packages/lore/src/ai.
  script: test — bun run test:file packages/lore/tests/integration/approve-judge-scope.test.ts -t 'judge only spec and adr' && echo 'AC-LG-6 PASS: approve needs a judgment only for spec and adr'
  other_command=2
- [·] [script] AC-LG-7: REMOVED HOOKS STAY REMOVED. assets/hooks contains no stop-handoff-coverage or post-edit-bindings hook and the shipped hook manifest registers neither; stop-turn-review emits no anchor-drift or CLAUDE.md-budget finding; session-start-resume spawns no lore setup --check; subagent-context spawns exactly one lore process; hooks/pre-push runs no --check-claude-md and no prose-pins step; lore integrate's own-diff output lists the prose bound to changed files.
  script: test — bun run test:file packages/lore/tests/unit/hooks-removed.test.ts -t 'removed hooks' && echo 'AC-LG-7 PASS: hooks serving neither Q1 nor Q2 are gone, bindings report moved to integrate'
  other_command=4
- [·] [script] AC-LG-8: HUMAN-ALWAYS IS THREE CLASSES. The class table's human-always set equals {push-force, archive-ref-prune, governance-loosen}; worktree-remove with only regenerable ignored paths and stash-drop of an archived stash return auto with no pending decision; report-issue writes no pending decision; override-judgment/override-attestation/ac-exempt record a decision that the milestone review resolves, never a pending human decision.
  script: test — bun run test:file packages/lore/tests/integration/autonomy-human-set.test.ts -t 'three human classes' && echo 'AC-LG-8 PASS: only three classes wait for a human'
  other_command=2
- [·] [script] AC-LG-9: READS DO NOT WRITE A ROW EACH. 100 lore get calls on a throwaway corpus add 0 rows to trace_events and raise a per-day read counter by exactly 100; lore trace stats still reports the read count.
  script: test — bun run test:file packages/lore/tests/integration/trace-read-counter.test.ts -t 'reads counted not logged' && echo 'AC-LG-9 PASS: reads are counted, not logged per row'
  other_command=3
- [·] [script] AC-LG-10: BOUNDED HANDOFF. A handoff whose session touched 1500 files (realistic repo paths) across 40 runs lists exactly 150 files one per line with path and run count and no run id, groups the other 1350 into one line per top-level directory with a file count, renders trail gaps as one line per gap kind with a count, has a body of at most 16384 bytes, and extra carries no copy of the rendered body.
  script: test — bun run test:file packages/lore/tests/integration/handoff-bounded.test.ts -t 'bounded handoff' && echo 'AC-LG-10 PASS: handoff is one line per file and <=16KB'
  other_command=3
- [·] [script] AC-LG-11: BOUNDED COMMAND OUTPUT. On a fixture with 41 plans (20 idle), 25 handoffs and 500 pending drafts, lore bootstrap prints at most 3072 bytes; with COLUMNS=100 no lore --help line is longer than 100 characters and no line ends in padding spaces; lore <unknown> prints at most 600 bytes; lore status prints counts only and --detail prints the rows; lore list --json returns at most 200 rows with truncated:true and the total.
  script: test — bun run test:file packages/lore/tests/integration/context-bounded.test.ts -t 'bounded output' && echo 'AC-LG-11 PASS: bootstrap/help/status/list are bounded'
  other_command=2
- [⚑] [script] AC-LG-12: MILESTONE REVIEW IS THE ONLY PLAN-CLOSE CHECK. lore assess <plan>... | --where stores per plan a review with the seven dimensions, each with verdict pass|fail|n/a, reason and reference, one row per plan. Closing a plan is refused (exit 4, rule BR-1372) when the latest review is not for the plan's current state or any dimension fails, and succeeds with a passing current review even when the plan has no plan-level attestation exemption and cites a rule whose state is unknown. The assessment-freshness predicate, the plan-level attestation floor, the plan-close cited-rule check, lore plan exempt-assessment-freshness and lore plan exempt-attestation are removed; requires_uat still applies.
  script: test — bun run test:file packages/lore/tests/integration/milestone-review.test.ts -t 'milestone review gates close' && echo 'AC-LG-12 PASS: plan close needs a passing seven-dimension review'
  other_command=13
- [·] [script] AC-LG-13: CHECKS COUNT THEIR CATCHES. Each retained gate and hook appends one outcome row (check id, pass|deny|error, time) per run; lore checks stats prints runs, denials and last denial per check id; a check with >=30 days and >=50 runs and 0 denials is listed under removal candidates and one with a denial is not.
  script: test — bun run test:file packages/lore/tests/integration/check-stats.test.ts -t 'checks count catches' && echo 'AC-LG-13 PASS: every check records outcomes; never-catching checks are listed'
  other_command=3
- [·] [script] AC-LG-14: QUALITY IS MEASURED, NOT SAMPLED. lore checks stats --quality prints per closed plan the count of issues filed within 14 days of its close that cite the plan or one of its tasks, and the count of reopened tasks or fix tasks citing it; an issue filed on day 15 is not counted. No automatic decision writes a human audit item: after 50 auto decisions on a throwaway corpus, lore pending lists 0 audit items, and the sampling-floor code path no longer exists.
  script: test — bun run test:file packages/lore/tests/integration/check-stats.test.ts -t 'escaped defects' && echo 'AC-LG-14 PASS: escaped defects and rework counted per plan'
  other_command=3
