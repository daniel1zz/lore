---
id: KN-417
type: knowledge
role: knowledge
title: "Five findings from planning the bootstrap-fixpoint slice: a plan-scoped anchor mutex, a hook that misnames its own refusal, an asymmetric AC demotion, and two probes that nearly lied"
status: approved
priority: medium
created: 2026-08-11
updated: 2026-08-11
tags: []
parent: PRD-001
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

**Mechanization.** The overlap query must be corpus-wide over FRESH claims, not bundle-wide: gather
claim-carrying tasks by anchor intersection across all plans (the claim set is small — `lore
bootstrap`'s `active_sessions` is already corpus-wide and proves the query is cheap), and keep the
plan bundle only as an optimisation for the common case. Until then, `lore ready` should at minimum
report cross-plan anchor intersections as an advisory, so the conflict is at least VISIBLE where a
dispatcher already looks.

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

## Standing lesson (one line, for CLAUDE.md if wanted)

An extra manual step taken to compensate for a gate is the signal that the gate has a hole — the
compensating action is the trigger to report it, not evidence that the situation is handled.
