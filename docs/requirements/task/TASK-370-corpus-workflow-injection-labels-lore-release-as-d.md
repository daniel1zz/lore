---
id: TASK-370
type: task
role: plan
title: "corpus-workflow injection labels 'lore release' as Done and never mentions 'lore done' — 13/13 agents left a plan's readiness inflated at 34/34"
status: archived
priority: high
created: 2026-07-30
updated: 2026-08-04
tags: []
parent: PRD-001
---
# Defect — the shipped corpus-workflow snippet names `lore release` as the completion step and never mentions `lore done`

The session-start corpus-workflow snippet's EXECUTE section ends with:

```
- Done → `lore release <task>`. Readiness is always computed, never hand-marked by anyone.
```

`lore done` appears **zero times** in the file. Measured on `main @ 6788989` by the
orchestrator:

| probe | result |
|---|---|
| `grep -c "lore done" assets/governance/corpus-workflow.md` | `0` (exit 1) |
| `grep -c "lore done" assets/agents/lore-implementer.md` | `0` (exit 1) |
| `grep -n "lore release" assets/governance/corpus-workflow.md` | line 34, as the completion step |

Since `release` only clears the advisory lease and never moves `approved → active → archived`,
every task finished by following the injected text stays in the ready set **forever**. Observed
across 13 concurrent implementers on one plan, which left that plan's readiness inflated at
34/34 for a full round; the handoff's progress line degraded into hand-counted inference.

## Delivery surface (binding — `adr-distribution-first-every-improvement-names-its-consumer`)

SSOT is `assets/governance/corpus-workflow.md`, shipped to consumers through the embedded
manifest (`packages/lore/src/generated/assets-manifest.ts`, entry
`governance/corpus-workflow.md`, carrying a per-file sha256 and feeding `lore setup --check`'s
five-state freshness classification).

⛔ A fix that edits only this machine's `~/.claude/` copy does not exist for consumers. The edit
MUST land in `assets/` and the manifest MUST be regenerated, or `lore setup --check` will
classify every freshly-set-up environment against a stale digest.

- Regenerate: `bun scripts/embed-assets-manifest.mjs`
- Verify freshness (never writes): `bun scripts/embed-assets-manifest.mjs --check`

# Mechanism root — the prose names the step that is easy to reach, not the step that closes the loop

`release` is what an implementer can legitimately run from inside its own worktree; `done` is
what only a party who can assert "this is merged into main" may run. The snippet collapses that
two-party protocol into one verb, and the verb it kept is the one that does NOT archive. Nothing
downstream detects the omission: readiness is computed, so a never-archived task is
indistinguishable from an unstarted one — it simply keeps reporting `ready: true`.

This is the same shape as the false-oracle family: the visible signal (lease cleared, agent
reports success) is a proxy for the property (the task left the ready set), and the proxy is
satisfiable without the property.

# Required fix

1. In `assets/governance/corpus-workflow.md`'s EXECUTE section, replace the single `Done →
   lore release` bullet with the two-party protocol:
   - `lore release <task>` drops the advisory lease ONLY — it does not archive and does not
     remove the task from the ready set.
   - `lore done <task>` is the sole command walking `approved → active → archived`, and belongs
     to whoever can assert the work is merged into main. An implementer inside its own worktree
     structurally cannot assert that, so it stops at `release`.
2. Judgment required, stated in your report: `assets/agents/lore-implementer.md:56` ends the
   implementer's own sequence at `lore release`. For an implementer that is CORRECT. Decide
   whether it needs an explicit "and the orchestrator archives after merge" sentence so the
   reader does not conclude the task is finished, or whether adding it duplicates governance
   into an agent file. State which you chose and why — do NOT silently rewrite the agent file
   to mirror the governance file.
3. Regenerate the manifest and prove freshness with `--check`.

⛔ Do NOT add the fix to this repo's root `CLAUDE.md`: root headroom is 63 bytes / 13 lines
(24513/24576 measured 2026-08-03) and `lore status --check-claude-md` enforces the ceiling.

# Acceptance criteria

- **AC-1** `grep -c "lore done" assets/governance/corpus-workflow.md` prints a count `>= 1`.
  ⚠ contiguous-substring assertion — pair it with AC-2, which does not depend on any phrase.
- **AC-2** the snippet states, in the EXECUTE section, BOTH that `release` does not archive AND
  that archival belongs to the party who can assert "merged into main". Assert by a test that
  reads the shipped asset and checks for the two independent semantic conditions (two distinct
  lone tokens: `done` near `archiv*`, and `release` near a negation of archival) — never one
  remembered sentence.
- **AC-3** `bun scripts/embed-assets-manifest.mjs --check` exits **0** after the edit, and the
  manifest entry's sha256 for `governance/corpus-workflow.md` differs from
  `1bc6107144914ae357d7b661f53356c5a288f8d3e88ab50e9e63577db7dbbd65` (its pre-fix value).
  Assert BOTH: `--check` alone would pass on an unmodified tree.
- **AC-4** NEGATIVE control: with the asset edited but the manifest NOT regenerated,
  `bun scripts/embed-assets-manifest.mjs --check` exits **non-zero**. Measure this before
  regenerating — it proves the freshness oracle is live rather than vacuous.
- **AC-5** REGRESSION: no other `assets/` file's manifest sha256 changes. Diff the manifest and
  assert exactly one entry moved.
- **AC-6** `bun run typecheck` clean; `bun run test:changed <base>` passes with a NON-ZERO
  selection (loud-zero rule).
- Six-dimension coverage (HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION).

# Proxy / Silence / Opt-in (binding — `adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the`)

**Proxy.** "The agent ran the completion command it was told to run" is a proxy for "the task
left the ready set". Concrete input satisfying the proxy while violating the property: all 13
implementers on the observed plan. The fix names the second command, so the proxy and the
property coincide for a reader who follows the text. Residual, stated: prose cannot force the
call — an orchestrator that skips `lore done` still inflates readiness, and only the
`ready === true` filtering discipline catches that.

**Silence.** Total today: a never-archived task reports `ready: true` exactly like an unstarted
one, so the omission is invisible at every downstream read. The fix does not add a signal; it
removes the instruction that produces the silence. ⛔ Do not attempt to make the omission loud
by having `release` warn — that is a separate mechanism decision, out of this task's scope, and
guessing at it here would ship an unreviewed behaviour change.

**Opt-in.** None. The snippet is injected unconditionally where configured.
