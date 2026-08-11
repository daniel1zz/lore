---
id: TASK-436
type: task
role: plan
title: "lore assess asks the caller for a git range that cannot be correct under concurrency — derive the plan's own commit set instead"
status: archived
priority: medium
created: 2026-08-01
updated: 2026-08-01
tags: []
parent: PRD-001
---
## Defect

`lore assess --diff <range>` asks the caller for a git range that, under concurrent
multi-plan sessions, **cannot be correct**. A plan's commits are not contiguous in `main`:
other sessions merge between them.

Measured 2026-08-01 on `plan-implementation-lore-ac-set-the-dangling-ac-ref-detector`.
CLAUDE.md's standing rule ("derive the range from the plan's own first task commit") yields
`ad8ac92^..f9794e5`, which contains 13 non-merge commits of which **6 belong to other plans**:

- AC-RCH resume-coverage — `0019494`, `86c34a7`
- task-create ac_scope gate — `dc1b6e5`, `e4cc579`, `acad8e0`
- adhoc ac_ref resolver — `1fffbf0`
- dashboard adjudication fix — `03f63c3`

≈46% foreign content. The plan's own six commits (`ad8ac92`, `90fdc7e`, `dc2135b`, `24eae58`,
`da42c33`, `f9794e5`) are interleaved with them. So the rule that exists to prevent
false scope-drift findings is, under concurrency, the rule that produces them.

## Mechanism root

The range is caller-supplied, so its correctness depends on a human/agent judgement that no
amount of care can make right — there is no contiguous range to find. `lore assess` already
knows the plan's tasks, and each task's evidence rows and merge commits are discoverable, so
the tool can assemble the diff from the plan's OWN commit set and stop asking.

Prose is not the fix here: CLAUDE.md line 34 already carries the range-derivation lesson, and
that lesson is what produced the bad range. A defect already covered by prose is proof the
prose layer is the wrong layer.

## Requirement

- `lore assess <plan>` derives the plan's own commit set and builds the diff itself (equivalent
  to today's `--diff-file` with a hand-assembled union), with no caller-supplied range.
- `--diff` / `--diff-file` remain available as explicit overrides.
- The assessment records WHICH commits it diffed, so an auditor can tell a complete diff from a
  partial one — `diff_available=true` alone is not enough information.

## Oracle

- On a plan whose commits are interleaved with another plan's, the derived diff contains the
  plan's own commits and NONE of the foreign ones. Build the interleaved history in a throwaway
  repo — this cannot be asserted against a corpus that happens to be clean.
- CONTROL: a plan whose commits ARE contiguous produces the same diff as today's naive range,
  so the change is not a behaviour break for the simple case.
- BOUNDARY: a plan with zero task commits, and a plan whose commits were squashed, both produce
  a loud, named outcome rather than an empty diff silently reported as `diff_available=true` —
  an empty diff that reads as "audited" is the false-green form of this defect.
