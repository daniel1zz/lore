---
id: KN-382
type: knowledge
role: knowledge
title: "Full-system spec compliance audit 2026-07-27 — 85/11/1 verdicts, remediation dispatch, open decisions"
status: archived
priority: medium
created: 2026-07-27
updated: 2026-10-23
tags: []
parent: PRD-001
links:
  - {id: SPEC-090, type: informs}
  - {id: SPEC-002, type: informs}
  - {id: SPEC-004, type: informs}
  - {id: PLAN-114, type: informs}
  - {id: SPEC-100, type: informs}
  - {id: SPEC-101, type: informs}
---
# Full-system spec compliance audit — 2026-07-27

## Method

- Scope: 108 corpus specs → 97 behavioral (10 domain-overview excluded: direction pointers, no behavioral ACs).
- 16 thematic audit agents (evidence-based code inspection, scratch-corpus empirical runs, file:line citations) → 29 fail findings → 16 adversarially verified by independent refuter agents (all high/medium covered): **14 confirmed, 2 refuted**. 13 low-severity findings left unverified (listed below).
- Global oracle baseline: `tsc` clean, vitest full green, `bun test` 1362/1363 — the single failure (AC-072-9 concurrent-report spawn test) re-ran green in isolation; load-induced flake under 16 concurrent audit agents (matches the known "N-way concurrency starves spawn-type tests" lesson).
- `lore status --check-drift`: 66 anchored specs, 0 file/symbol drift. Note: anchor drift checking cannot detect *behavioral* absence — every confirmed gap below sat behind green anchors.
- Cost: 32 agents, ~3.2M subagent tokens, ~30 min wall clock. Full raw result: workflow run `wf_ba4bd73b-e25`.

## Corrected verdict distribution

**85 compliant / 11 partial / 1 violation** (after refutations: spec-workflow-hardening upgraded to compliant — its only finding was stale, `lore done` landed mid-audit at commit 7274ec0).

## Confirmed findings (adversarially verified)

### HIGH — spec-claim-time-actor-identity-guard-zero-evidence-release-advis: entire spec unimplemented
Approved v6 (2026-07-16), no supersession, no child plan, 0/3 ACs landed. No `actorIdentityGuard` predicate (checkpoint-registry.ts registers only upstreamApproved/upstreamHasAcceptanceCriteria/noAnchorOverlap for task-claim), no `workflow.gates."task-claim".actor_identity` config, no zero-evidence release advisory (`warnings[]` absent from release paths). Consequence: os-username identity collisions undetected at claim time; oracle-pass-before-release remains prompt-only discipline. **Action: implementation dispatched (see remediation plan).**

### MEDIUM — spec-corpus-schema §4.3: parent-cycle write-time enforcement broken
Reproduced: `lore link A B --type parent` persists a 2-node parent cycle (`lore tree` renders the repeating chain). Root cause: `detectParentCycle` (sqlite-store.ts:1088) walks only the `links` table, but create-time parent edges write only `docs.parent_id`, invisible to the check; `_linkImpl` then updates parent_id after addLink succeeds. Read paths have seen-set guards (no infinite loop) but the spec-mandated write-time rejection does not fire. **Action: fix dispatched.**

### MEDIUM — spec-prd-as-living-root: unknown MDX component NOT stripped from rendered output
Reproduced: `<ScriptInjection />` survives verbatim in `lore get` stdout; stderr empty. Root cause: OutlineService.resolve records a warning and `continue`s, so the unknown component never enters resolvedComponents; renderResolvedToMarkdown splices only resolvedComponents positions — unknown tag bytes pass through. Spec frames the whitelist as a security validation step. Existing test asserts only the warnings array, not rendered text or CLI stderr. **Action: fix dispatched.**

### MEDIUM — remote/multi-user domain: implemented nowhere, descoped nowhere (DECISION REQUIRED)
- MCP Streamable HTTP transport (spec-mcp-server-adapter §5.2 + spec-http-api-adapter §3.6 POST /mcp): remote-agent MCP access entirely absent.
- spec-auth-agent-credentials: human login flow (RFC 8628 device auth, `lore login/logout/whoami`, credential storage) unimplemented; **rate-limit field is stored but never enforced** — a live instance of the standing lesson "a gate-read field no surface enforces fails SILENT".
- spec-default-no-ai AC-NOAI-7: dashboard cookie surface should default ai=on; HTTP write path has AI off everywhere (safe direction, but AC never superseded).

**Deliberately NOT auto-remediated**: implementing is a product-scale effort (Better-Auth device flow, streamable transport); invalidating would destroy requirements the team may still want. Needs an explicit human decision: schedule implementation plans OR formally descope via spec revision + `lore invalidate` of the dead sections.

### LOW (confirmed)
- DELETE_REQUIRES_CONFIRM exits 4, spec-service-layer-architecture §5.1 says 2 (implementation deliberately follows SPEC-003 grouping; the two specs contradict — spec-text amendment recommended).
- MCP JSON-RPC numeric error codes (-32602/-32409/-32603) never realized; adapter uses in-band `isError` results per MCP SDK convention (spec-text amendment recommended).
- migration-v1: missing `Import N docs? [y/N]` confirmation and type-hierarchy parent inference.

## Refuted findings (not violations)

- AC-WH-3 `lore done`: auditor evidence was stale — implementation landed mid-audit (commit 7274ec0); refuter confirmed the verb exists, is registered, and matches the AC.
- corpus-schema §5 delete version sentinel (version:0): SPEC-006, the dedicated version-history spec formally consuming VersionRecord, permits the sentinel design; deviation is internal-model only.

## Unverified low-severity findings (13, from audit pass; no adversarial check)

auth: `lore agent rotate`, offline 7-day TTL, better-auth stack choice, device-auth page; mcp: SCHEMA_VIOLATION for spec-without-parent; p2: upstreamApproved status set; actor-identity escape-hatch config knob (subsumed by the dispatched implementation); dashboard: `?resolveMdx=true` param, Vite 7 pin; prd: `resolvedComponents` JSON array, Embed not-found text; export: EEXIST collision reread, roundtrip-test goal.

## Systemic diagnosis

The dominant failure mode is not code defects — it is **approved-but-never-implemented specs with no invalidation/descope record**, standing in the corpus as live contracts. `lore status --check-drift` cannot see this class: anchors point at files that exist while the specified behavior does not. This is lore's own memory-hygiene thesis applied to itself. Candidate mechanization: an implementation-coverage probe (per approved spec: has child plan? ACs verified? anchored symbols actually reference the spec's named surface?) surfaced in `lore review --staleness` or `lore audit`.

## Remediation outcome (appended 2026-07-27, post-dispatch)

All three tasks landed on main via isolated-worktree implementers (distinct LORE_ACTOR per agent, claims made from inside each worktree), merged --no-ff, worktrees/branches cleaned:

- **T1** parent-cycle guard — merge c8322f2. Implementer refined the audit's fix direction: a parent_id-only walk regresses store-layer chains built purely via addLink (which never writes docs.parent_id); correct fix is a per-hop UNION — links-table parent edge preferred, docs.parent_id fallback — shared in store-shared.ts (detectParentCycleViaAncestry, depth cap 1000, seen-set guard), applied to SQLiteStore + TursoStore. E2E: link forming cycle → exit 4 LINK_CYCLE.
- **T2** MDX strip — merge bb58cd4. renderResolvedToMarkdown now splices warnings positions too (unknown tags removed); lore get prints resolve warnings to stderr. Failure-first verified (4 new tests red against pre-fix source).
- **T3** actor-identity guard — merge 46f6f2a. All 3 ACs: actorIdentityGuard predicate (gate:task-claim:actor-identity), workflow.gates."task-claim".actor_identity.enabled escape hatch, zero-evidence release advisory (stderr + warnings[] in --json/MCP). Design note: spec's identity_source vocabulary mapped onto existing ActorSource ("os-fallback" = trigger tier); SPEC-071 session tier never trips the guard. Spec anchors declared (5, incl. #actorIdentityGuard symbol); drift check green (67 specs, 0 drift).

Post-merge full suite on main @46f6f2a: typecheck clean; vitest 379 files / 6485 passed (4 skipped); bun test 1418/1418. Tasks closed via `lore done` (evidence-validated walk to archived — dogfooded the new verb).

**Assess** (knowledge-assessment-audit-remediation-2026-07-27-parent-cycle) flagged: all initial evidence self-reported; T2 strip + T3 advisory surfaces lacking direct proof. Closed post-assess by a second witness (main-orchestrator, freshly built dist/lore, throwaway corpus): ScriptInjection absent from stdout + stderr warning verified; zero-evidence release exit 0 + stderr + --json warnings[] verified; full-suite + e2e evidence appended to all three tasks with output tails.

**Follow-ups (open)**:
- InMemoryStore (test double) retains the old links-only cycle walk — out of T1's anchors; align if InMemoryStore-backed service tests ever need this regression class.
- Judge's process recommendations worth mechanizing: mandate output_tail on test evidence; require a non-self-reported (attested/second-witness) oracle for tasks remediating confirmed audit findings; record post-merge full-suite as plan-level close-out evidence; inline external-spec AC texts into task bundles.

## Plan-close postscript (2026-07-28)

First close attempt was DENIED by the plan-close gate: **ATTESTATION_FLOOR_NOT_MET (SPEC-069)** — all 11 initial evidence entries were self-reported (attested ratio 0.00 < 0.5). The gate mechanically caught exactly what the assess judge had flagged as its #1 finding ("the implementing agent is the sole witness to its own fix") — the floor is already mechanized and working as designed.

Recovery path analysis: `lore verify` (the runner-attested path) resolves script-mode ACs solely via the plan's PARENT SPEC. This plan spans three specs and was parented to the root PRD → verify structurally unreachable; and the per-task attested requirement makes single-spec reparenting insufficient for the other two tasks. Closed via the sanctioned PLAN-level exemption (`extra.attestation_exempt` + reason documenting the second-witness e2e + post-merge full-suite evidence).

**Structural lesson**: cross-spec remediation plans are incompatible with the verify attestation pipeline. Next time either (a) one remediation plan per governing spec (keeps verify reachable), or (b) extend `lore verify` to resolve ACs across `implements`-linked specs for multi-spec plans (candidate mechanization). Also: the three actor-identity ACs remain mode-less (legacy style) — arming them as script-mode (declared test files exist) would make that spec verify-reachable for future work.

## Follow-up round outcome (2026-07-28): spec-verify-reachability landed & closed WITHOUT exemption

The three seams became `spec-verify-reachability-plan-promote-early-warning` (5 script ACs), plan deliberately parented UNDER the spec — and its close proved the thesis: `lore verify` ran attested 5/5 against both tasks, attestation floor passed on runner-issued evidence, no exemption. Merges: a2716e0 (T1 mechanisms), eb3029b (T2 advisory live wiring); final full suite vitest 382/6528 + bun 1420/1420 green.

Additional lessons this round (each caught by an end-to-end probe AFTER unit-green):
1. **Writer-without-reader recurred within the fix itself**: T1's `planPromoteReachabilityAdvisory` was unit-tested but had zero production consumers — caught only by a live dist/lore probe (approve under PRD → zero output). Unit-level ACs cannot pin a surfacing requirement; AC-VRW-5 (dist-spawning e2e) was added and T2 wired GateEnforcer → ReviewService → CLI stderr. The audit's own "consumer/end-to-end" standing lesson applies to fixes for that very lesson.
2. **`vitest --changed` is structurally blind to `.bun.test.ts`**: T1's regression sweep missed the plan-close-cascade bun suite; M3's kind requirement broke its exempt-plan fixtures, surfacing only in the main full-suite run. Mechanization candidate: worktree oracle guidance should pair `vitest --changed` with an anchor-matched `bun test` sweep (the CLAUDE.md worktree-oracle bullet already says this — the dispatch bundle omitted it; bundles should quote it verbatim).
3. **E2e hermeticity under env-allowlisted runners**: AC-VRW-5 passed in dev shells (ambient CLAUDECODE=1 → session-actor tier) but failed under `lore verify`'s env allowlist (CLAUDECODE stripped → os-fallback actor warning on stderr broke an exact empty-stderr assertion). Spawn-type e2e must pin its own actor identity (`LORE_ACTOR` in spawn env); verified by re-running with CLAUDECODE/LORE_ACTOR explicitly stripped.
4. **Second plan-close sub-gate discovered**: PRD_OUTLINE_NOT_SYNCED (SPEC-080 C4) requires a domain-narrative update within the execution window. Satisfied honestly: §14.8 appended to the autonomous-feedback-loop domain overview (attestation reachability + exemption taxonomy), spec linked `implements` to the domain doc. Note for future close-outs: domain-doc linkage is part of a spec's landing checklist, not an afterthought.

## Mechanization round 3 (2026-07-28): vitest-changed blind spot closed

Follow-up lesson 2 mechanized as `spec-two-runner-changed-test-selection-deterministic-test` (3 attested ACs, plan spec-parented, closed WITHOUT exemption; merge b2e72bd; full suite vitest 383/6550 + bun 1424/1424 green). `bun run test:changed [<base>]`: transitive reverse-dependency BFS over a regex import graph across BOTH runners; binary-consumers (`dist/lore`-spawning .bun.test.ts) auto-included on any src change with `bun run build` forced first (stale-dist false-oracle lesson mechanized at selection time); mandatory per-runner counts + per-file reason tags; zero-selection under src changes warns loudly. Delivery surfaces landed: scripts/changed-tests.ts + package.json + repo CLAUDE.md Commands + user-global worktree-oracle guidance (deterministic command preferred; fallback path now carries an explicit bun-blindness warning). Implementer also found+fixed a git porcelain hazard: untracked directories collapse to one line, silently hiding new files from the changed set (`--untracked-files=all`).

**Known bounded gaps (recorded, not built)**: (1) dynamic imports excluded by design — the selector's own tests are reachable only as changed-tests, not transitively (self-coverage gap when only scripts/changed-tests.ts changes); (2) domain narrative §14.9 documents the limitation.
