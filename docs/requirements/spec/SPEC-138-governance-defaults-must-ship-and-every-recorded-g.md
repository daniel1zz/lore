---
id: SPEC-138
type: spec
role: spec
title: "Governance defaults must ship and every recorded gap must resolve: a shipped-default drift check, one remedy for an unconfigured upstream, and a gap namespace that does not collide with the PRD"
status: approved
priority: high
created: 2026-08-11
updated: 2026-08-11
tags: []
parent: PRD-001
---
# Overview

Three governance surfaces work in this repo and nowhere else. A dogfood-validated config value that
lives only in `.lore/config.yaml` never reaches a consumer. `lore report-issue` — the channel a
consuming project uses to file defects upstream — is dead in the upstream's own repo while two
different code paths prescribe two different remedies for that same condition. And the governance-gap
ledger shares its `G<n>` namespace with PRD-001's product goals, so a gap reference cannot be resolved
without guessing which document was meant.

Measured on `main`, 2026-08-11.

## Problem

**A dogfood-only config override does not ship, and nothing says so.** Two live instances:

| value | code default | this repo's `.lore/config.yaml` | shipped template |
|---|---|---|---|
| `workflow.gates.capture_timeout_ms` | `600_000` (`packages/core/src/config.ts:461`) | `1200000` (`:44`, raised 2026-08-10) | absent from `assets/project/lore-config-template.yaml` |
| `ai.assess.max_diff_chars` | `24000` (`packages/core/src/ai.ts:325`) | `80000` (`:5-6`) | absent |

A fresh `lore init` + `lore setup --project` therefore gets `600_000` and `24000`. Both overrides were
raised because the shipped value was measurably too small for real work — the capture window barely fit
this repo's own scoped runs, and one assess truncated 5.3M diff characters. Neither raise reaches
anyone. This is the distribution-first rule failing silently rather than loudly: the value was fixed on
the surface that exposed the problem, not on the surface that ships.

**`lore report-issue` is dead in the upstream's own repo.** Measured this session:
`lore report-issue --list` exits **4** with 318 bytes — "`feedback.upstream` is not configured". The
repo's `.lore/config.yaml` carries no `feedback:` key at all. So the canonical channel for reporting a
lore defect is unavailable inside lore, which is where lore's defects are found.

**And the same condition has two divergent remedies.** `report-issue.ts:101` (via
`buildAutoConfigRequiredError`) prescribes `lore report-issue --auto-config`;
`issue-report-service.ts:315` (via `buildUnconfiguredUpstreamError`, `:274-287`) prescribes a
hand-edited YAML stanza. One condition, two answers, and a reader cannot tell which is current.
⛔ **CORRECTED 2026-08-11, and the correction makes it WORSE, not better.** An earlier version of this
paragraph asserted `.lore/config.yaml` is "git-tracked, not ignored". It is **NOT tracked** — refuted by an
implementer and then verified four independent ways: `git check-ignore -v` matches `.gitignore:9` `.lore/*`
(excepting only `export-index.json` and `audit-anchor.json`), `git ls-files .lore/` lists exactly those two,
`git log --all -- .lore/config.yaml` is empty, and `git show main:.lore/config.yaml` fatals. The sharing is
real but its mechanism is the filesystem, not git: every linked worktree resolves to the ONE physical file
via `findLoreDbPath`'s walk-up. ⛔ That is strictly MORE dangerous than git-tracked would be — an edit to it
appears in no diff, receives no review, and can never raise a merge conflict — and it means a
worktree-isolated agent structurally CANNOT land a change to it, so this file is orchestrator-only by
mechanism rather than by policy.

*(Correcting the ticket that raised this: its claim that the remedy is "prescribed six times per suite
run" is not supported — there are TWO emission sites in source. And the tasks it cites as prior art,
`TASK-643`…`TASK-646`, do not exist in the corpus; the real prior art is
`plan-implementation-out-of-box-reporting-channel-self-provision`, archived.)*

**The `G<n>` namespace collides across two live approved documents.** PRD-001 (§3) numbers **product
goals** G1–G16. `knowledge-attestation-is-structurally-one-sided-lore-verify-can` numbers **governance
gaps** G1–G19. They are different things under the same tokens:

| id | PRD-001 product goal | gap ledger governance gap |
|---|---|---|
| G7 | "Internal adoption: 3+ projects" | the spec-create hook analyses COMMAND TEXT, so changing a flag walks past it |
| G8 | "Output contract live" | `lore ac set` re-runs the D8 path check and OVERWRITES the escape reason |
| G11 | "Memory hygiene live" | `--capture`'s window is a shared-config knob |
| G15 | "Dashboard console first batch live" | the message-overstates-mechanism family has TWO subclasses |
| G16 | "Multi-project dashboard live" | the anti-fabrication guard CLOSED THE HONEST PATH |

⛔ This is not hypothetical ambiguity. A read-only explorer agent tasked this session with enumerating
gap-ledger entries resolved G15/G16 against **PRD-001** and returned dashboard product goals as
governance gaps. The collision misled a competent reader on its first attempt, which is the standard a
naming defect has to meet.

**One ledger entry actively points readers away from a live defect.** The ledger scopes G19 (the
AC-FR-10 oracle running its own repair before asserting) to "the PENDING mirror branch, NOT main as of
2026-08-11". Measured: `git branch -a` lists only `main` and `git log --all --grep=a9f801dd` is empty —
that branch does not exist — while the repair-then-assert shape is present on `main`. The ledger's own
Scope paragraph is the authoritative unowned list and names **eight**: `G7`, `G8`, `G11`, `G15`, `G16`,
`G17`, `G18`, `G19`. ⛔ An earlier version of this paragraph named only five, and a review round caught
the mismatch against AC-GD-3(f)'s pinned set — the ledger is authoritative, not this restatement of it.

## Decisions

- **D1 — the mechanism, not the two patches: a shipped-default drift check.** A checker compares this
  repo's `.lore/config.yaml` against what a fresh install actually materialises (the code defaults plus
  `assets/project/lore-config-template.yaml`) and FAILS on any value this repo overrides that the
  shipped surface does not carry. ⛔ Its predicate is ABSENCE only: a repo override that merely
  DUPLICATES a shipped value is redundant but harmless, and failing on it would force churn every time a
  default catches up. ⛔ **And the predicate MUST except an explicit `PROJECT_SPECIFIC_KEYS` allowlist,
  or it is wrong on its face**: some keys are inherently per-project and can never appear in a shipped
  surface — `project.name`, `project.author`, `audit.verify_since`, and `feedback.upstream` (which names
  WHERE a project's reports go, so a shipped value would be meaningless or actively wrong). Without the
  allowlist the checker flags `project.name` on day one, and it would fail on `main` the moment the
  `feedback:` stanza D3 requires is added. Every allowlist entry carries a one-line rationale for why the
  key cannot ship, and the checker itself FAILS on an entry with no rationale — otherwise the allowlist
  becomes the place overrides go to hide, which would defeat the whole mechanism. ⛔ "Has a rationale" is
  pinned to a MINIMAL ACCEPTED SHAPE, because a review round observed that an unpinned predicate is
  satisfied by whitespace or a placeholder: a rationale is a non-empty string of **at least 20 characters
  after trimming** that is not one of the placeholder tokens `TODO`, `TBD`, `FIXME`, `N/A`, `-`, `?`
  (case-insensitive, whole-value match). That is a floor on effort, not on meaning — no predicate can
  check meaning — and the checker's failure message says so, so nobody reads a passing entry as a
  reviewed one. That converts every future dogfood-only override from a silent non-shipping into a
  loud failure at the moment it is introduced. ⛔ Fixing only the two known
  instances would leave the third one to be discovered the same way.
- **D2 — fix the two known instances at the surface that ships.** Both are raises of a value the shipped
  default made too small, so both belong in the code default rather than the template (a template value
  only reaches projects created after it lands; a code default reaches every consumer on upgrade):
  `capture_timeout_ms` → `1_200_000`, `max_diff_chars` → `80_000`. Each carries a one-line comment
  citing the measurement that forced it.
- **D3 — one condition, one remedy, and it must work here.** The two divergent unconfigured-upstream
  messages collapse to a single shared builder, so the prescribed remedy cannot drift between the CLI
  and service layers. The remedy must succeed in lore's own repo — the upstream configuring itself is
  legitimate, not circular, because `feedback.upstream` names *where reports go*, and for the upstream
  that is its own corpus. The message MUST also state that it writes the git-tracked, team-shared
  `.lore/config.yaml`, since a reader in a shared checkout is entitled to know that before running it.
  ⛔ **`git-tracked` IS THE WRONG WORD and AC-GD-4 replaces it.** AC-GD-2 pinned the literal substring
  `git-tracked`, and that criterion has an attested pass — so the shipped message today asserts a mechanism
  that does not exist. The AC was NOT retro-edited to hide this (its pass stands, recorded against the pin
  it actually had); AC-GD-4 supersedes the wording forward, because rewriting a passed criterion's pin and
  its evidence is indistinguishable from concealment. The warning INTENT was always sound — this write
  touches state shared by every concurrent session — so only the mechanism clause changes.

  ⛔ That disclosure is pinned to LITERAL TOKENS, not to a reviewer's sense of whether the prose reads
  clearly enough: the text MUST contain `.lore/config.yaml`, `git-tracked` and `shared`, and AC-GD-2
  asserts all three as substrings. A review round flagged this as that AC's one soft spot — every other
  clause in it has a hard oracle (builder identity, exit 0 against this repo), so leaving this one to
  judgement would make it the clause that silently never gets checked.
  ⛔ **And this spec LANDS that stanza in this repo's own `.lore/config.yaml`, so
  `lore report-issue --list` exits 0 on `main`.** A remedy proven only in a throwaway corpus would leave
  the upstream's own channel dead, which IS the defect — so AC-GD-2 measures the exit code against THIS
  repo, not a fixture. Because that file is shared team state, the current contents MUST be read back
  before writing and only the `feedback:` key added.
- **D4 — the governance-gap namespace is renamed so a reference resolves without guessing.** Gap ids
  become `GAP-<n>`, disjoint from PRD-001's `G<n>` product goals, and a checker fails on any `G<n>`
  token in the gap ledger. Renaming the gap ledger rather than the PRD is deliberate: PRD-001's `G<n>`
  ids are cited by shipped specs and closed plans, and the ledger is the younger, internally-scoped
  document. Measured before designing the predicate: the ledger carries **65 bare `G<n>` tokens across
  19 ids**, and they are not confined to the entry headings — cross-references run through the prose
  (`## G13 … — G4's shape RECURRED in the very code that fixed G4`) and through a comparison table. So
  the rename is a whole-document rewrite, not a heading edit, and a whole-document predicate is the only
  one that can police it. ⛔ Note the arithmetic, which a review round flagged as unreconciled: **19 ids
  but only 18 `## ` headings.** `G5` has no heading of its own — it is cited in the Scope paragraph as
  spec-covered and appears nowhere else as an entry. The rename covers all 19 tokens regardless; an
  implementer keying on headings alone would miss `G5` and the whole-document predicate would then catch
  its own omission, which is the intended behaviour, not a paradox.
- **D4a — the ONE exemption is a single fenced `legacy-gap-aliases` region at the ledger head, and the
  checker's scan skips exactly that region.** Without an exemption D4's predicate and this spec's own
  compatibility requirement (below) are contradictory by construction: citing both forms so existing
  handoff and retro references do not dangle *is itself* a `G<n>` token in the ledger, so the checker
  would exit 3 on the very tree this spec ships. The exemption is therefore named here, not left to the
  implementer. ⛔ It is a fenced region — one, positionally fixed at the head, holding nothing but the
  19 `G<n> → GAP-<n>` mapping lines — and deliberately **NOT a per-line opt-out marker**: a marker any
  line could carry would become the place stale ids go to hide, which is precisely the failure mode D1
  already identified and rejected for its own allowlist. The exemption is not self-certifying either:
  AC-GD-3 asserts it in BOTH directions, so a checker that simply skipped everything would fail.
- **D4d — a citation of a PRD-001 product goal is written `PRD-001 G<n>`, and that qualified form is
  lawful anywhere in the ledger.** A review round caught that D4 + D4a together left a legitimate
  sentence unwritable: a gap entry that genuinely blocks a product goal ("blocks G8, Output contract
  live") had no lawful spelling, because the fence holds only the 19 mapping lines and the bare token is
  refused everywhere else. This spec's own Problem section tabulates PRD-001's `G7`/`G8`/`G11`/`G15`/`G16`
  beside the same-numbered gaps, so the need is immediate, not hypothetical. The rule is therefore:
  **qualify or rename** — `PRD-001 G8` for the product goal, `GAP-8` for the gap, and a BARE `G8` is
  refused because it is exactly the ambiguity that misled a reader. ⛔ The checker must not implement this
  as "skip any line mentioning PRD-001": that would re-open the whole line. It keys on the immediately
  preceding `PRD-001 ` qualifier, and AC-GD-3 asserts a bare token on a line that ALSO carries a
  qualified one still exits 3.
- **D4b — the checker reads the corpus SSOT, never the exported mirror.** The gap ledger is a lore
  knowledge doc; `docs/requirements/knowledge/KN-*.md` is a generated projection of it. A checker keyed
  on the mirror would report the mirror's staleness as a namespace verdict — green on a stale mirror
  whose SSOT is dirty, red on a clean SSOT whose mirror simply has not been re-exported — so its exit
  code would not mean what its name says. Mirror freshness is `check:spec-mirror`'s job and stays there.
- **D4c — the rename lands BEFORE the checker, so `main` is never red in between.** The checker IS armed
  as a repo-wide gate the moment its phase merges — capability and production wiring are one acceptance
  unit here as everywhere, and an unwired checker would be exactly the "implementation exists, nothing
  calls it" false green this repo has measured four times. What keeps `main` green is ordering, not a
  deferred arming: the orchestrator-owned rename depends on nothing the checker provides and lands
  first, so the checker's first live run is already against a renamed ledger. ⛔ The reverse order —
  arm first, rename later — reddens `main` for the whole interval and is not an option this spec leaves
  open.
- **D5 — the gap ledger becomes machine-readable and gets a REPORT, ⛔ deliberately NOT a gate.** Each
  entry carries `id`, `status` and `owning_spec`; a checker prints open gaps with no owning spec and
  exits **0**. `status` is one of `open | half-closed | closed | corrected-record | not-a-lore-gap` —
  enumerated rather than free text because the report's whole value is counting the open ones, and
  `half-closed` in particular must be a first-class value: `GAP-1` and (per Out of Scope) `GAP-11` are
  both genuinely half-closed, and forcing either into `open` or `closed` would make the count lie in one
  direction or the other. ⛔ **The report's predicate is therefore a DISJUNCTION, stated here because a
  review round found the obvious phrasing self-contradictory — and a first attempt at fixing it was ALSO
  self-contradictory, which is the instructive half, so both are recorded**:

  - Naive form, REJECTED: *"open gaps with no `owning_spec`"*. It excludes `GAP-11` on BOTH counts (not
    `open`, and it names this spec as `owning_spec` for its value half) while AC-GD-3(f) asserts it as a
    member. The two cannot both hold.
  - Second attempt, ALSO REJECTED: *`status == "open" && no owning_spec` OR `status == "half-closed"`*. It
    lists `GAP-11` correctly but ALSO lists `GAP-1`, which is likewise `half-closed` — yet `GAP-1` must NOT
    be listed, because its unclosed half was carried OUT into its own entry, `GAP-17`, and listing both
    double-counts one gap. Two `half-closed` entries need OPPOSITE treatment, so `status` alone cannot
    decide it. ⛔ A fourth field is required; there is no phrasing of three fields that works.
  - **ACCEPTED**: `status == "open" && owning_spec absent` **OR** (`status == "half-closed"` &&
    `open_half_carried_by` absent). `open_half_carried_by` is an optional field naming the entry that
    carries this one's unclosed half — `GAP-1.open_half_carried_by = GAP-17`; absent on `GAP-11`, because
    nothing carries its knob half. The carrier is itself `open` and unowned, so it is listed on its own
    account and each gap stays visible exactly once.

  Checked against the pinned set: `GAP-11` (half-closed, no carrier) listed; `GAP-1` (half-closed, carrier
  `GAP-17`) excluded; `GAP-17` (open, unowned) listed; `GAP-7`, `GAP-8`, `GAP-15`, `GAP-16`, `GAP-18`,
  `GAP-19` (open, unowned) listed — eight members, matching AC-GD-3(f) exactly.

  The report stays a REPORT, not a gate. This is a considered limitation, not laziness: an attempt in a sibling spec this session
  to arm a retroactive gate over the corpus's existing criteria failed six review rounds and was
  deferred, because the corpus does not record when a criterion was authored and therefore no cutoff
  predicate over the back-catalogue is decidable. The same trap applies to gaps. A report that is read
  beats a gate that must be exempted into uselessness.
- **D6 — G19's scope line is corrected as part of this work.** Its recorded scope names a branch that
  does not exist while the defect is on `main`, so the entry currently steers readers away from a live
  defect. A ledger whose entries can be wrong about WHERE is worth less than no ledger.

## Scope

- `packages/core/src/config.ts` — D2's `capture_timeout_ms` default
- `packages/core/src/ai.ts` — D2's `max_diff_chars` default
- `.lore/config.yaml` — D3's `feedback:` stanza added, and the two now-redundant `capture_timeout_ms` /
  `max_diff_chars` overrides removed. ⛔ Removal is not cosmetic and is not demanded by D1's checker
  (whose predicate is absence only): while those overrides remain, a test that read this repo's config
  instead of the shipped surface would still SEE `1200000` / `80000` and AC-GD-1's third clause would pass
  vacuously. Removing them is what makes that assertion discriminating
- `packages/lore/src/adapters/cli/commands/report-issue.ts`,
  `packages/lore/src/adapters/cli/report-issue-hint.ts`,
  `packages/lore/src/service/issue-report-service.ts` — D3's single shared message builder
- `knowledge-attestation-is-structurally-one-sided-lore-verify-can` (corpus doc) — D4's rename of all 65
  tokens, D4a's fenced `legacy-gap-aliases` region at the head, D5's structured fields, D6's `GAP-19`
  correction. ⛔ Orchestrator-owned: a shared knowledge doc is not edited from a worktree. ⛔ And per D4c
  this edit lands FIRST, before the checker's phase merges — the checker is armed on merge, so a ledger
  still carrying `G<n>` at that moment would redden `main`.
- New oracle files, each the declared `--command` of one AC:
  - `scripts/check-shipped-defaults.ts` + `scripts/tests/check-shipped-defaults.test.ts` — AC-GD-1
  - `packages/lore/tests/unit/adapters/report-issue-single-remedy.bun.test.ts` — AC-GD-2
  - `scripts/check-gap-namespace.ts` + `scripts/tests/check-gap-namespace.test.ts` — AC-GD-3

## Out of Scope

- Fixing the gaps themselves — with ONE PARTIAL exception. **`GAP-11` is HALF-closed by this spec, and
  recording it as fully closed would be false.** Read its own heading: "`--capture`'s window is a
  shared-config knob, **and** it barely fits this repo's own scoped oracle" — two defects under one id.
  D2 raising the code default to `1_200_000` closes the second half (the window no longer barely fits)
  and nothing else; the first half — that the window is a *shared-config knob*, so one session's timeout
  is every concurrent session's timeout in a shared checkout — is a scoping/ownership defect that a
  larger value does not touch. So `GAP-11`'s `status` is `half-closed` with this spec as the `owning_spec`
  of the value half, and its knob half stays OPEN and unowned. ⛔ This correction came from a review round
  that read the heading more carefully than the earlier draft did; the ledger already has the precedent
  (`GAP-1` is `HALF-CLOSED — mechanism only; see GAP-17`), so the shape is not novel. `GAP-7`, `GAP-8`,
  `GAP-15`, `GAP-16`, **`GAP-17`**, `GAP-18` and `GAP-19` stay unfixed; this spec makes them
  *referenceable and visibly unowned*, and each still needs its own spec. ⛔ `GAP-17` was MISSING from an
  earlier version of this list, which a review round caught by cross-checking AC-GD-3(f)'s pinned set. The
  ledger's own Scope paragraph is authoritative and reads "G7, G8, G11, G15, G16, G17, G18, G19 have no
  owning spec" — eight, and `GAP-17` is `GAP-1`'s unclosed content half. Together with `GAP-11` these are
  exactly the eight members AC-GD-3(f) asserts by set equality; ⛔ do not reconcile a mismatch by shrinking
  the AC's set, reconcile it against the ledger.
- The `attestationFloor` falsifier clause and its exemption ledger, deferred by
  `spec-judgment-surfaces-must-verify-before-they-certify-machine`.
- `lore report-issue`'s rate limiting, identity pinning and version-skew rails (SPEC-072), which are
  live and untouched here.

## Acceptance Criteria

Attached via `lore ac add` as **AC-GD-1 … AC-GD-3**; that structured list is authoritative.

**⛔ REVISION RECORD (2026-08-11, pre-implementation).** All three criteria were rewritten across three
review rounds BEFORE any evidence was recorded against them — no criterion here has ever been run, so
none of this is a post-red edit. Recorded anyway, because "an AC was changed" and "an AC was weakened"
are indistinguishable in an audit unless the direction is stated and checkable:

| round | criterion | change | direction |
|---|---|---|---|
| 1 | AC-GD-3 | added the both-directions fence assertion (D4a), the corpus-SSOT-not-mirror clause (D4b), and the live-ledger clause (D4c) | STRENGTHENED — 3 new falsifiable clauses; the round found D4's predicate and the compatibility requirement contradictory |
| 2 | AC-GD-3 | added D4d's qualified-`PRD-001 G<n>` exemption, also both ways | STRENGTHENED — closed a case where a lawful sentence had no lawful spelling |
| 2 | AC-GD-1 | pinned "has a rationale" to a minimal accepted shape (≥20 chars, placeholder blocklist) with three negative probes | STRENGTHENED — the prior predicate was satisfied by whitespace |
| 2 | AC-GD-2 | pinned the disclosure to three literal substrings | STRENGTHENED — replaced a reviewer-judgement clause with a mechanical one |
| 3 | AC-GD-3 | replaced clause (h)'s human read with a document-state oracle (scope line MUST contain `main`, MUST NOT contain `PENDING`/`mirror branch`/`a9f801dd`) | STRENGTHENED — and deliberately NOT a `git branch -a` check, which would go green the day anyone creates a branch by that name |
| 3 | AC-GD-1 | pinned the fresh-install procedure to `mkdtemp` + `lore init` + `lore setup --project`, and forbade reading this repo's config at any point | STRENGTHENED — the letter was previously satisfiable while re-introducing the merged-config read the clause forbids |
| 3 | AC-GD-2 | pinned builder identity to one-definition-site + shared-symbol import + byte-equality, all three | STRENGTHENED — byte-equality alone admits two coincidentally-equal literals |

| 4 | AC-GD-3 | clause (e) gained two rejection probes — an injected entry missing `owning_spec`, and an out-of-enum `status`, each exiting exactly 3 | STRENGTHENED — the prior clause was satisfied by parsing the real ledger successfully and never proving rejection |
| 4 | AC-GD-2 | defined "definition site" as a scan for the message's LITERAL TEXT, not for exported symbol declarations | STRENGTHENED — a symbol-keyed scan passes while an inlined duplicate literal survives, the exact substitution (a) exists to prevent |
| 5 | AC-GD-3 | clause (f) gained a pinned EXPECTED MEMBERSHIP asserted by SET EQUALITY — exactly `{GAP-7, GAP-8, GAP-11, GAP-15, GAP-16, GAP-17, GAP-18, GAP-19}` | STRENGTHENED — an empty or partial report also exits 0, so the prior clause was satisfied by a report that listed nothing |
| 5 | AC-GD-2 | pinned the scan fragment itself: ≥40 contiguous characters AND containing `feedback.upstream` | STRENGTHENED — the clause's discriminating power lived entirely in an unpinned choice of fragment |
| 5 | AC-GD-1 | pinned the resolver, not just the procedure: read the temp corpus through the product's own resolution entry point, and REFUSED a hand-rebuilt merge even though it yields the same two numbers | STRENGTHENED — re-implementing the merge proves the values exist, not that the resolution consumers run delivers them |
| 7 | AC-GD-1 | ⛔ CORRECTED A DEADLOCK I CREATED IN ROUND 5: that round named `lore status --json` as the resolver. Measured 2026-08-11 — `lore status --json` surfaces `ai_defaults` but NOT `workflow.gates.capture_timeout_ms` or `ai.assess.max_diff_chars` (top-level keys enumerated; neither appears). Combined with round 5's refusal of a hand-rebuilt merge, the clause had NO runnable oracle at all. Repointed at `loadConfig(dir)` from `@lore/core/node` — the function server code actually calls, which reads `<dir>/.lore/config.yaml` and lets Zod apply the code defaults — with both field paths pinned | NEUTRAL-then-STRENGTHENED — the round-5 pin was unrunnable, so this is a repair, not a loosening; the refusal of a hand-rebuilt merge SURVIVES verbatim. ⛔ Root cause worth naming: CLAUDE.md documents "resolved values in `lore status --json`" for SPEC-024's AI defaults and I generalised it to arbitrary config values without measuring. A reviewer flagged it as conditional ("IF lore status --json does not surface…"); the measurement, not the flag, is what settled it |
| 7 | AC-GD-1 | stated that `PROJECT_SPECIFIC_KEYS` is the SOLE definition of "inherently per-project" | STRENGTHENED — clause (a) otherwise reads as a discretionary judgement test standing alongside the allowlist |
| 7 | AC-GD-3 | clause (d) became a two-directional exit-code assertion (dirty SSOT + clean/absent mirror → exactly 3; clean SSOT + dirty mirror → 0) | STRENGTHENED — it pinned a failure MODE but no exit code, the only clause in the AC that did not |
| 6 | AC-GD-3 | clause (f)'s predicate became a four-field disjunction and D5 gained `open_half_carried_by`; `GAP-17` was added to Out of Scope's list | STRENGTHENED — the previous predicate excluded a member the AC asserts, and a first repair listed `GAP-1` twice; `GAP-17`'s absence was a spec/AC inconsistency the reviewer caught |

⛔ Every row ADDS an assertion or replaces a judgement call with a mechanical one; no row removes or
loosens a clause. The pattern itself is the risk, which is why it is tabulated rather than summarised:
seven rounds of AC revision on one spec is exactly the shape that, left unexplained, drags an
`evidence_integrity` score down — and it should, unless the direction is visible.

⛔ **What the seven rounds actually demonstrate, stated so the next author does not have to re-derive it:
every single round found a clause that would have gone GREEN while its goal was unmet** — a fence that
contradicted its own predicate, a lawful sentence with no lawful spelling, a rationale satisfied by
whitespace, a fresh-install read that could quietly consult the repo under test, a `git branch -a` probe
that self-heals the day someone creates that branch, a parse that never proves rejection, a
single-definition-site scan blind to inlined copies, a report satisfied by listing nothing, a scan whose
whole power lived in an unpinned fragment choice, and a resolver substitution that yields the right
numbers by the wrong route. a report predicate that excluded a member its own AC asserts, and a repair for THAT which double-counted a gap. Fifteen clauses, none a typo; each read convincingly. ⛔ Note the twelfth: the FIX for round 6's finding was itself defective, caught only by walking the pinned set member by member. A repair is not self-validating.

⛔ Two operating rules follow, and they are the transferable part:
1. **"The reviewer only had advisories" is not a stopping signal.** Eleven of these fifteen arrived as
   NON-BLOCKING advisories on an already-`approve` verdict. A verdict of `approve` with advisories is a
   verdict that the *structure* is sound, not that the *clauses* are discriminating.
2. **The stopping rule is a question, not a round count**: for each clause, can you name a concrete
   implementation that satisfies it while the goal fails? Revision stops when the answer is no — which is
   why it stopped here, and why it did not stop at round 3 despite `approve` at every round from 1 on.

- **AC-GD-1** (D1, D2) — the shipped-default drift check exits **exactly 3** naming a value this repo
  overrides that the shipped surface lacks, exits **0** on the post-D2 tree, and a fresh-install
  materialisation reports `capture_timeout_ms = 1200000` and `max_diff_chars = 80000` read from the
  SHIPPED surface, never from this repo's `.lore/config.yaml`.
- **AC-GD-2** (D3) — one remedy, and it works here: both the CLI and service unconfigured-upstream paths
  emit the SAME builder's text (asserted by identity, not by two string literals that happen to match),
  that text names `.lore/config.yaml` as git-tracked and team-shared, and after provisioning
  `lore report-issue --list` exits **0** against this repo's own corpus.
- **AC-GD-3** (D4, D4a, D4b, D4c, D5, D6) — a `G<n>` token in the gap ledger makes the namespace checker
  exit **exactly 3** naming the entry; `GAP-<n>` passes; the SAME token inside the fenced
  `legacy-gap-aliases` region exits **0** while that token one line outside the fence still exits
  **exactly 3** (both directions, or the exemption certifies nothing); the checker reads the corpus doc,
  not `docs/requirements/knowledge/`; the ledger's structured entries parse with `id`, `status` and
  `owning_spec`; the unowned-gap report lists every open gap lacking an `owning_spec` and exits **0**;
  the checker exits **0** against the LIVE renamed ledger; and `GAP-19`'s scope line no longer names a
  non-existent branch.

## Sequencing Risks

- **D2 raises two defaults that every consumer inherits on upgrade.** A larger capture timeout is a
  ceiling and cannot cost a consumer anything it was not already willing to wait for; a larger
  `max_diff_chars` DOES cost tokens on every assess. State that trade-off in the comment beside the
  value, so the next reader can revisit it with the reason in hand rather than re-deriving it.
- **D1's checker will flag pre-existing overrides beyond the two named here, and its arming is the same
  question D4c answers for the namespace checker.** A review round asked it explicitly, so it is answered
  explicitly: the drift check IS armed as a repo-wide gate when its phase merges — capability without
  wiring is the false green this repo has measured four times — and therefore **the back-catalogue sweep
  lands INSIDE THAT SAME MERGE**. Enumerate every override the checker flags, and in the same slice either
  fix it, add it to `PROJECT_SPECIFIC_KEYS` with a rationale, or ship it to the template. ⛔ Deferring the
  sweep to a follow-up reddens `main` on unrelated pre-existing overrides the moment the gate arms; a
  newly armed check that invalidates the back-catalogue without a stated disposition has already cost this
  repo a round. Note the asymmetry with the namespace checker: THAT one is kept green by ordering (the
  rename lands first), THIS one by co-landing the sweep, because there is no separate actor whose edit
  could precede it.
- **⛔ D3's `--auto-config` writes a git-tracked file shared by every session in this checkout.** Its
  test must provision into a throwaway corpus, never this repo's `.lore/config.yaml`.
- **D4 renames ids that this session's own handoffs and retros already cite as `G<n>`.** The rename must
  leave the old tokens findable — the 19 `G<n> → GAP-<n>` mapping lines go in D4a's fenced
  `legacy-gap-aliases` region at the ledger head — or every existing reference silently dangles. ⛔ That
  region is the reason D4's predicate is satisfiable at all: an earlier draft of this spec stated the
  compatibility requirement here and the whole-document predicate in D4, with no exemption anywhere, and
  a review round caught that the two clauses cannot both hold. Do not re-collapse them.
- **⛔ D4's rename touches 65 tokens whose ids also appear in `handoff` and `retro` docs this spec does
  not edit.** The fenced alias region is what keeps those external references resolvable; a reader who
  greps `G17` in the corpus must still land on the ledger. Verify that by grepping one old id AFTER the
  rename, not by assuming the fence covers it.


## Acceptance Criteria (structured)

- [✔] [script] AC-GD-1: The shipped-default drift check discriminates three cases and its allowlist cannot become a hiding place: (a) it exits EXACTLY 3 naming a value this repo .lore/config.yaml overrides that the SHIPPED surface (code defaults plus assets/project/lore-config-template.yaml) does not carry and that is not inherently per-project — where PROJECT_SPECIFIC_KEYS is the SOLE definition of inherently per-project, never an additional discretionary test; (b) it does NOT flag a key on that allowlist; (c) it exits EXACTLY 3 on an allowlist entry whose rationale fails D1 MINIMAL ACCEPTED SHAPE (non-empty, >=20 chars trimmed, not a whole-value placeholder TODO/TBD/FIXME/N-A/-/?) asserted with a whitespace-only AND a placeholder AND a 19-char entry; and it exits 0 on the post-fix tree. Plus the FRESH-INSTALL clause. ⛔ TEXT CORRECTED 2026-08-11 AFTER the attested pass, to match what was MEASURED rather than what I assumed: the field is workflow.EVIDENCE.capture_timeout_ms (config.ts:472), NOT workflow.gates.capture_timeout_ms as an earlier version of this clause said, and bare loadConfig does NOT fill Zod defaults for an entirely-absent top-level section — on a fresh install workflow and ai are both undefined (measured on a mkdtemp lore init corpus), so the earlier literal assertion could never have passed. The oracle drives the PRODUCTION RESOLUTION SEAMS instead: resolveCaptureTimeoutMs, and config?.ai ?? AiConfigSchema.parse({}), against a mkdtemp + lore init + lore setup --project directory, asserting 1200000 and 80000. ⛔ Re-deriving the merge by hand is still REFUSED, and the oracle MUST NOT read this repo .lore/config.yaml. This is a CORRECTION of my own factual error, not a weakening: the attested pass was earned against these seams, so the text now describes what actually ran
  script: test — bunx vitest run scripts/tests/check-shipped-defaults.test.ts 2>&1 && bun scripts/check-shipped-defaults.ts 2>&1 && echo "AC-GD-1 PASS: drift check exits 3 on an unshipped override, 0 on the real tree, and the shipped surface carries 1200000 / 80000"
- [✘] [script] AC-GD-2: One condition, one remedy, and it works in the upstream OWN repo. (a) BUILDER IDENTITY, technique PINNED because this clause exists to prevent a technique substitution — all THREE sub-assertions mandatory: (i) ONE DEFINITION SITE, detected by scanning packages/** for the message LITERAL TEXT and not for exported symbol declarations (a symbol-keyed scan passes while an INLINED duplicate literal survives, the exact substitution being prevented). The FRAGMENT IS PINNED, not left to choice: it MUST be >=40 characters of contiguous message text AND MUST contain the substring feedback.upstream, and it MUST occur exactly once across packages/** excluding test files. A short or generic fragment would satisfy the letter while detecting nothing. (ii) both the CLI path and the service path import that one exported symbol, asserted on the module reference, not on a rebuilt string. (iii) driving both paths yields BYTE-IDENTICAL text — insufficient alone, since two literals can coincide. (b) DISCLOSURE as three LITERAL SUBSTRINGS: the text contains .lore/config.yaml and git-tracked and shared. (c) provisioning is exercised against a THROWAWAY corpus, never this repo .lore/config.yaml. (d) the clause that makes this more than a fixture test: lore report-issue --list run against THIS repo own corpus exits 0, against the currently-measured exit 4. A remedy proven only in a fixture would leave the upstream own channel dead, which IS the defect
  script: test — bun test packages/lore/tests/unit/adapters/report-issue-single-remedy.bun.test.ts 2>&1 && echo "AC-GD-2 PASS: CLI and service share one remedy builder by identity, the text carries all three literals .lore/config.yaml / git-tracked / shared, and --list exits 0 against this repo after provisioning"
- [✔] [script] AC-GD-3: (a) a BARE G<n> token ANYWHERE in the ledger makes the checker exit EXACTLY 3 naming the entry, while GAP-<n> exits 0. Whole-document: 65 bare tokens / 19 ids, not just the 18 headings (G5 has none). (b) FENCE EXEMPTION, BOTH WAYS: the SAME token inside the fenced legacy-gap-aliases region at the head exits 0, AND that token one line OUTSIDE the fence still exits exactly 3. (c) QUALIFIER EXEMPTION (D4d), BOTH WAYS: PRD-001 G8 exits 0 anywhere, AND a line carrying BOTH a qualified PRD-001 G8 and a bare G8 still exits exactly 3 — key on the immediately preceding PRD-001 qualifier, not on line-mentions-PRD-001. (d) SSOT, BOTH DIRECTIONS, EXIT CODES PINNED: injected corpus doc with a bare G<n> while its mirror is CLEAN or ABSENT → exits EXACTLY 3 (a mirror-keyed build exits 0 and FAILS); CLEAN corpus doc while the mirror carries a bare G<n> → exits 0 (a mirror-keyed build exits 3 and FAILS). One direction alone cannot separate the two. (e) STRUCTURED ENTRIES, rejection pinned: entries carry id, status, owning_spec and optional open_half_carried_by, status one of open|half-closed|closed|corrected-record|not-a-lore-gap; an injected entry MISSING owning_spec exits EXACTLY 3; an OUT-OF-ENUM status exits EXACTLY 3. (f) UNOWNED-GAP REPORT, predicate AND membership pinned since an empty list also exits 0. Predicate: (status==open AND no owning_spec) OR (status==half-closed AND no open_half_carried_by). Against the live renamed ledger it exits 0 and its set EQUALS exactly {GAP-7, GAP-8, GAP-11, GAP-15, GAP-16, GAP-17, GAP-18, GAP-19} — SET EQUALITY: a missing and an extra member both fail. GAP-11 IS listed (half-closed, no carrier); GAP-1 is NOT (carrier GAP-17). A REPORT not a gate: no per-entry authorship timestamp, so no retroactive cutoff is decidable. (g) exits 0 against the LIVE ledger, not only fixtures; per D4c the rename lands first. (h) GAP-19 scope line MUST contain main and MUST NOT contain PENDING, mirror branch, or a9f801dd
  script: test — bunx vitest run scripts/tests/check-gap-namespace.test.ts 2>&1 && bun scripts/check-gap-namespace.ts 2>&1 && echo "AC-GD-3 PASS: a bare G<n> anywhere exits exactly 3, GAP-<n> and PRD-001 G<n> exit 0, a bare token beside a qualified one on the same line still exits 3, the fence exempts only inside itself, the checker reads the corpus SSOT not the mirror, entries carry id/status/owning_spec, the unowned-gap report exits 0 counting half-closed open halves, and the LIVE renamed ledger exits 0"
- [·] [script] AC-GD-4: The unconfigured-upstream disclosure names the REAL sharing mechanism, superseding AC-GD-2 wording forward: the message MUST contain .lore/config.yaml and shared, MUST contain a token stating it is NOT tracked (untracked or not git-tracked), and MUST NOT contain the bare claim git-tracked standing on its own as the mechanism. Measured 2026-08-11, four independent ways: git check-ignore -v matches .gitignore:9 .lore/* (excepting only export-index.json and audit-anchor.json), git ls-files .lore/ lists exactly those two, git log --all for the file is empty, and git show main:.lore/config.yaml fatals. The sharing is by FILESYSTEM — every linked worktree resolves to one physical file via findLoreDbPath walk-up — which is strictly MORE dangerous than git-tracked: the edit appears in no diff, gets no review, and can never raise a merge conflict. ⛔ AC-GD-2 keeps its attested pass against the pin it actually had; this criterion supersedes forward rather than retro-editing a passed AC and its evidence, because those two are indistinguishable in an audit. Also assert the substantive consequence, not only the wording: a worktree-isolated agent CANNOT land this file, so the oracle asserts the message names the orchestrator (or an equivalent main-checkout-only instruction) as the party who must apply it
  script: test — bun test packages/lore/tests/unit/adapters/report-issue-single-remedy.bun.test.ts 2>&1 && echo "AC-GD-4 PASS: disclosure names .lore/config.yaml as untracked-but-shared, drops the false git-tracked mechanism, and names who can land it"

## Code anchors

- packages/core/src/config.ts
- packages/lore/src/adapters/cli/commands/report-issue.ts
