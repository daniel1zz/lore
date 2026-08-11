---
id: TASK-410
type: task
role: plan
title: "lore done accepts an unattested self-reported pass as sufficient to archive: gate the terminal transition on attestation, with one audited escape"
status: archived
priority: high
created: 2026-08-01
updated: 2026-08-01
tags: []
parent: PRD-001
links:
  - {id: ADR-027, type: relates-to}
---
Implements `adr-lore-done-requires-a-runner-attested-pass-the-sixth-false` (accepted
2026-08-01). Read that ADR first — it carries the full rationale and the rejected
alternatives, and the write-side alternative it rejects must NOT be reintroduced here.

## The defect

`TaskWorkflowService`'s `done` precondition (`packages/lore/src/service/task-workflow-service.ts:1254`):

    if (!evidence.some((e) => e.result === "pass")) { /* refuse VALIDATION_ERROR */ }

It consults `result` alone and never `attestation`. `lore done` is the ONLY command that
walks `approved → active → archived`, so a purely self-reported pass — one no runner ever
observed — is today sufficient to drive a task to its irreversible terminal state.

`attestation` is runner-issued ONLY (SPEC-039 §2 D2): `EvidenceInput` structurally `Omit`s
it and `_addEvidenceImpl` rejects the mere presence of the key. So
`attestation === undefined` is an unforgeable "nobody observed this run" — the predicate
this fix needs already exists in the data.

## Required

1. `done` requires ≥1 evidence entry that is BOTH `result === "pass"` AND
   `attestation !== undefined`. Refusal stays `VALIDATION_ERROR` (exit 4), and its message
   MUST name the repair (`lore verify <plan>`, or the escape hatch below) — not merely
   state the rule.
2. **Audited escape hatch** for verification `lore verify` structurally cannot perform
   (`--oracle manual` browser/visual checks; any oracle with no script-mode AC to bind to).
   Shape it on the repo's existing precedent, `lore approve --override-judgment`: an
   explicit flag carrying a MANDATORY free-text reason, written to the audit trail. ⛔ Never
   silent, never defaulted, no env-var form. A flag whose reason is empty/whitespace is
   refused (exit 2).
3. Predicate lives in the SERVICE layer so CLI, MCP, and HTTP are gated identically — ⛔ do
   not implement it in `commands/done.ts`. The escape hatch must be plumbed through the MCP
   surface too, or explicitly and deliberately not be (say which, and why, in the module
   header).
4. **Idempotency must not regress**: an already-`archived` task stays a no-op regardless of
   its attestation set. Today's terminal-doc short-circuit must be evaluated BEFORE the new
   predicate, or replays of past closures break retroactively. This is a REGRESSION test,
   not an afterthought.
5. **Retroactive policy, in this same slice** (standing CLAUDE.md lesson —
   `knowledge-retro-a-newly-built-gate-leaves-every-pre-existing`): this predicate evaluates
   at close time against evidence authored under the old rules, so every not-yet-archived
   task holding only self-reported passes lands in violation the moment it arms. Measure how
   many such tasks exist (`lore list --type task --json`, count open tasks whose
   `verification_evidence` has a `result: "pass"` but no `attestation`) and REPORT the
   number. ⛔ Attestation cannot be back-filled by any public path — that impossibility is
   exactly the property that makes it trustworthy — so a written exemption is the only
   honest disposition. Do NOT attempt to synthesize attestation, and do NOT weaken the
   predicate to accommodate the back-catalog.
6. Update the module header doc comments that state the old rule: `task-workflow-service.ts`
   (~line 99: "Refuses (VALIDATION_ERROR) with no passing (`result: \"pass\"`) evidence") and
   `packages/lore/src/adapters/cli/commands/done.ts` (~line 12, same claim). Leaving them
   contradicting the code is not acceptable.
7. `bun run typecheck` clean.

## Oracle

Six-dimension coverage. The load-bearing cases:

- HAPPY: task with one attested pass → archives.
- NEGATIVE: task with only a self-reported `result: "pass"` (no `attestation`) → refused
  exit 4, message names the repair.
- NEGATIVE: escape-hatch flag with an empty/whitespace reason → exit 2.
- BOUNDARY: task whose ONLY attested entry is `result: "fail"`, `"expected-fail"`, or
  `"inconclusive"` → refused (none of these is a pass; `inconclusive` and `expected-fail`
  already satisfy neither pass nor fail filter by construction — assert that property holds
  here too).
- STATE: escape hatch used → archives AND writes an audit entry carrying the reason
  verbatim. ⛔ Assert the audit SIDE EFFECT, not merely the exit code — a flag an oracle
  passes but never proves took effect is this repo's measured fifth false-oracle face
  (`knowledge-retro-a-silently-inert-cli-flag-is-the-fifth-false`). Include a control run
  WITHOUT the flag proving the audit entry is absent.
- REGRESSION: already-`archived` task → still an idempotent no-op, with and without
  attestation present (AC-4).
- REGRESSION: the pre-existing refusal for a task with NO evidence at all is unchanged.

## Out of scope

Write-side `lore evidence` behaviour is UNCHANGED — the unfiltered multi-file face still
records cleanly, it simply no longer suffices to archive. The ADR rejects extending the
SPEC-061 tail requirement to unfiltered commands; do not do it here.

## Landing-order hazard, measured while filing this task (2026-08-01)

The escape hatch (AC-2) is load-bearing, not defensive — proven by the very session that
filed this task:

Three ad-hoc tasks were in flight at filing time
(`task-test-changed-cannot-see-the-whole-integration-cli-tier-the`,
`task-key-test-budget-ledger-rows-on-a-test-title-fingerprint`, and this one). All three
are `--adhoc` with **no declared acceptance criteria** — `lore feed task-start` prints
"(no declared acceptance criteria)" for them. `lore verify` therefore has no script-mode AC
to execute against them, so it can issue no `attestation`, so their evidence is
self-reported BY CONSTRUCTION.

Consequence: the moment this predicate arms, `lore done` cannot close any of them without
the escape hatch. That is not a flaw in the decision — an ad-hoc task with no declared AC
genuinely has no attestable oracle — but it means:

- ⛔ Do NOT land this while tasks are in flight whose evidence is already self-reported,
  unless the escape hatch lands in the SAME commit (it must, per AC-2).
- The AC-5 measurement will likely be dominated by ad-hoc, AC-less tasks. Report that
  breakdown separately from tasks that COULD have been attested but weren't — they are
  different findings with different dispositions.
- Worth noting for a FUTURE decision (⛔ out of scope here): whether `--adhoc` tasks should
  be required to declare at least one script-mode AC so they become attestable at all. Do
  not build that here.
