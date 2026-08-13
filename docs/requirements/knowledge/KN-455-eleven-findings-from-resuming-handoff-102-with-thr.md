---
id: KN-455
type: knowledge
role: knowledge
title: "Eleven findings from resuming handoff-102 with three concurrent implementers: lore list hides invalidated docs behind a self-consistent total, and both judge surfaces score text they were never shown"
status: approved
priority: medium
created: 2026-08-13
updated: 2026-08-13
tags: []
parent: SPEC-136
---
# Retro — eleven findings from resuming handoff-102 with three concurrent implementers

Session of 2026-08-13, resumed from `knowledge-handoff-agent-main-orchestrator-102`
(19 items: 13 decisions + 6 next steps). Three `lore-implementer` agents dispatched in
parallel; all three landed. Every finding below is a measurement made this session, with
the command or file that produced it. Ordered by how badly each one can mislead a future
session, not by when it was found.

## 1. `lore list` silently omits invalidated docs AND reports a self-consistent total

The single most dangerous finding, because every internal check a caller could run passes.

`lore list --json --limit 3000` → `data.docs` 1475, `data.total` 1475. Per-type sums agree
*exactly* with that filtered total: prd 1 + spec 151 + adr 33 + plan 129 + knowledge 436 +
task 725 = 1475. Add `--include-invalid` → **1495** (knowledge 436→453, task 725→728).
All 20 hidden docs are LIVE: `deleted_at` null, statuses approved/draft, each reachable by
`lore get` — e.g. `01KZ17MQ8J8F8SZDSTRD0WFH2D` (`knowledge-handoff-agent-main-orchestrator-72`,
approved), `01KZDVRPHX1FDXYBTDTXGDHG9Q` (`task-deriveaccoveragestate-fails-open-on-an-absent-fals`,
draft).

Consequence, measured: a census joining `.lore/export-index.json` against the default list
reported **21 orphan mappings**. The true count is **1** (KN-025, genuinely soft-deleted,
`deleted_at` 2026-07-18). A **21x error** — and it reached an acceptance criterion's
statement as a pinned baseline before being caught, by me, the same session I was
enforcing the rule against literal corpus counts. Filed `01KZWZS5F3JJ6709EYRTP142RG`.

This is the unlisted direction of the existing "a listed doc is NOT proven live" lesson,
and it is strictly worse: **a doc absent from every list is not proven absent**, and no
signal says a filter ran. Cross-checking with `lore get` cannot save you — you only think
to address a doc directly if you already suspect it exists.

## 2. Both AI-judge surfaces score truncated-away text as a defect; only one warns

`lore review` on `plan-land-oracle-executability-...` returned escalate/0.68 with three
blocking questions. Two were artifacts: it reported the parent spec "truncated mid-cell at
D2" and asked "what is D8? never defined" — D8 IS defined, as its own section at index
9655 of the spec's 11879 bytes, i.e. 1684 bytes past the cut. The plan's own content is
only 725 bytes, so the truncation was in review's assembled *parent context*. Only the
third question (M6.4 phase ownership) was real, and I fixed it.

The asymmetry is the actionable part: when review truncates the **subject** document it
emits a Truncation Notice and the judge correctly discounts the cut region (observed on
`spec-multi-session-concurrency-...`: "Per the Truncation Notice, only trailing content
within the final section was cut"). When it truncates the **parent context** there is no
notice. `lore assess` has a manifest but no discount rule at scoring time — the prior
session measured 2 of 3 MAJORs scored against files inside its own 445736-vs-80000-byte
manifest, both false. Filed as a pair: `01KZWVCPCTKAVXZ3068HRZ8SGK` (review),
`01KZWW60FGGEC2GK1FB36A7BD5` (assess). Half the mechanism already exists on one surface.

## 3. A subagent cannot distinguish the orchestrator's concurrent writes from pre-existing drift

Both mirror-facing agents independently hit the same three unexported docs and one
concluded they were "pre-existing drift on main, stable across the whole session". They
were **mine**, created at 06:01:45 / 06:15:34 / 06:16:42 UTC while it ran — two filed
defect reports and one reference doc. It looked stable only because every measurement
happened after I created them. Its reasoning was sound and its conclusion wrong; nothing
available to it could have told the difference.

⇒ A dispatch bundle that names a live shared-resource baseline MUST also say the
orchestrator will keep writing to it, and forbid pinning any literal count. I sent that
correction mid-flight to one agent; the other had already finished.

## 4. `lore done` offers a paste-ready archival command for a plan that was never decomposed

After the last `mechanism`-phase task archived, `lore done` printed "no more non-terminal
tasks — every child task is now archived… run: `lore set <plan> --status archived`".
Measured immediately after on the same plan: `lore phase list` shows THREE declared phases;
task distribution is mechanism=4, no-phase=1, **corpus-cleanup=0, backlog-and-arm=0**. Its
spec carries AC-OX-6/7/11 at zero evidence — exactly the `backlog-and-arm` deliverables.
The plan is roughly one third done. "Every child task is archived" is trivially satisfied
by a phase with no tasks. Filed `01KZWYPEQBTCT8XF72D29R7X4Q`. The handoff's KD11 warned
against pasting exactly this; I did not paste it.

## 5. `lore set --content-file` accepts a 65%-shrinking replacement in silence

Self-inflicted. A shell variable pointed one directory above the intended file, so the `cp`
that should have prepended the preserved head failed while the appending heredoc succeeded.
`lore set` wrote the fragment without comment: a 3125-byte, 5-heading task body became a
1497-byte fragment, deleting all three sections of measured mechanism — on a task that was
**claimed and being read by a running implementer**. Recovered from a scratchpad copy
(→ v9, verified 6 headings). Filed `01KZWXKD0ZED5Q8B5R4JJCQ3ZH`.

The existing rule ("read back the current value before writing a shared field") did not
help, and cannot: I *did* read it back. The failure was one step later, in assembly, and
the author believes they preserved the content. A volume-delta report is a mechanism;
"read it back first" is not. Second-order lesson applied for the rest of the session: every
subsequent content write asserted `new.startswith(orig)` before calling `lore set`.

## 6. Adding an AC without updating the spec's prose makes the spec unapprovable — correctly

`lore ac add` does not demote an approved spec (re-verified: v23→v24→v25 all `approved`),
so AC-OX-5 and AC-OX-6 landed with no gate complaint. But the spec's **body** still said
"Attached as **AC-OX-1 … AC-OX-4**" and its Scope listed no file that could satisfy either
new criterion. `lore review` escalated on exactly that, and it was right. Fixed by adding
D7, D8, two AC entries and four Scope files, then re-approving (v28).

⇒ This is the governance-layer isomorph of "capability implemented ≠ production wired":
`ac add`'s permissiveness means the AC set and the prose that governs it drift apart
silently, and only the judge catches it.

## 7. `--check` catches a MISSING mirror file; it does not catch a WRONG one — KD4 conflated these

`bun scripts/export-spec-mirror.ts --check` exits 2 and names, per type, every corpus doc
with no mirror file, printing the reconcile command. It caught 3 such docs and said so. The
real blind spot is narrower: a file that EXISTS whose content disagrees. Body drift is
compared; frontmatter was not. Stating it imprecisely made the tool look more broken than
it was and hid which half needed fixing.

## 8. The agent's "merge hazard" commit WAS the back-catalogue sweep

W1 committed a 211-file mirror snapshot it labelled a side-effect of `test:changed`, and
flagged it as a merge hazard. That commit is what actually repaired the 203 status
mismatches: the write-mode export fired *after* it had fixed `export-docs-service.ts`, so
it ran with the corrected exporter. My own post-merge `mirror:export` only picked up the 4
files created since. Verified independently: `status_mismatch = 0` measured with
`--include-invalid` (see §1), down from 202 at `9736bdb9`.

## 9. "Mid-run" was ambiguous and cost a wrong hypothesis

I told W2 the mirror write could not be `runMirrorScript([])` because `test:bun` runs only
`.bun.test.ts` while that file is vitest — and concluded AC-OX-1's grep must be blind to
the real surface. Wrong. `package.json`: `test` is `oracle-lock.ts sh -c "test:vitest &&
test:bun && check:spec-mirror"`. The vitest phase runs FIRST in the same invocation; its 12
write-mode calls regenerate frontmatter; `test:bun`'s `assertRepoCorpusClean("before")`
then trips on the preceding phase's dirt. "Mid-run" meant mid the overall run. The AC's
grep was aimed correctly and needed no widening. W2 measured this and contradicted me,
which is the outcome a dispatch bundle should make easy rather than discourage.

## 10. A line-number pointer in CLAUDE.md had drifted 277 lines

The standing lesson cited `corpus-service.ts:2029` for the plan-close gate; the gate is now
at `:2306` (`isPlanClosing`), and `:2029` is slug-uniqueness handling. A future session
following that pointer reads unrelated code and may conclude the gate is absent — which is
precisely the false claim that line was written to correct. Replaced with the symbol.
⇒ CLAUDE.md pointers must be greppable symbols, never line numbers.

## 11. Two live approved specs share the `AC-OX-*` prefix

`spec-oracle-exclusivity-...` (6 criteria) and `spec-oracle-executability-...` (11) both
use it, and `ac_scope` stores a bare id string. Resolution is unambiguous only via
plan→spec. Both were in flight this session and one task's `ac_scope: ["AC-OX-4"]` refers to
the *executability* AC-OX-4 while a sibling plan's AC-OX-4 is about a lock mutex. I put an
explicit warning in all three dispatch bundles. Not filed as a defect — but any tooling
that resolves an AC id without its spec context is unsound.

---

## Evicted from root CLAUDE.md this session (archived verbatim for traceability)

Removed to fit findings §1 and the §8/§7 correction under the byte ceiling. Recorded here
so nothing is lost:

> - `lore assess --diff`: derive the range from the plan's own first task commit.

> - Static discipline belongs in CLAUDE.md layers, never in a hook (hooks carry computed state only).

The superseded mirror lesson, replaced rather than evicted, previously read:

> - ⛔ ANY corpus write reddens the next full-suite run until the mirror is re-exported AND
>   committed — but NO invocable command re-exports a status change: drift detection is
>   body-only (`export-docs-service.ts:499`, "blind to frontmatter by design"), so
>   `mirror:export`, `--force` and `check:spec-mirror` all print OK while an archived task
>   reads `draft`. Only the SUITE writes it, so let it dirty the tree once and commit that.
>   Two sessions sharing one checkout poison each other.

Its "NO invocable command" clause became FALSE on 2026-08-13: `bun run mirror:export`
repairs status/frontmatter drift unconditionally, and the suite no longer writes the mirror
at all. Body drift still requires `lore export-docs --force`.
