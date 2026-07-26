---
id: KN-152
type: knowledge
role: knowledge
title: "Dogfood retro — full-lifecycle fresh-corpus run (snip-demo) 2026-07-17"
status: approved
priority: medium
created: 2026-07-17
updated: 2026-07-18
tags: []
parent: PRD-001
links:
  - {id: SPEC-087, type: informs}
  - {id: SPEC-050, type: informs}
  - {id: SPEC-051, type: informs}
  - {id: ADR-006, type: informs}
---
# Retro — full-lifecycle dogfood on a fresh corpus (snip-demo, 2026-07-17)

## Method

Built a throwaway demo project (`snip` — Bun+TS CLI snippet manager) in a scratchpad dir, ran the ENTIRE lore lifecycle against a fresh corpus with lore 0.1.0 (dist 2026-07-17): init → PRD (MDX living root) → tree blueprint → gated spec + 4 structured ACs → approve chain → plan + phases + tasks (file anchors, blocks link) → two lore-implementer subagent runs (claim/evidence/release, distinct actors) → anchor-overlap two-actor probe → `lore verify` (§M2 approval gate + attested evidence) → human-AC evidence → task archival → `lore assess` (LLM judge) → `lore review` (AI judge on a deliberately contradictory ADR) → code anchors + `--check-drift` (planted `file_missing`) → ADR supersede/invalidate → handoff → `feed session-resume` → export-docs → final `status --check-tree --check-drift`. Every exit code re-verified without pipes before reporting.

## What held up (GOOD)

- Implementer-seat loop (claim → get spec → evidence ×2 → release): both subagents reported ZERO friction, verbatim.
- Anchor-overlap gate: correctly rejected a second actor's conflicting claim (exit 4); readiness/blocks computation exact.
- `lore verify`: NEEDS_APPROVAL exit 7 with named recovery flags; byte-identical commands never re-prompted; `[new]` first_seen annotation; human ACs skipped loud; attested `⚑✔` coverage rendering.
- `lore assess`: grounded per-AC scores, typed gaps (caught the store task's 0-attested evidence and the missing `--diff`), rubric SELF-warning on an ungrounded absence claim.
- `lore review`: caught real planted semantic contradictions (SQLite vs parent zero-dependency constraint, FTS vs fuzzy-search non-goal, missing migration path) and escalated with grounded blocking questions.
- Drift oracle: planted `file_missing` → exit 3 + literal fix command; `path#Symbol` anchors validated.
- Invalidation: banner on `lore get`, default-filtered list/search, `[invalid]` tree badge, `--supersedes` compose.
- Evidence + anchors survive status-only `lore set`; `--confirm` guard on delete; audit `--verify` complete.

## Defects / friction found (severity-ordered)

1. **F2 [HIGH] GateEnforcer denials drop the feeding pack.** `lore claim` under anchor conflict → only `Gate "task-claim" blocked: ANCHOR_OVERLAP`; `lore create spec` → only `MISSING_SKELETON`. The rich pack (conflicting task/holder/paths, literal `lore release … --force` recovery, required sections) EXISTS — `lore gate task-claim --task X --by Y` prints it for the same state — but the GateEnforcer→LoreError→CLI seam discards it. "exit 4 + feeding pack" is currently true ONLY on the hook path; MCP/HTTP/CLI service-layer callers get the discriminator alone. Fix: thread the pack text into LoreError details at the enforcer seam.
2. **F3 [HIGH] g1 hook false-denies cross-corpus.** Hook derives TARGET_CWD from harness stdin `.cwd`; a `cd <other-project> && lore create spec …` from a session anchored elsewhere is gated against the WRONG corpus (observed: false PARENT_REQUIRED + repo feeding source quoted against a fully valid demo-corpus write). False deny > fail-open inversion of g1's own philosophy (g4 allows on lookup anomalies). Fix candidates: parse leading `cd <dir> &&`; or unresolvable-parent-in-TARGET_CWD → fail open like g4.
3. **F4 [MED] Unknown flags silently swallowed (citty), compounded by inconsistent actor-flag naming.** `lore link --kind blocks` → silent relates-to default (breaks `ready` blocker semantics); `lore approve --by daniel` → silently attributed to OS user because approve's flag is `--reviewer`. Silent audit misattribution with zero signal. Fix: strict unknown-flag rejection + unify on `--by` (alias `--reviewer`).
4. **F6 [MED] "active plan" definition split.** `<ActivePlans />` requires status=active but the natural flow (create→approve→execute) never transitions a plan to active and nothing nudges it → permanently empty PRD living view; meanwhile `lore bootstrap` counts approved plans as "Active plans". Also task completion needs THREE commands (approve → set active → set archived); no `lore done` sugar.
5. **F1 [LOW] Fresh-corpus onboarding dead-ends.** `lore feed spec-create` → "no approved governing skill for spec" with no pointer on how to author/arm one.
6. **F7 [LOW] `lore init --author` is never consumed** — docs get author null (rendered "system"); approve attributes OS user.
7. **F5/F9/F10 [LOW/COSMETIC]** `ac add` echoes the full list per add (duplicated in batch shells); `lore tree` prints truncated ULIDs where slugs are the useful key; repeated `lore verify` appends duplicate attested evidence; `lore review` footer prints "prompt vv1".

## Meta-lesson

Measure exit codes without pipes (`cmd; echo $?` after redirect, not `cmd | head; echo $?`) — two false "exit 0" bug reports were avoided only by re-verification.
