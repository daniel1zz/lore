---
id: TASK-1226
type: task
role: plan
title: "[Skill:test] RED: census interface dispatch, bootstrap list, sites/coverage/map e2e (AC-BLS2-5)"
status: archived
priority: medium
phase: "Phase 2: Indexes and census"
created: 2026-10-08
updated: 2026-10-08
tags: []
parent: PLAN-178
plan: PLAN-178
---
Estimate: S
Source: spec C1/C2 ("sites reached only through dynamic dispatch are reported as not_measured, never as covered"); I4 report (interface-method calls neither followed nor reported; no end-to-end tests of sites/coverage/map; setSiteMap untested)
TDD-Role: red
Covers: AC-BLS2-5
Scenarios:
- Given a fixture command whose service calls `this.store.insertCapped()` through an interface type whose implementation returns err({code: "CAP_FULL"}), When the census runs, Then the interface call appears as a not_measured site keyed per interface method (e.g. "Store#insertCapped#<interface>") — exactly once even if called twice
- Given the shared non-business list containing the app-bootstrap entry symbols, When the census runs on a command that goes through bootstrap, Then sites inside listed symbols are reported in a separate bootstrap count and not as gaps
- Given a throwaway corpus (mkdtemp + lore init) with a leaf, When `lore baseline map <leaf> --command "ac add"` then `--site <key> --rule BR-n` for every site and `--non-business` for the rest, Then `lore baseline coverage <leaf>` exits 0; removing one mapping makes it exit 1 naming the site
- Given RuleService.setSiteMap on an approved leaf, Then one version + one audit row are written and a concurrent stale write is refused (CAS)
AC:
- Tests added to packages/lore/tests/unit/service/site-census.test.ts (census cases, dynamic imports only) and new packages/lore/tests/integration/cli/baseline-coverage.bun.test.ts (CLI e2e) — both typecheck-clean before commit
- Run both: red for missing behaviour; record expected-fail on THIS task on the spot
