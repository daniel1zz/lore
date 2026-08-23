---
id: PLAN-138
type: plan
role: plan
title: "Land the GitHub-intake defect channel: runner, cap removal, intake, migration, transport removal, projection"
status: draft
priority: critical
created: 2026-08-23
updated: 2026-08-23
tags: [defect-channel, github, intake, migration]
parent: SPEC-145
phases:
  - {name: "P0: Runner + error taxonomy", description: "GhRunner as the single gh subprocess seam (execFile + argv array, scrubbed env, gh api JSON only, explicit maxBuffer); three error codes TRANSPORT_UNAVAILABLE/RATE_LIMITED/AUTH_REQUIRED with distinct exit codes; read-only health check in lore setup --check; standalone regression guard that a GitHub close cannot yield a corpus fixed. Key files: service/gh-runner.ts (new), adapters/cli/utils.ts, core/src/errors.ts, commands/setup.ts"}
  - {name: "P1: Cap removal", description: "Delete OPEN_REPORT_CAP, resolveOpenReportCap, countOpenReports, OpenReportCapRefusal, QUOTA_FREEING_RESOLUTIONS, listOpenAdhocDrafts (109 measured references) plus 1214 lines of cap tests. The config key feedback.inbound.open_report_cap becomes .optional() + ignored-with-warning and is NEVER deleted. Single task, never split: a partial deletion leaves a non-compiling tree"}
  - {name: "P2: Intake", description: "frontMatterCodec with redaction (core/src/issue-front-matter.ts); ReceiptLogV2 two-phase intent/outcome on a NEW file path; GitHubIntakePort (verifyTarget/searchDuplicates/fileIssue/listIssues batch) and the IssueReportService rewiring that makes the LIVE filing path go through them. Capability without a live call site is the recorded false-green — each impl AC names its call site"}
  - {name: "P3: Migration", description: "Migrate the 12 filed reports: create then PATCH (state cannot be set at creation), concurrency 4. Corpus records KEPT, gaining extra.issue_report.github={repo,number} and a migration-time-minted extra.issue_report.idempotency_key. Dry-run mode exercised first"}
  - {name: "P4: Transport removal", description: "Delete flows/upstream-context-flow.ts, flows/upstream-probe.ts, toWriteContentionError. Transport-selection keys (feedback.upstream.corpus_path, the unimplemented transport seam) become .optional()-and-ignored — NO config key is deleted. Irreversible for the module deletion; gated on P0-P3 all verified"}
  - {name: "P5: Projection + reads", description: "ResolutionProjector invoked from lore issue resolve (a live call site, not a zero-caller capability); lore issues --verify drift detector diffing corpus-derived resolution against the label; read-side --severity/--category filters over cached front matter"}
  - {name: "P6: Verification", description: "Full suite on main after all merges (both runners); lore verify for every script AC; spec code anchors declared post-landing and lore status --check-drift exit 0; lore assess"}
---
# Overview

Execute `spec-the-defect-channel-reaches-no-machine-but-its-own-github` (v31, approved, 14 structured ACs) across the six phases the spec declares, plus a final verification phase. The spec's governing decision record is `adr-a-tracker-is-replaceable-a-corpus-is-not-github-is-the`.

Goal in one line: a consumer on any machine can file a lore defect, because intake moves to GitHub issues, while the corpus keeps authority over resolution.

**Governance Mode**: `unattended` — the user instructed "继续，全部做完再找我" (proceed, finish everything, then come back). Phase gates auto-proceed. Invariant violations hard-block regardless of mode.

# Invariants

Verified at every Phase Gate. A violation blocks the phase even in unattended mode.

1. **Full-repo typecheck is exit 0.** Not scoped, not cached. P1 deletes 109 references across six source files; a partial deletion leaves a tree that cannot typecheck, and a worktree that cannot typecheck cannot produce evidence.
2. **No AC discharges via a skipped or absent test.** A skipped test that reports green is a vacuous pass. Every AC's oracle must run unconditionally — no env-var gating, no `.skip`, no "0 tests found" passing.
3. **Every new capability has a live production call site in the same phase.** Adding a module whose only caller is its own unit test is the recorded four-times-measured false-green of this repo. Each implement task's AC names the call site, and the phase gate checks it.
4. **No config key is ever deleted — only `.optional()`-ised with a warning.** `FeedbackConfigSchema` is `.strict()` at three levels and `.lore/config.yaml` is gitignored, so a deleted key breaks a whole machine's command surface with no rollback path.
5. **No test issue is ever filed into `daniel1zz/lore`.** That is the product's own tracker. The reachability e2e targets a dedicated repo (see Decisions Log D-3).
6. **`resolution` stays a corpus-computed value.** No code path may read a GitHub label or `state_reason` as the authoritative resolution. The label is a write-only projection.

# Risk Register

| # | Risk | Impact | Mitigation | Owner |
|---|---|---|---|---|
| PR-1 | A concurrent session is committing to this repo continuously (HEAD moved 3a198904 → 3f04061a mid-session, all SPEC-143 work). Worktrees branch from dispatch-time HEAD, so a wave merged 20 minutes later rebases onto a moved main | HIGH | `git pull --rebase origin main` before **each** wave, never once per plan; merge each returning branch immediately rather than batching; re-check `lore ready --json` per task at dispatch rather than from a wave-start snapshot | orchestrator |
| PR-2 | P1 deletes 109 references across 6 source files plus 3 test files (1214 lines). A partial deletion leaves a non-compiling tree | HIGH | P1 is ONE task, never split. Its AC runs a full-repo typecheck, not a scoped one | T7 |
| PR-3 | The reachability e2e files a real issue over the real network. Filing into `daniel1zz/lore` pollutes the product tracker; a `delete_repo` scope is absent from the local token so a test cannot clean up a scratch repo it creates | MEDIUM | One permanent dedicated target repo (D-3). Issues accumulate there and matter to nothing | T13 |
| PR-4 | `bun run test:changed` under-selects for tree-scanning tests and is structurally blind to `.bun.test.ts` via `vitest --changed`. T2 and T7 have exactly that shape | MEDIUM | Those tasks' ACs name the full command explicitly; the main-checkout re-verify after merge uses `--force` to defeat the turbo cache | orchestrator |
| PR-5 | P3's migration is a create-then-PATCH sequence against a live public tracker; a halfway failure leaves public artifacts with no local trace | MEDIUM | Dry-run mode lands and is exercised first; the two-phase receipt from P2 is the reconcile record | T15 |

# Estimation Summary

**[ESTIMATION]** Total: ~24 session-units | P0: 4 | P1: 4 | P2: 9 | P3: 3 | P4: 2 | P5: 5 | P6: 1 | Critical path: ~12 session-units

⚠ Both thresholds the plan skill warns on are exceeded (total > 10, critical path > 6). Recorded rather than hidden. The plan is not split into sub-plans because the six phases are a single irreversible migration sequence with one rollback boundary (P4); splitting it would put the irreversible phase in a different plan from the phases that gate it.

# Critical Path

T1 → T2 → T6 → T7 → T12 → T13 → T14 → T15 → T16 → T17 → T20 → T21 → T22

P0's runner gates everything (T2), P1's cap removal gates every file P2+ touches (T7), and the intake rewiring (T13) gates migration, transport removal and projection. The wide parallelism is in wave 1 only: T1, T3, T5, T8, T10, T18 are anchor-disjoint and logically independent.

# Phase Descriptions

- **P0 Runner + error taxonomy** — `GhRunner` as the single `gh` subprocess seam (execFile with an argv array, scrubbed env, `gh api` JSON only, explicit maxBuffer), three new error codes with distinct exit codes, a read-only health check, and a standalone regression guard locking in that a GitHub close cannot produce a corpus `fixed`.
- **P1 Cap removal** — delete six symbols and 1214 lines of cap tests; the config key becomes `.optional()` + ignored-with-warning and is never deleted.
- **P2 Intake** — `frontMatterCodec` (+ redaction), `ReceiptLogV2` (two-phase, new file path), `GitHubIntakePort` and the `IssueReportService` rewiring that makes the live filing path go through them.
- **P3 Migration** — migrate the 12 filed reports: create then PATCH, concurrency 4, corpus records kept and gaining `github` plus a minted `idempotency_key`.
- **P4 Transport removal** — delete the SQLite transport modules; transport-selection keys become `.optional()`-and-ignored. Irreversible; gated on P0–P3 all verified.
- **P5 Projection + reads** — `ResolutionProjector` invoked from `lore issue resolve`, `lore issues --verify` drift detector, read-side `--severity`/`--category` filters.
- **P6 Verification** — full suite on main after all merges, `lore verify` for every script AC, spec code anchors declared and `--check-drift` clean, `lore assess`.

# Exit Criteria

- All 22 tasks archived, or deprecated with rationale here.
- All 14 spec ACs carry attested pass evidence via `lore verify` (exit code decides; never self-asserted).
- `lore status --check-drift` exit 0 after spec code anchors are declared post-landing.
- `lore assess <plan>` run, findings triaged.
- Both HIGH risks (PR-1, PR-2) either mitigated in fact or accepted here with rationale.

# Task Label Map

⛔ The `T<n>` labels used in Critical Path and the Risk Register are shorthand for THIS table only. A bare label with no mapping is the addressability failure this project's own North Star names ("a bare `AC-OX-6` in a handoff resolves to nothing"), so the mapping is stated rather than implied. Labels are contiguous T1–T22 and match the plan's 22-task count exactly.

| Label | Phase | Task slug |
|---|---|---|
| T1 | P0 | task-skill-test-ghrunner-auth-env-scrub-and-error-taxonomy-red |
| T2 | P0 | task-skill-implement-ghrunner-as-the-single-gh-subprocess-seam |
| T3 | P0 | task-skill-test-setup-check-health-probe-red-scenarios |
| T4 | P0 | task-skill-implement-lore-setup-check-read-only-health-probe |
| T5 | P0 | task-skill-test-regression-guard-a-github-close-cannot-yield-a |
| T6 | P1 | task-skill-test-retired-cap-key-parses-with-a-warning-while |
| T7 | P1 | task-skill-implement-delete-the-six-cap-symbols-and-retire-the |
| T8 | P2 | task-skill-test-front-matter-round-trip-and-identity-redaction |
| T9 | P2 | task-skill-implement-frontmattercodec-with-identity-redaction |
| T10 | P2 | task-skill-test-two-phase-receipt-intent-outcome-pairing-red |
| T11 | P2 | task-skill-implement-receiptlogv2-two-phase-log-on-a-new-path |
| T12 | P2 | task-skill-test-cross-machine-reachability-e2e-against-a |
| T13 | P2 | task-skill-implement-githubintakeport-and-the-live-filing-path |
| T14 | P3 | task-skill-test-migration-integrity-and-dry-run-red-scenarios |
| T15 | P3 | task-skill-implement-migrate-the-12-filed-reports-with-a |
| T16 | P4 | task-skill-test-retired-transport-keys-parse-with-warnings |
| T17 | P4 | task-skill-implement-delete-the-sqlite-transport-modules-retire |
| T18 | P5 | task-skill-test-projector-9-state-round-trip-and-its-live-call |
| T19 | P5 | task-skill-implement-resolutionprojector-invoked-from-lore |
| T20 | P5 | task-skill-test-issues-verify-drift-detection-and-filtered |
| T21 | P5 | task-skill-implement-lore-issues-verify-plus-batched-read-side |
| T22 | P6 | task-skill-test-final-verification-full-suite-attested-ac |

# Decisions Log

- **D-1 Clarification Sprint and Strategy Exploration were discharged from prior user input, not skipped.** The plan skill makes both HARD gates requiring user answers, while the user's standing instruction for this run is "finish everything, then come back". The clarification content exists: seven decisions were locked by the user earlier in this session (SSOT location, general-capability scope, gh-only auth, cap removal, target repo, label scope, migration of the backlog), and on two further questions the user answered "从长远考虑怎么样更好" / "你应该考虑长期而不是眼前" — an explicit delegation to judge by long-term optimality. Strategy selection therefore sits with the orchestrator, recorded as D-2. Flagged rather than silently bypassed.
- **D-2 Strategy: capability-first with a serialized irreversible tail.** Wave 1 builds every anchor-disjoint new module in parallel; the shared-core deletion (P1) runs alone; the rewiring, migration and transport removal serialize behind it. Rejected alternatives: (a) strangler-fig with both transports live indefinitely — the DX and cost reviews both found dual-transport upkeep to be two failure vocabularies for one live path; (b) migration-first — the 12 reports cannot be migrated before the intake port exists.
- **D-3 A dedicated permanent e2e target repo.** AC-GI-1 asserts filing *succeeds*, so its oracle must make a real network call — a fake runner would assert something weaker than the AC's own statement, and an env-gated skip is a vacuous pass (Invariant 2). Filing into `daniel1zz/lore` would pollute the product's tracker, and the local gh token lacks `delete_repo`, so a test cannot clean up a scratch repo it creates. Resolution: one permanent target repo used by nothing else. **This creates a second repo under the user's account and must be reported at the end of the run.**
- **D-4 AC-GI-13 is a standalone regression guard with no implementation pair.** It locks in existing `computeIssueResolution` behaviour before anything moves, which is when a regression guard is worth most. A test task with no paired implement task is intentional here, not an omission.
- **D-5 A task-quality audit returned NEEDS_WORK and its three findings were fixed before dispatch, not after.** (a) The parent PRD's G14 named the rate cap as one of four R-5 safety rails required to be oracle-tested, while this plan deletes it — G14 was amended (PRD v75→v76) and each of the four rails dispositioned in the ADR, rather than leaving the goal and the design in contradiction. (b) The ADR's body restated its own decision status and disagreed with its lifecycle status; the prose copy was removed so `extra.decision_status` is the only store, and the ADR was carried to `approved` before the irreversible P4 can be gated on it. (c) The `T<n>` labels resolved to nothing and the highest label exceeded the task count; the Task Label Map above closes both. A fourth finding — that `frontMatterCodec` had only a behavioural call-site check, so an inline reimplementation inside the intake port would pass every AC while leaving the codec a zero-caller module — was fixed by adding a structural import assertion to T13's AC.
