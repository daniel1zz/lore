---
id: SPEC-162
type: spec
role: spec
title: "Baseline close-out fixes: audit surface, node validation, isolation e2e, compiled census, standard review, tree counts, link atomicity, fidelity judge input"
status: approved
priority: medium
created: 2026-10-10
updated: 2026-10-10
tags: []
---
# Baseline close-out fixes: audit surface, node validation, multi-project isolation e2e, compiled census, standard review, tree counts, link atomicity, fidelity judge input

## Overview/Goal

Close the defects that block finishing the product-baseline migration (owner decision 2026-10-10 night): #128 audit rows record no write surface; #129 whitespace-only baseline label accepted by CorpusService.create; #130 unknown --tree accepted by RuleService.addNode; the multi-project isolation e2e (AC-P0C-7) fails on an approve addressed to project A; #58 the compiled binary cannot run the census; #126 the review judge never sees an architecture standard's four parts; #125 `lore baseline tree` hides rule counts of standard and debt-registry nodes; #123 `lore link` is not atomic; #117 the fidelity judge does not see the cited test's code.

## Scope

One task per defect, each with a red-first test that fails on the pre-fix code and passes after. Product behaviour changes only as the defect's expected behaviour states (read the issue: `gh issue view <n>` / `lore issues --local --all`). Each criterion cites the baseline rule (BR) or architecture standard (AS) the defect violates; if the rule's text is wrong, it is corrected with `lore rule set` in the same task and named in the report.

Out of scope: slice 3b (spec parent contract) — separate spec.

## Acceptance Criteria

Structured criteria AC-BLC-1..9, one per defect, added with `lore ac add`.

## Code anchors

Declared after landing.


## Acceptance Criteria (structured)

- [⚑] [script] AC-BLC-2: #129 #130 (BR-613): a whitespace-only label ('   ', '\t\n ') is refused with VALIDATION_ERROR by CorpusService.create and creates no doc, and RuleService.addNode with tree 'marketing' is refused and creates no doc — asserted by describe 'BR-613 node label, tree and kind' in baseline-field-bounds.test.ts
  script: test — bunx vitest run packages/lore/tests/unit/service/baseline-field-bounds.test.ts && echo 'AC-BLC-2 PASS: whitespace label + unknown tree refused on both write paths'
- [⚑] [script] AC-BLC-1: #128 (AS-19): a create, set and approve through CorpusService record an audit entry whose surface equals the caller surface; driven through the CLI the entry reads 'cli', through the MCP tool 'mcp', through HTTP with a session cookie 'http_cookie' and with a bearer token 'http_token' — asserted by audit-surface.bun.test.ts
  script: test — cd packages/lore && bun test --timeout 120000 tests/integration/http/audit-surface.bun.test.ts && echo 'AC-BLC-1 PASS: audit entries carry cli/mcp/http_cookie/http_token surface'
- [⚑] [script] AC-BLC-3: (BR-996) the multi-project isolation e2e passes end to end: an approve plus doc edit addressed to project A succeed (HTTP 2xx) exactly as on a single project, project B's documents stay byte-unchanged, an unregistered project gets 404, and an If-Match token minted under A replayed against B is rejected
  script: e2e — cd packages/dashboard && bunx playwright test --config=tests/e2e/playwright.multi-project.config.ts tests/e2e/multi-project-isolation.spec.ts && echo 'AC-BLC-3 PASS: isolation e2e green incl. approve on A'
- [⚑] [script] AC-BLC-4: #58 (AS-16): after bun run build, the compiled dist/lore runs 'baseline sites' and 'baseline coverage' for the specification branch with exit 0 and lists at least one refusal site, never a typescript-unavailable error — asserted by compiled-census.bun.test.ts
  script: test — bun run build > /dev/null 2>&1 && cd packages/lore && bun test --timeout 300000 tests/integration/cli/compiled-census.bun.test.ts && echo 'AC-BLC-4 PASS: compiled binary runs the census'
- [⚑] [script] AC-BLC-5: #126 (BR-960): the review prompt built for an architecture standard node includes, for every AS rule, its current reality, target rule, current exceptions and migration text verbatim, and a business leaf's prompt carries no four-part section — asserted by review-template-standard.test.ts
  script: test — bunx vitest run packages/lore/tests/unit/ai/review-template-standard.test.ts && echo 'AC-BLC-5 PASS: judge sees AS four parts'
- [⚑] [script] AC-BLC-6: #125 (BR-674): lore baseline tree prints rule counts by lifecycle for an architecture standard node and a debt-registry node holding rules, and none for a section or module card with no rules — asserted by baseline-tree-counts.bun.test.ts
  script: test — cd packages/lore && bun test --timeout 120000 tests/integration/cli/baseline-tree-counts.bun.test.ts && echo 'AC-BLC-6 PASS: standard and debt-registry rows show rule counts'
- [⚑] [script] AC-BLC-7: #123 (AS-10): when the parent write fails after the link row is written (or the reverse), lore link --type parent leaves parent_id, the link table, the version row and the audit entry all unchanged — no partial state — and the command exits non-zero; a successful link changes all of them together — asserted by link-parent-atomic.bun.test.ts
  script: test — cd packages/lore && bun test --timeout 120000 tests/unit/store/link-parent-atomic.bun.test.ts && echo 'AC-BLC-7 PASS: link parent is all-or-none'
- [⚑] [script] AC-BLC-8: #117 (AS-17): the fidelity judge prompt for a sampled criterion contains the source of each test file its command names; a criterion whose named test file cannot be read is counted and named as not-seen in the output and is never reported faithful — asserted by fidelity-judge-test-code.test.ts
  script: test — bunx vitest run packages/lore/tests/unit/service/fidelity-judge-test-code.test.ts && echo 'AC-BLC-8 PASS: judge sees test code; unseen counted'

## Code anchors

- packages/lore/src/store/audit-surface.ts
- packages/lore/src/ai/review-template.ts
- packages/lore/src/service/fidelity-sample.ts
- packages/lore/tests/unit/service/baseline-field-bounds.test.ts
- packages/lore/tests/unit/ai/review-template-standard.test.ts
- packages/lore/tests/integration/http/audit-surface.bun.test.ts
- packages/lore/tests/integration/cli/baseline-tree-counts.bun.test.ts
- packages/lore/tests/integration/cli/compiled-census.bun.test.ts
- packages/lore/tests/unit/store/link-parent-atomic.bun.test.ts
- packages/lore/tests/unit/service/fidelity-judge-test-code.test.ts
