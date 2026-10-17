---
id: SPEC-161
type: spec
role: spec
title: "P0 requirement coverage: falsifying criteria for the 8 uncovered rules"
status: approved
priority: medium
created: 2026-10-10
updated: 2026-10-17
tags: []
---
# P0 requirement coverage: falsifying criteria for the 8 uncovered rules

## Overview/Goal

`lore status --check-requirements` (2026-10-10) reports 8 P0 requirements of the product PRD as UNCOVERED after slice 3a migrated every `R-##` entry to a baseline rule: R-4 → BR-494, R-8 → BR-991, R-11 → BR-994, R-12 → BR-995, R-13 → BR-996, R-19 → BR-613, R-20 → BR-623, R-25 → BR-971. A requirement is covered only when a live script-mode criterion cites its rule. A triage of the existing tests (2026-10-10, two independent read-only agents) found that for 7 of the 8 rules no existing test fails when the rule's main claim is false; only BR-995 is falsified by an existing test (the multi-project isolation e2e).

Goal: every one of the 8 rules is cited by one script-mode criterion whose named tests fail when the rule is false, and `lore status --check-requirements` reports no uncovered P0 requirement.

## Scope

In scope — new test cases only, for the claims the triage found unasserted:

| Rule | Unasserted claims to cover |
|---|---|
| BR-494 | filed body opens with the filing field block, then description, expected, actual and repro command, in that order; the command prints the issue number and address and exits 0 (stub `gh`, offline) |
| BR-613 | a blank / whitespace-only label is refused on BOTH write paths (RuleService.addNode and CorpusService.create) and creates nothing |
| BR-623 | statement > 500 chars refused, 500 accepted; example > 300 chars refused, 300 accepted; confidence / enforcement outside the enums refused; a refused rule burns no registry id |
| BR-971 | non-spec target refused; past or equal-to-now expiry refused; blank grantor refused; cap rounding at 15 live criteria (floor: 1 grant admitted, the 2nd refused); a grant writes no version row |
| BR-991 | zero evidence renders the overall state `none` and a 0 record count beside approve/reject; pass and runner-recorded counts rendered; the review queue offers approve/reject on a zero-evidence doc |
| BR-994 | a schema-skew and an error entry render as disabled rows with their diagnosis in the project switcher; a launch where no registered project is usable still starts with zero mounted entries |
| BR-995 | already falsified by `multi-project-isolation.spec.ts` (unregistered project → 404-class; A-addressed writes leave B byte-unchanged) — cite only |
| BR-996 | each dashboard write function uses `/api/p/<project>/` when given a project and the plain path when given none; a project-scoped doc edit sends the project and `If-Match`; a stale `If-Match` on a registered project is refused with 409; the audit row of a registered-project write carries the browser source |

Out of scope: changing product behaviour. If a new test shows the code violates its rule, the test is recorded as a failing run and reported; the code is not changed in this spec (the orchestrator files an issue or rewrites the rule).

Falsifier discipline: each new test is shown to fail once against a deliberate one-line mutation of the code it guards (recorded as `expected-fail` evidence with the mutation named), then the mutation is reverted.

## Acceptance Criteria

Structured criteria (AC-P0C-1..8) are added with `lore ac add`, one per rule, each citing its rule, each a script whose command runs only the named tests and prints a summary line.

## Code anchors

Declared after landing.


## Acceptance Criteria (structured)

- [⚑] [script] AC-P0C-1: BR-494: a filing through lore report-issue with a stub gh produces an issue body that opens with the filing field block followed, in order, by description, expected, actual and repro command, and the command prints the issue number and address and exits 0 — asserted by describe 'BR-494 filed issue body' in report-issue-body-contract.bun.test.ts
  script: test — bunx --bun vitest run --testTimeout=120000 --hookTimeout=120000 packages/lore/tests/integration/cli/report-issue-body-contract.bun.test.ts && echo 'AC-P0C-1 PASS: BR-494 filed body order + number/address + exit 0'
- [⚑] [script] AC-P0C-2: BR-613: a blank or whitespace-only node label is refused on both RuleService.addNode and CorpusService.create and creates no document; an unknown tree or a kind outside its tree stays refused — asserted by describe 'BR-613 node label, tree and kind' in baseline-field-bounds.test.ts
  script: test — bunx vitest run packages/lore/tests/unit/service/baseline-field-bounds.test.ts -t 'BR-613' && echo 'AC-P0C-2 PASS: BR-613 blank label refused on both write paths'
- [⚑] [script] AC-P0C-3: BR-623: a rule statement of 501 characters and an example of 301 characters are refused while 500 and 300 are accepted, confidence or enforcement outside their value sets is refused, and a refused rule burns no registry id — asserted by describe 'BR-623 rule field bounds' in baseline-field-bounds.test.ts
  script: test — bunx vitest run packages/lore/tests/unit/service/baseline-field-bounds.test.ts -t 'BR-623' && echo 'AC-P0C-3 PASS: BR-623 rule field bounds at 500/300 + enums + no id burned'
- [⚑] [script] AC-P0C-4: BR-971: an exemption grant is refused for a non-spec document, an expiry at or before now, and a blank grantor; with 15 live criteria the cap admits exactly 1 grant and refuses the 2nd; an admitted grant writes no version row — asserted by describe 'BR-971 exemption grant refusals' in ac-exempt-grant-refusals.test.ts
  script: test — bunx vitest run packages/lore/tests/unit/service/ac-exempt-grant-refusals.test.ts && echo 'AC-P0C-4 PASS: BR-971 grant refusals + floor cap at 15'
- [⚑] [script] AC-P0C-5: BR-991: beside approve and reject, a doc with zero evidence shows the overall state text 'none' and the record count '0'; a fixture with 3 records (2 runner-recorded, 2 pass, 1 fail) shows exactly '3', '2' runner-recorded, '2' pass and '1' fail; the review queue renders Approve and Reject buttons on a zero-evidence doc — asserted by describe 'BR-991 evidence summary' in AdjudicationBar.evidence-summary.test.tsx
  script: test — cd packages/dashboard && bunx vitest run tests/component/AdjudicationBar.evidence-summary.test.tsx && echo 'AC-P0C-5 PASS: BR-991 none state + counts + queue actions'
- [⚑] [script] AC-P0C-6: BR-994: the project switcher renders a schema-skew entry and an error entry as rows with aria-disabled=true whose text contains that entry's diagnosis string from the /api/projects payload (the fixture's exact diagnosis value), and a launch where every registered project is missing starts with zero mounted entries and does not throw — asserted by ProjectSwitcher.unusable.test.tsx and describe 'BR-994 all-missing launch' in mount-registry-all-missing.bun.test.ts
  script: test — cd packages/dashboard && bunx vitest run tests/component/ProjectSwitcher.unusable.test.tsx && cd ../.. && bunx --bun vitest run --testTimeout=60000 --hookTimeout=60000 packages/lore/tests/unit/mount/mount-registry-all-missing.bun.test.ts && echo 'AC-P0C-6 PASS: BR-994 unusable rows + all-missing launch'
- [⚑] [script] AC-P0C-7: BR-995: a dashboard request naming an unregistered project is refused with HTTP status exactly 404 and ok false, and an approve plus doc edit addressed to project A leaves project B's documents byte-unchanged — asserted by the existing multi-project-isolation.spec.ts e2e (fails loud if ports 8787/5173 are in use)
  script: test — cd packages/dashboard && bunx playwright test --config=tests/e2e/playwright.multi-project.config.ts tests/e2e/multi-project-isolation.spec.ts && echo 'AC-P0C-7 PASS: BR-995 unregistered 404 + A writes leave B unchanged'
- [⚑] [script] AC-P0C-8: BR-996: every exported write function of packages/dashboard/src/api/mutations.ts (the test enumerates the module's exports and fails on an export it has no case for) targets /api/p/<project>/ when given a project and the plain /api/ path when given none, and a project-scoped doc edit sends the project and If-Match — asserted by mutations-project-scope.test.ts and DocDetail.project-write.test.tsx. Re-baseline 2026-10-10: the Playwright half moved to AC-P0C-9 because verify cannot count Playwright files in a mixed command (issue filed); no assertion dropped.
  script: test — cd packages/dashboard && bunx vitest run tests/unit/lib/mutations-project-scope.test.ts tests/component/DocDetail.project-write.test.tsx && echo 'AC-P0C-8 PASS: BR-996 project prefix for every write export + If-Match on project-scoped edit'
- [⚑] [script] AC-P0C-9: BR-996: on a registered project a stale If-Match is refused with HTTP 409 leaving the document unchanged, the same stale If-Match on the launch project is also 409, and an accepted write records the same audit actor as the launch project's write — asserted by multi-project-write-parity.spec.ts (fails loud if ports 8787/5173 are in use)
  script: e2e — cd packages/dashboard && bunx playwright test --config=tests/e2e/playwright.multi-project.config.ts tests/e2e/multi-project-write-parity.spec.ts && echo 'AC-P0C-9 PASS: stale If-Match 409 on both + same audit actor'

## Code anchors

- packages/lore/tests/unit/service/ac-exempt-grant-refusals.test.ts
- packages/dashboard/tests/component/AdjudicationBar.evidence-summary.test.tsx
- packages/dashboard/tests/component/DocDetail.project-write.test.tsx
- packages/dashboard/tests/component/ProjectSwitcher.unusable.test.tsx
- packages/lore/tests/integration/cli/report-issue-body-contract.bun.test.ts
- packages/dashboard/tests/unit/lib/mutations-project-scope.test.ts
- packages/lore/tests/unit/mount/mount-registry-all-missing.bun.test.ts
- packages/lore/tests/unit/service/baseline-field-bounds.test.ts
