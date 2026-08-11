---
id: ADR-027
type: adr
role: decision
title: "lore done requires a runner-attested pass: the sixth false-oracle face closes on the read side, not on lore evidence"
status: approved
priority: high
created: 2026-08-01
updated: 2026-08-01
tags: []
parent: PRD-001
links:
  - {id: ADR-020, type: relates-to}
---
## Context

`lore evidence` has two write-side prechecks that refuse an unproven pass:

1. **Missing-oracle-file** — `--oracle test|e2e --result pass` whose `--command` names a
   test file that exists nowhere plausible is refused (exit 4).
2. **Filtered-pass matched-count guard** (SPEC-061, `adr-lore-evidence-proves-a-filtered-pass-with-the-runner-s-own`)
   — a `--result pass` whose `--command` carries a `-t` case filter must supply an
   `--output-tail` containing the runner's own summary line with a nonzero matched count.
   Its own header states the boundary explicitly: *"UNFILTERED commands are completely
   unaffected."*

That boundary is the sixth false-oracle face, measured 2026-08-01 during the CLAUDE.md
mechanized-eviction sweep: an **unfiltered multi-file** `--oracle test --result pass` is
accepted with no proof that any file ran. Example that records cleanly today:

    lore evidence <task> --oracle test \
      --command "bunx vitest run a.test.ts b.test.ts" --result pass

Both files exist (precheck 1 satisfied), no `-t` filter (precheck 2 does not fire), and
nothing anywhere establishes that the command was ever executed.

### What was already true before this decision

The attested/self-reported distinction is ALREADY first-class in the data model, and this
was verified rather than assumed:

- `EvidenceEntry.attestation` is **runner-issued ONLY** (SPEC-039 §2 D2, anti-spoofing).
  `EvidenceInput` — the type every CLI/MCP write path uses — structurally `Omit`s it, and
  `_addEvidenceImpl` additionally rejects the mere PRESENCE of an `attestation` key with
  `VALIDATION_ERROR` ("attestation is runner-issued; use lore verify"). A self-report
  cannot forge attestation.
- `computeAcCoverage` (`packages/core/src/acceptance.ts`) already reports
  `attested_pass` / `attested_fail` distinctly.
- `attestation.completeness` already encodes zero-match / under-match / `unknown_runner`.

So `attestation === undefined` already means, unambiguously and unforgeably, "nobody
observed this run".

### Where the gap actually bites

`TaskWorkflowService`'s `done` precondition (`task-workflow-service.ts:1254`):

    if (!evidence.some((e) => e.result === "pass")) { /* refuse */ }

It reads `result` alone and never consults `attestation`. `lore done` is the sole command
that walks `approved → active → archived`. Therefore a purely self-reported pass — one no
runner ever observed — is today sufficient to drive a task to its **irreversible terminal
state**. That is the load-bearing consequence of the sixth face, and it is a read-side
defect, not a write-side one.

## Decision

**Close the sixth false-oracle face on the READ side, at `lore done`, not on the write side
at `lore evidence`.**

`lore done` requires at least one evidence entry that is BOTH `result: "pass"` AND carries
`attestation` (i.e. runner-issued). A task holding only self-reported passes is refused.

A single **audited escape hatch** accompanies it, for verification that `lore verify`
structurally cannot perform (`--oracle manual` browser/visual checks, and any oracle with
no script-mode AC to bind to). It mirrors the shape this repo already uses for
`lore approve --override-judgment`: an explicit flag carrying a mandatory free-text
reason, written to the audit trail. It is never silent and never defaulted.

## Rationale

- **`lore evidence` is BY CONSTRUCTION a self-report ledger.** `attestation` is excluded
  from its input type on purpose. Stacking further refusals onto it makes it a degraded
  copy of `lore verify` while still attesting nothing — the tail it would demand is
  pasteable text. This is the same objection the SPEC-061 header already records against a
  `--matched <n>` flag: *"a bare integer is as fabricable as the false `pass` it would
  gate."* An `--output-tail` for an unfiltered command is that objection one step weaker,
  not stronger.
- **The asymmetry with SPEC-061 is real, not an inconsistency.** A zero-match `-t` filter
  *actively misleads*: it exits 0 with every case reported `skipped`. The exit code itself
  lies. An unfiltered command has no such property — if it ran, its exit code means what
  it says. The defect is solely that nothing establishes it ran, which is a question about
  provenance, and provenance already has a home: `attestation`.
- **Gate the transition, not the note-taking.** Recording a self-report is legitimate and
  useful (RED-phase runs, manual checks, intermediate observations). Converting a
  self-report into an irreversible lifecycle claim is the moment that must demand proof.
  `done` is the only such moment.
- **Root cause, not symptom.** The write-side option treats "an unproven pass was
  recorded" as the fault. The actual fault is "an unproven pass was ACCEPTED AS
  SUFFICIENT". Fixing the acceptor fixes every current and future path into it, including
  MCP and HTTP, because the predicate lives in the service layer.

## Consequences

- **Every task now needs at least one runner-attested pass to be archived.** In practice
  that means `lore verify` (plan-bound script-mode ACs, or the SPEC-069 ad-hoc-task runner
  path) becomes mandatory on the happy path rather than merely preferred. Agents that
  close tasks with `lore evidence` alone will start seeing exit 4 — a deliberate,
  discoverable break, with the repair named in the refusal message.
- The escape hatch must be **audited and rare**. If it becomes the common path the
  decision has failed; that is measurable (count its audit entries).
- `lore done` is idempotent on an already-terminal doc — that must not regress: an
  already-`archived` task must stay a no-op regardless of its attestation set, or the new
  predicate would retroactively break replays of past closures.
- **This gate is retroactive by nature.** Per the standing CLAUDE.md lesson, a newly armed
  deterministic predicate evaluates at close time against data authored under the old
  rules, so every not-yet-archived task holding only self-reported passes lands in
  violation the moment it arms. The one-time sweep AND an explicit retroactive policy
  belong in the same slice as the predicate — prefer a written exemption over
  synthesizing attestation, which is impossible here anyway (attestation cannot be
  back-filled by any public path, which is exactly the property that makes it trustworthy).
- Write-side `lore evidence` behaviour is UNCHANGED. The unfiltered face still records
  cleanly; it simply no longer suffices to archive.

## Alternatives rejected

- **Extend the SPEC-061 tail requirement to unfiltered `test|e2e` passes.** Symmetric, but
  adds friction to every evidence call while attesting nothing (see Rationale). Would also
  leave the `done` acceptor unfixed — a self-reported pass with a hand-pasted tail would
  still archive a task.
- **Both sides.** The write-side half becomes largely redundant once `done` demands
  attestation, at the cost of doubled friction.
- **Document-only ("this is a boundary, not a defect").** Defensible for the write surface,
  but it cannot explain `done` accepting an unattested pass as sufficient proof of
  completion. A defect already covered by prose is proof the prose layer is the wrong
  layer.
