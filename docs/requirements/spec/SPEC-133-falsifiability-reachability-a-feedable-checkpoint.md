---
id: SPEC-133
type: spec
role: spec
title: "Falsifiability reachability: a feedable checkpoint, an attestable red, a guard that means what it says, and a mirror whose drift trips"
status: approved
priority: medium
created: 2026-08-10
updated: 2026-08-11
tags: []
parent: PRD-001
---
## Overview/Goal

Four governance-tooling gaps share one root: **a surface that looks sound is accepted as sound,
because the thing that would falsify it is either unreachable, unproduced, or unenforced.** Each was
measured while resuming handoff-84 on 2026-08-10, and each was logged because an EXTRA ACTION was
required to work around it.

- **G1 — three of four deterministic gates cannot be fed proactively.** The discipline says pull the
  feeding pack BEFORE producing. `lore feed spec-promote` answers `unknown checkpoint`. Only
  `spec-create` of the four gates is feedable, so for 75% of them the prescribed discipline is
  reachable only by being denied first. `lore feed spec-create` returns a full sourced pack, so the
  mechanism works — the checkpoint set was simply never reconciled against `checkpointRegistry`.
- **G2 — attestation is structurally one-sided.** `lore verify` attests by running an AC's declared
  command against the CHECKED-IN tree. A red requires the tree to be temporarily BROKEN, so no
  attested `expected-fail` can ever be produced. Measured consequence: `lore assess` reported
  `attested_fail = 0` on every AC of two separate plans and cut `evidence_integrity` accordingly,
  while the standing rule "every oracle needs one measured red" is enforced by self-report alone.
  The corpus's strongest evidence tier covers only the half of falsifiability that proves nothing
  on its own.
- **G4 — the tail guard's message states a stronger invariant than its predicate enforces.**
  `lore evidence` refuses a self-reported `pass` with an EMPTY tail and its error text says "a
  hand-authored summary is not proof the command actually ran". The predicate is `tail.length > 0`.
  Measured 2 of 3 dispatched agents satisfied it with a hand-written summary; both rows PASSED the
  guard, so the check endorsed them. A guard whose message overstates its predicate is worse than
  no guard: a pass reads as confirmation of the stronger property.
- **G5 — the exported spec mirror has silently drifted.** Root CLAUDE.md tells readers the mirrors
  live under `docs/requirements/spec/`. That directory holds far fewer files than the corpus holds
  specs, and root `package.json` has no export script, so nothing regenerates it and nothing detects
  the divergence.

- **G6 — a passing gate leaves no trace anywhere.** Promoting a spec to `approved` prints ZERO gate
  output and writes ZERO gate entries to the audit trail; the only way to establish that
  `spec-promote` evaluated at all is to read `corpus-service.ts`. A passing gate, a vacuously
  passing gate, and an absent gate are indistinguishable at every surface a user or auditor can
  reach. `spec-governance-visibility` fixed exactly this for `plan-close` and for that checkpoint
  only — the other three deterministic gates remain silent.

**Goal**: make each of the five falsifiable by construction — a checkpoint that is feedable because
its list is derived, a red that can be attested because its falsifier is declared, a guard whose
predicate matches its own message, a mirror whose drift trips a gate, and a gate whose evaluation
leaves a trace an auditor can query.

## Scope

**In scope**
- `lore feed`'s accepted checkpoint set, derived from `checkpointRegistry` rather than a parallel list.
- A declared-falsifier mechanism for script-mode ACs, and the runner path that applies it in an
  isolated worktree to produce an attested `expected-fail`.
- `lore evidence`'s tail guard predicate, and `capture_source` visibility in `lore assess` /
  `lore status`.
- A spec-mirror export script and the drift check that consumes it.
- A queryable evaluation trace for EVERY deterministic gate checkpoint, not just `plan-close`.

**Out of scope**
- Clearing the existing `pass_unfalsified` backlog. That work is `plan-land-oracle-executability`'s
  `backlog-and-arm` phase and is BLOCKED ON G2 landing here — clearing it beforehand would mint a
  self-reported red per criterion, which is exactly the evidence tier this spec exists to raise.
- Arming any threshold gate on the resulting counts.
- Re-authoring the ACs that `lore assess` flagged as one-sided on other plans.

## Design Decisions

**D1 — `lore feed` derives its checkpoint set from the registry.** A newly registered checkpoint is
feedable by construction. ⛔ Never a second hand-maintained list; that is the dual-write defect that
produced G1.

**D2 — a falsifier is DECLARED on the AC, not described in prose.** A script-mode AC may carry a
`falsifier`: a named mutation (file + edit, or a patch) that MUST make its command fail. This forces
the AC author to state the failure mode explicitly at authoring time, when it is cheapest, instead
of leaving it to a sentence nobody re-runs.

**D3 — attested reds run in an isolated worktree, never the working tree.** The runner applies the
falsifier in a scratch worktree, runs the command there, asserts the exit code, and discards it. ⛔ A
mutation applied to the working tree is unacceptable regardless of how carefully it is reverted: a
crash mid-run would leave the tree broken, and this repo's own history contains a "restoration never
reads the backup" defect of exactly that shape.

**D4 — an attested red asserts an EXACT exit code and an output condition, never "non-zero".** A tool
that dies before the check runs also exits non-zero and has no discriminating power. This is the
repo's most-repeated false-oracle vector.

**D5 — the tail guard's predicate is raised to match its own message; the message is never weakened
to match the predicate.** The observable property (`non-empty`) is replaced by the mechanism
(`capture_source: runner`), with self-report remaining available only under an explicit, recorded
justification.

**D6 — the mirror export is idempotent and the drift check is separate from it.** A check that
regenerates what it is checking cannot fail. ⛔ The two must be separate commands.

**D7 — a gate's evaluation trace is written by the enforcer, not by each call site.** Per-call-site
tracing is how `plan-close` ended up the only traced checkpoint. ⛔ The trace must be emitted where
the verdict is produced, so a newly registered checkpoint is traced by construction — the same
derivation principle as D1.

## Acceptance Criteria

Declared as structured ACs via `lore ac add`. Every one asserts a LIVE call site or a user-reachable
surface, never that an implementation exists — three separate instances of that false-green were
measured in the session preceding this spec.


## Acceptance Criteria (structured)

- [✔] [script] AC-FR-1: LIVE SURFACE (G1): for EVERY checkpoint registered in checkpointRegistry, a real `lore feed <checkpoint>` invocation exits EXACTLY 0 and emits a non-empty rule slice naming its source — asserted by enumerating the registry AT TEST TIME and driving the CLI once per entry, never against a hand-listed set. AND: an UNREGISTERED checkpoint name exits EXACTLY 2 (matching the arity errors phase-start/task-start already return), never 0. RED (both required): (a) replace the derivation with a parallel hand-maintained list and the test must fail naming the checkpoint that became unreachable; (b) restore the silent-success path and the unregistered-name case must fail. Measured baseline 2026-08-10 on the merged tree: spec-promote / plan-promote / task-claim each print 'unknown checkpoint: <name>' AND EXIT 0 — so a script running `lore feed spec-promote && <next>` proceeds as though it had been fed. That silent-zero is the sharper half of this criterion.
  script: test — bunx vitest run packages/lore/tests/unit/adapters/feed-checkpoint-coverage.test.ts -t derived-from-registry
- [✔] [script] AC-FR-2: LIVE SURFACE (G2): an AC carrying a declared falsifier can be driven to an ATTESTED red — a real `lore verify` invocation applies the falsifier, runs the AC command, and records an expected-fail row whose capture_source is 'runner', not 'self-report'. The recorded row's exit code MUST equal the exact value the falsifier declares, and its output MUST contain a token naming what failed. RED: strip the falsifier from the AC and verify must record NOTHING rather than a passing red; declare an exit code the mutation does not actually produce and the run must fail loudly instead of recording. Baseline 2026-08-10: attested_fail=0 on every AC of three separate plans.
  script: test — bunx vitest run packages/lore/tests/unit/service/attested-red.test.ts -t falsifier-produces-attested-fail
- [✔] [script] AC-FR-3: ISOLATION (G2/D3): after a falsifier run — including one that CRASHES mid-run — the working tree is byte-identical to its pre-run state, proven by comparing a content hash of every path the falsifier touches, taken before and after, plus `git status --porcelain` being empty. The mutation MUST be applied in a scratch worktree, never in the working tree. RED: apply the falsifier in-place with a finally-block revert, then kill the process mid-run; the hash comparison must fail. ⛔ A revert that only restores from an in-memory copy does NOT satisfy this — this repo already shipped one such backup that was never read back.
  script: test — bunx vitest run packages/lore/tests/unit/service/attested-red.test.ts -t working-tree-untouched
- [✔] [script] AC-FR-4: GUARD PREDICATE (G4): a real `lore evidence --result pass` with a NON-EMPTY but hand-authored tail and capture_source 'self-report' is REFUSED at exactly the same exit code the empty-tail case already returns, and the refusal names --capture. The same call with --capture SUCCEEDS. ⛔ Asserted by driving the CLI, never the service. RED (both directions required): (a) supply a non-empty hand-written tail and the call must be refused — today it is ACCEPTED, which is the defect; (b) supply --capture and it must NOT be refused, proving the guard did not simply become a blanket denial. Baseline 2026-08-10: 2 of 3 dispatched agents passed this guard with a hand-written summary.
  script: test — bunx vitest run packages/lore/tests/unit/adapters/evidence-tail-guard.test.ts -t predicate-matches-message
- [✔] [script] AC-FR-5: VISIBILITY (G4 + the count-without-members gap): EVERY corpus-wide count `lore status --json` reports has a sibling that ENUMERATES its members — asserted generically: the test reads the set of count-suffixed fields from a real `lore status --json` and, for EACH one, drives a real enumeration call and asserts the returned member count EQUALS the reported number. This MUST cover at minimum pass_unfalsified_count, unredeemed_allow_missing_path_count, and a new capture_source distribution (runner vs self-report). `lore assess` reports the capture_source ratio alongside the attested ratio it already prints. RED (both required): (a) seed a corpus with one runner row and one self-report row and assert BOTH counts are non-zero and correct — a projection hardcoding zero self-reports would otherwise pass; (b) add a new count field WITHOUT an enumerator and the test must fail naming that field, so the contract binds future counts too. ⛔ Measured 2026-08-10: producing the member list behind pass_unfalsified_count=29 required a throwaway script iterating all 138 specs, because no enumerator exists.
  script: test — bunx vitest run packages/lore/tests/unit/adapters/capture-source-visibility.test.ts -t distribution-reported
- [✔] [script] AC-FR-6: MIRROR PARITY (G5): root package.json's script chain contains the spec-mirror export script — proving it is WIRED, not merely present — and after running it, the count of files under docs/requirements/spec/ EQUALS the corpus spec count read from `lore list --type spec --json`, with every corpus spec slug present as a file. ⛔ Asserted against the LIVE corpus count, never a literal typed into the test. RED (both required): (a) remove the script from the chain and this must fail; (b) delete one exported file after export and the parity assertion must fail naming that slug. Baseline 2026-08-10: the mirror held 100 files against 141 corpus specs and no export script existed.
  script: test — bunx vitest run scripts/tests/spec-mirror-export.test.ts -t export-covers-corpus
- [✔] [script] AC-FR-7: DRIFT DETECTION (G5/D6): the drift check and the export are SEPARATE commands — the check MUST NOT regenerate what it inspects. With one mirror file deleted, the check exits EXACTLY the documented non-zero code and its output NAMES the missing slug; run twice in a row it reports the same drift both times (proving it did not silently repair). ⛔ Asserting merely 'non-zero' is unacceptable: a check that crashes before inspecting anything also exits non-zero and has zero discriminating power. RED: make the check call the exporter first and the second run must then report clean — that must fail this AC.
  script: test — bunx vitest run scripts/tests/spec-mirror-export.test.ts -t drift-check-is-separate
- [✔] [script] AC-FR-8: AUDITABILITY: for EVERY deterministic gate checkpoint, a PASSING evaluation leaves a queryable audit entry naming the checkpoint and its verdict, so a pass is distinguishable from a gate that never ran. Asserted by driving the real write path for each checkpoint and then querying `lore audit <doc> --json`, never by reading source. RED (both required): (a) suppress the trace for one checkpoint and the test must fail naming it; (b) assert the trace exists for a doc whose gate was DISABLED via config and it must fail — proving the test distinguishes evaluated-and-passed from not-evaluated. ⛔ Measured 2026-08-10: promoting a spec to approved printed ZERO gate output AND left ZERO gate entries in lore audit (11 entries, all create/update) — the only way to establish spec-promote had evaluated was reading corpus-service.ts. spec-governance-visibility's AC-GV-1/AC-GV-6 fixed this for plan-close ONLY.
  script: test — bunx vitest run packages/lore/tests/unit/service/gate-evaluation-trace.test.ts -t every-checkpoint-leaves-a-trace
- [✔] [script] AC-FR-9: SUGGESTED-COMMAND INTEGRITY: every pasteable command a lore error message emits must actually resolve — each named subcommand exists and each named flag is accepted by THAT subcommand. Asserted by scanning the source for command-shaped strings inside error/refusal messages and, for each, driving the real CLI's --help (or a dry parse) to confirm every flag is recognised. RED (both required): (a) point a message at a flag its subcommand does not accept and the test must fail naming the message's file:line; (b) point it at a flag that IS accepted and the test must pass, proving the scanner is not just always-failing. ⛔ Measured 2026-08-10, in the SAME session and the SAME code that fixed G4: verify-runner-service.ts:1472 tells the user to run 'lore ac add/set <spec> <id> --falsifier-path ...', but 'ac set' does not accept any --falsifier-* flag (its --help mentions falsifier 0 times vs ac add's 4) and the call exits 2 with 'Unknown option: --falsifier-path'. This passed every AC, was attested, and was archived, because nothing asserted that a message's own instructions are executable. It is G4's exact shape — a message promising more than the implementation delivers — recurring within hours of G4 being closed.
  script: test — bunx vitest run scripts/tests/error-message-commands-executable.test.ts -t suggested-commands-resolve
- [✔] [script] AC-FR-10: FULL-CORPUS MIRROR INTEGRITY, asserted against THIS repo's PRODUCTION corpus (never a seeded fixture): (a) for EVERY exported doc type, the mirror file count EQUALS that type's live corpus count read from `lore list --type <t> --json`; (b) every mirror file's frontmatter `id:` is BYTE-IDENTICAL to its filename's leading identifier — zero-padded to 3 digits (SPEC-021, not SPEC-21); (c) the migration-coverage eval over docs/requirements reports links_broken === 0. RED (all three required): (a) delete one exported file of any type -> fails naming the type and slug; (b) rewrite one file's frontmatter id to the non-padded form -> fails naming that file; (c) point one cross-type reference at a non-existent id -> links_broken becomes non-zero and the test fails. ⛔ Measured 2026-08-10 on the merged tree: export-index.json stores human_id 'SPEC-21' while its own file_path says 'SPEC-021' — the inconsistency lives in the SSOT itself; 89 of 142 spec mirrors had filename-vs-id mismatch, producing 88 broken cross-type references (plan 73 / knowledge 14 / adr 1) and turning the full suite red at 1 failed / 493 passed. Non-spec mirrors were also stale: adr 12/30, knowledge 168/399, plan 75/120, task 316/644. ⛔ Zero-padding is the chosen canonical form (user decision 2026-08-10): filenames already use it and it makes lexical order match numeric order.
  script: test — bunx vitest run scripts/tests/spec-mirror-export.test.ts -t all-types-parity-and-id-format
