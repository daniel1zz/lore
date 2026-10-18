---
id: SPEC-125
type: spec
role: spec
title: "lore ac set — in-place edit of a declared acceptance criterion, under prose-edit demotion governance"
status: approved
priority: medium
created: 2026-08-01
updated: 2026-10-10
tags: []
links:
  - {id: SPEC-038, type: implements}
---
# `lore ac set` — in-place edit of a declared acceptance criterion

## Overview/Goal

`spec.extra.acceptance_criteria[]` is read by three oracles — the `lore verify`
runner, the SPEC-052 lexical AC lint, and `lore ac list` — and written by exactly
one verb, `lore ac add`, which only APPENDS. There is no path that corrects a
declared criterion in place. The only way to change a `statement` today is
`lore ac rm --force` followed by `lore ac add`, whose own help text states the
consequence: *"existing ac_ref becomes dangling"*.

**The measured consequence is not an error — it is silent, indefinite drift.**
`spec-a-test-case-s-timeout-budget-must-be-declared-when-its` carries AC-TB-1
whose `statement` reads *"the test-budget oracle exits 0 on the repo tree once
the reported instance declares an explicit timeout"*. That sentence stopped being
true when the baseline-ledger landed
(`adr-a-newly-armed-structural-oracle-enforces-from-a-baseline`): exit 0 now means
every pre-existing violation is matched by an auditable ledger row AND no new debt
exists. The spec's PROSE was corrected (v12, 2026-08-01); the structured
`statement` was not — because correcting it required `--force` against three
live `ac_ref` rows on `task-t1-structural-test-budget-oracle`. The divergence has
stood since 2026-07-31 inside a single document, with the machine-read half wrong.

This is the third instance of one structural defect: **a field every oracle reads
that no verb can correct**. Its two siblings both ended in a writer verb —
`prd_sync_exempt` → `lore outline exempt`, and `attestation_exempt` →
`lore plan exempt-attestation` (recommended 2026-07-24, escalated 2026-07-31 after
a gate hole rode the missing opt-out). CLAUDE.md records the class verbatim: *a gate
demanding a field no surface can author fails SILENT*.

**Goal**: `lore ac set <spec> <id>` edits a declared criterion in place — id stable,
`ac_ref` references intact at every instant, no `--force`, and the edit governed by
exactly the same demotion rule that already governs prose edits. Plus the detector
that makes the guarantee checkable rather than merely argued (D7).

## Scope

### D1 — Editable fields, and the two that are not

`lore ac set <spec> <id>` accepts `--statement`, `--oracle`, `--command`,
`--rubric`, `--note`, `--covers` (repeatable). Every flag is optional; each one
passed replaces that field, each one omitted leaves it untouched.

`--statement` and `--covers` are mode-agnostic — every criterion has a statement,
and any criterion may cover PRD requirement ids. The remaining three are
mode-specific (D5).

`--covers` accumulates ACROSS repetitions within one invocation, then REPLACES the
stored array wholesale — `--covers R-1 --covers R-2` sets exactly `[R-1, R-2]`,
never appends to what was there. There is deliberately no append mode: an
accumulating flag whose prior state is invisible at the call site is how a caller
ends up with a set it did not intend. To clear the field, pass `--covers` with the
empty string, which sets `[]`.

`id` and `mode` are NOT editable. Changing `mode` re-interprets every historical
evidence row attributed to that id (a `script` criterion's attested rows mean
something a `human` criterion's cannot), so it is a different criterion wearing the
same name. That transition keeps its existing cost: `rm` + `add`, with the `ac_ref`
consequence explicit and accepted. `lore ac set --mode` exits 2 naming this rule.

### D2 — The edit is governed exactly like a prose edit

Editing content or title on an `approved` doc already resets it to `draft`
(`VALID_TRANSITIONS`, `CorpusService`). `lore ac set` on an `approved` spec MUST do
the same, for the same reason: an acceptance criterion IS the contract, and a
changed contract has not been reviewed.

This is the invariant that makes the verb safe to build. The alternative reading —
"acceptance criteria should be immutable, so the missing verb is deliberate" — was
considered and rejected on two measurements: (a) `lore ac rm --force` already makes
them mutable, so immutability is not an enforced invariant, merely an inconvenient
one; and (b) the project's existing answer to "the contract changed" is demotion plus
re-review, not prohibition. Defending an invariant by *not shipping a command* is a
prose-layer defence, and a defect already covered by prose is proof the prose layer
is the wrong layer. I12 (`no self-weakening`, catalogued 2026-08-01) is discharged
by the demotion, not by the absence of the verb.

### D3 — A no-op is an error, never a silent success

`lore ac set <spec> <id>` with no field flag exits 2 naming the available flags, and
writes nothing to the document (no version bump, no `updated_at` touch). A command
that reports success while writing nothing is the silent-fallback shape this codebase
forbids; a command that bumps a version while changing no field is the same lie one
layer down.

### D4 — An unknown id is loud and names the alternatives

An `<id>` not present in `extra.acceptance_criteria` exits 4 (`VALIDATION_ERROR`),
and stderr enumerates the ids that ARE declared. A bare "not found" would leave the
caller unable to distinguish a typo from an undeclared criterion.

### D5 — Mode-inconsistent flags are refused, not ignored

`--oracle` / `--command` are meaningful only for `mode: script`; `--rubric` only for
`ai`; `--note` only for `human`. Passing a flag the target criterion's mode does not
define exits **4** (`VALIDATION_ERROR`) with stderr naming both the flag and the
criterion's actual mode. Accepting-and-dropping would let a caller believe an oracle
was rewritten when it was not — the same false-success shape as D3.

### D5a — Why the exit codes split where they do

The boundary is not stylistic; it follows the established mapping (SPEC-003 §5,
implemented in `adapters/cli/utils.ts::exitCode`, which mints no code for argv
faults — those are raised pre-service in the command modules, uniformly as 2):

- **Exit 2 = decidable from argv alone, before any service call.** No-field-flag (D3)
  and `--mode` (D1) are both judgeable by reading the command line; the document is
  never opened.
- **Exit 4 = `VALIDATION_ERROR`, decidable only against document state.** Unknown id
  (D4) and mode-inconsistent flag (D5) both require reading the target spec's
  `acceptance_criteria` — which ids exist, and what `mode` the named one carries.

D5 was drafted as exit 2 and corrected to 4 during review for exactly this reason:
its predicate cannot be evaluated without the document, so it belongs to the
service-layer family, not the argv family.

### D6 — Reference integrity is structural, not procedural

`set` never removes the criterion, so no instant exists in which a live `ac_ref`
points at an absent id. This is the property that distinguishes it from
`rm --force` + `add`, whose window is real: this repo has concurrent sessions
writing the same corpus (measured this session — `main` advanced and the corpus
grew mid-run), and a failed second step makes the dangling state permanent while the
`rm` is already audited.

### D7 — The dangling-`ac_ref` detector ships in THIS slice

D6 argues the guarantee structurally; nothing currently MEASURES it. `lore ac rm
--force` can produce a dangling `ac_ref` today and no oracle in the repo would
report it — the corpus has no integrity check over the evidence→criterion edge at
all. Shipping the safe writer while leaving its failure mode undetectable would
close the convenient path and leave the dangerous one unmonitored.

**This is not hypothetical — it has already happened, measured 2026-08-01.** A
read-only probe over the live corpus (636 declared AC ids, 2164 evidence rows
carrying an `ac_ref`) found **three dangling references**:

| task | dangling `ac_ref` |
|---|---|
| `task-t2-framing-line-emitted-binary-side-hook-demoted-to` | `AC-CP-3` |
| `task-t4-payload-wide-feed-governance-rule-manifest-regeneration` | `AC-CP-5` |
| `task-t5-compiled-e2e-suite-proving-every-surface-from-a` | `AC-CP-7` |

All three belong to `spec-context-provenance-injected-corpus-global-state-and-a`,
which today declares AC-CP-1, 2, 4, 6, 9, 10, 11 — 3, 5 and 7 are gone from a
sequence that otherwise runs contiguously. Its version log is a run of paired
`Acceptance criteria updated (removed …)` / `Acceptance criteria updated (added …)`
entries: the `rm`-then-`add` cycle this spec exists to replace, executed repeatedly,
with three ids that never came back. Nothing reported it for two days.

So the missing writer verb did not merely make correction inconvenient — it has
already cost three evidence rows their referent, silently.

So this slice also delivers `scripts/check-ac-ref-integrity.ts`: for every task's
`extra.verification_evidence[].ac_ref`, assert the referenced id is still declared on
the governing spec; exit 0 on a clean corpus, non-zero naming each dangling
(task, ac_ref) pair otherwise. It runs against the repo corpus read-only and, per the
CLAUDE.md prohibition, MUST NOT write to `.lore/` — its negative-control fixture is a
throwaway `mkdtemp` corpus carrying one seeded dangling reference, never the live one.

This detector is what AC-ACS-7 measures. The one-off migration of AC-TB-1 (the
motivating instance) is a CONSUMER of the new verb, tracked as its own task, not as
this spec's acceptance criterion — a criterion that permanently passes after a single
manual edit has no regression value.

**Retroactive policy for the three measured dangling refs (in THIS slice).**
A newly armed detector evaluates at close time against data authored under the old
rules, so the back-catalogue lands in violation the moment it arms
(`knowledge-retro-a-newly-built-gate-leaves-every-pre-existing`). The budget is
therefore declared here rather than discovered later.

The repair is constrained by an existing invariant: `extra.verification_evidence` is
**append-only** (SPEC-025). No evidence row's `ac_ref` may be rewritten or deleted.
That leaves exactly two honest outcomes per dangling ref, and the choice between them
is a DIAGNOSIS, not a default:

1. **The criterion should still exist** (it was lost in an `rm`+`add` cycle, not
   retired) → re-declare it under its original id. The evidence row's historical
   assertion becomes resolvable again and is once more true.
2. **The criterion was genuinely retired or merged** → record a typed, auditable
   exemption row (id, spec, date, reason, what the evidence row asserted), which the
   detector reads and treats as non-dangling. Never synthesise a criterion to satisfy
   the predicate: an exemption stays auditable forever, whereas a criterion authored
   to clear a detector is afterwards indistinguishable from a real one (the CLAUDE.md
   rule, applied here verbatim).

Guessing between (1) and (2) is forbidden — the diagnosis must cite the spec's
version history for the version in which each id disappeared. AC-ACS-7's positive half
(exit 0 on the repo corpus) is reachable only after all three are dispositioned one
way or the other, which is what makes the cleanup part of this slice rather than a
follow-up.

### Out of scope

- Bulk / multi-id editing. One criterion per invocation.
- Editing acceptance criteria through `lore set` (it replaces `extra` wholesale —
  the reason `lore anchor add` exists as a separate verb; same precedent applies).
- MCP tool surface for the new verb. CLI first; the MCP roster is a separate slice.
- Wiring `check-ac-ref-integrity` into `hooks/pre-push`. The detector ships and is
  runnable here; arming it as a push gate is a separate decision with its own
  retroactive-sweep budget (`knowledge-retro-a-newly-built-gate-leaves-every-pre-existing`).

## Acceptance Criteria

Deterministic oracles only. Each AC below is ALSO declared structurally via
`lore ac add`, and the two halves state the same contract — where they diverged in
v1 (AC-ACS-7), the structured half is authoritative and the prose was corrected to
match, since the structured half is what `lore verify` and `lore ac list` consume.

**Split, 2026-08-01**: AC-ACS-1 and AC-ACS-4 originally bundled two testable
claims each — one oracle standing in for both a write-side assertion and a
read-side assertion (AC-ACS-1), or both a demotion assertion and a
no-transition assertion (AC-ACS-4). `task-split-the-compound-ac-acs-1-ac-acs-4-into-one-assertion`
narrowed each to its first claim and split the second into a new id (AC-ACS-8,
AC-ACS-9 respectively), each with its own oracle and its own evidence.

**Split, 2026-08-01 (second pass)**: the first split's own acceptance criterion
required exactly one assertion per resulting id, but its Scope text defined one
of its two halves as a conjunction — so the standard the split existed to
enforce did not hold on its own output. AC-ACS-1's remaining claim was still
three assertions behind one oracle (exit status, id preserved, count
preserved), and AC-ACS-9 was still two (resulting status, absence of a log
entry). `task-ac-acs-1-and-ac-acs-9-are-still-compound-after-the-split` narrows
AC-ACS-1 to the exit-status claim and AC-ACS-9 to the resulting-status claim,
splitting the remainder into AC-ACS-10 (id preserved), AC-ACS-11 (count
preserved), and AC-ACS-12 (no status-transition log entry), each with its own
oracle and its own evidence.

- **AC-ACS-1 (HAPPY)**: `lore ac set <spec> AC-X --statement "<new>"` exits 0.
- **AC-ACS-10 (HAPPY)**: after `lore ac set <spec> AC-X --statement "<new>"`,
  the edited criterion's id is unchanged.
- **AC-ACS-11 (HAPPY)**: after `lore ac set <spec> AC-X --statement "<new>"`,
  the spec's declared criterion count is unchanged.
- **AC-ACS-8 (HAPPY)**: after `lore ac set <spec> AC-X --statement "<new>"`, a
  following `lore ac list` prints `<new>` for AC-X.
- **AC-ACS-2 (NEGATIVE)**: `lore ac set <spec> AC-NOPE --statement "x"` exits 4 and
  stderr contains the ids actually declared on that spec.
- **AC-ACS-3 (BOUNDARY)**: `lore ac set <spec> AC-X` with no field flag exits 2,
  stderr names at least `--statement`, and the document's version is unchanged.
- **AC-ACS-4 (STATE)**: run against an `approved` spec, `lore ac set` leaves the doc
  at status `draft`.
- **AC-ACS-9 (STATE)**: run against a `draft` spec, `lore ac set` leaves it
  `draft`.
- **AC-ACS-12 (STATE)**: run against a `draft` spec, `lore ac set` causes
  `lore log <spec>` to record no status-transition entry for the edit.
- **AC-ACS-5 (ERROR)**: `--rubric` against a `mode: script` criterion exits 4, and
  stderr names both `--rubric` and `script`.
- **AC-ACS-6 (REGRESSION)**: after `lore ac set` on one criterion, every OTHER
  criterion on that spec is byte-identical, and every other key of `extra` is
  unchanged (guards the `lore set`-replaces-extra failure mode).
- **AC-ACS-7 (INTEGRITY / D7)**: `bun scripts/check-ac-ref-integrity.ts` exits 0 on
  the repo corpus — every evidence row's `ac_ref` resolves to a criterion still
  declared on its spec — and exits non-zero, naming the offending (task, ac_ref)
  pair, against a throwaway fixture corpus carrying one seeded dangling reference.
  The negative half is what proves the assertion is live; a green run alone is
  indistinguishable from a detector that measures nothing.

## Code anchors

Declared after landing, per CLOSE-phase discipline — not here.


## Acceptance Criteria (structured)

- [·] [script] AC-ACS-1: lore ac set <spec> <id> --statement <new> exits 0
  script: test — bunx vitest run packages/lore/tests/unit/service/ac-set.test.ts -t 'setCriterion returns ok on a valid edit'
  other_command=2
- [⚑] [script] AC-ACS-2: lore ac set against an id absent from extra.acceptance_criteria exits 4 and stderr enumerates the ids that are declared on that spec
  script: test — bunx vitest run packages/lore/tests/unit/service/ac-set.test.ts -t 'unknown id exits 4 naming declared ids'
- [⚑] [script] AC-ACS-6: after lore ac set on one criterion every other criterion on that spec is byte-identical and every other key of extra is unchanged
  script: test — bunx vitest run packages/lore/tests/unit/service/ac-set.test.ts -t 'leaves sibling criteria and other extra keys untouched'
- [⊘] [script] AC-ACS-7: a corpus-wide integrity oracle reports zero dangling ac_ref, so every evidence row's ac_ref resolves to a criterion still declared on its spec, and it exits non-zero on a fixture corpus carrying one dangling reference
  script: lint — bun scripts/check-ac-ref-integrity.ts
  other_command=2
- [⚑] [script] AC-ACS-3: lore ac set with no field flag exits 2, stderr names at least --statement, and the document version is unchanged so no empty write occurred
  script: test — bunx vitest run packages/lore/tests/unit/adapters/cli-ac-set.test.ts -t 'no field flag exits 2'
- [⚑] [script] AC-ACS-4: lore ac set on an approved spec leaves it at status draft
  script: test — bunx vitest run packages/lore/tests/unit/service/ac-set.test.ts -t 'demotes an approved spec to draft'
- [⚑] [script] AC-ACS-5: a field flag the target criterion's mode does not define, such as --rubric against a script criterion, exits 4 with stderr naming both the flag and the criterion's actual mode
  script: test — bunx vitest run packages/lore/tests/unit/service/ac-set.test.ts -t 'mode-inconsistent flag exits 4'
- [·] [script] AC-ACS-8: after lore ac set <spec> <id> --statement <new>, a following lore ac list prints the new text for that id
  script: test — bunx vitest run packages/lore/tests/unit/service/ac-set.test.ts -t 'lore ac list reflects the new statement after set'
- [·] [script] AC-ACS-9: lore ac set on a draft spec leaves it at status draft
  script: test — bunx vitest run packages/lore/tests/unit/service/ac-set.test.ts -t 'draft spec status stays draft after the edit'
- [·] [script] AC-ACS-10: After lore ac set <spec> <id> --statement <new>, the edited criterion's id is unchanged
  script: test — bunx vitest run packages/lore/tests/unit/service/ac-set.test.ts -t 'setCriterion preserves the criterion id'
- [·] [script] AC-ACS-11: After lore ac set <spec> <id> --statement <new>, the spec's declared criterion count is unchanged
  script: test — bunx vitest run packages/lore/tests/unit/service/ac-set.test.ts -t 'setCriterion preserves the criterion count'
- [·] [script] AC-ACS-12: lore ac set on a draft spec causes lore log to record no status-transition entry for the edit
  script: test — bunx vitest run packages/lore/tests/unit/service/ac-set.test.ts -t 'no status-transition entry is recorded for a draft edit'

## Code anchors

- packages/lore/src/service/ac-service.ts
- packages/lore/src/adapters/cli/commands/ac.ts
- scripts/check-ac-ref-integrity.ts
- scripts/check-ac-ref-integrity-core.ts
- packages/core/src/schemas.ts#resolveStatusAfterContractEdit
