---
id: PLAN-134
type: plan
role: plan
title: "Fix the flat command tokenizer at its root: one segmentation seam for all three path-parsing call sites"
status: approved
priority: high
created: 2026-08-21
updated: 2026-08-21
tags: []
parent: SPEC-061
phases:
  - {name: "root-fix", description: "One segmentation seam, all three call sites, plus the compiled-binary wiring half. Single task on purpose: the implementer's last step is lore ac set, which demotes the governing spec."}
---
# Goal

Fix ONE root: three independent code paths each parse an acceptance criterion's shell command
as if it were a flat path list. Each is correct for the narrow shape it was written against
and silently wrong outside it, and none refuses the shape it cannot handle — all three
produce a confident, specific, wrong answer instead (`declared_paths: 3`,
`executed_files: 1`, `path does not exist`).

Measured 2026-08-19/21, three distinct manifestations, all reproduced independently:

| # | Surface | Wrong answer | Cost paid |
|---|---|---|---|
| 1 | `countExplicitPathArgs` (`packages/core/src/attestation-completeness.ts`) counts path-shaped tokens across an entire `&&` chain, including shell-builtin arguments | `declared_paths: 3` for a command whose runner received 1 | `lore verify` → `inconclusive`, then `lore done` refused an already-finished, already-correct task on the attestation floor |
| 2 | `parseExecutedUnits` (same file) returns on the FIRST recognised runner summary | `executed_files: 1` where 2 runners genuinely ran green (16/16 and 18/18) | any criterion spanning both of this repo's two runners was structurally unattestable; the only remedy was to split it by runner |
| 3 | `findMissingOracleFiles` / `extractTestFileTokens` (`packages/core/src/oracle-file-existence.ts`) matches path-shaped tokens over the raw string, prose included | `path does not exist` for a bare basename appearing inside a success-`echo` message | the declaration was refused; the documented workaround was to reword the echo so it spells no basename, making the success line LESS informative |

The fix is one seam, not three patches: `splitCommandSegments` already exists at
`oracle-file-existence.ts:151`, is quote-aware, and is consumed by NEITHER path extractor.
Promote it to the single segmentation SSOT and have every path- and unit-counting path read
RUNNER SEGMENTS.

⛔ Symmetry requirement, non-negotiable: a segment whose shape cannot be classified must be
reported as unclassified. Trading a false refusal for a silent zero reproduces the same
defect in the opposite direction, and D8's own resolution is explicit — "the fix is never
'forbid the ambiguous case', it is 'make the ambiguity visible and attributable'".

# Acceptance Criteria

On `spec-spec-061-attestation-completeness-guard-detect-zero-match-u`:

- `AC-061-18` — both path extractors read runner segments only (manifestations 1 and 3)
- `AC-061-19` — executed-unit credit sums every recognised runner summary (manifestation 2)
- `AC-061-20` — SERVICE: the echo-prose declaration is accepted AND a genuinely missing
  runner-segment path is still refused
- `AC-061-21` — PRODUCTION WIRING, compiled binary, bun runner (split from AC-061-20 because
  this repo's two runners cannot share one attestable command)

⛔ AC-061-18/19/20 carry no `--falsifier-*` declaration yet, and that is deliberate: a
falsifier's `--falsifier-find` must be a literal present in the POST-FIX source, which does
not exist until the fix does. Declaring them is the implementer's LAST step, via
`lore ac set`. ⛔ `lore ac set` demotes this spec to `draft`, so the orchestrator restores it
with `lore review` + `lore approve` after the merge — that is the orchestrator's duty, not
the implementer's, and it is why this plan carries ONE task rather than several.

⛔ Also measured 2026-08-21 (`knowledge-the-falsifier-mechanism-is-shipped-but-inert-a` F2):
a falsifier declared on a spec is executable only while its governing plan is LIVE. Declare
these while this plan is live, run them then, and record the attested red at that moment.
