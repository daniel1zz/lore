---
id: SPEC-073
type: spec
role: spec
title: "report-issue trigger surfaces: error-path hints + vendored discipline stanza"
status: approved
priority: medium
created: 2026-07-24
updated: 2026-10-10
tags: [spec-073, report-issue, feedback-loop, trigger-surfaces]
---
## Overview

SPEC-073 — report-issue trigger surfaces (PRD §20 F2(c)/(d), R-7; owner-promoted 2026-07-24). Two promotion surfaces for the SPEC-072 reporting channel: (c) error-path embedded hints — gate-denial output and CLI internal-error output append exactly one reporting-hint line when (and only when) the consumer corpus has `feedback.upstream` configured; (d) vendored discipline — the `lore setup` asset SSOT gains a standing reporting stanza, kept repo↔installed lockstep by the existing assets-conformance oracle.

## Scope

**In**: hint line appended at exactly two adapter-layer seams — (1) the CLI's LoreError exit path for gate denials (`field` starting `gate:`) and internal errors (STORE_ERROR / unexpected throw), (2) `lore gate <checkpoint>` blocked output; hint wording demands re-verification first ("if after re-checking your own input you still judge this a lore defect → `lore report-issue --title ... --expected ... --actual ...`"); byte-absent when unconfigured, on usage errors (exit 2), and on ordinary VALIDATION_ERRORs that are neither gate denials nor internal; stanza added to the vendored corpus-workflow snippet in `assets/`.
**Out**: MCP hint injection (MCP callers already receive the feeding pack embedded in the error message; a hint there is a follow-up if evidence shows MCP agents miss the channel); any service-layer wiring (hints are presentation — the service error contract stays byte-identical); SessionStart anything (owner-rejected).

## Design

- Hint rendering is ONE pure function `buildReportIssueHint(errClass, upstreamConfigured): string | null` in the CLI adapter (single wording SSOT; gate.ts and the error exit path both call it). Upstream-configured detection reuses `resolveFeedbackUpstreamCfg` (report-issue-wiring.ts) — no second config parse.
- Error-class mapping: `gate` (LoreError.field starts with `gate:`), `internal` (STORE_ERROR or non-LoreError throw). Everything else → null.
- Stanza lives in the `assets/` corpus-workflow snippet (SPEC-046 P0 SSOT); wording mirrors the hint's re-verify-first clause. Conformance = the existing assets-ssot oracle; the spec adds token-presence assertions so parity alone cannot vacuously pass with the stanza missing from BOTH copies.

## Acceptance Criteria

Structured via `lore ac add` (AC-073-1..4), all script-mode.


## Acceptance Criteria (structured)

- [⚑] [script] AC-073-1: Configured consumer (feedback.upstream set): a gate-denial invocation's stderr contains exactly 1 hint line naming lore report-issue with the re-verify-first clause; the same denial in an unconfigured consumer is byte-identical to the pre-SPEC-073 baseline (0 hint lines).
  script: test — cd packages/lore && bun test tests/unit/adapters/report-issue-hint.bun.test.ts -t 'AC-073-1'
- [⚑] [script] AC-073-2: Hint scoping negatives: a usage error (exit 2, unknown flag) and a plain VALIDATION_ERROR (non-gate, e.g. bad status transition) carry 0 hint lines even when feedback.upstream is configured.
  script: test — cd packages/lore && bun test tests/unit/adapters/report-issue-hint.bun.test.ts -t 'AC-073-2'
- [⚑] [script] AC-073-3: Internal-error path: with feedback.upstream configured and a corrupted .lore/lore.db, the failing command's stderr carries exactly 1 hint line; unconfigured carries 0.
  script: test — cd packages/lore && bun test tests/unit/adapters/report-issue-hint.bun.test.ts -t 'AC-073-3'
- [⚑] [script] AC-073-4: Vendored stanza: the assets corpus-workflow snippet SSOT contains the reporting-discipline stanza (token assertions: 'report-issue' + re-verify clause), and the existing assets-conformance oracle passes with the stanza present (parity cannot vacuously pass with it absent from both copies).
  script: test — bunx vitest run packages/lore/tests/unit/assets-conformance.test.ts scripts 2>/dev/null || bunx vitest run -t 'AC-073-4'

## Code anchors

- packages/lore/src/adapters/cli/report-issue-hint.ts#buildReportIssueHint
- packages/lore/src/adapters/cli/loader.ts
- assets/context/corpus-workflow-4-close.md
