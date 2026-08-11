---
id: TASK-424
type: task
role: plan
title: "T5 — parameterize the evidence renderer and register v7, freezing v6's rendering so a stamped prompt_version stays reproducible"
status: archived
priority: high
created: 2026-08-01
updated: 2026-08-01
tags: []
parent: PLAN-082
plan: PLAN-082
---
Follow-up to T3 (`a639485`), which is deliberately NOT merged until this lands.

## The defect T3 surfaced and correctly refused to decide alone

T3 changed `renderTaskEvidence`, which is SHARED by `buildAssessPrompt` (v5) and
`buildAssessPromptV6`. `ASSESS_PROMPT_VERSION` is currently 6. So after T3, an assessment
stamped `prompt_version: 6` renders differently than one stamped 6 last week.

That breaks a documented invariant, not merely a convention:
- `prompt_version` is PERSISTED into every assessment's provenance
  (`packages/core/src/assessment.ts:214`) and printed in the report (`:1412`).
- `ai-provider-service.ts:457` states the template and the stamped `prompt_version`
  "can never drift apart (SSOT)".
- `assess-template.ts:7` says to bump "whenever" the prompt changes, and `:763` says old
  versions are "kept for provenance" — i.e. re-runnable.

## Required (decided: parameterize, do not fork the builder)

- Inject the evidence renderer into the shared builder as a parameter. ONE builder body
  serves both versions — do NOT copy `buildAssessPromptV6` into a v7 twin.
- v6 binds the PRE-projection renderer, frozen byte-identical to its behaviour before
  T3's commit. Capture that expected string from `git show a639485^:packages/lore/src/ai/assess-template.ts`
  and pin it as a literal in the test, so the freeze cannot drift with the code.
- v7 binds T3's projected `(oracle, ac_ref, result, command, tail_bytes)` renderer and
  becomes the active `ASSESS_PROMPT_VERSION`.

## ⛔ Unchanged

The `truncated[]` vocabulary stays exactly `task:<slug>` (T3's AC-AEP-3 guards it;
`computeTaskTruncationRatio` and the grounding substring match both depend on it, and the
ratio drives the verdict-forcing branch at `ai-provider-service.ts:1339-1341`).

## Oracle

AC-AEP-9 and AC-AEP-10, plus T3's AC-AEP-1..4 must all still pass afterwards.
