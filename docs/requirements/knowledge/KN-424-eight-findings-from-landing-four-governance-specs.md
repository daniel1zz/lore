---
id: KN-424
type: knowledge
role: knowledge
title: "Eight findings from landing four governance specs: a bunx-installed compiler that made me overrule a true record, a designed behaviour I reported as a defect, and six review rounds converging on missing data"
status: approved
priority: medium
created: 2026-08-11
updated: 2026-08-11
tags: []
parent: PRD-001
links:
  - {id: SPEC-135, type: informs}
  - {id: SPEC-136, type: informs}
  - {id: SPEC-137, type: informs}
  - {id: SPEC-138, type: informs}
---
# Overview

One session, resuming `knowledge-handoff-agent-main-orchestrator-88`, turning its three un-owned
finding clusters into four approved tech-specs and landing seven acceptance criteria with runner
attestation. The findings below are the ones that changed how I work, not a summary of the work.

The two that matter most are both about **me being wrong in a way that a machine caught**.

## 1. I overruled a true measured record with a false probe, and a subagent caught it

The ticket recorded (KD3) that a peer's broken probe fixture made `typecheck` exit **2**. I probed
`tsc` on an isolated project, measured a type error at exit **1** and `TS18003` at exit **2**, and
wrote into two specs that the peer's record was a mis-read — that exit 2 meant "the compiler never
ran", not "a broken file was detected".

My probe used `bunx tsc`. Its own output said so: `Resolving dependencies / Resolved, downloaded and
extracted [42] / Saved lockfile`. **`bunx` downloaded its own TypeScript into a temp lockfile — not
the compiler this repo builds with.** An implementer measured against `node_modules/.bin/tsc`
(TypeScript 5.9.3), cited `node_modules/typescript/lib/_tsc.js:128844-128849`, and refuted me:

| tsconfig shape | case | exit | error |
|---|---|---|---|
| `noEmit: true` | type error | **2** | `TS2322` |
| `noEmit: true` | empty include | **2** | `TS18003` |
| `noEmitOnError: true` + `outDir`, no `noEmit` | type error | 1 | `TS2322` |

Every `typecheck:*` script passes `--noEmit`, so in this repo **any** compile error exits 2. The
discrimination I had written into a spec's decision — "exit 1 means it checked, exit 2 means it never
did" — was not merely wrong, it was **structurally unavailable**. The discriminator has to be the
**error code in the output**.

Three costs, all real: an AC's `--falsifier-exit-code` was pinned to 1 and would have been refused
loud at run time; a dispatched implementer built its reverse control as a `noEmitOnError` + `outDir`
project to satisfy my sentence, testing a compiler configuration this repo never uses (it told me so,
in those words); and I had "corrected" a peer's accurate handoff entry.

**Lesson, mechanized where I could:** a probe's TOOLCHAIN is part of what it measures. `bunx <tool>`
is not the repo's `<tool>`. And a single unverified probe must never overrule a recorded measurement —
the recorded one had a real run behind it; mine had a different compiler behind it.

## 2. I reported designed behaviour as a governance gap because I did not read the module doc

I measured that `lore approve` exits 0 on a plan whose review returned `reject`, while `escalate`
blocks with `gate:review-judgment:judgment-required`. I reported that inversion to the user as a
governance defect: "the strongest negative verdict is weaker at the gate than 'I need a human'."

It is specified behaviour. `packages/lore/src/service/CLAUDE.md:15` documents SPEC-103 M2:
`workflow.review.judgment_required_types` (default spec+adr) scopes
`reject`/missing-judgment/provenance-collision **only**, while **one `escalate` blocks EVERY type**
once the list is non-empty. There is an SSOT spec:
`spec-an-escalate-blocks-approval-for-every-doc-type-and-the`.

I found that line only because a byte-budget failure forced me to read the file. **Before reporting a
governance surface as broken, read the module `CLAUDE.md` that owns it** — the repo had already
written down the answer, with a pointer to the spec that decided it.

## 3. Six review rounds converging on an undecidable requirement is a signal to SPLIT, not to iterate

`spec-judgment-surfaces-must-verify-before-they-certify-machine` originally carried the
`attestationFloor` falsifier clause plus an exemption ledger to absorb its back-catalogue. Every round
the advisory judge found a real hole; each fix exposed the next:

1. a prose "written exemption" has zero effect on a mechanical gate;
2. an archived-only enrolment rule enrols exactly the criteria that must be excluded, because the
   ordering that makes the clause safe requires the sibling plans to close FIRST;
3. an `armed_after` window still admits criteria authored after arming, because **the corpus records
   no per-criterion authorship timestamp** — `lore ac add` does not demote, so a criterion can be
   appended today to a spec whose plan archived last month;
4. the ledger would be an ordinary editable file while ledger PRESENCE is sufficient for exemption, so
   a hand-added pair bypasses every control without tripping a stale-entry check;
5. the arming plan self-exempts its own criteria.

(3) is not a wording defect — it is missing data. I removed the clause from the spec, recorded all
three live blockers in a `## Deferred` section, withdrew its task, and landed the two uncontested
dispatches. **A requirement that keeps generating new holes under review is usually under-specified at
its data layer, and the honest move is to name what is missing and stop.** Escalations also HARD-BLOCK
`approve`, so "the judge is advisory" is not a licence to iterate indefinitely.

## 4. Body↔AC drift is the defect I kept committing while writing specs about drift

Four separate times a review caught my spec body contradicting its own attached ACs: a `sed` that
rewrote an AC bullet so the body's `AC-MIS-3` described what was attached as `AC-MIS-6`; a Scope bullet
still pinning `exit 1` after the AC had been corrected to 2; a plan phase heading forbidding what its
own Sequencing Risks mandated; and — in the plan whose SUBJECT is a namespace collision — phases
labelled `Dispatch 1…3` colliding with the parent spec's `D1…D7` decisions, so `D2` was unresolvable.

Two mechanical causes I can name. First, `python` patch scripts that assert-then-write: one failed
anchor at the end discarded every earlier substitution in the same run, and I twice pushed an
UNPATCHED file while the script reported success for the patches it had applied. Fix: apply
substitutions individually, report which applied, and **verify the marker on disk before pushing**.
Second, `grep` verification with unescaped `**`/`(` in the pattern reported 0 matches for text that was
present — a false negative that nearly caused a redundant "fix". Fix: `grep -F`, and remember a pattern
that spans a line break can never match a line-oriented grep.

## 5. The tooling gaps that cost real work

- **SPEC-061's completeness guard counts every test-file-shaped argv token**, so an AC that greps a
  test file for a marker is permanently `inconclusive (ran 1 of N declared paths)`. Hit twice. Both
  fixed by moving the assertions INSIDE the suite — a strengthening, since they now run under
  `bun run test` — each with an in-place revision record.
- **The D8 path check is `cd`-blind.** `cd packages/lore && bun test tests/...` declares a path
  unresolvable from repo root, so its `--allow-missing-path` escape can never be redeemed. That is the
  mechanism behind `unredeemed_allow_missing_path_count`. Measured: `bun test packages/lore/tests/...`
  from the root works, so every AC I wrote uses repo-root-relative paths and redeems itself.
- **`lore ac set` refuses `--mode` even when the value is unchanged**, and prescribes
  `ac rm --force` + `ac add` — which by its own stated reasoning is more destructive.
- **`--falsifier-exit-code` can assert the exit CODE but never the failure's IDENTITY**, so a red for
  an unrelated reason (a broken import) is indistinguishable from a declared one.
- **`lore verify --falsify` reads as a boolean but takes the AC id as its VALUE**; bare use reports
  `unknown AC id ""`.
- **The review prompt TRUNCATES the parent spec** — one judgment reported "the parent decisions
  provided here are D1–D4 (truncated mid-D4)" and could not resolve a `D6` reference. So decision ids
  in a plan must be written WITH their subject, or a reviewer cannot check them.
- **`lore ready` has no phase-dependency mechanism**: a plan stating "BLOCKED BY Phase 1" still
  reports every task `ready: true, unmet_blockers: []`.

## 6. Three live reproductions of one pollution defect, from three different agents

`scripts/tests/spec-mirror-export.test.ts` runs the real exporter in WRITE mode against the production
corpus, and `.lore/lore.db` resolves UP to the main checkout from any linked worktree. So any broad
test selection inside a worktree writes mirror files derived from the SHARED database into that
worktree. Three independent implementers hit it; one could not isolate the culprit among 333 selected
files, which is itself the finding — **the pollution has no single owner, so any broad selection can
trigger it.** All three restored via `git show HEAD:<path>` + plain copy and plain `rm`, never a
destructive git command. The widened guard (merged) now sees `docs/requirements/**` dirt; making the
oracle read-only is the remaining half.

## 7. What the subagents caught that I had not specified

Worth recording because it argues for stating the *property* and letting the implementer find the
trap:

- A self-assertion test that reads its own source for marker tokens **passes by finding itself** — its
  own assertion literals restate the tokens. The implementer inserted a literal boundary marker and
  asserted only over the region before it. I had not thought of it.
- One implementer left a **permanent reverse control** in place: the same drifted state driven through
  `runExport` DOES rewrite the files, proving the hash comparator is not vacuous.
- A fixture-input correction (`SPEC-2` → `SPEC-002`) that turned a would-be false regression in a
  "nothing to reconcile" control case back into a real control — disclosed rather than folded in.
- An implementer reported that my bundle was self-contradictory (`run test:changed` + `never run
  build`, when `test:changed` builds unconditionally for binary-consumer selection) and named the
  coverage it therefore could not provide, instead of claiming full coverage.

## 8. A fixed gap turns its own documentation into a false assertion

`packages/lore/src/service/CLAUDE.md` was over its byte ceiling on `main` (15350 > 14746, a red
`claude-md-eviction-floor`). The line that pushed it over documented the `human_id` two-writer
disagreement — **which this session fixed**, making that line an outdated assertion by the repo's own
"fixing a gap and updating the notes recording it are one acceptance unit" rule. Evicting it per that
file's own rule (never raise the ceiling, never split lines — the constraint is BYTES) both retired the
stale claim and restored the budget. The byte ceiling is also a **contended shared resource with no
gate**: three sessions appended to one budget in a day.
