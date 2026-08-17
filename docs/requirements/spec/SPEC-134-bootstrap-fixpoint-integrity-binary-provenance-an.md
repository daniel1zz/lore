---
id: SPEC-134
type: spec
role: spec
title: "Bootstrap fixpoint integrity: binary provenance, an anchor-coverage ratchet, and mirror content drift"
status: approved
priority: medium
created: 2026-08-11
updated: 2026-08-17
tags: []
parent: PRD-001
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

1. **Report with members.** `lore status --json` gains `code_anchor_coverage` carrying
   `anchored` / `total` / `ratio` **and `unanchored_slugs[]`**. A corpus-wide count with no member
   list is a governance defect in its own right (AC-FR-5 in the falsifiability spec establishes the
   rule; `knowledge-four-governance-tooling-gaps-measured-while-resuming` records the cost).
2. **Ledger, not a glob.** `scripts/anchor-coverage-ledger.json` — shaped after
   `scripts/ac-ref-exemption-ledger.json` — holds one row per unanchored spec: slug, cohort
   (`deliberate` | `debt`), and the reason. It ships with all **55** rows dispositioned: the 11
   pre-backfill specs as `deliberate` quoting the 2026-07-14 rationale, the 44 post-backfill specs
   as `debt`. ⛔ Writing a row is preferred over synthesizing an anchor: declaring 44 imprecise
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
checker; the content comparison inside the existing spec-mirror `--check`; and the two pre-push
hook copies that must stay byte-identical.

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
- **D2** — coverage is reported with its member list, not a bare count; the ledger disposition
  covers all 55 currently-unanchored specs; a new unanchored spec outside the ledger fails the check
  by name; and a ledger row whose spec has since been anchored fails loud as a stale exemption.
- **D3** — a mirror file whose body diverges from its corpus document is reported by slug, the check
  does not repair what it inspects (two consecutive runs report identically), and its exit code is
  exact rather than merely non-zero.

Every criterion above carries a declared falsifier: the RED case that must fail if the mechanism is
inert. ⛔ A criterion never observed red is not evidence
(`spec-oracle-tier-falsifiability-a-criterion-never-observed-red`).


## Acceptance Criteria (structured)

- [·] [script] AC-BFI-1: PROVENANCE EMBEDDED AND PINNED TO THE REAL BUILD TREE (D1): a binary produced by `bun run build` carries the commit it was built from, and `lore status --json` exposes binary_provenance{build_commit, build_dirty, built_at}. ⛔ Shape assertions alone are insufficient — a hardcoded 40-hex placeholder satisfies /^[0-9a-f]{40}$/ — so the test MUST assert build_commit EQUALS the actual HEAD sha of the tree it just built, read independently via 'git rev-parse HEAD' at test time, and build_dirty EQUALS the actual porcelain-emptiness of that tree. RED (both required, and (b) is the one that catches the real failure mode): (a) remove the injection entirely and the field must be absent/null, failing; (b) replace the injection with a well-formed CONSTANT sha of correct shape — the equality-to-real-HEAD assertion must still fail, proving the oracle discriminates a measured value from a plausible fake.
  script: test — bunx vitest run packages/lore/tests/unit/status/binary-provenance.test.ts 2>&1 && echo 'AC-BFI-1 PASS: lore status --json carries binary_provenance{build_commit,build_dirty,built_at} from a real build'
- [·] [script] AC-BFI-2: THREE-STATE CHECK WITH EXACT EXITS (D1): `lore status --check-binary-provenance` distinguishes all three states with these exact exit codes — dev-synced (build commit == corpus repo HEAD) exits EXACTLY 0; dev-stale (build commit is a commit in this repo but not HEAD) exits EXACTLY 3, joining the existing --check-* drift family whose measured code is 3 (verified 2026-08-11: 'lore status --check-tree --check-drift' on 3 plan-terminality drifts exits 3), AND its output names BOTH shas; not-a-dev-checkout (build commit unknown to this repo — the npm-installed consumer case) exits EXACTLY 0 with the literal token 'skipped' in its output. RED (both machine-checkable): (a) collapse not-a-dev-checkout into dev-stale and the consumer case must exit 3 instead of 0, failing; (b) collapse dev-stale into a pass and the stale case must exit 0 instead of 3, failing. ⛔ The test asserts exit == 3, never 'non-zero': a check crashing before it inspects anything also exits non-zero and has zero discriminating power.
  script: test — bunx vitest run packages/lore/tests/integration/binary-provenance-check.test.ts 2>&1 && echo 'AC-BFI-2 PASS: dev-synced=0, dev-stale=exact-nonzero naming both shas, not-a-dev-checkout=0 skipped'
- [·] [script] AC-BFI-3: PRE-PUSH WIRING, BOTH COPIES (D1): the binary-provenance check is invoked from hooks/pre-push, and hooks/pre-push is byte-identical to assets/project/pre-push — proving the check is WIRED into the shipping surface, not merely present in the repo. RED: wire only hooks/pre-push and leave assets/project/pre-push untouched — the byte-identity diff must fail, so a consumer-invisible fix cannot pass. Runnable TODAY; measured red 2026-08-11 by segment (parity segment exit 0, wiring segment exit 1), proving the red comes from the missing wiring and not from a pre-existing parity break.
  script: lint — diff hooks/pre-push assets/project/pre-push && grep -c check-binary-provenance hooks/pre-push && echo 'AC-BFI-3 PASS: both pre-push copies byte-identical AND invoke --check-binary-provenance'
- [·] [script] AC-BFI-4: COVERAGE COUNT REPORTED WITH A REGISTERED ENUMERATOR (D2): anchor coverage is exposed through the EXISTING count/enumerator seam, not a parallel bespoke field - lore status --json carries the coverage count and lore status --enumerate <that field> returns its member list from COUNT_FIELD_ENUMERATORS (AC-FR-5 established this contract). The oracle spawns the real lore binary and reads its stdout; it asserts only what stdout can show: the enumerate call exits 0, and the printed member count EQUALS the count field in --json. Deriving the number from the list length rather than a separate counter is the intended implementation, but is NOT claimed as an assertion here because CLI output cannot distinguish the two - RED (b) below is what makes divergence detectable, and that is the guarantee this criterion offers. Measured 2026-08-11: status reports code_anchor_specs=87 of 142 live specs while lore status --enumerate code_anchor_specs exits 4 naming the four registered fields, so today it is a bare count with no member list - exactly the shape AC-FR-5 forbids, sitting on the field this slice ratchets. RED (both deterministic): (a) report the count without registering an enumerator - the enumerate call exits 4 and this fails; (b) register an enumerator that returns a TRUNCATED list while leaving the count field correct - the equality assertion must fail, naming both numbers.
  script: test — bunx vitest run packages/lore/tests/integration/anchor-coverage-surface.test.ts 2>&1 && echo 'AC-BFI-4 PASS: anchor coverage count is enumerable via the registered COUNT_FIELD_ENUMERATORS seam, count == len(members)'
- [✔] [script] AC-BFI-5: LEDGER DISPOSITIONS EVERY EXISTING UNANCHORED SPEC (D2): scripts/anchor-coverage-ledger.json holds one row per currently-unanchored live spec — 55 at the measured 2026-08-11 baseline, though the enforced predicate is SET EQUALITY against the freshly measured unanchored set, never the literal 55 — each row carrying slug, cohort (deliberate|debt) and reason. The reason field is machine-constrained, not merely present: non-empty after trim, at least 20 characters, and not a member of the placeholder set {tbd, todo, n/a, na, -, ?, xxx, fixme, pending} case-insensitively — otherwise a ledger of 44 rows reading 'tbd' would satisfy the checker while documenting nothing. Cohort split is fixed by measurement: 11 specs created on or before 2026-07-14 are 'deliberate' (rationale inherited from knowledge-convergence-backfill-code-anchor-adoption-armed-gate-f: implementations spread across files with no clean anchor), the 44 created after are 'debt'. RED (both required): (a) delete one row and the checker must fail NAMING that slug; (b) replace one row's reason with 'tbd' and the checker must fail NAMING that slug — proving the reason predicate is live and not decorative. ⛔ Writing a row is preferred over synthesizing an anchor: 44 imprecise anchors would satisfy the coverage predicate while being indistinguishable, afterwards, from measured ones.
  script: lint — bun run scripts/check-anchor-coverage.ts 2>&1 && echo "AC-BFI-5 PASS: ledger set == the freshly measured unanchored live-spec set; the checker verdict line above carries the measured counts"
- [✔] [script] AC-BFI-6: RATCHET BLOCKS NEW DEBT (D2): a live spec that declares no code_anchors and has no ledger row makes the checker exit EXACTLY 1 (the scripts/check-*.ts convention for a repo-invariant failure, distinct from the CLI's own 2/3/4 family) and the output NAMES that spec's slug. Baseline-scoped enforcement per adr-a-newly-armed-structural-oracle-enforces-from-a-baseline: the landing criterion is NOT a tree-wide green, it is that the 56th unanchored spec cannot appear silently. RED: add that same spec to the ledger and the identical run must exit EXACTLY 0 — the paired transition proves the failure was caused by the missing disposition rather than an unrelated crash, which a bare exit-1 assertion cannot distinguish.
  script: test — bunx vitest run packages/lore/tests/unit/scripts/anchor-coverage-ratchet.test.ts 2>&1 && echo 'AC-BFI-6 PASS: an unanchored, unledgered spec fails the checker by name; ledgering it turns the same run green'
- [✔] [script] AC-BFI-7: THE LEDGER CANNOT OUTLIVE ITS DEBT (D2): a ledger row naming a spec that NOW declares code_anchors makes the checker exit EXACTLY 1 — the same code AC-BFI-6 pins, since both are the one checker's repo-invariant failure — and the output NAMES that slug, so the ledger can never decay into a suppression list (adr-a-newly-armed-structural-oracle-enforces-from-a-baseline, consequence 3). RED (paired, both required): declare anchors on a ledgered spec WITHOUT removing its row and the checker must exit EXACTLY 1; then remove the row and the identical run must exit EXACTLY 0. ⛔ A checker validating only the forward direction (unanchored implies ledgered) exits 0 on this scenario and is the precise failure being excluded — the reverse direction is the whole point of this criterion.
  script: test — bunx vitest run packages/lore/tests/unit/scripts/anchor-coverage-stale-exemption.test.ts 2>&1 && echo 'AC-BFI-7 PASS: a ledger row whose spec has since been anchored fails loud by name'
- [·] [script] AC-BFI-8: MIRROR CONTENT DRIFT IS DETECTED, AND NOTHING REPAIRS IT BEFORE THE ASSERTION (D3): with one mirror file body edited so it no longer matches its corpus document, the spec-mirror --check exits EXACTLY 2 (MIRROR_DRIFT_EXIT_CODE, export-spec-mirror-core.ts:63; NOT 4 = MIRROR_HARD_FAILURE_EXIT_CODE line 65, which would make a crash indistinguishable from a detection) and NAMES the divergent slug. TWO no-repair conditions, BOTH required: (i) the CHECK must not regenerate what it inspects - run twice consecutively it reports the same drift both times (AC-FR-7); (ii) NOTHING may re-export between the mutation and the assertion - the test hashes the mutated file immediately after mutating it, re-reads that hash immediately before asserting, and the two MUST be equal. (ii) is real, and an export-free setup here does NOT satisfy it: measured on main at cedb29db 2026-08-11, one full bun run test moved the mirror fingerprint 45ea1381 -> 4c84f428 and left docs/requirements and .lore/export-index.json modified, because the SIBLING file scripts/tests/spec-mirror-export.ts runs the REAL exporter against the REAL production corpus by design (AC-FR-6/7/10 require that) and vitest runs files concurrently. This test MUST be isolated from concurrent exporters; (ii) proves the isolation held rather than assuming it. The script chain itself is clean - check:spec-mirror is --check only, mirror:export is chained from nothing - so chain inspection alone would miss this. RED, all three deterministic: (a) make the check call the exporter first so the second consecutive run reports clean - must fail; (b) restore the body to match the corpus and the identical run must exit EXACTLY 0, proving the red came from divergence not a crash; (c) invoke the real exporter between the mutation and the assertion - the hash equality in (ii) must fail. (c) is a FORCED interleave, never a concurrency race: a scheduling-dependent red that may not occur is not a red.
  script: test — bunx vitest run scripts/tests/spec-mirror-content-drift.test.ts 2>&1 && echo 'AC-BFI-8 PASS: body divergence detected by slug, exact exit code, and two consecutive runs report identically'
- [·] [script] AC-BFI-9: ANCHOR-RATCHET WIRING, BOTH COPIES (D2): the anchor-coverage checker is invoked from hooks/pre-push, and hooks/pre-push stays byte-identical to assets/project/pre-push — the D2 sibling of AC-BFI-3, because a checker that exists but runs in no pipeline enforces nothing. ⛔ This exists because capability and production wiring must be the SAME acceptance unit: AC-BFI-5/6/7 all invoke the checker directly and would go green on a checker no pipeline ever calls. RED: land the checker with both pre-push copies untouched and this must fail; wire only hooks/pre-push and the byte-identity diff must fail, so a consumer-invisible fix cannot pass. Runnable TODAY and MUST be red before the D2 phase lands.
  script: lint — diff hooks/pre-push assets/project/pre-push && grep -c check-anchor-coverage hooks/pre-push && echo 'AC-BFI-9 PASS: both pre-push copies byte-identical AND invoke check-anchor-coverage'

## Code anchors

- scripts/check-anchor-coverage.ts
- scripts/anchor-coverage-ledger.json
- packages/lore/tests/unit/scripts/anchor-coverage-ratchet.test.ts
- packages/lore/tests/unit/scripts/anchor-coverage-stale-exemption.test.ts
