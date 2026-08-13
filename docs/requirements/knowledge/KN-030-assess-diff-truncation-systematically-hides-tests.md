---
id: KN-030
type: knowledge
role: knowledge
title: "assess diff truncation systematically hides tests from the judge"
status: approved
priority: medium
created: 2026-07-07
updated: 2026-07-08
tags: [assess, ai, bug]
parent: PRD-001
---
# assess: tests-last truncation produces false gaps (2026-07-07)

Observed on the SPEC-037 assessment (knowledge-assessment-spec-037-implementation-execution-tracking, verdict met 83/100): the max_diff_chars budget keeps production source first and truncates test files, so the judge reported 4 gaps ('no dedicated PlanExecution/TaskExecution/search-snippet tests; no ready-route 404/422 assertions') — ALL four verified false: the files exist (8+8+7 cases) and the 404/422 assertions are in routes.test.ts; every one appears in the assessment's truncated[] list.

Effect: judge systematically UNDERSCORES test-coverage ACs (AC-37-3/4/5 got 70-72 for this reason alone) and emits recommendations for work that already exists. Fix direction: truncate tests by sampling (keep test file names + describe/it titles even when bodies are cut) or add a materials manifest ('N test files changed, M truncated') to the prompt so the judge can distinguish 'absent' from 'not shown'. Relates: SPEC-028 (assess input transparency).
