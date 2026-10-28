---
id: KN-815
type: knowledge
role: knowledge
title: "Milestone review: Issue-loop baseline follows GitHub-owned issues"
status: approved
priority: medium
created: 2026-10-26
updated: 2026-10-26
tags: []
parent: PLAN-259
links:
  - {id: PLAN-259, type: informs}
---
# Milestone review: PASS

Fingerprint: 86fedacb396c8a9aa2a8d7112cd1a6f2d9e4df5403fd1da510dfa1984588a4d7
Diff: derived from 2 commit(s), excluding 0 merged in from main across the plan's tasks

| Dimension | Verdict | Reason | Reference |
|---|---|---|---|
| correctness_vs_acs | pass | Each of AC-IL-1..10 has a runner-attested pass: AC-IL-1 (new TRANSPORT_UNAVAILABLE test plus the existing 'CLOSED is not recognised/still OPEN' tests), AC-IL-2, AC-IL-3 (existing AC-DC-1/AC-DC-3 tests), AC-IL-4 ('are EQUAL' plus the new unconfigured and retired-form refusals; one attested run failed and a later attested run of the same command passed), AC-IL-5, AC-IL-6, AC-IL-7, AC-IL-8 (new tests plus the existing 'closed on GitHub' test), AC-IL-9 and AC-IL-10. Every new test also has an attested expected-fail (mutation) run, and typecheck passes. The bare -1 case exits 1, not 4. The plan records this explicitly because the argument parser reads -1 as a switch, so it is not a gap in AC-IL-6. There are no milestone decisions awaiting review. | Task task-t1 attested evidence; spec Acceptance Criteria AC-IL-1..10 |
| spec_conformance | pass | The diff contains only tests, one optional test-helper parameter (makeIssueFixture withRootPrd, default unchanged) and the two comment fixes named in scope. The comments are fixed at all four report-issue-wiring.ts sites (the file header, the fileGithubIssue doc steps, its @returns and the retry-branch comment) and at report-issue.ts ~:361. The listing comment now says it matches 'lore issues --all'. There is no production behaviour change, as the spec's Out list requires. AC-IL-5 uses its own describe and fixture as the plan asks. The rule change set and the subtree prose live in the corpus and are not in this code diff. The cited-rule list includes the new BR-1456..1458, which is consistent with the rule apply having run. | Spec Scope/Out; plan T1 file list; landed diff |
| regression | pass | The behaviour at risk is the existing issue filing, listing, adopt and resolve tests in the touched files, and the shared gh-issue-stub fixture. withRootPrd defaults to true, so existing fixtures still create the root PRD. The new tests are added in separate describe blocks. The full-suite run on main (7a426b9) exited non-zero (test exit 5, check:plan-close exit 1), but it attributes no failing file to this plan. An attested pass covers all five touched test files together. | Full-suite run on main 7a426b90; final attested combined test:file run |
| design_necessity | pass | Each choice follows a nameable practice. Every new test was made red by a deliberate mutation and then restored: mutation testing, and red-green from TDD. gh is replaced by a stub binary with a call log: a test double / spy. The PATCH call is forced to fail through fail-patch-<n> files to reach the open-issue-with-archived-work state: fault injection. AC-IL-5 gets its own fixture so the pinned totals stay intact: Meszaros' Fresh Fixture / test isolation. withRootPrd is an opt-out on the fixture builder: the Test Data Builder pattern. Where the earlier spec and the code differ, the baseline follows the code (D1): living documentation. A leaf whose command mode is gone is retired rather than kept (D2): a deprecation policy. | Mutation testing (PIT/Stryker); Meszaros xUnit Test Patterns (Fresh Fixture, Test Spy); fault injection (Chaos Engineering); Test Data Builder (Freeman & Pryce, GOOS); Living Documentation (Martraire) |
| snapshot_accuracy | na | no cited rule is contradicted; not verified: BR-498 (unknown: no-code-anchors), BR-499 (unknown: no-commit-recorded), BR-506 (unknown: no-commit-recorded), BR-509 (unknown: no-commit-recorded), BR-520 (unknown: no-code-anchors), BR-524 (unknown: no-code-anchors), BR-1240 (unknown: dirty), BR-1456 (unknown: no-commit-recorded), BR-1457 (unknown: no-commit-recorded), BR-1458 (unknown: no-commit-recorded) (Every cited rule is in the unknown state: BR-498, BR-520 and BR-524 have no code anchors; BR-499, BR-506, BR-509 and BR-1456..1458 have no recorded commit; BR-1240 is dirty. None is contradicted, so there is nothing measured to fail.) | Cited rule state section |
| concurrency_safety | pass | The change is tests and comments only. Each new fixture builds its own mkdtemp corpus and stub directory and registers it for cleanup. The fail-patch marker files are written and removed inside one fixture's private stub directory, so parallel test files share no state. Production code is unchanged. | Meszaros xUnit Test Patterns: Shared Fixture vs Fresh Fixture isolation |
| security | pass | No production code path changes; the only source edits are comments. The tests use a local gh stub and a placeholder repo, with no real credentials and no network. Untrusted issue bodies (hand-written and damaged field blocks) are tested only as already-accepted inputs. No new privilege or input surface is added. | OWASP ASVS V5 input handling (no new input surface) |
