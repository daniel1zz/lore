---
id: SPEC-137
type: spec
role: spec
title: "Judgment surfaces must verify before they certify: machine-checked finding paths, a mirror-free assess diff, a falsifier that sees its own worktree, and a close gate that asks about reds"
status: approved
priority: high
created: 2026-08-11
updated: 2026-10-10
tags: []
---
# Overview

Two judgment surfaces in this repo certify claims they never checked. `lore assess` emits findings
that name file paths with no verification that those paths exist at the commit it assessed, and its
score is computed over them. `lore done`/`plan-close` requires a runner-attested pass per declared AC
but never asks whether an AC that declares a falsifier has ever been shown to go RED — so the
strongest evidence tier in the corpus can certify a criterion nobody has falsified.

One principle: **a judgment surface must verify what it can decide mechanically before it certifies
anything.** Path existence is decidable. Whether a declared falsifier has produced an attested red is
decidable. Neither is checked today.

Measured on `main` @ `6be150ef`…`4989f6fe`, 2026-08-11.

## Problem — assess side

**A MAJOR finding was exactly BACKWARDS, and nothing could have caught it.** An `assess` MAJOR named a
filename as defective when that name was the *source* side of rename `R099` in `b791d657` — i.e. the
very name the assessed merge FIXED. The file exists at neither `HEAD` nor the worktree. An independent
scan found 0 filename-vs-id mismatches. The finding was scored anyway.

**There is no field to verify.** `typedGapSchema` (`packages/core/src/assessment.ts:390-395`) is
`{ dimension, severity, ac_ref?, statement }` — `statement` is free text capped at 500 chars and there
is **no path field at all**. The legacy `gaps: string[]` array is the same. So "verify the paths a
finding names" is not a matter of validating an existing field; the field does not exist, and
extracting paths from prose would be a heuristic layered on a heuristic.

**There is no verification of any kind after the judge returns.** No `fs.existsSync`, no
`git cat-file`, no path check anywhere on the assess result path.
`suppressUngroundedAbsenceFindings` (`packages/lore/src/service/ai-provider-service.ts:338`) filters on
`based_on: "absence"` credibility only — it says nothing about whether a named path is real.

**The score cannot be recomputed after the fact.** Severity→score arithmetic lives inside the judge
LLM, not in this codebase: the model emits `overall_score` and per-AC `score` directly. So dropping an
unverifiable finding cannot be compensated by re-deriving the number. Any design that pretends
otherwise would be inventing arithmetic the corpus has never used.

**The assessed commit IS recorded, so verification has a stable referent.**
`packages/lore/src/adapters/cli/commands/assess.ts:397` persists
`extra.diff_source` — a `DiffSourceRecord` carrying `mode`
(`explicit_diff | explicit_diff_file | explicit_diff_text | auto_derived`), the `range` for explicit
modes, and `commits[]` for auto-derived. There is no excuse of "we don't know which commit".

**The diff budget is spent mostly on generated content.** `assess-template.ts:615` calls
`truncateDiffByFile(diffText, budgets.max_diff_chars)` with **no path exclusions of any kind**. One
measured run truncated 5.3M characters down to the budget, and the bulk of that 5.3M is the generated
mirror under `docs/requirements/**` — a projection of the corpus the judge is already reading. Real
source hunks were dropped to make room for it.

## Problem — attestation side

**`--capture` looks attested and is not.** `capture_source: "runner"` is written by three sites:
`verify-runner-service.ts:1079` and `:1600` (both also write an `attestation` block with `exit_code`),
and the CLI at `packages/lore/src/adapters/cli/commands/evidence.ts:429` (which writes
`capture_source: "runner"` and a real `output_tail` but **no `attestation`**, the default at `:382`
being `"self-report"`). So a `--capture` row carries the runner label without the runner's proof.

**The close gate never asks about reds.** `attestationFloor`
(`packages/lore/src/service/gate-predicates.ts:1102-1198`) requires that every declared-scope
script-mode criterion carry ≥1 entry whose `attestation !== undefined`. It does **not** examine the
row's `result`, and it does **not** know whether the AC declares a falsifier. An AC can therefore
declare a falsifier, never once be shown to go red, and still close on an attested green.

**A falsifier cannot see the code it is meant to falsify.** `verifyFalsifier`
(`verify-runner-service.ts:1414-1418`) resolves its execution root at `:1528-1529` as
`const repoRoot = this.config.repoRoot; createFalsifierScratchWorktree(repoRoot)`. `config.repoRoot`
comes from `findLoreDbPath`, which walks UP from the caller's cwd and lands on the MAIN checkout when
the caller is in a linked worktree. SPEC-063 already ships a pure `resolveVerifyExecutionRoot` for
exactly this; `_runFalsifier` does not call it. So a falsifier run from a worktree mutates and compiles
the main checkout's code, never the caller's uncommitted work — silently, with a green.

## Decisions

- **D1 — findings declare their paths explicitly.** `typedGapSchema` gains
  `paths: z.array(z.string()).default([])`, and the judge prompt requires every path a finding names in
  prose to also appear in `paths`. Explicit declaration beats regex-extracting paths from a 500-char
  free-text field; a heuristic extractor would itself become an unverified surface.
- **D2 — every declared path is machine-verified against the assessed commit** resolved from
  `extra.diff_source`, using `git cat-file -e <commit>:<path>`. A path may legitimately be absent from
  the worktree while existing at the assessed commit, and vice-versa — the assessed commit is the only
  correct referent, and ⛔ `HEAD` is never substituted for it, because substituting `HEAD` reproduces
  precisely the defect this spec exists to fix. The referent is pinned per
  `DiffSourceRecord.mode`, exhaustively:
  - `explicit_diff` / `explicit_diff_file` carrying a `range` `A..B` → **`B`**, the tip. `B` is the tree
    state the judge was shown; `A` is the baseline it was compared against, and the merge base is
    neither.
  - `auto_derived` carrying `commits[]` → the **newest** entry. ⛔ Not every commit: a path created
    partway through the derived range exists at the tip and not at the earliest commit, so an
    all-commits rule would withdraw findings about newly added files.
  - `explicit_diff_text` — no range and no commits, so there IS no referent. Verification is **SKIPPED
    and recorded as `unchecked`** in `paths_verified`, never silently counted as verified and never
    hard-failed. Hard-failing every text-mode assess would remove a working surface to gain nothing,
    and falling back to `HEAD` would be the original bug. `unchecked` MUST render distinctly from
    `checked` so a reader can never mistake "we did not look" for "we looked and it was fine`.
- **D3 — an unverifiable finding is stripped from the scored set, recorded verbatim, and flagged; the
  score is NOT recomputed.** Because the arithmetic lives in the judge (see Problem), silently keeping
  a score computed over withdrawn findings and silently re-deriving one are both wrong. Instead:
  the finding moves to a new `unverifiable_findings[]` with the failing path and the commit it was
  checked against, the assessment records `paths_verified: { checked, unverifiable, unchecked }` — the
  THIRD state is D2's `explicit_diff_text` case, where no referent exists, and it MUST render distinctly
  from `checked` so a reader can never mistake "we did not look" for "we looked and it was fine" — and
  the verdict
  is marked so a reader can see the score was formed over a set that included N withdrawn items.
  ⛔ Nothing is dropped silently — a disappeared finding is as misleading as a false one. (A judge
  re-ask with the bad findings removed was considered and rejected: it doubles cost and makes the
  assessment non-reproducible for a fixed `prompt_version`.)
- **D4 — the assess diff excludes the generated mirror.** `docs/requirements/**` is removed from the
  diff before `truncateDiffByFile` sees it, so the budget is spent on source. The exclusion list is a
  named constant, not an inline pathspec, so it has one definition site.
- **D5 — `verifyFalsifier` resolves its execution root through SPEC-063's
  `resolveVerifyExecutionRoot`**, so a falsifier run from a linked worktree scratches off THAT
  worktree and sees its uncommitted code.
## Deferred — the falsifier close-gate and its exemption ledger

⛔ **`attestationFloor`'s falsifier clause and the exemption ledger that would absorb its
back-catalogue are DEFERRED out of this spec, deliberately, and this section is the record of why.**
Six successive review rounds each surfaced a real hole in the exemption design, and the last round
reached one that is not a wording problem:

1. **The corpus does not record when an acceptance criterion was authored.** `lore ac add` does not
   demote an approved spec, so a criterion can be appended today to a spec whose plan archived last
   month. Any arming-window rule keyed on plan archival therefore admits criteria authored long after
   arming — the exact hole that ruled out a plain date cutoff. Without per-criterion authorship data,
   no cutoff predicate over criteria is decidable.
2. **The ledger would be an ordinary editable JSON file while ledger PRESENCE is sufficient for
   exemption.** A hand-added pair bypasses every enrolment control without tripping a
   stale-entry check, whose failure condition is an entry that is no longer needed — not one that was
   never legitimate.
3. **The arming plan self-exempts.** The clause lands while its own plan is still open, so that plan's
   own falsifier-declaring criteria would be enrolled and exempted from the requirement they
   introduce.

The motivating defect is real and is stated in Problem — `attestationFloor`
(`packages/lore/src/service/gate-predicates.ts:1102-1198`) requires an attested row per declared-scope
criterion but never examines the row's `result` and never asks whether the criterion declares a
falsifier, so a falsifier can be declared, never shown to go red, and still close on an attested
green. It should be fixed. It needs a spec whose first job is to decide how a retroactively armed gate
gets a legitimate, integrity-protected exemption set over a corpus that lacks per-criterion
timestamps — which is a design question, not an implementation detail, and it does not belong bolted
onto the assess-verification work this spec lands.

⛔ Anything that arms the clause before those three are answered will either block the whole
back-catalogue or grant a forgeable amnesty. Do not "just add the flag".

- **D6 — the CLI and MCP callers must PASS `diffSource`, and that wiring is part of D1/D2, not a
  follow-up.** Measured 2026-08-11, immediately after AC-JV-1 earned an attested pass: `commands/assess.ts`
  and the MCP `tools.ts` never thread `opts.diffSource` into the service, so **every live `lore assess`
  run resolves to `paths_verified.unchecked`** — the path verification D1/D2/D3 specify is unreachable from
  the only surfaces a user or agent drives. The capability is real, tested, and dead.

  ⛔ This is an ANCHOR-AND-SCOPE DEFECT IN THIS SPEC, not an implementer failure, and it is recorded that
  way deliberately. The implementer who reported it was outside both its task's anchors and this Scope
  list; it flagged the gap unprompted rather than silently widening its own change, which is exactly the
  required behaviour. The defect is that this spec's Scope named the four implementation files and NOT the
  two call sites — so an AC could go green, attested, with the feature switched off in production.

  ⛔ It is also the FIFTH measured instance of one standing shape in this repo: an added column nobody
  writes, an added function nobody calls, an added parameter no caller passes, an accepted option no CLI
  threads (`verifyFalsifier`, fixed the same day), and now a resolved `diffSource` no adapter supplies.
  The mechanical rule that follows: **a spec whose decisions add a parameter, field, or option MUST list
  the CALL SITES in Scope alongside the definition sites, and the AC MUST drive the outermost surface.**
  AC-JV-5 exists to enforce that here rather than restating it as advice.

  ⛔ Numbered **5, not 4**: the plan's `close-gate` phase already reserves `AC-JV-4` for the DEFERRED
  attestationFloor falsifier clause (see Deferred). `ac add` for the wiring criterion was first issued as
  `AC-JV-4`, which would have made one id mean two different things across two live documents — caught
  immediately and removed via `ac rm --force`, then re-added as `AC-JV-5`. ⛔ If the attestationFloor clause
  is ever built it takes `AC-JV-4`, the id the plan already names; do not renumber it to close the gap in
  the sequence.

## Scope

- `packages/core/src/assessment.ts` — D1's `paths` field, D3's `unverifiable_findings[]` and
  `paths_verified` counters
- `packages/lore/src/ai/assess-template.ts` — D1's prompt requirement, D4's exclusion before truncation
- `packages/lore/src/service/ai-provider-service.ts` — D2/D3's verification and stripping pass
- `packages/lore/src/service/verify-runner-service.ts` — D5's execution-root resolution
- `packages/lore/src/adapters/cli/commands/assess.ts` and `packages/lore/src/adapters/mcp/tools.ts` —
  **D6's production wiring of `diffSource`** (added 2026-08-11; see D6 for why this was missing)
- New oracle files, each the declared `--command` of one AC:
  - `packages/lore/tests/unit/service/assess-path-verification.bun.test.ts` — AC-JV-1
  - `packages/lore/tests/unit/ai/assess-diff-mirror-exclusion.bun.test.ts` — AC-JV-2
  - `packages/lore/tests/unit/service/falsifier-execution-root.bun.test.ts` — AC-JV-3
  - `packages/lore/tests/integration/cli/assess-diff-source-wiring.test.ts` — AC-JV-5

## Out of Scope

- `max_diff_chars`'s non-shipping default (code 24000 vs this repo's 80000) — that is a distribution
  defect owned by the governance-distribution spec, not a judgment defect.
- Re-scoring or re-authoring any existing assessment. D3 changes what future assessments record; it
  does not rewrite history.
- The `--capture`-has-no-attestation asymmetry itself (`evidence.ts:429` writes
  `capture_source: "runner"` with no `attestation` block) — documented, deliberate, and NOT fixed here.
  Recorded for the successor spec named in Deferred: when the falsifier clause is eventually built, it
  is structurally safe on top of this asymmetry rather than safe by trust, because the clause must key
  on **`attestation !== undefined`** — which only `VerifyRunnerService` writes — and NEVER on
  `capture_source`, the field the CLI path mislabels. A `--capture` row therefore fails such a clause by
  construction, and no amount of `capture_source` mislabelling can forge an `attestation`.

## Acceptance Criteria

Attached via `lore ac add` as **AC-JV-1 … AC-JV-3**; that structured list is authoritative. The
id→mechanism mapping is normative:

- **AC-JV-1** (D1, D2, D3) — a finding declaring a path absent at the assessed commit is moved to
  `unverifiable_findings[]` with the failing path and the commit checked against, counted in
  `paths_verified`, and excluded from the scored set; a finding whose path exists at the assessed
  commit but NOT in the worktree is KEPT (the assessed commit is the referent, not `HEAD`); and the
  stored `overall_score` is left exactly as the judge emitted it. All three cases in one oracle,
  because keeping the wrong one is as bad as dropping the wrong one.
- **AC-JV-2** (D4) — a diff containing both a `docs/requirements/**` hunk and a source hunk is reduced
  to the source hunk before truncation, asserted by the absence of the mirror path AND the presence of
  the source path in the prompt text — never by a size comparison, which a truncation could satisfy by
  accident.
- **AC-JV-3** (D5) — a falsifier invoked with a linked-worktree execution root scratches off THAT
  worktree: the falsifier's command observes an uncommitted change made only in the worktree. The
  reverse control is the pre-change behaviour — resolving via `config.repoRoot` must NOT see it — so
  the oracle distinguishes "resolved correctly" from "happened to pass".


## Sequencing Risks

- **D6 retroactively invalidates the back-catalogue, and D7's generated ledger is the mechanism that
  absorbs it — a prose exemption would not.** Every existing AC that declares a falsifier but
  has no attested `expected-fail` row becomes close-blocking the moment this lands. ⛔ Budget the sweep
  AND a written exemption for pre-existing criteria in the SAME slice — a newly armed gate that
  invalidates history without a stated exemption has already cost this repo a full round. Enumerate the
  affected set before arming, and record the count.
- **D1 changes a Zod schema in `@lore/core`, which the dashboard imports.** `paths` must default to
  `[]` so every stored assessment still parses; a required field would make historical rows invalid.
  The default barrel must stay browser-safe — no Node import may be added for the verification, which
  belongs in `packages/lore/**`.
- **D2 runs `git` during an assess.** A missing commit (shallow clone, pruned range) must fail LOUD
  naming the commit, never be treated as "path absent" — that would silently convert an environment
  problem into a withdrawn finding.
- **D5's file is shared with the deferred clause.** `verify-runner-service.ts` and `gate-predicates.ts` are
  distinct files, so the two can be claimed concurrently; but both alter what `lore verify` and
  `lore done` accept, so they must be merged before any other plan's tasks run their own attestation.


## Acceptance Criteria (structured)

- [⚑] [script] AC-JV-1: Assess findings are path-verified against the ASSESSED commit resolved from extra.diff_source, with all three outcomes asserted in one oracle: (a) a finding declaring a path absent at that commit moves to unverifiable_findings[] carrying the failing path and the commit it was checked against, is counted in paths_verified.unverifiable, and is excluded from the scored set; (b) a finding whose declared path exists at the assessed commit but NOT in the worktree is KEPT, because the assessed commit is the referent and HEAD is not; (c) the stored overall_score is left byte-identical to what the judge emitted, never recomputed. A missing commit fails LOUD naming the commit rather than being read as an absent path
  script: test — bun test packages/lore/tests/unit/service/assess-path-verification.bun.test.ts 2>&1 && echo "AC-JV-1 PASS: absent-at-commit findings withdrawn and recorded, absent-in-worktree-only findings kept, score untouched, missing commit loud"
- [⚑] [script] AC-JV-2: The assess diff excludes the generated mirror before truncation: given a diff containing BOTH a docs/requirements/** hunk and a source hunk, the built prompt contains the source path and does NOT contain the mirror path. Asserted by presence and absence of the two specific paths, never by a size comparison, which a truncation could satisfy by accident. The exclusion list is a single named constant with one definition site
  script: test — bun test packages/lore/tests/unit/ai/assess-diff-mirror-exclusion.bun.test.ts 2>&1 && echo "AC-JV-2 PASS: mirror hunk absent and source hunk present in the built prompt"
- [⚑] [script] AC-JV-3: verifyFalsifier resolves its execution root through SPEC-063's resolveVerifyExecutionRoot, so a falsifier invoked from a linked worktree scratches off THAT worktree and its command observes an uncommitted change made only there. The reverse control is mandatory and asserted in the same oracle: resolving via config.repoRoot (the pre-change path, which findLoreDbPath walks UP to the main checkout) must NOT observe that change — without it the test cannot distinguish resolved-correctly from happened-to-pass
  script: test — bun test packages/lore/tests/unit/service/falsifier-execution-root.bun.test.ts 2>&1 && echo "AC-JV-3 PASS: worktree-rooted falsifier sees the worktree uncommitted change and the config.repoRoot control does not"
- [⚑] [script] AC-JV-5: PRODUCTION WIRING of diffSource, asserted at the OUTERMOST surface a user drives, never at the service boundary: (a) running lore assess against a throwaway corpus with extra.diff_source present resolves an ASSESSED COMMIT and the stored assessment paths_verified.checked is > 0 — measured 2026-08-11, the pre-fix value was paths_verified.unchecked on EVERY live run because commands/assess.ts never threaded opts.diffSource; (b) the same assertion for the MCP surface via tools.ts, since two adapters can drift independently and one being wired proves nothing about the other; (c) a finding declaring a path absent at that resolved commit lands in unverifiable_findings[] in the STORED doc, so the assertion is on persisted state, not on an in-memory return value; (d) the REVERSE CONTROL is mandatory: with extra.diff_source ABSENT the stored assessment records paths_verified.unchecked and a reason, proving the wired path is what produced the checked result rather than a default that happens to look right. ⛔ A service-level test satisfies NONE of this — AC-JV-1 already had an attested pass while the feature was switched off in production, which is why this criterion drives the CLI and MCP entry points instead. ⛔ Numbered 5, not 4: the plan reserves AC-JV-4 for the DEFERRED attestationFloor falsifier clause, and reusing that id would make one token mean two things in two live documents — the exact ambiguity this session is elsewhere remediating
  script: test — bunx vitest run packages/lore/tests/integration/cli/assess-diff-source-wiring.test.ts 2>&1 && echo "AC-JV-5 PASS: CLI and MCP assess both thread diff_source so paths_verified.checked > 0 in the stored doc, and the diff_source-absent control still records unchecked"
- [·] [script] AC-JV-6: The comments that RECORDED the diffSource wiring gap are updated in lockstep with the gap being closed, because a comment truthfully documenting a gap becomes a FALSE assertion the moment that gap is fixed. Measured on main after AC-JV-5 merged: ai-provider-service.ts:87 still says opts.diffSource is currently supplied by NO production caller, :89 still says so every live lore assess run today, :1193 still says pass its already-resolved diffSource local through here — Until then this stays, and :1199 still says no production caller supplies it yet. All four are now false. Oracle: a grep-shaped assertion proving each stale phrase is ABSENT and that the replacement text names the two live call sites (adapters/cli/commands/assess.ts and adapters/mcp/tools.ts) in a form a reader can mechanically check, ⛔ never a bare claim that it was fixed. ⛔ This is the SECOND instance in one session of the standing lesson that fixing a gap and updating the comment recording it are ONE acceptance unit — both times the anchor set covered the implementation site and not the comment site, so the implementer could only flag
  script: test — bunx vitest run packages/lore/tests/unit/service/ai-provider-service-comment-currency.test.ts 2>&1 && echo "AC-JV-6 PASS: all four stale diffSource-gap phrases are absent and the replacement names both live call sites"

## Code anchors

- packages/core/src/assessment.ts
- packages/lore/src/service/gate-predicates.ts
- packages/lore/src/service/verify-runner-service.ts
