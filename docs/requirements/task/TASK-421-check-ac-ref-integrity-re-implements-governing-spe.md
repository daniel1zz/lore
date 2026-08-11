---
id: TASK-421
type: task
role: plan
title: "check-ac-ref-integrity re-implements governing-spec resolution and its private copy is narrower than the write path — every ad-hoc task with AC-scoped evidence is falsely reported dangling"
status: archived
priority: high
created: 2026-08-01
updated: 2026-08-01
tags: []
parent: PRD-001
links:
  - {id: TASK-419, type: supersedes}
---
## Defect

`scripts/check-ac-ref-integrity.ts` re-implements governing-spec resolution instead of
calling `@lore/core`'s shared resolver, and its private copy is now strictly narrower than
the write path. Every ad-hoc task that records AC-scoped evidence — the supported,
intended flow — is reported by the detector as carrying dangling references it does not
have.

Measured on `main` (9aec354), 2026-08-01.

**Read side** — `scripts/check-ac-ref-integrity-core.ts:99-110`:

```ts
export function resolveGoverningSpec(task, docsById): DocRecord | null {
  if (task.parent_id === null) return null;
  const plan = docsById.get(task.parent_id);
  if (plan === undefined || plan.type !== "plan") return null;   // ← ad-hoc dies here
  if (plan.parent_id === null) return null;
  const spec = docsById.get(plan.parent_id);
  if (spec === undefined || spec.type !== "spec") return null;
  return spec;
}
```

An `--adhoc` task is parented to the ROOT PRD, not a plan (SPEC-069 D2). Line 105's
`plan.type !== "plan"` therefore returns null for every ad-hoc task, whatever its
`extra.ac_scope` declares. The walk is structurally incapable of succeeding.

**Write side** — `resolveGoverningSpecByAcScope` (`@lore/core`), already the shared
resolver used by `verify-runner-service.ts:916`, `task-workflow-service.ts:847`
(`resolveDeclaredAcIdsForAdhocTask`) and `ac-service.ts`. It resolves via `ac_scope` and
handles ad-hoc tasks correctly, with zero/multi-match refusal.

So `lore evidence --ac AC-X` on an ad-hoc task is ACCEPTED (correctly — the id resolves,
`lore ac list` shows the coverage), and the detector then reports that same row as
dangling. Both mechanisms are behaving as written; they simply disagree.

## Live consequence

Six reported dangling refs, all false:

- `task-verifyadhoctask-stamps-ac-ref-on-its-runner-attested` — `AC-069-15`, `AC-069-16`.
  This task carries `adhoc=true, plan_id=null, ac_scope=['AC-069-15','AC-069-16']`. It has
  the ac_scope needed to resolve. These were never bad data.
- `task-split-the-compound-ac-acs-1-ac-acs-4-into-one-assertion` — `AC-ACS-1/4/8/9`,
  written 2026-08-01 by a slice that used `--ac` exactly as intended.

`bun scripts/check-ac-ref-integrity.ts` exits 2 on a corpus with zero real dangling refs.
AC-ACS-7, which binds to this detector, is consequently red for a reason that has nothing
to do with reference integrity.

## Mechanism root — a second implementation of a shared rule

The file is careful about this elsewhere and says so: `extractDeclaredAcIds`
(`check-ac-ref-integrity-core.ts:112-124`) documents that it validates against *"the SAME
shared shape `AcService`/`computeAcCoverage` validate against — never a second parse
convention."* The AC-id extraction obeys SSOT; the spec RESOLUTION beside it does not.

That asymmetry is the whole defect. A private copy of a resolution rule cannot be kept in
step with the shared one — it drifted the moment ad-hoc support landed, and nothing failed
loudly, because a narrower resolver produces a plausible-looking finding rather than an
error.

⛔ This retracts and replaces `task-lore-evidence-ac-accepts-an-ac-ref-on-an-ad-hoc-task-that`,
which diagnosed this backwards — it proposed making `lore evidence --ac` REFUSE ad-hoc
tasks. That would have amputated the newer, correct capability to satisfy the older, narrower
consumer. The direction of a fix depends entirely on which side is authoritative, and here
it is the write side.

## Requirement

1. The detector resolves a task's governing spec through the SAME shared resolver the write
   path uses. ⛔ Do not add an ad-hoc special case beside the existing walk — that is a
   third implementation of the same rule. Call the shared one.
2. A genuinely unresolvable reference must STILL be reported. Widening resolution must not
   turn the detector into one that cannot fail — see the control below.
3. After the fix, disposition the six rows: they should resolve, not be exempted. ⛔ No
   ledger entries — none of these criteria were retired or merged, which is the only thing
   a ledger row may assert.

## Oracle

- `bun scripts/check-ac-ref-integrity.ts` exits 0 on the real corpus, with the six rows
  above resolving rather than exempted. ⛔ Measure unpiped (`cmd > out 2>&1; echo $?`).
- **CONTROL — the detector must still be able to fail.** Construct a throwaway corpus with
  a genuinely dangling ref (an `ac_ref` naming an id declared on NO spec, reachable by
  neither resolver) and assert exit 2 naming that row. Without this the fix is
  indistinguishable from disabling the check. This is the single most important assertion
  in this task.
- REGRESSION: a plan-bound task whose ac_ref resolves through the plan walk still resolves,
  and one naming an id its spec does not declare is still reported.
- BOUNDARY: an ad-hoc task with an EMPTY `ac_scope` (`--ac-scope ""`, the explicit
  "claims none" state, distinct from omitting it) and an `ac_ref` — decide the outcome
  deliberately and assert it; it must not silently resolve.
- BOUNDARY: `resolveGoverningSpecByAcScope`'s zero-match and multi-match refusals reach the
  detector's output as distinct, named outcomes rather than collapsing into "no governing
  spec resolvable".
- Never write to this repo's `.lore/` corpus from a test — throwaway corpora only.
