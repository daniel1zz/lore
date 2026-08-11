---
id: KN-417
type: knowledge
role: knowledge
title: "Seven findings from planning the bootstrap-fixpoint slice: a plan-scoped anchor mutex and its equally blind report, a hook that misnames its own refusal, an asymmetric AC demotion, the self-exempting-oracle pair, and four probes of my own that nearly lied"
status: approved
priority: medium
created: 2026-08-11
updated: 2026-08-11
tags: []
parent: PRD-001
links:
  - {id: KN-170, type: relates-to}
  - {id: KN-420, type: relates-to}
---
# Five findings from planning the bootstrap-fixpoint slice: a plan-scoped anchor mutex, a hook that misnames its own refusal, an asymmetric AC demotion, and two probes that nearly lied

## Context

Measured 2026-08-11 while authoring `spec-bootstrap-fixpoint-integrity-binary-provenance-an-anchor`
and `plan-land-bootstrap-fixpoint-integrity-binary-provenance-the` (9 ACs, 3 phases, 6 tasks). No
implementation was written; every finding below surfaced from *using* the governance tools to plan,
which is the point — three of the five are defects in the tools doing the governing.

Two of the five are defects in the author's own method, recorded at equal weight because both would
have produced a confidently-wrong entry in this corpus.

## 1. The anchor mutex is plan-scoped, so cross-plan overlap is unguarded

`buildAnchorGateContext` (`packages/lore/src/service/checkpoint-registry.ts:2464`) takes
`siblingTasks` from `CorpusService.getPlanBundle`'s `tasks[]` — the candidate task's **plan**
siblings. `checkTaskClaim` → `noAnchorOverlap` therefore compares the candidate's `file_anchors`
only against claims inside the same plan.

Measured instance from this very session: the new plan's T6
(`task-compare-mirror-bodies-against-corpus-content-in-the-spec`) anchors
`scripts/export-spec-mirror-core.ts`, which at 2026-08-11T02:50Z was also anchored by a LIVE claim
from `agent:mirror-id-unify` on `task-unify-mirror-identifiers-on-zero-padded-form-export-all` — a
task in a DIFFERENT plan (`plan-land-falsifiability-reachability-the-attested-red-runner-a`).
`lore ready <plan>` reported `Sessions (0)` and no conflict for the new plan, because it too is
plan-scoped. Within a single plan the same overlap IS reported: `lore ready` on the falsifiability
plan printed `⚠ Anchor conflicts (1)`.

**Root cause.** The mutex's scope is the plan bundle because that is the object the gate already had
in hand (the docstring says so: "already includes every sibling — zero extra IO"). Concurrency,
however, is a property of the WORKING TREE, not of a plan. Two agents editing one file collide
regardless of which plan sent them.

**Why this matters more than it looks.** The protection that remained was prose: a paragraph in the
plan document and another in T6's body telling the dispatcher to re-read the foreign claim. That is
precisely the layer this repo has already ruled insufficient — *"prose that should have been
followed is not a mechanism."* The author wrote that prose knowing it, which is itself the trigger
condition for reporting a gate gap: **an extra manual step taken to compensate for a gate IS the
signal that the gate has a hole.**

**The detection surface has the same blind spot, which is what makes it dangerous.**
`lore ready <plan>`'s `anchor_conflicts` is plan-scoped by the same mechanism, so the pre-dispatch
check an orchestrator runs to find collisions cannot see the other plan either. Measured here: with
`agent:mirror-id-unify`'s claim LIVE and overlapping this plan's T6 on
`scripts/export-spec-mirror-core.ts`, `lore ready` on the new plan printed `Sessions (0)` and no
conflict section, while `lore ready` on the foreign task's own plan printed
`⚠ Anchor conflicts (1)` for the identical overlap. So `anchor_conflicts: []` means "no conflict
*within this plan*", but reads as "safe to dispatch" — and the field offers no way to tell whether
another plan is even active. Confirmed independently at the call site by the peer session on
`plan-land-falsifiability-reachability-…`: `task-workflow-service.ts:3676` passes
`bundleResult.value.tasks` from `getPlanBundle(task.parent_id)` into `buildAnchorGateContext`.
That session had dispatched three batches relying on this mutex as its backstop; all three happened
to be same-plan, so the protection held by circumstance rather than by design.

**Mechanization.** The overlap query must be corpus-wide over FRESH claims, not bundle-wide: gather
claim-carrying tasks by anchor intersection across all plans (the claim set is small — `lore
bootstrap`'s `active_sessions` is already corpus-wide and proves the query is cheap), and keep the
plan bundle only as an optimisation for the common case. The gate and `lore ready`'s
`anchor_conflicts` must be fixed TOGETHER and asserted by one oracle spanning two plans: fixing only
the gate leaves orchestrators reading a reassuring `[]`, and fixing only the report leaves the claim
itself ungated. ⛔ An empty `anchor_conflicts` from a corpus with more than one active plan is not
evidence of safety until that lands.

## 2. The g1 spec-create hook misnames a flag error as a content error

`lore create spec --file <path> …` was refused with `MISSING_SKELETON`, quoting the spec-skeleton
feeding source. The document being created had `## Overview`, `## Scope` and `## Acceptance
Criteria`. Acting on the stated reason, the author rewrote the skeleton — a wasted round — and the
second attempt failed identically.

The real cause: `--file` is not a flag `lore create` has (the correct one is `--content-file`), so
no content reached the candidate at all. The CLI itself diagnoses this correctly — measured
directly: `lore list --bogus-flag-xyz` exits **2** with `Error: Unknown option: --bogus-flag-xyz`
(`strict-flags.ts::findUnknownFlag`). But the Claude Code PreToolUse shim
(`assets/hooks/lore-gate-g1-spec-create.sh`) runs the gate pre-check BEFORE the CLI is ever reached,
parses only the content flags it knows, sees nothing, and reports the downstream symptom.

**Root cause.** A pre-flight checker that re-parses a command line cannot distinguish "content was
supplied and is empty" from "no recognised content flag was present" unless it asks. It has strictly
less information than the CLI it front-runs, yet its verdict arrives first and reads authoritative.

**Mechanization.** The shim must emit an UNKNOWN-FLAG refusal before any predicate runs: if the
command line carries a `--flag` the shim's own table does not know, refuse with that flag named and
defer to `lore <cmd> --help`, never with a content-shaped verdict. Cheapest correct form: when no
recognised content flag is found AND at least one unrecognised `--flag` is present, report the
unrecognised flag instead of `MISSING_SKELETON`. Generalises to all four g1-g4 shims.

## 3. `lore ac add` does NOT demote an approved spec; `lore ac set` does

Both root `CLAUDE.md` files state these as one behaviour. The project file says editing an approved
doc resets it to draft *"content/title AND `extra`, so `lore ac add`/`ac set` reset a spec too
(measured 2026-08-07)"*; the global file says *"`lore ac add|set` 会把 approved spec 打回 draft"*.

Measured 2026-08-11 in a **throwaway corpus** (`mktemp -d` + `lore init`, never this repo's `.lore/`),
one spec, one approved starting point, two arms:

| step | status after |
|---|---|
| `lore review` + `lore approve` | `approved` (precondition asserted before proceeding) |
| `lore ac add <spec> AC-P-2 …` | **`approved`** — no demotion |
| `lore ac set <spec> AC-P-1 --statement …` | **`draft`** — demoted |

Reproduced independently on this repo's live corpus earlier the same session: `approve` → v16
`approved`; `ac add AC-BFI-9` → v17 still `approved` (the follow-up `lore approve` failed exit 4
with `Cannot transition from 'approved' to 'approved'`, which is how the asymmetry was first
noticed); later `ac set AC-BFI-3` → v18 `draft`.

**Root cause (hypothesis, NOT yet read from source).** `CorpusService.set`'s demotion predicate
appears to fire on the edit path `ac set` uses but not on the append path `ac add` uses. The
consequence is what matters and is measured: **acceptance criteria can be appended to an approved
spec indefinitely without re-entering review.** A spec's approval therefore certifies the AC set as
of approval time, not the AC set a reader sees.

**Mechanization.** Decide the intended contract and make one predicate serve both writers (the
dedicated-writer pattern already used for `extra.file_anchors`/`extra.validity`), then assert it
with an author→read oracle in BOTH directions — add-then-read-status and set-then-read-status — so
the asymmetry cannot silently return. Whichever way it is decided, the two CLAUDE.md sentences above
are currently false as written and must be corrected to match.

## 4. A probe that cannot reach the state it tests passes vacuously — again

The first attempt at finding 3's experiment ran `create → ac add → approve → ac add → ac set` and
printed `draft / draft / draft`, which reads like "neither demotes". It was void: `approve` had
exited **4** (a spec approve needs a current-version review judgment, and no `lore review` was run),
so the spec was never approved and neither arm ever tested demotion-from-approved. The three
identical values looked like a clean result.

**Root cause.** The probe asserted its OUTCOME without asserting its PRECONDITION. This is the same
shape already recorded here (a control probe placed outside the linted tree, the tool exiting fatal,
the rule never running) reproducing on a corpus-state precondition instead of a filesystem one.

**Mechanization.** Every differential probe must gate on its own precondition and say so out loud:
the rerun printed `STATE_A_after_approve=approved` and carried an explicit
`if [ "$A" != "approved" ]; then echo "PROBE VOID …"` branch. A probe whose failure mode is
indistinguishable from its success mode is not a probe.

## 5. Two near-miss misreports, both caught by re-measuring rather than reasoning

Recorded because both were one sentence away from entering a report as tool defects.

- **`lore ready --json` looked empty.** Parsing `data.records` yielded `[]` while the human render
  showed six tasks, one live claim and an anchor conflict — a textbook "JSON projection is lossy"
  finding. The real path is `data.ready.records`. The global CLAUDE.md line that says to filter
  `.records` is what produced the wrong path, and it is incomplete as written.
- **`lore status --enumerate <bogus>` looked like it exited 0.** Measured as
  `lore status --enumerate X 2>&1 | head -4; echo $?` — which reports `head`'s status. Re-measured
  without the pipe: exit **4**, correct. The repo's own standing rule (`exit code 不经管道测量`)
  names this exact trap; knowing the rule did not prevent applying it.

**Mechanization.** Neither is fixable by more care. The first argues that any documented JSON access
path in a governance doc should be a full path from the payload root, checkable by a single
`--json | python3 -c` snippet quoted alongside it. The second argues that exit-code measurement in
any oracle or probe must be written as `cmd > file 2>&1; echo $?` by construction, never as a
pipeline — and that a reviewer seeing `| head` adjacent to `$?` should treat it as a defect on sight.

## 6. The self-exempting-oracle pair: a check that repairs, and a test that repairs

Surfaced by the peer session on `plan-land-falsifiability-reachability-…` and worth stating as a
pair because each half hides the other.

The repo already had one half, as that session's D6: **a check that regenerates what it is checking
cannot fail.** It was written about the `--check` COMMAND. Nobody carried it to the TEST that
exercises the check — and that is exactly where it recurred: AC-FR-10's oracle ran a full export
before asserting, so it asserted against a tree it had just repaired. Corroborated by that
session's own implementer, unprompted: driving that clause red required "self-healing temporarily
disabled" — with the shipped path intact it could not go red at all.

**The pair.** *A check that regenerates what it is checking cannot fail* — and its sibling — *a test
that repairs the tree before asserting cannot fail either.* Same defect, one layer out. Prose
forbidding the repair does not close it: both recorded instances HAD prose forbidding it.

**Mechanization, and the reason this finding is here rather than only in that session's doc.**
AC-BFI-8 of `spec-bootstrap-fixpoint-integrity-binary-provenance-an-anchor` now enforces it
mechanically instead of asserting it in prose: the test hashes the mutated file immediately after
mutating it, re-reads that hash immediately before asserting, and requires equality — so any setup
step, fixture helper, or script-chain side effect that silently re-exports is caught BY the test
rather than hidden by it. Its RED is an export inserted into the test's own setup, which must break
that equality. Copy this shape; do not re-derive it.

### 6a. I refuted a correct conclusion with a method that had no power to test it

This is the sharpest thing in this document and it is mine.

The peer claimed `bun run test` rewrites generated mirror files. I checked the script chain on `main`
and reported back that the claim did not hold there: `test` reaches `check:spec-mirror` =
`export-spec-mirror.ts --check` (read-only), `mirror:export` is chained from nothing,
`identity_repaired` appeared 0 times, and `:229` was a `scriptChainReachesTarget` boundary case. All
four observations were true, and they remain true today. I concluded the claim was a property of
their unmerged branch only.

**The conclusion was wrong.** Measured on `main` at `cedb29db` after their merge landed: one full
`bun run test` moved the mirror tree fingerprint `45ea1381` → `4c84f428` and left
`docs/requirements/` and `.lore/export-index.json` modified — while the script chain was, and still
is, exactly as clean as I had reported. The export does not come from the chain. It comes from
`scripts/tests/spec-mirror-export.ts`, which runs the REAL exporter against the REAL production
corpus **by design**, because AC-FR-6/7/10 explicitly require assertion against this repo's
production corpus rather than a fixture. The suite was killed at the `test:bun` stage, so
`check:spec-mirror` never even ran — the writes had already happened inside vitest.

**Root cause.** Chain inspection has no discriminating power over "does running the suite write
files." It answers a different question — "is an export step wired into a script" — and I substituted
the answerable question for the asked one, then reported the substitute as a refutation. Every
individual fact I gave the peer was correct; the inference from them was not. That is worse than
being wrong on a fact, because the facts made the conclusion look measured.

**Mechanization.** "Does running X modify the tree?" has exactly one sound oracle: fingerprint the
tree, run X, fingerprint again — never read the configuration that is *supposed* to determine it. The
general rule this instance teaches: before refuting a peer's empirical claim, check that the method
reaches the phenomenon they described, not merely something adjacent to it. A refutation built from
true-but-irrelevant observations is indistinguishable, to the person receiving it, from a sound one.

⛔ Standing consequence for anyone writing a mirror oracle: `docs/requirements/` and
`.lore/export-index.json` are REWRITTEN by an ordinary `bun run test`, from inside the test suite, on
a clean checkout. A content-comparison oracle must be isolated from that sibling and must PROVE the
isolation held (AC-BFI-8 condition (ii)) rather than assume it. The peer's original claim was right;
only its stated scope was off, and my refutation of it was worse than its scope error.

That section was itself about assertion scope — writing a lesson down does not immunise the work
that documents it, and neither does checking.

## 7. Two more of my own, from the second half of this session

Same class as finding 5, recorded at equal weight rather than quietly fixed.

- **Backticks inside a double-quoted shell argument were executed.** Composing the hardened
  AC-BFI-8 statement, `` `check:spec-mirror` `` and friends became command substitutions; zsh
  reported `command not found` three times and the write failed. The repo's standing rule about
  shell escaping turning output into commands already covers this exactly. Knowing a rule is not
  applying it — the same shape as measuring an exit code through `| head` earlier in this session.
- **I probed a LIVE governance object to isolate a failure.** After the escaping fix the write still
  exited 4, so I ran a short "PROBE:" statement against the real AC-BFI-8 to test whether length was
  the cause — overwriting a real acceptance criterion with placeholder text before restoring it. It
  was: `packages/core/src/acceptance.ts:181` caps `statement` at `z.string().min(1).max(2000)`. The
  answer was readable in the schema; I ran an experiment on a real object instead, against this
  repo's explicit rule not to. The refusal's own message was also invisible to me because I had sent
  it to `/dev/null` — a self-inflicted silent oracle.

**Mechanization for both.** A refusal whose cause is a declared schema bound should be read from the
schema, not bisected; and any write to a live governance object that is exploratory rather than
intended must go to a throwaway corpus, which finding 3 already demonstrates is cheap
(`mktemp -d` + `lore init`, three commands). Concretely: never send a governance write's stderr to
`/dev/null` — the refusal text is the fastest path to the cause, and discarding it converts a
one-command diagnosis into an experiment on production data.

## Standing lessons (one line each, for CLAUDE.md if wanted)

- An extra manual step taken to compensate for a gate is the signal that the gate has a hole — the
  compensating action is the trigger to report it, not evidence that the situation is handled.
- A check that regenerates what it checks cannot fail, and neither can a test that repairs the tree
  before asserting — forbid both mechanically (hash before/after), never in prose.
