---
id: KN-656
type: knowledge
role: knowledge
title: "Pilot v2 frozen probe set (10 questions) for the specification-branch blind reader"
status: archived
priority: medium
created: 2026-10-08
updated: 2026-10-23
tags: []
parent: PLAN-173
---
Frozen pilot probe set v2 (10 boundary questions), domain: specification and acceptance. Disjoint from v1 topics. Each answer verified by code reading and/or CLI run against a throwaway corpus. Do not edit after creation.

Provenance: authored by an independent agent (session 6b85319e, task V0a of plan-baseline-pilot-v2-migration-method-v2-on-the-specification) that read no baseline, pilot or probe document; recorded verbatim by agent:main-orchestrator. At recording time the newest baseline document write was 2026-10-07T14:33:27.621Z (v1 pilot); no v2 leaf revision exists yet. Throwaway corpus used: /private/tmp/claude-501/probe2.id13 (never this repo's corpus).

## Questions

1. In a project created with only the basic "initialize" step (no extra project setup), a feature spec's only acceptance criterion is human-verified. Can that spec be moved straight to approved by setting its status, or is it refused for lacking an automated test criterion?
2. In a project that does use the recommended per-spec-kind verification floors, a feature spec has a human-verified criterion plus one script criterion whose oracle is the type checker. Can it be approved? If not, what is the smallest addition that makes approval succeed?
3. A spec's acceptance criteria are all human-verified. A task under its plan was created without saying which criteria it claims. What happens when the trusted verification runner is run for that task: success with a "nothing to run" notice, or a refusal? What changes if the task had declared that human criterion as its scope?
4. A script acceptance criterion's command names a program that is not installed. When the trusted verification runner runs it, does the run abort without recording anything, or does it record a result for that criterion? If it records one, what result is it and what exit code is shown?
5. A task has exactly one passing evidence row. That row was recorded by the general "record evidence" action in its "run the command yourself and capture the output" mode. The command was an arbitrary one, not any of the spec's acceptance criteria. Can the task be archived as done, or does archival insist on evidence from the trusted verification runner?
6. A task declares a single human-verified criterion as its scope. It holds a captured passing evidence row and no failing or expected-to-fail rows. Can it be archived as done straight away? If not, what lets it through?
7. A spec has been moved approved → active → archived. Is adding, rewriting or removing one of its acceptance criteria accepted or refused? What status and version does the spec have afterwards? Can its status be moved back to draft?
8. An existing script acceptance criterion has no falsifier. Can a full falsifier (all four parts) be attached to it in place with the revise-criterion action, or must the criterion be removed and re-added?
9. A spec has at least one script acceptance criterion. Is creating a task under its plan without stating which criteria the task claims accepted? Is an explicit "claims nothing" (empty) declaration accepted? What if the spec had only human or AI criteria?
10. A criterion cites a rule id that exists nowhere in the corpus. Is the citation refused, or stored? Then, with that one citation stored, someone adds ten more well-formed rule ids to the same criterion in one action. Is that accepted? And is a citation written with a leading zero (for example "BR-01") accepted?

## Answers and evidence

### 1 (PROSE-vs-CODE discriminator)
**Answer:** Approval is allowed (exit 0, status approved). A plain initialize writes a config with no verification floors, so the oracle-coverage check passes vacuously. The only check left is "at least 1 AC", which one human AC satisfies.
- Code: `packages/lore/src/adapters/cli/commands/init.ts:4-22`: the verification-profile template is "DELIBERATELY NOT seeded here". Seeding only happens in the separate project-setup step.
- Code: `packages/core/src/verification-profile.ts:146`: `return config?.workflow?.verification_profiles?.[specKind] ?? null;` A null profile means a vacuous pass.
- Code: `packages/lore/src/service/checkpoint-registry.ts:917-927` (`checkSpecPromote`): the base floor is `acCountMeetsFloor` (default 1), plus `oracleCoverage`, which is vacuous with no profile. `corpus-service.ts:2383-2430` runs spec-promote on a `set --status approved`.
- CLI: after `lore init`, `.lore/config.yaml` contains only `project: {name, author}`. `lore ac add spec-s AC-H-1 --statement 'Operator sees exactly 3 rows' --mode human` gave exit 0. `lore set spec-s --status approved` gave exit 0 ("Updated spec-s → v3"), and `get --json` shows `"status": "approved"`.
- Conflicting prose: `assets/project/lore-config-template.yaml:6-7` says "Seeded verbatim into a freshly-scaffolded corpus's `.lore/config.yaml` by `lore init` / `lore setup --project`".

### 2
**Answer:** It is refused (exit 4, `ORACLE_COVERAGE_INSUFFICIENT`, missing oracle "test"). A type-checker criterion does not count, and neither does a human one. The smallest fix is to add one script criterion whose oracle is `test`. After that, approval succeeds.
- Code: `packages/core/src/verification-profile.ts:186-198`: an oracle counts as covered only when `verify.mode === "script"` and its `verify.oracle` equals the required kind.
- Code: `assets/project/lore-config-template.yaml:35-37`: `feature: required_oracles: [test]`. Lines 11-15 say ai/human criteria never satisfy a floor.
- CLI (template `workflow:` block appended to the throwaway config): human AC only, then `set spec-s2 --status approved` gave exit 4 with "missing oracle "test"". After adding `AC-T-1 --mode script --oracle tsc --command true`, it still gave exit 4 with the same message. After adding `AC-T-2 --mode script --oracle test --command true`, it gave exit 0 ("Updated spec-s2 → v5").

### 3 (PROSE-vs-CODE discriminator)
**Answer:** With no declared scope, the runner refuses (exit 4, field `ac_scope`). The message is "has no declared ac_scope, so lore verify cannot know which acceptance criteria it claims". It is not an exit-0 "nothing to run". With the human criterion declared as the task's scope, the run exits 0 and prints "No script-mode acceptance criteria to run (all declared ACs are ai/human-mode)" plus "Skipped (non-script): AC-H-1 (human)".
- Code: `packages/lore/src/service/verify-runner-service.ts:146-149`: "A run that would select ZERO criteria is a refusal, never an exit-0 no-op: an absent scope … fail loud. A `skipped`-only outcome … stays a success." The refusal is raised at lines 905-915.
- Code: `packages/lore/src/adapters/cli/commands/verify.ts:698-709`: the notice and "Skipped (non-script)" rendering.
- CLI: `verify plan-pl1 --task task-t1 --allow-new-commands` (no scope) gave exit 4 with the ac_scope refusal. `verify plan-pl1 --task task-t1b ...` (scope AC-H-1) gave exit 0, "0 passed, 0 failed."
- Conflicting prose: `verify.ts:111-114` says "0 = success — every executed script-mode AC passed (or there were none to run, e.g. every declared AC is ai/human-mode; a clear notice prints in that case)". That does not mention that a task without a declared scope is refused.

### 4 (PROSE-vs-CODE discriminator)
**Answer:** The run does not abort. It records a runner-attested fail for that criterion, with exit 127 from the shell. The runner exits 1 and prints "✘ AC-V-1 fail (… exit 127)". The coverage listing then shows "✘(0/1, 1 attested)".
- Code: `packages/lore/src/service/verify-spawn.ts:43-45,232`: every command is spawned as `["sh", "-c", command]`. A missing program is therefore an ordinary non-zero exit from `sh` (127), not a launch failure.
- Code: `verify-runner-service.ts:131-135`: only an executor launch-failure `err` aborts the run.
- CLI: `ac add spec-s3 AC-V-1 --mode script --oracle other --command 'definitely-not-a-cmd-xyz --flag'`, task scoped to AC-V-1, then `verify plan-pl3 --task task-t3 --allow-new-commands` gave exit 1 with "✘ AC-V-1 fail (7ms, exit 127) [new] / 0 passed, 1 failed." Then `ac list spec-s3` showed "✘(0/1, 1 attested) AC-V-1".
- Conflicting prose: `verify.ts:137-140` says "1 = STORE_ERROR (a script command's LAUNCH failed, e.g. ENOENT — the run aborts …)". A not-installed program never reaches that path.

### 5 (PROSE-vs-CODE discriminator)
**Answer:** Yes, the task archives (exit 0, "approved -> active -> archived"). Captured evidence carries an attestation and satisfies the archival floor, even though its command is unrelated to any acceptance criterion. Evidence from the trusted runner is not required.
- Code: `packages/lore/src/adapters/cli/commands/evidence.ts:639-650`: the `--capture` path writes `capture_source: "runner"` plus `capture_attestation`. Per the inline comment, `promoteCapturedAttestation` turns that into the row's `attestation`. The done floor only asks for `result: "pass"` together with an `attestation`.
- CLI: `evidence task-t1 --oracle other --command 'echo "1 passed"' --result pass --capture` gave exit 0 ("[captured in 3ms …]"). `done task-t1` gave exit 0 ("task-t1 archived (v6)"), and `get --json` shows `"status": "archived"` with an `attestation` key present.
- Conflicting prose: `packages/lore/src/adapters/cli/commands/done.ts:17-19` says a self-reported pass is "the ONLY shape any `lore evidence` write can produce". `packages/lore/src/service/task-workflow-service.ts:858` (the user-facing refusal text) says "`lore verify <plan>` — the SOLE issuer of `attestation`".

### 6
**Answer:** No. It is refused (exit 4) by the red-first floor: the task "declares extra.ac_scope (AC-H-1) with no "expected-fail"/"fail" evidence entry and no extra.red_first opt-in". That happens even though a human criterion cannot be run red. Three things let it through: a recorded red run (expected-fail or fail), a red-first opt-in, or the audited "declare no new tests" escape with a non-empty reason. With that escape it archives (exit 0).
- Code: `packages/lore/src/service/task-workflow-service.ts:3040-3060`: the floor is keyed on whether a declared `ac_scope` is present, regardless of the criteria's modes. `done.ts:83-96` documents the `--declare-no-new-tests` escape.
- CLI: `evidence task-t1b … --result pass --capture` gave exit 0. `done task-t1b` gave exit 4 with the message above. `done task-t1b --declare-no-new-tests "human-only scope, nothing to red"` gave exit 0 ("task-t1b archived (v6)").

### 7
**Answer:** All three acceptance-criterion writes are accepted with exit 0. The spec stays `archived`, and each write adds a version (v5 went to v8 after add, revise and remove). Moving its status back to draft is refused (exit 4, "Cannot transition from 'archived' to 'draft'"). So the status is terminal, but the criteria can still change.
- Code: `packages/lore/src/service/ac-service.ts:855-867` (`resolveSpec`) checks only `doc.type === "spec"`, never status. `writeCriteria` (ac-service.ts:946+) writes whatever status it computes.
- Code: `packages/core/src/schemas.ts:961-969`: `resolveStatusAfterContractEdit` changes only `approved` to `draft`, so archived passes through unchanged. `schemas.ts:829`: `archived: new Set([])`, meaning no outbound status edge.
- CLI: on spec-s5 after approved → active → archived: `ac add … AC-R-2` gave exit 0, `ac set … AC-R-1 --statement …` gave exit 0, and `ac rm … AC-R-2` gave exit 0. `get --json` showed `"status": "archived"`, `"version": 8`. `set spec-s5 --status draft` gave exit 4.
- Related prose (for the tester's context, not a direct contradiction): the root CLAUDE.md lifecycle block reads "archived, deprecated → terminal (no outbound edge)". This is filed upstream as TASK-920.

### 8 (PROSE-vs-CODE discriminator)
**Answer:** Yes. The revise action accepts all four falsifier parts in place (exit 0) and stores the full falsifier object. No remove-and-re-add is needed.
- Code: `packages/lore/src/service/ac-service.ts:687-689` allows the falsifier patch on script mode only. Lines 703-724 build the candidate and validate it through the schema. `SetCriterionPatch.falsifier` (ac-service.ts:206-211) replaces the whole object.
- Code: `packages/lore/src/adapters/cli/commands/ac.ts:112-125` says set's `--falsifier-*` "is NOW wired here too".
- CLI: `ac add spec-s6 AC-F-1 --mode script --oracle other --command true` gave exit 0. `ac set spec-s6 AC-F-1 --falsifier-path src/a.ts --falsifier-find MARK --falsifier-replace '' --falsifier-exit-code 3` gave exit 0. `ac list spec-s6 --json` shows `"falsifier": {"path":"src/a.ts","find":"MARK","replace":"","expected_exit_code":3}`.
- Conflicting prose: the same file's header, `ac.ts:29-31`, under `add`, says "NOT (yet) wired onto `ac set` — see this file's own header note on that scope limit."

### 9
**Answer:** Without a scope declaration, creation is refused (exit 4, gate `task-create`, `AC_SCOPE_REQUIRED`), and the message lists the script criteria that may be claimed. An explicit empty declaration is accepted (exit 0). If the spec has only human or AI criteria, no declaration is needed (exit 0).
- Code: `packages/lore/src/service/gate-predicates.ts:385-432` (`acScopeRequiredAtCreate`) passes when there is no spec ancestor, when the spec has fewer than 1 script AC, or when the scope key is present at all (empty included). Otherwise it fails with `AC_SCOPE_REQUIRED`.
- CLI: `create task --title T3 --parent plan-pl3 --plan-id plan-pl3` (spec-s3 has script AC-V-1) gave exit 4 with "Script-mode criteria you may declare via --ac-scope: AC-V-1". With `--ac-scope ""` it gave exit 0 (task-t3e). Under plan-pl1 (spec-s has only human AC-H-1), `create task … --plan-id plan-pl1` with no scope gave exit 0 (task-t1).

### 10
**Answer:** A citation of a nonexistent rule id is stored, not refused: exit 0 with the stderr warning "cited rule BR-999 does not exist in any baseline leaf (dangling) — stored anyway". Adding 10 more ids on top of that one is refused (exit 4, "Array must contain at most 10 element(s)"), because the cap of 10 counts existing citations too. "BR-01" is refused (exit 4, "cites[] must match BR-<n> with n >= 1").
- Code: `packages/core/src/acceptance.ts:180-184,280-285`: `AC_CITES_MAX = 10`, unique, grammar from `baseline.ts:20` `/^BR-[1-9][0-9]*$/`. Existence is not checked in the schema.
- Code: `packages/lore/src/service/ac-service.ts:388-460` (`citeCriterion`) merges the new ids with the existing ones before validation. Warnings are report-only. The CLI warning text is at `ac.ts:861`.
- CLI: `ac cite spec-s6 AC-F-1 BR-999` gave exit 0 plus the warning, and `ac list --json` shows `"cites": ["BR-999"]`. `ac cite spec-s6 AC-F-1 BR-01` gave exit 4. `ac cite spec-s6 AC-F-1 BR-1 … BR-10` gave exit 4 ("at most 10").

## Recorder notes
- Q10 is about the citation feature landed in slice 1; the specification branch has a "cite a baseline rule" leaf, so it is in-domain.
- The probe author flagged that the refusal/archival messages in Q3, Q4, Q5 point agents at paths the code does not enforce; Q5 duplicates the already-recorded `knowledge-lore-evidence-capture-now-clears-the-attested-floor` finding. Not filed again here.
