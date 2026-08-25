---
id: SPEC-148
type: spec
role: spec
title: "Phase writes are version-less BY DESIGN (SPEC-023) — the root CLAUDE.md lifecycle paragraph contradicts it, and the premise that phase history is dispensable has moved"
status: approved
priority: medium
created: 2026-08-24
updated: 2026-08-25
tags: []
parent: PRD-001
links:
  - {id: ADR-038, type: relates-to}
---
## Overview/Goal

⛔ CORRECTED 2026-08-24, same day this spec was created. The first version framed the
version-less phase write as a DEFECT and prescribed routing it through the version-logging
path. That was wrong: the behaviour is a DELIBERATE, documented decision, and this spec had
not read its rationale before indicting it.

The fence and its reason, both measured in source:

- `packages/lore/src/service/phase-service.ts:5` — "Phases are soft groupings stored in
  `plan.extra.phases` … They are NOT a doc type — no ID, no lifecycle, **no version
  history**." Source: SPEC-023 §4, §9.1.
- `packages/lore/src/service/ac-service.ts:8` — AC declarations "ride the parent spec's own
  version log (**unlike PhaseService's version-less writes** — AC declarations are
  judge-consumed data (SPEC-026/038), so history matters more here)."

So the asymmetry was reasoned, written down at BOTH sites, and traced to a spec. What
remains true after reading it is narrower and different from a bug report.

### What actually survives

**S1 — a documentation falsehood, not a code defect.** The root `CLAUDE.md` Document
Lifecycle paragraph states: "Editing an `approved` doc resets it to `draft` automatically —
content/title AND `extra`". Measured on an approved plan: `lore phase add` changed
`extra.phases`, the plan stayed `approved`, and `lore log` gained no row. The code is doing
what SPEC-023 decided; the memory file asserts a universal that was never universal.

**S2 — the decision's premise deserves re-examination, on the record.** SPEC-023 justified
version-less writes by calling phases "soft groupings". Since then `extra.phases[]` became
load-bearing for governance: `taskExtraSchema.phase` is validated cross-entity against the
MEMBER plan's `phases[].name`; `lore ready` groups by it; the plan-close family reasons over
"every child task archived", where an EMPTY phase is exactly the vacuous-truth case. ⛔ That
is a question about whether a past trade-off still holds — NOT evidence that it never did.

**S3 — what this spec measured and must NOT overclaim.** Sibling `extra` writers were
measured in a throwaway corpus (`mktemp -d` + `lore init`, deleted after — never this repo's
live `.lore/`): `lore anchor add` v1→v2, `lore scope add` v2→v3, `lore red-first` v3→v4, and
`phase add`/`phase rm` stayed at v1. Those numbers stand. ⛔ The INFERENCE originally drawn
from them — "five siblings log, so this one forgot" — does not: `ac-service.ts:8` names the
distinction on purpose.

⛔ Also not a defect, checked before asserting: `DocType` does include `"phase"`
(`packages/core/src/types.ts:19`) and `lore gate phase-claim` exists (SPEC-056), so "phase"
names TWO things — `plan.extra.phases[]` soft groupings and a `phase` DOC TYPE (of which this
corpus currently holds zero). `phase-service.ts:5` is about the former and remains true of it.
An earlier reading of this spec's own draft treated that comment as stale; it is not.

### S2 is now RESOLVED — decided 2026-08-24 by the project owner

`adr-phase-writes-log-a-version-row-and-do-not-demote-the-plan` (`decision_status:
accepted`, linked from this spec) answers S2: **phase writes SHALL log a version row, and
SHALL NOT demote the plan.** `addPhase`/`removePhase`/`renamePhase` gain `insertVersion`;
plan status is left untouched, so adding a phase to an `approved` plan keeps it `approved`.

⛔ D2 required that the answer come from SPEC-023's authors rather than from an agent
reasoning inside a defect spec. It did: the owner chose from four costed options. That is
what discharges D2 — not an agent arguing the point more carefully.

⛔ What is overturned is narrow: SPEC-023's "history is dispensable" clause only. Its
soft-grouping model stands — phases stay id-less, lifecycle-less, and NOT a doc type. The
separate `"phase"` entry in `DocType` is a different thing, and conflating the two is a
misreading this spec's own history already records.

## Scope

In: reconciling S1 — the lifecycle paragraph must stop asserting a universal that three
writers already break (`ac add`, `phase add`, `phase rm`). Either it enumerates the
exceptions or it states the rule narrowly.

In: S2 is DECIDED AND RECORDED — the ADR exists and is `accepted`, so the condition the
previous revision imposed ("any such change must first record why SPEC-023's rationale no
longer holds") is MET. What is in scope now is consuming that decision: routing all three
`PhaseService` writers through `insertVersion`.

In: `renamePhase` — MEASURED 2026-08-24, no longer presumed. Version-less and non-demoting,
identical to add/rm, established against a green control (`lore set --content`) that DID
demote and DID log a row in the same apparatus, so the instrument was shown to discriminate
before the negative result was believed. It moved Out → In because the presumption was
replaced by a measurement, not because the presumption was accepted.

Out: ⛔ demoting the plan on a phase write. The ADR rejects that alternative by name — it
would force re-approval on every phase edit of an `approved` plan, which is a coordination
cost paid on each edit under many-concurrent-sessions. A future reader who finds phase
writes logging a version but not demoting is looking at the DECIDED behaviour, not an
unfinished migration.

Out: ⛔ promoting phases to a doc type, and ⛔ any migration that reconstructs the
back-catalogue. Pre-existing phase mutations left no rows and cannot be recovered.

Out: F1–F5 of `knowledge-five-governance-findings-measured-while-closing-the`. F1 is owned by
`spec-lore-issues-falls-through-to-the-local-corpus-on-a`.

## Module Boundary

- WRITE target: `packages/lore/src/service/phase-service.ts` — `addPhase`, `removePhase`,
  `renamePhase`. Each currently writes via `this.store.update` with no `insertVersion`; each
  gains one. The `ac-service.ts` writer is the shape to copy, and its header comment at
  `ac-service.ts:8` — which today names PhaseService as the version-less contrast — becomes
  a STALE ASSERTION the moment this lands, so it is in scope for the same task. ⛔ Fixing a
  gap and updating the comment that documented the gap are one acceptance unit.
- WRITE target: `packages/lore/src/service/phase-service.ts:5`'s own header, for the same
  reason — it states "no version history" as a property of the phase family.
- Already landed, do not redo: the root `CLAUDE.md` Document Lifecycle paragraph
  (`CLAUDE.md:120`, commit `063f113f`) now enumerates the three exceptions instead of
  asserting the false universal. ⛔ But that paragraph currently describes `phase add|rm` as
  "neither demotes NOR logs a version — BY DESIGN"; the second half of that clause becomes
  false when this spec lands, so the paragraph is a WRITE target again, for the logging half
  only.
- ⛔ `resolveStatusAfterContractEdit` (`packages/core/src/schemas.ts`) MUST NOT be called
  from `PhaseService`. The previous revision required it conditionally, on a demotion that
  the ADR has now rejected. Calling it would implement the alternative that was declined.

## Design Decisions

| # | Decision | Choice | Rejected | Rationale |
|---|---|---|---|---|
| D1 | What is wrong here | the DOCUMENTATION (S1); the code follows SPEC-023 | "the writer forgot to log" | measured: both sites document the asymmetry and give its reason |
| D2 | The premise question | ANSWERED 2026-08-24 by the owner, recorded in an accepted ADR: log a version, do not demote | leave it open; or let an agent pick it | D2's requirement was authorship, not caution — the owner chose from four costed options, which is the input D2 was holding out for |
| D3 | Oracle shape | ⛔ RE-BASELINED with D2: assert a version row DOES appear and status does NOT change | the previous "assert current behaviour, never presuppose logging" | the old wording existed only because D2 was undecided; keeping it after the ADR would make the oracle certify the rejected alternative |
| D4 | `renamePhase` | MEASURED, not assumed — version-less and non-demoting, same as add/rm | assume it matches add/rm | it does match, but the point stands: the match is now a measurement with a green control behind it, not an inference from a neighbour |
| D5 | Why not the fingerprint alternative | rejected in the ADR | record a `phases_fingerprint` at approval and compare it at the gates | strictly more new surface (a field plus two consumer sites) than three `insertVersion` calls, and it leaves the history half silent |

## Risks

- ⛔ This spec has now been wrong in BOTH directions, and that is the risk to carry forward.
  v1 indicted a deliberate design as a defect. The corrected version then hardened "do not
  touch the write path" into an oracle. Neither error was caught by reading; both were caught
  by measuring, and the second only because a decision was escalated instead of assumed. ⛔ Do
  not read the ADR as retroactive proof that v1 was right — v1's REASONING ("five siblings
  log, so this one forgot") is still false, and the ADR reaches the same write path from an
  entirely different premise.
- ⛔ The demotion half is the live trap. Three of the four options put before the owner
  touched status; the chosen one does not. An implementer who pattern-matches "version-logging
  writer" to `ac set` rather than `ac add` will add a demotion nobody asked for, and every
  workflow that adds a phase to an approved plan starts requiring re-approval.
- The back-catalogue is unrecoverable either way: phase mutations already applied left no
  rows. Anywhere plan version history is presented as complete, that limit MUST be stated.

## Acceptance Criteria

Typed ACs authored via `lore ac add` (script mode). Coverage contract, RE-BASELINED against
the ADR: the root `CLAUDE.md` lifecycle paragraph and the measured behaviour must be pinned
to agree, where the agreed behaviour is now "a version row appears AND status does not
change" for all three writers. The doc-side half must catch the paragraph still calling
phase writes version-less. The code-side half must assert BOTH conjuncts per writer — a
present version row is not evidence that status was left alone, and an unchanged status is
not evidence that a row was written; an oracle checking only one certifies half the
decision. Plus an `accepted` ADR reachable from this spec, and the stale header comments at
`phase-service.ts:5` and `ac-service.ts:8` updated in the same unit as the code.

⛔ Every negative assertion here needs a green control in the same run. "No demotion
happened" is indistinguishable from "the status reader is broken" without a writer that DOES
demote in the same apparatus — `lore set --content` is the one used to establish the
baseline, and the suite should keep using it.

### How the suite must invoke lore — pinned, because the alternative is a false oracle

The three ACs all run one vitest file, and all three depend on "live" behaviour. ⛔ The suite
MUST reach the CLI through the WORKTREE'S OWN SOURCE (`packages/lore/src/index.ts`, e.g. via
`bun run dev` or `bun <repo>/packages/lore/src/index.ts`) and MUST NOT invoke a prebuilt
`dist/lore`. A `dist/lore` binary is built from whatever commit last ran `bun run build`; a
suite that spawns it measures that commit and reports the verdict as if it measured the
change under test. This repo has already been burned by the harness-sees-its-own-copy shape.
⛔ The suite must also ASSERT the resolved entry path lies inside the repo under test, so the
mistake is refused rather than merely discouraged.

⛔ vitest is the pinned runner, so the suite may NOT top-level-import `bun:sqlite` (or
anything that transitively does) — that is what forces the subprocess shape above rather
than an in-process `createApp`. Naming this here because the obvious in-process
implementation is the one that will be reached for first, and it fails under vitest for a
reason unrelated to anything this spec is about.

### How the paraphrase hole was closed, and what the four review passes cost

⛔ This section previously disclosed an UNCLOSED gap: AC-PHASEVER-3(a)/(b) name an intended
meaning, and (d)'s two banned phrases could be paraphrased around — a header saying
"PhaseService does not record history" would have passed every conjunct while keeping the
stale claim. The disclosure was honest and it was also the wrong answer. AC-PHASEVER-3(e)
closes it POSITIVELY: each header must contain the ADR slug exactly once. A header compelled
to cite the ADR cannot quietly keep asserting what the ADR overturned, and a positive
fixed-string requirement has no paraphrase surface at all.

⛔ Recorded because the process is the finding: this spec took FOUR `lore review` passes to
reach that, and every pass found something real — a negative with no green control, a
semantic predicate dressed as a pinned one, an oracle that MATCHED THE FALSE TEXT it existed
to delete, and finally the choice between disclosing a hole and closing it. ⛔ The lesson is
not "review more"; it is that a negative-only oracle over prose tends toward
paraphrase-whack-a-mole, and the exit is a POSITIVE requirement pointing at the new SSOT.
An earlier revision of this very section asserted the gap was uncloseable; that assertion is
retracted here rather than left standing.

⛔ **The version-row count is read via `lore log <plan> --json`'s `data.total`** — measured
2026-08-24 to exist and to equal the entries length. Printed line counts are refused:
`--limit` defaults to 20 and any format change moves them.

⛔ **AC-PHASEVER-1(a)'s required literal is NORMATIVE**, copied character-for-character
including backticks and capitalization. A semantically correct paragraph worded differently
FAILS that oracle on purpose — every looser form measured so far also matched the false text
it was meant to delete.

### One conjunct is VACUOUSLY GREEN today — say so, do not silently bank it

Measured 2026-08-24: `grep -n 'resolveStatusAfterContractEdit\|"draft"'
packages/lore/src/service/phase-service.ts` returns ZERO matches. So AC-PHASEVER-3(c) passes
BEFORE any work is done. It is retained deliberately as a REGRESSION GUARD against the
implementation trap named in Risks — not as evidence of anything achieved. ⛔ Its pass MUST
NOT be counted as coverage of this spec's change; "vacuously true" and "true" are different
verdicts and this one is the former until an implementation exists for it to constrain.

## Post-landing corrections, all measured after the first plan closed

⛔ Four defects in THIS spec's own acceptance criteria, found by the implementers and by
`lore assess` rather than by re-reading. Recorded here in full because the AC statements are
capped at 2000 characters and the reasons do not fit there.

### C1 — a `-t` filter naming a block that does not exist EXITS 0

Measured 2026-08-24: `bunx vitest run <file> -t 'no such block name anywhere'` returns
**exit 0** and prints `Tests 41 skipped (41)`. So AC-PHASEVER-2 and AC-PHASEVER-3 as
originally written had a live false-green path: rename either addressed block and the AC
command exits 0, the trailing `&& echo '... PASS'` fires, and the criterion reports coverage
over zero executed assertions.

⛔ This was NOT hypothetical carelessness — the phase-1 bundle explicitly told the agent to
confirm assertions actually ran, and it did. But a bundle instruction is not an oracle: the
stored COMMAND is what `lore verify` re-runs, forever, with nobody reading a bundle.

Fix, measured both ways before pinning: all four commands now capture the run, print it (so
the evidence tail still carries the runner summary), and require BOTH `exit 0` AND a summary
line matching `Tests +[0-9]+ passed`. Verified against the real block → guard passes; against
a nonexistent block → vitest still exits 0 but the guard FAILS. ⛔ A skipped-only summary
prints no `passed` count, which is exactly what makes this discriminating.

⛔ Consequence accepted deliberately: changing `verify.command` bumps `oracle_generation`, so
the attested evidence from the first plan no longer covers the hardened generation. Re-run and
re-attested in the same slice rather than left as a dangling claim.

### C2 — AC-PHASEVER-3(c)'s control count was an UNDERCOUNT

The statement said `resolveStatusAfterContractEdit` in `ac-service.ts` is "2 (import :99,
call :615)". Re-measured with the whole rule: it is **4** — `:73` and `:1132` are prose
mentions in comments. The assertion is `>= 1`, so no oracle was affected. ⛔ The error worth
keeping: I ran a grep, mentally filtered the hits down to the ones I considered relevant, and
wrote the filtered number as the measurement. A count is reproducible only when the command
that produced it IS the whole rule.

### C3 — documenting the prohibition FAILS the prohibition's own oracle

AC-PHASEVER-3(c) demands `resolveStatusAfterContractEdit` == 0 occurrences in
`phase-service.ts`. The phase-2 implementer's first draft of the header NAMED the identifier
in order to prohibit it — which put the count at 2 and failed the criterion. It caught this by
hand-measuring before running the suite.

⛔ So the most natural way to document a prohibition is refused by the oracle enforcing it.
That is a real cost of identifier-count criteria and it is not fixable by loosening the count:
the landed header states the prohibition as an ABSENCE plus an in-file note saying why the
identifier is deliberately not spelled out. Anyone tightening this later must keep that
workaround intact or the criterion becomes unsatisfiable-while-documented.

### C4 — AC-PHASEVER-3(d) was SELF-COLLIDING, and the workaround is now stated in the criterion

The criterion pins a repo-wide grep for two phrases to 0 files, with no exclusion — while the
suite implementing it lives under `packages/` and must reference both phrases. The phase-1
agent resolved it by assembling both phrases from concatenation so they never appear
contiguously, plus a self-guard test that fails if anyone rejoins the literals.

⛔ That workaround is correct and was invisible in the criterion, which means the criterion's
reachability depended on undocumented cleverness. The statement now names the exclusion
explicitly so a future editor is not required to rediscover it.

### C5 — the audit-trail pairing was UNGUARDED, and that is what AC-PHASEVER-4 exists for

The strongest finding of the whole slice, and it came from the implementer refusing the bundle
rather than following it. The bundle said "gain an `insertVersion` alongside the existing
`store.update`". Built literally, that shape makes `lore audit --verify` report `clean: false`,
exit 4, **one miss per phase write** — because `AuditService.verify` reconciles every
`action:"update"` version row against an audit entry joined on `(doc_id, details.version)`.

⛔ And the parity suite passed **41/41, exit 0, against that broken shape.** Independently
confirmed: the suite contains ZERO `audit --verify` assertions. So AC-PHASEVER-1/2/3 had no
discriminating power whatsoever over a broken audit trail, and following this spec's own
bundle literally would have landed one under three green attested criteria.

The landed implementation routes all three writers through one private `writePhases` helper
making a single CAS-guarded `store.updateWithProvenance` call — doc patch, version row and
audit entry committed or rolled back together, with `expected_version` turning a concurrent
double-`phase add` into a clean `STALE_VERSION` for the loser. Independently verified in a
throwaway corpus: `data.total` 2→3→4→5 across add/rename/rm, status `approved` throughout,
`lore audit --verify` clean and exit 0.

⛔ But "verified once by the orchestrator" is not a mechanism. AC-PHASEVER-4 makes the pairing
oracle-enforced, and it is RED on purpose until someone writes its suite: its command names a
file that does not exist, and vitest on a nonexistent file exits **1** (measured — unlike the
`-t` case in C1, which exits 0). ⛔ It MUST NOT be re-pointed at a `-t` filter on the existing
suite; that would reintroduce C1's false-green in the criterion built to close C5.


## Acceptance Criteria (structured)

- [⚑] [script] AC-PHASEVER-1: CLAUDE.md's lifecycle paragraph and the measured behaviour of `lore phase add` are pinned to AGREE on the ADR's decision: a version row appears AND status is unchanged. Three conjuncts, ONE run. (a) DOC PARITY as two fixed-string counts in the root CLAUDE.md. FORBIDDEN: "neither demotes NOR logs a version" == 0. REQUIRED: "`lore phase add|rm` does NOT demote but LOGS a version" == 1 -- NORMATIVE, copied verbatim including backticks and case; a differently-worded but correct paragraph FAILS on purpose. Attribution sits inside the literal, so no separate attribution predicate. Measured 2026-08-24: forbidden=1, required=0 -- both RED. ⛔ REFUSED as oracle, on measurement: a bare grep for "logs a version", or a regex binding the writer names to it. Both MATCH THE CURRENT FALSE TEXT (measured 1 against the false line), so both report coverage while having zero discriminating power. (b) LIVE measurement in a throwaway corpus (mkdtemp + lore init, cwd inside it, NEVER this repo's .lore/): `lore phase add` on an APPROVED plan raises `lore log <plan> --json`'s `data.total` by EXACTLY 1 AND leaves status `approved`. Two separate halves -- a new row is not evidence status was untouched, nor the reverse. `data.total` is the pinned reader (measured 2026-08-24 to exist and equal the entries length); printed lines are refused because `--limit` and format changes move them. (c) GREEN CONTROL, SAME run: `lore set --content` on that plan observed to demote to `draft` AND raise `data.total` by 1. Without it, (b)'s negative half is indistinguishable from a broken status reader. RE-BASELINED 2026-08-24; why this is a correction and not a weakening is in D3 and the ADR's Consequences. Runner and invocation shape are pinned in the spec body.
  script: test — out=$(bunx vitest run packages/lore/tests/integration/phase-write-lifecycle-doc-parity.test.ts 2>&1); ec=$?; printf '%s\n' "$out"; [ "$ec" -eq 0 ] && printf '%s' "$out" | grep -qE 'Tests +[0-9]+ passed' && echo 'AC-PHASEVER-1 PASS: CLAUDE.md has 0 of the forbidden clause and exactly 1 of the required literal, phase add on an approved plan raised lore log --json data.total by exactly 1 and left status approved, a same-run set --content control demoted and logged, and a nonzero passed count proves assertions actually executed'
- [⚑] [script] AC-PHASEVER-2: renamePhase and removePhase are MEASURED with the same two conjuncts AND the same green control as add, and S2's premise question has a recorded answer. (a) A live throwaway-corpus measurement of `lore phase rename` AND `lore phase rm` against an APPROVED plan, each asserting BOTH conjuncts explicitly: version-row count +1, and status still `approved`. D4 forbids assuming these match add -- and note they DID match add under the old behaviour (measured 2026-08-24: version-less and non-demoting, against a green control), which is exactly why re-measuring after the change is required rather than inferred. (a2) GREEN CONTROL, required in the SAME run as (a) and not inherited from AC-PHASEVER-1: a `lore set --content` write on the same plan observed to demote to `draft` and log a row. AC-1(c) only covers AC-1's own run; if rename/rm are measured in a separate vitest invocation their 'status still approved' half is exposed to the identical broken-status-reader failure mode. A control that does not run in the same process as the negative it guards is not a control. (b) An ADR exists at DEPTH 1 from this spec -- a direct `relates-to` link edge outbound from this spec, as created 2026-08-24, not transitive tree reachability -- and has decision_status `accepted`, recording whether SPEC-023's 'phases are soft groupings, history is dispensable' rationale still holds now that extra.phases[] gates taskExtraSchema.phase cross-entity validation, lore ready's grouping, and plan-close's every-child-archived reasoning. The oracle asserts reachability and `accepted`, NEVER a particular conclusion. Satisfied as of 2026-08-24 by adr-phase-writes-log-a-version-row-and-do-not-demote-the-plan, which answers: overturn the history clause, keep the soft-grouping model, do not demote.
  script: test — out=$(bunx vitest run packages/lore/tests/integration/phase-write-lifecycle-doc-parity.test.ts -t 'rename and rm measured and premise recorded' 2>&1); ec=$?; printf '%s\n' "$out"; [ "$ec" -eq 0 ] && printf '%s' "$out" | grep -qE 'Tests +[0-9]+ passed' && echo 'AC-PHASEVER-2 PASS: phase rename and phase rm each added exactly 1 version row and left status approved against a same-run set --content control, an accepted ADR reachable from this spec records the SPEC-023 premise verdict, and a nonzero passed count proves the filter selected real tests'
- [⚑] [script] AC-PHASEVER-3: Every prose assertion that phase writes are version-less is swept in the SAME unit as the code change, and the ADR-rejected demotion is guarded. THREE conjuncts -- (c), (d), (e) -- and they are the WHOLE oracle. INTENT, NOT conjuncts, because neither is checkable without judgement: phase-service.ts's header should stop stating 'no version history' as a property of the phase family, and ac-service.ts's should stop naming PhaseService as the version-less contrast (TRUE today, STALE the moment this lands; fixing a gap and updating the comment that recorded it are ONE unit). ⛔ (d)+(e) are NOT equivalent to that intent -- a header with zero banned phrases and one ADR citation could still assert the overturned claim in fresh wording. Residual: a reviewer MUST read both headers. (c) NEGATIVE GUARD, detection pinned. In phase-service.ts: `resolveStatusAfterContractEdit` == 0, 'draft' single-quoted == 0, "draft" double-quoted == 0. CONTROL, same run: that identifier in ac-service.ts >= 1 -- measured 4 with the whole rule (an earlier revision said 2, having filtered the grep to code sites; spec body C2). ⛔ NAMING the identifier in order to prohibit it FAILS this conjunct (C3) -- state the prohibition as an absence. ⛔ (c) was VACUOUSLY GREEN before any work; it guards the Risks trap and its pass MUST NOT count as coverage. (d) NEGATIVE closed set: `grep -rIl -e 'no version history' -e 'version-less' packages/` == 0 files. ⛔ EXCLUSION, stated rather than left as undocumented cleverness: the suite lives under packages/ and must reference both phrases, so it concatenates them and never writes them contiguously (C4). (e) POSITIVE requirement, which CLOSES (a)/(b) instead of disclosing them: each file's LEADING block comment contains the literal "adr-phase-writes-log-a-version-row-and-do-not-demote-the-plan" EXACTLY 1 time. Fixed-string, no paraphrase surface. Measured: citing it elsewhere in the file leaves the count at 0.
  script: test — out=$(bunx vitest run packages/lore/tests/integration/phase-write-lifecycle-doc-parity.test.ts -t 'stale version-less assertions swept and demotion guarded' 2>&1); ec=$?; printf '%s\n' "$out"; [ "$ec" -eq 0 ] && printf '%s' "$out" | grep -qE 'Tests +[0-9]+ passed' && echo 'AC-PHASEVER-3 PASS: both headers dropped the version-less phrases and each cites the ADR slug once, phase-service.ts has 0 hits for resolveStatusAfterContractEdit and 0 draft literals against an ac-service.ts control of at least 1, the repo-wide grep returns 0 files, and a nonzero passed count proves the filter selected real tests'
- [⚑] [script] AC-PHASEVER-4: The version row and its audit entry are written as ONE unit, oracle-enforced instead of comment-enforced. In a throwaway corpus (mkdtemp + lore init, cwd inside it, NEVER this repo's .lore/), against an APPROVED plan: after EACH of `lore phase add`, `lore phase rename` and `lore phase rm`, read `lore audit --verify --json` and assert `data.clean === true`, `data.misses.length === 0` and `data.chain.clean === true`. NON-VACUITY GUARD, required: clean over an empty set is meaningless, so also assert `data.chain.checked` STRICTLY INCREASES across the three writes. A clean verdict whose checked count never moved has not observed the phase writes at all. ⛔ READER PINNED TO --json, measured 2026-08-24 to expose exactly those fields. An earlier revision of this criterion parsed the count out of the human-readable line `Chain integrity: clean (8 entries checked).` -- withdrawn as internally inconsistent, because AC-PHASEVER-1(b) had already rejected printed output for precisely this reason and pinned `data.total` instead. Same class of reader, same objection. WHY THIS EXISTS -- measured, not hypothetical (spec body C5): the shape this spec's own dispatch bundle prescribed (a bare `insertVersion` beside `store.update`) makes `lore audit --verify` report clean:false, exit 4, one miss per phase write, because AuditService.verify joins version rows to audit entries on (doc_id, details.version). The existing parity suite passed 41/41 exit 0 against that broken shape and contains ZERO audit-verify assertions, so AC-PHASEVER-1/2/3 had NO discriminating power over a severed audit trail. ⛔ RED ON PURPOSE until its suite is written: the command names a file that does not exist and vitest exits 1 on a nonexistent file (measured). ⛔ It MUST NOT be re-pointed at a `-t` filter on the existing suite -- a `-t` naming a missing block exits 0 with everything skipped (measured), reintroducing the false-green this criterion closes.
  script: test — out=$(bunx vitest run packages/lore/tests/integration/phase-write-audit-pairing.test.ts 2>&1); ec=$?; printf '%s\n' "$out"; [ "$ec" -eq 0 ] && printf '%s' "$out" | grep -qE 'Tests +[0-9]+ passed' && echo 'AC-PHASEVER-4 PASS: lore audit --verify stayed clean and exit 0 after each of phase add, rename and rm in a throwaway corpus, the checked-entry count strictly increased across the three writes, and a nonzero passed count proves assertions executed'

## Code anchors

- packages/lore/src/service/phase-service.ts#PhaseService
- packages/lore/src/service/ac-service.ts#AcService
- packages/lore/tests/integration/phase-write-audit-pairing.test.ts
- packages/lore/tests/integration/phase-write-lifecycle-doc-parity.test.ts
