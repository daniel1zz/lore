---
id: SPEC-165
type: spec
role: spec
title: "Run identity slice 1 — harness-attested runs, attested/claimed attribution, claim conflicts by run"
status: approved
priority: medium
created: 2026-10-11
updated: 2026-10-17
tags: [identity, run, claim, attribution]
links:
  - {id: ADR-044, type: implements}
  - {id: KN-587, type: implements}
---
# Run identity slice 1 — harness-attested runs, attested/claimed attribution, claim conflicts by run

## Overview/Goal

Every write in the corpus names the run that made it — a main Claude Code session or one of its subagents — as vouched for by the agent integration, never self-reported; any self-reported name is kept separately as `claimed`. Same-task claims conflict by run.

Outcome: share of claim + evidence + handoff writes carrying an attested run, 0% → ≥95% over two weeks after rollout (U2: below 80% → find bypassing paths and widen matching; never refuse).

Decision record: `adr-run-identity-is-issued-by-lore-and-attested-by-the-harness` (U1 cooperative threat model … U5 composition record in slice 1). Requirements: `knowledge-run-identity-story-map` R1–R18. Rules implemented: BR-1027..BR-1039 (`baseline-attribute-work-to-a-run`), BR-1040..BR-1043 (`baseline-claim-a-task`), BR-1044..BR-1045 (`baseline-install-the-agent-integration`). Evidence: `knowledge-agent-identity-validation-ledger` (F1–F3, V1, X1–X4, X3b).

## Scope

**In:** run registration (main + subagent) with composition record; the Claude Code adapter (two hooks); the CLI/MCP carrier of the run; stamping of `harness_run` at a single store-write chokepoint; `claimed` in the existing author fields and the end of the literal `"system"` author; claim / release conflict by run in BOTH the task and the phase claim paths; read surfaces (`get`, `log`, JSON); `lore run show`; attribution share in `lore status --json`; `$LORE_ACTOR` deprecation warning; MCP `by` optional; removal of shipped identity-setting instructions; installation via `lore setup`.

**Out (next slices, recorded in the story map):** holder liveness at claim time; fencing tokens; handoff supersession re-keyed on runs; run listing/lineage queries and run-based read filters; run-store retention; nested lineage deeper than one level; non-Claude-Code harness adapters; signed run tokens; removing the `$LORE_ACTOR` read; relabelling `audit.session_id`; role templates and context-bound fragments.

## Module design

### Key decisions (AI-made in S2; rejected options kept)

| # | Decision | Rejected |
|---|---|---|
| D1 | **Carrier = argv flag.** The PreToolUse(Bash) hook inserts `--harness-run <id>` directly after every `lore` word at a command position, after removing any `--harness-run` the caller wrote; the CLI entry strips it from argv before routing. For MCP the same hook sets a `harness_run` argument on `mcp__lore__*` calls. Per invocation, never inherited. | Per-invocation env prefix (inherited by children; the user rejected OS environment as identity carrier). PPID-keyed state file (two hook processes resolve PPID differently, `commands/handoff.ts` D8). |
| D2 | **Run ids derived from harness ids** through a harness registry in core: Claude Code → main `cc:<session_id>`, subagent `cc:<session_id>:<agent_id>`, parent of a subagent = the main run of its session. No lookup per tool call; registration idempotent (first wins). | Random ids issued at registration (needs a lookup and shared state per call). |
| D3 | **Single stamping chokepoint = a store decorator.** `withWriteContext(store, ctx)` returns a `StoreInterface` that stamps `harness_run` on every audit append and every version insert. CLI: wrapped once at the composition root. MCP: wrapped per call (one call = one identity, so a `lore_batch` call stamps every operation identically — BR-1036 by construction). Services are unchanged except where a decision reads identity (claims). | `app.forInvocation` rebuilding ~8 services; an identity parameter on every service method (83+ call sites); AsyncLocalStorage ambient context (implicit dependency). |
| D4 | **Persistence:** new `runs` table; `audit.harness_run` and `versions.harness_run` columns; `extra.claim.harness_run`. `claimed` lands in the existing author fields (`by`, `recorded_by`, `created_by`, `allocated_by`, `extra.handoff.by`); CorpusService stops writing `"system"` and writes the claimed name or null. | A `harness_run` column on every table (links, rule registry): the audit row already carries it per write. |
| D5 | **Composition record computed by the caller, persisted by RunService:** `lore run register` asks the existing fragment selection which fragments the outlet/agent type receives and passes `{ schemaVersion: 1, fragments: [{ id, sha256 }] }`; RunService only validates and persists. | RunService calling the fragments flow (service → flow is the wrong direction). |
| D6 | **One pure claim-conflict predicate** `hasClaimConflict(holder, claimant)` in `@lore/core`, called by both `TaskWorkflowService` and `PhaseWorkflowService` claim and release paths. A holder is **legacy** when its claim record has no `harness_run` key at all (written before migration 016); every claim written after it stores the key, `null` when unattested. Legacy holder → compare `by` as today until released or stale. Otherwise: both runs null (two unattested parties, e.g. a human on the CLI) → compare `by` as today; exactly one side null, or two different runs → conflict, message names holder and age; same run → refresh; stale → takeover. | Rule duplicated in two services (the 2026-08-03 incident fixed one path only); detecting legacy by timestamp (clock-dependent, ambiguous at the migration instant). |
| D7 | **Fail-open registration, loud label.** Hooks exit 0 always; a failure produces one additionalContext line; writes then carry no `harness_run` and render `unattested`. Unknown `harness_run` on a write → stored unattested + one stderr warning naming the id, write not refused (U1, U2). | Refusing unattested writes (rejected by the user, U2). |
| D8 | **Deprecation:** `$LORE_ACTOR` populates `claimed` with source `env` and prints one deprecation line per process through an injected `warn` sink. | Removing the read in slice 1 (would break callers before the adapter is proven at ≥95%). |
| D9 | **Naming:** code uses `harnessRun` / `harness_run` / `--harness-run`; user-facing labels keep the words validated in X3b: `attested: <run \| unattested> · claimed: <name>`. | `attestedRun` — collides in search with `attestation.runner` (trusted oracle runner). |
| D10 | **Hook owns no grammar.** `pre-tool-harness-run.mjs` only checks whether a Bash command contains the word `lore` (or the tool is `mcp__lore__*`); if so it pipes the PreToolUse payload to `lore run attest-input`, which returns the hook JSON with `updatedInput` computed by the core rewrite functions. Non-lore Bash calls cost nothing extra; lore calls cost one `lore` start (measured 0.13 s for `lore --version`, the same order the G1–G4 gates already pay per Bash call). | Copying the rewrite into the self-contained hook (a second implementation of the grammar that drifts independently — the defect class SPEC-083 retired for governance prose). |
| D11 | **Name tiers kept; only attestation is new.** The author string is resolved exactly as today (`--by` > `$LORE_ACTOR` > session > working copy > OS user; MCP `by` argument) and stored in the existing author fields, now with its source (`flag`, `env`, `mcp`, `session`, `worktree`, `os`). BR-131's same-name anchor-overlap check, BR-134's OS-name collision guard and BR-1022's working-copy name keep working unchanged. Labels print `claimed: <name> (<source>)`. | Storing `claimed` only for caller-supplied names and leaving the author empty otherwise (breaks every schema that requires a non-empty `by`, and silently disables BR-131/BR-134). |
| D12 | **The pre-tool hook never grants permission.** `lore run attest-input` returns `updatedInput` only — never `permissionDecision`. Measured 2026-10-11 in a throwaway project under `--permission-mode default`: `updatedInput` alone is applied, and permission rules are evaluated on the REWRITTEN input (a `deny: Bash(touch:*)` rule refused an `echo` call rewritten to `touch`; control: direct `touch` refused too). `"allow"` would skip the user's permission prompt for every command containing the word lore, compound commands included. Pinned by a test in `run-attest-input.bun.test.ts` and in the end-to-end test. | Returning `permissionDecision: "allow"` with the rewrite (what the validation spike used). |

### Module boundary

- **Public:** `@lore/core` `run-identity.ts` (types, harness registry, `deriveRunId`, `hasClaimConflict`, `WriteContext`, `rewriteBashCommand`, `rewriteMcpInput`, `stripHarnessRunFlag`, `HARNESS_RUN_FLAG`); `@lore/core/node` `run-identity-node.ts` (`resolveInvocationIdentity`); `RunService`; `AttributionReport`; CLI `lore run register|show`; the two hooks.
- **Internal:** migration 016; render helpers.
- **Dependencies:** StoreInterface (injected), Clock (injected), `warn` sink (injected), existing fragment selection (called by the CLI command, passed in).

### Structure

```
packages/core/src/run-identity.ts                 NEW  pure: RunId, InvocationIdentity, HarnessAdapter registry, deriveRunId, hasClaimConflict, rewriteBashCommand, rewriteMcpInput, stripHarnessRunFlag
packages/core/src/run-identity-node.ts            NEW  resolveInvocationIdentity(argv, env, warn)
packages/lore/src/store/migrations/migration-016.ts  NEW  runs table; audit.harness_run; versions.harness_run
packages/lore/src/store/{store-interface,sqlite-store,turso-store,in-memory-store}.ts  MOD  insertRun (idempotent) / getRun / countAttributedWrites
packages/lore/src/store/write-context-store.ts    NEW  withWriteContext(store, ctx): StoreInterface decorator
packages/lore/src/service/run-service.ts          NEW  register(record) / get(id)
packages/lore/src/service/attribution-report.ts   NEW  share(windowDays, clock)
packages/lore/src/service/{task-workflow,phase-workflow}-service.ts  MOD  hasClaimConflict; claim.harness_run; release by run
packages/lore/src/service/corpus-service.ts       MOD  no "system" literal; claimed author
packages/lore/src/index.ts, adapters/cli/index.ts MOD  resolve identity once; wrap store
packages/lore/src/adapters/cli/commands/run.ts    NEW  lore run register | show | attest-input
packages/lore/src/adapters/cli/commands/{get,log,status}.ts  MOD  attested · claimed; status share
packages/lore/src/adapters/mcp/tools.ts           MOD  harness_run arg; 18 `by` optional; per-call decorator
assets/hooks/run-register.mjs                     NEW  SessionStart + SubagentStart → lore run register (fail-open)
assets/hooks/pre-tool-harness-run.mjs             NEW  PreToolUse Bash + mcp__.*lore_.* → blind pipe to `lore run attest-input` (D10)
packages/core/src/distribution-hooks.ts           MOD  register both hooks
assets/{agents,skills,context,governance}/**, CLAUDE.md  MOD  remove identity-setting instructions
```

### Public interface

```ts
export type RunId = string & { readonly __brand: "RunId" };
export interface HarnessAdapter { readonly harness: string; derive(ids: { sessionId: string; agentId?: string }): RunId; }
export const HARNESS_ADAPTERS: Readonly<Record<string, HarnessAdapter>>; // slice 1: { "claude-code" }
export interface CompositionRecord { readonly schemaVersion: 1; readonly fragments: ReadonlyArray<{ id: string; sha256: string }>; }
export interface RunRecord {
  id: RunId; kind: "main" | "subagent"; harness: string;
  sessionRef: string; agentRef: string | null; agentType: string | null;
  parentRunId: RunId | null; branch: string | null;
  composition: CompositionRecord; registeredAt: string;
}
export type NameSource = "flag" | "env" | "mcp" | "session" | "worktree" | "os";
export interface InvocationIdentity { harnessRun: RunId | null; claimed: string; claimedSource: NameSource; }
export interface WriteContext { readonly identity: InvocationIdentity; }   // held by withWriteContext; services that DECIDE on identity (claims, releases) receive it explicitly through their opts
export function withWriteContext(store: StoreInterface, ctx: WriteContext): StoreInterface;
export interface ClaimParty { by: string; harnessRun: RunId | null; }
export interface ClaimHolder extends ClaimParty { legacy: boolean; stale: boolean; }   // legacy = no harness_run key on the stored claim
export type ClaimDecision = { kind: "grant" } | { kind: "refresh" } | { kind: "takeover" } | { kind: "conflict"; holder: string; holderRun: RunId | null };
export function hasClaimConflict(holder: ClaimHolder, claimant: ClaimParty): ClaimDecision;
export function rewriteBashCommand(command: string, run: RunId): string;   // idempotent; never edits quoted text
export function rewriteMcpInput<T extends object>(input: T, run: RunId): T & { harness_run: RunId };
export const HARNESS_RUN_FLAG = "--harness-run";
```

### Dependency graph

```
hooks ──rewrite (core pure fns)──▶ CLI entry ──resolveInvocationIdentity──▶ withWriteContext(store)
                                                      │
                     services (unchanged constructors) ┴─▶ decorated StoreInterface ─▶ SQLite | Turso | InMemory
RunService, AttributionReport ─▶ StoreInterface        @lore/core run-identity ◀── everything above (no back-edges)
```

### Cross-cutting

- **Security (STRIDE-lite):** spoofing by a caller typing `--harness-run` — stripped and overwritten on every call the hook sees. Accepted under U1 (cooperative agents), recorded in the ADR: a path the hook does not see (script file, direct MCP/HTTP client) can carry a forged but registered id and inflate the attribution share; when `lore run attest-input` fails the hook passes the command through, so a caller-written flag survives on that call (an unregistered id is still stored unattested — AC-RID-8). Tampering with the runs table — same-user process, out of scope.
- **Performance:** non-lore Bash calls: no added spawn. Calls invoking lore or an `mcp__lore__*` tool: one `lore run attest-input` spawn (~0.13 s measured startup). Registration spawns `lore` once per session/subagent start.
- **Observability:** attribution share in `lore status --json`; one stderr warning per unknown run id; one additionalContext line per failed registration.
- **Privacy:** runs store `session_id`, `agent_id`, agent type, branch and fragment hashes; never `transcript_path`; never a local worktree path in the corpus (SPEC-025).

### Quality gates (module mode)

- [x] No circular dependencies — core pure ← store/services ← CLI/MCP adapters ← hooks; RunService does not call flows (D5).
- [x] Every module has a single responsibility — rewrite (core), resolve identity (core/node), stamp (decorator), persist runs (RunService), report share (AttributionReport), decide conflicts (`hasClaimConflict`).
- [x] Public API sufficient for black-box tests — pure functions table-testable; CLI/hook paths testable against a mkdtemp corpus with fixture hook payloads (no live Claude Code session).
- [x] Dependencies injectable — store, clock, warn sink, fragment list, argv/env.

## Acceptance Criteria

Declared with `lore ac add` (script mode, test oracle; each command runs one whole test file and prints a PASS line). Test files are created red-first by the implementing tasks.

## Risks

- Shell rewrite misses compound forms → those writes are unattested (accepted, measured by the share); mangling is prevented by the idempotence and quoted-text cases of AC-RID-15.
- Three store implementations change together; AC-RID-4 runs on SQLite and InMemory (decorator + run methods), AC-RID-5 on SQLite and InMemory; Turso shares the SQL migration and is not exercised by an AC (accepted).
- SubagentStart registration racing the first tool call is not measured; a lost registration only degrades to unattested (BR-1035).
- User-level fragments (`~/.config/lore/context/user-04`, `user-17`) are not shipped; they are updated on the maintainer's machine with `lore context refresh` in the same slice, outside any AC.

## Implementation record (slice 1 landed 2026-10-11)

Decisions taken while landing, each pinned by a test or an attested AC:

- **Verified identity, once per invocation.** `verifyInvocationIdentity` (`packages/lore/src/service/run-identity-verify.ts`) checks the run against the runs table; an unregistered id becomes `harnessRun: null` with one warning. The CLI entry verifies once (`App.verifiedInvocationIdentity`); claims and releases decide on the verified run, so the decision and the stamped rows agree (regression test in `write-unattested.bun.test.ts`, falsified by disabling the downgrade).
- **One name per operation.** Gate, corpus, AC, rule and tree-check audit rows take the operation's name through `resolveWriteActorFor(store, by?)` instead of re-resolving it (found by AC-RID-8 when `lore verify`'s env allowlist removed the session id: `gate_passed` rows were authored by the OS user).
- **Name source** is stored as `audit.details.name_source` (flag | env | mcp | session | worktree | os), written only when the row's actor is the invocation's name.
- **MCP** builds one identity per tool call (`McpCallScope`, `packages/lore/src/adapters/mcp/call-scope.ts`) over a call-scoped App (`App.forWriteContext`); `lore_feed` keeps `by` as a read filter and is not attested; measured overhead p95 +0.96 ms per call.
- **Pre-tool hook failure is silent** (no additionalContext): it fires on every lore call, and its failure is visible as unattested writes in the attribution share. Registration hook failures print one line (D7).
- **Main-run composition** is the `hook:session-start` fragment selection; subagent runs use `hook:subagent-start` for their agent type.
- **Store**: `harness_run` excluded from the audit hash payload and unindexed; rule-registry version rows carry the run via `RuleLeafPatch.harness_run`; a new `StoreInterface` method writing an audit or version row must join `STAMPED` in `write-context-store.ts`.

Known follow-ups (filed or listed in the handoff, not in this slice): CLI read commands open a second `SQLiteStore(dbPath)` instead of the App store (status, get, log — pre-existing pattern); `lore claim --worktree` is not checked against the actual worktree while `lore done` removes the recorded one.


## Acceptance Criteria (structured)

- [⚑] [script] AC-RID-1: lore run register for a main run and for two subagents of the same session (fixture harness ids) creates three distinct runs; each subagent's parent is the main run (cc:<session>); registering the same main run, and the same subagent, a second time with different parent and branch values leaves exactly one row each with every stored column unchanged — asserted by run-register.bun.test.ts
  script: test — bunx --bun vitest run --testTimeout=120000 --hookTimeout=120000 packages/lore/tests/integration/cli/run-register.bun.test.ts && echo 'AC-RID-1 PASS: distinct runs, parent link, idempotent re-registration'
- [⚑] [script] AC-RID-2: A registered run's composition record lists exactly the fragment ids that lore fragments render selects for its outlet and agent type, each with the sha256 of the fragment's content, and the run stores that agent type; editing one fragment and registering a new run yields a different sha256 for that fragment only — asserted by run-composition.bun.test.ts
  script: test — bunx --bun vitest run --testTimeout=120000 --hookTimeout=120000 packages/lore/tests/integration/cli/run-composition.bun.test.ts && echo 'AC-RID-2 PASS: composition record matches the selected fragments with content hashes'
- [⚑] [script] AC-RID-3: assets/hooks/run-register.mjs exits 0 in every case: with lore absent from PATH, with lore exiting non-zero, and with malformed stdin it prints exactly one additionalContext line naming the failure and never blocks; with a working stub it spawns lore run register with the derived run id — asserted by run-register-hook.test.ts
  script: test — bunx vitest run packages/lore/tests/unit/hooks/run-register-hook.test.ts && echo 'AC-RID-3 PASS: registration hook is fail-open and loud'
- [⚑] [script] AC-RID-4: Opening a SQLite corpus at schema version 15 migrates it to 16: the runs table and the audit.harness_run and versions.harness_run columns exist, every pre-existing row is unchanged and has harness_run NULL, and a second open is a no-op; on both SQLiteStore and InMemoryStore insertRun is idempotent (first wins), getRun returns it, and a store wrapped by withWriteContext stamps harness_run on audit appends and version inserts while the unwrapped store stamps nothing — asserted by migration-016.bun.test.ts
  script: test — bunx --bun vitest run --testTimeout=120000 --hookTimeout=120000 packages/lore/tests/unit/store/migration-016.bun.test.ts && echo 'AC-RID-4 PASS: v15 corpus migrates to v16 without data change'
- [⊘] [script] AC-RID-5: With an invocation identity carrying harness run R and name N from source S, each write kind — create, set, link, unlink, claim, release, evidence, ac add, rule add, handoff, done — leaves an audit row with harness_run R and author N with source S, and every version row it writes has harness_run R; one MCP lore_batch call with three operations stamps all three with the same R and the same N; the matrix runs on SQLiteStore and InMemoryStore — asserted by write-attribution-matrix.bun.test.ts
  script: test — bunx --bun vitest run --testTimeout=180000 --hookTimeout=180000 packages/lore/tests/integration/cli/write-attribution-matrix.bun.test.ts && echo 'AC-RID-5 PASS: every write kind stamped with the harness run at the store chokepoint'
- [⚑] [script] AC-RID-6: resolveInvocationIdentity: --by X yields name X with source flag; $LORE_ACTOR=Y yields name Y with source env and exactly one deprecation line to the injected warn sink per process however many times it is resolved; harnessRun comes only from the stripped --harness-run flag and never from --by or $LORE_ACTOR (asserted by run-identity-node.test.ts); and at the CLI, one lore process that performs three writes with LORE_ACTOR set prints exactly one deprecation line on stderr (asserted by lore-actor-deprecation.bun.test.ts)
  script: test — bunx vitest run packages/core/tests/run-identity-node.test.ts && bunx --bun vitest run --testTimeout=120000 --hookTimeout=120000 packages/lore/tests/integration/cli/lore-actor-deprecation.bun.test.ts && echo 'AC-RID-6 PASS: names are never attestation; one deprecation warning per process'
- [⚑] [script] AC-RID-7: In the MCP server's runtime tool listing (tools/list), no tool's input schema lists by or recorded_by as required; an mcp__lore__ write called with harness_run R and no by succeeds and its audit row carries R; called without harness_run it succeeds unattested; lore_claim with harness_run R1 while R2 holds is refused naming R2 — asserted by mcp-harness-run.bun.test.ts
  script: test — bunx --bun vitest run --testTimeout=120000 --hookTimeout=120000 packages/lore/tests/integration/mcp/mcp-harness-run.bun.test.ts && echo 'AC-RID-7 PASS: MCP writes attested, by optional'
- [⊘] [script] AC-RID-8: A write whose --harness-run names an id with no registered run succeeds, stores harness_run NULL, keeps the name lore resolved for it with its source, and prints exactly one stderr warning naming that id; a write with no --harness-run succeeds with harness_run NULL; no run is ever filled in for an unattested write — asserted by write-unattested.bun.test.ts
  script: test — bunx --bun vitest run --testTimeout=120000 --hookTimeout=120000 packages/lore/tests/integration/cli/write-unattested.bun.test.ts && echo 'AC-RID-8 PASS: unknown or absent run stored unattested, never refused'
- [⊘] [script] AC-RID-9: lore get and lore log, in text and in --json, show for the same write 'attested: <run>' or 'attested: unattested' and the name with its source, identically on both surfaces; a document version written before migration 016 shows attested unattested with its stored name; CorpusService writes no literal 'system' author for create, set or delete — asserted by attribution-render.bun.test.ts
  script: test — bunx --bun vitest run --testTimeout=120000 --hookTimeout=120000 packages/lore/tests/integration/cli/attribution-render.bun.test.ts && echo 'AC-RID-9 PASS: one author per write on every surface'
- [⚑] [script] AC-RID-10: lore run show <id> prints kind, parent run, session, branch and composition fragments for a registered run (and the same fields in --json); for an unregistered id it exits with the not-found exit code and the message names the id — asserted by run-show.bun.test.ts
  script: test — bunx --bun vitest run --testTimeout=120000 --hookTimeout=120000 packages/lore/tests/integration/cli/run-show.bun.test.ts && echo 'AC-RID-10 PASS: every run id resolves or is refused by name'
- [⚑] [script] AC-RID-11: lore status --json reports harness_run_attribution {window_days, total, attested, share} over claim, evidence and handoff writes only, the window being the 14 days ending now with its start instant included, and lore status prints the same numbers in text; a seeded corpus with, inside the window, 7 claims (one of them exactly at the window start), 7 evidence entries and 6 handoffs of which the only unattested one is a handoff, plus 5 writes before the window start and 4 attested document writes, reports total 20, attested 19, share 0.95 under an injected clock — asserted by status-attribution-share.bun.test.ts
  script: test — bunx --bun vitest run --testTimeout=120000 --hookTimeout=120000 packages/lore/tests/integration/cli/status-attribution-share.bun.test.ts && echo 'AC-RID-11 PASS: attribution share exact over the window'
- [⚑] [script] AC-RID-12: hasClaimConflict decides by harness run, not by name; parameterised over BOTH the task and the phase claim path: a fresh claim by run R1 refuses a claim by run R2 with the same name (message names R1 and the claim's age), refuses an unattested claimant (naming R1), refuses an attested claimant against a fresh unattested holder; two unattested parties are compared by name (same name refreshes, different name refused); R1 claiming again advances the lease timestamp; a stale R1 claim is taken over by R2 without --steal; --steal succeeds and history records previous and new run. Falsifier: replacing the run comparison with a name comparison in either path turns the R1/R2 case red — asserted by claim-conflict-by-run.bun.test.ts
  script: test — bunx --bun vitest run --testTimeout=120000 --hookTimeout=120000 packages/lore/tests/integration/cli/claim-conflict-by-run.bun.test.ts && echo 'AC-RID-12 PASS: task and phase claims conflict by run'
- [⚑] [script] AC-RID-13: A fresh claim stored before migration 016 (no harness_run) is compared by its by value: a run claiming with the same by refreshes it, a different by is refused; once the legacy lease is stale or released the run rule applies — asserted by claim-legacy-transition.bun.test.ts
  script: test — bunx --bun vitest run --testTimeout=120000 --hookTimeout=120000 packages/lore/tests/integration/cli/claim-legacy-transition.bun.test.ts && echo 'AC-RID-13 PASS: legacy claims compared by name until released or stale'
- [⚑] [script] AC-RID-14: lore release by a run other than the holding run, and by an unattested caller, is refused naming the holder unless --force; a forced release records both in history; release by the holding run succeeds and records its run; a legacy claim (no harness_run key) is released by its stored name as before — asserted by claim-release-by-run.bun.test.ts
  script: test — bunx --bun vitest run --testTimeout=120000 --hookTimeout=120000 packages/lore/tests/integration/cli/claim-release-by-run.bun.test.ts && echo 'AC-RID-14 PASS: release decided and recorded by run'
- [⚑] [script] AC-RID-15: Carrier half of BR-1044: rewriteBashCommand inserts --harness-run <id> after every lore word at a command position (start, after &&, ||, ;, |, and after a VAR=value prefix), strips any caller-written --harness-run first, is idempotent (rewrite(rewrite(c)) = rewrite(c)), and leaves quoted strings, heredoc bodies and 'echo lore' untouched; rewriteMcpInput sets harness_run and overwrites a caller value — table asserted by run-identity-rewrite.test.ts
  script: test — bunx vitest run packages/core/tests/run-identity-rewrite.test.ts && echo 'AC-RID-15 PASS: rewrite table green, idempotent, quoted text untouched'
- [⚑] [script] AC-RID-16: A fresh consumer install (lore init + lore setup in a throwaway project) registers run-register.mjs on SessionStart and SubagentStart and pre-tool-harness-run.mjs on PreToolUse for Bash and mcp__.*lore_.*; feeding the installed hooks fixture SessionStart and PreToolUse payloads and running the rewritten claim attributes that claim to the session's run — asserted by the fresh-install-probe step 'first-write-attested', whose PASS line must appear in the probe output (a deleted step fails this criterion)
  script: test — OUT="$(mktemp)" && bun run build > /dev/null 2>&1 && bun scripts/fresh-install-probe.ts --bin dist/lore > "$OUT" 2>&1 && grep -q '^PASS first-write-attested ' "$OUT" && echo 'AC-RID-16 PASS: fresh install attributes its first write to a run (probe step ran and passed)'
- [⚑] [script] AC-RID-17: No shipped text under assets/ or .claude/rules mentions LORE_ACTOR except in the exact phrase 'LORE_ACTOR is deprecated'; no shipped text contains --by except lore feed / lore bootstrap read filters or a line naming it a claimed label (catches --by=x and continuation lines); root CLAUDE.md contains no instruction to export LORE_ACTOR; positive counterparts: lore-implementer states 'identity is assigned by the agent integration' and the lore-session-review invariants require writes to 'carry an attested run'; the command first proves its needles trip on a seeded violation (negative control)
  script: test — cd "$(git rev-parse --show-toplevel)" && N1() { grep -rIn 'LORE_ACTOR' "$@" | grep -v 'LORE_ACTOR is deprecated'; } && N2() { grep -rIn -- '--by' "$@" | grep -vE 'lore (feed|bootstrap)|claimed label'; } && T="$(mktemp -d)" && printf 'export LORE_ACTOR=agent:x\nsee: LORE_ACTOR (not deprecated here)\n' > "$T/a.md" && printf 'lore claim t \\\n  --by=agent:x\n' > "$T/b.md" && test "$(N1 "$T" | wc -l | tr -d ' ')" = 2 && test "$(N2 "$T" | wc -l | tr -d ' ')" = 1 && test -z "$(N1 assets .claude/rules)" && test -z "$(N2 assets .claude/rules)" && test -z "$(grep -nE 'export LORE_ACTOR|LORE_ACTOR=agent:|--by \$LORE_ACTOR' CLAUDE.md)" && grep -q 'identity is assigned by the agent integration' assets/agents/lore-implementer.md && grep -q 'carry an attested run' assets/skills/lore-session-review/references/invariants.md && echo 'AC-RID-17 PASS: no shipped text tells an agent to set its identity (negative controls tripped)'
- [⊘] [script] AC-RID-18: End to end without a live Claude Code session: in a mkdtemp corpus, feeding the real hook scripts a SessionStart payload, two SubagentStart payloads with distinct agent_ids, and PreToolUse payloads for one evidence write per run, then executing the rewritten commands with the built CLI, yields three evidence audit rows whose harness_run values are three distinct registered runs, the two subagent runs both naming the main run as parent — asserted by run-identity-e2e.bun.test.ts
  script: test — bunx --bun vitest run --testTimeout=180000 --hookTimeout=180000 packages/lore/tests/e2e/run-identity-e2e.bun.test.ts && echo 'AC-RID-18 PASS: hook to CLI to stamped write, distinct runs per subagent'

## Code anchors

- packages/core/src/run-identity.ts#hasClaimConflict
- packages/core/src/run-identity.ts#rewriteBashCommand
- packages/core/src/run-identity.ts#deriveRunId
- packages/core/src/run-identity-node.ts#resolveInvocationIdentity
- packages/lore/src/store/write-context-store.ts#withWriteContext
- packages/lore/src/service/run-service.ts#RunService
- packages/lore/src/service/run-identity-verify.ts#verifyInvocationIdentity
- packages/lore/src/service/attribution-report.ts#AttributionReport
- packages/lore/src/adapters/mcp/call-scope.ts#McpCallScope
- packages/lore/src/store/migrations/migration-016.ts#MIGRATION_016_SQL
- packages/lore/src/adapters/cli/commands/run.ts
- assets/hooks/run-register.mjs
- assets/hooks/pre-tool-harness-run.mjs
