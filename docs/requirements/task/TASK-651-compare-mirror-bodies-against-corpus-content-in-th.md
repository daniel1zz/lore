---
id: TASK-651
type: task
role: plan
title: "Compare mirror bodies against corpus content in the spec-mirror check"
status: draft
priority: medium
phase: "mirror-content"
created: 2026-08-11
updated: 2026-08-11
tags: []
parent: PLAN-121
plan: PLAN-121
---
Implements AC-BFI-8 of spec-bootstrap-fixpoint-integrity-binary-provenance-an-anchor.

## Objective

Make the spec-mirror `--check` compare mirror BODIES against their corpus documents.

The mirror is the corpus's projection onto git — the only surface a consumer without `.lore/` can
read — and its body is the one part nothing verifies. Three layers already exist and stay untouched:
AC-FR-6 count parity, AC-FR-7 drift detection that must not self-repair, AC-FR-10 filename vs
frontmatter-id byte-identity. The residual is quoted verbatim from the tool's own 2026-08-11 output:

    export-spec-mirror --check: OK — every corpus spec has a mirror file
    (count and slug parity; file CONTENT is not compared).

## AC-BFI-8

Exit EXACTLY 2 on detected body divergence — `MIRROR_DRIFT_EXIT_CODE`, already defined at
`scripts/export-spec-mirror-core.ts:63`. ⛔ NOT 4: that is `MIRROR_HARD_FAILURE_EXIT_CODE` (line 65)
for an unreadable or erroring export, and reusing it would make a crash indistinguishable from a
detection. Output NAMES the divergent slug. Run twice consecutively, it reports the same drift both
times — the check must never regenerate what it inspects.

Declared RED: (a) make the check call the exporter first, so the second consecutive run reports
clean — must fail; (b) restore the body to match the corpus and the identical run exits EXACTLY 0,
proving the red came from body divergence rather than a crash.

## ⛔ Dependency — a LIVE foreign claim, re-read it before starting

Measured 2026-08-11T02:50Z: `agent:mirror-id-unify` holds
`task-unify-mirror-identifiers-on-zero-padded-form-export-all` in worktree
`worktree-agent-a9f801dd0f61837b2`, anchoring `scripts/export-spec-mirror.ts`,
`scripts/export-spec-mirror-core.ts`, `scripts/tests/spec-mirror-export.test.ts`, `package.json` —
intersecting this task. `lore ready` already reports the conflict.

Also: `main` was RED at that time (`links_broken` = 43, `migration-coverage.test.ts` exit 1). That
red belongs to the foreign task, not to this one. Do not start until it is merged and green, and
⛔ re-read the claim at dispatch time rather than trusting this snapshot.
