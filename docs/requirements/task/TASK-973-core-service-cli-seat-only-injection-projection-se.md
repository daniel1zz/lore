---
id: TASK-973
type: task
role: plan
title: "Core + service + CLI: seat-only injection projection, seatClaims by branch or path, empty print, knob retirement"
status: archived
priority: medium
phase: "core-service-cli"
created: 2026-10-11
updated: 2026-10-12
tags: []
parent: PLAN-157
plan: PLAN-157
links:
  - {id: TASK-976, type: blocks}
---
Covers: AC-SI-1, 2, 4, 6, 8, 9, 10, 11. Spec: spec-session-start-injection-carries-only-the-session-s-own D1-D5, D8-D12. buildBootstrapInjection(input{report, seat{branch, worktree, planResolved, claims}|null}, budgets{charBudget}) -> {payload|null, json|''}; trigger predicate exactly as the spec's Public Interface; BOOTSTRAP_INJECTED_KEYS closed allowlist (D4 reverses SPEC-080 D8). D8 split: retire BOOTSTRAP_INJECTION_KNOWN_KEYS; BOOTSTRAP_CORPUS_GLOBAL_KEYS (pull-only fields incl. strategy) and BOOTSTRAP_RESUME_CLOSURE_KEYS (= that set + resume_hint + my_claims) — RESUME_SCOPE_CLOSURE derives from the latter; DELETE context-provenance-compiled's 'FEED text names every key except resume_hint' assertion (lines ~398-420): D7 drops the field enumeration from the feed rule, so it is retired, not rewritten (D10). Rewrite BOOTSTRAP_SCOPE_DECLARATION / BOOTSTRAP_FRAMING_LINE content per the spec's required clauses (AC-SI-1(g) asserts content). SessionService.seatClaims(seat: BootstrapSeatSignal) read-only with an injected realpath port (constructor dep, default fs.realpathSync.native): claim.worktree equals seat.branch, or is an ABSOLUTE path resolving to the same dir as seat.worktree; ENOENT -> explicit path.resolve fallback; non-absolute claim compared as branch only; empty matches nothing; excludes archived/deprecated; stale by claimTtlMinutes; sorted claimed_at asc (D11/D12). bootstrap.ts --injection: consult the EXISTING --seat-worktree (no process.cwd() default in --injection mode; either seat flag without the other -> exit 2); prints NOTHING (exit 0) when payload null. config: max_active_plans/max_handoffs/max_pending_slugs become optional with no default, one stderr deprecation line per SET key, once per process; char_budget kept, never slices. NEW tests only in the new files; DELETE retired assertions from the seven old files, add nothing, no .skip/.todo (D10, AC-SI-11); mcp-session-tools.test.ts gets a rename-only edit. Full report (lore bootstrap --json, MCP lore_bootstrap) byte-identical. Red-first, expected-fail evidence at the red run.
