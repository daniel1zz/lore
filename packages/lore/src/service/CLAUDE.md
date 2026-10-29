# Module: service

Architecture card: `baseline-module-card-service`

## Purpose

Business logic layer: stateless services, all returning `Promise<Result<T, LoreError>>`. ~25 services orchestrate `StoreInterface` calls and apply domain rules (lifecycle, version snapshots, drift checks, task/phase workflow, acceptance criteria, audit). No thrown exceptions cross this boundary. `GateEnforcer` (`gate-enforcer.ts`) is a cross-cutting, non-store-holding module (see Patterns).

Full pre-eviction file is archived verbatim: `lore get knowledge-module-claude-md-snapshot-packages-lore-src-service-2`; the earlier pre-compression state: `knowledge-module-claude-md-snapshot-packages-lore-src-service`.

## Key Invariants

- **Stateless** — every service holds only a `StoreInterface` (+ optionally its own `Telemetry`). All persistent state lives in the store.
- **`Promise<Result<T, LoreError>>` everywhere** — no public method throws; internal helpers may, but every public surface catches and maps to `Result`.
- **`resolveDoc`/`resolveDocId`** (`resolve.ts`) is the SINGLE ID-or-slug-or-prefix lookup helper (2+ prefix candidates → `VALIDATION_ERROR`, 0 → `DOC_NOT_FOUND`); CLI and HTTP both inherit it — never reimplement per-adapter. ⛔ A soft-deleted doc is NOT addressable: `DOC_NOT_FOUND` with `deleted_at` unless `{includeDeleted: true}` (only `undelete` and read-only history verbs `log`/`diff`/`audit <doc>`).
- **Approval edits: LIVING docs reset to `draft`, locked RECORDS are refused** — `CorpusService.set` auto-reverts an approved living doc on a title/content change; a locked record is refused by `RecordLockService.assertEditable` (`record-edit` gate). Lock points: `baseline-keep-a-record-unchanged`. LEDGER sub_types (SPEC-103 M1) lock at birth. Kill-switch `workflow.review.ledger_auto_approve`.
- **`ReviewService.approve` consults `review_judgments` ONLY for spec and ADR** (`workflow.review.judgment_required_types`, BR-1369) — worst-decision-wins; ⛔ every other type (plan, task, knowledge, baseline node and per-item approval) never reads a judgment, an `escalate` included. Detail: `knowledge-evicted-from-the-service-module-doc-reviewservice-s`
- **`TraceRecorder` is a fire-and-forget optional DI port** (SPEC-102) — absent in bare test constructions; a throwing recorder must NEVER alter the traced operation's `Result`; instruments `CorpusService.get`/`search` and `GateEnforcer` deny; `lore trace stats` reads never emit trace rows.
- **`CorpusService.set` enforces `isValidTransition`** on any explicit status change (same check `approve`/`reject` apply) — illegal transitions return `INVALID_TRANSITION`.
- ⛔ **One write route: `CorpusService.writeDoc` / `insertDoc` / `moveRule` / `allocateRule` / `assignOrdinalForRepair`** (AC-DCL-3) — foreign-corpus refusal, record lock, ONE `updateWithProvenance` transaction, version + audit row naming the CALLER (never `created_by`/`system`), no-op writes nothing. Every other writing service takes it as a `DocWritePort` and never calls `store.update`/`insertVersion`/`appendAuditEntry`/`*WithProvenance` (`single-write-path.bun.test.ts` scans). `restore` is append-only. Module list: `knowledge-evicted-from-the-service-module-doc-single-write-path`
- **Migration is idempotent** — `MigrationService` distinguishes `imported` vs `already_existed`.
- **`fs-walk.ts::walkFiles(dir, opts?)`** is the shared recursive dir-walker for `MigrationService`/`ExportDocsService`/the migration-coverage eval scenario — Dirent-based, `extensions` filter, `recursive` + `onError`. `service/`-local by design; not a general-purpose fs library.
- **Context two-zone modules are pure** — `context-projection.ts` and `claude-md-budget.ts`/`claude-md-admission.ts`/`claude-md-findings.ts` hold zero IO/store deps; IO enters only via `@lore/core` fs-ports. `spliceManagedSections` is the SOLE marker-splice implementation. `MemoryFileRole` is root/module/rules.
- **`runMemoryFileChecks` (`claude-md-admission.ts`) is the memory-file admission mechanism's SOLE composition entry** → `{deterministic, advisory, headroom, warnings}`, folding every metric in `claude-md-budget.ts` + `claude-md-admission.ts` + the pure `claude-md-structure.ts`; every deterministic kind is always exit-relevant (BR-427). ⛔ Never add a second entry point; neither `status.ts` nor `flows/context-flow.ts` may name an individual metric function (AC-COMPOSE-1). Kind taxonomy, arming conditions, eviction-floor procedure: `lore governance claude-md`.
- **`anchor-resolution.ts` is the fs half of the ADVISORY file-anchor resolution check** — owns the `FsProbe` port and the sole advisory renderer; the pure half is `@lore/core`'s `file-anchors.ts`. Consumed by `lore anchor add` / `create task --anchor` (stderr advisory only) and `ready <plan>`'s `anchor_resolution`. ⛔ A non-resolving anchor is NEVER a refusal at any layer — anchors are declared BEFORE the work.
- **`ExportDocsService`'s index allocation is collision-safe and self-healing** — duplicate titles never alias another doc's `file_path`/`human_id` (fail-loud); `repairCollisions` reconciles a corrupted `.lore/export-index.json`, never silently.
- ⛔ **The mirror's `human_id` has ONE composition site, `formatMirrorHumanId`** (padded, 3-digit) — `ExportDocsService` and `OrdinalMigrationService` both route through it. SSOT: `spec-mirror-identifier-ssot-one-writer-for-export-index-human`.
- **`OutlineService` is regex-based** (no remark/unified/mdx dep) — self-closing tags only, unknown components stripped with a warning. `renderResolvedToMarkdown` is the SOLE text-projection splice; consumed by CLI `get` and `ExportDocsService`.
- **`CorpusService.get()`'s `resolve_mdx`/`resolved_components` are intentionally dead** — MDX resolution is adapter-side (`app.outlineService.resolve(doc)`); CorpusService must never import OutlineService.
- ⛔ **`TaskWorkflowService.claim` and `SessionService`'s liveness join are the ONLY services permitted to import an adapter directly** — leaf IO ports `app.ts` wires. `claim` auto-captures `extra.claim.branch` only when `opts.branch` is omitted; `deriveSessionLiveness` probes pid+start-time, NEVER claim age. ⛔ An unmeasurable branch/session stays ABSENT/`"unmeasured"`, never `"unowned"`/a guess.

## Patterns

- **Service per concern, no cross-service imports** — composition lives in `app.ts`. ⛔ *Service* = a store-holding class composed in `app.ts`; a store-less pure module (`plan-membership.ts`, `gate-predicates.ts`, `validity-service.ts`) is shared infrastructure and IS meant to be imported, never duplicated.
- **`CorpusService` is the only service wired to shared `Telemetry`**; `TaskWorkflowService`/`PhaseWorkflowService` carry their OWN `Telemetry` DI (cross-service calls are forbidden, so they can't piggyback).
- **Task/Phase workflow services write `extra.claim`/`extra.verification_evidence`/`status` directly via the store**, never through `CorpusService.update` — a bounded bypass. Shared `appendEvidenceEntry` also renews a same-holder claim's `at` in the SAME CAS write.
- **`done()` walks `computeArchiveWalk`'s `VALID_TRANSITIONS` path behind FOUR INDEPENDENT floors** — attested-pass, red-first, unfiltered-test-run, declared-`ac_scope`-without-red. ⛔ None may mask another; every floor FAILS CLOSED; predicates live in `@lore/core`. SSOT: `spec-workflow-hardening-evidence-red-vocabulary-claim-worktree` §M3.
- **Stable public types live beside their owning service** (`PendingDoc`, `Diff`, `MigrationReport`, `TreeDrift`) — never centralized into `packages/core/src/types.ts`.
- **`TreeCheckService`** is the only service permitted to write the link table directly (parent_id ↔ link-table reconciliation).
- **One cross-doc read-orchestration locus per consumer family** — `getPlanBundle`, `getReviewBundle`, `resolveDeclaredAcIds`, `findFeedingSkill` — never duplicated into an adapter.
- **`GateEnforcer.enforce(checkpoint, ctx)`** closes the service-layer gate bypass over every `checkpointRegistry` checkpoint. An OPTIONAL trailing constructor arg (bare `new XService(store)` stays ungated; only `app.ts` wires one) — EXCEPT `RecordLockService`, REQUIRED by every rewrite-path service (spec D17). A config-disabled skip writes a best-effort `gate_skipped` audit row.
- **`AuditService.verify` is TWO independent oracles** — a `(doc_id, version)` join PLUS an action-family check (`VERSION_ACTION_AUDIT_FAMILY`), and a FULL-table tamper-evident hash-chain walk (`walkAuditChain`, optional `.lore/audit-anchor.json` cross-check). ⛔ The HTTP route never calls `verify` on their own loop: it goes through `audit-verify-runner.ts` (`App.auditVerifyRunner`, Bun Worker for persistent stores, in-loop only for InMemory); a worker error fails the request (no in-loop fallback). Worker wiring + anchor reporting: `knowledge-evicted-from-the-service-module-doc-auditservice`
- **`SetupService`/`ProjectSetupService` never import each other** (global-machine installer vs per-repo scaffold split, REGRESSION-tested).

## Service Map

One line per service — scope keywords only; mechanism detail lives in the archived snapshot or each service's module header.

| Service | Responsibility |
|---|---|
| `CorpusService` | CRUD, list, search, tree, link/unlink, status, `getPlanBundle`, `getReviewBundle`, `findFeedingSkill`, `resolveDeclaredAcIds` (telemetry-wired) |
| `BulkLifecycleService` | `lore bulk`/`lore_bulk`: preview/apply one gated verb over many docs; each row CAS'd, fails alone |
| `ReviewService` | Pending queue, approve, reject; enforces `isValidTransition`; `PendingDoc.slug` always present |
| `VersionService` | Version log, unified diff (`diff` pkg), restore (append-only) |
| `OutlineService` | MDX placeholder resolution + `renderResolvedToMarkdown` text-projection splice |
| `MigrationService` | One-shot v1→v2 import (YAML-frontmatter MD → store) |
| `TreeCheckService` | Drift detection (missing/extra/misplaced/cycle/orphan/plan-terminality), auto-fix, parent_id↔link reconciliation. ⛔ `plan-terminality` is NOT auto-fixable (it would fire `plan-close` inside a repair) |
| `AIProviderService` | Provider dispatch + template render; `judgeMilestone` (milestone review provider call), `judgeDoc` (review judge) |
| `MilestoneReviewService` | `lore assess`/`lore_assess`: judges a plan on seven dimensions, stores the review (`milestone-review` knowledge doc with the plan-state fingerprint); plan close reads it via `milestone-review.ts` — BR-1372 |
| `PlanIntegrationBranchService` | sole writer of a plan's `extra.integration_branch` (`lore plan integration-branch`) |
| `SyncDocsService` | One-way file→corpus reconciler for spec files |
| `PhaseService` | add/list/remove/rename/migrate on `plan.extra.phases` |
| `TaskWorkflowService` | addEvidence/claim/release/done/ready — evidence log, advisory claim lease, stored-contract archival walk (`DONE_FLOOR_ORDER`), computed readiness over `blocks` links (own telemetry) |
| `PhaseWorkflowService` | Same verb set scoped to `phase` docs; own `phase-claim` checkpoint; `recordChecklistVerifiedEvidence` is the sole `attestation` injection point for checklist-linked evidence |
| `PhaseMigrationService` | One-shot idempotent task→phase sweep (`lore migrate tasks-to-phases`) |
| `ExportDocsService` | One-way corpus→file exporter; collision-safe `.lore/export-index.json`; MDX-spliced output |
| `JudgmentService` | record/latestFor/listFor AI review judgments; recordCalibration/computeCalibrationStats (Wilson-bound) |
| `StalenessProbeService` | probeBatch/probeOne for `lore review --staleness`; never mutates the probed doc, collect-and-continue |
| `AuditService` | query (thin delegation) / verify (completeness join + hash-chain walk + anchor check) / getChainHead |
| `AcService` | add/list/remove/setCriterion on `spec.extra.acceptance_criteria`; per-AC evidence coverage; in-place edits (id/`mode` immutable); `oracle_generation` bumps ONLY on a script-command text change. ⛔ `retiredOracleMarker` is TWO COPIES with no `@lore/core` SSOT. Evicted detail: `knowledge-evicted-from-the-service-module-doc-the-acservice-and` |
| `VerifyRunnerService` | `verifyPlan` — trusted-runner orchestration for `lore verify` (command-provenance gate, env allowlist, attested evidence, declared-scope selection) |
| `SetupService` | planInstall/install/uninstall — global-machine installer over a resolved `targetDir`, manifest-authoritative |
| `ProjectSetupService` | Thin wrapper over `scaffoldProject` — per-repo `lore setup --project` scaffold |
| `GateEnforcer` | `enforce(checkpoint, ctx)` — service-layer runner for the seven `lore gate` checkpoints |
| `CheckStatsService` | `lore checks stats`: per-check runs/denials/last denial from `check_outcomes`, removal candidates (deny-capable checks only, >=30 days AND >=50 runs AND 0 denials), `quality(listIssues)`, `ingestHookOutcomes` (claims the hooks' JSONL by rename, keeps only this corpus's cwd lines). `GateEnforcer` appends `gate:<checkpoint>` rows via its optional `recordCheckOutcome` port. Detail: `knowledge-evicted-from-the-service-module-doc-checkstatsservice` |
| `RequirementService` | add/list/removeRequirement on `prd.extra.requirements`; mirrors `AcService` one tier up |
| `Rule*` / `ImpactService` / `AcExemptionService` | baseline rules, rule state, read/impact, exemptions; every AC write goes through `ac-write-chokepoint`. Contracts: `SPEC-156`, `SPEC-157` (`lore get` resolves both) |
| `UatService` | `record` — sole UAT-verdict write orchestrator; refuses a non-plan target BEFORE doc creation (no orphan, no `--force`) |
| `DriftCheckService` | `checkDrift` over `extra.code_anchors` for `ANCHOR_SCANNED_DOC_TYPES` (spec + knowledge); owns the anchor RMW verbs. Detail: same doc as `AcService` |
| `VerificationProjectionService` | `evidencePanel` dashboard projection; zero local derivation math, all of it from `@lore/core` |
| `SessionService` | `lore bootstrap`'s session pointer-set. ⛔ `computeTaskCounts`'s callers filter by `isPlanMember` only, never `isInvalidated` (RETRACTED tasks count as ready in `bootstrap`/`feed`): `knowledge-lore-feed-s-readiness-line-counts-retracted-tasks` |

## Links

- Depends on: [`@lore/core`](../../../../core/src/CLAUDE.md), [`../store`](../store/CLAUDE.md); `TaskWorkflowService` ALSO depends directly on `../adapters/real-git-port.js` (the one documented exception above).
- Used by: [`../adapters/cli`](../adapters/cli/CLAUDE.md), [`../adapters/http`](../adapters/http/CLAUDE.md), [`../eval`](../eval/CLAUDE.md) (read-only), and `../app.ts`.
