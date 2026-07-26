---
id: TASK-160
type: task
role: plan
title: "Register eslint react-hooks plugin in dashboard flat config (4 pre-existing rule-not-found errors)"
status: archived
priority: medium
created: 2026-07-25
updated: 2026-07-25
tags: []
parent: PRD-001
---
Estimate: S

SPEC-078 T9/T10 byproduct: packages/dashboard eslint flat config surfaces 4 pre-existing react-hooks/exhaustive-deps 'rule not found' errors (plugin never registered). Repo-scope lint is therefore not clean; T10 recorded lint result=fail with a self-reported git-stash byte-identical justification.

AC:
- Given eslint-plugin-react-hooks registered in packages/dashboard/eslint.config.js, When bun run lint runs in packages/dashboard, Then exit 0 with the 4 sites either compliant or carrying a per-line justified disable comment.
- Given the T9 no-raw-api-literal rule fixture, Then lint:api-factory-fixture still fails the fixture (regression guard).
