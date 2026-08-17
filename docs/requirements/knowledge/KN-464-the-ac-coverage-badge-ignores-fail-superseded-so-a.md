---
id: KN-464
type: knowledge
role: knowledge
title: "The AC coverage badge ignores fail_superseded, so a criterion re-proved by a newer attested pass renders as failed forever in its spec and its mirror"
status: approved
priority: medium
created: 2026-08-17
updated: 2026-08-17
tags: []
parent: PRD-001
---
`deriveAcCoverageState` grew a `fail_superseded` state (M4, `spec-oracle-tier-falsifiability-
a-criterion-never-observed-red`) with four documented fail-closed tie-breaks, precisely so a
criterion that went red and was then re-proved by a NEWER runner-attested pass would stop
reading as failing. **The spec-body renderer never adopted it.** `outline-service.ts::
acCoveragePrefix` still decides from a raw count:

```ts
function acCoveragePrefix(fact: AcCoverageFact | undefined): "✔" | "✘" | "·" {
  if (fact === undefined) return "·";
  if (fact.fail > 0) return "✘";      // ← never consults deriveAcCoverageState
  if (fact.pass > 0) return "✔";
  return "·";
}
```

So a superseded fail renders **identically to a live one**, in the spec body AND in the
git-tracked mirror export — for the rest of that criterion's life, because `fact.fail` is a
cumulative count that nothing ever decrements.

## Measured 2026-08-17 on AC-OX-6 (`spec-oracle-exclusivity-in-a-shared-checkout-a-mirror-check`)

Full evidence timeline for the criterion, in chronological order:

| recorded_at | result | attested | task |
|---|---|---|---|
| 2026-08-13T06:41:14Z | expected-fail | self | two-mirror-exporters (red-first) |
| 2026-08-17T02:35:41Z | pass | **ATTESTED** | mirror-prune |
| 2026-08-17T02:36:49Z | fail | **ATTESTED** | two-mirror-exporters |
| 2026-08-17T02:37:50Z | pass | **ATTESTED** | two-mirror-exporters |

Newest fail `02:36:49` < newest attested pass `02:37:50`, and both timestamps are usable, so
`isSupersededByNewerAttestedPass` returns `true` and `deriveAcCoverageState` returns
`fail_superseded`. The renderer nonetheless emitted `[✘]`, and `lore export-docs --type spec
--force` wrote that `[✘]` into `docs/requirements/spec/SPEC-136-*.md`, where it is now the
FIRST thing any future reader — human or agent — sees about a criterion that is green.

The middle `fail` row exists because the orchestrator ran `lore done` (a corpus write) and
then `lore verify` WITHOUT converging the mirror in between; three `status_mismatch` rows
appeared and the AC went red for 61 seconds. That red was real and is deliberately retained
rather than deleted — which is exactly the case `fail_superseded` was built for, and exactly
the case the badge throws away.

## Why this is a defect and not a display preference

The corpus already treats "was it ever red" and "is it red now" as DIFFERENT facts — that is
the entire point of M4's four tie-breaks. Collapsing them at the render layer means the
strongest-evidence artifact the corpus produces (an approved spec's own AC checklist,
mirrored into git) cannot express the distinction the data layer went to considerable trouble
to compute. It is the recurring shape: **an outcome the tool renders identically whether or
not it is sound.**

⛔ It also creates a perverse incentive. An author who notices `[✘]` on a green criterion has
one obvious way to clear it: never record the red in the first place. The badge therefore
penalises exactly the honesty the evidence discipline demands.

## Fix direction

`acCoveragePrefix` should route through `deriveAcCoverageState` and render `fail_superseded`
distinctly from `fail` (a third glyph, or `✔` with a marker). ⛔ Not a drive-by edit: the
function's own JSDoc says it "Mirrors AC-ACODE-9's coverage-prefix rule exactly", so the
governing AC predates M4 and must be amended in the same slice — otherwise the change makes
the renderer violate its own declared criterion. Needs a spec, not a patch.

## Four smaller measurements from the same session

1. **`lore anchor add` does NOT demote an approved spec.** Verified before/after on an
   `approved` spec: status unchanged across an 11-anchor add. This is the OPPOSITE of
   `lore ac set` (which demotes to `draft` and hard-blocks every descendant claim) and worth
   knowing, since both are "edit a spec's `extra`" operations.
2. **The `#Symbol` anchor checker is a LEXICAL EXPORT scanner, not a TS parser**, and it only
   recognises EXPORTED symbols. Anchoring `export-docs-service.ts#retireDeletedDocMappings` (a
   module-private function) produced a legitimate `symbol_missing` — not one of the documented
   false-positive forms. ⛔ Do not export a private function to satisfy an anchor; that widens
   the public API surface to please a checker. Anchor the file instead.
3. **A body drift on a doc containing an MDX placeholder is PERMANENT, not repairable.**
   `PRD-001` embeds a `ModuleTree` placeholder, so its rendered body changes every time ANY
   doc is added to the corpus. `lore export-docs --type prd --force` repairs it to "as of
   now" and the next corpus write re-drifts it. Any effort to reach zero body drift across the
   mirror is unachievable by construction for this class of doc.
4. **Path-scoped commits are NOT sufficient isolation in a shared checkout.**
   `git add -A docs/requirements && git commit -- docs/requirements` swept in `KN-462`, a
   knowledge doc a CONCURRENT session had created 40 seconds earlier, under a commit message
   describing an unrelated mirror repair. The standing lesson says commit path-scoped; this
   session measured that under live concurrency the unit must be the explicit FILE LIST, since
   a shared directory acquires foreign files between the `status` read and the `add`.
