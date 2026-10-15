---
id: PLAN-122
type: plan
role: plan
title: "Land governance distribution: shipped defaults that actually ship, one remedy for an unconfigured upstream, and a gap namespace that resolves"
status: deprecated
priority: high
created: 2026-08-11
updated: 2026-10-10
tags: []
parent: SPEC-138
phases:
  - {name: "defaults", description: "AC-GD-1: raise the two code defaults and build the shipped-default drift checker (absence-only predicate)"}
  - {name: "remedy", description: "AC-GD-2: one shared unconfigured-upstream builder, disclosure of the git-tracked write, and the feedback stanza landed so --list exits 0 on main. AFTER defaults"}
  - {name: "namespace", description: "AC-GD-3: gap-namespace checker plus the unowned-gap report. Concurrent with defaults"}
---
# Goal

Land the three ACs (AC-GD-1 … AC-GD-3) of
`spec-governance-defaults-must-ship-and-every-recorded-gap-must`. Each exists because a governance
surface works in this repo and nowhere else.

⛔ **Label convention, adopted because this plan's own subject is a namespace collision:** phases are
named (`defaults`, `remedy`, `namespace`), never numbered. A bare `D<n>` in this document ALWAYS means a
decision in the parent spec and is always written as "spec D<n>". An earlier draft numbered its phases
`Dispatch 1…3` and a reader could not tell `D2` (spec decision) from `Dispatch 2` (phase) — exactly the
defect this plan exists to fix, reproduced in the plan describing it.

## Phases

All three phases run CONCURRENTLY — no anchor intersects, and no phase depends on another phase's output.
Each runs in its own linked worktree.

⛔ **But "concurrent authoring" is not "unordered merging", and one ordering constraint is real**: the
`namespace` phase's merge waits on the orchestrator-owned rename (spec D4c — the checker is armed on
merge, so merging it against a ledger still carrying `G<n>` would redden `main`). The rename depends on
nothing any phase produces, so it can land at any time before that merge. `defaults` and `remedy` merge in
any order. An earlier draft claimed unconditional concurrency and a review round caught that the arming
question was never answered.

**`defaults` (AC-GD-1) — spec D1 + spec D2.** Raise the two code defaults to the values this repo proved
it needs (`capture_timeout_ms` → `1_200_000`, `max_diff_chars` → `80_000`) and build the shipped-default
drift checker. The checker's predicate is ABSENCE only: a repo override that merely DUPLICATES a shipped
value is redundant but harmless, and failing on that would force churn every time a default catches up.

⛔ The checker MUST ship with an explicit `PROJECT_SPECIFIC_KEYS` allowlist, authored in THIS phase even
though one of its entries belongs to a key `remedy` adds. `project.name`, `project.author`,
`audit.verify_since` and `feedback.upstream` are inherently per-project and can never appear in a shipped
surface — without the allowlist the checker flags `project.name` immediately, and it would turn `main` red
the moment `remedy`'s `feedback:` stanza merges. This is a shared constant `defaults` authors, ⛔ NOT a
sequencing dependency: `defaults` may merge before, after, or concurrently with `remedy` provided the
allowlist anticipates the key. ⛔ **`PROJECT_SPECIFIC_KEYS` is the SOLE definition of "inherently
per-project"** — not a hint to be supplemented with the implementer's own judgement about which other keys
feel project-specific.

⛔ **The rationale predicate is PINNED in spec D1 and must be implemented as written, not re-derived**: a
rationale is non-empty, **≥20 characters after trimming**, and NOT a whole-value placeholder (`TODO`,
`TBD`, `FIXME`, `N/A`, `-`, `?`, case-insensitive). The checker exits exactly 3 on a violation, and its
failure message must say this is a floor on EFFORT, not on meaning — no predicate can check meaning, and
nobody should read a passing entry as a reviewed one. An earlier spec draft said only "carries a one-line
rationale"; a review round showed that predicate is satisfied by whitespace, so ⛔ do not rebuild the
unpinned version from the phrase "one-line rationale".

⛔ **ARMING + BACK-CATALOGUE, answered explicitly because a review round asked**: the drift check IS armed
as a repo-wide gate when THIS phase merges, and therefore the back-catalogue sweep lands **inside the same
merge**. Enumerate every override the checker flags beyond the two named, and in the same slice either fix
it, add it to `PROJECT_SPECIFIC_KEYS` with a rationale, or ship it to the template. ⛔ Deferring the sweep
reddens `main` on unrelated pre-existing overrides the instant the gate arms. Note the asymmetry with
`namespace`: that checker is kept green by ORDERING (the rename lands first), this one by CO-LANDING the
sweep — there is no separate actor whose edit could precede it.

⛔ This phase does NOT touch `.lore/config.yaml`. Its fresh-install clause — that a fresh install reports
`1200000` / `80000` — is pinned to a `mkdtemp` + `lore init` + `lore setup --project` directory read
through **`loadConfig(thatDir)` from `@lore/core/node`**, asserting
`value.workflow.gates.capture_timeout_ms === 1200000` and `value.ai.assess.max_diff_chars === 80000`.
⛔ Measured 2026-08-11: `lore status --json` does NOT surface either key (an earlier spec draft named it as
the resolver and thereby left the clause with no runnable oracle at all) — `loadConfig` is the entry point
server code itself calls, so calling it is exercising the product's resolution, not re-implementing it.
⛔ Re-deriving the merge by hand (reading `config.ts` constants plus the template and combining them) is
REFUSED even though it yields the same two numbers, and the oracle must never read, import, or resolve
THIS repo's `.lore/config.yaml`.

**`remedy` (AC-GD-2) — spec D3.** Collapse the two divergent unconfigured-upstream messages into one
shared builder (asserted by builder IDENTITY, not two string literals that match today), disclose in that
text that the remedy writes the git-tracked team-shared `.lore/config.yaml`, and land the `feedback:`
stanza in this repo so `lore report-issue --list` exits 0 on `main` instead of the measured exit 4.

⛔ **This phase's `.lore/config.yaml` edit is ADDITIVE ONLY** — read the current contents back, add the
`feedback:` key, change nothing else. That matches spec D3 verbatim. An earlier draft of this plan also
assigned it the deletion of the now-redundant `capture_timeout_ms` / `max_diff_chars` overrides, which
contradicted spec D3 and manufactured a false dependency on `defaults`. Those deletions are
orchestrator-owned (below) and are pure cleanliness — spec D1's absence-only predicate does not require
them.

**`namespace` (AC-GD-3) — spec D4, D4a, D4b, D4c, D4d + spec D5.** The gap-namespace checker (a bare
`G<n>` in the ledger → exit exactly 3 naming the entry; `GAP-<n>` → 0) plus the unowned-gap report, which
exits 0 and is a REPORT deliberately, ⛔ not a gate. ⛔ Its predicate is the FOUR-FIELD disjunction spec D5
pins — `(status == open && no owning_spec)` **OR** `(status == half-closed && no open_half_carried_by)` —
⛔ **not** "open gaps with no `owning_spec`", which a review round showed excludes `GAP-11` (a member
AC-GD-3(f) asserts) while an obvious repair then double-counted `GAP-1`.

⛔ **The predicate is WHOLE-DOCUMENT and has exactly TWO exemptions, both asserted in BOTH directions.**
A review round found the parent spec's original predicate self-contradictory, so read spec D4a/D4d before
implementing:
- **Fence (spec D4a)** — one fenced `legacy-gap-aliases` region at the ledger head, holding nothing but
  the 19 `G<n> → GAP-<n>` mapping lines. Inside it a bare token exits 0; the SAME token one line outside
  still exits exactly 3. ⛔ Not a per-line opt-out marker — that would become the place stale ids hide.
- **Qualifier (spec D4d)** — `PRD-001 G8` is lawful anywhere; a line carrying BOTH a qualified and a bare
  form still exits exactly 3. ⛔ Do NOT implement as "skip lines mentioning PRD-001".

⛔ **The checker reads the CORPUS DOC as SSOT, never `docs/requirements/knowledge/` (spec D4b).** A
mirror-keyed checker reports mirror staleness as a namespace verdict. AC-GD-3(d) defeats such an
implementation with a TWO-DIRECTIONAL exit-code assertion, and both halves are required: a dirty corpus doc
(bare `G<n>`) whose mirror is clean or absent → exits **exactly 3** (a mirror-keyed build exits 0 and
fails); a clean corpus doc whose MIRROR carries a bare `G<n>` → exits **0** (a mirror-keyed build exits 3
and fails). One direction alone cannot separate the two implementations.

⛔ **MERGE ORDER, and it is the one real ordering constraint in this plan (spec D4c).** The checker IS
armed as a repo-wide gate when this phase merges — capability and production wiring are one acceptance
unit, and an unwired checker is the "implementation exists, nothing calls it" false green this repo has
measured four times. What keeps `main` green is ordering: the orchestrator-owned rename (below) lands
FIRST. So fixture-driven assertions may be authored concurrently with the other two phases, but **this
phase's MERGE waits on the rename**, and AC-GD-3(f)/(g) then assert the LIVE renamed ledger — (f) by SET
EQUALITY against a pinned eight-member set, because an empty report also exits 0. ⛔ The reverse order —
arm first, rename later — reddens `main` for the whole interval and is not an option.

## Orchestrator-owned — outside every phase

1. The gap-ledger edits in `knowledge-attestation-is-structurally-one-sided-lore-verify-can`: the
   `G<n>` → `GAP-<n>` rename of **all 65 bare tokens across 19 ids** (measured — they are NOT confined to
   the 18 headings; `G5` has no heading at all, and cross-references run through the prose and a
   comparison table), the fenced `legacy-gap-aliases` region at the head, the structured
   `id`/`status`/`owning_spec`/`open_half_carried_by` fields, and correcting `GAP-19`'s scope line (it names a branch that does
   not exist while the defect is on `main`; the pinned oracle is document-state — the line must contain
   `main` and must not contain `PENDING`, `mirror branch` or `a9f801dd`). A shared knowledge doc is not
   rewritten from a worktree. ⛔ The rename MUST leave the old tokens findable — that is what the fenced
   region is for — or every existing `G<n>` reference in this session's own handoffs and retros silently
   dangles. Verify by grepping one old id AFTER the rename, not by assuming the fence covers it.
   ⛔ **ORDERING: this lands BEFORE the `namespace` phase merges** (spec D4c). It depends on nothing that
   phase produces, and the checker is armed on merge.
2. Marking `GAP-11` **`half-closed`**, with this spec as the `owning_spec` of its VALUE half only, and ⛔
   **leaving `open_half_carried_by` ABSENT on it** — that absence is what keeps `GAP-11` inside the
   unowned-gap report's predicate (spec D5: `status == open && no owning_spec` **OR**
   `status == half-closed && no open_half_carried_by`). Contrast `GAP-1`, which IS given
   `open_half_carried_by: GAP-17` and is therefore correctly excluded — its unclosed half is carried as its
   own entry, and listing both would double-count one gap. A review round caught that the naive predicate
   ("open gaps with no `owning_spec`") excluded `GAP-11` on both counts while AC-GD-3(f) asserts it as a
   member, and that the obvious repair then double-counted `GAP-1`; the fourth field is what makes the
   two `half-closed` entries decidable apart. ⛔ Not
   `closed`: read its own heading — "`--capture`'s window is a shared-config knob, **and** it barely fits
   this repo's own scoped oracle" is TWO defects under one id. Spec D2's raise closes the second; the
   first (the window is a *shared-config knob*, so one session's timeout is every concurrent session's)
   is a scoping defect a larger value does not touch, and it stays OPEN and unowned. A review round
   caught the earlier "fully closed" claim. ⛔ Ordering: mark it only AFTER `defaults` merges — before
   that, even the value half is a claim with no landed mechanism. `GAP-11` therefore still appears in the
   unowned-gap report, which AC-GD-3(f) asserts by set equality.
3. Removing the now-redundant `capture_timeout_ms` / `max_diff_chars` overrides from
   `.lore/config.yaml`, after `defaults` merges. Pure cleanliness; no AC depends on it.

## Sequencing Risks

- **⛔ `.lore/config.yaml` is shared team state in a shared checkout.** Read its current contents back
  before writing and add only the keys named; a whole-field replacement silently discards what another
  session appended. `remedy` is the ONLY phase that may touch it, and only additively.
- **Spec D2 raises two defaults every consumer inherits on upgrade.** A larger capture timeout is a
  ceiling and costs nothing extra; a larger `max_diff_chars` DOES cost tokens on every assess. The comment
  beside each value must state that trade-off, so the next reader can revisit it with the reason in hand
  rather than re-deriving it.
- **The `defaults` checker will flag pre-existing overrides beyond the two named.** Enumerate what it
  finds and fix or record each in the same slice — a newly armed check that invalidates the back-catalogue
  without a stated disposition has already cost this repo a round.
- **AC-GD-2's provisioning test must use a throwaway corpus.** Only its final `--list` exit-code clause
  reads this repo, and that path is read-only.
- **`bun run typecheck` exits 2 for ANY compile error under `--noEmit`** (measured against this repo's
  `node_modules/.bin/tsc` 5.9.3; the "nothing was checked" `TS18003` also exits 2). Discriminate by the
  ERROR CODE in the output, never by the exit code, and ⛔ never by "nonzero".

## Out of Scope

Fixing the gaps themselves, with ONE PARTIAL exception: `GAP-11` is `half-closed` — spec D2's default raise
closes its value half, its shared-config-knob half stays OPEN and unowned (see orchestrator item 2).
`GAP-7`, `GAP-8`, `GAP-15`, `GAP-16`, `GAP-17`, `GAP-18` and `GAP-19` are made referenceable and visibly
unowned; each still needs its own spec. Those seven plus `GAP-11` are exactly the eight-member set
AC-GD-3(f) asserts by SET EQUALITY, so this list is not decorative — an extra or missing member reddens
that AC. Also out of scope: the deferred `attestationFloor` falsifier clause
(`spec-judgment-surfaces-must-verify-before-they-certify-machine` `## Deferred`), and SPEC-072's
rate-limiting / identity-pin / version-skew rails, which are live and untouched.
