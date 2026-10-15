---
id: BASE-084
type: baseline
role: intent
title: "Module card: eval"
status: approved
priority: medium
created: 2026-10-10
updated: 2026-10-10
tags: []
parent: BASE-079
links:
  - {id: SPEC-013, type: supersedes}
---
# Module card: eval

Source: `packages/lore/src/eval/CLAUDE.md`.

- **Responsibility**: six read-only evaluation scenarios behind `lore eval` (SPEC-013): migration coverage, tree consistency, link integrity, type distribution, FTS recall, placeholder parse.
- **Public surface**: `run<Scenario>(input, app)` plus an exported Zod `<Scenario>ResultSchema` per scenario; default thresholds as exported constants.
- **Dependencies**: `@lore/core`, services via the App (read methods only).
- **Invariants**:
  - Read-only: never create/update/delete/link.
  - Never throws: failures surface as `passed: false`.
  - Idempotent: no clock, randomness or env reads in scenario bodies.
