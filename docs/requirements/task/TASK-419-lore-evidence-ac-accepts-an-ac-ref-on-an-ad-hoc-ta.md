---
id: TASK-419
type: task
role: plan
title: "lore evidence --ac accepts an AC ref on an ad-hoc task that has no governing spec — unresolvable at write time, permanent by append-only"
status: draft
priority: high
created: 2026-08-01
updated: 2026-08-01
tags: []
parent: PRD-001
---
> ⚠ INVALIDATED 2026-08-01T13:10:57.469Z — superseded by task-check-ac-ref-integrity-re-implements-governing-spec; Diagnosed the causality backwards: the write path resolveGoverningSpecByAcScope is correct and authoritative; the real defect was the detector's narrower private resolver, fixed in the superseding task.

# ⛔ RETRACTED — DO NOT IMPLEMENT

**Superseded by `task-check-ac-ref-integrity-re-implements-governing-spec`.**

This task diagnosed the causality BACKWARDS. It is preserved rather than deleted so the
wrong turn stays auditable, but nothing below should be built.

Retracted 2026-08-01 by `agent:main-orchestrator`, on evidence supplied by the implementer
of `task-split-the-compound-ac-acs-1-ac-acs-4-into-one-assertion` and independently
verified from the main checkout.

## What this task claimed

That `lore evidence --ac` was wrong to accept an AC reference on an ad-hoc task, because
such a task has no governing spec, and that the fix was a write-time admission check
REFUSING those calls.

## Why that is wrong

The write path is correct and is the newer, authoritative mechanism. `@lore/core`'s shared
`resolveGoverningSpecByAcScope` resolves an ad-hoc task's governing spec through its
`extra.ac_scope`, and is already used by `verify-runner-service.ts`,
`task-workflow-service.ts` (`resolveDeclaredAcIdsForAdhocTask`) and `ac-service.ts`.

The defect is on the READ side: `scripts/check-ac-ref-integrity-core.ts:99-110` keeps a
private `resolveGoverningSpec` that walks `task.parent_id -> plan -> plan.parent_id ->
spec` only, so it returns null for every ad-hoc task regardless of `ac_scope`.

Decisive counter-evidence to this task's premise: the very rows it cited as proof —
`AC-069-15` / `AC-069-16` — sit on a task carrying
`adhoc=true, plan_id=null, ac_scope=['AC-069-15','AC-069-16']`. They DO have the ac_scope
required to resolve. They were never unresolvable data; they were data one consumer cannot
see.

Implementing this task as written would have amputated a correct capability in order to
satisfy an outdated consumer.

## The lesson worth keeping

When two mechanisms disagree, the fix direction depends entirely on which side is
authoritative — and that must be established by reading BOTH, not by assuming the one that
reported the error is the correct one. A detector's finding is evidence that something
disagrees, never evidence about which side is right.

---

# Original content (superseded — retained for audit only)

## Defect (as originally, and wrongly, diagnosed)

`lore evidence --ac <id>` accepts an AC reference on an ad-hoc task, which by construction
has no governing spec. The reference can therefore never resolve, and the append-only
evidence log makes it permanent.

Live state on `main` (commit 9aec354), measured 2026-08-01 — exit 2:

```
  task="task-verifyadhoctask-stamps-ac-ref-on-its-runner-attested" ac_ref="AC-069-15" — no governing spec resolvable
  task="task-verifyadhoctask-stamps-ac-ref-on-its-runner-attested" ac_ref="AC-069-16" — no governing spec resolvable
```

The original text proposed refusing such writes at `lore evidence` admission time, on the
reasoning that the rows were unresolvable at the instant they were recorded. That reasoning
is the error: they are resolvable, through a resolver this detector does not call.
