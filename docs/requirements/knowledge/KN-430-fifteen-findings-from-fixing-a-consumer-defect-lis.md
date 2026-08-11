---
id: KN-430
type: knowledge
role: knowledge
title: "Fifteen findings from fixing a consumer defect list: an unreleasable quota, an attested path left ungated while the self-report path is gated, and four gaps in my own ACs"
status: approved
priority: medium
created: 2026-08-11
updated: 2026-08-11
tags: []
parent: PRD-001
---
# Overview

Fifteen findings measured while fixing a consumer-filed defect list (6 reports, 2 specs,
2 plans, 11 tasks, 7 concurrent implementers). Every one is either a gap in lore's own
tooling or a gap in the orchestrator's task/AC design — none is an implementer failure,
and that distribution is itself the headline: **7 of 7 implementers reported the gap they
hit instead of working around it silently, and 4 of the 15 findings are defects in the
dispatch bundles or ACs I authored.**

⛔ Each finding names its MECHANISM ROOT and a fix. A finding whose fix is "be more
careful" is not recorded as fixed.

# A. The defect being fixed was worse than reported

**A1 — The upstream report cap was unreleasable by ANY action available to a reporter,
honest or dishonest, and its refusal advertised a remedy that provably does nothing.**
The incoming report said quota could only be freed by declaring a real defect
not-a-defect. Measured on two throwaway corpora (real compiled binary): filed 10 →
11th refused → resolved ALL 10 as `rejected` → **12th refused with the byte-identical
message, still naming all 10 ids**; upstream doc status census after resolution:
`10 × draft`. Root: `countOpenReports` filtered `task.status !== "draft"` while
`lore issue resolve` writes only `extra.issue_report.resolution`, and
`VALID_TRANSITIONS` has no `draft → archived` edge, so no closure verb can move the doc
off `draft` at all. The refusal's "resolve or wait for review" was not a degraded
remedy but a false one — worse than no remedy, because it costs a round trip to
discover the refusal is unconditional. Fixed: the cap now counts COMPUTED RESOLUTION
via the shared `TERMINAL_ISSUE_RESOLUTION_MEMBERS` seam, and the refusal payload is
structured with each blocking id's resolution plus a `quota_freeing_states` list
DERIVED from that seam (never a literal), so it can never advertise a verb that does
not work.

**Transferable shape:** a quota keyed on one field while its only release verb writes a
different field. The two were never asserted against each other by any test.

# B. Evidence integrity — three ways a row can look compliant and not be

**B1 — `lore evidence --capture` mints no attestation, and I told five agents to use it
for AC evidence.** It stamps `capture_source: runner` but produces no `attestation`
block and no `exit_code`, so the verdict is still the recorder's. My dispatch bundles
prescribed it for every AC pass. `lore done`'s attested-pass floor is what would have
caught it — **a gate saved a bundle**, which is the correct direction but means the
bundle template was the defect. Two implementers found it themselves and ran
`lore verify` unprompted. Fix: the bundle template now says AC evidence goes through
`lore verify --task` only, and `--capture` is for observation outside ACs.

**B2 — ⭐ The clean-worktree guard is asymmetric in the RISK-INVERTING direction.**
Measured: `lore evidence --result pass` REFUSED on a dirty tree (correctly, naming both
files) while `lore verify` had already recorded an **attested** pass minutes earlier
with the same two files uncommitted. The guard's stated rationale is "don't record a
verified/released task backed by no commit" — but it gates the WEAKER self-report path
and leaves the ATTESTED path, the one that mints the corpus's strongest evidence tier,
ungated. Fix root: the precondition belongs on the shared write path both verbs reach,
not on the self-report verb.

**B3 — The same guard's printed remedy is actively harmful, and three of three agents
had to work around it.** Its floor cannot distinguish "the implementer's code is
uncommitted" from "the test suite re-exported the shared corpus mirror into this
worktree", and the copy-pasteable command it prints would have committed ~22 peer and
not-yet-started-task mirror docs into one implementer's branch. That implementer
refused to paste it, parked the untracked docs outside the repo, and restored the two
modified tracked files with `git show HEAD:<path> > <path>`. ⛔ Per standing discipline,
doing extra work to get past a gate IS the signal the gate has a hole — logged here by
all three independently.

# C. My own AC and task design produced four gaps

**C1 — M5's only AC was a unit test over the aggregator, so it passed green while the
capability was unreachable.** `computeAcCoverage` gained the oracle-generation split;
NO renderer read it, so an AC whose oracle reversed polarity still displayed plain
green. This is the documented "capability implemented ≠ production wiring" trap, and the
AC designer walked into it. Fix: added AC-DC-10 requiring the oracle to SPAWN the CLI,
and the implementer's decisive probe was removing only the call site (leaving the
function defined) and confirming the same assertions redden — proving the oracle cannot
pass on capability alone. AC-DC-11 now covers the still-open FEED surface.

**C2 — Three anchor sets were structurally incomplete, all the same shape.** Any change
to X breaks an exhaustive literal in Y, and Y was not anchored: (a) any
`StoreInterface` method addition is TS2739 in `outline-service.test.ts`'s full-interface
`brokenStore` literal; (b) the cap path's only existing test carries a local fake
`UpstreamPort` that predates each new port op; (c) five `toEqual` literals pin
`AcCoverageFact`'s exact shape. Fix root: when a task's contract says a shared TYPE or
FACT SHAPE gains a member, the anchor set must include every exhaustive literal over
it — findable mechanically, not by judgment.

**C3 — AC-RR-8's "a repo-wide search returns zero hits" was literally unsatisfiable as
written**, because the spec, the task and the frozen archive all must NAME the retired
spelling in order to record the rename. The implementer built a defensible two-tier
oracle (zero under `packages/**`+`scripts/**`; every other hit must live under `docs/`,
so a new hit in `hooks/`/`assets/` fails loud) and assembled the needle at runtime
because the test file is inside its own scan universe. Fix: an AC asserting absence must
scope the universe it asserts over.

**C4 — A declared field-rename contract renamed one of three sibling fields.**
`DriftRow.spec_slug → doc_slug` + `doc_type` landed; `spec_id`/`spec_status` still read
spec-flavoured on a knowledge row, so a consumer keying on either can still misread a
knowledge breach as a spec's. The implementer implemented exactly as specified and made
the residual grep-visible. ⛔ The gap between "AC passed" and "goal met" was the AC
designer's.

# D. Cross-cutting tooling gaps

**D1 — Cross-plan anchor blindness bit in practice, not in theory.** I nearly dispatched
a task anchoring `outline-service.test.ts` while a LIVE task in a different plan held
it. The mutex and `lore ready`'s `anchor_conflicts` are both plan-scoped, so neither
could see it. Manual queueing is the only defense today, and it worked only because I
re-read the live anchors instead of trusting the batch-start snapshot.

**D2 — `test:changed` has a SECOND residual with a different mechanism from the
documented one:** reverse-dep walks STATIC imports only, so a test reaching its target
via `await import()` inside a function body is never selected. Measured:
`ac-list-falsified.bun.test.ts`, the closest regression oracle for the changed function,
was skipped while 150 other tests ran. Recorded in the command's own contract line.

**D3 — `assertFreshBinary` exits FATAL on a stale `dist/lore`, which is
indistinguishable from an assertion going red** ⇒ a red-first run against a stale binary
proves nothing. Two implementers independently worked around it (one drove the CLI in
source mode; one built first and said so). Fix root: a freshness refusal needs a
distinct exit code from an assertion failure.

**D4 — The global `lore` predates a just-merged stamp, with a NEW consequence.**
Differential probe, two throwaway corpora, identical command sequence, only the binary
differing: global → 0 stamped evidence rows, fresh build → 1. Because
`resolveOracleGeneration` reads an absent stamp as generation 1, every row recorded
through the stale global binary is classified PRIOR-generation after any command
rewrite — so the split UNDER-reports current evidence until the main checkout is
rebuilt. "Merging ≠ releasing" with a measurable direction of error.

**D5 — The assets-manifest freshness oracle exists, is sound, and did not fire.**
`tests/unit/build/embed-assets-manifest.test.ts` pins the checked-in generated manifest
against a fresh recomputation over `assets/`, yet a stale manifest reached main
(`c3803eb2`) because `hooks/pre-push` runs FOUR corpus checks and NO tests. ⛔ **A sound
oracle is not a gate until something invokes it** — and I initially misdiagnosed this as
"no oracle exists", which would have led to building a duplicate.

**D6 — The AI judge returned reject / approve / escalate across three runs of the SAME
unchanged version.** ADR and spec are `judgment_required_types` members under
worst-decision-wins, so one flaky `reject` locks that version until a content edit bumps
it. The escalate run's findings were substantively correct and worth acting on; the
disagreement was in the VERDICT, not the analysis. ⛔ A gating decision rests on a
non-deterministic oracle — the unlock path (version bump) exists, but "edit the doc to
clear a flaky reject" is indistinguishable from "edit the doc to dodge a real one".

**D7 — `lore evidence --result inconclusive` does not exist**; my bundles prescribed it.
`--result` accepts `pass | fail | expected-fail` only. Two live agents received the
correction only because a third finished early and reported it. Fix: an honest
`--result fail` naming unrelated failures beats no row.

# Fixes landed this session

Six tasks merged (trace `--enumerate` with counts derived from member lists; AC oracle
generations; knowledge code anchors under `--check-drift`; the terminal-resolution SSOT
+ resolution-keyed cap + two non-derogatory terminal states; the AC read surface). Five
follow-up tasks filed for residuals the implementers reported rather than hid, plus one
ADR deferring conflict-exposure with the retrieval-vs-compliance distinction made
binding.


# E. Four more, measured after the retro was first written

**E1 — ⭐ `subagent-stop-commit-guard.mjs` Check 2 cannot tell a MERGED branch from an
empty one, and the obvious fix opens a new hole.** It blocks on
`git rev-list --count main..HEAD === 0` with a message naming this repo's W4 data-loss
incident. A branch whose work was already merged reads exactly 0, so a successful
implementer is told it may have lost work — the inverse of the truth, and an orchestrator
reading it at face value would conclude the opposite of what happened. It fired THREE
times on one agent, despite its own text promising "this guard will not fire twice", and
that agent could only exit by repeating itself (~5.2M ms of wall clock across the
repeats). Verified by reading the hook: there is no `merge-base` call anywhere in it.

⛔ The one-line fix the agent proposed — add `git merge-base --is-ancestor HEAD main` —
is INSUFFICIENT, measured while cleaning up: a FRESH worktree that never committed also
satisfies that predicate (all three live worktrees showed `merged=YES ahead=0` mid-flight).
Allowing on ancestry alone would let a did-nothing agent through, which is the exact shape
the guard exists to catch. A correct discriminator needs a third signal that commits ever
happened on the branch — e.g. its reflog having entries past creation. Recorded rather
than patched: this is the user's global harness, not lore, and a naive fix here trades a
false alarm for a silent miss.

**E2 — `ahead=0 && ancestor-of-main` is a genuinely ambiguous state, and I nearly acted
on it.** My own cleanup loop tried to compute liveness in shell and silently failed (zsh
does not word-split an unquoted variable by default, so the guard list never matched), so
every worktree printed `live=no`. Had I deleted on the git state alone I would have
removed two worktrees whose agents were mid-flight. The safe discriminator was the
explicit list of agents whose completion reports I had received AND whose merges I had
performed — provenance I held, not state git could tell me.

**E3 — An exit-code-only oracle for a new CLI flag is green with ZERO implementation.**
`--sub-type` already exited 2 before the fix, via `strict-flags.ts`'s unknown-flag
rejection. My AC-RR-6 asked only for "exit code exactly 2 naming the conflict"; the
implementer noticed the pre-existing exit 2 and added, to every refusal case, an assertion
that stderr does NOT contain `"Unknown option"` plus a positive check that the conflict is
named and stdout is empty. ⛔ Second time this session an implementer closed a
discriminating-power hole in an AC I wrote (the first: a unit test that passes with no read
surface). Generalisation: when an AC asserts a refusal on a NEW flag, the pre-fix binary
already refuses it — the oracle must distinguish WHICH refusal.

**E4 — The Bash safety hook tokenizes inside single-quoted argument values.** An
`--output-tail` containing backticks was parsed as command substitution and the whole
`lore evidence` call was blocked; `lore create spec` was "matched" out of the agent's own
prose describing a blocked command. ⇒ Prose that describes a forbidden command becomes an
unrunnable command. Worked around by dropping backticks from evidence tails, which is
lossy for exactly the tails most worth capturing (shell transcripts).


# F. Two more, both about a measurement being someone else's

**F1 — ⭐⭐ Two DIFFERENT byte floors gate the same four module docs, and the one an agent
sees interactively is the LOOSER one.** `lore status --check-claude-md` and
`assets/hooks/claude-md-guard.sh` enforce the **0.97** eviction floor (15893 of 16384).
`packages/lore/tests/unit/service/claude-md-eviction-floor.test.ts` holds the FOUR anchored
module docs (`service`, `store`, `ai`, `adapters/http`) to the **0.9** advisory band (14746),
with the recorded rationale that "a doc parked between warn and evict is one edit from
blocking". `service/CLAUDE.md` sat at 14723 — **23 bytes of runway** — and three factual
corrections this session took it to 15645. The guard printed `within budget (0 findings)`
at every step, and it blocked me three times on OTHER files, so I had every reason to
believe I was being held to the real threshold. The suite went red; no agent's known-reds
list contained it; the implementer who found it machine-verified it was not its own diff.

⛔ Mechanism root: a rule with two enforcement points at two thresholds means the stricter
one is invisible until it fails, and the looser one ACTIVELY MISLEADS by reporting
compliance. Fixed for this instance by real eviction (a block moved verbatim to the corpus,
15645 → 14741, test 19/19). Not fixed at the root: the guard still does not know about the
0.9 constraint on those four docs. Recorded on the line documenting `--check-claude-md` so
the next editor of an anchored doc checks the 0.9 number by hand.

**F2 — ⭐ The "session-specific, isolated" scratchpad is SHARED across concurrent
subagents, and a fixed filename there is silently clobbered.** Measured: one implementer's
`run-scoped.sh` was replaced mid-flight by a peer's file of the same name pointing at a
DIFFERENT worktree; `typecheck.exit` and `testchanged.*` were contended too. It caught this
only because a linter notice happened to surface the overwrite — **without it, it would
have read a peer's exit code as its own oracle result**, i.e. a green measuring someone
else's tree. Its own AC artifacts survived by luck (it had prefixed them `ac-dc-3.*` and
read each back immediately, and every log it read contained its own suite's test titles).

⛔ This is the worst shape a tooling gap can take: it corrupts the EVIDENCE rather than the
work, it fails silently, and the harness prompt asserts the opposite ("session-specific,
isolated"). My own dispatch bundles made it reachable by instructing every agent to
"persist `$?` to a file and read it back" without naming a per-actor path. Fix applied
mid-session: the two still-live agents were messaged to namespace every write under
`<scratchpad>/<actor>/` and to sanity-check that a log they read back names their own
subject. Fix for the template: a per-actor scratchpad subdirectory is mandatory, and an
exit code read back from a shared path is not a measurement.


# G. Three more from the dashboard parity work

**G1 — An `undefined` badge variant did not render as "undefined"; it rendered as
SUCCESS.** The switch fell off its end and returned `undefined` in defiance of its own
`NonNullable<BadgeProps["variant"]>`, and CVA's `defaultVariants.variant: "default"`
absorbed it — so `superseded`/`duplicate`/`closed` rendered byte-identically to a `fixed`
row (`bg-primary`), while the control `rejected` differed (`bg-destructive`). ⛔ The failure
mode of a missing switch case is not a visible blank but a **silent success badge on a
non-derogatory terminal state**. Also: the value required `as unknown as IssueResolution`
to construct — the mirror did not even admit what the server sends — and the drift was
THREE members, not the two the union change introduced (`closed` predated it). A report
that names the members you just added will under-count the drift.

**G2 — AC-DC-12, which I wrote, carried two factual errors and is now ATTESTED.** It says
"the `@lore/core` union" (the union lives in `packages/lore/src/service/issue-resolution.ts`;
read literally the AC was unsatisfiable without a relocation it did not authorize) and "a
synthetic 13th member" (the union has 8 members — "13" matches nothing in the code). The
implementer satisfied the AC's INTENT, disclosed both errors, and hosted the coupling in
the test tree so `src/**` keeps its `@lore/core`-only boundary. ⛔ An attested pass certifies
the ORACLE ran green, not that the AC's prose was true — the strongest evidence tier does
not audit its own statement.

**G3 — Two of that AC's cases passed AGAINST the defect on the first red run.** `undefined`
satisfies `not.toBe(<variant>)`, and two `undefined`s "agree" with each other, so a
NEGATIVE case and a mapper-agreement case were both green while the bug was live. Fixed by
a `KNOWN_BADGE_VARIANTS` precondition on both. ⛔ **Third time this session an implementer
closed a discriminating-power hole in an AC I authored** (the others: a unit test that
passes with no read surface; a refusal oracle green against the pre-existing unknown-flag
exit 2). Common shape: my ACs asserted what must NOT be true and forgot that the
degenerate/absent value satisfies a negative assertion vacuously.

Also measured: `test:changed`'s THIRD residual — its alias map covers only `@lore/core`,
so `@/`-aliased and `@lore/lore/...` imports never resolve, making every
`packages/dashboard/tests/component/*.test.tsx` unselectable when its component changes.
Filed as `task-test-changed-s-alias-map-is-blind-to-and-lore-lore-so`.


# H. The root cause behind most of the friction above

**H1 — ⭐⭐⭐ A harness worktree is NESTED inside the main checkout, so it resolves the LIVE
corpus — and every corpus-writing test run from a worktree pollutes the shared corpus.**
Worktrees live at `<main>/.claude/worktrees/agent-*`. `findLoreDbPath` walks cwd upward, so
from a worktree it resolves `<main>/.lore` — verified by running `lore status` from inside
one and getting the live 1406-doc corpus. Therefore the export-family tests
(`spec-loop-e2e`, `mirror-*`, `export-docs-*`) run from a worktree **write into the live
team corpus and dirty the MAIN checkout's `docs/requirements/` while the orchestrator is
working in it.**

This single fact explains most of §B and §D: why every implementer saw the `spec-loop-e2e`
pollution guard fire, why three of them had to park mirror churn to satisfy the evidence
guard, why the guard's printed remedy would have committed peer docs, and why one agent
deliberately **refused to run `test:changed` at all** (its `@lore/core` barrel edit selected
561 files including that family) rather than corrupt the shared corpus — substituting scoped
runs over every importer plus the compiled-CLI paths and handing the full command back for
the post-merge run on main. ⛔ That refusal was the correct call and is the opposite of a
shortcut. The upward walk is itself deliberate (a fresh `git worktree add` tree needs no
local `.lore/`); the defect is that it lets a WRITE path reach a corpus the caller does not
own. Filed: `task-a-worktree-nested-inside-the-main-checkout-resolves-the`.

**H2 — Eliminating a duplicate beat weakening the check, and it upgraded a sibling AC for
free.** AC-DC-9 (one member-set construction site) went red on the merged tree because a
peer legitimately added a type-tied dashboard mirror. Narrowing the scan universe would have
been an AC weakened after going red — indistinguishable in the audit trail from covering up
a failure. Relocating the vocabulary into `@lore/core` instead made both ACs pass with
neither statement nor command modified, and turned AC-DC-12's coupling from a test-tree type
assertion into the SWITCHES failing to compile (`TS2322 … not assignable to type 'never'` in
both components). Measured: injecting a TERMINAL member additionally trips the surviving
`as const satisfies Record<…>` obligation (TS1360).

⛔ Residual honesty: AC-DC-9's DERIVED prose still names the pre-move file as the single
site. The spec's own §M1 pins no path, so the spec is satisfied and the drift is in the AC's
sentence — but it needs an explicit re-baseline rather than a quiet edit, and the implementer
correctly refused to touch it (`ac set` would demote the spec and block a live sibling claim).

**H3 — `lore evidence --capture`'s oracle-path check understands `cd <dir>` but not
`bun --cwd=<dir>`**, so it refused a correct command and pushed the caller onto the `cd &&`
form this repo's own standing lesson warns against (zoxide shims `cd`, and `&&` then
short-circuits silently). A gate steering a caller toward a known-hazardous idiom is worse
than one that simply refuses.

**H4 — A newly armed gate invalidated the back-catalogue again, invisibly.** `cb526317` made
`--adhoc` require an explicit `--ac-scope`; `packages/dashboard/tests/e2e/issues-resolution.spec.ts`
still calls it without one, so that Playwright spec fails in FIXTURE SETUP. It stayed hidden
because Playwright is not in `test:changed`'s selection. Third instance this session of
"budget the back-catalogue sweep in the SAME slice as the gate".
