# Module: service

## Purpose

Business logic layer. ~25 stateless services orchestrate `StoreInterface` calls and apply domain rules (lifecycle, parent-type validation, MDX placeholders, version snapshots, drift checks, AI generation, file-to-corpus sync, task/phase execution workflow, structured acceptance criteria, audit). All public methods return `Promise<Result<T, LoreError>>` — no thrown exceptions cross this boundary. `GateEnforcer` (`gate-enforcer.ts`) is a cross-cutting, non-store-holding module: an optional dependency `CorpusService`/`ReviewService`/`TaskWorkflowService`/`PhaseWorkflowService` consult before a gated write.

Full pre-compression mechanism walkthroughs (per-spec design decisions, byproduct fixes): corpus `knowledge-module-claude-md-snapshot-packages-lore-src-service`.

## Key Invariants

- **Stateless** — every service holds only a `StoreInterface` (+ optionally its own `Telemetry`). All persistent state lives in the store.
- **`Promise<Result<T, LoreError>>` everywhere** — no public method throws; internal helpers may, but every public surface catches and maps to `Result`.
- **`resolveDoc`/`resolveDocId`** (`resolve.ts`) is the SINGLE ID-or-slug-or-prefix lookup helper — ULID vs slug vs unique short prefix (`store.findByIdPrefix`; 2+ candidates → `VALIDATION_ERROR` listing them, 0 → `DOC_NOT_FOUND` with a truncation diagnostic). CLI/MCP/HTTP all inherit it — never reimplement per-adapter.
- **Approval edits reset to `draft`** — `CorpusService.update` auto-reverts an `approved` doc when title/content changes; this sanctioned reset is NOT itself a gated user transition.
- **`CorpusService.set` enforces `isValidTransition`** on any explicit status change (same check `ReviewService.approve`/`reject` apply) — illegal transitions return `INVALID_TRANSITION`.
- **`VersionService.restore` is atomic-ordered** — CAS `store.update` runs first; `versions`+`audit` rows are written ONLY on success (no phantom rows on `STALE_VERSION`).
- **Migration is idempotent** — `MigrationService` distinguishes `imported` vs `already_existed`.
- **`fs-walk.ts::walkFiles(dir, opts?)`** is the shared recursive dir-walker for `MigrationService`/`ExportDocsService`/the migration-coverage eval scenario — Dirent-based, `extensions` filter, `recursive` + `onError: "throw"|"skip"`. `service/`-local by design, dependency-free; not a general-purpose fs library.
- **Version log is append-only** — `restore` inserts an `action: "restore"` row, never deletes newer entries.
- **Context two-zone modules are pure** — `context-projection.ts` (parse/render/splice over managed marker sections, fingerprint `<!-- lore:managed section=<id> hash=<8hex> -->`, five-state incl. legacy fingerprint-less zone adoption) and the `claude-md-check.ts` admission extensions (`checkReferenceExistence` with an injected existence predicate, `detectNarrativeSmells` advisory-only, never exit-affecting) hold zero IO/store deps. IO enters only via `@lore/core` fs-ports in `context-facts.ts`; file-writing orchestration lives in `flows/context-flow.ts`, never in service/. Walk hygiene (AC-CTX-9): `collectContextFacts` skips dot-directories and gitignore-matched directories (layered per-directory `.gitignore` matchers via the `ignore` package, FsReadPort reads only — no child_process; static `EXCLUDED_DIR_BASENAMES` stays as exact-match fallback). Pre-write admission (AC-CTX-8): `runContextRefresh` runs the `claude-md-check.ts` ceiling check (SSOT with `lore status --check-claude-md`) on the spliced candidate BEFORE writing — breach → `VALIDATION_ERROR` naming every finding, no write. `spliceManagedSections` is the SOLE marker-splice implementation — `flows/setup-project-flow.ts` consumes it (AC-CTX-4 pin). SSOT: `spec-context-verb-family-two-zone-claude-md-anatomy-lore`.
- **`OutlineService` is regex-based** (no remark/unified/mdx dep) — self-closing tags only, unknown components stripped with a warning not an error. `renderResolvedToMarkdown` is the SOLE text-projection splice (descending-position walk keeps offsets stable); consumed by CLI `get` and `ExportDocsService`.
- **`CorpusService.get()`'s `resolve_mdx`/`resolved_components` are intentionally dead** — MDX resolution is adapter-side (`app.outlineService.resolve(doc)`); CorpusService must never import OutlineService.
- **`ExportDocsService`'s index allocation is collision-safe and self-healing** — duplicate corpus titles never alias another doc's `file_path`/`human_id` (`usedFilePaths`/`usedHumanIds` tracking, 999-attempt fail-loud); `repairCollisions` reconciles a corrupted `.lore/export-index.json`, reporting every repair (never silent). Splices MDX via an injected `ResolveDocBody` callback, never a direct OutlineService import.

## Patterns

- **Service per concern, no cross-service imports** — composition lives in `app.ts`; multi-service workflows are sequenced by the calling adapter (CLI/MCP/HTTP).
- **`CorpusService` is the only service wired to shared `Telemetry`**; `TaskWorkflowService`/`PhaseWorkflowService` carry their OWN `Telemetry` DI (cross-service calls are forbidden, so they can't piggyback).
- **`TaskWorkflowService`/`PhaseWorkflowService` write `extra.claim`/`extra.verification_evidence` directly via the store**, never through `CorpusService.update` — a bounded, documented bypass (CorpusService's approved→draft demotion is unreachable from these fields by construction). Their shared `appendEvidenceEntry` also renews a same-holder claim's `at` in the SAME CAS write (`renewClaimForEvidence`); foreign-holder/no-claim → byte-identical. `done()` (spec-workflow-hardening-evidence-red-vocabulary-claim-worktree §M3) extends this SAME direct-store bypass to `status` — the ONLY method on either service that writes it — walking `computeArchiveWalk`'s (`task-workflow-service.ts`, SSOT export) canonical `VALID_TRANSITIONS` path to `archived` one audited step at a time via each service's own `writeTaskStatus`/`writePhaseStatus`; refuses without ≥1 `result: "pass"` evidence or a fresh foreign claim, idempotent no-op on an already-terminal doc.
- **Stable public types live beside their owning service** (`PendingDoc` in review-service.ts, `Diff`/`FieldChange` in version-service.ts, `MigrationReport` in migration-service.ts, `TreeDrift`/`FixReport` in tree-check-service.ts) — never centralized into `core/types.ts`.
- **`TreeCheckService`** is the only service permitted to write the link table directly (parent_id ↔ link-table reconciliation).
- **One cross-doc read-orchestration locus per consumer family** — `CorpusService.getPlanBundle` (assess), `getReviewBundle` (judge), `resolveDeclaredAcIds` (AC `ac_ref` validation), `findFeedingSkill` (gate feeding-skill lookup) — never duplicated into an adapter.
- **`GateEnforcer.enforce(checkpoint, ctx)`** closes the service-layer gate bypass — SIX checkpoints (spec-create/spec-promote/plan-promote/task-claim/plan-close/phase-claim) share `checkpointRegistry` predicates unchanged. OPTIONAL trailing constructor arg on `CorpusService`/`ReviewService`/`TaskWorkflowService`/`PhaseWorkflowService` — every bare `new XService(store)` unit-test construction stays ungated (byte-identical pre-`GateEnforcer` behavior); only `app.ts` wires a real one. A config-disabled skip additionally fires a best-effort, never-blocking `gate_skipped` audit entry (D1: observability never changes the outcome).
- **`AuditService.verify`** joins `(doc_id, version)` PLUS an action-family check (never a bare action-string match — see `VERSION_ACTION_AUDIT_FAMILY`), and separately walks the FULL audit table as a tamper-evident hash chain (`walkAuditChain`, first-break diagnosis, optional external anchor cross-check via `.lore/audit-anchor.json`) — two independent oracles, not one.
- **`SetupService`/`ProjectSetupService` never import each other** (global-machine installer vs per-repo scaffold split, REGRESSION-tested).

## Service Map

| Service | Responsibility |
|---|---|
| `CorpusService` | CRUD, list, search, tree, link/unlink, status, `getPlanBundle`, `getReviewBundle`, `findFeedingSkill`, `resolveDeclaredAcIds` (telemetry-wired) |
| `ReviewService` | Pending queue, approve, reject; enforces `isValidTransition`; `PendingDoc.slug` always present |
| `VersionService` | Version log, unified diff (`diff` pkg), restore (append-only) |
| `OutlineService` | MDX placeholder resolution (whitelisted components) + `renderResolvedToMarkdown` text-projection splice |
| `MigrationService` | One-shot v1→v2 import (YAML-frontmatter MD → store) |
| `TreeCheckService` | Drift detection (missing/extra/misplaced/cycle/orphan), auto-fix, parent_id↔link reconciliation |
| `AIProviderService` | AI provider dispatch + template render; `assessPlan` (plan judge), `judgeDoc` (review judge) |
| `SyncDocsService` | One-way file→corpus reconciler for spec files |
| `PhaseService` | add/list/remove/rename/migrate on `plan.extra.phases` |
| `TaskWorkflowService` | addEvidence/claim/release/done/ready — evidence log, advisory claim lease, evidence-validated atomic archival walk, computed readiness over `blocks` links (own telemetry) |
| `PhaseWorkflowService` | Same verb set as `TaskWorkflowService` (incl. `done`), scoped to `phase` docs; own `phase-claim` checkpoint; `recordChecklistVerifiedEvidence` is the sole `attestation` injection point for checklist-linked evidence |
| `PhaseMigrationService` | One-shot idempotent task→phase sweep (`lore migrate tasks-to-phases`) |
| `ExportDocsService` | One-way corpus→file exporter; collision-safe/self-healing `.lore/export-index.json`; MDX-spliced output |
| `JudgmentService` | record/latestFor/listFor AI review judgments; recordCalibration/computeCalibrationStats (Wilson-bound) |
| `StalenessProbeService` | probeBatch/probeOne for `lore review --staleness`; never mutates the probed doc, collect-and-continue on partial failure |
| `AuditService` | query (thin delegation) / verify (completeness join + hash-chain walk + anchor check) / getChainHead |
| `AcService` | add/list/removeCriterion on `spec.extra.acceptance_criteria`; aggregates per-AC evidence coverage across child plans' tasks |
| `VerifyRunnerService` | `verifyPlan` — trusted-runner orchestration for `lore verify` (command-provenance approval gate, env allowlist, attested evidence) |
| `SetupService` | planInstall/install/uninstall — global-machine installer over a resolved `targetDir`, manifest-authoritative |
| `ProjectSetupService` | Thin wrapper over `scaffoldProject` — per-repo `lore setup --project` scaffold |
| `GateEnforcer` | `enforce(checkpoint, ctx)` — service-layer runner for the six `lore gate` checkpoints |
| `RequirementService` | add/list/removeRequirement on `prd.extra.requirements`; mirrors `AcService` one tier up |
| `UatService` | `record` — sole write orchestrator for a structured UAT verdict, informs-links it to the plan |
| `DriftCheckService` | `checkDrift` — doc-code drift oracle over declared `extra.code_anchors`; also owns spec-target anchor RMW verbs (`addCodeAnchors`/`removeCodeAnchors`/`setCodeAnchors`) |
| `VerificationProjectionService` | `evidencePanel` — dashboard adjudication workbench projection; zero local derivation math, all coverage/ratio math imported from `@lore/core` |

## Links

- Depends on: [`@lore/core`](../../../../core/src/CLAUDE.md), [`../store`](../store/CLAUDE.md).
- Used by: [`../adapters/cli`](../adapters/cli/CLAUDE.md), [`../adapters/mcp`](../adapters/mcp/CLAUDE.md), [`../adapters/http`](../adapters/http/CLAUDE.md), [`../eval`](../eval/CLAUDE.md) (read-only), and `../app.ts`.
