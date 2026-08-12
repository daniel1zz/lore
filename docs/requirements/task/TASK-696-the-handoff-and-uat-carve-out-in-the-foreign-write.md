---
id: TASK-696
type: task
role: plan
title: "The handoff and UAT carve-out in the foreign-write guard is unnamed in the spec and unasserted by any AC"
status: draft
priority: medium
created: 2026-08-12
updated: 2026-08-12
tags: []
parent: PRD-001
---
Raised by `lore assess` on plan-land-corpus-resolution-provenance-one-pure-resolver-one (minor, scope_fidelity, AC-CP-3).

## The defect

`packages/lore/src/service/corpus-service.ts` exempts `allowHandoff` / `allowUat` creates from the foreign-corpus-write guard. The exemption is reasoned inline in a comment, but it is NOT among the exemptions spec-corpus-resolution-carries-provenance-and-a-foreign-write names — §D5's table names exactly one, the HTTP null-provenance row — and no AC cell asserts it.

So the refusal surface has a carve-out that no oracle can falsify. If a future change widens it, narrows it, or deletes it, nothing goes red. That is the same false-oracle class the spec explicitly rejects for HTTP, where it insisted a typed spy make the exemption observable rather than decorative.

## What must land

1. Decide and record whether the carve-out is intended. If it is, it belongs in the spec's §D5 exemption table with its reason, exactly as the HTTP row is.
2. An AC cell asserts it two-sidedly: a handoff/UAT create from a foreign nested worktree LANDS, and the identical create through a non-exempt path is REFUSED with exit 4 and the `gate:corpus-write:foreign-provenance` token. One direction alone cannot distinguish a live carve-out from a guard that never fires.
3. If it is NOT intended, remove it and let the lifecycle-intent path govern those writes like any other.
