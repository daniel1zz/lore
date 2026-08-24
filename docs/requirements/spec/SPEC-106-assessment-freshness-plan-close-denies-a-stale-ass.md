---
id: SPEC-106
type: spec
role: spec
title: "Assessment freshness — plan-close denies a stale assessment"
status: approved
priority: medium
created: 2026-07-28
updated: 2026-07-28
tags: []
parent: PRD-001
links:
  - {id: SPEC-094, type: implements}
---
## Overview/Goal

`lore assess` is timestamp-blind: it has no notion of "this plan gained task activity after my last run", and nothing marks a stored assessment as superseded by later work. Measured this session (`knowledge-session-process-review-2026-07-28-grill-to-shipped`, V1): SPEC-102's assessment ran at 11:52Z and SPEC-103's at 11:58Z, while the hardening commits those very assessments TRIGGERED landed at 12:23Z–12:50Z. An assessment that generates follow-up work silently becomes stale by its own success, and the corpus's permanent quality record for those plans described an intermediate state until it was noticed by hand.

Goal: make assessment freshness a deterministic, gate-enforced property instead of a discipline someone has to remember.

## Scope

IN: a `assessmentFreshness` predicate on the EXISTING `plan-close` checkpoint (SPEC-054/069 machinery, already armed and already firing — 2 real denies recorded in trace today), comparing the plan's newest assessment timestamp against its newest task activity (`evidence`/`done` audit rows); a loud advisory on `lore assess` itself when it is about to write an assessment for a plan whose stored assessment is already stale (so the operator sees it at assess time, not only at close time); the feeding pack naming the exact re-run command; an `assessment_freshness_exempt` opt-out following the existing `attestation_exempt` shape (flag + mandatory reason, bare flag without reason is NOT exempt).

OUT: changing what `lore assess` scores or how; auto-running assess (no daemon, no implicit AI spend); retroactively re-assessing historical plans; blocking `lore assess` itself (it must always be runnable — it is the fix, never the thing gated).

## Design Decisions

| ID | Decision | Rationale | Alternative rejected |
|---|---|---|---|
| D1 | Predicate on the EXISTING `plan-close` gate, not a new checkpoint | plan-close already runs at exactly the moment staleness matters, already carries the attestation floor + UAT judgment, and already has feeding-pack plumbing | a new `assess-fresh` checkpoint duplicates armed machinery |
| D2 | Compare against task `evidence`/`done` AUDIT timestamps, not doc `updated_at` | `updated_at` moves on cosmetic edits (anchor adds, link writes) and would produce false staleness; audit rows for evidence/done are the real "work landed" signal | doc mtime comparison |
| D3 | `lore assess` warns but never refuses | assess is the remedy for staleness; gating the remedy on the condition it cures is a deadlock | symmetric refusal on both surfaces |
| D4 | Exempt requires flag AND non-empty reason | mirrors `attestation_exempt` exactly (a bare flag is treated as NOT exempt), so operators learn one opt-out shape | boolean-only exemption |
| D5 | Staleness is computed read-side, never stored | same ethos as readiness and the deny→retry gap: a stored freshness bit would itself go stale | a persisted `assessment_stale` field |

## Acceptance Criteria

Structured ACs via `lore ac add` (script:test):

- AC-FRESH-1: closing a plan whose newest `evidence`/`done` audit timestamp is NEWER than its newest linked assessment is denied at `plan-close`, and the feeding pack names the exact `lore assess <plan> --diff-file <...>` re-run command.
- AC-FRESH-2: the same plan closes cleanly once a newer assessment exists; a plan with NO assessment at all is unaffected by this predicate (the pre-existing plan-close predicates govern that case, unchanged).
- AC-FRESH-3: cosmetic doc edits after an assessment (anchor add, link write, status change) do NOT trip the predicate — only `evidence`/`done` audit activity does (D2).
- AC-FRESH-4: `lore assess <plan>` on a plan whose stored assessment is already stale prints a loud advisory naming the newer activity, and still writes the assessment (never refuses, D3).
- AC-FRESH-5: `extra.assessment_freshness_exempt: true` WITH a non-empty reason short-circuits the predicate; the flag WITHOUT a reason does not (D4).

## Quality Gates checklist

- Every NFR has a measurable target: predicate cost is one audit query bounded by the plan's task set, computed read-side (D5).
- Failure mode + degradation: a plan with zero assessments or zero task activity yields a vacuous pass — the predicate never invents a denial from missing data.
- Migration: additive predicate on an armed gate; existing plans without assessments are unaffected (AC-FRESH-2), so no corpus backfill is required.


## Acceptance Criteria (structured)

- [⚑] [script] AC-FRESH-1: Closing a plan whose newest evidence/done audit timestamp is newer than its newest linked assessment is denied at plan-close, and the feeding pack names the exact lore assess re-run command
  script: test — bunx vitest run packages/lore/tests/unit/service/assessment-freshness.test.ts -t AC-FRESH-1
- [⚑] [script] AC-FRESH-2: The same plan closes cleanly once a newer assessment exists; a plan with no assessment at all is unaffected by this predicate
  script: test — bunx vitest run packages/lore/tests/unit/service/assessment-freshness.test.ts -t AC-FRESH-2
- [⚑] [script] AC-FRESH-3: Cosmetic doc edits after an assessment (anchor add, link write, status change) do not trip the predicate; only evidence/done audit activity does
  script: test — bunx vitest run packages/lore/tests/unit/service/assessment-freshness.test.ts -t AC-FRESH-3
- [⚑] [script] AC-FRESH-4: lore assess on a plan whose stored assessment is already stale prints a loud advisory naming the newer activity and still writes the assessment, never refusing
  script: test — cd packages/lore && bun test tests/integration/cli/assessment-freshness.bun.test.ts -t AC-FRESH-4
- [⚑] [script] AC-FRESH-5: extra.assessment_freshness_exempt true WITH a non-empty reason short-circuits the predicate; the flag without a reason does not
  script: test — bunx vitest run packages/lore/tests/unit/service/assessment-freshness.test.ts -t AC-FRESH-5
