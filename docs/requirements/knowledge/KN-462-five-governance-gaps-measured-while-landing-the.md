---
id: KN-462
type: knowledge
role: knowledge
title: "Six governance gaps measured while landing the anchor-coverage ratchet"
status: approved
priority: medium
created: 2026-08-17
updated: 2026-08-17
tags: []
parent: PRD-001
---
# Five governance gaps measured while landing the anchor-coverage ratchet

Measured 2026-08-17 on `plan-land-bootstrap-fixpoint-integrity-binary-provenance-the`, task
`task-ship-the-anchor-coverage-exemption-ledger-and-arm-the` (merged at `7ab1d742`). Every item below
was observed, not inferred; each names the mechanism that made it possible rather than the surface
that exposed it.

## G1 — `bun run test:changed` and "do not `bun run build`" are structurally exclusive

The dispatch bundle carried both "⛔ Do NOT run `bun run build`" (to protect the global `lore`
symlink into the main checkout's `dist/`, since a peer agent was live) and "run
`bun run test:changed <base>`" as the scoped oracle. They cannot both be obeyed: `changed-tests.ts`
step 4 unconditionally shells out to `bun run build` whenever ≥1 *compiled* binary-consumer test is
selected, and ANY change under `scripts/` selects
`packages/lore/tests/unit/scripts/changed-tests-selector.test.ts` by the tree-scanning-oracle rule —
which is one. The build ran three times.

Measured blast radius: none. `scripts/build.ts:35` roots itself at `join(import.meta.dir, "..")`, so a
worktree build writes `<worktree>/dist/lore` and can never reach the main checkout's. The main
checkout's `dist/lore` was rewritten at 10:57:16 by a different session, not by the agent (whose
worktree build was 10:54:17).

Root cause: the prohibition is stated at the wrong granularity. "Do not build" is unsatisfiable for a
worktree agent touching `scripts/`; the real invariant is "do not write the MAIN CHECKOUT's `dist/`",
which `build.ts`'s self-anchoring already guarantees for worktree agents.

Mechanization: state the constraint as a location invariant, not a command prohibition — a bundle
should say "never run a build from the main checkout while a peer is live" and leave worktree-local
builds unrestricted. Better still, have `changed-tests.ts` print WHICH rule pulled the binary-consumer
in, so an agent reading a conflicting instruction can see the conflict instead of silently resolving it.

## G2 — `active_sessions` reflects claim leases only, so a suite-running session is invisible

`lore bootstrap`'s `active_sessions` was `[]` at the exact moment the main checkout had a full
`bun run test` running for 15m44s (pids observed, `oracle-lock.ts` in the chain) which had rewritten
`dist/lore` 19 seconds earlier. A session that claims no task — running the suite, exporting the
mirror, rebuilding the binary — produces no lease and therefore no row.

Root cause: the field measures corpus claims and is read as if it measured machine occupancy. Those
differ exactly in the cases that hurt (suite runs and rebuilds are precisely the unclaimed activities
that break peers).

Mechanization: `active_sessions` needs a second, non-claim-derived source — the existing
`oracle-lock.ts` already serializes suite runs and therefore already knows. Surface the oracle lock's
holder in `bootstrap` so "no peers" is decidable from one read. Until then, an empty `active_sessions`
must be treated as "no CLAIMED work", never as "safe to rebuild".

## G3 — `lore anchor add` cannot express a test identity anchor

Root CLAUDE.md requires every AC to declare, besides its implementation anchor, a TEST IDENTITY anchor
(test file path + `describe`/`it` title) so "which test covers this AC" is mechanically traceable.
`lore anchor add` rejects it: the `#Symbol` half is validated against
`/^[A-Za-z_$][A-Za-z0-9_$]*$/`, and a real describe title
(`check-anchor-coverage: the shipped ledger dispositions every unanchored live spec (AC-BFI-5)`)
contains spaces, a colon and parentheses. Exit 4, naming the field.

Observed consequence on this slice: the four anchors landed at FILE level only. Both AC-BFI-5 and
AC-BFI-6 live in the same file, so the corpus can no longer answer which of the two a given describe
covers — the exact traceability the rule exists to provide.

Root cause: the anchor grammar was designed for exported code symbols (SPEC-045) and later borrowed
for test identities, which are free-text strings, not identifiers.

Mechanization: extend the anchor grammar with a distinct test-identity form (a quoted title after the
path, validated as non-empty free text) rather than widening the symbol regex — widening would also
admit malformed code anchors. The drift checker can verify a test-identity anchor by grepping the file
for the literal title, which is a stronger check than symbol existence.

## G4 — an AC's declared command can carry a stale literal count with no oracle over it

`AC-BFI-5`'s statement explicitly forbids the literal: "the enforced predicate is SET EQUALITY against
the freshly measured unanchored set, **never the literal 55**". Its own declared command nonetheless
ended with `echo 'AC-BFI-5 PASS: ledger set == measured unanchored set (55 rows: 11 deliberate / 44
debt)'`. Measured reality at verification time: 60 rows, 11 deliberate / 49 debt.

Nothing checks a command's echo text. Had it been attested unchanged, `lore verify` would have written
an `attestation`-bearing row — the corpus's strongest evidence tier — whose summary line asserted three
wrong numbers. It was caught only because `lore verify` aborted first on new/changed-command approval
(exit 7), which put the command text in front of a reader.

Root cause: the existing standing lesson ("a literal corpus count inside a governance doc is a claim
with no oracle") was applied to prose and never extended to the AC's own `verify.command`, which is
prose that gets executed and then quoted as evidence.

Mechanization: lint declared AC commands for numeric literals in their PASS-echo text at
`lore ac add|set` time (advisory is enough — the author is right there), or forbid the trailing echo
from restating counts and require it to defer to the checker's own verdict line, which is measured.

### In-flight revision record (required by the "modifying an oracle after the fact" discipline)

- **Original command**: `bun run scripts/check-anchor-coverage.ts 2>&1 && echo 'AC-BFI-5 PASS: ledger
  set == measured unanchored set (55 rows: 11 deliberate / 44 debt)'`
- **The exact failure it produced**: none — it never ran. `lore verify` aborted at AC-BFI-5 with exit 7
  ("command is new/changed and was not approved") before execution, which is how the text was read. The
  defect is that the declaration contradicts its own approved statement and misstates the measurement.
- **Why this is a correction and not a weakening**: the assertion is the left side of the `&&` — the
  checker's set-equality predicate — and it was not touched. Only the right-side echo changed, from
  three frozen numbers to a pointer at the checker's own verdict line (which prints the measured counts
  every run). The criterion's discriminating power is unchanged and the command now agrees with the
  statement the spec approved.

## G5 — `lore anchor add` does NOT demote an approved spec

Third data point on the demotion asymmetry already recorded for `ac set` (demotes) vs `ac add` (does
not). `lore anchor add` writes `extra.code_anchors` on an approved spec and leaves it `approved`
(v34 → v35 observed). So the set of `extra` writes that bypass re-review is larger than the AC pair:
an approval certifies neither the AC set nor the anchor set as a reader sees them later.

## G6 — the wiring AC that exists to prevent inert capability is itself grep-shaped

`AC-BFI-9` (and its D1 twin `AC-BFI-3`) exist precisely because "capability and production wiring must
be the SAME acceptance unit" — a checker no pipeline calls is inert. Their oracle is
`diff hooks/pre-push assets/project/pre-push && grep -c check-anchor-coverage hooks/pre-push && echo …`.

That oracle is satisfied by a COMMENT. A line reading `# check-anchor-coverage: TODO` in `hooks/pre-push`
passes the grep, passes the parity diff (if mirrored into the asset copy), and produces an attested
green for an AC whose entire purpose is proving the check runs. The failure mode the criterion was
written to exclude is reachable through the criterion itself.

Measured context that makes this concrete: `hooks/pre-push` currently invokes FOUR checks, all of them
`lore …` subcommands — not one `bun run check:*`. Every `check:*` npm script in `package.json`
(`check:test-budgets`, `check:ac-ref-integrity`, `check:no-nul-bytes`, …) is therefore push-invisible,
which the root CLAUDE.md already records for test-shaped oracles. So `check-anchor-coverage` will be
the first non-`lore` check in that hook, and nothing in AC-BFI-9 forces it to actually execute.

Incidental finding: the grep string is `check-anchor-coverage` with HYPHENS, so wiring the hook as
`bun run check:anchor-coverage` (colon) would fail the grep. The AC silently constrains the
implementation to the direct `bun scripts/check-anchor-coverage.ts` form. That is a fine outcome, but
it is accidental rather than declared, and it means `package.json` needs no new script — the concern
raised by the implementing agent resolves to "not needed", not "out of scope".

Root cause: a wiring AC was written as a PRESENCE assertion over the pipeline's source text, when the
property it means to assert is BEHAVIOURAL — "an offending tree makes this hook exit non-zero".
Presence is the cheapest observable, and it is the one that a self-documenting file over-matches, the
same mirror-face the marker-census lesson already names.

Mechanization: a wiring AC MUST drive the surface. Run the hook itself against a tree that violates the
invariant and assert the hook's exit code, plus a second independent condition (the finding text appears
in the hook's own output). Both halves are needed: exit code alone can come from an unrelated earlier
check in the same hook, and output alone does not prove the push is blocked. The parity diff stays as-is
— it answers a different question (does the consumer copy carry it).

## What the ratchet caught on its first real use

Declaring anchors on `spec-bootstrap-fixpoint-integrity-binary-provenance-an-anchor` — which was itself
row 1 of the 60-row ledger — immediately produced the reverse failure the mechanism exists for:
`exit 1`, `spec-bootstrap-… — ledger row now declares code_anchors (4 anchor(s)); the row outlived its
debt`. Retiring the row returned `exit 0` with `59 of 59`. The paired transition was the mechanism's
first production exercise, not a synthetic probe.
