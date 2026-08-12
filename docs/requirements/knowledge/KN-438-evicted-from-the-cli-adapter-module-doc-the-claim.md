---
id: KN-438
type: knowledge
role: knowledge
title: "Evicted from the CLI adapter module doc: the claim/evidence/done bullet"
status: draft
priority: medium
created: 2026-08-12
updated: 2026-08-12
tags: []
parent: PRD-001
---
# Evicted from the CLI adapter module doc: the claim/release/evidence/ready/done bullet

Full text evicted from `packages/lore/src/adapters/cli/CLAUDE.md`'s Subcommands section (2026-08-12, to stay under the module's byte ceiling after the corpus-resolution.ts relocation added a line):

`claim` `release` `evidence` `ready` `done` — task/phase execution workflow (SPEC-025/042/056); target-type dispatch tries `TaskWorkflowService` first, falling back to phase workflow only on a `type: "phase"` validation rejection.

- `done` requires ≥1 RUNNER-ATTESTED `result: "pass"` row (a self-reported `lore evidence` pass no longer suffices; audited escape `--override-attestation "<reason>"`, blank → exit 2), refuses a fresh foreign claim, and walks `VALID_TRANSITIONS` to `archived` one audited step at a time (idempotent no-op on an already-terminal doc).
- `done` ALSO refuses `extra.red_first: true` with no `"expected-fail"`/`"fail"` evidence row, and for every OTHER task refuses a DECLARED `extra.ac_scope` with zero red rows unless `--declare-no-new-tests "<reason>"` is supplied. That floor keys on the declaration's PRESENCE, never the array's length: `--ac-scope ""` ARMS it, an ABSENT key does not.
- `evidence` refuses a self-reported `--result pass` for ANY tail content (empty or hand-authored — task-raise-the-evidence-tail-guard-s-predicate-to-its-own, D5) UNLESS `--capture` (spawns `--command` itself, verifies the real exit code) was used, OR `--oracle manual` (the one oracle `--capture` can never reach, which keeps the prior "genuinely non-empty tail" floor as its own proof); every write stamps `capture_source: "runner"|"self-report"`, never omitted, never inferred from the tail's shape.
- `lore status --json`'s `capture_source_runner_count`/`capture_source_self_report_count` (and EVERY OTHER `*_count` field it reports) each have a matching `lore status --enumerate <field>` member-list query (AC-FR-5) — a new `*_count` field with no registered enumerator is refused by name, never silently unactionable.
- `--capture`'s window is `workflow.evidence.capture_timeout_ms` (default 600000 ms), resolved ONLY by `resolveCaptureTimeoutMs` — never a module constant; BOTH CLI and MCP resolve it per invocation. Exceeding it is a FAILED capture (loud exit-4 refusal naming window+elapsed+knob, NOTHING recorded), never a silent downgrade to `self-report`; timeout is MEASURED (`ETIMEDOUT` OR monotonic elapsed ≥ window), never inferred from `status === null`.
