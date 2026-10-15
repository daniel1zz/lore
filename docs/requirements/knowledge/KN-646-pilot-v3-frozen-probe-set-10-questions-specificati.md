---
id: KN-646
type: knowledge
role: knowledge
title: "Pilot v3 frozen probe set (10 questions, specification + execution) for the blind reader"
status: draft
priority: medium
created: 2026-10-08
updated: 2026-10-08
tags: []
parent: PLAN-174
---
Frozen pilot probe set v3 (10 boundary questions), domains: specification and execution. Disjoint from v1 and v2 topics. Each answer verified by code reading and/or CLI run against a throwaway corpus. Do not edit after creation.

## Questions

1. A teammate claimed a task more than a day ago and never came back, so the claim is well past the default two-hour expiry. Without any override, a second actor tries (a) to take the claim for themselves, and (b) just to clear the teammate's claim. Which of the two is accepted?
2. In a freshly set-up project that runs its tests with the Bun test runner, the test files use the ordinary test-file naming, not the special Bun-only suffix. An agent records a self-reported passing test result whose command runs the Bun runner on one such file. Is the evidence row accepted? Does the answer change if the agent asks the tool to run and capture the command itself? And what happens when the identical command is declared on a criterion and run by the verification runner?
3. The verification runner has already run and recorded a criterion's command for task A, with approval given. Now, with no prompt and no approval, a verification run starts for task B: same plan, same criterion, same command. What happens? What if task B already holds a self-reported red (expected-fail) evidence row whose command text is exactly the same? What if that row's command differs only by one extra space?
4. Can an existing acceptance criterion's verification method be switched, for example from an automated script check to a human judgment, by revising the criterion in place? What is reported, and how is such a change meant to be done?
5. Acceptance-criterion identifiers: (a) is an identifier written in lowercase accepted? (b) is an identifier already used by another criterion on the same spec accepted? (c) is an identifier already used by a criterion on a different spec accepted?
6. A script criterion declares a falsifier (a source mutation plus the exact exit code the check should then produce), and the declared exit code is 0, meaning the check still passes after the mutation. Is that declaration accepted? If the attested-red run is then performed and the mutated check does exit 0, what gets recorded?
7. Every task in one phase of a plan has been archived. Can that phase now be removed from the plan?
8. A plan's phase is renamed. Afterwards, which phase name do the tasks that were in it show, including tasks that are already archived? And does each affected task's own version history record the change?
9. A task's claim holder has let the lease run past expiry. The holder then records an evidence row on the task. Can another actor now take the claim without an override? What if the evidence row had been recorded by someone other than the holder? Does recording evidence require holding the claim at all?
10. A task has never been reviewed or approved and is still in draft. If every evidence requirement is satisfied (or properly overridden), can the archive ("done") step archive it directly? Which lifecycle steps are written, and what path does the tool report?

## Answers and evidence

### 1 (area: execution) (PROSE-vs-CODE discriminator)
- **Answer:** (a) Accepted. A stale claim can be taken over without stealing. (b) Refused with a claim conflict (exit 5), however old the claim is. Only the holder, or a forced release, can clear a claim. The refusal still tells the user to "wait for the lease to expire", but waiting never makes a non-holder release possible.
- **Code:**
  - packages/lore/src/service/task-workflow-service.ts:2557-2567 — claim checks `isClaimStale` and only conflicts when the claim is fresh, the holder is different, and steal is not set.
  - task-workflow-service.ts:2776-2785 — release checks `isHolder && force` only. There is no staleness check.
  - packages/core/src/task-workflow.ts:834-837 — stale means age > TTL.
  - packages/core/src/config.ts:378 — `claim_ttl_minutes` defaults to 120.
- **CLI:**
  - `lore claim task-one --by alice` → exit 0. Claim `at` was then backdated to 2026-10-07T00:00Z.
  - `lore release task-one --by bob` → exit 5: "is claimed by 'alice' (claimed 1621m ago). Pass --steal (claim) or --force (release) to override, or wait for the lease to expire."
  - `lore claim task-one --by bob` → exit 0, "Claimed task-one by bob (v3)".
- **Conflicting prose:** packages/lore/src/adapters/cli/utils.ts:296-298, the claim-conflict message shared by claim and release: "…or wait for the lease to expire."

### 2 (area: execution) (PROSE-vs-CODE discriminator)
- **Answer:** Refused with exit 4 ("Mixed-runner --command … names vitest run-only file(s)"). The same refusal applies when the tool captures the run itself. The guard treats any plain test file named under a Bun invocation as belonging to a different runner, even though the project has only one runner and no such convention. The identical command declared on a criterion is accepted at declaration, and the verification runner records an attested pass for it.
- **Code:**
  - packages/lore/src/adapters/cli/evidence-precheck.ts:360-373 — `findCrossRunnerTokens`: when the command invokes `bun test`, it returns every token not ending in `.bun.test.ts`.
  - evidence-precheck.ts:418-446 — the refusal.
  - evidence-precheck.ts:222-225 — the guard applies to self-reported test/e2e passes.
  - commands/evidence.ts:568-578 — the guard is wired into the CLI.
- **CLI:**
  - `lore evidence task-one --oracle test --command "bun test tests/a.test.ts" --result pass --output-tail-file run.log` → exit 4 (Mixed-runner).
  - The same call with `--capture` on task-four → exit 4 (Mixed-runner).
  - `lore ac add … --command "bun test tests/a.test.ts"` → exit 0.
  - `lore verify plan-probe-plan --task task-one --allow-new-commands` → exit 0, "✔ AC-P-1 pass … 1 passed".
  - The raw `bun test tests/a.test.ts` → exit 0.
- **Conflicting prose:**
  - evidence-precheck.ts:386-388: the guard "refuses a `--result pass` whose `--command` names test files belonging to two DIFFERENT runners in a single invocation". Here only one file and one runner are named.
  - The refusal text (evidence-precheck.ts:438-439) asserts "This repo splits test files across two runners (root CLAUDE.md …)", which is false for a consumer project.

### 3 (area: execution)
- **Answer:** Task B's run aborts with exit 7 (needs approval) and records nothing. Approval is remembered per task, as "this exact command string appears in the target task's own evidence history". Approval given on task A does not carry over. Any earlier row on task B with the exact same command text counts as approval, including a self-reported expected-fail row, and then the run executes and records an attested pass (exit 0). A one-space difference counts as a new command, so exit 7 again.
- **Code:**
  - packages/core/src/task-workflow.ts:1046-1048 — `isApprovedVerifyCommand` is `extractEvidence(task).some(e => e.command === command)`. Any row counts, compared byte-exact (invariant at :1028-1031).
  - packages/lore/src/service/verify-runner-service.ts:1069-1092 — the run aborts with NEEDS_APPROVAL.
  - commands/verify.ts:141 — NEEDS_APPROVAL maps to exit 7.
- **CLI:**
  - Task-one verify without the approval flag → exit 7; with `--allow-new-commands` → exit 0.
  - Task-two verify without the flag → exit 7, "command is new/changed and was not approved. 0 AC(s) already recorded".
  - Task-three after a self-reported `--result expected-fail` row with the exact command → verify without the flag exits 0, "✔ AC-P-1 pass".
  - Task-four with an expected-fail row on `"bun test  tests/a.test.ts"` (two spaces) → verify exit 7.

### 4 (area: specification)
- **Answer:** No. Asking to change the mode is a usage error (exit 2). The message says the mode reinterprets historical evidence and points to forced withdrawal followed by re-declaring with the new mode. Supplying a field that belongs to another mode, such as a rubric on a script criterion or a command on a human criterion, is refused with exit 4, naming the criterion's actual mode. The spec is not changed.
- **Code:**
  - packages/lore/src/service/ac-service.ts:678-693 — the mode-mismatch guard.
  - ac-service.ts:1259-1267 — `modeMismatchError`.
  - The CLI `--mode` refusal is described in commands/ac.ts:93-97 ("`--mode` exits 2 naming the rm+add path").
- **CLI:**
  - `lore ac set spec-probe-spec AC-P-1 --mode human` → exit 2: "--mode cannot be changed via `lore ac set` … Use `lore ac rm --force <spec> <id>` then `lore ac add <spec> <id> --mode <new-mode>`".
  - `… AC-P-1 --rubric "judge it"` → exit 4: "--rubric only applies to a "ai"-mode criterion — "AC-P-1" is mode "script"".
  - `… AC-P-2 --command …` → exit 4, naming mode "human".

### 5 (area: specification)
- **Answer:** (a) Refused, exit 4. Ids must be uppercase `AC-<SEGMENT>(-<SEGMENT>)*`. (b) Refused, exit 4: "acceptance_criteria[].id must be unique". (c) Accepted, exit 0. Uniqueness is enforced only within one spec.
- **Code:**
  - packages/core/src/acceptance.ts:205-208 — the id regex `/^AC-[A-Z0-9]+(-[A-Z0-9]+)*$/`.
  - acceptance.ts:298-314 — uniqueness via `superRefine` over a single spec's array, plus the cap of 50.
  - ac-service.ts:325-336 — the whole array is parsed per spec only.
- **CLI:**
  - `ac add spec-probe-spec ac-p-9 …` → exit 4 (grammar).
  - `ac add spec-probe-spec AC-P-1 …` (already declared) → exit 4 (unique).
  - `ac add spec-probe-spec-two AC-P-1 …` → exit 0, "Added acceptance criterion "AC-P-1" to spec spec-probe-spec-two".

### 6 (area: specification) (PROSE-vs-CODE discriminator)
- **Answer:** Accepted. Any integer is accepted as the declared exit code, including 0 and negative values. The attested-red run compares only "observed == declared", so it records a runner-issued `result: expected-fail` row whose attestation says `exit_code: 0`. In other words, it records an "attested red" for a check that actually passed.
- **Code:**
  - packages/core/src/acceptance.ts:167-172 — `expected_exit_code: z.number().int()`. There is no non-zero constraint.
  - packages/lore/src/service/verify-runner-service.ts:1965 — `matched = !timedOut && exitCode === falsifier.expected_exit_code`.
  - verify-runner-service.ts:2002-2025 — on a match, it records `result: "expected-fail"`, `capture_source: "runner"` with an attestation.
- **CLI:**
  - `ac add spec-probe-spec-two AC-F-0 … --falsifier-path src/a.ts --falsifier-find "x=1" --falsifier-replace "x=2" --falsifier-exit-code 0` → exit 0. With `--falsifier-exit-code -3` → also exit 0.
  - `lore verify plan-probe-plan-two --task task-fals-task --falsify AC-F-0 --allow-new-commands` → exit 0: "Attested red recorded for AC-F-0 … exit 0 (declared 0) — result:expected-fail, capture_source:runner".
  - Stored row: `{'result': 'expected-fail', 'capture_source': 'runner', 'attestation': {'exit_code': 0, …}}`.
- **Conflicting prose:**
  - packages/lore/src/adapters/cli/commands/ac.ts:21-24: a falsifier is "a named source-file mutation this AC's author asserts will make `--command` fail with EXACTLY the given exit code".
  - Root CLAUDE.md North Star: "What is the smallest mutation that turns this oracle red? … `lore ac add --falsifier-*` makes that machine-checkable."

### 7 (area: execution)
- **Answer:** No. Removal is refused (exit 4), because archived tasks still count as referencing the phase: "Cannot remove phase "P2" — 1 task(s) still reference it: … Clear or move them first."
- **Code:**
  - packages/lore/src/service/phase-service.ts:216-227 — the guard.
  - phase-service.ts:401-410 — `findTasksByPhase` filters only on plan membership and phase name, not on status.
- **CLI:**
  - Created a P2 task, then `lore done task-phase-two-task --override-attestation … --declare-no-new-tests …` → exit 0, archived.
  - `lore phase rm plan-probe-plan P2` → exit 4, naming the archived task.

### 8 (area: execution) (PROSE-vs-CODE discriminator)
- **Answer:** Every plan task that was in the phase, archived ones included, now shows the new name. The plan logs one version row ("Phase renamed …"), but no affected task gets a version row: each task's phase is overwritten in place and its version number stays the same.
- **Code:**
  - packages/lore/src/service/phase-service.ts:318-331 — tasks are rewritten with a bare `this.store.update(task.id, { extra: {...task.extra, phase} })`. There is no version or audit row and no status filter.
  - phase-service.ts:310-315 — only the plan write goes through `writePhases`, which writes version + audit.
- **CLI:**
  - Archived `task-phase-two-task` at v4 with phase P2 → `lore phase rename plan-probe-plan P2 P2b` → exit 0. The row is now `archived|4|P2b`.
  - The plan log shows v5 "Phase renamed — "P2" → "P2b"".
  - Live `task-three` was `3|P1`; after `phase rename … P1 P1b` it is `3|P1b`, and its `lore log` still tops out at v3 ("Evidence added").
  - Control: a normal edit of the same archived task (`lore set --title`) did log v5.
- **Conflicting prose:** phase-service.ts:11-13: the phase writers "each LOG exactly one version row, so a phase-set mutation is visible in `lore log`/`lore diff`".

### 9 (area: execution)
- **Answer:** No. Evidence recorded by the holder renews the lease, even an expired one, so another actor's claim is refused (exit 5, "claimed 0m ago"). Evidence recorded by a non-holder does not renew it, so the takeover is accepted. Recording evidence never requires holding a claim, and it never creates one.
- **Code:**
  - packages/core/src/task-workflow.ts:841-885 — `renewClaimForEvidence`: renews on `claim.by === actor` whether the claim is fresh or stale. A foreign or absent claim is left untouched, so evidence never acquires a claim.
  - packages/lore/src/service/task-workflow-service.ts:2417 — called from the evidence-append write.
- **CLI:**
  - Alice claims task-two, `at` is backdated, then alice records an expected-fail → exit 0. `claim.at` is now 2026-10-08T03:04:31Z. `lore claim task-two --by bob` → exit 5.
  - `at` is backdated again, then carol (non-holder) records evidence → exit 0. `claim.at` stays at 2026-10-07T00:00Z. Bob's claim → exit 0.
  - Alice recorded evidence on unclaimed task-three → exit 0.

### 10 (area: execution) (PROSE-vs-CODE discriminator)
- **Answer:** Yes. The done step itself writes the approval: draft → approved → active → archived, three separate version rows (v2, v3, v4). The tool's report, however, prints "approved -> active -> archived" and leaves out the starting draft status.
- **Code:**
  - packages/lore/src/service/task-workflow-service.ts:1233-1246 — `computeArchiveWalk("draft")` returns `["approved","active","archived"]`.
  - task-workflow-service.ts:3094-3120 — one write per step.
  - packages/lore/src/adapters/cli/done-render.ts:41-42 — prints `transitions.join(" -> ")`, which lists destinations only.
- **CLI:**
  - New task, status `draft` → `lore done task-phase-two-task --override-attestation "…" --declare-no-new-tests "…"` → exit 0: "task-phase-two-task archived (v4): approved -> active -> archived".
  - `lore log` shows v2 "lore done: draft → approved", v3 "approved → active", v4 "active → archived".
- **Conflicting prose:**
  - .claude/rules/lore-corpus-workflow-execute.md:13 and the shipped assets/context/corpus-workflow-3-execute.md:18: "`lore done <task>` is the sole command that walks `approved → active → archived`".
  - done-render.ts:33 says the output is "`<status> -> <status> -> … -> archived` listing", but the starting status is never printed.


## Recorder notes
- Recorded verbatim by agent:main-orchestrator (task W0a). At recording time the baseline holds 10 documents, none in the execution branch.
- ADR Q2 area per question (author-labelled, checked by the orchestrator against the placement ADR): execution 1,2,3,7,8,9,10; specification 4,5,6. All ten are within the two branches pilot v3 populates.
- The author flagged 4 suspected defects (Q1 refusal text, Q2 single-runner refusal, Q6 exit-0 falsifier, Q8 untracked phase rename); filed separately via lore report-issue.
