---
id: SPEC-134
type: spec
role: spec
title: "Bootstrap fixpoint integrity: binary provenance, an anchor-coverage ratchet, and mirror content drift"
status: approved
priority: medium
created: 2026-08-11
updated: 2026-10-17
tags: []
---
# Bootstrap fixpoint integrity: binary provenance, an anchor-coverage ratchet, and mirror content drift

## Overview

Lore governs its own development, so its verdicts are only as trustworthy as its ability to prove
the loop closed. This spec lands the three missing fixpoint criteria measured on 2026-08-11: the
binary that issues verdicts declares the commit it was built from (D1), corpus↔code anchor coverage
is reported with its members and ratcheted from a measured baseline instead of decaying silently
(D2), and the git-side mirror is compared on content rather than on filenames alone (D3).

## Context

Lore governs its own development: 1337 docs, all about Lore. That self-application is the
platform's credibility source, but it only *means* something if the loop has a fixpoint
criterion — the self-bootstrapping compiler's `stage2 == stage3`. Measured 2026-08-11, Lore's
fixpoint machinery has three holes, each on a different layer of the loop.

All figures below are measured, not estimated. Reproduce with the commands named per decision.

### The trust root is unverified (D1)

`/Users/apple/.local/bin/lore` is a symlink into `/Users/apple/Projects/zz/lore/dist/lore` —
**the binary that governs this repo's development IS the binary being developed here.** This is
Thompson's trusting-trust shape, and it has already fired once:
`knowledge-eight-findings-from-building-and-closing-the-plan` §4 records a co-resident session
re-branching the shared checkout, so `lore` silently became a build WITHOUT the slice under test,
and a plan-close denial quoted a `min_ratio` default that slice had already removed.

That finding's mechanization stopped at author discipline — *"any oracle exercising gate/CLI
behaviour must invoke the binary built from the tree under test and should assert the binary's
identity first."* Prose that should have been followed is not a mechanism; a defect already
covered by existing prose is proof the prose layer is the wrong layer. **Nothing today can answer
"was this verdict issued by a binary built from this source?"**

Measured now: `dist/lore` mtime 1786373496 vs HEAD commit time 1786373386 — currently in sync by
110 seconds, with a clean tree. That is an accident of timing, not an invariant. A stale binary
applies yesterday's rules to today's code and leaves no trace of having done so.

### The anchor-coverage ratchet is missing, so coverage decays (D2)

`lore status --check-drift` is the corpus↔code fixpoint check. It reports
`consistent (87 spec(s) checked)` — but there are **142 live specs**, so it is blind to 55 of
them (38.7%). Verified by direct query, because `lore list --type spec --json` projects
`extra` as `{}` and cannot be used for this measurement:

```sql
-- sqlite3 "file:.lore/lore.db?mode=ro"
SELECT COUNT(*) FROM docs WHERE type='spec' AND deleted_at IS NULL
  AND status NOT IN ('archived','deprecated')
  AND json_array_length(json_extract(extra,'$.code_anchors'))>0;   -- 87 of 142
```

This is decay, not an absence. `knowledge-convergence-backfill-code-anchor-adoption-armed-gate-f`
records the oracle armed on 2026-07-14 at **38/49 = 78%**, with **11 specs deliberately left
unanchored** (implementations spread across files with no clean anchor; anchoring them imprecisely
would manufacture false-drift noise). Splitting today's 55 by that date reproduces the split
exactly:

| cohort | count | disposition |
|---|---|---|
| unanchored, created ≤ 2026-07-14 | 11 | the deliberate exemptions named in that knowledge doc |
| unanchored, created > 2026-07-14 | **44** | new debt — every spec authored since the backfill |

44 of 44 specs written after the backfill declared no anchor. The backfill landed coverage; nothing
held it. That doc's own meta-lesson — *"mechanism landing is not adoption"* — reproduced on the very
mechanism it was written about.

### Mirror integrity checks everything except the content (D3)

`spec-falsifiability-reachability-a-feedable-checkpoint-an` (approved) already covers three layers
of mirror integrity: AC-FR-6 count parity, AC-FR-7 drift detection that must not self-repair,
AC-FR-10 filename↔frontmatter-id byte-identity. The export script's own `--check` output states the
residual verbatim:

```
export-spec-mirror --check: OK — every corpus spec has a mirror file
(count and slug parity; file CONTENT is not compared).
```

So a mirror file whose body no longer matches its corpus document passes every existing check. The
mirror is the corpus's projection onto git — the one surface a consumer without `.lore/` can read —
and its body is exactly the part nobody verifies.

## Decisions

### D1 — The binary declares the commit it was built from, and a check compares it to the source tree

`bun run build` embeds build provenance into the binary: the commit sha it was built from, whether
that tree was dirty, and the build timestamp. `lore status --json` exposes it as a
`binary_provenance` block. A new `lore status --check-binary-provenance` compares the embedded
commit against the HEAD of the repository that owns the corpus being addressed.

**Three-state, never two.** The check must distinguish:

1. `dev-synced` — the binary's build commit equals the corpus repo's HEAD → exit 0.
2. `dev-stale` — the binary's build commit is a commit in this repo but not HEAD → **fail loud**,
   naming BOTH shas.
3. `not-a-dev-checkout` — the binary's build commit is unknown to this repository (an npm-installed
   binary, the normal consumer case) → exit 0 with an explicit `skipped` reason.

State 3 is the distribution-first requirement and the primary false-positive risk: a consumer who
ran `npm i -g lore` must never be told their binary is stale. ⛔ Collapsing 3 into 2 makes the check
unusable outside this repo; collapsing 3 into 1 makes it vacuous — a check that silently passes
when it cannot measure is the eighth false-oracle vector
(`knowledge-three-of-lore-s-own-outputs-misled-this-session-a`).

Enforcement point is `hooks/pre-push`, alongside the three checks already there. ⛔ `hooks/pre-push`
and `assets/project/pre-push` are a byte-identical parity-pinned pair — both change together and the
assets manifest is regenerated, or the change does not ship.

### D2 — Anchor coverage is reported with its members, ratcheted from a measured baseline, and exempted by an auditable ledger

Follows `adr-a-newly-armed-structural-oracle-enforces-from-a-baseline` verbatim; this slice invents
no new enforcement shape.

1. **Report with members, through the EXISTING seam.** A corpus-wide count with no member list is
   a governance defect in its own right (AC-FR-5 in the falsifiability spec establishes the rule;
   `knowledge-four-governance-tooling-gaps-measured-while-resuming` records the cost). ⛔ The member
   list is served by registering an enumerator for the existing `code_anchor_specs` count field on
   `COUNT_FIELD_ENUMERATORS`, so `lore status --enumerate code_anchor_specs` returns it — NOT by a
   parallel bespoke `code_anchor_coverage` block. **AC-BFI-4 is authoritative on this shape**; an
   earlier revision of this line specified the bespoke block and was corrected 2026-08-17 after a
   review flagged the two halves of this spec prescribing different surfaces for one thing
   (`knowledge-five-governance-gaps-measured-while-landing-the` G7).
2. **Ledger, not a glob.** `scripts/anchor-coverage-ledger.json` — shaped after
   `scripts/ac-ref-exemption-ledger.json` — holds one row per unanchored spec: slug, cohort
   (`deliberate` | `debt`), and the reason. It dispositions EVERY currently-unanchored live spec,
   enforced as set equality against a freshly measured set rather than a pinned count — **AC-BFI-5
   is authoritative on the predicate.** At the 2026-08-11 baseline that was 55 rows: the 11
   pre-backfill specs as `deliberate` quoting the 2026-07-14 rationale, the 44 post-backfill specs
   as `debt`. Measured again 2026-08-18, the file held 59 rows as the corpus grew — which is why the
   count is dated here and de-pinned in the criterion. ⛔ Writing a row is preferred over synthesizing an anchor: declaring 44 imprecise
   anchors would satisfy the checker while producing 44 paths indistinguishable, afterwards, from
   measured ones.
3. **Ratchet from baseline, not tree-green.** The check fails when a spec outside the ledger has no
   anchors — i.e. new debt is blocked from the first commit onward. The landing criterion is NOT
   "the whole tree is anchored".
4. **The ledger cannot outlive its debt.** A ledger row naming a spec that now HAS anchors fails
   loud, so the ledger can never decay into a suppression list.

### D3 — The mirror check compares content, and still must not repair what it inspects

Extend the existing `--check` (never a second script) to compare each mirror file's body against its
corpus document's content, reporting every divergent slug by name. Two constraints carry over from
the approved falsifiability spec and are non-negotiable here:

- The check MUST NOT regenerate what it inspects (AC-FR-7). Run twice, it reports the same drift
  both times.
- Exit codes stay documented and exact. ⛔ Asserting merely "non-zero" is unacceptable — a check
  that crashes before inspecting anything also exits non-zero and has zero discriminating power.

**Sequencing constraint, measured 2026-08-11T02:50Z:** `agent:mirror-id-unify` holds a live claim on
`task-unify-mirror-identifiers-on-zero-padded-form-export-all` (worktree
`worktree-agent-a9f801dd0f61837b2`) whose file anchors are exactly
`scripts/export-spec-mirror.ts`, `scripts/export-spec-mirror-core.ts`,
`scripts/tests/spec-mirror-export.test.ts`, `package.json`. `lore ready` already reports the anchor
conflict. D3's task therefore sits in the LAST phase and may not be claimed until that work is
merged and `main` is green — `main` is RED as of this writing (`links_broken` = 43,
`migration-coverage.test.ts` exit 1). ⛔ Do not dispatch D3 on a batch-start snapshot; re-read the
claim immediately before dispatch.

## Scope

**In scope.** `bun run build`'s provenance embedding; `lore status`'s JSON surface and its new
`--check-binary-provenance` / anchor-coverage checks; `scripts/anchor-coverage-ledger.json` and its
checker; the content comparison inside the existing spec-mirror `--check`; the two pre-push
hook copies that must stay byte-identical; the ledger test's independence from the checker it
tests; and the pre-push trip test's name together with every tracked record of its old name.

**Out of scope (non-goals).**

- Gating writes on binary staleness. D1 reports and blocks at push time; it does not intercept
  `lore create`/`set`. A corpus write refused because of a build-time mismatch would strand an agent
  with no self-service recovery.
- Backfilling anchors for the 44 debt specs. They are dispositioned in the ledger; anchoring them is
  separate work with its own accuracy requirements.
- Any change to how `--check-drift` compares anchors it already has. This slice widens coverage
  reporting and arms a ratchet; the drift predicate itself is untouched.

## Acceptance Criteria

Structured, machine-checkable criteria are declared via `lore ac add` and are the authoritative
set — read them with `lore ac list <this-spec>`. Summarised by decision:

- **D1** — provenance is embedded and readable (`binary_provenance` in `lore status --json`); the
  check distinguishes all three states (`dev-synced` / `dev-stale` / `not-a-dev-checkout`) with
  exact documented exit codes, naming both shas when stale; and it is wired into BOTH byte-identical
  pre-push copies.
- **D2** — coverage is reported with its member list, not a bare count; the ledger dispositions
  every currently-unanchored live spec, enforced as SET EQUALITY against a fresh measurement rather
  than a pinned count (an earlier revision of this bullet pinned "55", which was already false once
  the corpus grew); a new unanchored spec outside the ledger fails the check by name; and a ledger
  row whose spec has since been anchored fails loud as a stale exemption.
- **D3** — a mirror file whose body diverges from its corpus document is reported by slug, the check
  does not repair what it inspects (two consecutive runs report identically), and its exit code is
  exact rather than merely non-zero.

- **Follow-ups — AC-BFI-10 and AC-BFI-11, appended 2026-08-18 after the first plan had already
  closed.** (i) The ledger test must assert membership as a slug set it computes ITSELF instead of
  delegating that half to the checker's exit code — the checker is the subject under test, so
  delegating makes the test and AC-BFI-5 go vacuously green together, with no independent witness
  anywhere. (ii) The pre-push trip test, which holds BOTH the AC-BFI-3 and the AC-BFI-9 suite, is
  renamed to `pre-push-trip.bun.test.ts`, and all four tracked records of the old name — this spec's
  own `code_anchors`, the sibling parity-test comment, the file's internal diagnostic prefix, and
  root `CLAUDE.md` — converge in the SAME change and are asserted by cases inside the renamed suite.

- **Second-order follow-ups — AC-BFI-12 and AC-BFI-13, added 2026-08-19.** `lore assess` found,
  AFTER AC-BFI-10 and AC-BFI-11 were both attested and their tasks archived, that neither
  criterion's in-suite falsifier actually discriminated: AC-BFI-10's red case exercised a helper
  rather than the happy case's assertion, so weakening that assertion reddened nothing; and
  AC-BFI-11's case (d) proved only that `--check-drift` exits 0, which any existing anchor
  satisfies. AC-BFI-12 requires one SHARED assertion function across the happy and falsifier
  paths (plus refreshing the comment that commit `2c606027` turned stale), and AC-BFI-13
  requires case (d) to assert the anchor's stored VALUE. ⛔ AC-BFI-13's own red is recorded as
  UNMEASURED debt, not as satisfied: forcing it needs a throwaway-corpus fixture, because the
  only anchor under test lives in this repo's corpus, which tests may never write.

  These two exist because attestation certified an oracle whose falsifier was inert. Attestation
  proves a command ran and exited 0; it says nothing about whether the assertions inside it can
  fail. That gap is what `assess` caught, and it is why `assess` is load-bearing here rather than
  advisory-in-practice.

Every criterion above carries a declared falsifier: the RED case that must fail if the mechanism is
inert. ⛔ A criterion never observed red is not evidence
(`spec-oracle-tier-falsifiability-a-criterion-never-observed-red`).

## Re-baseline — AC-BFI-14, 2026-08-21: its own enumeration was wrong and its oracle caught it

⛔ Recorded because an AC edited after it has been GREEN is indistinguishable in the audit
trail from covering up a failure, however justified. AC-BFI-14 had an ATTESTED pass
(exit 0) at the time of this edit; the oracle command is BYTE-UNCHANGED.

**Original statement, opening clause, verbatim:**

> ONE PRODUCTION DEFINITION OF THE ANCHORED PREDICATE, WITH THE INDEPENDENT WITNESS PINNED TO IT BY A DIFFERENTIAL TABLE (AC-BFI-10 follow-up; larger than that note claimed). Measured 2026-08-21: 'anchored iff extra.code_anchors is a non-empty array' exists in THREE hand-written copies — isSpecAnchored (scripts/check-anchor-coverage.ts), countArmedSpecs (packages/lore/src/flows/drift-flow.ts, which feeds the PUBLISHED code_anchor_specs field of lore status --json), and the raw-SQL witness inside the ratchet test. Nothing binds them, so the ratchet and the published count can drift apart silently. TWO HALVES, not to be collapsed: (1) the two PRODUCTION copies become ONE exported predicate bot

**The exact observation that prompted the change.** The statement asserted THREE hand-written
copies and named them: `isSpecAnchored` (`scripts/check-anchor-coverage.ts`),
`countArmedSpecs` (`packages/lore/src/flows/drift-flow.ts`), and the raw-SQL witness inside
the ratchet test. The implementer's repo-wide scan — the oracle this criterion declares, run
for real — reported **three files, not one**, because a THIRD PRODUCTION copy existed that the
statement did not name: `collectCodeAnchorSpecMembers` at
`packages/lore/src/adapters/cli/commands/status.ts:708-709`, added by an earlier already-merged
AC-BFI-4 task. Verified independently against the pre-merge tree
(`git show 7699bf6d:packages/lore/src/adapters/cli/commands/status.ts` → the inline
`Array.isArray(raw) && raw.length > 0` at those lines).

So the true population was FOUR sites — three production plus the witness — and the statement
had counted the witness as one of the three while missing a real production copy.

**Why this is a correction and not a weakening.** Nothing about the obligation changed: the
oracle is still the repo-wide scan, still finds exactly one construction site, and the
witness's separateness is still refused-to-be-collapsed. Only the DESCRIPTIVE enumeration was
wrong, and the criterion's own text already said an enumerated file list "cannot observe that
and is explicitly NOT the oracle" — which is exactly why the scan caught the author's error
instead of inheriting it. The edit also adds the sentence marking the enumeration descriptive
and pointing here, so the next reader does not take the list as authoritative.

**The consequential defect this exposed is in the TASK, not the AC.** The task's
`file_anchors` were derived from the wrong enumeration, so `status.ts` was never anchored —
and it IS an anchor of the concurrently-live
`task-land-the-adopted-resolution-state-its-required-owner` in another plan. The implementer
therefore had to choose between violating a mutex it could not see and failing an AC it could
not satisfy. It chose to fix and flag, which was the right call. ⛔ The general rule: when an
AC's oracle is a repo-wide scan, the task's anchor set CANNOT be enumerated by hand, because
the scan's universe is unknown until it runs. Full analysis:
`knowledge-a-repo-wide-oracle-cannot-have-hand-enumerated-file`.

## Falsifiers declared 2026-08-21, post-fix, by the orchestrator

Per this plan's declared sequencing, the implementers did not run `lore ac set` (it demotes
this spec and would have frozen the sibling claim). Declared after both merges:

- `AC-BFI-14` → mutate `isSpecAnchored` in `packages/lore/src/flows/drift-flow.ts` from the
  non-empty-array test to a mere `!== undefined`, expected exit 1.
- `AC-BFI-15` → repoint the fixture spec to `ANCHOR_FILE_A` instead of `ANCHOR_FILE_B`, so
  the RED-direction assertion has nothing to detect, expected exit 1.

⛔ Both are declared while this plan is LIVE and are run through `lore verify --falsify`
before it archives. A falsifier whose governing plan is archived can never be re-run — all 8
pre-existing declarations in this corpus are already dead for exactly that reason
(`knowledge-the-falsifier-mechanism-is-shipped-but-inert-a` F2).

## ⛔ CORRECTION 2026-08-21 — the two `--falsify` rows on AC-BFI-14/15 are VACUOUS

The falsifier declarations recorded above are correct in content. The runs made through them
are NOT evidence, and this section exists so no reader of `lore ac list`'s `⚑` marker or of the
two `result: "expected-fail"` / `capture_source: "runner"` rows concludes otherwise.

`lore verify --falsify` builds a scratch git worktree, applies the mutation there, and compares
ONLY the exit code. That worktree has no `node_modules`, so both commands died at module
resolution — `Cannot find package 'vitest'` for AC-BFI-14, `Cannot find module '@lore/core'`
for AC-BFI-15 — before any assertion ran. Both exited 1; both declared 1; both were recorded as
proven reds. ⛔ The mutation was never exercised.

Where the discriminating power for these two criteria ACTUALLY comes from: the implementers'
in-worktree reds, which are self-reported but carry genuine assertion failures — the uniqueness
scan reporting `expected [ …(2) ] to deeply equal [ Array(1) ]` while naming the injected file,
and the differential table reporting `witness classified anchored=false but the shared
isSpecAnchored classified anchored=true`. For these two ACs the self-reported rows are the
evidence and the runner-attested rows are the artifact.

Full mechanism, required fix, and the reason a better exit code cannot solve it:
`knowledge-lore-verify-falsify-compares-only-the-exit-code-so-an`.

Also re-measured 2026-08-21 after `lore assess` flagged both as edited-but-not-re-verified —
both hold, evidence recorded on `task-collapse-the-two-production-copies-of-the-anchored`:
`AC-BFI-4`'s oracle (`anchor-coverage-surface.test.ts`) 7/7 pass exit 0, and `AC-BFI-10`'s
(`anchor-coverage-ratchet.test.ts`, unfiltered) 26/26 pass exit 0.


## Acceptance Criteria (structured)

- [⚑] [script] AC-BFI-1: PROVENANCE EMBEDDED AND PINNED TO THE REAL BUILD TREE (D1): a binary produced by `bun run build` carries the commit it was built from, and `lore status --json` exposes binary_provenance{build_commit, build_dirty, built_at}. ⛔ Shape assertions alone are insufficient — a hardcoded 40-hex placeholder satisfies /^[0-9a-f]{40}$/ — so the test MUST assert build_commit EQUALS the actual HEAD sha of the tree it just built, read independently via 'git rev-parse HEAD' at test time, and build_dirty EQUALS the actual porcelain-emptiness of that tree. RED (both required, and (b) is the one that catches the real failure mode): (a) remove the injection entirely and the field must be absent/null, failing; (b) replace the injection with a well-formed CONSTANT sha of correct shape — the equality-to-real-HEAD assertion must still fail, proving the oracle discriminates a measured value from a plausible fake.
  script: test — bunx vitest run packages/lore/tests/unit/status/binary-provenance.test.ts 2>&1 && echo 'AC-BFI-1 PASS: lore status --json carries binary_provenance{build_commit,build_dirty,built_at} from a real build'
- [⚑] [script] AC-BFI-2: THREE-STATE CHECK WITH EXACT EXITS (D1): `lore status --check-binary-provenance` distinguishes all three states with these exact exit codes — dev-synced (build commit == corpus repo HEAD) exits EXACTLY 0; dev-stale (build commit is a commit in this repo but not HEAD) exits EXACTLY 3, joining the existing --check-* drift family whose measured code is 3 (verified 2026-08-11: 'lore status --check-tree --check-drift' on 3 plan-terminality drifts exits 3), AND its output names BOTH shas; not-a-dev-checkout (build commit unknown to this repo — the npm-installed consumer case) exits EXACTLY 0 with the literal token 'skipped' in its output. RED (both machine-checkable): (a) collapse not-a-dev-checkout into dev-stale and the consumer case must exit 3 instead of 0, failing; (b) collapse dev-stale into a pass and the stale case must exit 0 instead of 3, failing. ⛔ The test asserts exit == 3, never 'non-zero': a check crashing before it inspects anything also exits non-zero and has zero discriminating power.
  script: test — bunx vitest run packages/lore/tests/integration/binary-provenance-check.test.ts 2>&1 && echo "AC-BFI-2 PASS: dev-synced exits 0, dev-stale exits exactly 3 naming both shas, not-a-dev-checkout exits 0 with the skipped token"
- [⚑] [script] AC-BFI-3: PRE-PUSH WIRING, BOTH COPIES (D1): the binary-provenance check is invoked from hooks/pre-push, and hooks/pre-push is byte-identical to assets/project/pre-push — proving the check is WIRED into the shipping surface, not merely present in the repo. RED: wire only hooks/pre-push and leave assets/project/pre-push untouched — the byte-identity diff must fail, so a consumer-invisible fix cannot pass. Runnable TODAY; measured red 2026-08-11 by segment (parity segment exit 0, wiring segment exit 1), proving the red comes from the missing wiring and not from a pre-existing parity break.
  script: lint — diff hooks/pre-push assets/project/pre-push && grep -c check-binary-provenance hooks/pre-push && echo 'AC-BFI-3 PASS: both pre-push copies byte-identical AND invoke --check-binary-provenance'
  other_command=5
- [⚑] [script] AC-BFI-4: COVERAGE COUNT REPORTED WITH A REGISTERED ENUMERATOR (D2): anchor coverage is exposed through the EXISTING count/enumerator seam, not a parallel bespoke field - lore status --json carries the coverage count and lore status --enumerate <that field> returns its member list from COUNT_FIELD_ENUMERATORS (AC-FR-5 established this contract). The oracle spawns the real lore binary and reads its stdout; it asserts only what stdout can show: the enumerate call exits 0, and the printed member count EQUALS the count field in --json. Deriving the number from the list length rather than a separate counter is the intended implementation, but is NOT claimed as an assertion here because CLI output cannot distinguish the two - RED (b) below is what makes divergence detectable, and that is the guarantee this criterion offers. Measured 2026-08-11: status reports code_anchor_specs=87 of 142 live specs while lore status --enumerate code_anchor_specs exits 4 naming the four registered fields, so today it is a bare count with no member list - exactly the shape AC-FR-5 forbids, sitting on the field this slice ratchets. RED (both deterministic): (a) report the count without registering an enumerator - the enumerate call exits 4 and this fails; (b) register an enumerator that returns a TRUNCATED list while leaving the count field correct - the equality assertion must fail, naming both numbers.
  script: test — bunx vitest run packages/lore/tests/integration/anchor-coverage-surface.test.ts 2>&1 && echo 'AC-BFI-4 PASS: anchor coverage count is enumerable via the registered COUNT_FIELD_ENUMERATORS seam, count == len(members)'
  other_command=3
- [⚑] [script] AC-BFI-5: LEDGER DISPOSITIONS EVERY EXISTING UNANCHORED SPEC (D2): scripts/anchor-coverage-ledger.json holds one row per currently-unanchored live spec — 55 at the measured 2026-08-11 baseline, though the enforced predicate is SET EQUALITY against the freshly measured unanchored set, never the literal 55 — each row carrying slug, cohort (deliberate|debt) and reason. The reason field is machine-constrained, not merely present: non-empty after trim, at least 20 characters, and not a member of the placeholder set {tbd, todo, n/a, na, -, ?, xxx, fixme, pending} case-insensitively — otherwise a ledger of 44 rows reading 'tbd' would satisfy the checker while documenting nothing. Cohort split is fixed by measurement: 11 specs created on or before 2026-07-14 are 'deliberate' (rationale inherited from knowledge-convergence-backfill-code-anchor-adoption-armed-gate-f: implementations spread across files with no clean anchor), the 44 created after are 'debt'. RED (both required): (a) delete one row and the checker must fail NAMING that slug; (b) replace one row's reason with 'tbd' and the checker must fail NAMING that slug — proving the reason predicate is live and not decorative. ⛔ Writing a row is preferred over synthesizing an anchor: 44 imprecise anchors would satisfy the coverage predicate while being indistinguishable, afterwards, from measured ones.
  script: lint — bun run scripts/check-anchor-coverage.ts 2>&1 && echo "AC-BFI-5 PASS: ledger set == the freshly measured unanchored live-spec set; the checker verdict line above carries the measured counts"
  other_command=4
- [⚑] [script] AC-BFI-6: RATCHET BLOCKS NEW DEBT (D2): a live spec that declares no code_anchors and has no ledger row makes the checker exit EXACTLY 1 (the scripts/check-*.ts convention for a repo-invariant failure, distinct from the CLI's own 2/3/4 family) and the output NAMES that spec's slug. Baseline-scoped enforcement per adr-a-newly-armed-structural-oracle-enforces-from-a-baseline: the landing criterion is NOT a tree-wide green, it is that the 56th unanchored spec cannot appear silently. RED: add that same spec to the ledger and the identical run must exit EXACTLY 0 — the paired transition proves the failure was caused by the missing disposition rather than an unrelated crash, which a bare exit-1 assertion cannot distinguish.
  script: test — bunx vitest run packages/lore/tests/unit/scripts/anchor-coverage-ratchet.test.ts 2>&1 && echo 'AC-BFI-6 PASS: an unanchored, unledgered spec fails the checker by name; ledgering it turns the same run green'
  other_command=1
- [⚑] [script] AC-BFI-7: THE LEDGER CANNOT OUTLIVE ITS DEBT (D2): a ledger row naming a spec that NOW declares code_anchors makes the checker exit EXACTLY 1 — the same code AC-BFI-6 pins, since both are the one checker's repo-invariant failure — and the output NAMES that slug, so the ledger can never decay into a suppression list (adr-a-newly-armed-structural-oracle-enforces-from-a-baseline, consequence 3). RED (paired, both required): declare anchors on a ledgered spec WITHOUT removing its row and the checker must exit EXACTLY 1; then remove the row and the identical run must exit EXACTLY 0. ⛔ A checker validating only the forward direction (unanchored implies ledgered) exits 0 on this scenario and is the precise failure being excluded — the reverse direction is the whole point of this criterion.
  script: test — bunx vitest run packages/lore/tests/unit/scripts/anchor-coverage-stale-exemption.test.ts 2>&1 && echo 'AC-BFI-7 PASS: a ledger row whose spec has since been anchored fails loud by name'
  other_command=1
- [⚑] [script] AC-BFI-8: MIRROR CONTENT DRIFT IS DETECTED, AND NOTHING REPAIRS IT BEFORE THE ASSERTION (D3): with one mirror file body edited so it no longer matches its corpus document, the spec-mirror --check exits EXACTLY 2 (MIRROR_DRIFT_EXIT_CODE, export-spec-mirror-core.ts:63; NOT 4 = MIRROR_HARD_FAILURE_EXIT_CODE line 65, which would make a crash indistinguishable from a detection) and NAMES the divergent slug. TWO no-repair conditions, BOTH required: (i) the CHECK must not regenerate what it inspects - run twice consecutively it reports the same drift both times (AC-FR-7); (ii) NOTHING may re-export between the mutation and the assertion - the test hashes the mutated file immediately after mutating it, re-reads that hash immediately before asserting, and the two MUST be equal. (ii) is real, and an export-free setup here does NOT satisfy it: measured on main at cedb29db 2026-08-11, one full bun run test moved the mirror fingerprint 45ea1381 -> 4c84f428 and left docs/requirements and .lore/export-index.json modified, because the SIBLING file scripts/tests/spec-mirror-export.ts runs the REAL exporter against the REAL production corpus by design (AC-FR-6/7/10 require that) and vitest runs files concurrently. This test MUST be isolated from concurrent exporters; (ii) proves the isolation held rather than assuming it. The script chain itself is clean - check:spec-mirror is --check only, mirror:export is chained from nothing - so chain inspection alone would miss this. RED, all three deterministic: (a) make the check call the exporter first so the second consecutive run reports clean - must fail; (b) restore the body to match the corpus and the identical run must exit EXACTLY 0, proving the red came from divergence not a crash; (c) invoke the real exporter between the mutation and the assertion - the hash equality in (ii) must fail. (c) is a FORCED interleave, never a concurrency race: a scheduling-dependent red that may not occur is not a red.
  script: test — bunx vitest run scripts/tests/spec-mirror-content-drift.test.ts 2>&1 && echo 'AC-BFI-8 PASS: body divergence detected by slug, exact exit code, and two consecutive runs report identically'
  other_command=3
- [⚑] [script] AC-BFI-9: ANCHOR-RATCHET WIRING, BOTH COPIES (D2): the anchor-coverage checker is invoked from hooks/pre-push, and hooks/pre-push stays byte-identical to assets/project/pre-push — the D2 sibling of AC-BFI-3, because a checker that exists but runs in no pipeline enforces nothing. ⛔ This exists because capability and production wiring must be the SAME acceptance unit: AC-BFI-5/6/7 all invoke the checker directly and would go green on a checker no pipeline ever calls. RED: land the checker with both pre-push copies untouched and this must fail; wire only hooks/pre-push and the byte-identity diff must fail, so a consumer-invisible fix cannot pass. Runnable TODAY and MUST be red before the D2 phase lands.
  script: lint — diff hooks/pre-push assets/project/pre-push && grep -c check-anchor-coverage hooks/pre-push && echo 'AC-BFI-9 PASS: both pre-push copies byte-identical AND invoke check-anchor-coverage'
  other_command=1
- [⊘] [script] AC-BFI-10: THE LEDGER TEST MUST NOT DELEGATE MEMBERSHIP BACK TO THE CHECKER (AC-BFI-5 follow-up): packages/lore/tests/unit/scripts/anchor-coverage-ratchet.test.ts's happy case currently asserts only shipped.entries.length === unanchored, and its own comment states that the checker's exit 0 supplies the membership half. That is circular: the checker is the very thing under test, so if its set-equality logic regressed to a pure count the test would stay green AND AC-BFI-5's oracle (the checker itself) would exit 0 — the AC would be vacuously green with no independent witness. The test MUST compute the unanchored live-spec slug set INDEPENDENTLY of the checker's output or exit code, and compare it as a SET to the slug set read from scripts/anchor-coverage-ledger.json, failing with the differing slugs NAMED. Cardinality may remain as an additional assertion but must not be the only one. Covered by the describe block titled 'AC-BFI-10: ledger membership is asserted as a slug set, independently of the checker' in that same file. RED: swap two slugs that both already appear in the ledger — row count is unchanged, so the cardinality assertion stays green, while the set now duplicates one slug and omits another and the set assertion must fail naming the omitted slug.
  script: test — bunx vitest run packages/lore/tests/unit/scripts/anchor-coverage-ratchet.test.ts 2>&1 && echo 'AC-BFI-10 PASS: the ledger test compares slug SETS derived independently of the checker, not just cardinality'
  other_command=3
- [⚑] [script] AC-BFI-11: THE RENAME AND EVERY RECORD OF THE OLD NAME ARE ONE ACCEPTANCE UNIT (NS5): packages/lore/tests/integration/pre-push-trip.bun.test.ts holds TWO suites — AC-BFI-3 at line 198 and AC-BFI-9 at line 295 — so the pre-rename name asserted a scope narrower than its contents. Four records of the old name must stay converged, and THE TEST FILE ITSELF must assert all four as ordinary cases: (a) no tracked file outside docs/requirements contains the literal pre-push-binary-provenance-trip (the historical mirror is deliberately excluded); (b) the pre-rename path does not exist; (c) this file's own diagnostic prefix is pre-push-trip:; (d) lore status --check-drift exits 0, proving this spec's code_anchor was repointed. RED: revert any one record site and the matching case must fail NAMING it. RE-BASELINED 2026-08-18 IN FLIGHT, by the AC's author, after the rename had already landed. ORIGINAL COMMAND chained the four checks as shell preconditions ahead of the runner: 'test -f <new> && test ! -e <old> && ! git grep -qI <old-literal> -- :(exclude)docs/requirements && lore status --check-drift && bun test <new>'. EXACT FAILURE IT PRODUCED: the command exited 0 and the suite reported 13 pass / 0 fail, yet 'lore verify' returned 'AC-BFI-11 inconclusive (ran 1 of 3 declared paths)' exit 3 — countExplicitPathArgs in packages/core/src/attestation-completeness.ts tokenizes the WHOLE && chain and counts every .test.ts-shaped token, so the two existence-check paths inflated declared_paths to 3 while only 1 ever reached a runner. No attestation was issued, so 'lore done' refused the task with an attestation-floor denial. WHY THIS IS A CORRECTION AND NOT A WEAKENING: all four checks are preserved and now run UNDER the runner — reported in its summary, permanent, and individually falsifiable — instead of as an unreported shell preamble. The oracle gains attestation and loses no assertion. The SHAPE was unattestable, not the facts.
  script: test — bunx --bun vitest run packages/lore/tests/integration/pre-push-trip.bun.test.ts 2>&1 && echo 'AC-BFI-11 PASS: rename landed and all four records of the old name are asserted converged by cases inside the renamed suite'
  other_command=7
- [⚑] [script] AC-BFI-12: A DECLARED FALSIFIER MUST DRIVE THE SAME ASSERTION PATH IT CLAIMS TO FALSIFY (vitest half): AC-BFI-10's in-suite 'RED PAIRED' case mutated an IN-MEMORY ledger copy and asserted only diffSlugSets(...).missingFromLedger — the helper, not the assertion. Weakening the HAPPY set expectations therefore left BOTH that case AND the externally declared ledger-mutation falsifier green: nothing reddened, and the circular-oracle defect AC-BFI-10 exists to close reappeared one level down. Found by lore assess AFTER AC-BFI-10 was attested and its task archived. REQUIRED: the happy path and the falsifier path call ONE shared assertion function (assertLedgerSlugSetMatchesMeasured), so no single mutation satisfies one without the other. SAME ACCEPTANCE UNIT: the comment recording that spec-corpus-truthfulness-a-verdict-must-carry-the-state-it carried no anchor and no ledger row must name its disposition — commit 2c606027, 2026-08-18, which added a cohort:debt LEDGER ROW and NOT a code_anchor — keeping its rationale for not coupling the causal test to full-corpus cleanliness. RED, measured 2026-08-19: gut the shared function's body to expect(true).toBe(true) and the falsifier case must go red ('expected [Function] to throw an error') while the happy case stays green. Before the fix that same mutation left BOTH green — that green was the defect. RE-BASELINED 2026-08-19 in flight by the AC's author. ORIGINAL COMMAND chained TWO runners: 'bunx vitest run <ratchet> && bun test <trip>'. EXACT FAILURE: lore verify returned inconclusive, exit 3, under_match, declared_paths 2 / executed_files 1 — countExplicitPathArgs credits only ONE runner invocation per chain, so no attestation was issuable and lore done would refuse. Split by runner: this AC keeps the vitest file, AC-BFI-13 carries the bun file. CORRECTION NOT WEAKENING: both files stay asserted, by two attestable oracles instead of one unattestable one.
  script: test — bunx vitest run packages/lore/tests/unit/scripts/anchor-coverage-ratchet.test.ts 2>&1 && echo 'AC-BFI-12 PASS: the AC-BFI-10 happy case and its declared falsifier call one shared assertion function, and the stale disposition comment names its commit'
  other_command=3
- [⚑] [script] AC-BFI-13: CASE (d) MUST ASSERT THE ANCHOR'S STORED VALUE, NOT ONLY THAT DRIFT IS CLEAN (the bun-runner half split out of AC-BFI-12): AC-BFI-11's case (d) asserted that 'lore status --check-drift' exits 0. That is consistent with this spec's code_anchor having been repointed to ANY existing file, so it did not prove the rename converged the corpus side of the four-record unit. REQUIRED: case (d) keeps the exit-0 assertion AND additionally reads the spec's code_anchors through the freshness-asserted DIST_BINARY constant — never a bare 'lore' on PATH, which resolves to this machine's global symlink rather than the worktree binary — and asserts that some entry ENDS WITH the renamed trip suite's basename. RED: repoint the anchor at another existing file; case (d) must go red WHILE --check-drift still exits 0, and that pairing is the whole discriminator, since drift-clean alone cannot tell a correct anchor from a merely existing one. ⛔ THIS RED IS NOT YET MEASURED, and that is recorded here rather than hidden: constructing it requires mutating a code_anchor, and the only anchor under test lives in this repo's own corpus, which tests may never write (root CLAUDE.md). The implementer began a throwaway-corpus construction and did not finish it; no red was fabricated and none is claimed. So this criterion's discriminating power is currently ARGUED from the assertion's shape, not demonstrated by a measured failure. Closing that debt needs a throwaway-corpus fixture owning its own spec and anchor. NOTE ON THE COMMAND'S WORDING: the success echo deliberately avoids spelling any bare test-file basename, because lore ac add's path precheck tokenizes the WHOLE command string and read a basename inside the echo prose as a missing path (measured 2026-08-19).
  script: test — bunx --bun vitest run packages/lore/tests/integration/pre-push-trip.bun.test.ts 2>&1 && echo 'AC-BFI-13 PASS: case (d) asserts the spec code_anchor value names the renamed trip suite, in addition to --check-drift exiting 0'
  other_command=1
- [⚑] [script] AC-BFI-14: ONE PRODUCTION DEFINITION OF THE ANCHORED PREDICATE, WITH THE INDEPENDENT WITNESS PINNED TO IT BY A DIFFERENTIAL TABLE (AC-BFI-10 follow-up). 'Anchored iff extra.code_anchors is a non-empty array' was hand-written in FOUR places: three PRODUCTION copies — isSpecAnchored (scripts/check-anchor-coverage.ts), countArmedSpecs (packages/lore/src/flows/drift-flow.ts, feeding the PUBLISHED code_anchor_specs field), and collectCodeAnchorSpecMembers (packages/lore/src/adapters/cli/commands/status.ts, that field's own --enumerate member list) — plus the raw-SQL witness in the ratchet test. Nothing bound them, so the ratchet, the published count and its enumerator could drift apart silently. ⛔ This enumeration is DESCRIPTIVE and was measured WRONG once (see the re-baseline log): the oracle is the repo-wide scan, never this list — which is why the scan found the copy the list missed. TWO HALVES, not to be collapsed: (1) all PRODUCTION copies become ONE exported predicate every site imports, asserted REPO-WIDE — a scan of packages/** and scripts/** finds exactly one construction of the non-empty-array test on code_anchors in executable code, so a further copy in a file nobody listed goes red. (2) The TEST WITNESS KEEPS ITS OWN IMPLEMENTATION — importing the shared predicate into the witness is REFUSED, because its separateness is exactly what AC-BFI-10 buys and a shared implementation lets one regression corrupt subject and witness together. It is bound instead by a DIFFERENTIAL case table over a constructed fixture: absent key, empty array, non-array value, non-empty array, and a row with deleted_at set; witness and shared predicate must agree on every row. RED, both required: (a) add a second inline non-empty-array test on code_anchors anywhere in executable code and the uniqueness scan fails naming that file; (b) flip one row in the witness only and the agreement assertion fails naming that case. Covered by the describe block named anchored-predicate-ssot.
  script: test — bunx vitest run packages/lore/tests/unit/scripts/anchor-coverage-ratchet.test.ts -t anchored-predicate-ssot 2>&1 && echo 'AC-BFI-14 PASS: exactly one production definition repo-wide, and the independent witness agrees on all five boundary cases while keeping its own implementation'
  other_command=2
- [⚑] [script] AC-BFI-15: AC-BFI-13'S RED IS MACHINE-MEASURED AGAINST A THROWAWAY CORPUS, NOT CARRIED AS DECLARED DEBT (the bun-runner half). AC-BFI-13 reads THIS repo's own spec code_anchors through the dist binary, so the only way to force its red is to repoint a live corpus anchor — a destructive edit to the team's knowledge base, which is why the red was recorded as declared-but-unmeasured debt instead of run. Measured 2026-08-21 corpus-wide (knowledge-the-falsifier-mechanism-is-shipped-but-inert-a F3): 279 expected-fail evidence rows exist and exactly 2 carry an attestation block, so 'a red is recorded' and 'the oracle was machine-proven to discriminate' currently differ by 138x. This AC closes that gap for one criterion instead of restating the discipline. REQUIRED: case (d)'s assertion runs against a corpus created by mkdtemp plus lore init, holding its OWN spec whose code_anchors this test writes and then repoints, driven by the freshness-asserted DIST_BINARY constant — never a bare lore on PATH, and never this repo's .lore/. The passing direction asserts the anchor value names the expected file AND --check-drift exits 0; the failing direction repoints that fixture spec's anchor to a different existing file and asserts the SAME assertion path exits nonzero naming the anchor it found. ⛔ Asserting only that drift is clean is what AC-BFI-13 already does and is insufficient: a clean drift is consistent with the anchor having been repointed to ANY existing file. RED: delete the repoint step and the failing-direction case must stop failing. Covered by the describe block named fixture-forced-anchor-red.
  script: test — bunx --bun vitest run packages/lore/tests/integration/pre-push-trip.bun.test.ts 2>&1 && echo 'AC-BFI-15 PASS: the anchor-value assertion is forced red inside a throwaway corpus that owns its own spec, and green with the anchor correct, both driven by the dist binary'
  other_command=3

## Code anchors

- scripts/check-anchor-coverage.ts
- scripts/anchor-coverage-ledger.json
- packages/lore/tests/unit/scripts/anchor-coverage-ratchet.test.ts
- packages/lore/tests/unit/scripts/anchor-coverage-stale-exemption.test.ts
- packages/lore/src/service/binary-provenance.ts
- packages/lore/tests/unit/status/binary-provenance.test.ts
- packages/lore/tests/integration/binary-provenance-check.test.ts
- hooks/pre-push
- assets/project/pre-push
- packages/lore/tests/integration/anchor-coverage-surface.test.ts
- packages/lore/tests/unit/assets/pre-push-parity.test.ts
- scripts/export-spec-mirror.ts
- scripts/tests/spec-mirror-content-drift.test.ts
- packages/lore/tests/integration/pre-push-trip.bun.test.ts
