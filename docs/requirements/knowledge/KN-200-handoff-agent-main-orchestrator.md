---
id: KN-200
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: archived
priority: medium
created: 2026-08-04
updated: 2026-10-10
tags: []
parent: PRD-001
---
# Handoff — agent:main-orchestrator

SCOPE: 7 decisions + 5 next steps = 12 items to account for

## Plan

(none)

## Task Refs

(none)

## Modified Files

- CLAUDE.md
- assets/governance/corpus-workflow.md
- packages/lore/src/service/session-service.ts
- packages/lore/src/service/uat-service.ts
- packages/lore/src/service/gate-enforcer.ts
- packages/core/src/session.ts
- packages/lore/src/app.ts

## Key Decisions

| ID | Judgment | Confidence |
|---|---|---|
| KD1 | Wave 3 closed 4/4 on clean main 75d05cb. Authoritative full suite after ONE post-merge rebuild: vitest 461 files/8215 passed, bun 1807 pass/0 fail, typecheck 0, six guards 0. KD2 held — digit-identical under env -u of both session vars, which matters since this wave touched claim/session code | 100 |
| KD2 | BIGGEST FIND: lore list excludes NO invalidated docs on either surface, and --include-invalid is silently inert (604 rows both ways, identical slug sets); no --json record carries a validity field. Only a human lore get shows the banner. It made me sequence a RETRACTED task into a wave | 100 |
| KD3 | The done-refusal wording defect reproduced 4 more times this wave — all four agents used --capture, wrote capture_source runner, and were told they hold only SELF-REPORTED evidence. Eight instances now. Filed as wording-only: the predicate itself is CORRECT and must not be relaxed | 100 |
| KD4 | A background completion notice reports the SHELL exit code, not your oracle: my command ended in cat, so a red suite would still have notified exit code 0. Persist the target status to a file and read it back. A foreground kill at the tool ceiling reports 143, not a test failure | 100 |
| KD5 | bun run test:bun now takes 690s, exceeding the 600s foreground ceiling — it must be backgrounded. Suite duration drifts up as tests are added; the ceiling is not a property of the suite | 95 |
| KD6 | All four agents REPORTED their anchor widenings rather than silently taking them, and each held up on independent review. KD7 corrected rule works: what is forbidden is silent widening, not discovering that one is needed | 95 |
| KD7 | A CLI end-to-end probe must use a VALID payload. My first uat probe used an empty one and was stopped by schema validation BEFORE reaching the type check — a false positive. The HAPPY control, same payload against a plan, is what proves the refusal came from the type check | 100 |

## Failing Oracle

(none)

## Next Steps

- NS1: Wave 4 serial chain on task-workflow-service.ts — THREE tasks, one file, never concurrent: a-mistyped-task-file-anchor, the-ac-scope-re-keying-left-the-red-first-floor-unarmed, lore-done-s-attestation-refusal-calls-a-capture-source
- NS2: Two high-value defects filed this session, not yet scheduled: an-invalidated-doc-is-indistinguishable-from-a-live-one-in (high; anchors list.ts + validity-service.ts) and lore-get-s-default-render-silently-omits-structured-extra. relates-to linked, same family, NOT duplicates
- NS3: HEADROOM WARNING: root CLAUDE.md has 50 bytes / 13 lines left; packages/lore/src/service/CLAUDE.md has 33 bytes. The next contract change to either needs an eviction FIRST. ADR D1 / NS6 is now blocking rather than theoretical
- NS4: Three half-specced tasks remain (Defect/Required/Oracle body, no numbered ACs). active-sessions proved that IS dispatchable when the Oracle names its own dimensions and falsifiability — add only what is genuinely missing, do not reformat
- NS5: Re-derive open-task counts once the invalidation filtering defect is fixed. Current reading is 28 open — an UPPER BOUND that may include further retracted docs
