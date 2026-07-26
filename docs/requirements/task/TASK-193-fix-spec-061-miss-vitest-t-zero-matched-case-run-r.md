---
id: TASK-193
type: task
role: plan
title: "Fix SPEC-061 miss: vitest -t zero-matched-case run recorded completeness=complete (false-oracle vector)"
status: archived
priority: high
created: 2026-07-24
updated: 2026-07-24
tags: []
parent: PRD-001
links:
  - {id: KN-067, type: relates-to}
---
Evidence (2026-07-24, SPEC-075 T1-stage verify): lore verify ran AC-075-1/5/6/7 commands ('cd packages/dashboard && bunx vitest run -t AC-075-N') BEFORE any matching tests existed (they landed in T3). Vitest executed the existing 37-file suite, matched ZERO cases for the -t filter, exited 0 — and the attestation recorded completeness: complete, executed_files: 37 (see task-t1-core-evidence-panel-ssot-types-attestation-math-hoist verification_evidence). SPEC-061 AC-061-10 (-t matched-case counting) should have judged this inconclusive. Investigate judgeCompleteness: likely the matched-case parser does not recognize this vitest output shape (or counts files, not -t-matched cases) — determine exact miss, fix, and add a regression fixture reproducing the zero-matched-case-exit-0 shape. AC: (1) a verify run whose -t filter matches 0 cases records completeness inconclusive (exit 3 path), unit-fixtured; (2) existing SPEC-061 completeness tests stay green; (3) the T1-shape output (files executed, 0 matched) is a pinned fixture.
