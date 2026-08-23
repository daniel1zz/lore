---
id: TASK-800
type: task
role: plan
title: "skill-docs: evict narrative from service/CLAUDE.md — it sits 4 bytes under the suite threshold and blocks the next writer"
status: archived
priority: medium
phase: "P5-service-doc-eviction"
created: 2026-08-23
updated: 2026-08-23
tags: []
parent: PLAN-139
plan: PLAN-139
---
## Objective

`packages/lore/src/service/CLAUDE.md` is at 14742 bytes against the 14746-byte threshold that `packages/lore/tests/unit/service/claude-md-eviction-floor.test.ts` holds the four anchored module docs to. **4 bytes of runway.** The next agent that needs to record a service-module fact there will be blocked by `assets/hooks/claude-md-guard.sh`, and the contract's own analysis says what happens next: the fact gets recorded in a neighbouring file instead, where nothing reports it as misplaced.

Perform a real eviction per `lore governance claude-md`'s Eviction Rule. Target: comfortable runway, not another 4-byte pass.

## Method — the contract's own four steps

1. Pick blocks the contract's "What Goes In vs What Stays Out" table already assigns to the corpus: mechanism walkthroughs, per-change narratives, measurements, rejected alternatives. ⛔ Not the rule they illustrate.
2. Move each verbatim into a corpus doc (`lore create knowledge --sub-type reference`).
3. Leave **one line** naming what was evicted and the slug that now holds it. ⛔ That pointer must resolve — `lore status --check-memory-pointers` now checks exactly this, so a dangling stub is a deterministic finding.
4. Keep the rule, drop the story.

⛔ The Index-Entry Contract binds eviction stubs (added to the contract this same session): one line per item, scope keywords only.

## What is NOT the fix

- ⛔ Do not raise the ceiling or the threshold.
- ⛔ Do not reflow long lines to lower the line count — bytes bind, and splitting adds bytes.
- ⛔ Do not move a service-module fact into a neighbouring module's file. That displacement is invisible to every check and is the failure this task exists to prevent.

## Verification

- `bunx vitest run packages/lore/tests/unit/service/claude-md-eviction-floor.test.ts` → exit 0. ⛔ Use THIS oracle, not `lore status --check-claude-md`: the CLI's floor is 0.97 while this suite holds these four docs to 0.9, so the CLI reports "within budget" while the suite is red. That divergence is documented in `packages/lore/src/adapters/cli/CLAUDE.md` and was measured live this session — an edit verified only by the CLI passed while the suite had been red the whole time.
- `./dist/lore status --check-memory-pointers` → exit 0, every stub pointer resolving.
- Report the before/after byte count and the resulting runway.
