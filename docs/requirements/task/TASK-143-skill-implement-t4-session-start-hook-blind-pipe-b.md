---
id: TASK-143
type: task
role: plan
title: "[Skill:implement] T4 session-start hook blind-pipe + backstop"
status: draft
priority: medium
phase: "Phase 2: Surfaces (parallel)"
created: 2026-07-26
updated: 2026-07-26
tags: []
parent: PLAN-032
plan: PLAN-032
links:
  - {id: TASK-141, type: blocks}
---
Estimate: S
Approach: per SPEC-080 §Hook role (Phase E) — in assets/hooks/session-start-resume.mjs: (1) spawn args gain `--injection` (keep `bootstrap` verb? NO — spawn becomes `lore bootstrap --injection`; CLAUDECODE=1 env and --seat-branch threading byte-unchanged); (2) delete the pretty-print + `BOOTSTRAP_CHAR_CAP` 8000 char-slice; (3) rename constant to `INJECTION_BACKSTOP_CAP = 12000`: stdout length > cap → DROP the bootstrap block entirely + push a degradations entry naming the observed length (never slice); (4) markdown wrapper text unchanged apart from the truncation footnote (no longer possible → remove the "truncated" suffix path). Hook stays package-import-free and shape-blind: zero payload field names in hook code.
Source: SPEC-080 D2/D3 + assets/hooks/session-start-resume.mjs Phase E (lines ~245-287 pre-change).
Dimensions: D-FUNC
Scope-Alt: backstop message wording free; cap value 12000 is spec-pinned
Covers: AC-080-4

AC:
- Phase E contains no JSON field-name literals from the projection contract (grep oracle on the hook file: none of resume_hint/active_plans/omitted appear in Phase E code).
- Backstop branch: feeding an oversized fake stdout via a stubbed spawn in a node smoke run appends a degradation entry and emits no bootstrap block (manual smoke, documented in evidence output_tail).
- After `bun run build` (regenerates the embedded manifest BEFORE compile), `node scripts/embed-assets-manifest.mjs --check` → exit 0 (AC-080-4).
- Fail-open contract intact: any spawn/fs error still exits with valid hook JSON (existing catch paths untouched).
