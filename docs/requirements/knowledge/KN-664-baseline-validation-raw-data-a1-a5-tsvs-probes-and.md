---
id: KN-664
type: knowledge
role: knowledge
title: "Baseline validation raw data A1-A5: TSVs, probes and grading"
status: draft
priority: medium
created: 2026-10-07
updated: 2026-10-07
tags: [baseline, validation-raw-data]
parent: KN-565
---
# Baseline validation raw data (A1–A5): TSVs, probes and grading

Verbatim experiment artifacts behind `knowledge-baseline-product-shape-validation-ledger-a1-spec-to`, persisted so its E1 results stay auditable after session 6b85319e. Corpus state: main `67db6557`, 2026-10-07.

## branches.md

````text
# Lore baseline — owner-approved branch split (2026-10-07)

Branch = bounded context (language changes meaning at the boundary). Leaf = one business point: single verb, user-meaningful result, Command -> Constraint -> Domain Event, past-tense event a domain expert would say. Queries/reads (search/get/tree/bootstrap/status) are NOT leaves (D5) — cross-cutting notes on the owning branch. Gates are NOT a branch — each gate is a `guaranteed` rule inside the leaf it constrains. Dashboard is a surface, not a branch.

| Branch | Candidate leaves (command -> event) |
|---|---|
| corpus (文档库) | create doc -> DocCreated; revise doc -> DocRevised (approved auto-demotes); link docs -> DocLinked; invalidate/supersede -> KnowledgeInvalidated |
| review (审核与生命周期) | submit for review; approve -> DocApproved; reject; archive/deprecate |
| baseline (产品基线, NEW) | add/revise node; add rule -> RuleAdded; deprecate/retire rule; open/close change record |
| specification (规格与验收) | create spec under a leaf; declare AC (must cite rule); declare falsifier; declare code anchor |
| execution (计划与执行) | create plan/phase/task; claim -> TaskClaimed; release; record evidence -> EvidenceRecorded; verify -> AttestedPass; done -> TaskArchived; close plan |
| session (会话连续性) | write handoff -> HandoffWritten; resume; enter seat |
| hygiene (记忆卫生) | mark stale; drift detected |
| autonomy (自治反馈) | AI judgment recorded; calibration recorded; autonomy level unlocked |
| issue-loop (缺陷回流) | report defect -> IssueReported; triage |
| distribution (分发与接入) | init project; setup/converge; publish release; register project (multi-project) |
| sync (多机同步) | push/pull replica |
| context (Agent 上下文供给) | CLAUDE.md structure constraint; inject rule fragments into sessions |

````

## two-trees.md

````text
# Two trees (owner decisions 2026-10-07, adr-the-product-is-a-baseline-tree-specs-are-implementations, decisions 9-10)

A spec has exactly ONE home:
- BASELINE leaf — the spec changes user-observable behaviour of a business point (what a lore user — human or agent in a consuming project — can do, is refused, or sees as an outcome). Branches/leaves: see branches.md in this directory.
- ARCH node — the spec is about technical structure, not user-observable behaviour. Architecture tree follows everything-workspace/architecture/:
  - current-state/<module> — module cards. Lore modules: core (types, errors, schemas, config), store (sqlite / turso / in-memory, FTS), service-layer, adapter-cli, adapter-mcp, adapter-http, dashboard, eval, sync-engine, auth, telemetry, hooks, assets-packaging, build-release
  - target-state — target architecture / migration
  - standards/<area> — rules all new code must follow: error-model, import-boundaries, browser-safety, testing-runners, cli-conventions, concurrency-safety, oracle-integrity
  - debt — a recorded architecture gap
- NOT-PRODUCT — exists ONLY to build/test THIS repository, never reaches a consuming project.
- A spec whose title/body is a bugfix/hardening of behaviour → BASELINE (the leaf whose behaviour it fixes). A spec that is a hardening of internal mechanics with no change in what a user can do/sees → ARCH.
- Lore's product IS governance tooling: gates, evidence, attestation, falsifiers, verify, assess, judgments, claims, handoffs, injection into agent sessions are user-observable behaviour when they change what a user can do, is refused, or sees.

````

## mapping/a1.tsv

````text
slug	kind	bucket	branch	leaf	note
spec-070-deterministic-task-dispatch-bundle-lore-feed-task-start	none	ONE	execution	execution	task dispatch bundle
spec-071-execution-liveness-signals-session-actor-tier-evidence	none	ONE	execution	execution	execution liveness signals
spec-072-upstream-issue-reporting-lore-report-issue-consumer	none	ONE	issue-loop	issue-loop	report upstream issue
spec-073-report-issue-trigger-surfaces-error-path-hints	none	ONE	issue-loop	issue-loop	report-issue triggers
spec-074-dashboard-issues-triage-surface-badge-list-in-place	none	ONE	issue-loop	issue-loop	issue triage dashboard
spec-075-dashboard-adjudication-workbench-route-telemetry-prd	none	ONE	issue-loop + review	issue-loop	issue adjudication
spec-076-distribution-integration-model-asset-update-convergence	none	ONE	distribution	distribution	asset update
spec-077-dashboard-execution-read-surface-prd-21-f3	none	ONE	execution	execution	dashboard execution read
spec-078-dashboard-multi-project-mount-registry-machine-scope	none	ONE	distribution	distribution	multi-project setup
spec-079-audit-hardening-link-provenance-actor-fidelity-tamper	none	ONE	corpus	corpus	audit link provenance
spec-080-bootstrap-injection-projection-tier-1-tier-2-payload	none	NOT-PRODUCT	governance	governance	bootstrap injection
spec-080-prd-as-outline-contract-structured-outline-domain	none	NOT-PRODUCT	governance	governance	PRD outline contract
spec-081-audit-hardening-part-2-gate-skip-observability-push	none	NOT-PRODUCT	governance	governance	gate-skip audit
spec-083-governance-prose-runtime-injection-retire-the	none	NOT-PRODUCT	governance	governance	governance prose injection
spec-084-corpus-allocated-ordinal-identity-store-atomic-spec	none	NOT-PRODUCT	governance	governance	spec numbering
spec-085-seat-briefing-runtime-injection-retire-the-installed	none	NOT-PRODUCT	governance	governance	seat briefing injection
spec-a-conclusion-with-no-currency-signal-and-no-falsifier	none	NOT-PRODUCT	governance	governance	spec retrieval rule
spec-a-falsifier-s-scratch-worktree-must-be-runnable-and	none	NOT-PRODUCT	governance	governance	falsifier worktree
spec-a-github-filed-defect-must-be-claimable-one-ingest-seam	none	ONE	issue-loop	issue-loop	GitHub issue ingestion
spec-a-test-case-s-timeout-budget-must-be-declared-when-its	none	NOT-PRODUCT	governance	governance	test timeout budget
spec-a-write-side-fact-with-no-read-side-address-counts-with-no	none	NOT-PRODUCT	governance	governance	fact address rule
spec-adr-decision-status-has-a-create-surface-and-no-cli-update	none	NOT-PRODUCT	governance	governance	ADR status surface
spec-ai-assistance-in-lore-set-and-lore-link	none	ONE	corpus	corpus	edit/link docs with AI
spec-an-escalate-blocks-approval-for-every-doc-type-and-the	none	ONE	review	review	escalate blocks approval
spec-assessment-freshness-plan-close-denies-a-stale-assessment	none	ONE	hygiene	hygiene	assessment freshness
spec-auth-agent-credentials	none	ONE	corpus	corpus	agent credentials
spec-bootstrap-fixpoint-integrity-binary-provenance-an-anchor	none	NOT-PRODUCT	governance	governance	bootstrap integrity
spec-built-in-ai-provider-for-lore-create	none	ONE	corpus	corpus	built-in AI provider
spec-cjk-aware-slugify-pinyin-transliteration-lore-set-slug-repa	none	ONE	corpus	corpus	revise doc slug
spec-claim-time-actor-identity-guard-zero-evidence-release-advis	none	ONE	execution	execution	claim actor identity
spec-claude-md-governance-content-dimension-checks-wire-the	none	NOT-PRODUCT	governance	governance	CLAUDE.md checks
spec-claude-md-root-section-structure-check-and-adoption-mode	none	NOT-PRODUCT	governance	governance	CLAUDE.md structure
spec-cli-adapter	none	NONE	infrastructure	infrastructure	CLI adapter
spec-context-fragments-config-driven-layered-rule-injection	none	ONE	context	context	context fragments injection
spec-context-provenance-injected-corpus-global-state-and-a	none	ONE	context	context	context provenance
spec-context-verb-family-two-zone-claude-md-anatomy-lore	none	MULTI	context + corpus	context	context verb family
spec-cookie-auth-cli-managed-local-bootstrap	none	ONE	distribution	distribution	cookie auth bootstrap
spec-corpus-governed-spec-production-loop-ioc-vertical-slice	none	NOT-PRODUCT	governance	governance	spec production loop
spec-corpus-resolution-carries-provenance-and-a-foreign-write	none	NONE	corpus-meta	corpus-meta	corpus resolution mechanism
spec-corpus-schema	none	NONE	infrastructure	infrastructure	corpus schema
spec-corpus-truthfulness-a-verdict-must-carry-the-state-it	none	NOT-PRODUCT	governance	governance	corpus state/verdict integrity rule
spec-dashboard-production-packaging-one-command-lore-dashboard	none	ONE	distribution	distribution	package dashboard
spec-dashboard-read-only-skeleton	none	ONE	corpus	corpus	dashboard read-only UI
spec-dashboard-write-ui-create-edit-approve-link	none	ONE	corpus + review	corpus	dashboard write UI
spec-declared-scope-attestation-contract-task-owned-ac-scope	none	ONE	execution	execution	ac_scope attestation
spec-declaring-ac-scope-is-required-at-task-creation-so-the	none	ONE	execution	execution	declare ac_scope at task creation
spec-default-no-ai-for-agent-and-mcp-execution-paths	none	NOT-PRODUCT	governance	governance	default --no-ai
spec-dispatch-isolation-must-be-enforced-by-a-gate-and	none	NOT-PRODUCT	governance	governance	dispatch isolation gate
spec-domain-overview-autonomous-feedback-loop-ai-review-data-driven-self-optimization	none	NONE	domain-overview	domain-overview	branch narrative
spec-domain-overview-dashboard-console-admin-console-evolution-adjudication-workbench-first	none	NONE	domain-overview	domain-overview	branch narrative
spec-domain-overview-dashboard-multi-project-single-instance-switcher-over-the-machine-s-registered-corpora	none	NONE	domain-overview	domain-overview	branch narrative
spec-domain-overview-distribution-adoption-phased-spike-gated-one-step-install	none	NONE	domain-overview	domain-overview	branch narrative
spec-domain-overview-extension-hooks-system-direction-pointer-only-no-commitment	none	NONE	domain-overview	domain-overview	branch narrative
spec-domain-overview-memory-hygiene-knowledge-trustworthiness-over-time	none	NONE	domain-overview	domain-overview	branch narrative
spec-domain-overview-output-contract-document-taxonomy	none	NONE	domain-overview	domain-overview	branch narrative
spec-domain-overview-phase-execution-model-plan-phase-checklist-supersedes-fine-grained-task-pre-decomposition	none	NONE	domain-overview	domain-overview	branch narrative
spec-domain-overview-provenance	none	NONE	domain-overview	domain-overview	branch narrative
spec-domain-overview-session-layer-multi-session-collaboration-context-continuity	none	NONE	domain-overview	domain-overview	branch narrative
spec-domain-overview-upstream-issue-feedback-loop-consumer-reported-defects-corpus	none	NONE	domain-overview	domain-overview	branch narrative
spec-eager-libsql-load-makes-every-command-depend-on-a-healthy	none	NONE	infrastructure	infrastructure	libsql load
spec-eval-framework	none	NONE	infrastructure	infrastructure	eval framework
spec-evidence-output-tail-integrity-a-self-reported-non-pass	none	NOT-PRODUCT	governance	governance	evidence integrity
spec-falsifiability-reachability-a-feedable-checkpoint-an	none	NOT-PRODUCT	governance	governance	falsifiability
spec-git-safety-gate-probes-report-the-wrong-blast-radius	none	NOT-PRODUCT	governance	governance	git safety probe
spec-governance-defaults-must-ship-and-every-recorded-gap-must	none	NOT-PRODUCT	governance	governance	governance defaults
spec-governance-visibility-an-armed-gate-that-vacuously-passes	none	NOT-PRODUCT	governance	governance	gate visibility
spec-governance-weight-must-scale-with-measured-blast-radius-a	none	NOT-PRODUCT	governance	governance	gate weight
spec-http-api-adapter	none	NONE	infrastructure	infrastructure	HTTP adapter
spec-http-backed-ai-provider-alongside-claude-cli	none	ONE	corpus	corpus	AI provider
spec-issue-closure-loop-computed-resolution-agent-reachable	none	ONE	issue-loop	issue-loop	issue closure
spec-judgment-surfaces-must-verify-before-they-certify-machine	none	NOT-PRODUCT	governance	governance	judgment surfaces
spec-lifecycle-archival-plan-close-cascade-deterministic	none	ONE	execution	execution	plan closure
spec-lore-ac-set-in-place-edit-of-a-declared-acceptance	none	ONE	specification	specification	ac set edit
spec-lore-assess-ai-plan-outcome-assessment-llm-as-judge-feedbac	none	ONE	autonomy	autonomy	lore assess LLM judge
spec-lore-assess-project-evidence-rows-instead-of-embedding-the	none	ONE	autonomy	autonomy	assess evidence rows
spec-lore-export-docs-reverse-sync-from-corpus-to-spec-files	none	ONE	distribution	distribution	export docs
spec-lore-issues-falls-through-to-the-local-corpus-on-a-retired	none	ONE	issue-loop	issue-loop	lore issues command
spec-lore-phase-add-and-phase-rm-mutate-a-plan-s-declared	none	ONE	execution	execution	phase mutations
spec-lore-setup-deletes-repo-source-through-dev-symlinks	none	ONE	distribution	distribution	setup symlink safety
spec-lore-sync-docs-backfill-new-spec-files-into-corpus	none	ONE	sync	sync	sync new spec files
spec-mcp-server-adapter	none	NONE	infrastructure	infrastructure	MCP adapter
spec-migration-v1	none	NONE	infrastructure	infrastructure	v1 migration
spec-mirror-identifier-ssot-one-writer-for-export-index-human	none	NOT-PRODUCT	governance	governance	mirror ID SSOT
spec-monorepo-skeleton-bun-workspaces-p1-layout	none	NONE	infrastructure	infrastructure	monorepo layout
spec-multi-session-concurrency-queryable-ownership-checkout	none	ONE	execution	execution	multi-session concurrency
spec-oracle-exclusivity-in-a-shared-checkout-a-mirror-check	none	NOT-PRODUCT	governance	governance	oracle exclusivity
spec-oracle-executability-a-runner-s-discovery-refusal-is-not-a	none	NOT-PRODUCT	governance	governance	oracle executability
spec-oracle-tier-falsifiability-a-criterion-never-observed-red	none	NOT-PRODUCT	governance	governance	oracle falsifiability
spec-out-of-box-reporting-channel-report-issue-self-provisions	none	ONE	issue-loop	issue-loop	report-issue self-provision
spec-p2-workflow-state-machine-checkpoint-registry-cross-tier-pr	none	NOT-PRODUCT	governance	governance	workflow state machine
spec-p4-upstream-downstream-linkage-feed-before-produce-protocol	none	NOT-PRODUCT	governance	governance	feed protocol
spec-plan-close-predicates-measure-invariants-an-applicability	none	ONE	execution	execution	plan close predicates
spec-plan-closure-must-be-loud-terminality-divergence-silent	none	ONE	execution	execution	loud plan closure
spec-plan-phases-as-a-first-class-grouping-layer	none	ONE	execution	execution	plan phases
spec-prd-as-living-root	none	NONE	baseline-meta	baseline-meta	PRD as root
spec-project-claude-md-content-contract-governance-injected	none	MULTI	distribution + context	distribution	CLAUDE.md contract
spec-report-issue-has-no-specified-concurrency-contract-ac-072	none	ONE	issue-loop	issue-loop	report-issue concurrency
spec-resume-coverage-floor-the-satisfaction-boundaries-a	none	ONE	session	session	resume coverage
spec-resume-ticket-coverage-a-shipped-upper-bound-left-the	none	ONE	session	session	resume ticket coverage
spec-resume-ticket-coverage-floor-blocking-channel-arming	none	ONE	session	session	resume ticket floor
spec-review-workflow	none	ONE	review	review	review workflow
spec-service-layer-architecture	none	NONE	infrastructure	infrastructure	service layer arch
spec-session-start-handoff-neutrality-injection-drops-resume	none	ONE	session	session	handoff neutrality
spec-spec-027-dashboard-hardening-write-path-integrity-delete-re	none	NOT-PRODUCT	governance	governance	dashboard integrity tests
spec-spec-028-assess-input-transparency-pre-flight-diff-budgetin	none	NOT-PRODUCT	governance	governance	assess transparency
spec-spec-029-assess-reliability-reasoning-length-resilience-sur	none	NOT-PRODUCT	governance	governance	assess reliability
spec-spec-030-hermetic-judge-sessions-fail-loud-ai-config	none	NOT-PRODUCT	governance	governance	hermetic judge
spec-spec-031-dashboard-read-path-contract-fixes-markdown-typogr	none	ONE	corpus	corpus	dashboard read path fixes
spec-spec-032-output-contract-mechanization-spec-kind-tree-bluep	none	NOT-PRODUCT	governance	governance	output contract spec
spec-spec-033-dashboard-as-living-prd-projection-human-adjudicat	none	ONE	corpus	corpus	dashboard PRD projection
spec-spec-034-structured-review-judgment-triage-queue	none	ONE	review	review	review judgment queue
spec-spec-035-audit-trail-calibration-data	none	NOT-PRODUCT	governance	governance	audit trail
spec-spec-036-dashboard-browsing-ux-breadcrumb-tag-status-filter	none	ONE	corpus	corpus	dashboard browsing UX
spec-spec-037-dashboard-execution-tracking-surface-readiness-rou	none	ONE	execution	execution	dashboard execution tracking
spec-spec-038-ac-as-code-structured-acceptance-criteria-oracle-b	none	ONE	specification	specification	AC-as-code
spec-spec-039-trusted-runner-attested-evidence-for-script-mode-a	none	ONE	execution	execution	trusted runner/evidence
spec-spec-040-assessment-dimension-framework-v2-facts-judgment-s	none	ONE	autonomy	autonomy	assessment framework
spec-spec-041-session-layer-part-1-bootstrap-pointer-set-lossles	none	ONE	session	session	bootstrap handoff
spec-spec-042-session-layer-part-2-session-registry-file-anchor	none	ONE	session	session	session registry
spec-spec-043-memory-hygiene-part-1-bi-temporal-invalidation-h1	none	ONE	hygiene	hygiene	doc invalidation
spec-spec-044-memory-hygiene-part-2-staleness-probes-h2	none	ONE	hygiene	hygiene	staleness probes
spec-spec-045-memory-hygiene-part-3-doc-code-drift-oracle-h3	none	ONE	hygiene	hygiene	doc-code drift oracle
spec-spec-046-distribution-part-1-asset-ssot-local-safe-installe	none	ONE	distribution	distribution	asset SSOT
spec-spec-047-session-seat-auto-briefing-worktree-aware-sessions	none	ONE	session	session	seat briefing
spec-spec-048-distribution-part-2-npm-single-platform-publish-tt	none	ONE	distribution	distribution	npm publish
spec-spec-049-gate-denials-carry-the-feeding-pack-gateenforcer-e	none	NOT-PRODUCT	governance	governance	gate feeding pack
spec-spec-050-gate-hooks-cross-corpus-false-deny-fix-cd-prefix-t	none	NOT-PRODUCT	governance	governance	gate hooks fix
spec-spec-051-cli-strict-flags-unknown-flag-rejection-actor-flag	none	NOT-PRODUCT	governance	governance	cli flag hardening
spec-spec-053-ai-advisory-ac-vagueness-supplement-on-lore-review	none	ONE	autonomy	autonomy	AI advisory on AC
spec-spec-054-uat-verdict-as-plan-close-gate	none	ONE	autonomy	autonomy	UAT verdict gate
spec-spec-055-requirement-ac-completeness-oracle	none	ONE	specification	specification	AC completeness
spec-spec-056-phase-execution-model-phase-doc-type-computed-comp	none	ONE	execution	execution	phase execution model
spec-spec-057-two-tier-worktree-seat-model-lore-seat-verb-seat-a	none	ONE	session	session	seat model
spec-spec-058-verification-profiles-per-spec-kind-oracle-coverag	none	ONE	specification	specification	verification profiles
spec-spec-059-requirement-layer-quantifiability-lint-close-spec	none	ONE	specification	specification	quantifiability lint
spec-spec-060-lore-setup-project-scaffold-completion-repo-level	none	ONE	distribution	distribution	project setup
spec-spec-061-attestation-completeness-guard-detect-zero-match-u	none	NOT-PRODUCT	governance	governance	attestation guard
spec-spec-062-config-write-layer-configservice-http-surface-and	none	ONE	corpus	corpus	config write
spec-spec-063-verify-execution-root-correctness-under-linked-wor	none	NOT-PRODUCT	governance	governance	verify worktree
spec-spec-064-dashboard-settings-ui-two-scope-config-editing-wit	none	ONE	corpus	corpus	dashboard settings UI
spec-spec-065-cli-ergonomics-unique-id-prefix-resolution-single	none	ONE	specification	specification	spec ID prefix resolution
spec-spec-066-git-safety-gate-heredoc-string-literal-awareness-c	none	NOT-PRODUCT	governance	governance	git safety gate
spec-spec-067-ai-surface-robustness-assess-timeout-floor-partial	none	NOT-PRODUCT	governance	governance	assess robustness
spec-spec-069-execution-time-attestation-floor-ad-hoc-task-chann	none	ONE	execution	execution	attestation floor
spec-spec-ac-quantifiability-gate-design-time-standardization-en	none	ONE	specification	specification	AC quantifiability
spec-strict-flag-hardening-single-dash-multi-char-tokens-fail	none	NOT-PRODUCT	governance	governance	flag hardening
spec-superseded-handoff-archival-has-no-recency-guard	none	ONE	session	session	handoff archival
spec-sync-engine-turso	none	ONE	sync	sync	Turso sync engine
spec-task-execution-workflow-metadata-evidence-claim-ready	none	ONE	execution	execution	task execution workflow
spec-telemetry-module	none	NONE	infrastructure	infrastructure	telemetry
spec-the-defect-channel-cannot-be-honestly-maintained-an	none	NONE	issue-meta	issue-meta	defect channel design flaw
spec-the-defect-channel-reaches-no-machine-but-its-own-github	none	ONE	issue-loop	issue-loop	GitHub issue intake
spec-the-mirror-oracles-two-command-surfaces-are-o-corpus-by	none	NOT-PRODUCT	governance	governance	mirror oracle
spec-the-retired-shape-refusal-message-has-two-byte-identical	none	NOT-PRODUCT	governance	governance	refusal message
spec-tiered-review-ledger-fast-track-judgment-required-promote	none	ONE	review	review	tiered review ledger
spec-trace-layer-read-deny-observability-table-default-on-with	none	NOT-PRODUCT	governance	governance	trace layer
spec-two-runner-changed-test-selection-deterministic-test	none	NOT-PRODUCT	governance	governance	test selection
spec-typecheck-coverage-two-named-blind-spots-and-the-stale	none	NOT-PRODUCT	governance	governance	typecheck coverage
spec-upstream-asset-ization-prompt-skill-as-first-class-knowledg	none	ONE	distribution	distribution	asset types
spec-verify-reachability-plan-promote-early-warning	none	NOT-PRODUCT	governance	governance	verify reachability
spec-version-history	none	NONE	infrastructure	infrastructure	version history
spec-version-snapshots-capture-slug-values-spec-068-d5-follow-up	none	NONE	infrastructure	infrastructure	version snapshots
spec-workflow-hardening-evidence-red-vocabulary-claim-worktree	none	NOT-PRODUCT	governance	governance	workflow hardening
spec-worktree-derived-actor-identity-agent-branch-as	none	NOT-PRODUCT	governance	governance	actor identity

````

## mapping/a1-rerun.tsv

````text
slug	kind	bucket	branch	leaf	note
spec-070-deterministic-task-dispatch-bundle-lore-feed-task-start		ONE	execution	dispatch-to-agent	task dispatch bundle
spec-071-execution-liveness-signals-session-actor-tier-evidence		ONE	execution	claim-safety	multi-session safety
spec-072-upstream-issue-reporting-lore-report-issue-consumer		ONE	issue-loop	report-defect	lore report-issue command
spec-073-report-issue-trigger-surfaces-error-path-hints		ONE	issue-loop	report-defect	error-path hint triggers
spec-074-dashboard-issues-triage-surface-badge-list-in-place		ONE	issue-loop	triage	issue triage UI
spec-075-dashboard-adjudication-workbench-route-telemetry-prd		ONE	review	adjudicate	evidence-grounded adjudication
spec-076-distribution-integration-model-asset-update-convergence		ONE	distribution	publish-release	asset convergence
spec-077-dashboard-execution-read-surface-prd-21-f3		ONE	execution	track-progress	execution read surface
spec-078-dashboard-multi-project-mount-registry-machine-scope		ONE	distribution	register-project	multi-project routing
spec-079-audit-hardening-link-provenance-actor-fidelity-tamper		ONE	execution	record-evidence	needs manual review
spec-080-bootstrap-injection-projection-tier-1-tier-2-payload		ONE	session	resume	needs manual review
spec-080-prd-as-outline-contract-structured-outline-domain		ONE	corpus	create-doc	PRD-as-outline contract
spec-081-audit-hardening-part-2-gate-skip-observability-push		ONE	execution	record-evidence	gate-skip observability
spec-083-governance-prose-runtime-injection-retire-the		ONE	context	inject-rules	governance prose injection
spec-084-corpus-allocated-ordinal-identity-store-atomic-spec		ONE	corpus	create-doc	allocated ordinal identity
spec-085-seat-briefing-runtime-injection-retire-the-installed		ONE	session	enter-seat	seat briefing injection
spec-a-conclusion-with-no-currency-signal-and-no-falsifier		NOT-PRODUCT			oracle/test spec
spec-a-falsifier-s-scratch-worktree-must-be-runnable-and		NOT-PRODUCT			falsifier spec
spec-a-github-filed-defect-must-be-claimable-one-ingest-seam		NOT-PRODUCT			GitHub defect ingest (repo-only test)
spec-a-test-case-s-timeout-budget-must-be-declared-when-its		NOT-PRODUCT			test timeout oracle
spec-a-write-side-fact-with-no-read-side-address-counts-with-no		NOT-PRODUCT			oracle coverage spec
spec-adr-decision-status-has-a-create-surface-and-no-cli-update		ONE	specification	declare-ac	ADR decision status
spec-ai-assistance-in-lore-set-and-lore-link		ONE	corpus	revise-doc	AI assistance in set/link
spec-an-escalate-blocks-approval-for-every-doc-type-and-the		ONE	review	submit-for-review	escalate gate
spec-assessment-freshness-plan-close-denies-a-stale-assessment		ONE	review	adjudicate	assessment freshness
spec-auth-agent-credentials		NONE			auth infrastructure
spec-bootstrap-fixpoint-integrity-binary-provenance-an-anchor		NOT-PRODUCT			bootstrap binary verification (repo-internal)
spec-built-in-ai-provider-for-lore-create		ONE	corpus	create-doc	built-in AI provider
spec-cjk-aware-slugify-pinyin-transliteration-lore-set-slug-repa		ONE	corpus	create-doc	CJK slug handling
spec-claim-time-actor-identity-guard-zero-evidence-release-advis		ONE	execution	claim-safety	actor identity guard
spec-claude-md-governance-content-dimension-checks-wire-the		NONE			needs manual review
spec-claude-md-root-section-structure-check-and-adoption-mode		NONE			needs manual review
spec-cli-adapter		NONE			CLI adapter infrastructure
spec-context-fragments-config-driven-layered-rule-injection		ONE	context	inject-rules	context fragments injection
spec-context-provenance-injected-corpus-global-state-and-a		ONE	context	inject-rules	context provenance
spec-context-verb-family-two-zone-claude-md-anatomy-lore		ONE	context	inject-rules	context verb family
spec-cookie-auth-cli-managed-local-bootstrap		NONE			auth infrastructure
spec-corpus-governed-spec-production-loop-ioc-vertical-slice		ONE	corpus	create-doc	spec production loop
spec-corpus-resolution-carries-provenance-and-a-foreign-write		ONE	corpus	revise-doc	resolution provenance
spec-corpus-schema		NONE			corpus data model
spec-corpus-truthfulness-a-verdict-must-carry-the-state-it		NONE			corpus truthfulness property
spec-dashboard-production-packaging-one-command-lore-dashboard		ONE	distribution	publish-release	needs manual review
spec-dashboard-read-only-skeleton		ONE	corpus	create-doc	dashboard read UI
spec-dashboard-write-ui-create-edit-approve-link		ONE	corpus	revise-doc	dashboard write UI
spec-declared-scope-attestation-contract-task-owned-ac-scope		ONE	specification	declare-ac	declared AC scope
spec-declaring-ac-scope-is-required-at-task-creation-so-the		ONE	specification	declare-ac	AC scope requirement
spec-default-no-ai-for-agent-and-mcp-execution-paths		NONE			AI default config
spec-dispatch-isolation-must-be-enforced-by-a-gate-and		ONE	execution	dispatch-to-agent	dispatch isolation gate
spec-domain-overview-autonomous-feedback-loop-ai-review-data-driven-self-optimization		NONE			domain overview narrative
spec-domain-overview-dashboard-console-admin-console-evolution-adjudication-workbench-first		NONE			domain overview narrative
spec-domain-overview-dashboard-multi-project-single-instance-switcher-over-the-machine-s-registered-corpora		NONE			domain overview narrative
spec-domain-overview-distribution-adoption-phased-spike-gated-one-step-install		NONE			needs manual review
spec-domain-overview-extension-hooks-system-direction-pointer-only-no-commitment		NONE			domain overview narrative
spec-domain-overview-memory-hygiene-knowledge-trustworthiness-over-time		NONE			domain overview narrative
spec-domain-overview-output-contract-document-taxonomy		NONE			domain overview narrative
spec-domain-overview-phase-execution-model-plan-phase-checklist-supersedes-fine-grained-task-pre-decomposition		NONE			domain overview narrative
spec-domain-overview-provenance		NONE			domain overview narrative
spec-domain-overview-session-layer-multi-session-collaboration-context-continuity		NONE			domain overview narrative
spec-domain-overview-upstream-issue-feedback-loop-consumer-reported-defects-corpus		NONE			needs manual review
spec-eager-libsql-load-makes-every-command-depend-on-a-healthy		NONE			libsql/storage infrastructure
spec-eval-framework		NONE			eval framework (repo-internal)
spec-evidence-output-tail-integrity-a-self-reported-non-pass		ONE	execution	record-evidence	needs manual review
spec-falsifiability-reachability-a-feedable-checkpoint-an		NOT-PRODUCT			oracle-level spec
spec-git-safety-gate-probes-report-the-wrong-blast-radius		NONE			needs manual review
spec-governance-defaults-must-ship-and-every-recorded-gap-must		ONE	distribution	setup-converge	governance defaults
spec-governance-visibility-an-armed-gate-that-vacuously-passes		NONE			governance infrastructure
spec-governance-weight-must-scale-with-measured-blast-radius-a		NONE			governance infrastructure
spec-http-api-adapter		NONE			HTTP API adapter infrastructure
spec-http-backed-ai-provider-alongside-claude-cli		ONE	corpus	create-doc	needs manual review
spec-issue-closure-loop-computed-resolution-agent-reachable		ONE	issue-loop	triage	issue closure
spec-judgment-surfaces-must-verify-before-they-certify-machine		NOT-PRODUCT			oracle/verification spec
spec-lifecycle-archival-plan-close-cascade-deterministic		ONE	execution	close-plan	plan archival cascade
spec-lore-ac-set-in-place-edit-of-a-declared-acceptance		ONE	specification	declare-ac	AC in-place edit
spec-lore-assess-ai-plan-outcome-assessment-llm-as-judge-feedbac		ONE	autonomy	record-judgment	AI plan assessment
spec-lore-assess-project-evidence-rows-instead-of-embedding-the		ONE	autonomy	record-judgment	assess evidence
spec-lore-export-docs-reverse-sync-from-corpus-to-spec-files		NOT-PRODUCT			export mirror (repo-internal)
spec-lore-issues-falls-through-to-the-local-corpus-on-a-retired		NONE			issue command fallback
spec-lore-phase-add-and-phase-rm-mutate-a-plan-s-declared		ONE	execution	create-phase	phase add/rm
spec-lore-setup-deletes-repo-source-through-dev-symlinks		NONE			setup infrastructure (repo-internal)
spec-lore-sync-docs-backfill-new-spec-files-into-corpus		NONE			file sync infrastructure
spec-mcp-server-adapter		NONE			MCP adapter infrastructure
spec-migration-v1		NONE			v1 migration (repo-internal)
spec-mirror-identifier-ssot-one-writer-for-export-index-human		NOT-PRODUCT			mirror identifier (repo-internal)
spec-monorepo-skeleton-bun-workspaces-p1-layout		NOT-PRODUCT			repo monorepo layout (repo-internal)
spec-multi-session-concurrency-queryable-ownership-checkout		ONE	session	manage-sessions	multi-session concurrency
spec-oracle-exclusivity-in-a-shared-checkout-a-mirror-check		NOT-PRODUCT			oracle-level spec
spec-oracle-executability-a-runner-s-discovery-refusal-is-not-a		NOT-PRODUCT			oracle-level spec
spec-oracle-tier-falsifiability-a-criterion-never-observed-red		NOT-PRODUCT			oracle-level spec
spec-out-of-box-reporting-channel-report-issue-self-provisions		ONE	issue-loop	report-defect	out-of-box reporting
spec-p2-workflow-state-machine-checkpoint-registry-cross-tier-pr		ONE	execution	dispatch-to-agent	checkpoint registry
spec-p4-upstream-downstream-linkage-feed-before-produce-protocol		ONE	execution	dispatch-to-agent	feed-before-produce
spec-plan-close-predicates-measure-invariants-an-applicability		ONE	execution	close-plan	plan-close predicates
spec-plan-closure-must-be-loud-terminality-divergence-silent		ONE	execution	close-plan	plan closure
spec-plan-phases-as-a-first-class-grouping-layer		ONE	execution	create-phase	phases grouping
spec-prd-as-living-root		ONE	corpus	create-doc	PRD-as-living-root
spec-project-claude-md-content-contract-governance-injected		NONE			needs manual review
spec-report-issue-has-no-specified-concurrency-contract-ac-072		ONE	issue-loop	triage	report-issue concurrency
spec-resume-coverage-floor-the-satisfaction-boundaries-a		ONE	session	resume	resume coverage
spec-resume-ticket-coverage-a-shipped-upper-bound-left-the		ONE	session	resume	resume ticket coverage
spec-resume-ticket-coverage-floor-blocking-channel-arming		ONE	session	resume	resume ticket floor
spec-review-workflow		NONE			review status lifecycle
spec-service-layer-architecture		NONE			service layer architecture
spec-session-start-handoff-neutrality-injection-drops-resume		ONE	session	resume	session-start neutrality
spec-spec-027-dashboard-hardening-write-path-integrity-delete-re		ONE	corpus	revise-doc	dashboard write hardening
spec-spec-028-assess-input-transparency-pre-flight-diff-budgetin		ONE	autonomy	record-judgment	assess transparency
spec-spec-029-assess-reliability-reasoning-length-resilience-sur		ONE	autonomy	record-judgment	assess reliability
spec-spec-030-hermetic-judge-sessions-fail-loud-ai-config		ONE	autonomy	record-judgment	hermetic judge sessions
spec-spec-031-dashboard-read-path-contract-fixes-markdown-typogr		ONE	corpus	create-doc	dashboard read-path fixes
spec-spec-032-output-contract-mechanization-spec-kind-tree-bluep		NONE			output contract/spec kind
spec-spec-033-dashboard-as-living-prd-projection-human-adjudicat		ONE	corpus	create-doc	dashboard PRD projection
spec-spec-034-structured-review-judgment-triage-queue		ONE	review	adjudicate	structured review/triage
spec-spec-035-audit-trail-calibration-data		ONE	autonomy	record-judgment	audit trail/calibration
spec-spec-036-dashboard-browsing-ux-breadcrumb-tag-status-filter		ONE	corpus	create-doc	needs manual review
spec-spec-037-dashboard-execution-tracking-surface-readiness-rou		ONE	execution	track-progress	execution tracking UI
spec-spec-038-ac-as-code-structured-acceptance-criteria-oracle-b		ONE	specification	declare-ac	structured acceptance criteria
spec-spec-039-trusted-runner-attested-evidence-for-script-mode-a		ONE	execution	verify	attested evidence
spec-spec-040-assessment-dimension-framework-v2-facts-judgment-s		ONE	autonomy	record-judgment	assessment framework v2
spec-spec-041-session-layer-part-1-bootstrap-pointer-set-lossles		ONE	session	resume	bootstrap pointer set
spec-spec-042-session-layer-part-2-session-registry-file-anchor		ONE	session	manage-sessions	session registry
spec-spec-043-memory-hygiene-part-1-bi-temporal-invalidation-h1		ONE	hygiene	mark-stale	needs manual review
spec-spec-044-memory-hygiene-part-2-staleness-probes-h2		ONE	hygiene	mark-stale	needs manual review
spec-spec-045-memory-hygiene-part-3-doc-code-drift-oracle-h3		ONE	hygiene	mark-stale	needs manual review
spec-spec-046-distribution-part-1-asset-ssot-local-safe-installe		?			needs manual review
spec-spec-047-session-seat-auto-briefing-worktree-aware-sessions		ONE	session	enter-seat	session seat briefing
spec-spec-048-distribution-part-2-npm-single-platform-publish-tt		ONE	distribution	publish-release	npm publish
spec-spec-049-gate-denials-carry-the-feeding-pack-gateenforcer-e		ONE	execution	dispatch-to-agent	gate denial feeding pack
spec-spec-050-gate-hooks-cross-corpus-false-deny-fix-cd-prefix-t		ONE	distribution	setup-converge	gate hooks fix
spec-spec-051-cli-strict-flags-unknown-flag-rejection-actor-flag		NONE			CLI flag infrastructure
spec-spec-053-ai-advisory-ac-vagueness-supplement-on-lore-review		ONE	review	submit-for-review	AI-advisory AC supplement
spec-spec-054-uat-verdict-as-plan-close-gate		ONE	review	adjudicate	UAT verdict gate
spec-spec-055-requirement-ac-completeness-oracle		ONE	specification	declare-ac	requirement→AC oracle
spec-spec-056-phase-execution-model-phase-doc-type-computed-comp		ONE	execution	create-phase	phase execution model
spec-spec-057-two-tier-worktree-seat-model-lore-seat-verb-seat-a		ONE	session	enter-seat	two-tier worktree seat model
spec-spec-058-verification-profiles-per-spec-kind-oracle-coverag		ONE	specification	declare-ac	verification profiles
spec-spec-059-requirement-layer-quantifiability-lint-close-spec		ONE	specification	declare-ac	requirement quantifiability
spec-spec-060-lore-setup-project-scaffold-completion-repo-level		ONE	distribution	setup-converge	project setup scaffold
spec-spec-061-attestation-completeness-guard-detect-zero-match-u		ONE	execution	verify	attestation guard
spec-spec-062-config-write-layer-configservice-http-surface-and		NONE			config write infrastructure
spec-spec-063-verify-execution-root-correctness-under-linked-wor		ONE	execution	verify	verify execution root
spec-spec-064-dashboard-settings-ui-two-scope-config-editing-wit		ONE	corpus	revise-doc	settings UI
spec-spec-065-cli-ergonomics-unique-id-prefix-resolution-single		NONE			CLI ergonomics (infrastructure)
spec-spec-066-git-safety-gate-heredoc-string-literal-awareness-c		NONE			needs manual review
spec-spec-067-ai-surface-robustness-assess-timeout-floor-partial		ONE	autonomy	record-judgment	needs manual review
spec-spec-069-execution-time-attestation-floor-ad-hoc-task-chann		ONE	execution	record-evidence	attestation floor
spec-spec-ac-quantifiability-gate-design-time-standardization-en		ONE	specification	declare-ac	needs manual review
spec-strict-flag-hardening-single-dash-multi-char-tokens-fail		NONE			CLI flag validation infrastructure
spec-superseded-handoff-archival-has-no-recency-guard		ONE	session	write-handoff	handoff archival
spec-sync-engine-turso		NONE			sync engine/storage infrastructure
spec-task-execution-workflow-metadata-evidence-claim-ready		ONE	execution	record-evidence	evidence/claim metadata
spec-telemetry-module		NONE			telemetry/logging infrastructure
spec-the-defect-channel-cannot-be-honestly-maintained-an		NOT-PRODUCT			GitHub defect channel (repo infrastructure)
spec-the-defect-channel-reaches-no-machine-but-its-own-github		NOT-PRODUCT			GitHub defect channel (repo infrastructure)
spec-the-mirror-oracles-two-command-surfaces-are-o-corpus-by		NOT-PRODUCT			mirror oracle spec
spec-the-retired-shape-refusal-message-has-two-byte-identical		NOT-PRODUCT			oracle spec
spec-tiered-review-ledger-fast-track-judgment-required-promote		ONE	review	submit-for-review	tiered review ledger
spec-trace-layer-read-deny-observability-table-default-on-with		NONE			trace/observability infrastructure
spec-two-runner-changed-test-selection-deterministic-test		NOT-PRODUCT			test runner selection (repo-internal)
spec-typecheck-coverage-two-named-blind-spots-and-the-stale		NOT-PRODUCT			typecheck oracle (repo-internal)
spec-upstream-asset-ization-prompt-skill-as-first-class-knowledg		ONE	corpus	create-doc	needs manual review
spec-verify-reachability-plan-promote-early-warning		ONE	execution	verify	needs manual review
spec-version-history		NONE			version history model
spec-version-snapshots-capture-slug-values-spec-068-d5-follow-up		NONE			version model
spec-workflow-hardening-evidence-red-vocabulary-claim-worktree		ONE	execution	claim-safety	evidence red vocabulary
spec-worktree-derived-actor-identity-agent-branch-as		ONE	execution	claim-safety	needs manual review

````

## mapping/a4-x.tsv

````text
slug	home	branch_or_section	leaf_or_module	reason
spec-070-deterministic-task-dispatch-bundle-lore-feed-task-start	BASELINE	execution	dispatch task	Execution: task dispatch coordination
spec-071-execution-liveness-signals-session-actor-tier-evidence	BASELINE	execution	record evidence	Execution: evidence recording
spec-072-upstream-issue-reporting-lore-report-issue-consumer	BASELINE	issue-loop	report defect	Issue-loop: feedback
spec-073-report-issue-trigger-surfaces-error-path-hints	BASELINE	issue-loop	report defect	Issue-loop: feedback
spec-074-dashboard-issues-triage-surface-badge-list-in-place	BASELINE	review	approve doc	Review: adjudication
spec-075-dashboard-adjudication-workbench-route-telemetry-prd	BASELINE	review	approve doc	Review: adjudication
spec-076-distribution-integration-model-asset-update-convergence	BASELINE	distribution	publish release	Distribution: adoption
spec-077-dashboard-execution-read-surface-prd-21-f3	BASELINE	distribution	dashboard	Dashboard: user interface
spec-078-dashboard-multi-project-mount-registry-machine-scope	BASELINE	distribution	register project	Distribution: multi-project
spec-079-audit-hardening-link-provenance-actor-fidelity-tamper	BASELINE	corpus	link doc	Corpus: linking
spec-080-bootstrap-injection-projection-tier-1-tier-2-payload	ARCH	current-state	hooks	Bootstrap injection mechanism
spec-080-prd-as-outline-contract-structured-outline-domain	ARCH	standards	oracle-integrity	Standards rule: oracle-integrity
spec-081-audit-hardening-part-2-gate-skip-observability-push	BASELINE	execution	gate enforcement	Execution: gate observability
spec-083-governance-prose-runtime-injection-retire-the	ARCH	current-state	hooks	Governance injection infrastructure
spec-084-corpus-allocated-ordinal-identity-store-atomic-spec	BASELINE	corpus	document ops	Corpus: document management
spec-085-seat-briefing-runtime-injection-retire-the-installed	BASELINE	session	seat briefing	Session: seat auto-briefing
spec-a-conclusion-with-no-currency-signal-and-no-falsifier	BASELINE	execution	claim task	Execution: task claiming
spec-a-falsifier-s-scratch-worktree-must-be-runnable-and	BASELINE	specification	falsifier	Specification: falsifier
spec-a-github-filed-defect-must-be-claimable-one-ingest-seam	BASELINE	execution	claim task	Execution: task claiming
spec-a-test-case-s-timeout-budget-must-be-declared-when-its	NOT-PRODUCT			Internal testing/build infra
spec-a-write-side-fact-with-no-read-side-address-counts-with-no	ARCH	standards	oracle-integrity	Standards rule: oracle-integrity
spec-adr-decision-status-has-a-create-surface-and-no-cli-update	ARCH	standards	cli-conventions	Standards rule: cli-conventions
spec-ai-assistance-in-lore-set-and-lore-link	BASELINE	corpus	link doc	Corpus: linking
spec-an-escalate-blocks-approval-for-every-doc-type-and-the	BASELINE	review	approve doc	Review: escalation blocks
spec-assessment-freshness-plan-close-denies-a-stale-assessment	BASELINE	execution	assess	Execution: plan assessment
spec-auth-agent-credentials	ARCH	current-state	auth	Technical auth
spec-bootstrap-fixpoint-integrity-binary-provenance-an-anchor	BASELINE	session	bootstrap	Session: bootstrap
spec-built-in-ai-provider-for-lore-create	BASELINE	corpus	doc ops	Corpus: lore commands
spec-cjk-aware-slugify-pinyin-transliteration-lore-set-slug-repa	BASELINE	corpus	doc ops	Corpus: lore commands
spec-claim-time-actor-identity-guard-zero-evidence-release-advis	BASELINE	execution	record evidence	Execution: evidence recording
spec-claude-md-governance-content-dimension-checks-wire-the	BASELINE	context	claude.md	Context: CLAUDE.md governance
spec-claude-md-root-section-structure-check-and-adoption-mode	BASELINE	distribution	publish release	Distribution: adoption
spec-cli-adapter	ARCH	current-state	adapter-cli	Technical adapter-cli
spec-context-fragments-config-driven-layered-rule-injection	BASELINE	session	session layer	Session: multi-session
spec-context-provenance-injected-corpus-global-state-and-a	BASELINE	session	resume	Session: resumption
spec-context-verb-family-two-zone-claude-md-anatomy-lore	BASELINE	context	claude.md	Context: CLAUDE.md governance
spec-cookie-auth-cli-managed-local-bootstrap	ARCH	standards	cli-conventions	Standards rule: cli-conventions
spec-corpus-governed-spec-production-loop-ioc-vertical-slice	BASELINE	corpus	document ops	Corpus: document management
spec-corpus-resolution-carries-provenance-and-a-foreign-write	BASELINE	corpus	create doc	Corpus: resolution
spec-corpus-schema	ARCH	current-state	store	Technical store
spec-corpus-truthfulness-a-verdict-must-carry-the-state-it	BASELINE	corpus	document ops	Corpus: document management
spec-dashboard-production-packaging-one-command-lore-dashboard	ARCH	current-state	dashboard	Dashboard: implementation
spec-dashboard-read-only-skeleton	BASELINE	distribution	dashboard	Dashboard: user interface
spec-dashboard-write-ui-create-edit-approve-link	BASELINE	review	approve doc	Review: approval workflow
spec-declared-scope-attestation-contract-task-owned-ac-scope	BASELINE	execution	record evidence	Execution: evidence recording
spec-declaring-ac-scope-is-required-at-task-creation-so-the	BASELINE	execution	record evidence	Execution: evidence recording
spec-default-no-ai-for-agent-and-mcp-execution-paths	BASELINE	execution	gate enforcement	Execution: AI defaults
spec-dispatch-isolation-must-be-enforced-by-a-gate-and	BASELINE	execution	dispatch task	Execution: task dispatch coordination
spec-domain-overview-autonomous-feedback-loop-ai-review-data-driven-self-optimization	BASELINE	review	approve doc	Review: approval workflow
spec-domain-overview-dashboard-console-admin-console-evolution-adjudication-workbench-first	BASELINE	review	approve doc	Review: adjudication
spec-domain-overview-dashboard-multi-project-single-instance-switcher-over-the-machine-s-registered-corpora	BASELINE	distribution	register project	Distribution: multi-project
spec-domain-overview-distribution-adoption-phased-spike-gated-one-step-install	BASELINE	distribution	publish release	Distribution: adoption
spec-domain-overview-extension-hooks-system-direction-pointer-only-no-commitment	ARCH	current-state	hooks	Hooks extension system
spec-domain-overview-memory-hygiene-knowledge-trustworthiness-over-time	BASELINE	hygiene	drift detection	Hygiene: memory trustworthiness
spec-domain-overview-output-contract-document-taxonomy	BASELINE	specification	declare ac	Specification: output contract
spec-domain-overview-phase-execution-model-plan-phase-checklist-supersedes-fine-grained-task-pre-decomposition	BASELINE	corpus	invalidate	Corpus: invalidation
spec-domain-overview-provenance	BASELINE	corpus	link doc	Corpus: provenance tracking
spec-domain-overview-session-layer-multi-session-collaboration-context-continuity	BASELINE	session	session layer	Session: multi-session
spec-domain-overview-upstream-issue-feedback-loop-consumer-reported-defects-corpus	BASELINE	issue-loop	report defect	Issue-loop: feedback
spec-eager-libsql-load-makes-every-command-depend-on-a-healthy	ARCH	current-state	sync-engine	Technical: libsql loading
spec-eval-framework	ARCH	current-state	eval	Technical eval
spec-evidence-output-tail-integrity-a-self-reported-non-pass	ARCH	standards	oracle-integrity	Oracle output contract
spec-falsifiability-reachability-a-feedable-checkpoint-an	BASELINE	execution	task workflow	Execution: task management
spec-git-safety-gate-probes-report-the-wrong-blast-radius	NOT-PRODUCT			Internal governance tooling
spec-governance-defaults-must-ship-and-every-recorded-gap-must	BASELINE	hygiene	stale detection	Hygiene: memory
spec-governance-visibility-an-armed-gate-that-vacuously-passes	BASELINE	execution	gate enforcement	Execution: gate visibility
spec-governance-weight-must-scale-with-measured-blast-radius-a	BASELINE	execution	gate enforcement	Execution: gate governance
spec-http-api-adapter	ARCH	current-state	adapter-http	Technical adapter-http
spec-http-backed-ai-provider-alongside-claude-cli	ARCH	standards	cli-conventions	Standards rule: cli-conventions
spec-issue-closure-loop-computed-resolution-agent-reachable	BASELINE	issue-loop	report defect	Issue-loop: closure
spec-judgment-surfaces-must-verify-before-they-certify-machine	BASELINE	execution	verify	Execution: attestation
spec-lifecycle-archival-plan-close-cascade-deterministic	BASELINE	execution	task archival	Execution: plan closure
spec-lore-ac-set-in-place-edit-of-a-declared-acceptance	BASELINE	corpus	doc ops	Corpus: lore commands
spec-lore-assess-ai-plan-outcome-assessment-llm-as-judge-feedbac	BASELINE	execution	assess	Execution: plan assessment
spec-lore-assess-project-evidence-rows-instead-of-embedding-the	BASELINE	execution	record evidence	Execution: evidence recording
spec-lore-export-docs-reverse-sync-from-corpus-to-spec-files	BASELINE	corpus	document ops	Corpus: document management
spec-lore-issues-falls-through-to-the-local-corpus-on-a-retired	BASELINE	issue-loop	report defect	Issue-loop: feedback
spec-lore-phase-add-and-phase-rm-mutate-a-plan-s-declared	BASELINE	context	claude.md	Context: CLAUDE.md governance
spec-lore-setup-deletes-repo-source-through-dev-symlinks	BASELINE	distribution	publish release	Distribution: adoption
spec-lore-sync-docs-backfill-new-spec-files-into-corpus	BASELINE	distribution	publish release	Distribution: adoption
spec-mcp-server-adapter	ARCH	current-state	adapter-mcp	Technical adapter-mcp
spec-migration-v1	ARCH	current-state	storage	Technical storage
spec-mirror-identifier-ssot-one-writer-for-export-index-human	NOT-PRODUCT			Internal spec mirroring
spec-monorepo-skeleton-bun-workspaces-p1-layout	NOT-PRODUCT			Internal testing/build infra
spec-multi-session-concurrency-queryable-ownership-checkout	ARCH	standards	concurrency-safety	Standards rule: concurrency-safety
spec-oracle-exclusivity-in-a-shared-checkout-a-mirror-check	ARCH	standards	oracle-integrity	Standards rule: oracle-integrity
spec-oracle-executability-a-runner-s-discovery-refusal-is-not-a	ARCH	standards	oracle-integrity	Standards rule: oracle-integrity
spec-oracle-tier-falsifiability-a-criterion-never-observed-red	ARCH	standards	oracle-integrity	Standards rule: oracle-integrity
spec-out-of-box-reporting-channel-report-issue-self-provisions	BASELINE	issue-loop	report defect	Issue-loop: feedback
spec-p2-workflow-state-machine-checkpoint-registry-cross-tier-pr	BASELINE	execution	gate enforcement	Execution: workflow gates
spec-p4-upstream-downstream-linkage-feed-before-produce-protocol	BASELINE	execution	claim task	Execution: feed-before-produce
spec-plan-close-predicates-measure-invariants-an-applicability	BASELINE	execution	record evidence	Execution: evidence recording
spec-plan-closure-must-be-loud-terminality-divergence-silent	BASELINE	execution	task archival	Execution: plan closure determinism
spec-plan-phases-as-a-first-class-grouping-layer	BASELINE	execution	task grouping	Execution: phase grouping
spec-prd-as-living-root	BASELINE	corpus	create doc	Corpus: PRD as root
spec-project-claude-md-content-contract-governance-injected	BASELINE	context	claude.md	Context: CLAUDE.md governance
spec-report-issue-has-no-specified-concurrency-contract-ac-072	ARCH	standards	concurrency-safety	Standards rule: concurrency-safety
spec-resume-coverage-floor-the-satisfaction-boundaries-a	BASELINE	session	resume	Session: resumption
spec-resume-ticket-coverage-a-shipped-upper-bound-left-the	BASELINE	session	resume	Session: resumption
spec-resume-ticket-coverage-floor-blocking-channel-arming	BASELINE	session	resume	Session: resumption
spec-review-workflow	BASELINE	review	approve doc	Review: approval workflow
spec-service-layer-architecture	ARCH	current-state	service-layer	Technical service-layer
spec-session-start-handoff-neutrality-injection-drops-resume	BASELINE	session	write handoff	Session: handoff
spec-spec-027-dashboard-hardening-write-path-integrity-delete-re	BASELINE	distribution	dashboard	Dashboard: user interface
spec-spec-028-assess-input-transparency-pre-flight-diff-budgetin	BASELINE	execution	assess	Execution: plan assessment
spec-spec-029-assess-reliability-reasoning-length-resilience-sur	BASELINE	execution	assess	Execution: plan assessment
spec-spec-030-hermetic-judge-sessions-fail-loud-ai-config	BASELINE	session	session layer	Session: multi-session
spec-spec-031-dashboard-read-path-contract-fixes-markdown-typogr	BASELINE	distribution	dashboard	Dashboard: user interface
spec-spec-032-output-contract-mechanization-spec-kind-tree-bluep	BASELINE	specification	declare ac	Specification: output contract mechanization
spec-spec-033-dashboard-as-living-prd-projection-human-adjudicat	BASELINE	review	approve doc	Review: adjudication
spec-spec-034-structured-review-judgment-triage-queue	BASELINE	review	approve doc	Review: triage and judgment
spec-spec-035-audit-trail-calibration-data	BASELINE	execution	record evidence	Execution: audit trail
spec-spec-036-dashboard-browsing-ux-breadcrumb-tag-status-filter	BASELINE	distribution	dashboard	Dashboard: user interface
spec-spec-037-dashboard-execution-tracking-surface-readiness-rou	BASELINE	execution	record evidence	Execution: evidence recording
spec-spec-038-ac-as-code-structured-acceptance-criteria-oracle-b	ARCH	standards	oracle-integrity	Standards rule: oracle-integrity
spec-spec-039-trusted-runner-attested-evidence-for-script-mode-a	BASELINE	execution	record evidence	Execution: evidence recording
spec-spec-040-assessment-dimension-framework-v2-facts-judgment-s	BASELINE	execution	assess	Execution: plan assessment
spec-spec-041-session-layer-part-1-bootstrap-pointer-set-lossles	BASELINE	session	write handoff	Session: handoff
spec-spec-042-session-layer-part-2-session-registry-file-anchor	BASELINE	execution	claim task	Execution: task claiming
spec-spec-043-memory-hygiene-part-1-bi-temporal-invalidation-h1	BASELINE	hygiene	stale detection	Hygiene: memory
spec-spec-044-memory-hygiene-part-2-staleness-probes-h2	BASELINE	hygiene	stale detection	Hygiene: memory
spec-spec-045-memory-hygiene-part-3-doc-code-drift-oracle-h3	ARCH	standards	oracle-integrity	Standards rule: oracle-integrity
spec-spec-046-distribution-part-1-asset-ssot-local-safe-installe	BASELINE	distribution	publish release	Distribution: adoption
spec-spec-047-session-seat-auto-briefing-worktree-aware-sessions	BASELINE	session	seat briefing	Session: seat auto-briefing
spec-spec-048-distribution-part-2-npm-single-platform-publish-tt	BASELINE	distribution	publish release	Distribution: adoption
spec-spec-049-gate-denials-carry-the-feeding-pack-gateenforcer-e	BASELINE	execution	gate enforcement	Execution: gate error enrichment
spec-spec-050-gate-hooks-cross-corpus-false-deny-fix-cd-prefix-t	BASELINE	corpus	document ops	Corpus: document management
spec-spec-051-cli-strict-flags-unknown-flag-rejection-actor-flag	ARCH	standards	cli-conventions	Standards rule: cli-conventions
spec-spec-053-ai-advisory-ac-vagueness-supplement-on-lore-review	BASELINE	review	approve doc	Review: approval workflow
spec-spec-054-uat-verdict-as-plan-close-gate	BASELINE	execution	task archival	Execution: UAT gate
spec-spec-055-requirement-ac-completeness-oracle	ARCH	standards	oracle-integrity	Standards rule: oracle-integrity
spec-spec-056-phase-execution-model-phase-doc-type-computed-comp	BASELINE	execution	task workflow	Execution: phase model
spec-spec-057-two-tier-worktree-seat-model-lore-seat-verb-seat-a	BASELINE	session	resume	Session: resumption
spec-spec-058-verification-profiles-per-spec-kind-oracle-coverag	ARCH	standards	oracle-integrity	Standards rule: oracle-integrity
spec-spec-059-requirement-layer-quantifiability-lint-close-spec	NOT-PRODUCT			Internal requirement quantification
spec-spec-060-lore-setup-project-scaffold-completion-repo-level	BASELINE	review	approve doc	Review: fast-track ledger
spec-spec-061-attestation-completeness-guard-detect-zero-match-u	ARCH	standards	oracle-integrity	Standards rule: oracle-integrity
spec-spec-062-config-write-layer-configservice-http-surface-and	ARCH	current-state	adapter-http	HTTP API: config service
spec-spec-063-verify-execution-root-correctness-under-linked-wor	BASELINE	execution	verify	Execution: attestation
spec-spec-064-dashboard-settings-ui-two-scope-config-editing-wit	BASELINE	distribution	dashboard	Dashboard: user interface
spec-spec-065-cli-ergonomics-unique-id-prefix-resolution-single	ARCH	standards	cli-conventions	Standards rule: cli-conventions
spec-spec-066-git-safety-gate-heredoc-string-literal-awareness-c	NOT-PRODUCT			Internal git safety gate
spec-spec-067-ai-surface-robustness-assess-timeout-floor-partial	NOT-PRODUCT			Internal testing/build infra
spec-spec-069-execution-time-attestation-floor-ad-hoc-task-chann	BASELINE	execution	record evidence	Execution: evidence recording
spec-spec-ac-quantifiability-gate-design-time-standardization-en	NOT-PRODUCT			Internal AC quantification
spec-strict-flag-hardening-single-dash-multi-char-tokens-fail	NOT-PRODUCT			Internal CLI hardening
spec-superseded-handoff-archival-has-no-recency-guard	BASELINE	session	handoff	Session: handoff archival
spec-sync-engine-turso	ARCH	current-state	sync-engine	Technical sync-engine
spec-task-execution-workflow-metadata-evidence-claim-ready	BASELINE	execution	record evidence	Execution: evidence recording
spec-telemetry-module	ARCH	current-state	telemetry	Technical telemetry
spec-the-defect-channel-cannot-be-honestly-maintained-an	BASELINE	issue-loop	report defect	Issue-loop: channel
spec-the-defect-channel-reaches-no-machine-but-its-own-github	BASELINE	issue-loop	report defect	Issue-loop: GitHub
spec-the-mirror-oracles-two-command-surfaces-are-o-corpus-by	NOT-PRODUCT			Internal mirror oracles
spec-the-retired-shape-refusal-message-has-two-byte-identical	NOT-PRODUCT			Internal error messaging
spec-tiered-review-ledger-fast-track-judgment-required-promote	BASELINE	review	approve doc	Review: tiered ledger
spec-trace-layer-read-deny-observability-table-default-on-with	BASELINE	execution	gate enforcement	Execution: trace observability
spec-two-runner-changed-test-selection-deterministic-test	NOT-PRODUCT			Internal test infrastructure
spec-typecheck-coverage-two-named-blind-spots-and-the-stale	NOT-PRODUCT			Internal typecheck
spec-upstream-asset-ization-prompt-skill-as-first-class-knowledg	BASELINE	distribution	publish release	Distribution: adoption
spec-verify-reachability-plan-promote-early-warning	BASELINE	execution	record evidence	Execution: evidence recording
spec-version-history	ARCH	current-state	storage	Technical storage
spec-version-snapshots-capture-slug-values-spec-068-d5-follow-up	ARCH	current-state	storage	Technical: version history
spec-workflow-hardening-evidence-red-vocabulary-claim-worktree	NOT-PRODUCT			Internal testing/build infra
spec-worktree-derived-actor-identity-agent-branch-as	BASELINE	execution	claim task	Execution: actor identity

````

## mapping/a4-y.tsv

````text
slug	home	branch_or_section	leaf_or_module	reason
spec-070-deterministic-task-dispatch-bundle-lore-feed-task-start	BASELINE	execution	evidence-claim	execution: claim/evidence/verify/dispatch
spec-071-execution-liveness-signals-session-actor-tier-evidence	BASELINE	execution	evidence-claim	execution: claim/evidence/verify/dispatch
spec-072-upstream-issue-reporting-lore-report-issue-consumer	BASELINE	issue-loop	issue-report	issue-loop: report/triage defects
spec-073-report-issue-trigger-surfaces-error-path-hints	BASELINE	issue-loop	issue-report	issue-loop: report/triage defects
spec-074-dashboard-issues-triage-surface-badge-list-in-place	BASELINE	issue-loop	issue-report	issue-loop: report/triage defects
spec-075-dashboard-adjudication-workbench-route-telemetry-prd	ARCH	current-state	telemetry	module: telemetry
spec-076-distribution-integration-model-asset-update-convergence	BASELINE	distribution	release-publish	distribution: publish/release/install
spec-077-dashboard-execution-read-surface-prd-21-f3	BASELINE	execution	execution-read	read surface for plan execution state
spec-078-dashboard-multi-project-mount-registry-machine-scope	ARCH	current-state	dashboard	module: dashboard infrastructure
spec-079-audit-hardening-link-provenance-actor-fidelity-tamper	BASELINE	corpus	audit-governance	audit trail for link/unlink operations
spec-080-bootstrap-injection-projection-tier-1-tier-2-payload	ARCH	current-state	hooks	module: hook injection system
spec-080-prd-as-outline-contract-structured-outline-domain	BASELINE	sync	replica-sync	sync: push/pull replica
spec-081-audit-hardening-part-2-gate-skip-observability-push	BASELINE	sync	replica-sync	sync: push/pull replica
spec-083-governance-prose-runtime-injection-retire-the	BASELINE	distribution	release-publish	distribution: publish/release/install
spec-084-corpus-allocated-ordinal-identity-store-atomic-spec	ARCH	current-state	store	module: store/database
spec-085-seat-briefing-runtime-injection-retire-the-installed	BASELINE	session	session-continuity	session: handoff/resume/seat
spec-a-conclusion-with-no-currency-signal-and-no-falsifier	ARCH	standards	oracle-integrity	conclusion retrieval and ranking logic
spec-a-falsifier-s-scratch-worktree-must-be-runnable-and	ARCH	standards	oracle-integrity	standard: oracle integrity
spec-a-github-filed-defect-must-be-claimable-one-ingest-seam	BASELINE	execution	evidence-claim	execution: claim/evidence/verify/dispatch
spec-a-test-case-s-timeout-budget-must-be-declared-when-its	ARCH	standards	browser-safety	standard: browser safety
spec-a-write-side-fact-with-no-read-side-address-counts-with-no	BASELINE	corpus	doc-lifecycle	corpus management: create/revise/link/invalidate doc
spec-adr-decision-status-has-a-create-surface-and-no-cli-update	BASELINE	corpus	doc-creation	ADR decision_status CLI writer
spec-ai-assistance-in-lore-set-and-lore-link	BASELINE	corpus	doc-revision	AI assistance in set/link commands
spec-an-escalate-blocks-approval-for-every-doc-type-and-the	BASELINE	corpus	doc-lifecycle	corpus management: create/revise/link/invalidate doc
spec-assessment-freshness-plan-close-denies-a-stale-assessment	BASELINE	hygiene	staleness-mark	hygiene: mark stale/drift
spec-auth-agent-credentials	ARCH	current-state	auth	module: auth
spec-bootstrap-fixpoint-integrity-binary-provenance-an-anchor	BASELINE	hygiene	staleness-mark	hygiene: mark stale/drift
spec-built-in-ai-provider-for-lore-create	BASELINE	corpus	doc-creation	built-in AI provider for create command
spec-cjk-aware-slugify-pinyin-transliteration-lore-set-slug-repa	BASELINE	corpus	doc-revision	CJK-aware slug handling and repair
spec-claim-time-actor-identity-guard-zero-evidence-release-advis	BASELINE	execution	evidence-claim	execution: claim/evidence/verify/dispatch
spec-claude-md-governance-content-dimension-checks-wire-the	BASELINE	context	context-inject	context: CLAUDE.md/fragment injection
spec-claude-md-root-section-structure-check-and-adoption-mode	BASELINE	context	context-inject	context: CLAUDE.md/fragment injection
spec-cli-adapter	ARCH	current-state	adapter-cli	module: CLI adapter
spec-context-fragments-config-driven-layered-rule-injection	BASELINE	session	session-continuity	session: handoff/resume/seat
spec-context-provenance-injected-corpus-global-state-and-a	BASELINE	session	session-continuity	session: handoff/resume/seat
spec-context-verb-family-two-zone-claude-md-anatomy-lore	BASELINE	distribution	release-publish	distribution: publish/release/install
spec-cookie-auth-cli-managed-local-bootstrap	ARCH	current-state	adapter-cli	module: CLI adapter
spec-corpus-governed-spec-production-loop-ioc-vertical-slice	ARCH	standards	oracle-integrity	spec production loop mechanics
spec-corpus-resolution-carries-provenance-and-a-foreign-write	BASELINE	corpus	doc-query	corpus resolution with provenance
spec-corpus-schema	ARCH	current-state	core	module: core types/schemas
spec-corpus-truthfulness-a-verdict-must-carry-the-state-it	ARCH	standards	oracle-integrity	corpus integrity and verdict contract
spec-dashboard-production-packaging-one-command-lore-dashboard	ARCH	current-state	dashboard	module: dashboard infrastructure
spec-dashboard-read-only-skeleton	ARCH	current-state	dashboard	dashboard read-only component structure
spec-dashboard-write-ui-create-edit-approve-link	ARCH	current-state	dashboard	dashboard write UI components
spec-declared-scope-attestation-contract-task-owned-ac-scope	ARCH	standards	oracle-integrity	standard: oracle integrity
spec-declaring-ac-scope-is-required-at-task-creation-so-the	BASELINE	execution	evidence-claim	execution: claim/evidence/verify/dispatch
spec-default-no-ai-for-agent-and-mcp-execution-paths	ARCH	current-state	adapter-mcp	module: MCP adapter
spec-dispatch-isolation-must-be-enforced-by-a-gate-and	BASELINE	execution	evidence-claim	execution: claim/evidence/verify/dispatch
spec-domain-overview-autonomous-feedback-loop-ai-review-data-driven-self-optimization	BASELINE	issue-loop	issue-report	issue-loop: report/triage defects
spec-domain-overview-dashboard-console-admin-console-evolution-adjudication-workbench-first	BASELINE	corpus	domain-model	domain overview: adjudication workbench
spec-domain-overview-dashboard-multi-project-single-instance-switcher-over-the-machine-s-registered-corpora	BASELINE	distribution	release-publish	distribution: publish/release/install
spec-domain-overview-distribution-adoption-phased-spike-gated-one-step-install	BASELINE	distribution	release-publish	distribution: publish/release/install
spec-domain-overview-extension-hooks-system-direction-pointer-only-no-commitment	ARCH	current-state	hooks	module: hook injection system
spec-domain-overview-memory-hygiene-knowledge-trustworthiness-over-time	BASELINE	hygiene	staleness-mark	hygiene: mark stale/drift
spec-domain-overview-output-contract-document-taxonomy	BASELINE	corpus	domain-model	domain overview: document taxonomy
spec-domain-overview-phase-execution-model-plan-phase-checklist-supersedes-fine-grained-task-pre-decomposition	BASELINE	execution	domain-model	domain overview: phase execution model
spec-domain-overview-provenance	BASELINE	corpus	domain-model	domain overview: provenance
spec-domain-overview-session-layer-multi-session-collaboration-context-continuity	BASELINE	session	session-continuity	session: handoff/resume/seat
spec-domain-overview-upstream-issue-feedback-loop-consumer-reported-defects-corpus	BASELINE	issue-loop	issue-report	issue-loop: report/triage defects
spec-eager-libsql-load-makes-every-command-depend-on-a-healthy	ARCH	standards	import-boundaries	standard: import boundaries
spec-eval-framework	ARCH	current-state	eval	eval read-only scenarios framework
spec-evidence-output-tail-integrity-a-self-reported-non-pass	BASELINE	execution	evidence-claim	execution: claim/evidence/verify/dispatch
spec-falsifiability-reachability-a-feedable-checkpoint-an	BASELINE	hygiene	staleness-mark	hygiene: mark stale/drift
spec-git-safety-gate-probes-report-the-wrong-blast-radius	BASELINE	issue-loop	issue-report	issue-loop: report/triage defects
spec-governance-defaults-must-ship-and-every-recorded-gap-must	BASELINE	hygiene	staleness-mark	hygiene: mark stale/drift
spec-governance-visibility-an-armed-gate-that-vacuously-passes	ARCH	current-state	auth	module: auth
spec-governance-weight-must-scale-with-measured-blast-radius-a	ARCH	standards	oracle-integrity	gate weight and blast radius measurement
spec-http-api-adapter	ARCH	current-state	adapter-http	module: HTTP adapter
spec-http-backed-ai-provider-alongside-claude-cli	ARCH	current-state	adapter-http	module: HTTP adapter
spec-issue-closure-loop-computed-resolution-agent-reachable	BASELINE	issue-loop	issue-report	issue-loop: report/triage defects
spec-judgment-surfaces-must-verify-before-they-certify-machine	BASELINE	execution	evidence-claim	execution: claim/evidence/verify/dispatch
spec-lifecycle-archival-plan-close-cascade-deterministic	BASELINE	execution	plan-close	plan close cascade behavior
spec-lore-ac-set-in-place-edit-of-a-declared-acceptance	BASELINE	specification	ac-management	AC in-place edit surface
spec-lore-assess-ai-plan-outcome-assessment-llm-as-judge-feedbac	BASELINE	issue-loop	issue-report	issue-loop: report/triage defects
spec-lore-assess-project-evidence-rows-instead-of-embedding-the	BASELINE	execution	evidence-claim	execution: claim/evidence/verify/dispatch
spec-lore-export-docs-reverse-sync-from-corpus-to-spec-files	BASELINE	corpus	doc-lifecycle	corpus management: create/revise/link/invalidate doc
spec-lore-issues-falls-through-to-the-local-corpus-on-a-retired	BASELINE	issue-loop	issue-report	issue-loop: report/triage defects
spec-lore-phase-add-and-phase-rm-mutate-a-plan-s-declared	BASELINE	context	context-inject	context: CLAUDE.md/fragment injection
spec-lore-setup-deletes-repo-source-through-dev-symlinks	BASELINE	distribution	setup-behavior	setup asset deletion behavior
spec-lore-sync-docs-backfill-new-spec-files-into-corpus	BASELINE	corpus	doc-lifecycle	corpus management: create/revise/link/invalidate doc
spec-mcp-server-adapter	ARCH	current-state	adapter-mcp	module: MCP adapter
spec-migration-v1	NOT-PRODUCT			v1 to v2 migration (infrastructure)
spec-mirror-identifier-ssot-one-writer-for-export-index-human	BASELINE	distribution	asset-export	spec export and mirror identity
spec-monorepo-skeleton-bun-workspaces-p1-layout	NOT-PRODUCT			monorepo infrastructure setup
spec-multi-session-concurrency-queryable-ownership-checkout	BASELINE	execution	evidence-claim	execution: claim/evidence/verify/dispatch
spec-oracle-exclusivity-in-a-shared-checkout-a-mirror-check	ARCH	standards	oracle-integrity	standard: oracle integrity
spec-oracle-executability-a-runner-s-discovery-refusal-is-not-a	ARCH	current-state	telemetry	module: telemetry
spec-oracle-tier-falsifiability-a-criterion-never-observed-red	BASELINE	execution	evidence-claim	execution: claim/evidence/verify/dispatch
spec-out-of-box-reporting-channel-report-issue-self-provisions	BASELINE	issue-loop	issue-report	issue-loop: report/triage defects
spec-p2-workflow-state-machine-checkpoint-registry-cross-tier-pr	ARCH	standards	error-model	workflow state machine and checkpoint registry
spec-p4-upstream-downstream-linkage-feed-before-produce-protocol	BASELINE	corpus	doc-linkage	upstream/downstream linkage protocol
spec-plan-close-predicates-measure-invariants-an-applicability	BASELINE	execution	plan-close	plan close predicates and invariants
spec-plan-closure-must-be-loud-terminality-divergence-silent	BASELINE	execution	plan-close	plan close behavior and observability
spec-plan-phases-as-a-first-class-grouping-layer	ARCH	current-state	service-layer	module: service layer
spec-prd-as-living-root	BASELINE	corpus	prd-root	PRD as living root and SSOT
spec-project-claude-md-content-contract-governance-injected	BASELINE	distribution	release-publish	distribution: publish/release/install
spec-report-issue-has-no-specified-concurrency-contract-ac-072	BASELINE	issue-loop	issue-report	issue-loop: report/triage defects
spec-resume-coverage-floor-the-satisfaction-boundaries-a	BASELINE	session	session-continuity	session: handoff/resume/seat
spec-resume-ticket-coverage-a-shipped-upper-bound-left-the	BASELINE	session	session-continuity	session: handoff/resume/seat
spec-resume-ticket-coverage-floor-blocking-channel-arming	BASELINE	session	session-continuity	session: handoff/resume/seat
spec-review-workflow	BASELINE	review	doc-lifecycle	review workflow: pending/approve/reject/archive
spec-service-layer-architecture	ARCH	current-state	service-layer	module: service layer
spec-session-start-handoff-neutrality-injection-drops-resume	ARCH	current-state	hooks	module: hook injection system
spec-spec-027-dashboard-hardening-write-path-integrity-delete-re	ARCH	current-state	dashboard	module: dashboard infrastructure
spec-spec-028-assess-input-transparency-pre-flight-diff-budgetin	ARCH	standards	import-boundaries	standard: import boundaries
spec-spec-029-assess-reliability-reasoning-length-resilience-sur	ARCH	current-state	core	module: core types/schemas
spec-spec-030-hermetic-judge-sessions-fail-loud-ai-config	BASELINE	session	session-continuity	session: handoff/resume/seat
spec-spec-031-dashboard-read-path-contract-fixes-markdown-typogr	ARCH	current-state	dashboard	dashboard read-path contract
spec-spec-032-output-contract-mechanization-spec-kind-tree-bluep	BASELINE	corpus	doc-output	spec output contract and tree blueprint
spec-spec-033-dashboard-as-living-prd-projection-human-adjudicat	BASELINE	review	adjudication	dashboard as PRD projection for adjudication
spec-spec-034-structured-review-judgment-triage-queue	BASELINE	issue-loop	issue-report	issue-loop: report/triage defects
spec-spec-035-audit-trail-calibration-data	BASELINE	autonomy	ai-autonomy	autonomy: AI judgment/calibration
spec-spec-036-dashboard-browsing-ux-breadcrumb-tag-status-filter	ARCH	current-state	core	module: core types/schemas
spec-spec-037-dashboard-execution-tracking-surface-readiness-rou	BASELINE	execution	evidence-claim	execution: claim/evidence/verify/dispatch
spec-spec-038-ac-as-code-structured-acceptance-criteria-oracle-b	ARCH	standards	oracle-integrity	standard: oracle integrity
spec-spec-039-trusted-runner-attested-evidence-for-script-mode-a	BASELINE	execution	evidence-claim	execution: claim/evidence/verify/dispatch
spec-spec-040-assessment-dimension-framework-v2-facts-judgment-s	BASELINE	autonomy	ai-autonomy	autonomy: AI judgment/calibration
spec-spec-041-session-layer-part-1-bootstrap-pointer-set-lossles	BASELINE	session	session-continuity	session: handoff/resume/seat
spec-spec-042-session-layer-part-2-session-registry-file-anchor	BASELINE	execution	evidence-claim	execution: claim/evidence/verify/dispatch
spec-spec-043-memory-hygiene-part-1-bi-temporal-invalidation-h1	BASELINE	hygiene	staleness-mark	hygiene: mark stale/drift
spec-spec-044-memory-hygiene-part-2-staleness-probes-h2	BASELINE	hygiene	staleness-mark	hygiene: mark stale/drift
spec-spec-045-memory-hygiene-part-3-doc-code-drift-oracle-h3	BASELINE	hygiene	staleness-mark	doc/code drift detection
spec-spec-046-distribution-part-1-asset-ssot-local-safe-installe	BASELINE	distribution	release-publish	distribution: publish/release/install
spec-spec-047-session-seat-auto-briefing-worktree-aware-sessions	ARCH	current-state	hooks	module: hook injection system
spec-spec-048-distribution-part-2-npm-single-platform-publish-tt	BASELINE	distribution	release-publish	distribution: publish/release/install
spec-spec-049-gate-denials-carry-the-feeding-pack-gateenforcer-e	BASELINE	execution	dispatch	gate denial output includes feeding pack
spec-spec-050-gate-hooks-cross-corpus-false-deny-fix-cd-prefix-t	ARCH	current-state	hooks	module: hook injection system
spec-spec-051-cli-strict-flags-unknown-flag-rejection-actor-flag	ARCH	current-state	adapter-cli	module: CLI adapter
spec-spec-053-ai-advisory-ac-vagueness-supplement-on-lore-review	BASELINE	specification	ac-management	AI advisory for AC vagueness
spec-spec-054-uat-verdict-as-plan-close-gate	BASELINE	execution	plan-close	UAT verdict as plan close gate
spec-spec-055-requirement-ac-completeness-oracle	ARCH	standards	oracle-integrity	standard: oracle integrity
spec-spec-056-phase-execution-model-phase-doc-type-computed-comp	BASELINE	corpus	doc-lifecycle	corpus management: create/revise/link/invalidate doc
spec-spec-057-two-tier-worktree-seat-model-lore-seat-verb-seat-a	BASELINE	session	session-continuity	session: handoff/resume/seat
spec-spec-058-verification-profiles-per-spec-kind-oracle-coverag	ARCH	standards	oracle-integrity	standard: oracle integrity
spec-spec-059-requirement-layer-quantifiability-lint-close-spec	ARCH	current-state	service-layer	module: service layer
spec-spec-060-lore-setup-project-scaffold-completion-repo-level	BASELINE	distribution	release-publish	distribution: publish/release/install
spec-spec-061-attestation-completeness-guard-detect-zero-match-u	ARCH	standards	oracle-integrity	standard: oracle integrity
spec-spec-062-config-write-layer-configservice-http-surface-and	ARCH	current-state	adapter-http	module: HTTP adapter
spec-spec-063-verify-execution-root-correctness-under-linked-wor	BASELINE	execution	verify-behavior	verify command execution root correctness
spec-spec-064-dashboard-settings-ui-two-scope-config-editing-wit	ARCH	current-state	dashboard	module: dashboard infrastructure
spec-spec-065-cli-ergonomics-unique-id-prefix-resolution-single	BASELINE	corpus	id-resolution	unique ID prefix resolution
spec-spec-066-git-safety-gate-heredoc-string-literal-awareness-c	ARCH	standards	cli-conventions	git safety gate for CLI strings
spec-spec-067-ai-surface-robustness-assess-timeout-floor-partial	BASELINE	execution	assess-behavior	assess command timeout robustness
spec-spec-069-execution-time-attestation-floor-ad-hoc-task-chann	ARCH	standards	oracle-integrity	standard: oracle integrity
spec-spec-ac-quantifiability-gate-design-time-standardization-en	ARCH	standards	oracle-integrity	AC quantifiability gate design
spec-strict-flag-hardening-single-dash-multi-char-tokens-fail	ARCH	standards	cli-conventions	CLI flag parsing strictness
spec-superseded-handoff-archival-has-no-recency-guard	BASELINE	session	handoff-archival	superseded handoff archival
spec-sync-engine-turso	BASELINE	sync	replica-sync	sync: push/pull replica
spec-task-execution-workflow-metadata-evidence-claim-ready	BASELINE	execution	evidence-claim	execution: claim/evidence/verify/dispatch
spec-telemetry-module	ARCH	current-state	telemetry	module: telemetry
spec-the-defect-channel-cannot-be-honestly-maintained-an	BASELINE	session	session-continuity	session: handoff/resume/seat
spec-the-defect-channel-reaches-no-machine-but-its-own-github	BASELINE	issue-loop	issue-report	issue-loop: report/triage defects
spec-the-mirror-oracles-two-command-surfaces-are-o-corpus-by	ARCH	standards	oracle-integrity	standard: oracle integrity
spec-the-retired-shape-refusal-message-has-two-byte-identical	BASELINE	distribution	release-publish	distribution: publish/release/install
spec-tiered-review-ledger-fast-track-judgment-required-promote	BASELINE	autonomy	ai-autonomy	autonomy: AI judgment/calibration
spec-trace-layer-read-deny-observability-table-default-on-with	ARCH	current-state	service-layer	module: service layer
spec-two-runner-changed-test-selection-deterministic-test	ARCH	standards	oracle-integrity	standard: oracle integrity
spec-typecheck-coverage-two-named-blind-spots-and-the-stale	BASELINE	hygiene	staleness-mark	hygiene: mark stale/drift
spec-upstream-asset-ization-prompt-skill-as-first-class-knowledg	ARCH	current-state	assets-packaging	module: assets packaging
spec-verify-reachability-plan-promote-early-warning	BASELINE	execution	evidence-claim	execution: claim/evidence/verify/dispatch
spec-version-history	BASELINE	corpus	version-tracking	version history visibility and access
spec-version-snapshots-capture-slug-values-spec-068-d5-follow-up	BASELINE	corpus	version-tracking	version snapshots with slug capture
spec-workflow-hardening-evidence-red-vocabulary-claim-worktree	BASELINE	execution	evidence-claim	execution: claim/evidence/verify/dispatch
spec-worktree-derived-actor-identity-agent-branch-as	ARCH	standards	concurrency-safety	standard: concurrency safety

````

## a5-acs.tsv

````text
spec-lore-ac-set-in-place-edit-of-a-declared-acceptance	AC-ACS-1	lore ac set <spec> <id> --statement <new> exits 0
spec-lore-ac-set-in-place-edit-of-a-declared-acceptance	AC-ACS-2	lore ac set against an id absent from extra.acceptance_criteria exits 4 and stderr enumerates the ids that are declared on that spec
spec-lore-ac-set-in-place-edit-of-a-declared-acceptance	AC-ACS-6	after lore ac set on one criterion every other criterion on that spec is byte-identical and every other key of extra is unchanged
spec-lore-ac-set-in-place-edit-of-a-declared-acceptance	AC-ACS-7	a corpus-wide integrity oracle reports zero dangling ac_ref, so every evidence row's ac_ref resolves to a criterion still declared on its spec, and it exits non-zero on a fixture corpus carrying one dangling reference
spec-lore-ac-set-in-place-edit-of-a-declared-acceptance	AC-ACS-3	lore ac set with no field flag exits 2, stderr names at least --statement, and the document version is unchanged so no empty write occurred
spec-lore-ac-set-in-place-edit-of-a-declared-acceptance	AC-ACS-4	lore ac set on an approved spec leaves it at status draft
spec-lore-ac-set-in-place-edit-of-a-declared-acceptance	AC-ACS-5	a field flag the target criterion's mode does not define, such as --rubric against a script criterion, exits 4 with stderr naming both the flag and the criterion's actual mode
spec-lore-ac-set-in-place-edit-of-a-declared-acceptance	AC-ACS-8	after lore ac set <spec> <id> --statement <new>, a following lore ac list prints the new text for that id
spec-lore-ac-set-in-place-edit-of-a-declared-acceptance	AC-ACS-9	lore ac set on a draft spec leaves it at status draft
spec-lore-ac-set-in-place-edit-of-a-declared-acceptance	AC-ACS-10	After lore ac set <spec> <id> --statement <new>, the edited criterion's id is unchanged
spec-lore-ac-set-in-place-edit-of-a-declared-acceptance	AC-ACS-11	After lore ac set <spec> <id> --statement <new>, the spec's declared criterion count is unchanged
spec-lore-ac-set-in-place-edit-of-a-declared-acceptance	AC-ACS-12	lore ac set on a draft spec causes lore log to record no status-transition entry for the edit
spec-spec-ac-quantifiability-gate-design-time-standardization-en	AC-ACQ-1	lintAcQuantifiability returns >=1 block finding for an AC statement with an abstract word and 0 measurable token, and exactly 0 findings when rewritten with a numeric threshold
spec-spec-ac-quantifiability-gate-design-time-standardization-en	AC-ACQ-2	ac-quality.ts imports no AIProvider/generate symbol and issues 0 provider calls; source-scan test asserts grep finds no AIProvider in the module
spec-spec-ac-quantifiability-gate-design-time-standardization-en	AC-ACQ-3	spec-create with an AC carrying an unquantified abstract word exits 4 with a feeding pack naming the offending AC id; same spec with all ACs quantified exits 0
spec-spec-ac-quantifiability-gate-design-time-standardization-en	AC-ACQ-4	with workflow.gates.spec-create.ac_quantifiable.enabled false, a spec that AC-ACQ-3 would block passes with exit 0
spec-spec-ac-quantifiability-gate-design-time-standardization-en	AC-ACQ-5	a spec-create with provider absent still passes the deterministic gate for a quantified spec; the gate path issues 0 provider calls; AI vagueness check runs only under lore review
spec-spec-ac-quantifiability-gate-design-time-standardization-en	AC-ACQ-6	this spec's own declared acceptance_criteria produce 0 block findings from lintAcQuantifiability
spec-spec-ac-quantifiability-gate-design-time-standardization-en	AC-ACQ-7	lintStatement rejects a match hyphen-adjacent to a bare AC_ABSTRACT_WORDS entry (e.g. "fast-track", "best-effort") while still blocking that same word standalone (e.g. "the dashboard loads fast") and continuing to clear suffix collisions ("breakfast", "faster")
spec-spec-059-requirement-layer-quantifiability-lint-close-spec	AC-RQ-1	lintStatement is exported from @lore/core and returns >=1 AcQualityFinding for a statement with an abstract word and 0 measurable tokens, and returns exactly 0 findings for a quantified statement; test asserts both directions and exits 0
spec-spec-059-requirement-layer-quantifiability-lint-close-spec	AC-RQ-2	lintAcQuantifiability is re-expressed as a per-criterion map over lintStatement and its output stays byte-identical to the pre-change implementation across all existing ac-quality fixtures; regression test exits 0
spec-spec-059-requirement-layer-quantifiability-lint-close-spec	AC-RQ-3	RequirementService.addRequirement returns a VALIDATION_ERROR result for a statement carrying an abstract word with 0 measurable tokens and returns an ok result for a quantified statement; test asserts >=1 reject and >=1 accept case and exits 0
spec-spec-059-requirement-layer-quantifiability-lint-close-spec	AC-RQ-5	with workflow.requirement_quantifiable.enabled set to false in config, addRequirement accepts a vague statement that would otherwise be rejected; test asserts the disabled-knob accept path and the default-true reject path and exits 0
spec-spec-059-requirement-layer-quantifiability-lint-close-spec	AC-RQ-6	bun run typecheck exits 0 with 0 type errors after the change across all packages and scripts
spec-spec-059-requirement-layer-quantifiability-lint-close-spec	AC-RQ-4	lore requirement add exits with code 4 (VALIDATION_ERROR, the codebase SSOT exit code per utils.ts::exitCode) for a vague statement and code 0 for a quantified statement, measured by spawning the CLI from source and reading its exit code directly; e2e test asserts both codes and exits 0
spec-spec-058-verification-profiles-per-spec-kind-oracle-coverag	AC-V-1	checkOracleCoverage suite passes 0 failures across >=12 cases: floor met (HAPPY), ai-mode AC does NOT satisfy a floor (NEGATIVE), empty criteria vs unconfigured profile distinct outcomes (BOUNDARY), unknown oracle kind in config yields typed schema err (ERROR)
spec-spec-058-verification-profiles-per-spec-kind-oracle-coverag	AC-V-2	spec-promote gate matched pair: design spec with 0 e2e-bound ACs blocked with pack naming e2e AND same spec plus one e2e script AC promotes ok; unconfigured corpus byte-identical to frozen fixture spec-promote-unconfigured-baseline.json; oracle_coverage.enabled false disables with profile configured; 0 failures
spec-spec-058-verification-profiles-per-spec-kind-oracle-coverag	AC-V-3	plan-promote requires_uat: design-spec plan without requires_uat blocked with repair command, with requires_uat true promotes ok, feature-spec plan unaffected, and promoted plan archives end-to-end through the SPEC-054 plan-close uatP0Accepted gate; 0 failures
spec-spec-058-verification-profiles-per-spec-kind-oracle-coverag	AC-V-4	NEW assets/project/lore-config-template.yaml exists, parses with verificationProfileSchema, contains design->e2e feature->test tech->test blocks, and a scaffolded corpus config contains the block (dedicated verification-profile-template.test.ts); 0 failures
spec-spec-058-verification-profiles-per-spec-kind-oracle-coverag	AC-V-5	bun run typecheck exits 0 across all packages
spec-spec-058-verification-profiles-per-spec-kind-oracle-coverag	AC-V-6	lore create plan --requires-uat sets extra.requires_uat===true; the flag is plan-type-only and passing it on any non-plan type exits 4 naming the mismatch; a plan created without it has no requires_uat key. At least 1 CLI test case runs and exits 0
spec-spec-058-verification-profiles-per-spec-kind-oracle-coverag	AC-V-7	MCP lore_create accepts a requires_uat boolean with plan-only semantics identical to the CLI flag (sets extra.requires_uat===true on a plan; ignored-or-rejected consistently on non-plan types), so an agent creating a design-parented plan over MCP can satisfy the plan-promote requiresUat gate. At least 1 MCP test case runs and exits 0
spec-spec-055-requirement-ac-completeness-oracle	AC-055-1	requirementSchema parses a well-formed R-1 P0 requirement and rejects one with out-of-enum priority and one with a malformed id (no R- prefix); test >=1 accept and >=2 reject cases exit 0
spec-spec-055-requirement-ac-completeness-oracle	AC-055-2	prdRequirementsSchema rejects an array with two entries sharing an id and acceptanceCriterionSchema accepts an optional requirement_refs (absent still parses REGRESSION); test exit 0
spec-spec-055-requirement-ac-completeness-oracle	AC-055-3	computeRequirementCoverage returns empty uncovered when every requirement id appears in refs, non-empty uncovered_p0 when a P0 id appears in no ref, and all-empty for an empty requirements array; truth-table test >=3 cases exit 0
spec-spec-055-requirement-ac-completeness-oracle	AC-055-4	requirementCoverageExitCode returns 3 iff uncovered_p0 is non-empty else 0; both-branch test exit 0
spec-spec-055-requirement-ac-completeness-oracle	AC-055-5	RequirementService.addRequirement then listRequirements round-trips the requirement on prd.extra.requirements preserving other extra keys and removeRequirement drops it; store round-trip test exit 0
spec-spec-055-requirement-ac-completeness-oracle	AC-055-6	CorpusService.computeRequirementCoverageForPrd gathers a descendant spec AC requirement_refs and reports a PRD requirement covered iff some descendant AC references it, uncovered otherwise; multi-doc store test exit 0
spec-spec-055-requirement-ac-completeness-oracle	AC-055-7	AcService.addCriterion accepts and persists a requirement_refs value round-tripped via listCriteria and a criterion with no requirement_refs still validates REGRESSION; test exit 0
spec-spec-053-ai-advisory-ac-vagueness-supplement-on-lore-review	AC-053-1	REVIEW_PROMPT_VERSION === 'v2' and Object.keys(REVIEW_TEMPLATES).length === 2 (keys exactly v1,v2), asserted by a passing unit test exit 0
spec-spec-053-ai-advisory-ac-vagueness-supplement-on-lore-review	AC-053-2	The advisory kind enum accepts 'ac_quantifiability' and a Zod parse of an advisory entry with an out-of-enum kind fails; test has >=1 accept and >=1 reject case, exit 0
spec-spec-053-ai-advisory-ac-vagueness-supplement-on-lore-review	AC-053-3	buildReviewPromptV2 output contains literal heading AC Quantifiability advisory and every declared AC id for a spec with >=1 AC, and NO such heading for a non-spec or spec with 0 ACs; test covers all 3 branches, exit 0
spec-spec-053-ai-advisory-ac-vagueness-supplement-on-lore-review	AC-053-4	buildReviewPromptV2 output contains the exact advisory-only clause that advisory findings MUST NOT force decision=reject; substring test exit 0
spec-spec-053-ai-advisory-ac-vagueness-supplement-on-lore-review	AC-053-5	buildReviewPromptV2 advisory section embeds the lintAcQuantifiability verdict pass and finding count for the spec ACs so the judge does not re-derive lexical result; test checks rendered count exit 0
spec-spec-053-ai-advisory-ac-vagueness-supplement-on-lore-review	AC-053-6	buildReviewPromptV1 output is byte-identical to a frozen fixture captured before this change REGRESSION; string-equality test exit 0
spec-spec-053-ai-advisory-ac-vagueness-supplement-on-lore-review	AC-053-7	review-render advisory renderer returns a non-empty block containing each advisory finding when advisory has >=1 entry, and returns empty string when advisory absent or empty REGRESSION no-op; test with both branches exit 0
spec-spec-038-ac-as-code-structured-acceptance-criteria-oracle-b	AC-ACODE-1	acceptanceCriterionSchema rejects duplicate ids, malformed id format, script without command, overlong rubric; legal script/ai/human inputs parse
spec-spec-038-ac-as-code-structured-acceptance-criteria-oracle-b	AC-ACODE-2	create and set paths both reject invalid acceptance_criteria with VALIDATION_ERROR; valid writes roundtrip
spec-spec-038-ac-as-code-structured-acceptance-criteria-oracle-b	AC-ACODE-3	evidence --ac with undeclared id fails VALIDATION_ERROR (exit 4); declared id records ac_ref and bumps version
spec-spec-038-ac-as-code-structured-acceptance-criteria-oracle-b	AC-ACODE-4	spec with structured ACs: assess prompt contains AC table (full id set, coverage rows) at ASSESS_PROMPT_VERSION 4; undeclared spec keeps verbatim section byte-identical
spec-spec-038-ac-as-code-structured-acceptance-criteria-oracle-b	AC-ACODE-5	judge output containing undeclared ac_id errors without creating a knowledge doc and without consuming the corrective retry
spec-spec-038-ac-as-code-structured-acceptance-criteria-oracle-b	AC-ACODE-6	computeAcCoverage aggregates pass/fail per ac_ref; evidence without ac_ref excluded; empty task set yields all-zero facts
spec-spec-038-ac-as-code-structured-acceptance-criteria-oracle-b	AC-ACODE-7	lore ac add/list/rm roundtrip; rm refused while evidence references the id; --force overrides leaving dangling ref visible in list
spec-spec-038-ac-as-code-structured-acceptance-criteria-oracle-b	AC-ACODE-8	oracle enum kinds defined exactly once (task-workflow.ts ORACLE_KINDS); both adapters reference the SSOT
spec-spec-038-ac-as-code-structured-acceptance-criteria-oracle-b	AC-ACODE-9	text projection renders structured AC checklist in get non-raw and export-docs body; raw output untouched. AMENDED 2026-08-23 BY SPEC-143 D7, IN THE SAME COMMIT AS THE RENDERER FIX: the coverage prefix is NO LONGER the three-glyph `✔/✘/·` rule this criterion used to imply. `outline-service.ts::acCoveragePrefix` now DELEGATES to `packages/core/src/acceptance.ts::projectAcCoverageGlyph` over `deriveAcCoverageState`, so all SEVEN coverage states render PAIRWISE-DISTINCT glyphs and the renderer holds no glyph and no precedence rule of its own. ⛔ The authoritative glyph list is that function’s own `switch`, never a transcription here or in the spec body — SPEC-143 AC-CT-1 measures its injectivity (seven states → set size 7, eighth state a compile error) and `scripts/check-ac-state-renderers.ts --rule glyph-projection` refuses any second projection outside `acceptance.ts`. Why amended rather than left alone: fixing the renderer alone would have turned this criterion into a corpus falsehood the mirror check then enshrines. BODY AMENDED IN THE SAME SESSION (v22, agent:main-orchestrator): the 文本投影 bullet now names `projectAcCoverageGlyph` as the single projection instead of transcribing glyphs, closing the residual the implementing agent could only report. ⛔ Mechanically checkable, not prose: `lore get SPEC-038 --json | jq -r .data.doc.content | grep -c '✔/✘/·'` MUST print 0.
spec-spec-038-ac-as-code-structured-acceptance-criteria-oracle-b	AC-ACODE-10	full existing suites pass on both runners (enum extraction + evidenceEntrySchema blast radius)
spec-spec-038-ac-as-code-structured-acceptance-criteria-oracle-b	AC-ACODE-11	monorepo typecheck passes
spec-falsifiability-reachability-a-feedable-checkpoint-an	AC-FR-1	LIVE SURFACE (G1): for EVERY checkpoint registered in checkpointRegistry, a real `lore feed <checkpoint>` invocation exits EXACTLY 0 and emits a non-empty rule slice naming its source — asserted by enumerating the registry AT TEST TIME and driving the CLI once per entry, never against a hand-listed set. AND: an UNREGISTERED checkpoint name exits EXACTLY 2 (matching the arity errors phase-start/task-start already return), never 0. RED (both required): (a) replace the derivation with a parallel hand-maintained list and the test must fail naming the checkpoint that became unreachable; (b) restore the silent-success path and the unregistered-name case must fail. Measured baseline 2026-08-10 on the merged tree: spec-promote / plan-promote / task-claim each print 'unknown checkpoint: <name>' AND EXIT 0 — so a script running `lore feed spec-promote && <next>` proceeds as though it had been fed. That silent-zero is the sharper half of this criterion.
spec-falsifiability-reachability-a-feedable-checkpoint-an	AC-FR-2	LIVE SURFACE (G2): an AC carrying a declared falsifier can be driven to an ATTESTED red — a real `lore verify` invocation applies the falsifier, runs the AC command, and records an expected-fail row whose capture_source is 'runner', not 'self-report'. The recorded row's exit code MUST equal the exact value the falsifier declares, and its output MUST contain a token naming what failed. RED: strip the falsifier from the AC and verify must record NOTHING rather than a passing red; declare an exit code the mutation does not actually produce and the run must fail loudly instead of recording. Baseline 2026-08-10: attested_fail=0 on every AC of three separate plans.
spec-falsifiability-reachability-a-feedable-checkpoint-an	AC-FR-3	ISOLATION (G2/D3): after a falsifier run — including one that CRASHES mid-run — the working tree is byte-identical to its pre-run state, proven by comparing a content hash of every path the falsifier touches, taken before and after, plus `git status --porcelain` being empty. The mutation MUST be applied in a scratch worktree, never in the working tree. RED: apply the falsifier in-place with a finally-block revert, then kill the process mid-run; the hash comparison must fail. ⛔ A revert that only restores from an in-memory copy does NOT satisfy this — this repo already shipped one such backup that was never read back.
spec-falsifiability-reachability-a-feedable-checkpoint-an	AC-FR-4	GUARD PREDICATE (G4): a real `lore evidence --result pass` with a NON-EMPTY but hand-authored tail and capture_source 'self-report' is REFUSED at exactly the same exit code the empty-tail case already returns, and the refusal names --capture. The same call with --capture SUCCEEDS. ⛔ Asserted by driving the CLI, never the service. RED (both directions required): (a) supply a non-empty hand-written tail and the call must be refused — today it is ACCEPTED, which is the defect; (b) supply --capture and it must NOT be refused, proving the guard did not simply become a blanket denial. Baseline 2026-08-10: 2 of 3 dispatched agents passed this guard with a hand-written summary.
spec-falsifiability-reachability-a-feedable-checkpoint-an	AC-FR-5	VISIBILITY (G4 + the count-without-members gap): EVERY corpus-wide count `lore status --json` reports has a sibling that ENUMERATES its members — asserted generically: the test reads the set of count-suffixed fields from a real `lore status --json` and, for EACH one, drives a real enumeration call and asserts the returned member count EQUALS the reported number. This MUST cover at minimum pass_unfalsified_count, unredeemed_allow_missing_path_count, and a new capture_source distribution (runner vs self-report). `lore assess` reports the capture_source ratio alongside the attested ratio it already prints. RED (both required): (a) seed a corpus with one runner row and one self-report row and assert BOTH counts are non-zero and correct — a projection hardcoding zero self-reports would otherwise pass; (b) add a new count field WITHOUT an enumerator and the test must fail naming that field, so the contract binds future counts too. ⛔ Measured 2026-08-10: producing the member list behind pass_unfalsified_count=29 required a throwaway script iterating all 138 specs, because no enumerator exists.
spec-falsifiability-reachability-a-feedable-checkpoint-an	AC-FR-6	MIRROR PARITY (G5): root package.json's script chain contains the spec-mirror export script — proving it is WIRED, not merely present — and after running it, the count of files under docs/requirements/spec/ EQUALS the corpus spec count read from `lore list --type spec --json`, with every corpus spec slug present as a file. ⛔ Asserted against the LIVE corpus count, never a literal typed into the test. RED (both required): (a) remove the script from the chain and this must fail; (b) delete one exported file after export and the parity assertion must fail naming that slug. Baseline 2026-08-10: the mirror held 100 files against 141 corpus specs and no export script existed.
spec-falsifiability-reachability-a-feedable-checkpoint-an	AC-FR-7	DRIFT DETECTION (G5/D6): the drift check and the export are SEPARATE commands — the check MUST NOT regenerate what it inspects. With one mirror file deleted, the check exits EXACTLY the documented non-zero code and its output NAMES the missing slug; run twice in a row it reports the same drift both times (proving it did not silently repair). ⛔ Asserting merely 'non-zero' is unacceptable: a check that crashes before inspecting anything also exits non-zero and has zero discriminating power. RED: make the check call the exporter first and the second run must then report clean — that must fail this AC.
spec-falsifiability-reachability-a-feedable-checkpoint-an	AC-FR-8	AUDITABILITY: for EVERY deterministic gate checkpoint, a PASSING evaluation leaves a queryable audit entry naming the checkpoint and its verdict, so a pass is distinguishable from a gate that never ran. Asserted by driving the real write path for each checkpoint and then querying `lore audit <doc> --json`, never by reading source. RED (both required): (a) suppress the trace for one checkpoint and the test must fail naming it; (b) assert the trace exists for a doc whose gate was DISABLED via config and it must fail — proving the test distinguishes evaluated-and-passed from not-evaluated. ⛔ Measured 2026-08-10: promoting a spec to approved printed ZERO gate output AND left ZERO gate entries in lore audit (11 entries, all create/update) — the only way to establish spec-promote had evaluated was reading corpus-service.ts. spec-governance-visibility's AC-GV-1/AC-GV-6 fixed this for plan-close ONLY.
spec-falsifiability-reachability-a-feedable-checkpoint-an	AC-FR-9	SUGGESTED-COMMAND INTEGRITY: every pasteable command a lore error message emits must actually resolve — each named subcommand exists and each named flag is accepted by THAT subcommand. Asserted by scanning the source for command-shaped strings inside error/refusal messages and, for each, driving the real CLI's --help (or a dry parse) to confirm every flag is recognised. RED (both required): (a) point a message at a flag its subcommand does not accept and the test must fail naming the message's file:line; (b) point it at a flag that IS accepted and the test must pass, proving the scanner is not just always-failing. ⛔ Measured 2026-08-10, in the SAME session and the SAME code that fixed G4: verify-runner-service.ts:1472 tells the user to run 'lore ac add/set <spec> <id> --falsifier-path ...', but 'ac set' does not accept any --falsifier-* flag (its --help mentions falsifier 0 times vs ac add's 4) and the call exits 2 with 'Unknown option: --falsifier-path'. This passed every AC, was attested, and was archived, because nothing asserted that a message's own instructions are executable. It is G4's exact shape — a message promising more than the implementation delivers — recurring within hours of G4 being closed.
spec-falsifiability-reachability-a-feedable-checkpoint-an	AC-FR-10	FULL-CORPUS MIRROR INTEGRITY, asserted against THIS repo's PRODUCTION corpus (never a seeded fixture): (a) for EVERY exported doc type, the mirror file count EQUALS that type's live corpus count read from `lore list --type <t> --json`; (b) every mirror file's frontmatter `id:` is BYTE-IDENTICAL to its filename's leading identifier — zero-padded to 3 digits (SPEC-021, not SPEC-21); (c) the migration-coverage eval over docs/requirements reports links_broken === 0. RED (all three required): (a) delete one exported file of any type -> fails naming the type and slug; (b) rewrite one file's frontmatter id to the non-padded form -> fails naming that file; (c) point one cross-type reference at a non-existent id -> links_broken becomes non-zero and the test fails. ⛔ Measured 2026-08-10 on the merged tree: export-index.json stores human_id 'SPEC-21' while its own file_path says 'SPEC-021' — the inconsistency lives in the SSOT itself; 89 of 142 spec mirrors had filename-vs-id mismatch, producing 88 broken cross-type references (plan 73 / knowledge 14 / adr 1) and turning the full suite red at 1 failed / 493 passed. Non-spec mirrors were also stale: adr 12/30, knowledge 168/399, plan 75/120, task 316/644. ⛔ Zero-padding is the chosen canonical form (user decision 2026-08-10): filenames already use it and it makes lexical order match numeric order.
spec-falsifiability-reachability-a-feedable-checkpoint-an	AC-FR-11	Given a scratch worktree in which the AC's own UNMUTATED command already exits nonzero, lore verify --falsify records result inconclusive with no attestation and never records result expected-fail: the green control runs BEFORE the mutation is applied, so an unrunnable scratch environment (absent node_modules, absent untracked test file, absent gitignored binary) cannot mint a machine-proven red.
spec-falsifiability-reachability-a-feedable-checkpoint-an	AC-FR-12	SURFACE + PERSISTENCE (the layer AC-FR-11's service-level oracle does not reach): a real lore verify --falsify invocation against a throwaway corpus whose scratch worktree cannot run the command PERSISTS an evidence row with result inconclusive and NO attestation block — asserted by reading the row back out of the corpus, never from an injected recorder spy — AND the CLI prints a message naming the green control and exits 3, not 0. RED (both required): (a) make the CLI branch print success and exit 0 and this must fail; (b) make the runner skip the inconclusive record entirely and the read-back must fail finding the row.
spec-a-falsifier-s-scratch-worktree-must-be-runnable-and	AC-SD-1	LAYOUT IS ACTUALLY HYBRID, INCLUDING NESTED TREES: after materializing dependencies into a scratch worktree produced by createFalsifierScratchWorktree, (a) <scratch>/node_modules is a REAL directory and NOT a symlink (lstat), (b) <scratch>/node_modules/@lore is a REAL directory, (c) EVERY entry under it realpaths to a path INSIDE <scratch>, asserted by enumerating the directory at test time and never against a hand-listed set, (d) a named third-party entry (vitest) realpaths OUTSIDE <scratch>, into the main checkout node_modules, and (e) for EVERY nested per-package node_modules that exists in the main checkout — discovered by enumerating packages/*/node_modules at test time, not by naming packages/dashboard — the corresponding <scratch> path exists AND its directory listing is NON-EMPTY AND at least one entry name read from the MAIN nested tree realpaths, through the <scratch> path, to that same main-checkout entry. ⛔ "resolves to a readable directory" alone is NOT the check: an empty-but-readable directory satisfies those words while nested resolution stays broken, which is precisely the gap (e) exists to close. All five parts are required: (a)-(c) refuse the plain-symlink layout that the ADR rejects, (d) refuses a full copy, which would satisfy (a)-(c) while paying a 373MB walk per run, and (e) refuses both an absent nested tree and an empty placeholder. RED (four directions required): (i) replace materialization with a plain ln -s of the main node_modules and (c) must fail NAMING the escaping entry; (ii) copy the whole main node_modules in and (d) must fail naming vitest; (iii) skip nested trees entirely and (e) must fail naming the nested path that is absent; (iv) create each nested path as an EMPTY directory and (e) must still fail, on the non-empty and entry-realpath clauses. Covered by describe title "hybrid layout".
spec-a-falsifier-s-scratch-worktree-must-be-runnable-and	AC-SD-2	WORKSPACE SET IS DERIVED, NEVER ENUMERATED: the materializer computes its redirect set at runtime from the repository itself (the main node_modules/@lore directory listing, or the package.json workspace globs). Asserted by adding an ADDITIONAL workspace package to the fixture repo and running the materializer with NO code change: a redirect for that new package MUST appear, realpathing inside the scratch tree. RED: replace the derivation with a hand-listed array of the names that exist at implementation time and this test must fail NAMING the package that lost its redirect. ⛔ No literal package count appears in this criterion on purpose — a count is a claim with no oracle and rots as the workspace grows; the derivation requirement makes the number incidental. Rationale: a hand-listed set silently reverts a later-added package to the plain-symlink blind spot, which the green control cannot see. Covered by describe title "derived workspace set".
spec-a-falsifier-s-scratch-worktree-must-be-runnable-and	AC-SD-3	MUTATION OBSERVABILITY, PAIRED WITH A GREEN CONTROL — the property no exit code from a passing control can establish: in ONE materialized scratch worktree, (a) the target test command UNMUTATED exits EXACTLY 0 (the green control; if this fails the whole test fails rather than crediting a red that came from a broken harness), and then (b) after mutating a file in a workspace package that the target reaches by BARE specifier (@lore/core), the same command exits EXACTLY 1 AND its combined output CONTAINS the mutated file absolute path under the SCRATCH directory. Asserting merely non-zero is unacceptable — a harness that never started also exits non-zero. RED (both required): (i) swap materialization for the plain-symlink layout and (b) must fail because the command goes green (measured 2026-08-23: exit 0, 77 passed, the exact defect this spec exists to prevent); (ii) break the scratch environment and (a) must fail rather than the test passing on a spurious red. Covered by describe title "mutation observability".
spec-a-falsifier-s-scratch-worktree-must-be-runnable-and	AC-SD-4	ISOLATION NON-REGRESSION, BOTH HALVES, OVER A DERIVED PATH SET: after a full materialize-mutate-run-cleanup cycle, (a) the MAIN checkout git status --porcelain is EMPTY and a digest over the sorted (path, content-hash) pairs of EVERY path returned by `git ls-files -z` in the main checkout is byte-identical before and after — the path set MUST be derived from git ls-files at test time, never an implementer-chosen subset, because an assertion whose coverage the implementer picks can shrink to one path and still report pass; and (b) the MAIN checkout own node_modules/@lore/* link TARGETS are unchanged, compared by readlink over an enumeration of that directory before and after. Half (b) is the non-obvious one: an implementation could make bare-specifier resolution work by rewriting the ORIGINAL checkout links instead of building scratch-internal ones, which would satisfy AC-SD-3 while corrupting the developer main tree. RED (three required): (i) apply the mutation in the working tree with a finally-block revert and kill the process mid-run, and (a) must fail; (ii) narrow (a) to a single hardcoded path and the derivation assertion must fail, proving the path set is enumerated rather than chosen; (iii) make the materializer repoint the main node_modules/@lore links at the scratch tree and (b) must fail naming the changed link. Extends AC-FR-3 of spec-falsifiability-reachability, which covers the working tree only and says nothing about node_modules. Covered by describe title "main checkout untouched".
spec-a-falsifier-s-scratch-worktree-must-be-runnable-and	AC-SD-5	BOTH RUNNERS FROM ONE MATERIALIZED WORKTREE, EACH WITH ITS OWN FALSIFYING DIRECTION: in a single materialized scratch worktree, a vitest target file and a .bun.test.ts target file EACH exit EXACTLY 0, asserted by both exit codes plus each runner own summary line in the output (vitest "Test Files  1 passed", bun "0 fail"). This pins the .bun.test.ts population, which the repo two-runner split makes a separate reachability question and which vitest --changed is already structurally blind to. RED (both required, one per runner — neither half may be green-only): (i) omit the dotted entries (notably .bin) from the symlinked set and the VITEST invocation must fail, proving the .bin path is what that half depends on; (ii) run the SAME bun command in a scratch worktree with materialization SKIPPED and it must exit nonzero, proving materialization is what makes the bun half green rather than the bun runner resolving dependencies on its own. ⛔ Without (ii) the bun half would be a green-only assertion with no discriminating power, which is the exact defect class this spec was written to close. Covered by describe title "both runners".
spec-a-falsifier-s-scratch-worktree-must-be-runnable-and	AC-SD-6	PRODUCTION WIRING — the surface the service-level ACs do not reach: a REAL lore verify --falsify invocation, driven as the CLI against a THROWAWAY corpus (mkdtemp + lore init, never this repo .lore/), over a fixture AC whose oracle is a vitest command requiring node_modules and whose falsifier declares --falsifier-exit-code 1 (the value vitest returns for an assertion failure), PERSISTS an evidence row with result expected-fail carrying an attestation block whose exit_code EQUALS EXACTLY 1 — the declared value is named here on purpose so a reader can determine the expected number without external context — asserted by reading the row back OUT of the throwaway corpus, never from an injected recorder spy, and the CLI exits EXACTLY 0. RED (both required): (i) disable materialization and the persisted row must become result inconclusive with NO attestation, proving materialization is what changed the outcome AND that the green control still fires; (ii) make the runner skip persistence and the read-back must fail to find the row. Rationale: an attested pass at the service layer is not evidence of production wiring — this repo has measured that shape three times.
spec-a-falsifier-s-scratch-worktree-must-be-runnable-and	AC-SD-7	THE GREEN CONTROL IS NOT DISARMED: with materialization ENABLED, a falsifier whose AC command is unrunnable for a reason materialization does not address — specifically a command naming a test file that exists in the working tree but is UNTRACKED, so git stash create omits it — still records result inconclusive with NO attestation block, and never records expected-fail. This is the regression guard on AC-FR-11: making the environment usable for the dependency cause must not make the control unable to fire for the other two causes (untracked files, gitignored dist/lore), both of which remain explicitly out of scope. RED (both required): (i) hardcode the green control to always pass and this must fail because the row becomes expected-fail; (ii) make materialization also stage untracked files and this must fail — that would be a scope change requiring its own spec, not a silent widening. Covered by describe title "green control still fires".
spec-a-falsifier-s-scratch-worktree-must-be-runnable-and	AC-SD-8	CLEANUP CANNOT DELETE THROUGH A SYMLINK: a sentinel file written inside the MAIN checkout node_modules before the cycle still EXISTS with identical content after removeFalsifierScratchWorktree runs, and the scratch parent directory no longer exists. Both halves required. This guards the single most destructive failure mode the hybrid layout introduces: cleanup is a recursive delete over a tree that now contains 400+ symlinks pointing INTO the developer main node_modules, so a follow-symlinks delete would destroy the real dependency tree. RED (both required): (i) implement cleanup with a symlink-FOLLOWING recursive delete and the sentinel must vanish, failing this test; (ii) make cleanup a no-op and the scratch-parent-absent half must fail, so the test cannot be satisfied by simply not deleting anything. Covered by describe title "cleanup cannot escape".
spec-declaring-ac-scope-is-required-at-task-creation-so-the	AC-ACS-1	Creating a task under a plan whose spec declares at least one script-mode AC, with no --ac-scope, is refused and the message contains the literal --ac-scope.
spec-declaring-ac-scope-is-required-at-task-creation-so-the	AC-ACS-2	The same creation with --ac-scope succeeds and the stored extra.ac_scope equals exactly the ids passed.
spec-declaring-ac-scope-is-required-at-task-creation-so-the	AC-ACS-3	An explicitly empty --ac-scope succeeds and stores an EMPTY array, a state distinct from absent.
spec-declaring-ac-scope-is-required-at-task-creation-so-the	AC-ACS-4	A plan whose spec declares only ai/human-mode criteria, or none, accepts a task with no --ac-scope: the predicate passes vacuously and adds no friction.
spec-declaring-ac-scope-is-required-at-task-creation-so-the	AC-ACS-5	An --adhoc task with NO --ac-scope is REFUSED at exit 4, and the same call with --ac-scope "" exits 0 storing an EMPTY array: the ad-hoc branch is BOUND by the requiredness rule, keyed on the author's flag at the CLI layer rather than on a parent plan's spec. Reverses this criterion's original not-applicable-never-exempt reading, superseded 2026-08-03 by task-an-ad-hoc-task-can-never-reach-the-attestation-path-that — the old reading described a trigger that could never fire, which is what made --override-attestation routine for the dominant task shape.
spec-declaring-ac-scope-is-required-at-task-creation-so-the	AC-ACS-7	The refusal enumerates the governing spec's script-mode criterion ids so the author can copy one rather than query for legal values.
spec-declaring-ac-scope-is-required-at-task-creation-so-the	AC-ACS-6	REGRESSION: lore verify with an ABSENT ac_scope plus an explicit --ac still runs the named ids and still writes runner-attested evidence, keeping the back-catalogue recovery path open.
spec-declaring-ac-scope-is-required-at-task-creation-so-the	AC-ACS-8	End-to-end: a task created under this rule is verified by lore verify and the resulting STORED evidence entry carries an attestation block, asserted on the entry itself rather than on a zero exit code.

````

## mapping/a5-p.tsv

````text
spec_slug	ac_id	primary_rule	other_rules	note	confidence
spec-lore-ac-set-in-place-edit-of-a-declared-acceptance	AC-ACS-1	BR-ACRV-001	BR-ACRV-005	Revision must change at least one part	high
spec-lore-ac-set-in-place-edit-of-a-declared-acceptance	AC-ACS-2	BR-ACRV-002		Revising a criterion the spec does not declare is refused	high
spec-lore-ac-set-in-place-edit-of-a-declared-acceptance	AC-ACS-6	BR-ACRV-007		Every other criterion unchanged after revision	high
spec-lore-ac-set-in-place-edit-of-a-declared-acceptance	AC-ACS-7	BR-ACWD-003	BR-ACDC-022	Dangling references from withdrawn criteria	high
spec-lore-ac-set-in-place-edit-of-a-declared-acceptance	AC-ACS-3	BR-ACRV-001		Revision with no fields is refused	high
spec-lore-ac-set-in-place-edit-of-a-declared-acceptance	AC-ACS-4	BR-ACRV-020	BR-SPAP-021	Revising approved spec returns it to draft	high
spec-lore-ac-set-in-place-edit-of-a-declared-acceptance	AC-ACS-5	BR-ACRV-004		Field flags must match criterion's mode	high
spec-lore-ac-set-in-place-edit-of-a-declared-acceptance	AC-ACS-8	BR-ACRV-005	BR-ACRV-025	Revised criterion persisted and retrieved	high
spec-lore-ac-set-in-place-edit-of-a-declared-acceptance	AC-ACS-9	BR-ACRV-021		Revising draft spec leaves it draft	high
spec-lore-ac-set-in-place-edit-of-a-declared-acceptance	AC-ACS-10	BR-ACRV-003		AC id cannot be revised	high
spec-lore-ac-set-in-place-edit-of-a-declared-acceptance	AC-ACS-11	BR-ACRV-007		Criterion count unchanged after revision	high
spec-lore-ac-set-in-place-edit-of-a-declared-acceptance	AC-ACS-12	BR-ACRV-025	BR-ACRV-021	No status-transition entry when spec stays draft	high
spec-spec-ac-quantifiability-gate-design-time-standardization-en	AC-ACQ-1	BR-ACDC-004		Abstract word without measurable anchor is blocked	high
spec-spec-ac-quantifiability-gate-design-time-standardization-en	AC-ACQ-2	BR-ACDC-004		AC quantifiability gate runs without AI provider	high
spec-spec-ac-quantifiability-gate-design-time-standardization-en	AC-ACQ-3	BR-SPCR-005	BR-ACDC-004	Creation gate blocks unmeasurable AC	high
spec-spec-ac-quantifiability-gate-design-time-standardization-en	AC-ACQ-4	BR-SPCR-005	BR-ACDC-004	Gate can be disabled via config	high
spec-spec-ac-quantifiability-gate-design-time-standardization-en	AC-ACQ-5	BR-SPCR-005	BR-ACDC-004	Deterministic gate needs no provider	high
spec-spec-ac-quantifiability-gate-design-time-standardization-en	AC-ACQ-6	BR-ACDC-004	BR-ACDC-002,BR-ACDC-003	Own spec ACs pass quantifiability check	high
spec-spec-ac-quantifiability-gate-design-time-standardization-en	AC-ACQ-7	BR-ACDC-004		Abstract word detection handles hyphenation correctly	high
spec-spec-059-requirement-layer-quantifiability-lint-close-spec	AC-RQ-1	BR-ACDC-004		lintStatement exported and works correctly	high
spec-spec-059-requirement-layer-quantifiability-lint-close-spec	AC-RQ-2	BR-ACDC-004	BR-SPAP-003	lint refactored preserves output	high
spec-spec-059-requirement-layer-quantifiability-lint-close-spec	AC-RQ-3	BR-ACDC-004	BR-ACDC-008	RequirementService enforces quantifiability	medium
spec-spec-059-requirement-layer-quantifiability-lint-close-spec	AC-RQ-5	BR-ACDC-004		Gate configuration can disable quantifiability check	high
spec-spec-059-requirement-layer-quantifiability-lint-close-spec	AC-RQ-6	NO-RULE		Overall typecheck success not a specification rule	low
spec-spec-059-requirement-layer-quantifiability-lint-close-spec	AC-RQ-4	BR-ACDC-004		CLI exit code for VALIDATION_ERROR matches specification	high
spec-spec-058-verification-profiles-per-spec-kind-oracle-coverag	AC-V-1	BR-SPAP-004	BR-ACDC-006	Check kind coverage oracle	high
spec-spec-058-verification-profiles-per-spec-kind-oracle-coverag	AC-V-2	BR-SPAP-004	BR-ACDC-006	Spec-promote gate enforces check kind coverage	high
spec-spec-058-verification-profiles-per-spec-kind-oracle-coverag	AC-V-3	OUT-OF-BRANCH	BR-SPAP-004	Plan UAT requirement; mostly execution layer	low
spec-spec-058-verification-profiles-per-spec-kind-oracle-coverag	AC-V-4	OUT-OF-BRANCH		Config template is technical setup	low
spec-spec-058-verification-profiles-per-spec-kind-oracle-coverag	AC-V-5	NO-RULE		Overall typecheck not a specification rule	low
spec-spec-058-verification-profiles-per-spec-kind-oracle-coverag	AC-V-6	OUT-OF-BRANCH		Plan creation with flag; execution layer	low
spec-spec-058-verification-profiles-per-spec-kind-oracle-coverag	AC-V-7	OUT-OF-BRANCH		MCP plan creation; execution layer	low
spec-spec-055-requirement-ac-completeness-oracle	AC-055-1	OUT-OF-BRANCH		Requirements schema validation; not specification rules	low
spec-spec-055-requirement-ac-completeness-oracle	AC-055-2	OUT-OF-BRANCH		Requirements schema; not specification rules	low
spec-spec-055-requirement-ac-completeness-oracle	AC-055-3	OUT-OF-BRANCH		Requirement coverage computation; execution layer	low
spec-spec-055-requirement-ac-completeness-oracle	AC-055-4	OUT-OF-BRANCH		Requirement coverage exit code; execution layer	low
spec-spec-055-requirement-ac-completeness-oracle	AC-055-5	OUT-OF-BRANCH		Requirement persistence; not specification rules	low
spec-spec-055-requirement-ac-completeness-oracle	AC-055-6	OUT-OF-BRANCH		Requirement coverage to PRD; execution layer	low
spec-spec-055-requirement-ac-completeness-oracle	AC-055-7	OUT-OF-BRANCH		AC requirement_refs persistence; not specification rules	low
spec-spec-053-ai-advisory-ac-vagueness-supplement-on-lore-review	AC-053-1	OUT-OF-BRANCH		Review prompt versioning; review layer	low
spec-spec-053-ai-advisory-ac-vagueness-supplement-on-lore-review	AC-053-2	OUT-OF-BRANCH		Advisory kind enum; review layer	low
spec-spec-053-ai-advisory-ac-vagueness-supplement-on-lore-review	AC-053-3	OUT-OF-BRANCH		Review prompt AC quantifiability section; review layer	low
spec-spec-053-ai-advisory-ac-vagueness-supplement-on-lore-review	AC-053-4	OUT-OF-BRANCH		Advisory non-forcing clause; review layer	low
spec-spec-053-ai-advisory-ac-vagueness-supplement-on-lore-review	AC-053-5	OUT-OF-BRANCH		Advisory verdict embedding; review layer	low
spec-spec-053-ai-advisory-ac-vagueness-supplement-on-lore-review	AC-053-6	OUT-OF-BRANCH		V1 prompt backward compat; review layer	low
spec-spec-053-ai-advisory-ac-vagueness-supplement-on-lore-review	AC-053-7	OUT-OF-BRANCH		Advisory rendering; review layer	low
spec-spec-038-ac-as-code-structured-acceptance-criteria-oracle-b	AC-ACODE-1	BR-ACDC-002	BR-ACDC-003,BR-ACDC-006	Criterion schema validation	high
spec-spec-038-ac-as-code-structured-acceptance-criteria-oracle-b	AC-ACODE-2	BR-ACDC-002	BR-ACDC-006	Create/set reject invalid criteria	high
spec-spec-038-ac-as-code-structured-acceptance-criteria-oracle-b	AC-ACODE-3	BR-ACDC-009	BR-ACDC-008	Evidence ac_ref must reference declared criterion id	high
spec-spec-038-ac-as-code-structured-acceptance-criteria-oracle-b	AC-ACODE-4	OUT-OF-BRANCH		Assessment prompt with AC table; execution layer	low
spec-spec-038-ac-as-code-structured-acceptance-criteria-oracle-b	AC-ACODE-5	OUT-OF-BRANCH		Judge output validation; execution layer	low
spec-spec-038-ac-as-code-structured-acceptance-criteria-oracle-b	AC-ACODE-6	OUT-OF-BRANCH		Coverage aggregation; execution layer	low
spec-spec-038-ac-as-code-structured-acceptance-criteria-oracle-b	AC-ACODE-7	BR-ACDC-002	BR-ACWD-002,BR-ACRV-002	AC add/list/rm roundtrip works	high
spec-spec-038-ac-as-code-structured-acceptance-criteria-oracle-b	AC-ACODE-8	BR-ACDC-006		Oracle enum kinds defined exactly once	high
spec-spec-038-ac-as-code-structured-acceptance-criteria-oracle-b	AC-ACODE-9	OUT-OF-BRANCH		Text projection is display/presentation	low
spec-spec-038-ac-as-code-structured-acceptance-criteria-oracle-b	AC-ACODE-10	NO-RULE		Test suite success not a specification rule	low
spec-spec-038-ac-as-code-structured-acceptance-criteria-oracle-b	AC-ACODE-11	NO-RULE		Monorepo typecheck not a specification rule	low
spec-falsifiability-reachability-a-feedable-checkpoint-an	AC-FR-1	BR-FALS-006	BR-ACDC-006	Falsifier checkpoints are feedable	high
spec-falsifiability-reachability-a-feedable-checkpoint-an	AC-FR-2	BR-FALS-001	BR-FALS-002	Falsifier can be run to produce attested red	high
spec-falsifiability-reachability-a-feedable-checkpoint-an	AC-FR-3	BR-FALS-005	BR-FALS-001	Falsifier isolation: working tree unchanged after run	high
spec-falsifiability-reachability-a-feedable-checkpoint-an	AC-FR-4	OUT-OF-BRANCH	BR-FALS-*	Evidence recording guard; execution layer	low
spec-falsifiability-reachability-a-feedable-checkpoint-an	AC-FR-5	OUT-OF-BRANCH		Status count visibility; reporting layer	low
spec-falsifiability-reachability-a-feedable-checkpoint-an	AC-FR-6	OUT-OF-BRANCH		Mirror export parity; distribution layer	low
spec-falsifiability-reachability-a-feedable-checkpoint-an	AC-FR-7	OUT-OF-BRANCH		Drift detection; hygiene layer	low
spec-falsifiability-reachability-a-feedable-checkpoint-an	AC-FR-8	OUT-OF-BRANCH		Gate auditability; governance layer	low
spec-falsifiability-reachability-a-feedable-checkpoint-an	AC-FR-9	OUT-OF-BRANCH		Error message integrity; UX layer	low
spec-falsifiability-reachability-a-feedable-checkpoint-an	AC-FR-10	OUT-OF-BRANCH		Mirror integrity check; distribution layer	low
spec-falsifiability-reachability-a-feedable-checkpoint-an	AC-FR-11	BR-FALS-005		Falsifier green control precondition	high
spec-falsifiability-reachability-a-feedable-checkpoint-an	AC-FR-12	BR-FALS-002	BR-FALS-001	Falsifier persistence at CLI	high
spec-a-falsifier-s-scratch-worktree-must-be-runnable-and	AC-SD-1	OUT-OF-BRANCH		Scratch worktree layout; execution infrastructure	low
spec-a-falsifier-s-scratch-worktree-must-be-runnable-and	AC-SD-2	OUT-OF-BRANCH		Worktree workspace set derivation; execution infrastructure	low
spec-a-falsifier-s-scratch-worktree-must-be-runnable-and	AC-SD-3	OUT-OF-BRANCH		Mutation observability; execution infrastructure	low
spec-a-falsifier-s-scratch-worktree-must-be-runnable-and	AC-SD-4	OUT-OF-BRANCH		Isolation non-regression; execution infrastructure	low
spec-a-falsifier-s-scratch-worktree-must-be-runnable-and	AC-SD-5	OUT-OF-BRANCH		Both runners in worktree; execution infrastructure	low
spec-a-falsifier-s-scratch-worktree-must-be-runnable-and	AC-SD-6	BR-FALS-002	BR-FALS-001	Falsifier production wiring via CLI	high
spec-a-falsifier-s-scratch-worktree-must-be-runnable-and	AC-SD-7	BR-FALS-005	BR-ACDC-007	Green control non-disarming	high
spec-a-falsifier-s-scratch-worktree-must-be-runnable-and	AC-SD-8	OUT-OF-BRANCH		Cleanup isolation; execution infrastructure	low
spec-declaring-ac-scope-is-required-at-task-creation-so-the	AC-ACS-1	OUT-OF-BRANCH		Task AC scope requirement; execution layer	low
spec-declaring-ac-scope-is-required-at-task-creation-so-the	AC-ACS-2	OUT-OF-BRANCH		Task AC scope persistence; execution layer	low
spec-declaring-ac-scope-is-required-at-task-creation-so-the	AC-ACS-3	OUT-OF-BRANCH		Empty AC scope; execution layer	low
spec-declaring-ac-scope-is-required-at-task-creation-so-the	AC-ACS-4	OUT-OF-BRANCH		AC scope predicate for non-script criteria; execution layer	low
spec-declaring-ac-scope-is-required-at-task-creation-so-the	AC-ACS-5	OUT-OF-BRANCH		Ad-hoc task AC scope requirement; execution layer	low
spec-declaring-ac-scope-is-required-at-task-creation-so-the	AC-ACS-7	OUT-OF-BRANCH		AC scope error enumeration; execution layer	low
spec-declaring-ac-scope-is-required-at-task-creation-so-the	AC-ACS-6	OUT-OF-BRANCH		AC scope backward compat; execution layer	low
spec-declaring-ac-scope-is-required-at-task-creation-so-the	AC-ACS-8	OUT-OF-BRANCH		Evidence recording under task AC scope; execution layer	low

````

## mapping/a5-q.tsv

````text
spec_slug	ac_id	primary_rule	other_rules	note	confidence
spec-lore-ac-set-in-place-edit-of-a-declared-acceptance	AC-ACS-1	BR-ACRV	BR-ACRV-001,BR-ACRV-005	lore ac set command basic success case	high
spec-lore-ac-set-in-place-edit-of-a-declared-acceptance	AC-ACS-2	BR-ACRV-002		validation: non-existent criterion id	high
spec-lore-ac-set-in-place-edit-of-a-declared-acceptance	AC-ACS-3	BR-ACRV-001		no-op edit is an error	high
spec-lore-ac-set-in-place-edit-of-a-declared-acceptance	AC-ACS-4	BR-ACRV-020		approved spec demotion on revision	high
spec-lore-ac-set-in-place-edit-of-a-declared-acceptance	AC-ACS-5	BR-ACRV-004		mode-specific field validation	high
spec-lore-ac-set-in-place-edit-of-a-declared-acceptance	AC-ACS-6	BR-ACRV-007		immutability of other criteria	high
spec-lore-ac-set-in-place-edit-of-a-declared-acceptance	AC-ACS-7	BR-ACRV-023	BR-ACWD-003	evidence integrity: no dangling references after revision	medium
spec-lore-ac-set-in-place-edit-of-a-declared-acceptance	AC-ACS-8	BR-ACRV-005		revised criterion roundtrips via list	high
spec-lore-ac-set-in-place-edit-of-a-declared-acceptance	AC-ACS-9	BR-ACRV-021		draft spec status unchanged on revision	high
spec-lore-ac-set-in-place-edit-of-a-declared-acceptance	AC-ACS-10	BR-ACRV-003		criterion id immutable	high
spec-lore-ac-set-in-place-edit-of-a-declared-acceptance	AC-ACS-11	BR-ACRV-007		criterion count unchanged	high
spec-lore-ac-set-in-place-edit-of-a-declared-acceptance	AC-ACS-12	BR-ACRV-025		version history entry on revision	high
spec-spec-ac-quantifiability-gate-design-time-standardization-en	AC-ACQ-1	BR-ACDC-004	BR-ACDC-005,BR-SPAP-003	lintAcQuantifiability detects abstract words	high
spec-spec-ac-quantifiability-gate-design-time-standardization-en	AC-ACQ-2	BR-ACDC-004		zero provider calls in quantifiability check	high
spec-spec-ac-quantifiability-gate-design-time-standardization-en	AC-ACQ-3	BR-ACDC-004		spec-create with unmeasurable AC exits with feeding pack	high
spec-spec-ac-quantifiability-gate-design-time-standardization-en	AC-ACQ-4	BR-ACDC-004		gate can be disabled via config	medium
spec-spec-ac-quantifiability-gate-design-time-standardization-en	AC-ACQ-5	BR-ACDC-004		deterministic gate: no provider needed for quantified spec	high
spec-spec-ac-quantifiability-gate-design-time-standardization-en	AC-ACQ-6	BR-ACDC-004		self-referential: spec's own ACs pass the check	high
spec-spec-ac-quantifiability-gate-design-time-standardization-en	AC-ACQ-7	BR-ACDC-004		word boundary detection: hyphen-adjacent doesn't count	high
spec-spec-059-requirement-layer-quantifiability-lint-close-spec	AC-RQ-1	BR-ACDC-004		lintStatement exported from core: rejects abstract words	high
spec-spec-059-requirement-layer-quantifiability-lint-close-spec	AC-RQ-2	BR-ACDC-004		lintAcQuantifiability refactoring regression test	high
spec-spec-059-requirement-layer-quantifiability-lint-close-spec	AC-RQ-3	BR-ACDC-004		RequirementService validates quantifiability	medium
spec-spec-059-requirement-layer-quantifiability-lint-close-spec	AC-RQ-4	BR-ACDC-004		CLI exit codes for vague statements	high
spec-spec-059-requirement-layer-quantifiability-lint-close-spec	AC-RQ-5	BR-ACDC-004		requirement quantifiability gate can be disabled	medium
spec-spec-059-requirement-layer-quantifiability-lint-close-spec	AC-RQ-6	OUT-OF-BRANCH		typecheck (build/test artifact, not spec rule)	high
spec-spec-058-verification-profiles-per-spec-kind-oracle-coverag	AC-V-1	NO-RULE		checkOracleCoverage oracle verification profiles - not in drafted rules	low
spec-spec-058-verification-profiles-per-spec-kind-oracle-coverag	AC-V-2	NO-RULE		spec-promote gate with oracle coverage - not in drafted rules	low
spec-spec-058-verification-profiles-per-spec-kind-oracle-coverag	AC-V-3	NO-RULE		plan-promote requires_uat gate - not in drafted rules	low
spec-spec-058-verification-profiles-per-spec-kind-oracle-coverag	AC-V-4	NO-RULE		verification profile template config - not in drafted rules	low
spec-spec-058-verification-profiles-per-spec-kind-oracle-coverag	AC-V-5	OUT-OF-BRANCH		typecheck artifact	high
spec-spec-058-verification-profiles-per-spec-kind-oracle-coverag	AC-V-6	NO-RULE		plan --requires-uat flag - not in drafted rules	low
spec-spec-058-verification-profiles-per-spec-kind-oracle-coverag	AC-V-7	NO-RULE		MCP lore_create requires_uat - not in drafted rules	low
spec-spec-055-requirement-ac-completeness-oracle	AC-055-1	NO-RULE		requirementSchema validation - PRD requirement layer, not spec	low
spec-spec-055-requirement-ac-completeness-oracle	AC-055-2	NO-RULE		PRD requirements array schema - PRD layer, not spec	low
spec-spec-055-requirement-ac-completeness-oracle	AC-055-3	NO-RULE		computeRequirementCoverage - PRD layer, not spec	low
spec-spec-055-requirement-ac-completeness-oracle	AC-055-4	NO-RULE		requirementCoverageExitCode - PRD layer, not spec	low
spec-spec-055-requirement-ac-completeness-oracle	AC-055-5	NO-RULE		RequirementService round-trip - PRD layer, not spec	low
spec-spec-055-requirement-ac-completeness-oracle	AC-055-6	NO-RULE		CorpusService.computeRequirementCoverageForPrd - PRD coverage, not spec	low
spec-spec-055-requirement-ac-completeness-oracle	AC-055-7	BR-ACDC-008		AcService accepts optional requirement_refs	high
spec-spec-053-ai-advisory-ac-vagueness-supplement-on-lore-review	AC-053-1	BR-ACDC-004		REVIEW_PROMPT_VERSION v2 supports quantifiability advisory	medium
spec-spec-053-ai-advisory-ac-vagueness-supplement-on-lore-review	AC-053-2	BR-ACDC-004		advisory kind enum includes ac_quantifiability	medium
spec-spec-053-ai-advisory-ac-vagueness-supplement-on-lore-review	AC-053-3	BR-ACDC-004		buildReviewPromptV2 includes AC Quantifiability advisory	medium
spec-spec-053-ai-advisory-ac-vagueness-supplement-on-lore-review	AC-053-4	BR-ACDC-004		advisory does not force reject decision	medium
spec-spec-053-ai-advisory-ac-vagueness-supplement-on-lore-review	AC-053-5	BR-ACDC-004		advisory embeds lintAcQuantifiability verdict	medium
spec-spec-053-ai-advisory-ac-vagueness-supplement-on-lore-review	AC-053-6	OUT-OF-BRANCH		buildReviewPromptV1 regression (review branch, not spec)	high
spec-spec-053-ai-advisory-ac-vagueness-supplement-on-lore-review	AC-053-7	OUT-OF-BRANCH		review-render advisory (review branch, not spec)	high
spec-spec-038-ac-as-code-structured-acceptance-criteria-oracle-b	AC-ACODE-1	BR-ACDC-002	BR-ACDC-003,BR-ACDC-006,BR-ACRV-004	acceptanceCriterionSchema validation: id format, mode fields	high
spec-spec-038-ac-as-code-structured-acceptance-criteria-oracle-b	AC-ACODE-2	BR-ACDC-002	BR-ACDC-003	create and set refuse invalid acceptance_criteria	high
spec-spec-038-ac-as-code-structured-acceptance-criteria-oracle-b	AC-ACODE-3	BR-ACDC-003	BR-ACWD-003	evidence --ac with undeclared id fails validation	high
spec-spec-038-ac-as-code-structured-acceptance-criteria-oracle-b	AC-ACODE-4	BR-ACDC-002	BR-ACDC-022	assess prompt includes AC table with coverage	medium
spec-spec-038-ac-as-code-structured-acceptance-criteria-oracle-b	AC-ACODE-5	NO-RULE		judge output validation - execution layer, not spec	low
spec-spec-038-ac-as-code-structured-acceptance-criteria-oracle-b	AC-ACODE-6	NO-RULE		computeAcCoverage - execution layer, not spec	low
spec-spec-038-ac-as-code-structured-acceptance-criteria-oracle-b	AC-ACODE-7	BR-ACDC-003	BR-ACWD-002	lore ac add/list/rm roundtrip with dangling ref guard	high
spec-spec-038-ac-as-code-structured-acceptance-criteria-oracle-b	AC-ACODE-8	NO-RULE		oracle enum parity - technical implementation, not spec	low
spec-spec-038-ac-as-code-structured-acceptance-criteria-oracle-b	AC-ACODE-9	NO-RULE		text projection of structured ACs - rendering, not spec	low
spec-spec-038-ac-as-code-structured-acceptance-criteria-oracle-b	AC-ACODE-10	OUT-OF-BRANCH		existing suites regression test	high
spec-spec-038-ac-as-code-structured-acceptance-criteria-oracle-b	AC-ACODE-11	OUT-OF-BRANCH		monorepo typecheck	high
spec-falsifiability-reachability-a-feedable-checkpoint-an	AC-FR-1	BR-FALS-005	BR-FALS-006,BR-ACDC-001	checkpoint registry liveness: every registered checkpoint feeds	high
spec-falsifiability-reachability-a-feedable-checkpoint-an	AC-FR-2	BR-FALS-002	BR-FALS	falsifier is runnable to red with attested evidence	high
spec-falsifiability-reachability-a-feedable-checkpoint-an	AC-FR-3	BR-FALS-005		falsifier run isolation: scratch worktree left clean	high
spec-falsifiability-reachability-a-feedable-checkpoint-an	AC-FR-4	NO-RULE		evidence --result self-report guard - execution layer	low
spec-falsifiability-reachability-a-feedable-checkpoint-an	AC-FR-5	NO-RULE		visibility: count-member parity - corpus layer, not spec	low
spec-falsifiability-reachability-a-feedable-checkpoint-an	AC-FR-6	NO-RULE		mirror parity: spec count == exported file count	low
spec-falsifiability-reachability-a-feedable-checkpoint-an	AC-FR-7	NO-RULE		drift detection: separate from export	low
spec-falsifiability-reachability-a-feedable-checkpoint-an	AC-FR-8	NO-RULE		auditability: gate pass leaves trace - execution/gate layer	low
spec-falsifiability-reachability-a-feedable-checkpoint-an	AC-FR-9	NO-RULE		suggested command integrity - execution/validation layer	low
spec-falsifiability-reachability-a-feedable-checkpoint-an	AC-FR-10	NO-RULE		full corpus mirror integrity - corpus layer, not spec	low
spec-falsifiability-reachability-a-feedable-checkpoint-an	AC-FR-11	BR-FALS-005		falsifier green control runs before mutation	high
spec-falsifiability-reachability-a-feedable-checkpoint-an	AC-FR-12	BR-FALS-005	BR-FALS-006	falsifier CLI persistence with inconclusive result	high
spec-a-falsifier-s-scratch-worktree-must-be-runnable-and	AC-SD-1	BR-FALS-005		scratch worktree hybrid layout: real nested node_modules	high
spec-a-falsifier-s-scratch-worktree-must-be-runnable-and	AC-SD-2	BR-FALS-005		workspace set is derived at runtime	high
spec-a-falsifier-s-scratch-worktree-must-be-runnable-and	AC-SD-3	BR-FALS-005		mutation observability paired with green control	high
spec-a-falsifier-s-scratch-worktree-must-be-runnable-and	AC-SD-4	BR-FALS-005		isolation non-regression: main checkout untouched	high
spec-a-falsifier-s-scratch-worktree-must-be-runnable-and	AC-SD-5	BR-FALS-005		both runners from one materialized worktree	high
spec-a-falsifier-s-scratch-worktree-must-be-runnable-and	AC-SD-6	BR-FALS-005	BR-FALS	production wiring: real CLI invocation creates attested row	high
spec-a-falsifier-s-scratch-worktree-must-be-runnable-and	AC-SD-7	BR-FALS-005		green control still fires with unrunnable test file	high
spec-a-falsifier-s-scratch-worktree-must-be-runnable-and	AC-SD-8	BR-FALS-005		cleanup cannot delete through symlink	high
spec-declaring-ac-scope-is-required-at-task-creation-so-the	AC-ACS-1	NO-RULE		task creation validation - execution/plan layer, not spec	low
spec-declaring-ac-scope-is-required-at-task-creation-so-the	AC-ACS-2	NO-RULE		task creation with --ac-scope - execution layer	low
spec-declaring-ac-scope-is-required-at-task-creation-so-the	AC-ACS-3	NO-RULE		empty --ac-scope - execution layer	low
spec-declaring-ac-scope-is-required-at-task-creation-so-the	AC-ACS-4	NO-RULE		non-script criteria don't require --ac-scope - execution layer	low
spec-declaring-ac-scope-is-required-at-task-creation-so-the	AC-ACS-5	NO-RULE		adhoc task --ac-scope requirement - execution layer	low
spec-declaring-ac-scope-is-required-at-task-creation-so-the	AC-ACS-6	NO-RULE		lore verify with absent ac_scope - execution layer	low
spec-declaring-ac-scope-is-required-at-task-creation-so-the	AC-ACS-7	NO-RULE		refusal enumerates script AC ids - execution layer	low
spec-declaring-ac-scope-is-required-at-task-creation-so-the	AC-ACS-8	NO-RULE		end-to-end: task verification creates attested evidence	low

````

## probes/questions.md

````text
# Spec & Acceptance Criteria Boundary Test Set

## Questions

1. If someone edits only the statement text of an existing acceptance criterion on an approved spec (no changes to oracle, command, or covers), does the spec remain approved or drop to draft?

2. If someone adds a completely new acceptance criterion to an approved spec without touching any existing criteria, does the spec remain approved or drop to draft?

3. When creating a new spec under a PRD, which of these are legal parent types: (a) another spec, (b) a plan, (c) a PRD, (d) knowledge doc?

4. Can you promote a plan to approved if its ancestor spec (the spec it's parented under) is currently in draft status?

5. If a spec declares an acceptance criterion statement containing only the word "robust" with no quantifier, can that criterion be created via `lore ac add`?

6. When you declare a falsifier on an existing acceptance criterion using `lore ac set`, what happens to an approved spec: does it stay approved, drop to draft, or get rejected with an error?

7. If you add an acceptance criterion via `lore ac add` to an approved spec, then immediately edit that same criterion via `lore ac set`, how many times does the spec's status potentially change (from approved)?

8. When trying to remove an acceptance criterion that is still referenced by evidence in a task's verification log, what happens: (a) removal succeeds and evidence becomes dangling, (b) removal fails unless you pass --force, (c) removal fails regardless of flags?

9. Can you create a spec without specifying `spec_kind` at creation time, or is `spec_kind` mandatory?

10. If a parent PRD is in draft status, can you promote a spec that is parented under it?


````

## probes/answers.md

````text
# Answers with Ground Truth Evidence

## Q1: If someone edits only the statement text of an AC on an approved spec, does the spec remain approved?

**Answer: Spec drops to draft**

**Evidence:**
- **Code:** `packages/lore/src/service/ac-service.ts:507-632` — `setCriterion()` method
  - Line 623: `const newStatus = resolveStatusAfterContractEdit(spec.status, true);`
  - The `true` is hardcoded because "any editable field on a criterion is governing contract content"
  - This calls the shared rule `resolveStatusAfterContractEdit` with `contentChanged: true`
- **Code:** `packages/core/src/schemas.ts` — `resolveStatusAfterContractEdit()` 
  - Returns `"draft"` when current status is `"approved"` and `contentChanged` is `true`
- **Test:** `packages/lore/tests/unit/service/demotion-rule-ssot.test.ts`
  - This regression test ensures the demotion rule is called by `AcService.setCriterion()` (line 18: "the two call sites cannot be made to disagree")

**Prose note:** CLAUDE.md root file (before 2026-08-24) stated "an `approved` doc whose content/title changes resets to draft automatically" but had an exception: "`lore ac add` does not demote, while `lore ac set` demotes" (per knowledge-five-governance-findings). This asymmetry was NOT prominently called out in the spec-layer prose, creating confusion.

---

## Q2: If someone adds a new AC to an approved spec, does the spec remain approved?

**Answer: Spec remains approved**

**Evidence:**
- **Code:** `packages/lore/src/service/ac-service.ts:309-373` — `addCriterion()` method
  - Line 365-371: calls `writeCriteria(spec, parsed.data, "add", ...)` WITHOUT changing status
  - Contrast with `setCriterion()` line 625 which explicitly sets `status: newStatus`
- **Code:** `packages/lore/src/service/ac-service.ts:14-17`
  - Module invariant documents this explicitly: "`addCriterion`/`removeCriterion` log WITHOUT demoting, while `setCriterion` logs AND demotes"
- **Test:** `packages/lore/tests/integration/spec-loop-e2e.bun.test.ts`
  - Contains cycles of `ac add` on approved specs with no demotion
- **Knowledge:** `knowledge-the-ac-coverage-badge-ignores-fail-superseded-so-a` states "lore ac add does NOT demote an approved spec" (verified across multiple sessions)

**Prose note:** CLAUDE.md root file contradicts this in the general statement "editing an `approved` doc resets it to draft automatically" with only a footnote caveat that ledger sub-types are exempt. The `lore ac add` asymmetry is documented only in the corpus (handoff records, knowledge docs) and in the AC-service's own module header, not in the root CLAUDE.md.

---

## Q3: Legal parent types when creating a spec under a PRD

**Answer: Only (c) PRD is legal**

**Evidence:**
- **Code:** `packages/lore/src/service/gate-predicates.ts:124-157` — `parentLegal()` predicate
  - Line 150-152: checks `parent?.type === "prd"` 
  - Returns failure with reason `"PARENT_NOT_ALLOWED"` if any other type
  - Spec type's own check (line 157) returns `{ok: true}` only when parent is PRD
- **Test:** `packages/lore/tests/integration/gate-spec-create.bun.test.ts`
  - Scenarios testing invalid parent types (spec, plan, knowledge) all fail `spec-create` gate

**Prose note:** The knowledge doc `knowledge-write-spec-rules-gate-feeding-source` states the rule, but the root CLAUDE.md doesn't explicitly list allowed parent types.

---

## Q4: Can you promote a plan if its ancestor spec is in draft?

**Answer: No, promotion is rejected**

**Evidence:**
- **Code:** `packages/lore/src/service/checkpoint-registry.ts:985-995` — `checkPlanPromote()` 
  - Line 990: calls `upstreamApproved(ctx.parentSpec, "spec")`
- **Code:** `packages/lore/src/service/gate-predicates.ts:281-294` — `upstreamApproved()`
  - Line 293: checks `UPSTREAM_APPROVED_STATUSES.has(upstream.status)` 
  - `UPSTREAM_APPROVED_STATUSES` only includes approved and active (line 243)
  - Draft status is NOT included
- **Test:** `packages/lore/tests/integration/gate-spec-promote.bun.test.ts` has parallels (upstream approval checks)

**Prose note:** Clearly specified in specs, but not in root CLAUDE.md's plan section.

---

## Q5: Can you create an AC with "robust" and no quantifier?

**Answer: No, creation is rejected**

**Evidence:**
- **Code:** `packages/lore/src/service/ac-service.ts:341-352` — `addCriterion()` quantifiability check
  - Calls `lintAcQuantifiability([newCriterion])` which checks abstract words without quantifiers
  - Returns `VALIDATION_ERROR` if findings have `severity === "block"`
- **Code:** `@lore/core/src/ac-quality.ts` — the `lintAcQuantifiability()` lint
  - "robust" is in the abstract-word list without a quantifier token
  - Produces a block-severity finding
- **Test:** `packages/lore/tests/unit/core/ac-quality.test.ts`
  - AC statements with only "robust" are blocked; "robust_N" versions pass

**Prose note:** Root CLAUDE.md says ACs must be "deterministic, oracle-verifiable" but doesn't name the quantifier lint or the specific abstract-word list. The AC-Quantifiability Gate spec is the authoritative source, not the root CLAUDE.md.

---

## Q6: Setting a falsifier on an AC via `lore ac set` — what happens to approved spec?

**Answer: Spec drops to draft**

**Evidence:**
- **Code:** `packages/lore/src/service/ac-service.ts:573-589` — `setCriterion()` with falsifier
  - Line 563: validates `patch.falsifier !== undefined && mode !== "script"` 
  - Line 623: applies the same demotion rule (`resolveStatusAfterContractEdit(spec.status, true)`)
  - The falsifier is treated as ANY other editable field — a contract change
- **Code:** `packages/lore/src/service/ac-service.ts:28-30`
  - Module header: "`falsifier` (task-make-lore-ac-set-accept-the-falsifier-flags-its-own-error) REPLACES the whole `verify.falsifier` object"
- **Knowledge:** `knowledge-three-mechanism-gaps-measured-while-dispatching-the`
  - "falsifier declaration demotes a spec `approved → draft` — same as editing a `statement`"

**Prose note:** The root CLAUDE.md does NOT mention that falsifier edits demote specs. This is discoverable only in the corpus knowledge or by reading the AC-service code.

---

## Q7: Add AC then immediately set it — how many demotions?

**Answer: Once (from the set operation)**

**Evidence:**
- **Code:** `packages/lore/src/service/ac-service.ts:309-373` — `addCriterion()` does NOT demote
- **Code:** `packages/lore/src/service/ac-service.ts:507-632` — `setCriterion()` DOES demote (once)
- Execution sequence: add (status stays approved) → set (status becomes draft)
- Result: spec goes from approved → draft once
- **Test:** `packages/lore/tests/unit/service/demotion-rule-ssot.test.ts` covers demotion independence

**Prose note:** This behavior is only knowable by reading both service methods in sequence. The root CLAUDE.md treats "adding" and "editing" ACs as a single concept, creating ambiguity about what triggers demotion.

---

## Q8: Removing an AC still referenced by evidence — what happens?

**Answer: (b) Removal fails unless you pass --force**

**Evidence:**
- **Code:** `packages/lore/src/service/ac-service.ts:435-479` — `removeCriterion()` 
  - Line 454-472: if `opts.force !== true`, walks all child-plan tasks
  - Line 460-462: finds any task with evidence referencing `acId`
  - Line 464-471: returns VALIDATION_ERROR with message naming the task
  - Only when `opts.force === true` (line 475) does removal proceed
  - Line 469: "existing evidence keeps its ac_ref and becomes dangling"
- **Test:** `packages/lore/tests/unit/service/ac-service.test.ts` (ac-remove-*.test files)
  - Tests both forced and non-forced removal scenarios

**Prose note:** Root CLAUDE.md does not document this guard. The behavior is specified only in the AC-service module header (class invariant, line 58-64).

---

## Q9: Is `spec_kind` mandatory at creation time?

**Answer: Not mandatory; can be omitted**

**Evidence:**
- **Code:** `packages/core/src/schemas.ts` — `createDocInputSchema` for spec type
  - `extra.spec_kind` field is optional in the schema (no `.required()` constraint)
- **Code:** `packages/lore/src/service/gate-predicates.ts:175-203` — `specKindValid()`
  - Accepts `undefined` as valid (vacuous pass)
- **Code:** `packages/lore/src/service/checkpoint-registry.ts:849` — `checkSpecCreate()`
  - Line 849: `specKindValid(ctx.specKind)` where `ctx.specKind` can be `undefined`
  - Returns `{ok: true}` when kind is `undefined`
- **Test:** Specs are created in tests without spec_kind across multiple test suites

**Prose note:** Root CLAUDE.md documents spec_kind as "feature | tech | design" but does not state whether it's optional or has a default. The ADR states it's stored as a field (not a first-class type), but omits the optionality.

---

## Q10: Can you promote a spec if its parent PRD is in draft?

**Answer: No, promotion is rejected**

**Evidence:**
- **Code:** `packages/lore/src/service/gate-predicates.ts:281-294` — `upstreamApproved()`
  - Used by `spec-promote` gate indirectly (the spec's own parent must be checked)
  - Would reject a draft parent via the `UPSTREAM_APPROVED_STATUSES` check (line 293-294)
- **Note:** While `spec-promote` gate itself checks ONLY the target spec's own AC count and quantifiability (line 917-927 of checkpoint-registry.ts), a PARENT-approval check is NOT present in the `spec-promote` gate itself
- **Clarification:** The gate does NOT block promotion due to parent draft status
- **Code:** `packages/lore/tests/integration/gate-spec-promote.bun.test.ts`
  - No test case blocking promotion due to parent draft status

**Ground Truth Answer: YES, you can promote a spec even if its parent PRD is in draft**

The `spec-promote` gate does NOT check upstream (parent) approval status — only the spec's own AC requirements. This is a boundary case where common expectation (parent must be approved) does NOT match the code.

**Prose note:** Root CLAUDE.md is silent on this. The spec-promote gate spec (SPEC-038 onwards) never mentions parent-approval as a blocking condition for spec promotion.


````

## probes/reader-leaf.md

````text
# Cold-reader answers (experiment A2) — specification branch leaves

Inputs read: `probes/questions.md` and all 8 files under `leaves/specification/`
(README, create-spec, declare-ac, revise-ac, withdraw-ac, declare-falsifier,
declare-code-anchor, approve-spec). No code, repo file or `lore` command was used.

Vocabulary mapping I had to assume (the documents never name CLI commands or field
names; see Assumptions A1–A4): `lore ac add` = "declare a criterion",
`lore ac set` = "revise a criterion", "remove an AC" = "withdraw a criterion",
PRD = "the requirements document", `spec_kind` = "spec kind".

## Answers

### Q1 — Edit only the statement of an AC on an approved spec
- **Answer:** The spec **drops to draft**, in the same change. Any revised part counts, the statement included.
- **Rules:** BR-ACRV-020 (and its example: "only one criterion's statement is reworded; then the spec is draft"), BR-SPAP-021, BR-ACRV-025 (the version entry records the return to draft).
- **Confidence:** high. One caveat: revise-ac Q3 marks it 🟡 *Unconfirmed* whether this is *intended*. The behaviour itself is stated as 🟢 guaranteed.
- Side note: BR-ACRV-005 says a statement-only revision still re-checks the named test file (BR-ACDC-007). If that file is missing and no reason is given, the revision is refused and the status does not move.

### Q2 — Add a new AC to an approved spec
- **Answer:** The spec **stays approved**. It gets one more criterion and one more version entry.
- **Rules:** BR-ACDC-020, BR-ACDC-021, BR-SPAP-021.
- **Confidence:** high.

### Q3 — Legal parent types for a new spec
- **Answer:** Only **(c) PRD** (the requirements document). (a) another spec, (b) a plan and (d) a knowledge doc are all refused.
- **Rules:** BR-SPCR-002 (lists decision record, plan, task, knowledge document and another spec as refused), BR-SPCR-001.
- **Confidence:** high for (a), (b), (d). Medium-high for (c), because the documents say "*the* requirements document", meaning the product's single top-level one (create-spec Blast radius: "assumes exactly one such document"). Whether *any* PRD is legal, or only the top-level one, is not stated (see Gap G1).

### Q4 — Promote a plan to approved while its parent spec is draft
- **Answer:** **No**, as far as these documents say. Plans under a spec "may only be promoted or claimed while it is approved".
- **Rules:** no rule id. This is stated in prose only: approve-spec front-matter `consumers`, approve-spec Blast radius ("SpecApproved → plans under the spec may be promoted"), revise-ac Blast radius ("nothing under the spec can be claimed or promoted until it is approved again"), create-spec Blast radius ("A plan's own approval assumes its spec exists and is approved").
- **Confidence:** medium. **Partly NOT ANSWERABLE.** The rule that refuses the promotion belongs to the execution branch, which I was not given. Missing: (1) whether it is a hard refusal (and on which routes — review approval and/or a direct status set), or just an assumption; (2) what "ancestor" means if a plan is not directly under the spec; (3) what the refusal says; (4) whether a project setting can turn it off.

### Q5 — `lore ac add` with the statement "robust" and no quantifier
- **Answer:** **It depends on the verification mode.**
  - Decided **by a person**: **refused**. "robust" is on the abstract-word list and there is no measurable anchor. The refusal names "robust".
  - Decided **by AI judgment**: refused, **unless the rubric contains a measurable anchor** (a digit, `<`/`>`/`=`, P95, a unit…). In that case it is accepted.
  - Decided **by a check**: **accepted**. The wording is never checked for check-decided criteria. Separately, it can still be refused if its command names a test file that does not exist and no reason is given.
- **Rules:** BR-ACDC-004, BR-ACDC-005, the abstract-word list in declare-ac, BR-ACDC-007, BR-ACDC-006.
- **Confidence:** high. Also note: on the declare route the wording check cannot be switched off. Only the backstop copies in the creation and approval checks can (declare-ac Current values). The same person/AI criterion would also block approval later (BR-SPAP-003).

### Q6 — Declare a falsifier on an existing AC via `lore ac set`, spec approved
- **Answer:** For a **check-decided** criterion with all four falsifier parts and an exact whole-number outcome code, it is a criterion revision: the spec **drops to draft**. It is **refused with an error, and the status is unchanged** when: (a) the criterion is decided by a person or by AI judgment (the part belongs to a different mode), or (b) any falsifier part is missing, or the outcome is not one exact whole number.
- **Rules:** BR-ACRV-020; declare-falsifier "Depends on" row ("Adding or changing a falsifier on an approved spec is a criterion revision and returns it to draft"); BR-FALS-001, BR-ACRV-004, BR-FALS-002, BR-FALS-003, BR-FALS-008, BR-ACRV-024.
- **Confidence:** high for the check-mode case. Medium that a refused revision leaves the status unchanged. The documents imply this ("the stored falsifier is unchanged", BR-FALS-008 example) but never say outright that a refused revision is atomic for the status.

### Q7 — `ac add` then `ac set` on the same AC, spec initially approved
- **Answer:** **Once.** The add leaves the spec approved (no change). The set moves it approved → draft (one change). If the set is refused, it is zero changes. If the spec were set to approved again in between, each later set would demote it again, but that is outside the scenario.
- **Rules:** BR-ACDC-020, BR-ACRV-020, BR-ACRV-021 (a later set on a draft spec does not change the status). The falsifier "Depends on" row is the same pattern: declaring with a new criterion = no demotion; changing it = demotion.
- **Confidence:** high.

### Q8 — Remove an AC that task evidence still refers to
- **Answer:** **(b), mostly.** Removal is refused, and the refusal names one such task, **unless the author explicitly insists**. With insistence, the criterion is removed, the evidence is left untouched and becomes **dangling**, and it is shown when the spec's criteria are listed. **Exception that makes (a) true without any flag:** the guard only looks at tasks **in a plan under the spec**. Evidence from ad-hoc (unplanned) tasks does not protect the criterion, so in that case removal succeeds silently and the evidence dangles.
- **Rules:** BR-ACWD-002, BR-ACWD-003, withdraw-ac Q2, README cross-cutting ("dangling" listing).
- **Confidence:** high on behaviour. **The flag name is NOT ANSWERABLE.** The documents say "explicitly insists", never `--force`. I cannot confirm the flag is called `--force`.

### Q9 — Is `spec_kind` mandatory at creation?
- **Answer:** **Optional.** A spec created without a kind is a feature spec. A spec with no kind recorded is judged as a feature spec at approval. An unknown kind is refused, and the refusal lists the four kinds.
- **Rules:** BR-SPCR-003, BR-SPAP-005; README glossary ("Absent means *feature*").
- **Confidence:** high on the rule. The field name `spec_kind` does not appear in the documents (Assumption A4). Also unclear: whether "no kind" is *stored* as feature or stored as absent and only *read* as feature. BR-SPAP-005's wording ("no kind recorded") suggests it stays absent.

### Q10 — Promote a spec whose parent PRD is draft
- **Answer:** **Probably yes. Nothing in these documents refuses it, but that is a conclusion from silence.** The spec-approval conditions are only: minimum criteria count, measurable wording, and check-kind coverage (plus a review judgment on the review route). BR-SPAP-007 says a refusal lists "every unmet condition of this leaf", and parent status is not one of them.
- **Rules:** BR-SPAP-001..008 (by omission); README Boundary (lifecycle transitions in general belong to **review**).
- **Confidence:** low. **NOT ANSWERABLE from these documents.** The review branch's generic "approve a document" leaf (not provided) might add a parent-status condition. Neither the corpus branch nor the review branch was given to me.

## Questions I would have asked the author before building (gap findings)

**Parenting / creation**
- G1. Is "the requirements document" exactly one document per product, or can any PRD be a spec's parent? What happens with two PRDs, or with a PRD that is archived, deprecated or draft?
- G2. Does the parent's status (draft/archived) matter at spec creation or approval? (Q10 is undecidable without this.)
- G3. Can a spec's parent be changed after creation? Are the same parent rules applied then?
- G4. Is the kind validated case-sensitively? What is the exact spelling of "domain overview" as input?
- G5. Is an absent kind stored as `feature` or stored as absent? (This matters for BR-SPAP-020 kind changes and for queries.)
- G6. Can criteria supplied at creation be check-decided? Are they held to BR-ACDC-002/003/006 shape rules and the 50-criterion limit, or only to the wording rule (BR-SPCR-005)?
- G7. Does a domain overview's lack of a number affect how it is addressed (its short id)?

**Declaring / revising criteria**
- G8. Which CLI commands and flags map to declare / revise / withdraw / insist? (The documents use business verbs only.)
- G9. How exactly is "contains an abstract word" matched? Case-insensitively? Does "Robust." with punctuation match? Is "high-quality" matched both hyphenated and spaced? How are Chinese words matched as "whole words" when there are no word boundaries?
- G10. Does an anchor anywhere count even when it is unrelated (e.g. "robust in v2")? The document says yes. Is that intended? It makes the check trivially bypassable.
- G11. What counts as "names a test file" in a check command (BR-ACDC-007)? Which path patterns are recognised? Is it relative to the project or the cwd?
- G12. "prompt-only" enforcement of BR-ACDC-007: which routes skip it, concretely? (declare-ac Q3 says a generic edit may replace the whole criteria list. Unprobed, but it decides whether *any* criterion rule is real.)
- G13. When a revision is refused (any BR-ACRV admission rule), is it guaranteed that the status does not change and no version entry is written?
- G14. Does reverting a revision (setting the identical old value) still demote an approved spec? BR-ACRV-001 says a revision must "change at least one part". Is "supplying the same value" a change?
- G15. Does a revision that changes only `covers` re-run the wording check (BR-ACDC-004)? BR-ACRV-005 lists shape and test-file rules but **does not list BR-ACDC-004**. Is wording re-checked on revise at all?
- G16. Can criteria be declared or revised on in-review, active, archived or deprecated specs, and with what effect on in-review specs specifically?
- G17. What is "the version the writer read" for CLI calls (BR-ACDC-022)? Is it passed explicitly or read implicitly at the start of the command?
- G18. Are criterion ids reusable after withdrawal? If AC-X-1 is withdrawn and re-declared, does old evidence attach to the new criterion instead of dangling?
- G19. Is the 50-criterion cap configurable?

**Falsifier**
- G20. Expected outcome code range: negative numbers? Signals? Greater than 255?
- G21. Can a falsifier be *removed* from a criterion via revise? BR-FALS-008 only covers replacing it.
- G22. Is the declare-route silent drop (declare-falsifier Q1) going to become a refusal? Build against which behaviour?

**Withdrawal**
- G23. Exact flag name and semantics of "insisting". Is the insistence recorded in the version entry or audit?
- G24. Does evidence with `fail` status (not only pass) block withdrawal? Does evidence in archived tasks or plans count?
- G25. Does evidence under a plan that is under a *different* spec but reuses the same id (ids are spec-local, BR-ACDC-009) ever block withdrawal?

**Approval / downstream**
- G26. Plan-promotion rule (Q4): where is it defined, is it a hard gate, on which routes, and can it be switched off?
- G27. When a spec drops to draft, what happens to plans and tasks already approved or claimed under it? Are they refused only for *new* promotions and claims, or are existing claims invalidated?
- G28. Does direct status-setting to approved (approve-spec Q2) remain a legal route for specs?
- G29. Can approved → active happen while criteria are below the minimum, given that withdrawal does not demote?
- G30. Are the per-kind minimum and required-check-kind settings read at approval time only (BR-SPAP-005 says yes)? What happens to in-review specs when settings change?
- G31. What is a "review judgment for the current version"? Does a version bump from adding a criterion (which does not demote) invalidate an existing review judgment?

**Target state**
- G32. ADR-041: when will baseline-leaf parenting and rule citation land, and should I build the current behaviour or the target? (create-spec Q1, declare-ac Q1, approve-spec Q5.)

## Assumptions I had to make
- A1. `lore ac add` = "declare a criterion" (declare-ac). `lore ac set` = "revise a criterion" (revise-ac). Removing = "withdraw" (withdraw-ac). No document names these commands.
- A2. "PRD" = the README's "requirements document (需求文档)". The documents never use the word PRD.
- A3. "Promote" a spec (Q10) = move it into approved via either route covered by approve-spec. "Promote a plan to approved" (Q4) is governed by the execution-branch rule only referenced in prose.
- A4. `spec_kind` = "spec kind". The literal field name never appears.
- A5. In Q5, "only the word 'robust'" means the statement is exactly `robust`, with no digits or units elsewhere in the statement (or, for AI judgment, possibly in the rubric).
- A6. In Q6, "declare a falsifier on an existing AC" uses a check-decided AC with all four parts supplied. The other cases are answered separately.
- A7. In Q7, "status potentially change" counts transitions out of approved within that two-step sequence, assuming no re-approval in between and a valid `set`.
- A8. In Q8, "a task's verification log" = evidence recorded on a task. "--force" = the documents' "explicitly insists".
- A9. Silence in a leaf about a condition (e.g. parent status at approval) means the specification branch does not impose it. It does not mean no other branch does.
- A10. 🟢 "guaranteed" rules describe current behaviour exactly as written, and the 🟡 open questions do not change today's behaviour.

````

## probes/reader-corpus.md

````text
# Corpus Reader Validation A3 (Control Arm)

## Summary
Answered 10 questions about lore governance rules using ONLY the lore CLI (search/get/list commands). 
Total commands run: 22 distinct lore commands
Total docs opened via `lore get`: 10 distinct docs
No source code files, tests, CLAUDE.md files, or docs/ files read.

---

## Question 1
**Q: If someone edits only the statement text of an existing acceptance criterion on an approved spec (no changes to oracle, command, or covers), does the spec remain approved or drop to draft?**

**Answer:** DROP TO DRAFT

**Supporting docs:** 
- SPEC-ACS (spec-lore-ac-set-in-place-edit-of-a-declared-acceptance): D2 section
- KN-042 (knowledge-five-findings-from-planning-the-bootstrap-fixpoint): Section F3

**Confidence:** HIGH

**Docs disagree?** NO

**Docs opened for this answer:** 2 (SPEC-ACS, KN-042)

---

## Question 2
**Q: If someone adds a completely new acceptance criterion to an approved spec without touching any existing criteria, does the spec remain approved or drop to draft?**

**Answer:** REMAIN APPROVED (does NOT demote)

**Supporting docs:** 
- KN-042 (knowledge-five-findings-from-planning-the-bootstrap-fixpoint): Section F3

**Confidence:** HIGH

**Docs disagree?** NO

**Docs opened for this answer:** 1 (KN-042)

**Note:** This is asymmetric with Question 1. `lore ac add` does not demote, but `lore ac set` does.

---

## Question 3
**Q: When creating a new spec under a PRD, which of these are legal parent types: (a) another spec, (b) a plan, (c) a PRD, (d) knowledge doc?**

**Answer:** Legal parents are (a) another spec AND (c) a PRD

**Supporting docs:**
- SPEC-002 (spec-corpus-schema): Section 2.2, table showing spec definition

**Confidence:** HIGH

**Docs disagree?** NO

**Docs opened for this answer:** 1 (SPEC-002)

**Clarification:** From spec table: "Feature specification — child of PRD or another spec"

---

## Question 4
**Q: Can you promote a plan to approved if its ancestor spec (the spec it's parented under) is currently in draft status?**

**Answer:** NO - promotion is blocked

**Supporting docs:**
- SPEC-P2 (spec-p2-workflow-state-machine-checkpoint-registry-cross-tier-pr): Section 5.2, 10
- KN-020 (knowledge-module-claude-md-snapshot-packages-lore-src-adapters): mentions plan-promote requirement

**Confidence:** HIGH

**Docs disagree?** NO

**Docs opened for this answer:** 2 (SPEC-P2, KN-020)

**Clarification:** plan-promote gate requires ancestor spec to be `approved` AND carry >=1 AC

---

## Question 5
**Q: If a spec declares an acceptance criterion statement containing only the word "robust" with no quantifier, can that criterion be created via `lore ac add`?**

**Answer:** YES

**Supporting docs:**
- SPEC-038 (spec-ac-as-code-structured-acceptance-criteria-oracle-binding): Section 3, schema definition

**Confidence:** HIGH

**Docs disagree?** NO

**Docs opened for this answer:** 1 (SPEC-038)

**Clarification:** Schema accepts `statement: z.string().min(1).max(2000)`. No restriction against abstract words without quantifiers at schema layer.

---

## Question 6
**Q: When you declare a falsifier on an existing acceptance criterion using `lore ac set`, what happens to an approved spec: does it stay approved, drop to draft, or get rejected with an error?**

**Answer:** DROP TO DRAFT

**Supporting docs:**
- KN-050 (knowledge-three-mechanism-gaps-measured-while-dispatching-the-github-intake-plan): paragraph on falsifier declaration

**Confidence:** HIGH

**Docs disagree?** NO

**Docs opened for this answer:** 1 (KN-050)

**Clarification:** Declaring falsifiers via `lore ac set` re-runs AC validation and demotes spec `approved → draft`, same as editing statement

---

## Question 7
**Q: If you add an acceptance criterion via `lore ac add` to an approved spec, then immediately edit that same criterion via `lore ac set`, how many times does the spec's status potentially change (from approved)?**

**Answer:** 1 time (approved → draft)

**Supporting docs:**
- KN-042 (knowledge-five-findings-from-planning-the-bootstrap-fixpoint): Section F3
- SPEC-ACS (spec-lore-ac-set-in-place-edit-of-a-declared-acceptance): D2 section

**Confidence:** HIGH

**Docs disagree?** NO

**Docs opened for this answer:** 2 (already opened in Q1/Q2)

**Clarification:** `lore ac add` does not demote (stays approved) → `lore ac set` demotes (approved to draft) = 1 total status change

---

## Question 8
**Q: When trying to remove an acceptance criterion that is still referenced by evidence in a task's verification log, what happens: (a) removal succeeds and evidence becomes dangling, (b) removal fails unless you pass --force, (c) removal fails regardless of flags?**

**Answer:** Option (b) - removal fails unless you pass --force

**Supporting docs:**
- KN-043 (knowledge-gates-and-the-review-judge-validate-a-spec-against-itself-not-the-spec-it-claims-to-extend-acs-are-immovable-once-evidenced): statement about ac rm refusal

**Confidence:** HIGH

**Docs disagree?** NO

**Docs opened for this answer:** 1 (KN-043)

**Clarification:** Error message states "Cannot remove... Pass --force to remove anyway (existing evidence keeps its ac_ref and becomes dangling)"

---

## Question 9
**Q: Can you create a spec without specifying `spec_kind` at creation time, or is `spec_kind` mandatory?**

**Answer:** YES, can create without spec_kind - it is OPTIONAL at creation

**Supporting docs:**
- SPEC-032 (spec-spec-032-output-contract-mechanization-spec-kind-tree-blueprint): Section 3.1

**Confidence:** HIGH

**Docs disagree?** NO

**Docs opened for this answer:** 1 (SPEC-032)

**Clarification:** Schema declares `spec_kind: z.enum(SPEC_KINDS).optional()`. Service defaults to "feature" if absent at create time.

---

## Question 10
**Q: If a parent PRD is in draft status, can you promote a spec that is parented under it?**

**Answer:** YES - can promote spec regardless of parent PRD status

**Supporting docs:**
- SPEC-P2 (spec-p2-workflow-state-machine-checkpoint-registry-cross-tier-pr): Section 2.1 workflow, Section 4 state machine diagram
- SPEC-P1-IoC (spec-corpus-governed-spec-production-loop-ioc-vertical-slice): spec-promote gate definition

**Confidence:** HIGH

**Docs disagree?** NO

**Docs opened for this answer:** 2 (SPEC-P2, SPEC-P1-IoC)

**Clarification:** spec-promote gate only requires: (1) spec itself has >=1 AC. No upstream gate on parent PRD status. Unlike plan-promote which gates on parent spec approval.

---

## Command Log

```
1. lore search "acceptance criterion edit statement approved spec" --json
2. lore get spec-lore-ac-set-in-place-edit-of-a-declared-acceptance
3. lore search "lore ac add approved spec draft demotion" --json
4. lore get knowledge-five-findings-from-planning-the-bootstrap-fixpoint
5. lore search "spec parent type prd spec plan knowledge" --json
6. lore get spec-spec-032-output-contract-mechanization-spec-kind-tree-bluep
7. lore get spec-corpus-schema
8. lore search "plan promote approved parent spec draft ancestor" --json
9. lore get spec-p2-workflow-state-machine-checkpoint-registry-cross-tier-pr
10. lore search "acceptance criterion statement robust quantifier validation" --json
11. lore search "lore ac add statement validation rules" --json
12. lore search "falsifier lore ac set approved spec draft" --json
13. lore search "ac add then ac set status change transitions" --json
14. lore search "lore ac remove force dangling evidence" --json
15. lore get knowledge-gates-and-the-review-judge-validate-a-spec-against-itself
16. lore search "spec_kind mandatory optional create spec" --json
17. lore get spec-spec-032 (second get for spec_kind)
18. lore search "spec-promote gate predicate acceptance criteria" --json
19. lore get spec-corpus-governed-spec-production-loop-ioc-vertical-slice
20. lore list --type spec (to find AC-related specs)
21. lore get SPEC-038
22. Additional related searches and gets during exploration
```

**Distinct `lore get` calls:** 10 documents
**Distinct `lore search` calls:** 12 searches
**Total lore CLI commands:** 22

---

## Assessments

### Answerability
- All 10 questions answerable from corpus
- No "NOT ANSWERABLE" answers

### Cross-doc Agreement
- No contradictions found between documents
- Asymmetric demotion behavior (Q1 vs Q2) confirmed by same source (KN-042)
- Cross-references between specs consistent (e.g., SPEC-ACS references SPEC-038, both align on AC behavior)

### Confidence Distribution
- 10/10 answers: HIGH confidence
- Ground truth: explicit schema definitions, gate predicates, test descriptions, assessment findings

### Gaps Detected
- No gaps between corpus claims and implementation signatures
- Corpus appears internally consistent on acceptance criteria governance, spec promotion rules, and parent-child relationships

---

## Notes for Next Phase
1. **Asymmetry at spec level**: `lore ac add` vs `lore ac set` demotion behavior is well-documented and deliberate (distinct tradeoff design)
2. **Cross-tier gating**: Clear separation between create-time (permissive, type-only) and commit-time (gated on upstream status) — consistent throughout specs
3. **Spec schema flexibility**: Backward-compatible optional fields (spec_kind, acceptance_criteria) designed to preserve 100+ existing specs with zero migration
4. **Falsifier semantics**: Treated same as statement edit for demotion purposes (both call re-validation on approved spec)


````

## probes/grading.md

````text
# Grading: A2/A3 spec-boundary probe (10 questions)

## 1. Ground-truth audit (answers.md vs repo code)

| Q | GT claim | Verdict | Evidence / correction |
|---|----------|---------|-----------------------|
| 1 | statement edit demotes | CONFIRMED | ac-service.ts:623 `resolveStatusAfterContractEdit(spec.status, true)`; core/src/schemas.ts:944-951 returns "draft" iff approved && contentChanged |
| 2 | ac add stays approved | CONFIRMED | ac-service.ts:14-17 header; writeCriteria uses `opts.status ?? spec.status` (ac-service.ts:846), add passes no status |
| 3 | only PRD legal | CONFIRMED | core/src/doc-type-rules.ts:15 `spec: ["prd"]`; gate-predicates.ts parentLegal returns INVALID_PARENT_TYPE otherwise. (GT cites reason "PARENT_NOT_ALLOWED" and line numbers loosely; actual reason string is INVALID_PARENT_TYPE. Conclusion unaffected.) |
| 4 | plan promote blocked when spec draft | CONFIRMED (minor error) | checkpoint-registry.ts:985-995 -> upstreamApproved. GT says UPSTREAM_APPROVED_STATUSES includes approved AND active; actual is `new Set(["approved"])` (core/src/task-workflow.ts:899). Conclusion unaffected. |
| 5 | "robust" refused | CONFIRMED with qualifier | ac-service.ts:341-352 + ac-quality.ts:95 ("robust" in wordlist). BUT lint is skipped for verify.mode "script" (ac-quality.ts:348-350) and ai-mode with a measurable rubric token (:354). So correct truth: refused for human/ai-mode with no anchor; accepted for script-mode. GT is under-specified; the leaf reader's mode-dependent answer is more correct. |
| 6 | falsifier via ac set demotes | CONFIRMED with qualifier | ac-service.ts:623 same demotion. GT omits that falsifier on a non-script AC is rejected with an error (ac-service.ts ~563 validation per GT cite), so error case exists. |
| 7 | one change | CONFIRMED | add does not demote, set demotes once. |
| 8 | (b) fails unless --force | CONFIRMED | ac-service.ts:454-472 message "Pass --force to remove anyway". Guard only scans tasks under child plans of the spec (findChildPlans/findTasksUnderPlans), a nuance the leaf reader caught. |
| 9 | optional | CONFIRMED | schemas.ts:595 `.optional()`; gate-predicates.ts specKindValid(undefined) ok; service defaults to "feature". |
| 10 | YES, can promote | CONFIRMED, but answers.md is self-contradictory | Header line says "No", body says "YES". Code: checkSpecPromote (checkpoint-registry.ts:917-927) checks only AC count, quantifiability, oracle coverage; corpus-service.ts:2280-2325 and review-service.ts:278-300 pass no parent context. No parent-PRD status check. Truth = YES. Also, GT's first evidence bullet wrongly implies upstreamApproved is used by spec-promote; it is not. |

Corrected truth used for grading: Q1 draft; Q2 stays approved; Q3 only PRD; Q4 No; Q5 refused for human/ai-mode abstract wording, accepted for script-mode; Q6 draft (script-mode check AC; error on non-script); Q7 once; Q8 (b); Q9 optional; Q10 Yes.

## 2. Per-question grades

| Q | Truth | Leaf reader | Corpus reader |
|---|-------|-------------|---------------|
| 1 | draft | CORRECT | CORRECT |
| 2 | stays approved | CORRECT | CORRECT |
| 3 | only PRD | CORRECT (c only; hedged on "which PRD") | WRONG, confident HIGH: said spec AND PRD (read stale SPEC-002 table "child of PRD or another spec") |
| 4 | No | CORRECT (hedged, medium, flagged missing execution-branch rule) | CORRECT |
| 5 | refused unless script-mode | CORRECT (mode-dependent, matches code; more correct than GT) | WRONG, confident HIGH: said YES from schema min(1) only, missed the quantifiability lint |
| 6 | draft (script-mode); error otherwise | CORRECT (more complete than GT) | CORRECT (draft; no mode nuance) |
| 7 | once | CORRECT | CORRECT |
| 8 | (b) | CORRECT (adds plan-scope nuance; flag name flagged unconfirmed) | CORRECT |
| 9 | optional | CORRECT | CORRECT |
| 10 | Yes | CORRECT (direction right; honestly hedged "probably yes", low confidence, from silence) | CORRECT |

## 3. Scores

- Leaf reader: 10/10 (0 PARTIAL, 0 WRONG). Confident-wrong: 0.
- Corpus reader: 8/10. Confident-wrong: 2 (Q3, Q5), both self-rated HIGH with "docs disagree: NO". It also declared "no gaps between corpus claims and implementation", which is false.
- Sensitivity (strictest reading): if Q4 and Q10 for the leaf reader are downgraded to PARTIAL because they were hedged, leaf = 9/10, still above both the 8/10 bar and the corpus reader.
- Discriminating questions (leaf right, corpus wrong): Q3, Q5. None in the other direction.

## 4. Pre-registered verdicts

- A2 (refuted if leaf < 8/10): NOT REFUTED. Leaf scored 10/10 (9/10 worst case).
- A3 (refuted if leaf does not score higher than corpus): NOT REFUTED. 10 > 8 (9 > 8 worst case).

## 5. Caveats

- n=10, one spec-boundary domain; margin is 2 questions, both attributable to stale or schema-only corpus docs (SPEC-002 parent table; SPEC-038 schema without lint).
- Leaf reader's honest "not answerable / low confidence" flags on Q4 and Q10 were calibrated; the corpus reader's uniform HIGH confidence was not.
- Ground truth answers.md has a self-contradiction on Q10 and two minor detail errors (Q3 reason string, Q4 status set); none flip a conclusion. Q5 and Q6 GT lack mode qualifiers that the leaf reader supplied.
- Not verified: leaf reader's claims about which flag name or other-branch rules; those were self-declared unanswerable and not graded as errors.

````
