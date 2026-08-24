---
id: KN-529
type: knowledge
role: knowledge
title: "Evicted from packages/core/src/CLAUDE.md 2026-08-24 — six invariants' mechanism walkthroughs, incident narratives, and measurements, verbatim"
status: approved
priority: medium
created: 2026-08-24
updated: 2026-08-24
tags: []
parent: SPEC-095
---
## Why this doc exists

`packages/core/src/CLAUDE.md` was the last memory file left in the advisory band after the
root file's 2026-08-24 eviction, sitting at 15704/16384 bytes — 188 bytes short of its
`eviction_required` floor (16384 x evict_threshold_fraction 0.97 = 15892). At that
distance the guard blocks the one CORRECT write (recording a core-module fact in the core
module's own file), which is the displacement failure the eviction band exists to prevent.

Per the CLAUDE.md content contract's Eviction Rule (`lore governance claude-md`), the RULE
in each invariant below stayed in the module file; the mechanism walkthroughs, incident
narratives, code-derivable counts, and dependency-size measurements were moved here
VERBATIM. Nothing below is retired — every line is still normative for
`packages/core/src/`.

## What was evicted from each line, and why it qualified

| Invariant | Evicted from the module file | Contract category |
|---|---|---|
| Purpose paragraph | the per-leaf justification for `issue-resolution-vocab.ts`'s zero-import construction | mechanism walkthrough |
| Browser safety | the Vite dev-mode `fs`-stub failure walkthrough, `pinyin-pro`'s ~931KB unpacked size, and the full ready-to-paste `grep` command | mechanism walkthrough + measurement + code-derivable |
| Evidence `attestation` | why a REQUIRED attestation would have zeroed all legacy evidence | rejected alternative |
| `acceptance.ts` AC SSOT | the "13 files construct `AcCoverageFact` literals" count and the seven-state precedence list already declared to live only on the governing spec | code-derivable count + restated detail |
| Session INSTANCE vs IDENTITY | the two-concurrent-orchestrators rationale sentence (its task slug is kept in the module file) | per-change narrative |
| Lifecycle graph | the duplicated-demotion incident: two behaviourally identical copies, every per-path test passing while the SSOT violation stood | incident history |

## The evicted lines, verbatim (as of packages/core/src/CLAUDE.md 2026-08-24, pre-compression)

### line 5

Foundational types, error model, runtime validation, lifecycle rules, config, and telemetry. Pure modules with no I/O except `config.ts` (file read/write) and `telemetry.ts` (append-only JSONL). Published as `@lore/core` workspace package; depends on no other `@lore/*` package. Browser-safe distribution leaves: `memory-markers.ts` (CLAUDE.md managed-section markers + fingerprint grammar), `fs-ports.ts` (`FsReadPort`/`FsWritePort` interfaces + `InMemoryFsPort` test double), and `issue-resolution-vocab.ts` (the `IssueResolution` union + member arrays — ZERO imports by construction, so it can never pull a Node builtin into the barrel; the dashboard imports it directly and constructs no list of its own).

### line 9

- **Browser safety (`index.ts` barrel MUST stay import-safe from a browser bundle)** — `@lore/dashboard` imports only `@lore/core` (never `@lore/core/node`). Vite's dev-mode `fs` stub throws on named-export access **at module-load time**, not call time — a single top-level `import { x } from "fs"` anywhere in the barrel's transitive closure blanks the SPA before React mounts. Node-builtin-dependent code (`fs`/`path`/`os`/`child_process`) is split into `config-node.ts` (loadConfig/saveConfig/resolveGlobalConfigPath/loadGlobalConfig), `telemetry-node.ts` (JsonlTelemetry/createTelemetry), and `slugify-node.ts` (`transliterateCjk`, SPEC-068 — its `pinyin-pro` dep is ~931KB unpacked), all re-exported only via the `@lore/core/node` subpath (`node.ts`, `package.json#exports["./node"]`). `config.ts`/`telemetry.ts` keep pure Zod schemas/types/`NoOpTelemetry` and MUST NOT re-import fs/path/os. Static import-graph oracle: `packages/lore/tests/unit/core/barrel-isolation.test.ts`. Regression oracle: `packages/dashboard/tests/e2e/write-flow.pw.ts` (a `pageerror` before scenario 1 = this bug recurring). Grep check: `grep -rn 'from "fs"\|from "path"\|from "os"\|from "pinyin-pro"' packages/core/src/index.ts packages/core/src/config.ts packages/core/src/telemetry.ts` → 0 hits.

### line 12

- **Evidence `attestation` is OPTIONAL and load-bearing** — `extractEvidence` is whole-array fail-closed (required would silently zero ALL legacy evidence across `ready()`/`computeAcCoverage`/assess). `ATTESTATION_RUNNERS` mirrors `ORACLE_KINDS`, never bare literals. Runner-issued only — public write paths reject it (`TaskWorkflowService.addEvidence` fail-loud); sole injection site `recordVerifiedEvidence`. `resolveTargetTask` = pure heuristic (explicit override > unique fresh claim > loud ambiguity error). `isApprovedVerifyCommand(task, command)` gates command-provenance approval; `LoreError.NEEDS_APPROVAL {message, command, ac_id}` (CLI exit 7) is the refusal path — every exhaustive `switch (error.code)` over `LoreError` needs this case. Detail: SPEC-039.

### line 13

- **`acceptance.ts` is the AC-as-code SSOT** — `acceptanceCriterionSchema` (id regex `^AC-[A-Z0-9]+(-[A-Z0-9]+)*$`, `verify` discriminated union script/ai/human), `specAcceptanceCriteriaSchema` (max 50, unique ids via superRefine), `computeAcCoverage(criteria, tasks)` — pure, single-pass, facts-only aggregator over task evidence `ac_ref`s; rendering belongs to each consumer, never here. Its fact also carries `oracle_generation: {current, current_refs, prior_refs}` — evidence recorded before a script command was rewritten is PRIOR-generation (`resolveOracleGeneration`/`ORACLE_GENERATION_INITIAL` in `task-workflow.ts` own the total "absent ⇒ generation 1" rule; the reverse import edge would be a cycle). ⛔ Optional-but-always-populated, because 13 files construct `AcCoverageFact` literals; `deriveAcCoverageState` is deliberately UNCHANGED by it. `evidenceEntrySchema.ac_ref` is optional/format-unconstrained here — cross-entity membership validation lives in `TaskWorkflowService.addEvidence` via an injected `resolveDeclaredAcIds` port. `isAcInDeclaredScope(declaredScope, acId)` is the pure membership predicate (exact string equality) `VerifyRunnerService`'s declared-scope selection consumes — it answers `false` for every id when the scope is `[]`, so the CALLER must have already separated an absent scope from an empty one. `deriveAcCoverageState(fact)` is the ONE fail-first precedence derivation, now SEVEN states (`"fail" > "fail_superseded" > "attested_pass" > "not_measured" > "pass_unfalsified" > "pass" > "none"` — full row-by-row rationale, incl. the M4 supersession tie-breaks and M5's well-formedness check, lives ONLY on the governing spec's Design section, never restated here: spec-oracle-tier-falsifiability-a-criterion-never-observed-red M1/M4/M5) — both `task-feed-wiring.ts` and `commands/ac.ts::coverageBadge` consume it. Detail: SPEC-038, SPEC-070.

### line 16

- **Session INSTANCE vs actor IDENTITY** — `session-actor.ts::sessionIdDiscriminator(id)` is the SSOT sanitize+slice transform for BOTH spellings of a session: `sessionActorFromId` (the `agent:session-` actor) and `taskClaimSchema.session_id` (the captured claim fact). `deriveSessions` keys on `(by, machine, worktree, session_id)` and `buildTaskClaim` NEVER carries `session_id` forward on a refresh — inheriting it would fabricate same-session evidence. An ABSENT `session_id` means NOT MEASURED, never "same session" (`gate-predicates.ts::compareClaimSessions` is the only comparison). Rationale: two concurrently-live sessions legitimately share one actor string (`task-two-concurrent-orchestrators-both-resolve-to-agent-main`).

### line 18

- **Lifecycle graph** — `VALID_TRANSITIONS` in `schemas.ts` is the only authority on status moves. Three public reads, no more: `isValidTransition(from, to)`, `getAllowedTransitions(from)`, and `resolveStatusAfterContractEdit(currentStatus, contentChanged)` — the sole implementation of the approved→draft contract-edit demotion, shared by `CorpusService.set` and `AcService.setCriterion`. It returns the whole rule (trigger AND target status) so neither caller writes the `"draft"` literal itself; a boolean predicate would have left half the rule mirrored. Do NOT re-inline this demotion in a service: it previously existed twice (`corpus-service.ts` inline + `ac-service.ts::computeSetStatus`) and the two copies were behaviourally identical, so every per-path test passed while the SSOT violation stood — pinned now by `tests/unit/service/demotion-rule-ssot.test.ts`, which stubs the shared fn and asserts BOTH paths follow it.
