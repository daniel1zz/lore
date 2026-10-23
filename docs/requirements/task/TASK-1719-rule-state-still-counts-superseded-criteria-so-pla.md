---
id: TASK-1719
type: task
role: plan
title: "Rule state still counts superseded criteria, so plan-close refuses a stale rule nothing can re-verify"
status: archived
priority: high
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PRD-001
---
Remaining half of task-skill-fix-a-superseded-criterion-is-still-counted-by (archived; it fixed coverage and the done floor). Observed 2026-10-19 (session 482f1e89): `lore set plan-baseline-coverage-refuse-only-undeclared-commands-strip --status archived` is refused by gate plan-close / cited-rule-state: 'BR-1248 stale: AC-BCR-2 / AC-BCR-3 / AC-BCR-5 of spec-baseline-coverage-cannot-silently-regress-one-program' — all three were superseded minutes earlier (`lore ac supersede … --by spec-baseline-coverage-refuses-only-undeclared-commands-a-site:AC-BCG-1|AC-BCG-2`), `lore verify` skips superseded criteria, and their test files are deleted, so the stale state can never be cleared. `lore baseline tree --rule BR-1248` still lists them as citing criteria. The live citing criteria (AC-BCR-4, AC-BCG-1, AC-BCG-2) all pass on 9c8150a7.

End state: a superseded criterion never contributes to a rule's verification state (RuleStateService and every renderer that lists citing criteria), only its superseding criterion does.

AC: on a throwaway corpus, a rule cited by a stale criterion that is then superseded by a passing criterion reads 'verified', and plan-close's cited-rule-state does not refuse over it; the same rule with the stale criterion NOT superseded still reads 'stale'.
