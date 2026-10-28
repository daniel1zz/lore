---
id: KN-856
type: knowledge
role: knowledge
title: "Milestone review: Run identity slice 1 — harness-attested runs"
status: approved
priority: medium
created: 2026-10-23
updated: 2026-10-23
tags: []
parent: PLAN-162
links:
  - {id: PLAN-162, type: informs}
---
# Milestone review: FAIL

Fingerprint: e3d96d8656724c447340e1f76b2ab71b90d7da63e77912eefafa5a714d380538
Diff: unavailable: every task is archived but none recorded a commit range

| Dimension | Verdict | Reason | Reference |
|---|---|---|---|
| correctness_vs_acs | fail | 17 of 18 ACs have a trusted (attested) pass as their latest run. AC-RID-17 does not. In the verify task, AC-RID-17 passed once, but its most recent attested run is '[attested] test fail' on the same command. So the shipped-text purge is red on the tree as it stands now. Three other exit-criterion items rest only on the team's own word, with no trusted runner behind them: the day-0 attribution baseline (`lore status --json / jq .data.harness_run_attribution`), the R6 MCP overhead benchmark (p95 +0.96 ms) and the B2 unattested-subagent count. The other checks passed under a trusted runner: AC-RID-1..16 and 18, `check-drift`, and the rule-confidence check (BR-1027..1045 established; BR-125 and BR-135 not live). There are no milestone decisions awaiting this review. There is no landed diff, so this verdict rests on the evidence entries alone. | Verify task evidence: latest AC-RID-17 entry is '[attested] test fail'. Plan exit criterion: 'Every AC-RID-1..18 has an attested pass via lore verify'. |
| spec_conformance | fail | The spec's scope includes 'removal of shipped identity-setting instructions'. AC-RID-17 checks exactly that, and its latest attested run fails, so the landed tree does not do what the spec says there. Where the work departs from the spec, the departures are written down in the Implementation record: the pre-tool hook fails silently (D7 says it should print one line), `lore_feed` is not attested, and the name source is stored in `audit.details`. Those are documented, so they are not counted against the plan. One inconsistency remains unresolved. The RED tasks expect 'neither flag nor env → claimed null, source null' and 'no row contains the OS user name as author'. Spec D11 keeps the OS-user name tier and requires a non-empty `by`. The documents don't say which of the two the code follows. No diff is available, so this is judged from the documents only. | Spec §Scope 'removal of shipped identity-setting instructions'; spec D11 vs the scenarios in the resolveInvocationIdentity RED task and the write-unattested RED task. |
| regression | pass | The full-suite run on main attributes no failing file to this plan. The plan has no derivable diff, so the listed failures can't be tied to it. Before closing, the plan fixed its own regressions: the LORE_ACTOR deprecation-line fixtures, the 016 migration chain in the sync-push fixture, the AC-LL-10 createApp call sites and the issue-report schema-version scan. Each fix has attested passes. The behaviour most at risk was CLI argument parsing after the `--harness-run` strip (R5) and the existing claim flows. The CLI-entry task's attested runs cover the first, and the claim task covers the second. One thing to watch: `packages/lore/tests/unit/core/issue-report.test.ts` appears in the unattributed failing list. That is the same file this plan fixed for LATEST_SCHEMA_VERSION=16. Per the rules it doesn't count against this plan, but it should be checked. | Full-suite section: 'Failing test files attributed to THIS plan: none'; task-skill-implement-fix-full-suite-regressions-introduced-by evidence. |
| design_necessity | pass | Every technical choice maps to a named external practice:
- D1: run id carried as a per-invocation argv flag (W3C Trace Context propagation).
- D2: deterministic ids derived from the harness's own ids (SPIFFE ID derivation from the workload's identity).
- D3: one stamping chokepoint as a store decorator (GoF Decorator / repository middleware).
- D4/D11: legacy claims compared by name during the transition (expand-contract / Parallel Change).
- D5: composition record of fragment sha256 hashes (SLSA provenance / content-addressed inputs as in Nix).
- D6: one shared claim predicate with stale takeover (Kubernetes Lease holderIdentity / Chubby lock-service leases).
- D7: fail-open registration (graceful degradation per the Google SRE book).
- D8: one deprecation warning per process (Node `process.emitWarning` / Python DeprecationWarning default filter).
- D10: one implementation of the rewrite grammar (DRY / single source of truth).
- D12: the hook never grants permission (principle of least privilege).
- Migration 016 follows SQLite user_version versioning (Rails-style ordered migrations).
- No shell-parser dependency was added, because core must stay browser-safe. | W3C Trace Context; SPIFFE; GoF Decorator; Fowler ParallelChange; SLSA provenance; Kubernetes Lease API; Google SRE book (graceful degradation); Node process.emitWarning; least privilege (Saltzer & Schroeder) |
| snapshot_accuracy | fail | contradicted cited rule(s): BR-1045 (BR-1045 is shown as contradicted: the latest run of a criterion that cites it failed. That matches the latest attested run of AC-RID-17 failing. BR-135 was deprecated on the strength of BR-1045 landing with the purge task, so the document and the code now disagree on BR-1045. Other states are not failures: stale rules (BR-1029, 1032, 1039, 1055) are na, and so are unknown and unverified ones (BR-1030, 1034, 1035, 1037, 1040–1044).) | Cited rule state: 'BR-1045: contradicted'; verify-task AC-RID-17 attested fail. |
| concurrency_safety | pass | Run registration is idempotent with first-wins: two concurrent registrations leave one row, and AC-RID-4 tests this on SQLite and InMemory. Identity is per invocation (argv flag) and per MCP call (`McpCallScope` over a call-scoped App), so concurrent calls share no identity state. Two writers in one session (main run plus subagents) get distinct runs, and AC-RID-12 refuses claims across runs on both the task and the phase paths. SubagentStart losing the race to the first tool call only makes the write unattested, and branch B2 handles that. No diff is available, so I could not confirm that the claim check-then-write sits inside one transaction. This slice did not change that boundary. | Kubernetes Lease / optimistic leases; spec D2, D3, D6; AC-RID-4, AC-RID-12, AC-RID-18. |
| security | pass | D12 removes the permission bypass the spike had: the hook returns `updatedInput` only, permission rules are measured against the rewritten command, and a test pins this. Any `--harness-run` a caller writes is stripped and overwritten on every call the hook sees. A forged id that is not registered is stored as unattested (AC-RID-8). Forgery on paths the hook doesn't see is an accepted risk under the cooperative threat model (U1) and recorded in the ADR. The runs table never stores `transcript_path` or worktree paths. One residual risk: the run id is inserted into a shell command. It is derived from the harness's `session_id`/`agent_id`, which come from the trusted harness payload, but quoting or validating that value could not be confirmed without the diff. | Spec D12, §Cross-cutting Security (STRIDE-lite), ADR U1; OWASP command-injection guidance for the derived-id insertion. |

## Retired ACs

- spec-run-identity-slice-1-harness-attested-runs-attested:AC-RID-13 (superseded by spec-every-write-is-made-by-a-known-party-an-attested-agent-run:AC-HID-4): Claims stored before runs existed are expired once by the schema upgrade and the store refuses a run-less claim (BR-1352; BR-1042 retired) under spec-every-write-is-made-by-a-known-party-an-attested-agent-run; no name-compared legacy path remains (AC-HID-4).
- spec-run-identity-slice-1-harness-attested-runs-attested:AC-RID-6 (superseded by spec-every-write-is-made-by-a-known-party-an-attested-agent-run:AC-HID-5): --by and LORE_ACTOR no longer name a writer at all (spec-every-write-is-made-by-a-known-party-an-attested-agent-run deletes those layers, AC-HID-5); there is nothing left to deprecate.
- spec-run-identity-slice-1-harness-attested-runs-attested:AC-RID-7 (superseded by spec-every-write-is-made-by-a-known-party-an-attested-agent-run:AC-HID-1): An MCP write without harness_run is now refused rather than kept unattested (BR-1351, AC-HID-1, spec-every-write-is-made-by-a-known-party-an-attested-agent-run).
- spec-run-identity-slice-1-harness-attested-runs-attested:AC-RID-8 (superseded by spec-every-write-is-made-by-a-known-party-an-attested-agent-run:AC-HID-1): A write with an unknown or absent run is now refused (exit 4, nothing written) instead of stored unattested (BR-1035 retired, BR-1351, AC-HID-1).
- spec-run-identity-slice-1-harness-attested-runs-attested:AC-RID-12 (superseded by spec-every-write-is-made-by-a-known-party-an-attested-agent-run:AC-HID-3): Every party now has a run, so the 'two unattested parties compared by name' branch is gone; claims compare runs only (BR-1040 modified, AC-HID-3).
- spec-run-identity-slice-1-harness-attested-runs-attested:AC-RID-14 (superseded by spec-every-write-is-made-by-a-known-party-an-attested-agent-run:AC-HID-3): Release by an unattested caller and the legacy release by stored name are gone; only the holding run releases without force (BR-1043 modified, AC-HID-3).
