---
id: TASK-418
type: task
role: plan
title: "A task cannot be retracted: --supersedes emits a repair command that structurally cannot work, and a draft task has no deprecation path visible to list/ready/search"
status: archived
priority: high
created: 2026-08-01
updated: 2026-08-01
tags: []
parent: PRD-001
---
## Defect 1 — `--supersedes` on a task emits a remediation command that cannot work

Measured 2026-08-01:

```
lore create task --adhoc ... --supersedes task-lore-evidence-ac-accepts-an-ac-ref-on-an-ad-hoc-task-that

Created task document ... Status: draft (v1)
Error: new doc created but NOT superseded — run: lore invalidate task-lore-evidence-ac-accepts-an-ac-ref-on-an-ad-hoc-task-that --superseded-by task-check-ac-ref-integrity-re-implements-governing-spec
  (invalidate failed: Error: Validation failed on field 'type': Validity metadata only applies to knowledge/adr documents; got type "task")
```

The half-failure is correctly LOUD (SPEC-043 D11) — but the repair command it names is the
exact command that just failed, for a reason no retry can change. `lore invalidate`
structurally rejects `type: "task"`. An operator following the instruction verbatim fails
identically a second time.

The precondition is knowable BEFORE the write: the target's type is read to look it up.
`--supersedes` pointing at a type `invalidate` cannot accept should be refused up front
(exit 4), naming the supported types — not accepted, half-applied, and then remediated with
a dead end.

⛔ Same shape as the already-catalogued lesson that a gate's remediation must not point at
something the caller cannot run. A remediation that cannot succeed is worse than none: it
costs a retry and misdirects the diagnosis onto the target doc.

## Defect 2 — a task has no retraction path at all, and this is the load-bearing half

`lore invalidate` covers knowledge/adr only. For a task the remaining options are:

- `VALID_TRANSITIONS` — `draft` cannot reach `deprecated` (only `approved -> deprecated`
  and `active -> deprecated` exist). A wrong task caught while still `draft` — the normal
  case, since that is when it gets reviewed — cannot be deprecated at all.
- `lore delete` — destroys the record and the audit trail of the wrong turn.
- Editing the body to say RETRACTED — what was actually done here.

The body edit is invisible where it matters. `lore list --type task --status draft` still
lists it, `lore ready` still counts it, and search still returns it with no badge. A future
session picking work off those surfaces has no signal at all. Compare `lore invalidate`,
which filters list/search by default and forces a banner onto direct reads — that is the
behaviour a retraction needs, and tasks cannot have it.

This is not hypothetical: a task filed this session diagnosed a defect backwards, was
retracted within the hour, and the only durable marker is prose inside its body.

## Requirement

1. `lore create --supersedes <target>` validates the target type BEFORE creating, and
   refuses with exit 4 naming the supported types when it cannot be honoured.
2. A task (and any execution-scoped doc type) gets a first-class retraction that is visible
   to the READ surfaces, not only in its body. Decide deliberately between extending
   validity metadata to tasks and adding a `draft -> deprecated` transition, and state why
   in the completion report. ⛔ The chosen mechanism must affect `lore list`, `lore ready`
   and `lore search` — a marker only a full-body read reveals is what already exists and is
   what failed.
3. Retraction must never require `lore delete`. The wrong turn stays auditable.

## Oracle

- `lore create <type> --supersedes <a-task>` exits 4 and creates NOTHING. ⛔ Assert the
  doc count is unchanged — a refusal that still creates the doc is the current bug with a
  better message.
- CONTROL: `--supersedes` against a knowledge/adr target still works end to end
  (create + invalidate both applied) — assert unchanged.
- A retracted task does not appear in default `lore list --type task`, is absent from
  `lore ready`, and a direct `lore get` carries a retraction banner naming the superseding
  doc.
- CONTROL proving the filter is not over-broad: a normal draft task is still listed and
  still ready.
- REGRESSION: the retracted task is still retrievable by explicit id/slug and its version
  history is intact — retraction is not deletion. Assert `lore log` still shows the
  pre-retraction versions.
- BOUNDARY: retracting an already-archived task, and retracting a task another session
  currently holds a claim on, each produce a named outcome rather than a silent success.
