---
id: TASK-415
type: task
role: plan
title: "AC-ACS-1 and AC-ACS-9 are still compound after the split — the predecessor task's Scope defined a half that was itself a conjunction, contradicting its own acceptance criterion"
status: archived
priority: medium
created: 2026-08-01
updated: 2026-08-01
tags: []
parent: PRD-001
---
## Defect

`task-split-the-compound-ac-acs-1-ac-acs-4-into-one-assertion` landed (archived
2026-08-01, spec at v28) and cut the two halves it named — but two of the four resulting
criteria are STILL compound, so the condition that task existed to remove survives on
them.

Measured from `lore ac list spec-lore-ac-set-in-place-edit-of-a-declared-acceptance` after
the split:

- **AC-ACS-1** — *"lore ac set … exits 0, the id is unchanged and the criterion count is
  unchanged"* → **three** independently testable claims (exit status; id preserved; count
  preserved), one bound test title.
- **AC-ACS-9** — *"lore ac set on a draft spec leaves it at status draft, and lore log
  records no status-transition entry for the edit"* → **two** claims (resulting status;
  absence of a log entry), one bound test title.

AC-ACS-4 and AC-ACS-8 are genuinely single-assertion. The split was half-done by
construction, not by execution error.

## Mechanism root — the originating task contradicted itself

The predecessor task carried two clauses that cannot both be satisfied:

- Its acceptance criterion: *"each resulting AC names exactly ONE assertion. An AC whose
  statement still contains a conjunction of two testable claims has NOT been split."*
- Its Scope section: *"AC-ACS-4: halves are (a) approved→draft demotion, (b)
  **draft-stays-draft AND `lore log` records no status-transition entry**."*

The Scope defines a "half" that is itself a conjunction. An implementer following Scope
produces exactly what the AC forbids, and the AC then reads as satisfied because the named
cut was made. The implementer followed Scope and was right to — Scope was the more
specific instruction. Nothing failed loudly; the residual is only visible by re-reading the
resulting statements, which is precisely the manual step a criterion is supposed to replace.

⛔ The transferable lesson, and the reason this is filed rather than silently fixed: a
task that decomposes something must have its OWN decomposition satisfy the standard it
imposes. Enumerating the halves in prose is where the standard silently lapses — the
enumeration looks like the answer, so it is not re-checked against the rule stated three
paragraphs above it.

## Requirement

Split AC-ACS-1 into its three claims and AC-ACS-9 into its two, each with its own bound
oracle, following the same in-place shape the predecessor established (`lore ac set` to
narrow the original id, `lore ac add` for each new id — never `rm` + re-add, which is what
produced the historical dangling refs).

⛔ Every new id must land with its own evidence IN THIS SLICE. A declared-and-unverified
criterion is a worse corpus state than an honestly-compound one — that reasoning is the
predecessor's and it applies unchanged here.

⛔ Before writing the new statements, verify NONE of them contains a conjunction of
testable claims. Apply the rule to your own output; that is the exact step whose omission
caused this task to exist.

## Governance side effect to expect

Editing declared criteria demotes the approved spec to `draft` (D2). The slice ends with a
real review and a g2 re-promotion via `lore approve` — never `set --status`. Budget for it.

## Oracle

- No criterion on the spec contains a conjunction of two testable claims. ⛔ Assert this
  mechanically over the declared statements, not by reading them — a manual read is what
  missed it the first time. A simple detector (conjunction token present in a statement)
  is acceptable and its false-positive rate is a design question to state, not a reason to
  skip it.
- Each resulting id carries ≥1 evidence row of its own.
- Each bound `-t` filter matches EXACTLY ONE test. The predecessor verified this and it
  must stay true — a filter matching zero silently passes, and one matching several
  re-creates the compound problem in the runner instead of the statement.
- CONTROL, per new criterion: inverting its assertion makes its oracle go red; record that
  run as `--result expected-fail`.
- REGRESSION: AC-ACS-4 and AC-ACS-8 are untouched, keep their refs, and `bun run
  scripts/check-ac-ref-integrity.ts` gains no NEW dangling ref beyond the six already
  explained by the detector's resolver gap
  (`task-check-ac-ref-integrity-re-implements-governing-spec`).
