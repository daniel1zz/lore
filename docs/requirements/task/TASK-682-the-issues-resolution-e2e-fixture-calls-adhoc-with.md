---
id: TASK-682
type: task
role: plan
title: "The issues-resolution e2e fixture calls --adhoc with no --ac-scope, which cb526317 made a refusal"
status: draft
priority: medium
created: 2026-08-11
updated: 2026-08-11
tags: []
parent: PRD-001
---
Pre-existing Playwright failure, machine-verified by the vocabulary-relocation implementer rather than assumed: issues-resolution.spec.ts:317 fails in FIXTURE SETUP, before any rendering — 'lore create task --title … --adhoc' exits 4 with 'Error: --adhoc requires an explicit --ac-scope declaration.' The refusal was introduced by cb526317 (already in main); the fixture at :209 still calls --adhoc with no --ac-scope; the file is in nobody's recent diff; and the GLOBAL lore reproduces the identical exit 4 with byte-identical stderr on a throwaway mkdtemp corpus.

Fix: pass an explicit --ac-scope "" in the fixture (the sanctioned 'claims no criterion' declaration). ⛔ Do not disable or skip the spec.

This is a fresh instance of this repo's own standing lesson that a newly built gate retroactively invalidates the back-catalogue and the sweep must be budgeted in the SAME slice: cb526317 armed the refusal without updating this fixture, and it stayed invisible because Playwright is not in test:changed's selection.
