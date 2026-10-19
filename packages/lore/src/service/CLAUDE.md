# Module: service

## Purpose

Business logic layer: stateless services, all returning `Promise<Result<T, LoreError>>`. ~25 services orchestrate `StoreInterface` calls and apply domain rules (lifecycle, parent-type validation, MDX placeholders, version snapshots, drift checks, AI generation, file-to-corpus sync, task/phase execution workflow, structured acceptance criteria, audit). No thrown exceptions cross this boundary. `GateEnforcer` (`gate-enforcer.ts`) is a cross-cutting, non-store-holding module — see Patterns below for its checkpoint contract.

Full pre-eviction file (mechanism walkthroughs, per-spec design decisions, empirical measurements) is archived verbatim: `lore get knowledge-module-claude-md-snapshot-packages-lore-src-service-2`; the earlier pre-compression state: `knowledge-module-claude-md-snapshot-packages-lore-src-service`.

## Key Invariants

- **Stateless** — every service holds only a `StoreInterface` (+ optionally its own `Telemetry`). All persistent state lives in the store.
- **`Promise<Result<T, LoreError>>` everywhere** — no public method throws; internal helpers may, but every public surface catches and maps to `Result`.
- **`resolveDoc`/`resolveDocId`** (`resolve.ts`) is the SINGLE ID-or-slug-or-prefix lookup helper — ULID vs slug vs unique short prefix (`store.findByIdPrefix`; 2+ candidates → `VALIDATION_ERROR` listing them, 0 → `DOC_NOT_FOUND`). CLI/MCP/HTTP all inherit it — never reimplement per-adapter. ⛔ A soft-deleted doc is NOT addressable: every branch returns `DOC_NOT_FOUND` carrying `deleted_at` (names the date + `lore undelete`) unless the caller passes `{includeDeleted: true}` — only `undelete` and the read-only history verbs (`log`/`diff`/`audit <doc>`) do.
- **Approval edits: LIVING docs reset to `draft`, locked RECORDS are refused** — `CorpusService.set` auto-reverts an approved living doc on a title/content change (sanctioned, ungated); a locked record is refused by `RecordLockService.assertEditable` (`record-edit` gate). Lock points, exits, covered paths: `baseline-keep-a-record-unchanged`. LEDGER sub_types (SPEC-103 M1) fast-track to approved at create, so they lock at birth. Kill-switch `workflow.review.ledger_auto_approve`.
- **`ReviewService.approve` is judgment-gated for durable types** (`workflow.review.judgment_required_types`, default spec+adr) — worst-decision-wins, and ⛔ ONE `escalate` blocks EVERY type once the list is non-empty. Full block + the measured judge non-determinism: `knowledge-evicted-from-the-service-module-doc-reviewservice-s`
- **`TraceRecorder` is a fire-and-forget optional DI port** (SPEC-102) — absent in bare test constructions; a throwing recorder must NEVER alter the traced operation's `Result`; instruments `CorpusService.get`/`search` and `GateEnforcer` deny (`details.layer` disambiguates hook vs service); `lore trace stats` reads never emit trace rows (no recursion).
- **`CorpusService.set` enforces `isValidTransition`** on any explicit status change (same check `approve`/`reject` apply) — illegal transitions return `INVALID_TRANSITION`.
- ⛔ **One write route: `CorpusService.writeDoc` / `insertDoc` / `moveRule` / `allocateRule` / `assignOrdinalForRepair`** (AC-DCL-3) — foreign-corpus refusal, record lock, ONE `updateWithProvenance` transaction, version + audit row naming the CALLER (never `created_by`, never `system`), no-op writes nothing. `VersionService`, `MigrationService`, `OrdinalMigrationService`, `PhaseMigrationService`, `ValidityService`, `RuleService`, `PhaseService`, `TreeCheckService`, `RequirementService` take it as a `DocWritePort` and never call `store.update`/`insertVersion`/`appendAuditEntry`/`*WithProvenance` (`single-write-path.bun.test.ts` scans; unmigrated modules are pinned there). `restore` is append-only: it inserts an `action: "restore"` row, never deletes newer entries.
- **Migration is idempotent** — `MigrationService` distinguishes `imported` vs `already_existed`.
- **`fs-walk.ts::walkFiles(dir, opts?)`** is the shared recursive dir-walker for `MigrationService`/`ExportDocsService`/the migration-coverage eval scenario — Dirent-based, `extensions` filter, `recursive` + `onError`. `service/`-local by design; not a general-purpose fs library.
- **Context two-zone modules are pure** — `context-projection.ts` and the memory-file admission trio `claude-md-budget.ts`/`claude-md-admission.ts`/`claude-md-findings.ts` hold zero IO/store deps; IO enters only via `@lore/core` fs-ports. `spliceManagedSections` is the SOLE marker-splice implementation. SSOT: `spec-context-verb-family-two-zone-claude-md-anatomy-lore`. `MemoryFileRole` is root/module/rules (N7, `.claude/rules/` discovery).
- **`runMemoryFileChecks` (`claude-md-admission.ts`) is the memory-file admission mechanism's SOLE composition entry** → `{deterministic, advisory, headroom, warnings}`, folding every metric in `claude-md-budget.ts` + `claude-md-admission.ts` + the pure `claude-md-structure.ts`; every deterministic kind is always exit-relevant (BR-427; no adoption mode). ⛔ Never add a second entry point; neither `status.ts` nor `flows/context-flow.ts` may name an individual metric function (AC-COMPOSE-1 bans 7). Kind taxonomy, the N15 false-label history, each metric's arming condition, and what to do at the eviction floor: `lore governance claude-md` + `spec-claude-md-governance-content-dimension-checks-wire-the`.
- **`anchor-resolution.ts` is the fs half of the ADVISORY file-anchor resolution check** — owns the `FsProbe` port (reused from `DriftCheckService`) and the sole advisory renderer; the pure classification half is `@lore/core`'s browser-safe `file-anchors.ts`. Consumed by `lore anchor add` / `create task --anchor` (stderr advisory only — exit code untouched, anchor stored) and `ready <plan>`'s `anchor_resolution`. ⛔ A non-resolving anchor is NEVER a refusal at any layer — anchors are declared BEFORE the work. SSOT: `task-a-mistyped-task-file-anchor-is-stored-and-consulted`.
- **`ExportDocsService`'s index allocation is collision-safe and self-healing** — duplicate titles never alias another doc's `file_path`/`human_id` (999-attempt fail-loud); `repairCollisions` reconciles a corrupted `.lore/export-index.json`, reporting every repair, never silent.
- ⛔ **The mirror's `human_id` has ONE composition site, `formatMirrorHumanId`** (padded, 3-digit) — both `ExportDocsService` and `OrdinalMigrationService`'s step-3 reconcile route through it; the report's `old_display`/`new_display` stay UNPADDED per AC-084-3. SSOT: `spec-mirror-identifier-ssot-one-writer-for-export-index-human`.
- **`OutlineService` is regex-based** (no remark/unified/mdx dep) — self-closing tags only, unknown components stripped with a warning not an error. `renderResolvedToMarkdown` is the SOLE text-projection splice; consumed by CLI `get` and `ExportDocsService`.
- **`CorpusService.get()`'s `resolve_mdx`/`resolved_components` are intentionally dead** — MDX resolution is adapter-side (`app.outlineService.resolve(doc)`); CorpusService must never import OutlineService.
- ⛔ **`TaskWorkflowService.claim` and `SessionService`'s liveness join are the ONLY services permitted to import an adapter directly** — leaf IO ports `app.ts` wires. `claim` auto-captures `extra.claim.branch` only when `opts.branch` is omitted; `deriveSessionLiveness` probes pid+start-time, NEVER claim age. ⛔ An unmeasurable branch/session stays ABSENT/`"unmeasured"` — never `"unowned"`/a guess. Adapter file list + git-trailer mechanism: `spec-multi-session-concurrency-queryable-ownership-checkout` §Scope L0.

## Patterns

- **Service per concern, no cross-service imports** — composition lives in `app.ts`; multi-service workflows are sequenced by the calling adapter. ⛔ *Service* = a store-holding class composed in `app.ts`; a store-less pure module (`plan-membership.ts`, `gate-predicates.ts`, `anchor-resolution.ts`, `validity-service.ts`, `falsifier-dep-materialization.ts`) is shared infrastructure and IS meant to be imported, never duplicated.
- **`CorpusService` is the only service wired to shared `Telemetry`**; `TaskWorkflowService`/`PhaseWorkflowService` carry their OWN `Telemetry` DI (cross-service calls are forbidden, so they can't piggyback).
- **Task/Phase workflow services write `extra.claim`/`extra.verification_evidence`/`status` directly via the store**, never through `CorpusService.update` — a bounded bypass (the approved→draft demotion is unreachable from these fields). Shared `appendEvidenceEntry` also renews a same-holder claim's `at` in the SAME CAS write (`renewClaimForEvidence`); foreign-holder/no-claim → byte-identical.
- **`done()` walks `computeArchiveWalk`'s `VALID_TRANSITIONS` path behind FOUR INDEPENDENT floors** — attested-pass, red-first, unfiltered-test-run, declared-`ac_scope`-without-red. ⛔ None may mask another; every floor FAILS CLOSED; predicates live in `@lore/core` (`attestation-completeness.ts`). SSOT: `spec-workflow-hardening-evidence-red-vocabulary-claim-worktree` §M3.
- **Stable public types live beside their owning service** (`PendingDoc`, `Diff`/`FieldChange`, `MigrationReport`, `TreeDrift`/`FixReport`) — never centralized into `packages/core/src/types.ts`.
- **`TreeCheckService`** is the only service permitted to write the link table directly (parent_id ↔ link-table reconciliation).
- **One cross-doc read-orchestration locus per consumer family** — `getPlanBundle` (assess), `getReviewBundle` (judge), `resolveDeclaredAcIds` (AC `ac_ref` validation), `findFeedingSkill` (gate feeding lookup) — never duplicated into an adapter.
- **`GateEnforcer.enforce(checkpoint, ctx)`** closes the service-layer gate bypass over every `checkpointRegistry` checkpoint. An OPTIONAL trailing constructor arg, so a bare `new XService(store)` stays ungated and only `app.ts` wires a real one — EXCEPT `RecordLockService`, which takes it REQUIRED and is required by every rewrite-path service (spec D17). A config-disabled skip writes a best-effort `gate_skipped` audit row.
- **`AuditService.verify` is TWO independent oracles, not one** — a `(doc_id, version)` join PLUS an action-family check (never a bare action-string match, see `VERSION_ACTION_AUDIT_FAMILY`), and separately a FULL-table tamper-evident hash-chain walk (`walkAuditChain`, optional `.lore/audit-anchor.json` cross-check). The completeness join reads only `listVersionKeys` (four columns, covering index `idx_versions_keys`). ⛔ The HTTP route and MCP tool never call `verify` on their own loop: they go through `audit-verify-runner.ts` (`App.auditVerifyRunner`), which runs the unchanged `verify` in a Bun Worker (`audit-verify-worker.ts`) for every persistent store — SQLite file read-only, Turso by local replica path with no sync — and in-loop only for an InMemory composition, chosen by store kind. A worker error fails the request; there is no in-loop fallback, timeout or cached verdict. The runner also reads `.lore/audit-anchor.json`, so every surface reports the CLI's anchor status.
- **`SetupService`/`ProjectSetupService` never import each other** (global-machine installer vs per-repo scaffold split, REGRESSION-tested).

## Service Map

One line per service — scope keywords only; mechanism detail lives in the archived snapshot or each service's own module header.

| Service | Responsibility |
|---|---|
| `CorpusService` | CRUD, list, search, tree, link/unlink, status, `getPlanBundle`, `getReviewBundle`, `findFeedingSkill`, `resolveDeclaredAcIds` (telemetry-wired) |
| `ReviewService` | Pending queue, approve, reject; enforces `isValidTransition`; `PendingDoc.slug` always present |
| `VersionService` | Version log, unified diff (`diff` pkg), restore (append-only) |
| `OutlineService` | MDX placeholder resolution + `renderResolvedToMarkdown` text-projection splice |
| `MigrationService` | One-shot v1→v2 import (YAML-frontmatter MD → store) |
| `TreeCheckService` | Drift detection (missing/extra/misplaced/cycle/orphan/plan-terminality), auto-fix, parent_id↔link reconciliation. ⛔ `plan-terminality` is NOT auto-fixable — repairing it would fire the `plan-close` gate from inside a repair command |
| `AIProviderService` | Provider dispatch + template render; `assessPlan` (plan judge), `judgeDoc` (review judge) |
| `SyncDocsService` | One-way file→corpus reconciler for spec files |
| `PhaseService` | add/list/remove/rename/migrate on `plan.extra.phases` |
| `TaskWorkflowService` | addEvidence/claim/release/done/ready/declareRedFirst — evidence log, advisory claim lease, four-floor archival walk, computed readiness over `blocks` links (own telemetry) |
| `PhaseWorkflowService` | Same verb set scoped to `phase` docs; own `phase-claim` checkpoint; `recordChecklistVerifiedEvidence` is the sole `attestation` injection point for checklist-linked evidence |
| `PhaseMigrationService` | One-shot idempotent task→phase sweep (`lore migrate tasks-to-phases`) |
| `ExportDocsService` | One-way corpus→file exporter; collision-safe `.lore/export-index.json`; MDX-spliced output |
| `JudgmentService` | record/latestFor/listFor AI review judgments; recordCalibration/computeCalibrationStats (Wilson-bound) |
| `StalenessProbeService` | probeBatch/probeOne for `lore review --staleness`; never mutates the probed doc, collect-and-continue |
| `AuditService` | query (thin delegation) / verify (completeness join + hash-chain walk + anchor check) / getChainHead |
| `AcService` | add/list/remove/setCriterion on `spec.extra.acceptance_criteria`; per-AC evidence coverage across child plans' tasks; in-place edits (id/`mode` immutable); `oracle_generation` bumps ONLY on a script-command text change; OPT-IN D8 path-existence check behind `--allow-missing-path`. ⛔ `retiredOracleMarker` is TWO COPIES with no `@lore/core` SSOT. Evicted detail: `knowledge-evicted-from-the-service-module-doc-the-acservice-and` |
| `VerifyRunnerService` | `verifyPlan` — trusted-runner orchestration for `lore verify` (command-provenance gate, env allowlist, attested evidence, declared-scope selection) |
| `SetupService` | planInstall/install/uninstall — global-machine installer over a resolved `targetDir`, manifest-authoritative |
| `ProjectSetupService` | Thin wrapper over `scaffoldProject` — per-repo `lore setup --project` scaffold |
| `GateEnforcer` | `enforce(checkpoint, ctx)` — service-layer runner for the seven `lore gate` checkpoints |
| `RequirementService` | add/list/removeRequirement on `prd.extra.requirements`; mirrors `AcService` one tier up |
| `Rule*` / `ImpactService` / `AcExemptionService` | baseline rules, rule state, read/impact, exemptions; every AC write goes through `ac-write-chokepoint`. Contracts: `SPEC-156`, `SPEC-157` (`lore get` resolves both) |
| `UatService` | `record` — sole UAT-verdict write orchestrator; refuses a non-plan target BEFORE doc creation (no orphan, no `--force`) |
| `DriftCheckService` | `checkDrift` over `extra.code_anchors` for `ANCHOR_SCANNED_DOC_TYPES` (spec + knowledge) — one list read by the scan, the RMW refusal and the CLI alike; owns those RMW verbs. Evicted detail: same doc as `AcService` |
| `VerificationProjectionService` | `evidencePanel` dashboard projection; zero local derivation math, all of it from `@lore/core` |
| `SessionService` | `lore bootstrap`'s corpus-wide session pointer-set; per-plan blocker lookup via batch store reads. ⛔ `computeTaskCounts`'s callers filter by `isPlanMember` only, never `isInvalidated` — `bootstrap`/`feed` count RETRACTED tasks as ready where `TaskWorkflowService.ready` excludes them. `knowledge-lore-feed-s-readiness-line-counts-retracted-tasks` |

## Links

- Depends on: [`@lore/core`](../../../../core/src/CLAUDE.md), [`../store`](../store/CLAUDE.md); `TaskWorkflowService` ALSO depends directly on `../adapters/real-git-port.js` (the one documented exception above).
- Used by: [`../adapters/cli`](../adapters/cli/CLAUDE.md), [`../adapters/mcp`](../adapters/mcp/CLAUDE.md), [`../adapters/http`](../adapters/http/CLAUDE.md), [`../eval`](../eval/CLAUDE.md) (read-only), and `../app.ts`.
