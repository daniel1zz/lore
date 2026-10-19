// @reads assets/**
/**
 * Direct-behavior suite for the SPEC-046 P1 real `SetupService` port
 * implementations (`RealAssetSource`, `RealSetupFsReader`/`RealSetupFsWriter`,
 * `RealMcpRegistrar`). `setup-service.test.ts` (a sibling suite) exercises
 * `SetupService` exclusively against FAKE ports — this suite is the only
 * automated oracle these three concrete implementations get.
 *
 * ALL fixtures are `mkdtemp` scratch directories or a synthetic recording
 * `claude` shim script — NEVER the real `~/.claude` (mirrors this repo's
 * "never write to the repo's own corpus/real machine state from a test"
 * convention). The one exception is READ-ONLY: one HAPPY case points
 * `RealAssetSource` at this repo's own checked-in `assets/` tree to prove it
 * enumerates the real, shipped file set correctly (never writes to it).
 *
 * Coverage (spread across the three ports, per the task's six-dimension AC):
 *   HAPPY:      RealAssetSource enumerates the real repo assets/ tree
 *               correctly (kinds/counts/executable flags) AND a synthetic
 *               mkdtemp tree (path mapping); RealSetupFsWriter.write is
 *               atomic; RealMcpRegistrar.add/remove produce the correct argv
 *               against a recording shim
 *   NEGATIVE:   RealMcpRegistrar with `claude` unreachable (PATH="") returns
 *               err naming the exact manual command — never throws
 *   BOUNDARY:   RealAssetSource tolerates an EMPTY declared subdirectory
 *               (zero files, no error)
 *   ERROR:      RealAssetSource surfaces an unreadable/missing subdirectory
 *               as err(STORE_ERROR) — never a thrown exception
 *   STATE:      RealSetupFsWriter.backup creates the backup directory
 *               (mkdir -p) BEFORE writing the backup file into it
 *   REGRESSION: RealSetupFsWriter.write leaves no leftover `.tmp-*` sibling
 *               file after a successful write
 *
 * @spec_ref AC-046-E (task-skill-implement-real-setup-ports-asset-source-fs-mcp-regist)
 */

import { describe, it, expect, afterEach } from "vitest";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildMcpAddArgs, buildMcpRemoveArgs } from "@lore/core";
import type { LoreError } from "@lore/core";

import { RealAssetSource } from "../../../src/adapters/real-asset-source.js";
import { RealSetupFsReader, RealSetupFsWriter } from "../../../src/adapters/real-setup-fs.js";
import { RealMcpRegistrar } from "../../../src/adapters/real-mcp-registrar.js";

// ─── Shared fixtures ────────────────────────────────────────────────────────

const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "..");
const REPO_ASSETS_ROOT = join(REPO_ROOT, "assets");

/** Mirrors `assets-ssot.test.ts`'s declared manifest, restricted to this port's scope (NOT assets/project/). */
const DECLARED_FILES_IN_SCOPE = [
  "skills/lore/SKILL.md",
  "skills/lore-kickoff/SKILL.md",
  "skills/lore-session-capture/SKILL.md",
  "skills/lore-session-capture/references/knowledge-types.md",
  // skills/lore-session-review (session PROCESS-quality review, 2026-07-20)
  "skills/lore-session-review/SKILL.md",
  "skills/lore-session-review/references/invariants.md",
  "skills/lore-doctor/SKILL.md",
  "skills/lore-autopilot/SKILL.md",
  // skills/lore-ai-native-coding (vendored upstream workflow skill, 2026-07-17)
  "skills/lore-ai-native-coding/SKILL.md",
  "skills/lore-ai-native-coding/references/ai-anti-patterns.md",
  "skills/lore-ai-native-coding/references/backend-layering.md",
  "skills/lore-ai-native-coding/references/coding-fundamentals.md",
  "skills/lore-ai-native-coding/references/design-principles.md",
  "skills/lore-ai-native-coding/references/error-handling-strategy.md",
  "skills/lore-ai-native-coding/references/jsdoc-as-context.md",
  "skills/lore-ai-native-coding/references/naming-as-index.md",
  "skills/lore-ai-native-coding/references/observability-as-code.md",
  "skills/lore-ai-native-coding/references/resumability.md",
  "skills/lore-ai-native-coding/references/security-essentials.md",
  "skills/lore-ai-native-coding/references/state-as-data.md",
  "skills/lore-ai-native-coding/references/typed-errors.md",
  "skills/lore-ai-native-coding/references/typescript-conventions.md",
  // skills/lore-baseline (baseline authoring skill + node templates, Baseline slice 3a BL-8; installed by `setup --project`)
  "skills/lore-baseline/SKILL.md",
  "skills/lore-baseline/templates/branch.md",
  "skills/lore-baseline/templates/leaf.md",
  "skills/lore-ai-native-coding/references/zod-as-ssot.md",
  // skills/lore-design (vendored upstream workflow skill, 2026-07-17)
  "skills/lore-design/SKILL.md",
  "skills/lore-design/references/api-design.md",
  "skills/lore-design/references/architecture-patterns.md",
  "skills/lore-design/references/cross-cutting/authorization.md",
  "skills/lore-design/references/cross-cutting/error-handling.md",
  "skills/lore-design/references/cross-cutting/idempotency.md",
  "skills/lore-design/references/cross-cutting/session-identity.md",
  "skills/lore-design/references/database-design.md",
  "skills/lore-design/references/mode-api.md",
  "skills/lore-design/references/mode-architecture.md",
  "skills/lore-design/references/mode-database.md",
  "skills/lore-design/references/mode-module.md",
  "skills/lore-design/references/mode-system.md",
  "skills/lore-design/references/system-design.md",
  "skills/lore-design/templates/design-preview.html",
  // skills/lore-plan (vendored upstream workflow skill, 2026-07-17)
  "skills/lore-plan/SKILL.md",
  "skills/lore-plan/references/ac-quality.md",
  "skills/lore-plan/references/mode-create.md",
  "skills/lore-plan/references/mode-list.md",
  "skills/lore-plan/references/mode-replan.md",
  "skills/lore-plan/references/mode-resume.md",
  "skills/lore-plan/references/mode-status.md",
  "skills/lore-plan/references/mode-update.md",
  "skills/lore-plan/references/phase-decomposition.md",
  "skills/lore-plan/references/plan-file-format.md",
  "skills/lore-plan/references/workflow-examples.md",
  // skills/lore-product (vendored upstream workflow skill, 2026-07-17)
  "skills/lore-product/SKILL.md",
  "skills/lore-product/references/cross-cutting-concerns.md",
  "skills/lore-product/references/example-ost.md",
  "skills/lore-product/references/example-validation-ledger.md",
  "skills/lore-product/references/ideation-methods.md",
  "skills/lore-product/references/impact-mapping.md",
  "skills/lore-product/references/interview-protocol.md",
  "skills/lore-product/references/jtbd-framework.md",
  "skills/lore-product/references/mode-decompose.md",
  "skills/lore-product/references/mode-discovery.md",
  "skills/lore-product/references/mode-ideation.md",
  "skills/lore-product/references/mode-opportunity.md",
  "skills/lore-product/references/mode-prd.md",
  "skills/lore-product/references/mode-roadmap.md",
  "skills/lore-product/references/mode-tech-assessment.md",
  "skills/lore-product/references/mode-ux-research.md",
  "skills/lore-product/references/mode-validate.md",
  "skills/lore-product/references/prd-guide.md",
  "skills/lore-product/references/product-design.md",
  "skills/lore-product/references/product-wisdom.md",
  "skills/lore-product/references/roadmap-planning.md",
  "skills/lore-product/references/strategic-thinking.md",
  "skills/lore-product/references/tech-planning.md",
  // skills/lore-review (vendored upstream workflow skill, 2026-07-17)
  "skills/lore-review/SKILL.md",
  "skills/lore-review/references/a11y-checklist.md",
  "skills/lore-review/references/code-review-checklist.md",
  "skills/lore-review/references/d-biz-checklist.md",
  "skills/lore-review/references/ears-verification.md",
  "skills/lore-review/references/mode-accessibility.md",
  "skills/lore-review/references/mode-architecture.md",
  "skills/lore-review/references/mode-code.md",
  "skills/lore-review/references/mode-ddd.md",
  "skills/lore-review/references/mode-security.md",
  "skills/lore-review/references/mode-ui.md",
  "skills/lore-review/references/oop-architecture-checklist.md",
  "skills/lore-review/references/security-commit-gate.md",
  "skills/lore-review/references/security-patterns.md",
  // skills/lore-auto-wire (vendored, converged from zz-auto-wire, 2026-07-17)
  "skills/lore-auto-wire/SKILL.md",
  "skills/lore-auto-wire/references/mode-add.md",
  "skills/lore-auto-wire/references/mode-discover.md",
  "skills/lore-auto-wire/references/mode-init-project.md",
  "skills/lore-auto-wire/references/mode-init-tools.md",
  "skills/lore-auto-wire/references/mode-rotate.md",
  "skills/lore-auto-wire/references/mode-status.md",
  "skills/lore-auto-wire/references/tools/railway.md",
  "skills/lore-auto-wire/references/tools/selfhosted-pg.md",
  "skills/lore-auto-wire/scripts/check-tools.sh",
  "skills/lore-auto-wire/scripts/fix-path.sh",
  // skills/lore-init-context RETIRED (spec-context-verb-family-two-zone-claude-md-anatomy-lore D10):
  // no longer installed — see RETIRED_FROM_INSTALL_PATHS, real-asset-source.ts.
  // skills/lore-uat (vendored, converged from zz-uat, 2026-07-17)
  "skills/lore-uat/SKILL.md",
  "skills/lore-uat/references/drivers.md",
  "skills/lore-uat/references/execution-protocol.md",
  "skills/lore-uat/references/journey-derivation.md",
  "skills/lore-uat/references/judging-rubric.md",
  "skills/lore-uat/references/playwright-compilation.md",
  "skills/lore-uat/references/probe-and-compile-example.md",
  "skills/lore-uat/references/uiux-production-bar.md",
  "skills/lore-uat/templates/acceptance-report.md",
  "skills/lore-uat/templates/journey.yaml",
  // skills/lore-analyze (vendored upstream workflow skill, 2026-07-17)
  "skills/lore-analyze/SKILL.md",
  // skills/lore-best-practice (vendored upstream workflow skill, 2026-07-17)
  "skills/lore-best-practice/SKILL.md",
  // skills/lore-biz-review (vendored upstream workflow skill, 2026-07-17)
  "skills/lore-biz-review/SKILL.md",
  // skills/lore-bug-hunt (vendored upstream workflow skill, 2026-07-17)
  "skills/lore-bug-hunt/SKILL.md",
  "skills/lore-bug-hunt/references/agent-prompts.md",
  // skills/lore-context-optimizer (vendored upstream workflow skill, 2026-07-17)
  "skills/lore-context-optimizer/SKILL.md",
  "skills/lore-context-optimizer/references/analysis-checklist.md",
  "skills/lore-context-optimizer/references/optimization-principles.md",
  // skills/lore-deploy (vendored upstream workflow skill, 2026-07-17)
  "skills/lore-deploy/SKILL.md",
  "skills/lore-deploy/references/docker-patterns.md",
  "skills/lore-deploy/references/github-actions.md",
  "skills/lore-deploy/references/k8s-patterns.md",
  "skills/lore-deploy/references/methodology-rollback.md",
  "skills/lore-deploy/references/methodology-strategy-selection.md",
  "skills/lore-deploy/references/methodology-verification.md",
  "skills/lore-deploy/references/mode-ci.md",
  "skills/lore-deploy/references/mode-container.md",
  "skills/lore-deploy/references/mode-infra.md",
  "skills/lore-deploy/references/mode-migration.md",
  "skills/lore-deploy/references/mode-observability.md",
  "skills/lore-deploy/references/mode-release.md",
  // skills/lore-design-ui (vendored upstream workflow skill, 2026-07-17)
  "skills/lore-design-ui/SKILL.md",
  "skills/lore-design-ui/decisions/2026-02-01-business-scenario-style-guide.md",
  "skills/lore-design-ui/references/design-system-inheritance.md",
  "skills/lore-design-ui/references/mode-ui.md",
  "skills/lore-design-ui/references/prototype-fidelity.md",
  "skills/lore-design-ui/references/ui-design.md",
  "skills/lore-design-ui/references/ui-style-guide.md",
  "skills/lore-design-ui/templates/decisions-template.md",
  "skills/lore-design-ui/templates/ui-standards-template.md",
  // skills/lore-diagnose (vendored upstream workflow skill, 2026-07-17)
  "skills/lore-diagnose/SKILL.md",
  "skills/lore-diagnose/scripts/hitl-loop.template.sh",
  // skills/lore-dogfood (vendored upstream workflow skill, 2026-07-17)
  "skills/lore-dogfood/SKILL.md",
  "skills/lore-dogfood/references/issue-taxonomy.md",
  "skills/lore-dogfood/templates/dogfood-report-template.md",
  // skills/lore-domain (vendored upstream workflow skill, 2026-07-17)
  "skills/lore-domain/SKILL.md",
  "skills/lore-domain/references/aggregate-design.md",
  "skills/lore-domain/references/analysis-checklist.md",
  "skills/lore-domain/references/context-mapping.md",
  "skills/lore-domain/references/domain-docs-template.md",
  "skills/lore-domain/references/event-storming.md",
  "skills/lore-domain/references/mode-activate.md",
  "skills/lore-domain/references/mode-analyze.md",
  "skills/lore-domain/references/mode-create.md",
  "skills/lore-domain/references/mode-quick-lens.md",
  "skills/lore-domain/references/mode-quick-scenario.md",
  "skills/lore-domain/references/mode-update.md",
  // skills/lore-git-workflow (vendored upstream workflow skill, 2026-07-17)
  "skills/lore-git-workflow/SKILL.md",
  "skills/lore-git-workflow/references/git-conventions.md",
  "skills/lore-git-workflow/references/mode-branch.md",
  "skills/lore-git-workflow/references/mode-commit.md",
  "skills/lore-git-workflow/references/mode-conflict.md",
  "skills/lore-git-workflow/references/mode-pr.md",
  // skills/lore-harness-dev (vendored upstream workflow skill, 2026-07-17)
  "skills/lore-harness-dev/SKILL.md",
  "skills/lore-harness-dev/references/advanced-patterns.md",
  "skills/lore-harness-dev/references/eval-patterns.md",
  "skills/lore-harness-dev/references/templates.md",
  "skills/lore-harness-dev/references/tool-metadata.md",
  // skills/lore-improve-codebase-architecture (vendored upstream workflow skill, 2026-07-17)
  "skills/lore-improve-codebase-architecture/SKILL.md",
  "skills/lore-improve-codebase-architecture/DEEPENING.md",
  "skills/lore-improve-codebase-architecture/INTERFACE-DESIGN.md",
  "skills/lore-improve-codebase-architecture/LANGUAGE.md",
  // skills/lore-iterative-review (vendored upstream workflow skill, 2026-07-17)
  "skills/lore-iterative-review/SKILL.md",
  "skills/lore-iterative-review/references/fix-agent-prompt.md",
  "skills/lore-iterative-review/references/reviewer-prompts.md",
  // skills/lore-npm-publish (vendored upstream workflow skill, 2026-07-17)
  "skills/lore-npm-publish/SKILL.md",
  "skills/lore-npm-publish/references/first-publish.md",
  "skills/lore-npm-publish/references/prerelease.md",
  "skills/lore-npm-publish/references/workflow.md",
  // skills/lore-operate (vendored upstream workflow skill, 2026-07-17)
  "skills/lore-operate/SKILL.md",
  "skills/lore-operate/references/chaos-engineering.md",
  "skills/lore-operate/references/incident-response.md",
  "skills/lore-operate/references/logging-best-practices.md",
  "skills/lore-operate/references/mode-chaos.md",
  "skills/lore-operate/references/mode-incident.md",
  "skills/lore-operate/references/mode-maintenance.md",
  "skills/lore-operate/references/mode-monitor.md",
  "skills/lore-operate/references/mode-scaling.md",
  "skills/lore-operate/references/prometheus-patterns.md",
  "skills/lore-operate/references/runbook-template.md",
  "skills/lore-operate/references/sre-methodology.md",
  // skills/lore-product-benchmark (authored 2026-07-28 — evidence-backed Feature Matrix, upstream of the lore-product chain)
  "skills/lore-product-benchmark/SKILL.md",
  "skills/lore-product-benchmark/references/example-feature-matrix.md",
  // skills/lore-product-to-prd (ex-lore-to-prd, renamed 2026-07-28 into the lore-product-* family)
  "skills/lore-product-to-prd/SKILL.md",
  // skills/lore-product-lens (vendored upstream workflow skill, 2026-07-17)
  "skills/lore-product-lens/SKILL.md",
  "skills/lore-product-lens/references/business-lens.md",
  "skills/lore-product-lens/references/competitive-lens.md",
  "skills/lore-product-lens/references/feature-lens.md",
  "skills/lore-product-lens/references/positioning-lens.md",
  "skills/lore-product-lens/references/scenario-lens.md",
  "skills/lore-product-lens/references/user-group-lens.md",
  // skills/lore-project-bootstrap (vendored upstream workflow skill, 2026-07-17)
  "skills/lore-project-bootstrap/SKILL.md",
  "skills/lore-project-bootstrap/references/domains/ecommerce.md",
  "skills/lore-project-bootstrap/references/domains/fintech.md",
  "skills/lore-project-bootstrap/references/domains/saas.md",
  "skills/lore-project-bootstrap/references/frameworks/fastapi.md",
  "skills/lore-project-bootstrap/references/frameworks/nestjs.md",
  "skills/lore-project-bootstrap/references/frameworks/nextjs.md",
  "skills/lore-project-bootstrap/references/frameworks/nuxt.md",
  "skills/lore-project-bootstrap/references/frameworks/uniapp.md",
  "skills/lore-project-bootstrap/references/languages/python.md",
  "skills/lore-project-bootstrap/references/languages/typescript.md",
  "skills/lore-project-bootstrap/references/permission-map.md",
  "skills/lore-project-bootstrap/references/skill-map.md",
  "skills/lore-project-bootstrap/references/testing/pytest.md",
  "skills/lore-project-bootstrap/references/testing/vitest.md",
  // skills/lore-prototype (vendored upstream workflow skill, 2026-07-17)
  "skills/lore-prototype/LOGIC.md",
  "skills/lore-prototype/SKILL.md",
  "skills/lore-prototype/UI.md",
  // skills/lore-refactor (vendored upstream workflow skill, 2026-07-17)
  "skills/lore-refactor/SKILL.md",
  "skills/lore-refactor/references/debt-management.md",
  "skills/lore-refactor/references/migration-patterns.md",
  "skills/lore-refactor/references/mode-architecture.md",
  "skills/lore-refactor/references/mode-code.md",
  "skills/lore-refactor/references/mode-debt.md",
  "skills/lore-refactor/references/mode-migration.md",
  "skills/lore-refactor/references/quality-gates.md",
  "skills/lore-refactor/references/refactoring-catalog.md",
  "skills/lore-refactor/references/skill-handoff.md",
  "skills/lore-refactor/references/smell-detection.md",
  // skills/lore-research (vendored upstream workflow skill, 2026-07-17)
  "skills/lore-research/SKILL.md",
  "skills/lore-research/references/mode-benchmark.md",
  "skills/lore-research/references/mode-exploration.md",
  "skills/lore-research/references/mode-pattern.md",
  "skills/lore-research/references/mode-sdk.md",
  "skills/lore-research/references/opencli-query.md",
  "skills/lore-research/references/protocol.md",
  "skills/lore-research/references/research-sources.md",
  // skills/lore-tdd (vendored upstream workflow skill, 2026-07-17)
  "skills/lore-tdd/SKILL.md",
  "skills/lore-tdd/deep-modules.md",
  "skills/lore-tdd/interface-design.md",
  "skills/lore-tdd/mocking.md",
  "skills/lore-tdd/refactoring.md",
  "skills/lore-tdd/tests.md",
  // skills/lore-test (vendored upstream workflow skill, 2026-07-17)
  "skills/lore-test/SKILL.md",
  "skills/lore-test/references/ai-native-testing.md",
  "skills/lore-test/references/ci-cd-pipeline.md",
  "skills/lore-test/references/false-green-patterns.md",
  "skills/lore-test/references/mode-accessibility.md",
  "skills/lore-test/references/mode-android.md",
  "skills/lore-test/references/mode-e2e.md",
  "skills/lore-test/references/mode-eval.md",
  "skills/lore-test/references/mode-exploratory.md",
  "skills/lore-test/references/mode-frontend.md",
  "skills/lore-test/references/mode-performance.md",
  "skills/lore-test/references/mode-property-based.md",
  "skills/lore-test/references/mode-security.md",
  "skills/lore-test/references/mode-strategy.md",
  "skills/lore-test/references/six-dim-coverage.md",
  "skills/lore-test/references/test-design-techniques.md",
  "skills/lore-test/references/test-maintainability.md",
  // skills/lore-to-issues (vendored upstream workflow skill, 2026-07-17)
  "skills/lore-to-issues/SKILL.md",
  // skills/lore-triage (vendored upstream workflow skill, 2026-07-17)
  "skills/lore-triage/SKILL.md",
  "skills/lore-triage/AGENT-BRIEF.md",
  "skills/lore-triage/OUT-OF-SCOPE.md",
  // skills/lore-write-a-skill (vendored upstream workflow skill, 2026-07-17)
  "skills/lore-write-a-skill/SKILL.md",
  // skills/shared (cross-skill reference library — verification-family convergence, 2026-07-17)
  "skills/shared/batched-governance.md",
  "skills/shared/docs-lookup-guide.md",
  "skills/shared/ears-spec-generation.md",
  "skills/shared/lore-cli-map.md",
  "skills/shared/ops-runbook-generation.md",
  "skills/shared/project-context-loading.md",
  "skills/shared/scripts/preview.py",
  "skills/shared/tech-stack-detection.md",
  "skills/shared/testing-standards-detection.md",
  "skills/shared/troubleshooting-knowledge.md",
  "skills/shared/verification-discipline.md",
  "agents/lore-implementer.md",
  "agents/lore-reader.md",
  "hooks/session-start-resume.mjs",
  // session-start-marker (same-session-authorship fact for the resume-ticket
  // coverage floor, task-verifying-a-handoff-you-just-authored-arms-the-coverage, 2026-08-01)
  "hooks/session-start-marker.mjs",
  "hooks/stop-turn-review.mjs",
  // stop-turn-review turn-state producers (issue #156)
  "hooks/user-prompt-turn-start.mjs",
  "hooks/post-edit-mark.mjs",
  // stop-handoff-coverage (Stop-time resume-ticket coverage floor, spec-resume-ticket-coverage-a-shipped-upper-bound-left-the, 2026-07-31)
  "hooks/stop-handoff-coverage.mjs",
  "hooks/subagent-context.mjs",
  "hooks/pre-no-general-agent-gate.mjs",
  // pre-dispatch-isolation-gate (denies an implementation subagent dispatched
  // without isolation:"worktree"; orchestration-policy, so deliberately NOT in
  // HOOK_REGISTRATIONS — spec-dispatch-isolation-must-be-enforced-by-a-gate-and D5, 2026-07-31)
  "hooks/pre-dispatch-isolation-gate.mjs",
  "hooks/pre-bash-git-safety-gate.mjs",
  // subagent-stop-commit-guard (SubagentStop data-loss backstop, SPEC-046 amendment, 2026-07-21)
  "hooks/subagent-stop-commit-guard.mjs",
  // run-register + pre-tool-harness-run (run identity slice 1, BR-1044)
  "hooks/run-register.mjs",
  // run-end + shared run-id helper (SessionEnd/SubagentStop run end, BR-1059)
  "hooks/run-end.mjs",
  "hooks/lib/run-id.mjs",
  "hooks/pre-tool-harness-run.mjs",
  // pre-helper-foreign-working-copy-gate (isolated helper writing into a foreign git working copy, BR-1092; in HOOK_REGISTRATIONS on PreToolUse Write|Edit|MultiEdit|NotebookEdit)
  "hooks/pre-helper-foreign-working-copy-gate.mjs",
  // post-edit-bindings (edit-time notice of prose bound to the edited file; in HOOK_REGISTRATIONS on PostToolUse Edit|Write|MultiEdit|NotebookEdit)
  "hooks/post-edit-bindings.mjs",
  // shared cwd-aware shell parser, generated from packages/core/src/shell-cwd.ts (DCL-4)
  "hooks/lib/shell-cwd.mjs",
  "hooks/lib/turn-state.mjs",
  // session trail (spec-session-trail D13): start/end writers and their shared library
  "hooks/session-trail-start.mjs",
  "hooks/subagent-trail.mjs",
  "hooks/lib/session-trail.mjs",
  // governance/corpus-workflow.md AND governance/seat-briefing.md are
  // DELIBERATELY ABSENT here (SPEC-083 D3, extended by SPEC-085 D3): both
  // still exist under assets/governance/ (assets-ssot.test.ts's
  // DECLARED_FILES still lists them) but RealAssetSource.load() no longer
  // yields EITHER into the AssetPayload — the runtime `lore governance`
  // verb (and its `--seat-briefing` flag, SPEC-085 D1) reads them straight
  // from the binary's own assets root instead. The `governance/` install
  // directory is now empty.
  // settings.json — SYNTHETIC settings-hook entry (no real file on disk under
  // assets/), appended by RealAssetSource.load() from
  // buildHookSettingsEntries("{{lore:claude_dir}}") (settings.json auto-registration
  // amendment, 2026-07-20). Not tracked by assets-ssot.test.ts's DECLARED_FILES
  // (a real-file manifest) — this suite is the sole place this synthetic entry
  // is asserted against RealAssetSource's own output.
  "settings.json",
].sort();

const DECLARED_EXECUTABLE_PATHS = new Set([
  "hooks/session-start-resume.mjs",
  "hooks/subagent-context.mjs",
  "hooks/pre-no-general-agent-gate.mjs",
  "skills/lore-auto-wire/scripts/check-tools.sh",
  "skills/lore-auto-wire/scripts/fix-path.sh",
  "skills/lore-diagnose/scripts/hitl-loop.template.sh",
  "skills/shared/scripts/preview.py",
]);

const KIND_BY_TOP_DIR: Record<string, string> = {
  skills: "skill",
  agents: "agent",
  hooks: "hook",
  governance: "governance",
};

function sha256Hex(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * Awaits `fn()` and captures whether it rejected, WITHOUT ever re-throwing —
 * the only correct way to assert "this async method never throws" in a test.
 * `expect(asyncFn).not.toThrow()` is NOT sufficient for this: it only invokes
 * the function and checks for a SYNCHRONOUS throw, never awaiting the promise
 * the function returns, so a later rejection is silently missed.
 */
async function awaitNeverThrows<T>(fn: () => Promise<T>): Promise<{ value: T | undefined; thrown: unknown }> {
  try {
    return { value: await fn(), thrown: undefined };
  } catch (thrown) {
    return { value: undefined, thrown };
  }
}

/**
 * Narrows a `LoreError` union value to the member matching `code`, so the
 * caller can then access that member's own fields (e.g. `message`) without a
 * TS2339 error — `LoreError` is a discriminated union and several members
 * (e.g. `DOC_NOT_FOUND`) do not carry `message`, so `expect(error.code).toBe(...)`
 * alone does not narrow the STATIC type the way an `if` guard does. Fails the
 * test loudly (throws) if the code doesn't match, rather than silently
 * returning a mistyped value.
 */
function narrowErrorCode<C extends LoreError["code"]>(error: LoreError, code: C): Extract<LoreError, { code: C }> {
  if (error.code !== code) {
    throw new Error(`expected LoreError.code "${code}", got "${error.code}": ${JSON.stringify(error)}`);
  }
  return error as Extract<LoreError, { code: C }>;
}

/** Tracks every mkdtemp directory created by a test so `afterEach` can clean them all up unconditionally. */
const scratchDirs: string[] = [];

function makeScratchDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratchDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (scratchDirs.length > 0) {
    const dir = scratchDirs.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

// ─── RealAssetSource — HAPPY (real repo assets/) ───────────────────────────

describe("RealAssetSource — HAPPY (real repo assets/)", () => {
  it("enumerates exactly the P0-vendor declared set (skills/agents/hooks/governance, NOT project/)", async () => {
    const source = new RealAssetSource(REPO_ASSETS_ROOT);
    const result = await source.load();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const actualPaths = result.value.files.map((f) => f.path).sort();
    expect(actualPaths).toEqual(DECLARED_FILES_IN_SCOPE);
  });

  it("assigns the correct kind per top-level directory (carve-out: the synthetic settings.json entry has no top-level directory)", async () => {
    const source = new RealAssetSource(REPO_ASSETS_ROOT);
    const result = await source.load();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    for (const file of result.value.files) {
      if (file.path === "settings.json") {
        expect(file.kind).toBe("settings-hook");
        continue;
      }
      const topDir = file.path.split("/")[0] as string;
      expect(file.kind).toBe(KIND_BY_TOP_DIR[topDir]);
    }
  });

  it("appends exactly one synthetic settings.json entry whose content is the {{lore:claude_dir}}-variable hook-entry array", async () => {
    const source = new RealAssetSource(REPO_ASSETS_ROOT);
    const result = await source.load();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const settingsFiles = result.value.files.filter((f) => f.path === "settings.json");
    expect(settingsFiles).toHaveLength(1);
    const settingsFile = settingsFiles[0] as (typeof result.value.files)[number];
    expect(settingsFile.kind).toBe("settings-hook");
    expect(settingsFile.executable).toBeUndefined();

    const parsed = JSON.parse(settingsFile.content) as Array<{ event: string; matcher?: string; command: string }>;
    expect(parsed.length).toBeGreaterThan(0);
    for (const entry of parsed) {
      expect(entry.command).toContain("{{lore:claude_dir}}/hooks/");
    }
    expect(settingsFile.sha256).toBe(sha256Hex(settingsFile.content));
  });

  it("marks exactly the declared .sh gate hooks + executable .mjs hooks as executable:true", async () => {
    const source = new RealAssetSource(REPO_ASSETS_ROOT);
    const result = await source.load();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const executablePaths = result.value.files.filter((f) => f.executable === true).map((f) => f.path).sort();
    expect(executablePaths).toEqual([...DECLARED_EXECUTABLE_PATHS].sort());
  });

  it("omits `executable` (never reports false) for non-executable files", async () => {
    const source = new RealAssetSource(REPO_ASSETS_ROOT);
    const result = await source.load();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const nonExecutable = result.value.files.filter((f) => !DECLARED_EXECUTABLE_PATHS.has(f.path));
    expect(nonExecutable.length).toBeGreaterThan(0);
    for (const file of nonExecutable) {
      expect(file.executable).toBeUndefined();
    }
  });
});

// ─── RealAssetSource — HAPPY (synthetic mkdtemp tree, path mapping) ────────

describe("RealAssetSource — HAPPY (synthetic tree, path mapping)", () => {
  it("maps a synthetic tree's files to the correct path/kind/content/sha256/executable", async () => {
    const root = makeScratchDir("asset-source-synthetic-");
    mkdirSync(join(root, "skills", "foo"), { recursive: true });
    mkdirSync(join(root, "agents"), { recursive: true });
    mkdirSync(join(root, "hooks"), { recursive: true });
    mkdirSync(join(root, "governance"), { recursive: true });

    writeFileSync(join(root, "skills", "foo", "SKILL.md"), "skill content");
    writeFileSync(join(root, "agents", "bar.md"), "agent content");
    writeFileSync(join(root, "hooks", "baz.sh"), "#!/bin/sh\necho hi\n");
    chmodSync(join(root, "hooks", "baz.sh"), 0o755);
    writeFileSync(join(root, "hooks", "qux.mjs"), "export const x = 1;\n");
    chmodSync(join(root, "hooks", "qux.mjs"), 0o644);
    writeFileSync(join(root, "governance", "gov.md"), "governance content");

    const source = new RealAssetSource(root);
    const result = await source.load();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const byPath = new Map(result.value.files.map((f) => [f.path, f] as const));
    expect([...byPath.keys()].sort()).toEqual(
      // load() unconditionally appends the synthetic settings.json entry
      // (see the top-level describe block for its own dedicated assertions).
      ["skills/foo/SKILL.md", "agents/bar.md", "hooks/baz.sh", "hooks/qux.mjs", "governance/gov.md", "settings.json"].sort(),
    );

    const skillFile = byPath.get("skills/foo/SKILL.md");
    expect(skillFile?.kind).toBe("skill");
    expect(skillFile?.content).toBe("skill content");
    expect(skillFile?.sha256).toBe(sha256Hex("skill content"));
    expect(skillFile?.executable).toBeUndefined();

    const agentFile = byPath.get("agents/bar.md");
    expect(agentFile?.kind).toBe("agent");

    const shHook = byPath.get("hooks/baz.sh");
    expect(shHook?.kind).toBe("hook");
    expect(shHook?.executable).toBe(true);

    const mjsHook = byPath.get("hooks/qux.mjs");
    expect(mjsHook?.executable).toBeUndefined();

    const governanceFile = byPath.get("governance/gov.md");
    expect(governanceFile?.kind).toBe("governance");
  });
});

// ─── RealAssetSource — BOUNDARY (empty subdir) ─────────────────────────────

describe("RealAssetSource — BOUNDARY (empty declared subdirectory)", () => {
  it("returns zero WALKED files for an empty subdirectory (plus the always-appended synthetic settings.json entry), without error", async () => {
    const root = makeScratchDir("asset-source-empty-subdir-");
    mkdirSync(join(root, "skills"), { recursive: true }); // empty — no files inside
    mkdirSync(join(root, "agents"), { recursive: true });
    mkdirSync(join(root, "hooks"), { recursive: true });
    mkdirSync(join(root, "governance"), { recursive: true });
    writeFileSync(join(root, "agents", "only.md"), "content");

    const source = new RealAssetSource(root);
    const result = await source.load();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.files.map((f) => f.path).sort()).toEqual(["agents/only.md", "settings.json"].sort());
  });
});

// ─── RealAssetSource — ERROR (missing/unreadable subdir surfaces as err) ───

describe("RealAssetSource — ERROR (missing subdirectory surfaces as err, never thrown)", () => {
  it("returns err(STORE_ERROR) — does not throw — when a declared subdirectory is entirely absent", async () => {
    const root = makeScratchDir("asset-source-missing-subdir-");
    mkdirSync(join(root, "skills"), { recursive: true });
    mkdirSync(join(root, "agents"), { recursive: true });
    mkdirSync(join(root, "hooks"), { recursive: true });
    // governance/ deliberately never created.

    const source = new RealAssetSource(root);
    // reason: `expect(fn).not.toThrow()` only checks a SYNCHRONOUS throw — it never awaits an
    // async function's returned promise, so it would pass vacuously here even if `load()`
    // rejected. `awaitNeverThrows` below actually awaits the call and captures any rejection
    // explicitly, which is the only way to assert "never throws" for an async port method.
    const { value: result, thrown } = await awaitNeverThrows(() => source.load());

    expect(thrown).toBeUndefined();
    expect(result).toBeDefined();
    expect(result?.ok).toBe(false);
    if (result?.ok !== false) return;
    const error = narrowErrorCode(result.error, "STORE_ERROR");
    expect(error.message).toContain("governance");
  });
});

// ─── RealSetupFsReader ──────────────────────────────────────────────────────

describe("RealSetupFsReader", () => {
  it("HAPPY: read returns file content; stat reports exists + sha256", async () => {
    const root = makeScratchDir("fs-reader-happy-");
    const filePath = join(root, "file.txt");
    writeFileSync(filePath, "hello reader");

    const reader = new RealSetupFsReader();
    expect(await reader.read(filePath)).toBe("hello reader");

    const stat = await reader.stat(filePath);
    expect(stat.exists).toBe(true);
    expect(stat.sha256).toBe(createHash("sha256").update(readFileSync(filePath)).digest("hex"));
  });

  it("NEGATIVE: read returns null (not an error) for a nonexistent path", async () => {
    const root = makeScratchDir("fs-reader-negative-");
    const reader = new RealSetupFsReader();
    expect(await reader.read(join(root, "does-not-exist.txt"))).toBeNull();
  });

  it("BOUNDARY: stat reports exists:false (never throws) for a nonexistent path", async () => {
    const root = makeScratchDir("fs-reader-boundary-");
    const reader = new RealSetupFsReader();
    const stat = await reader.stat(join(root, "does-not-exist.txt"));
    expect(stat).toEqual({ exists: false });
  });
});

// ─── RealSetupFsWriter ──────────────────────────────────────────────────────

describe("RealSetupFsWriter — HAPPY (atomic write) + REGRESSION (no leftover tmp)", () => {
  it("writes the final content and leaves no leftover .tmp-* sibling file", async () => {
    const root = makeScratchDir("fs-writer-atomic-");
    const targetPath = join(root, "nested", "dir", "file.txt");
    const writer = new RealSetupFsWriter();

    await writer.write(targetPath, "final content, atomically written");

    expect(readFileSync(targetPath, "utf8")).toBe("final content, atomically written");

    const siblingNames = readdirSync(dirname(targetPath));
    const tmpSiblings = siblingNames.filter((name) => name.startsWith(`${basename(targetPath)}.tmp-`));
    expect(tmpSiblings).toEqual([]);
  });

  it("overwrites existing content fully (no stale trailing bytes from a shorter new write)", async () => {
    const root = makeScratchDir("fs-writer-overwrite-");
    const targetPath = join(root, "file.txt");
    const writer = new RealSetupFsWriter();

    await writer.write(targetPath, "a very long original piece of content");
    await writer.write(targetPath, "short");

    expect(readFileSync(targetPath, "utf8")).toBe("short");
  });

  it("chmods to 0o755 when opts.executable is true", async () => {
    const root = makeScratchDir("fs-writer-chmod-");
    const targetPath = join(root, "script.sh");
    const writer = new RealSetupFsWriter();

    await writer.write(targetPath, "#!/bin/sh\necho hi\n", { executable: true });

    expect(statSync(targetPath).mode & 0o777).toBe(0o755);
  });

  it("does not set the executable bit when opts.executable is omitted", async () => {
    const root = makeScratchDir("fs-writer-no-chmod-");
    const targetPath = join(root, "notes.md");
    const writer = new RealSetupFsWriter();

    await writer.write(targetPath, "just text");

    expect(statSync(targetPath).mode & 0o111).toBe(0);
  });

  it("mkdir creates missing parent directories (idempotent — a second call does not throw)", async () => {
    const root = makeScratchDir("fs-writer-mkdir-");
    const nested = join(root, "a", "b", "c");
    const writer = new RealSetupFsWriter();

    await writer.mkdir(nested);
    expect(statSync(nested).isDirectory()).toBe(true);

    await expect(writer.mkdir(nested)).resolves.toBeUndefined();
  });
});

describe("RealSetupFsWriter.backup — STATE (backup dir created before write) + byte/mode fidelity", () => {
  it("creates the backup destination directory before writing into it, preserving bytes and mode", async () => {
    const root = makeScratchDir("fs-writer-backup-");
    const srcPath = join(root, "source.sh");
    writeFileSync(srcPath, "#!/bin/sh\necho original\n");
    chmodSync(srcPath, 0o750);

    const destDir = join(root, ".lore-backups", "2026-07-16T00-00-00-000Z");
    expect(existsSync(destDir)).toBe(false);

    const writer = new RealSetupFsWriter();
    await writer.backup(srcPath, destDir);

    expect(statSync(destDir).isDirectory()).toBe(true);
    const backupPath = join(destDir, "source.sh");
    expect(readFileSync(backupPath, "utf8")).toBe(readFileSync(srcPath, "utf8"));
    expect(statSync(backupPath).mode & 0o777).toBe(statSync(srcPath).mode & 0o777);
  });
});

describe("RealSetupFsWriter.remove", () => {
  it("HAPPY: removes an existing file", async () => {
    const root = makeScratchDir("fs-writer-remove-file-");
    const target = join(root, "file.txt");
    writeFileSync(target, "content");

    const writer = new RealSetupFsWriter();
    // `boundary` is REQUIRED (D8 of
    // spec-lore-setup-deletes-repo-source-through-dev-symlinks) — the scratch
    // root is the natural boundary for these cases, and passing it means the
    // ancestor scan actually runs here rather than being skipped.
    await writer.remove(target, { boundary: root });

    expect(existsSync(target)).toBe(false);
  });

  it("HAPPY: removes an existing directory recursively", async () => {
    const root = makeScratchDir("fs-writer-remove-dir-");
    const target = join(root, "dir");
    mkdirSync(join(target, "nested"), { recursive: true });
    writeFileSync(join(target, "nested", "file.txt"), "content");

    const writer = new RealSetupFsWriter();
    await writer.remove(target, { boundary: root });

    expect(existsSync(target)).toBe(false);
  });

  it("BOUNDARY: a missing target is a no-op, not an error", async () => {
    const root = makeScratchDir("fs-writer-remove-missing-");
    const writer = new RealSetupFsWriter();
    await expect(writer.remove(join(root, "does-not-exist"), { boundary: root })).resolves.toBeUndefined();
  });
});

// ─── RealMcpRegistrar ───────────────────────────────────────────────────────

/** Writes an executable shim named `claude` that records its argv (one per line) into `recorderPath` and exits 0. */
function writeClaudeRecorderShim(binDir: string, recorderPath: string): void {
  const shimPath = join(binDir, "claude");
  writeFileSync(shimPath, `#!/bin/sh\nprintf '%s\\n' "$@" > "${recorderPath}"\nexit 0\n`);
  chmodSync(shimPath, 0o755);
}

function readRecordedArgv(recorderPath: string): string[] {
  const raw = readFileSync(recorderPath, "utf8");
  return raw.split("\n").filter((line) => line.length > 0);
}

describe("RealMcpRegistrar — HAPPY (recording shim)", () => {
  it("add() invokes claude with buildMcpAddArgs(binPath)'s exact argv", async () => {
    const root = makeScratchDir("mcp-registrar-add-");
    const recorderPath = join(root, "recorded-argv.txt");
    writeClaudeRecorderShim(root, recorderPath);

    const registrar = new RealMcpRegistrar({ ...process.env, PATH: `${root}:${process.env["PATH"] ?? ""}` }, root);
    const binPath = "/usr/local/bin/lore";
    const result = await registrar.add(binPath);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe("added");
    expect(readRecordedArgv(recorderPath)).toEqual(buildMcpAddArgs(binPath));
  });

  it("remove() invokes claude with buildMcpRemoveArgs()'s exact argv", async () => {
    const root = makeScratchDir("mcp-registrar-remove-");
    const recorderPath = join(root, "recorded-argv.txt");
    writeClaudeRecorderShim(root, recorderPath);

    const registrar = new RealMcpRegistrar({ ...process.env, PATH: `${root}:${process.env["PATH"] ?? ""}` }, root);
    const result = await registrar.remove();

    expect(result.ok).toBe(true);
    expect(readRecordedArgv(recorderPath)).toEqual(buildMcpRemoveArgs());
  });
});

describe("RealMcpRegistrar — NEGATIVE (claude absent from PATH)", () => {
  it("add() returns err naming the exact manual command, never throws", async () => {
    const registrar = new RealMcpRegistrar({ ...process.env, PATH: "" }, makeScratchDir("mcp-registrar-no-claude-"));
    const binPath = "/usr/local/bin/lore";

    // reason: see the AssetSource ERROR test above for why `expect(fn).not.toThrow()` cannot
    // be used to assert "an async method never throws" — it never awaits the callback.
    const { value: result, thrown } = await awaitNeverThrows(() => registrar.add(binPath));

    expect(thrown).toBeUndefined();
    expect(result).toBeDefined();
    expect(result?.ok).toBe(false);
    if (result?.ok !== false) return;
    const error = narrowErrorCode(result.error, "VALIDATION_ERROR");
    expect(error.message).toContain(`claude mcp add -s user lore -- ${binPath} --mcp-server`);
  });

  it("remove() returns err naming the exact manual command, never throws", async () => {
    const registrar = new RealMcpRegistrar({ ...process.env, PATH: "" }, makeScratchDir("mcp-registrar-no-claude-"));

    const { value: result, thrown } = await awaitNeverThrows(() => registrar.remove());

    expect(thrown).toBeUndefined();
    expect(result).toBeDefined();
    expect(result?.ok).toBe(false);
    if (result?.ok !== false) return;
    const error = narrowErrorCode(result.error, "VALIDATION_ERROR");
    expect(error.message).toContain("claude mcp remove -s user lore");
  });
});

/**
 * Writes an executable shim named `claude` that always exits with `exitCode`
 * and writes `stderrText` to stderr — used to simulate `claude mcp add`'s
 * real-world exit-1 "already exists" collision (and a genuinely different
 * exit-1 failure) without a real `claude` install.
 */
function writeClaudeFailingShim(binDir: string, exitCode: number, stderrText: string): void {
  const shimPath = join(binDir, "claude");
  writeFileSync(shimPath, `#!/bin/sh\nprintf '%s' "${stderrText}" >&2\nexit ${exitCode}\n`);
  chmodSync(shimPath, 0o755);
}

describe("RealMcpRegistrar — add() idempotency (task-lore-setup-mcp-add-step-is-non-idempotent-already-exists)", () => {
  it("HAPPY/BOUNDARY: an 'already exists' exit-1 stderr is reclassified as ok('already_registered'), never err", async () => {
    const root = makeScratchDir("mcp-registrar-already-exists-");
    writeClaudeFailingShim(root, 1, "MCP server lore already exists in user config");

    const registrar = new RealMcpRegistrar({ ...process.env, PATH: `${root}:${process.env["PATH"] ?? ""}` }, root);
    const result = await registrar.add("/usr/local/bin/lore");

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe("already_registered");
  });

  it("NEGATIVE/REGRESSION: a genuinely different exit-1 stderr still resolves err (never silently swallowed)", async () => {
    const root = makeScratchDir("mcp-registrar-genuine-failure-");
    writeClaudeFailingShim(root, 1, "permission denied writing user config");

    const registrar = new RealMcpRegistrar({ ...process.env, PATH: `${root}:${process.env["PATH"] ?? ""}` }, root);
    const { value: result, thrown } = await awaitNeverThrows(() => registrar.add("/usr/local/bin/lore"));

    expect(thrown).toBeUndefined();
    expect(result?.ok).toBe(false);
    if (result?.ok !== false) return;
    const error = narrowErrorCode(result.error, "VALIDATION_ERROR");
    expect(error.message).toContain("permission denied writing user config");
    expect(error.message).toContain("claude mcp add -s user lore -- /usr/local/bin/lore --mcp-server");
  });

  it("ERROR: a case-varied 'ALREADY EXISTS' stderr is still detected (case-insensitive match)", async () => {
    const root = makeScratchDir("mcp-registrar-already-exists-caps-");
    writeClaudeFailingShim(root, 1, "Error: MCP server lore ALREADY EXISTS in user config");

    const registrar = new RealMcpRegistrar({ ...process.env, PATH: `${root}:${process.env["PATH"] ?? ""}` }, root);
    const result = await registrar.add("/usr/local/bin/lore");

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe("already_registered");
  });
});
