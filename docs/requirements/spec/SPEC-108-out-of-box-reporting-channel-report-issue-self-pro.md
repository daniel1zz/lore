---
id: SPEC-108
type: spec
role: spec
title: "Out-of-box reporting channel — report-issue self-provisions its upstream config"
status: approved
priority: high
created: 2026-07-29
updated: 2026-07-29
tags: [feedback-loop, distribution-first, dogfood]
parent: PRD-001
links:
  - {id: SPEC-073, type: relates-to}
  - {id: SPEC-099, type: implements}
  - {id: TASK-536, type: resolves}
---
# Out-of-box reporting channel — `report-issue` self-provisions its upstream config

## Overview

SPEC-072 built the upstream reporting channel (`lore report-issue` files a defect into a
configured upstream corpus). SPEC-073 built its promotion surface (gate-denial and
internal-error output append exactly one reporting-hint line). Measured 2026-07-29, the two
compose into a **self-locking loop that makes the whole feedback channel unreachable
out-of-box**:

- SPEC-073's hint is emitted **only when `feedback.upstream` is configured** — deliberately
  "byte-absent when unconfigured" (SPEC-073 §Scope).
- `feedback.upstream` is provisioned by **no initialization path**: `lore init` writes only
  the `project` block, `assets/project/lore-config-template.yaml` contains no `feedback` key
  (verified: `grep -n feedback` → no match; the template's only top-level section is
  `workflow:`), and SPEC-060 lists the `.lore/config.yaml` write surface as explicitly out of
  scope for `lore setup --project`.

Therefore a fresh consumer corpus is **never told the channel exists** (hint suppressed by the
unconfigured state) and **cannot use it if they find it anyway** (`IssueReportService` exits 4
with a message instructing hand-edited YAML containing a `corpus_path` the operator must
discover themselves). The promotion mechanism's trigger condition is exactly the configuration
that nothing ever satisfies.

This spec closes the loop at the layer that owns it: the command self-provisions, and the
unconfigured hint becomes actionable rather than silent. It does NOT alter the SPEC-060 setup
boundary and does NOT implement the `transport: http` seam.

Root cause class: **distribution-first** — a capability that requires configuration no shipped
path provisions does not exist for consumers, regardless of how complete its implementation is.

## Scope

**In**:

- Self-provision path in `lore report-issue`: when `feedback.upstream` is absent, resolve the
  upstream lore repo root from the installed binary (symlink → real path → repo root carrying
  `.lore/lore.db`), verify the candidate's root PRD identity, and write
  `feedback.upstream.{corpus_path,root_prd}` into the consumer's `.lore/config.yaml`.
- Explicit non-TTY approval flag (`--auto-config`) so agent surfaces can provision without a
  prompt; interactive TTY may confirm. Absent the flag on a non-TTY, the command fails LOUD
  with the literal provision command rather than YAML-surgery prose.
- Idempotency + non-destructive write: an already-configured `feedback.upstream` is never
  overwritten; the config write preserves every other key in `.lore/config.yaml`.
- Unresolvable upstream is a LOUD failure (exit 4) naming what could not be resolved — never a
  silently written wrong path.
- SPEC-073 hint change: the unconfigured branch stops being byte-absent and instead emits
  exactly one line pointing at the provision path. The configured branch's wording stays
  byte-identical (SPEC-073 AC-073-1 regression).

**Out**:

- `transport: "http"` (the P2 seam already named in `FeedbackConfigSchema`) — consumers with no
  local lore corpus stay unserved; that is a separate product decision.
- `lore setup` / `lore init` writing `feedback.upstream` (SPEC-060's boundary is unchanged).
- MCP hint injection (SPEC-073 already scoped it out).
- Any change to the upstream-side report ingestion, the per-reporter cap, or version-skew
  checks (SPEC-072 owns those).

## Design

- **One resolver, one writer.** `resolveUpstreamFromInstalledBinary()` returns
  `Result<{corpus_path, root_prd}, LoreError>` — pure resolution + identity verification, no
  IO side effects beyond reads. A separate `provisionFeedbackUpstream()` performs the single
  config write. Both live behind the existing `report-issue-wiring.ts` seam so
  `resolveFeedbackUpstreamCfg` stays the only config-read site.
- **Identity pin, not path trust.** A resolved candidate is accepted only when its
  `.lore/lore.db` opens and its root PRD matches the expected lore root-PRD identity — the same
  `matchRootPrd` check SPEC-072 already applies at file time. A path that merely exists is not
  sufficient.
- **Hint SSOT unchanged.** `buildReportIssueHint(errClass, upstreamConfigured)` keeps its
  single-wording-SSOT role; the unconfigured branch gains a return value instead of `null`.

## Acceptance Criteria

Structured via `lore ac add`.

## Code anchors

Declared after landing (an undeclared path reads as an instant false `file_missing`).


## Acceptance Criteria (structured)

- [✔] [script] AC-OOB-1: Unconfigured consumer, non-TTY, no --auto-config: lore report-issue exits 4 and its stderr contains the literal --auto-config provision command; it contains ZERO occurrences of hand-edit YAML guidance (no 'corpus_path: /path/to' template line)
  script: test — cd packages/lore && bun test tests/integration/report-issue-provision.bun.test.ts -t 'AC-OOB-1'
- [✔] [script] AC-OOB-2: Unconfigured consumer with --auto-config and a resolvable upstream: the command writes feedback.upstream into .lore/config.yaml, the written value parses clean under FeedbackConfigSchema, and the report lands as a draft task in the upstream corpus (exit 0)
  script: test — cd packages/lore && bun test tests/integration/report-issue-provision.bun.test.ts -t 'AC-OOB-2'
- [✔] [script] AC-OOB-3: --auto-config with an UNRESOLVABLE upstream exits 4 naming what could not be resolved, and the consumer .lore/config.yaml is byte-identical to its pre-invocation content (no silently written wrong path)
  script: test — cd packages/lore && bun test tests/integration/report-issue-provision.bun.test.ts -t 'AC-OOB-3'
- [✔] [script] AC-OOB-4: Idempotent and non-destructive: on an ALREADY-configured corpus --auto-config leaves feedback.upstream byte-identical, and on an unconfigured corpus the provisioning write preserves every pre-existing top-level key in .lore/config.yaml
  script: test — cd packages/lore && bun test tests/integration/report-issue-provision.bun.test.ts -t 'AC-OOB-4'
- [✔] [script] AC-OOB-5: Identity pin over path trust: a candidate repo that has a readable .lore/lore.db but whose root PRD does NOT match the expected lore root-PRD identity is REJECTED (exit 4) and no config is written
  script: test — cd packages/lore && bun test tests/integration/report-issue-provision.bun.test.ts -t 'AC-OOB-5'
- [✘] [script] AC-OOB-6: Self-lock broken, both directions: an UNCONFIGURED consumer's gate-denial stderr carries exactly 1 provision-guidance line (pre-change baseline is 0), AND a CONFIGURED consumer's gate-denial stderr stays byte-identical to the SPEC-073 AC-073-1 baseline wording
  script: test — cd packages/lore && bun test tests/unit/adapters/report-issue-hint.bun.test.ts -t 'AC-OOB-6'
- [✔] [script] AC-OOB-7: bun run typecheck exits 0 across all packages
  script: tsc — bun run typecheck
- [✔] [script] AC-OOB-8: Full two-runner suite exits 0: vitest (all test files) and bun test both green, no skipped-as-failure. This is the plan's Exit Criterion promoted to a declared AC so it is attested by the runner rather than self-reported by the closer
  script: test — bun run test

## Code anchors

- packages/lore/src/adapters/cli/report-issue-wiring.ts#resolveUpstreamFromInstalledBinary
- packages/lore/src/adapters/cli/report-issue-wiring.ts#provisionFeedbackUpstream
- packages/lore/src/adapters/cli/report-issue-hint.ts#buildReportIssueHint
- packages/lore/src/adapters/cli/commands/report-issue.ts
