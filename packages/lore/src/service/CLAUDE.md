# Module: service

## Purpose

Business logic layer. ~25 stateless services orchestrate `StoreInterface` calls and apply domain rules (lifecycle, parent-type validation, MDX placeholders, version snapshots, drift checks, AI generation, file-to-corpus sync, task/phase execution workflow, structured acceptance criteria, audit). All public methods return `Promise<Result<T, LoreError>>` — no thrown exceptions cross this boundary. `GateEnforcer` (`gate-enforcer.ts`) is a cross-cutting, non-store-holding module: an optional dependency `CorpusService`/`ReviewService`/`TaskWorkflowService`/`PhaseWorkflowService` consult before a gated write.

Full pre-eviction file (mechanism walkthroughs, per-spec design decisions, empirical measurements) is archived verbatim: `lore get knowledge-module-claude-md-snapshot-packages-lore-src-service-2`; the earlier pre-compression state: `knowledge-module-claude-md-snapshot-packages-lore-src-service`.

## Key Invariants

- **Stateless** — every service holds only a `StoreInterface` (+ optionally its own `Telemetry`). All persistent state lives in the store.
- **`Promise<Result<T, LoreError>>` everywhere** — no public method throws; internal helpers may, but every public surface catches and maps to `Result`.
- **`resolveDoc`/`resolveDocId`** (`resolve.ts`) is the SINGLE ID-or-slug-or-prefix lookup helper — ULID vs slug vs unique short prefix (`store.findByIdPrefix`; 2+ candidates → `VALIDATION_ERROR` listing them, 0 → `DOC_NOT_FOUND`). CLI/MCP/HTTP all inherit it — never reimplement per-adapter.
- **Approval edits reset to `draft`** — `CorpusService.update` auto-reverts an `approved` doc when title/content changes; this sanctioned reset is NOT a gated user transition. LEDGER exception (SPEC-103 M1): knowledge sub_types assessment/retro/handoff/uat fast-track draft→approved at create and, on edit, reset THEN re-fast-track atomically in one write. Task type deliberately EXCLUDED (claim/ready/done assume draft preconditions). Kill-switch `workflow.review.ledger_auto_approve`.
- **`ReviewService.approve` is judgment-gated for durable types** (SPEC-103 M2) — types in `workflow.review.judgment_required_types` (default spec+adr) need a ReviewJudgment for the CURRENT version; worst-decision-wins (reject > escalate > approve); unlock = version bump + fresh approve-judgment, or the audited `--override-judgment`. ⛔ That list scopes `reject`/missing-judgment/provenance-collision ONLY: one `escalate` blocks EVERY type once the list is non-empty. ⛔ For an ungated type the question is "is ANY current-version decision an `escalate`?", never "is the WORST one?" — the service narrows the decision VECTOR it passes, never the predicate's verdict; gated types keep the FULL vector (anti-lottery). A judgment whose judge tuple equals `extra.ai_provenance` does not count. SSOT: `spec-an-escalate-blocks-approval-for-every-doc-type-and-the`.
- **`TraceRecorder` is a fire-and-forget optional DI port** (SPEC-102) — absent in bare test constructions; a throwing recorder must NEVER alter the traced operation's `Result`; instruments `CorpusService.get`/`search` and `GateEnforcer` deny (`details.layer` disambiguates hook vs service); `lore trace stats` reads never emit trace rows (no recursion).
- **`CorpusService.set` enforces `isValidTransition`** on any explicit status change (same check `approve`/`reject` apply) — illegal transitions return `INVALID_TRANSITION`.
- **`VersionService.restore` is atomic-ordered** — CAS `store.update` first; `versions`+`audit` rows written ONLY on success (no phantom rows on `STALE_VERSION`). Version log is append-only: `restore` inserts an `action: "restore"` row, never deletes newer entries.
- **Migration is idempotent** — `MigrationService` distinguishes `imported` vs `already_existed`.
- **`fs-walk.ts::walkFiles(dir, opts?)`** is the shared recursive dir-walker for `MigrationService`/`ExportDocsService`/the migration-coverage eval scenario — Dirent-based, `extensions` filter, `recursive` + `onError`. `service/`-local by design; not a general-purpose fs library.
- **Context two-zone modules are pure** — `context-projection.ts` (managed marker sections, fingerprint `<!-- lore:managed section=<id> hash=<8hex> -->`) and `claude-md-check.ts` hold zero IO/store deps. IO enters only via `@lore/core` fs-ports in `context-facts.ts`; file-writing orchestration lives in `flows/context-flow.ts`, never here. `collectContextFacts` skips dot- and gitignored directories (FsReadPort only, no child_process). `spliceManagedSections` is the SOLE marker-splice implementation. SSOT: `spec-context-verb-family-two-zone-claude-md-anatomy-lore`.
- **`claude-md-check.ts` is the memory-file admission SSOT, and its bands are ORDERED** — `lintMemoryFiles` is the ONE deterministic, exit-relevant seam (`lore status --check-claude-md`, `assets/hooks/claude-md-guard.sh`, `hooks/pre-push`, and `runContextRefresh`'s pre-write admission all consume it; ⛔ never add a second entry point — that makes the rule opt-in per surface). Three bands per metric, both fractions from config: silent < `warn_threshold_fraction` (advisory, never exit-relevant) < `evict_threshold_fraction` (deterministic `eviction_required`) <= ceiling < breach. A breach SUPPRESSES the eviction row for that same metric. ⛔ Tripping the floor is fixed by EVICTION (block → corpus doc + one-line pointer), never by raising the ceiling, never by splitting long lines (the binding constraint is BYTES), never by recording the fact in a neighbouring module's doc. SSOT: `task-a-module-claude-md-at-its-byte-ceiling-silently-relocates`.
- **`anchor-resolution.ts` is the fs half of the ADVISORY file-anchor resolution check** — owns the `FsProbe` port (reused from `DriftCheckService`) and the sole advisory renderer; the pure classification half is `@lore/core`'s `file-anchors.ts` (that package is browser-safe). Consumed by `lore anchor add`/`create task --anchor` (non-blocking stderr advisory, exit code untouched, anchor stored) and `ready <plan>`'s `anchor_resolution`. ⛔ A non-resolving anchor is NEVER a refusal at any layer — anchors are declared BEFORE the work. SSOT: `task-a-mistyped-task-file-anchor-is-stored-and-consulted`.
- **`ExportDocsService`'s index allocation is collision-safe and self-healing** — duplicate titles never alias another doc's `file_path`/`human_id` (999-attempt fail-loud); `repairCollisions` reconciles a corrupted `.lore/export-index.json`, reporting every repair, never silent.
- **`OutlineService` is regex-based** (no remark/unified/mdx dep) — self-closing tags only, unknown components stripped with a warning not an error. `renderResolvedToMarkdown` is the SOLE text-projection splice; consumed by CLI `get` and `ExportDocsService`.
- **`CorpusService.get()`'s `resolve_mdx`/`resolved_components` are intentionally dead** — MDX resolution is adapter-side (`app.outlineService.resolve(doc)`); CorpusService must never import OutlineService.

## Patterns

- **Service per concern, no cross-service imports** — composition lives in `app.ts`; multi-service workflows are sequenced by the calling adapter. ⛔ *Service* = a store-holding class composed in `app.ts`; a store-less pure module (`plan-membership.ts`, `gate-predicates.ts`, `anchor-resolution.ts`, `validity-service.ts`) is shared infrastructure and IS meant to be imported — two JSDocs cited this line to justify duplicating a predicate instead.
- **`CorpusService` is the only service wired to shared `Telemetry`**; `TaskWorkflowService`/`PhaseWorkflowService` carry their OWN `Telemetry` DI (cross-service calls are forbidden, so they can't piggyback).
- **Task/Phase workflow services write `extra.claim`/`extra.verification_evidence`/`status` directly via the store**, never through `CorpusService.update` — a bounded bypass (the approved→draft demotion is unreachable from these fields). Shared `appendEvidenceEntry` also renews a same-holder claim's `at` in the SAME CAS write (`renewClaimForEvidence`); foreign-holder/no-claim → byte-identical.
- **`done()` walks `computeArchiveWalk`'s `VALID_TRANSITIONS` path one audited step at a time, behind FOUR INDEPENDENT floors** — attested-pass, red-first, unfiltered-test-run, and declared-`ac_scope`-without-red. ⛔ None may mask another (each is checked separately, never short-circuited by a sibling); the already-terminal idempotent no-op short-circuits BEFORE all four, so past closures never break retroactively; every floor FAILS CLOSED on an unrecognised input, and each escape is audited. Predicates live in `@lore/core` (`attestation-completeness.ts`), never re-derived here. SSOT: `spec-workflow-hardening-evidence-red-vocabulary-claim-worktree` §M3 and each floor's own task.
- **Stable public types live beside their owning service** (`PendingDoc`, `Diff`/`FieldChange`, `MigrationReport`, `TreeDrift`/`FixReport`) — never centralized into `core/types.ts`.
- **`TreeCheckService`** is the only service permitted to write the link table directly (parent_id ↔ link-table reconciliation).
- **One cross-doc read-orchestration locus per consumer family** — `getPlanBundle` (assess), `getReviewBundle` (judge), `resolveDeclaredAcIds` (AC `ac_ref` validation), `findFeedingSkill` (gate feeding lookup) — never duplicated into an adapter.
- **`GateEnforcer.enforce(checkpoint, ctx)`** closes the service-layer gate bypass — SEVEN checkpoints share `checkpointRegistry`'s predicates unchanged. An OPTIONAL trailing constructor arg, so every bare `new XService(store)` unit-test construction stays ungated; only `app.ts` wires a real one. A config-disabled skip fires a best-effort, never-blocking `gate_skipped` audit entry (observability never changes the outcome).
- **`AuditService.verify` is TWO independent oracles, not one** — a `(doc_id, version)` join PLUS an action-family check (never a bare action-string match, see `VERSION_ACTION_AUDIT_FAMILY`), and separately a FULL-table tamper-evident hash-chain walk (`walkAuditChain`, optional `.lore/audit-anchor.json` cross-check).
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
| `AcService` | add/list/remove/setCriterion on `spec.extra.acceptance_criteria`; per-AC evidence coverage across child plans' tasks. `setCriterion` edits IN PLACE — id/`mode` immutable, `ac_ref` never dangles. `addCriterion`/`setCriterion` carry an OPT-IN D8 declaration-time path-existence check (`DeclarePathOpts`/`OraclePathContext`) — a script-mode command naming a nonexistent test path is refused unless `--allow-missing-path` supplies a non-empty reason, tracked in `spec.extra.allow_missing_path_declarations`; `countUnredeemedAllowMissingPath` recomputes the still-missing count fresh from the live filesystem every call (never cached), DERIVED from `listUnredeemedAllowMissingPath`'s member list (AC-FR-5 enumerator) |
| `VerifyRunnerService` | `verifyPlan` — trusted-runner orchestration for `lore verify` (command-provenance gate, env allowlist, attested evidence, declared-scope selection) |
| `SetupService` | planInstall/install/uninstall — global-machine installer over a resolved `targetDir`, manifest-authoritative |
| `ProjectSetupService` | Thin wrapper over `scaffoldProject` — per-repo `lore setup --project` scaffold |
| `GateEnforcer` | `enforce(checkpoint, ctx)` — service-layer runner for the seven `lore gate` checkpoints |
| `RequirementService` | add/list/removeRequirement on `prd.extra.requirements`; mirrors `AcService` one tier up |
| `UatService` | `record` — sole UAT-verdict write orchestrator; refuses a non-plan target BEFORE doc creation (no orphan, no `--force`) |
| `DriftCheckService` | `checkDrift` over declared `extra.code_anchors`; owns the spec-target anchor RMW verbs |
| `VerificationProjectionService` | `evidencePanel` dashboard projection; zero local derivation math, all of it from `@lore/core` |
| `SessionService` | `lore bootstrap`'s corpus-wide session pointer-set; per-plan blocker lookup via batch store reads |

## Links

- Depends on: [`@lore/core`](../../../../core/src/CLAUDE.md), [`../store`](../store/CLAUDE.md).
- Used by: [`../adapters/cli`](../adapters/cli/CLAUDE.md), [`../adapters/mcp`](../adapters/mcp/CLAUDE.md), [`../adapters/http`](../adapters/http/CLAUDE.md), [`../eval`](../eval/CLAUDE.md) (read-only), and `../app.ts`.
