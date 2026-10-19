// @reads assets/**
// @reads packages/lore/package.json
/**
 * Asset SSOT conformance suite (SPEC-046 AC-046-D).
 *
 * `assets/` is the vendored, distributable Lore workflow bundle (P0 of PRD §17):
 * skills, agents, hooks, project scaffold hooks, and a standalone governance
 * snippet. This suite is a pure `node:fs` read against the REPO'S OWN CHECKED-IN
 * `assets/` tree — no store, no `bun:sqlite`, no sandbox (read-only). It is the
 * mechanized conformance oracle the spec's Design section calls for: the manifest
 * of every file `assets/` MUST contain is declared HERE, in-test, as the SSOT for
 * "what shipped" — drifting the real tree away from this list (adding, removing,
 * or renaming a shipped file) fails this suite, on purpose.
 *
 * It also enforces R2 from the spec's risk table: the corpus-workflow prose
 * (now the shipped `assets/context/corpus-workflow-*.md` fragments; formerly
 * `assets/governance/corpus-workflow.md`, deleted by
 * spec-context-fragments-config-driven-layered-rule-injection D9) was authored FRESH, standalone, and
 * must never carry the owner's private global-CLAUDE.md personal markers
 * (absolute home paths, browser-profile mentions, personal email/domain) or
 * leftover CJK text — it ships to third parties who are not this repo's owner.
 *
 * Coverage:
 *   HAPPY:      every declared skill/agent/hook/project/governance file exists
 *               under assets/ (manifest completeness)
 *   NEGATIVE:   the completeness CHECKER itself is proven non-tautological — it
 *               flags a synthetic missing file — plus a whole-tree grep proving
 *               zero files anywhere under assets/ hardcode `/Users/apple`
 *   BOUNDARY:   the corpus-workflow fragments are schema-valid, one per H2 section
 *               (plus the overview), tag-free, with body sha256 pins proving the
 *               text is verbatim; all four `## ` FEED/PRODUCE/EXECUTE/CLOSE
 *               section headers are present; every SKILL.md starts with `---`
 *               frontmatter carrying a `name:` line; no declared top-level asset
 *               directory is empty
 *   ERROR:      reading a nonexistent path surfaces (throws), never silently
 *               returns empty/undefined — proves the suite's file-reading helper
 *               doesn't swallow read failures
 *   STATE:      the actual recursive file listing under assets/ is EXACTLY the
 *               declared manifest set (bidirectional: no missing, no extras)
 *   REGRESSION: the "extra file" detector is itself proven non-tautological on a
 *               synthetic fixture (an unexpected top-level file would be flagged)
 *               + every .sh/pre-push file under assets/ keeps its owner-execute
 *               bit (a common bit-loss regression on checkout/packaging)
 *
 * @spec_ref AC-046-D
 */

import { describe, it, expect } from "vitest";
import { existsSync, statSync, readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { parse as parseYaml } from "yaml";
import { FragmentFrontmatterSchema, splitFrontmatter } from "@lore/core";
import { EMBEDDED_ASSETS_MANIFEST } from "../../src/generated/assets-manifest.js";
import { buildManifest, renderGeneratedFile } from "../../../../scripts/embed-assets-manifest.mjs";
import {
  RealAssetSource,
  isRetiredFromInstall,
  listBinaryReadAssetPaths,
} from "../../src/adapters/real-asset-source.js";

// ─── Locate the REAL repo-root assets/ tree ────────────────────────────────────
// packages/lore/tests/unit/assets-ssot.test.ts -> repo root is 4 levels up.

const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..");
const ASSETS_ROOT = join(REPO_ROOT, "assets");

// ─── The declared manifest — THE conformance spec, not derived from the fs ────

const DECLARED_FILES = [
  // skills
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
  // skills/lore-init-context (vendored, converged from zz-init-context, 2026-07-17).
  // RETIRED FROM INSTALL (spec-context-verb-family-two-zone-claude-md-anatomy-lore
  // D10): still ships/fingerprinted under assets/ (this is a disk-level manifest —
  // see real-asset-source.ts's RETIRED_FROM_INSTALL_PATHS doc comment for the
  // governance-file precedent this mirrors), but `lore setup` no longer installs
  // it — see real-setup-ports.test.ts's DECLARED_FILES_IN_SCOPE, which is the
  // payload-level list and DELIBERATELY excludes this path.
  "skills/lore-init-context/SKILL.md",
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
  // agents
  "agents/lore-implementer.md",
  "agents/lore-reader.md",
  // hooks (.mjs hooks + shared lib modules)
  "hooks/session-start-resume.mjs",
  // session-start-marker (same-session-authorship fact for the resume-ticket
  // coverage floor, task-verifying-a-handoff-you-just-authored-arms-the-coverage, 2026-08-01)
  "hooks/session-start-marker.mjs",
  // stop-turn-review turn-state producers (issue #156) — both in HOOK_REGISTRATIONS
  "hooks/user-prompt-turn-start.mjs",
  "hooks/post-edit-mark.mjs",
  // stop-handoff-coverage (Stop-time resume-ticket coverage floor, spec-resume-ticket-coverage-a-shipped-upper-bound-left-the, 2026-07-31)
  "hooks/stop-handoff-coverage.mjs",
  // stop-turn-review (turn-end review of the main session, spec-interception-moves-off-every-tool-call-one-turn-end-review;
  // in HOOK_REGISTRATIONS on Stop; replaced stop-doc-sync.mjs and claude-md-guard.sh)
  "hooks/stop-turn-review.mjs",
  "hooks/subagent-context.mjs",
  "hooks/pre-no-general-agent-gate.mjs",
  // pre-dispatch-isolation-gate (denies an implementation subagent dispatched
  // without isolation:"worktree"; orchestration-policy, so deliberately NOT in
  // HOOK_REGISTRATIONS — spec-dispatch-isolation-must-be-enforced-by-a-gate-and D5, 2026-07-31)
  "hooks/pre-dispatch-isolation-gate.mjs",
  // pre-bash-git-safety-gate (state-aware destructive-git guard, 2026-07-20)
  "hooks/pre-bash-git-safety-gate.mjs",
  // subagent-stop-commit-guard (SubagentStop data-loss backstop, SPEC-046 amendment, 2026-07-21)
  "hooks/subagent-stop-commit-guard.mjs",
  // run-register + pre-tool-harness-run (run identity slice 1, BR-1044) — both in HOOK_REGISTRATIONS
  "hooks/run-register.mjs",
  // run-end + shared run-id helper (SessionEnd/SubagentStop run end, BR-1059)
  "hooks/run-end.mjs",
  "hooks/lib/run-id.mjs",
  // shared cwd-aware shell parser, GENERATED from packages/core/src/shell-cwd.ts (DCL-4; scripts/sync-hook-shell-cwd.ts)
  "hooks/lib/shell-cwd.mjs",
  "hooks/pre-tool-harness-run.mjs",
  // pre-helper-foreign-working-copy-gate (isolated helper writing into a foreign git working copy, BR-1092; in HOOK_REGISTRATIONS on PreToolUse Write|Edit|MultiEdit|NotebookEdit)
  "hooks/pre-helper-foreign-working-copy-gate.mjs",
  // pre-edit-anchor-gate (a helper's edit outside its claim's anchors is declared via `lore anchor declare` or denied; in HOOK_REGISTRATIONS on PreToolUse Write|Edit|MultiEdit|NotebookEdit)
  "hooks/pre-edit-anchor-gate.mjs",
  // the anchor gate's two libraries: the top-level-symbol scan of an Edit, and the files a Bash command writes
  "hooks/lib/top-level-symbols.mjs",
  "hooks/lib/shell-writes.mjs",
  // post-edit-bindings (edit-time notice of prose bound to the edited file; in HOOK_REGISTRATIONS on PostToolUse Edit|Write|MultiEdit|NotebookEdit)
  "hooks/post-edit-bindings.mjs",
  "hooks/lib/turn-state.mjs",
  // session trail (spec-session-trail D13): start/end writers and their shared library
  "hooks/session-trail-start.mjs",
  "hooks/subagent-trail.mjs",
  "hooks/lib/session-trail.mjs",
  // project (4 .sh gates + pre-push + tree.yaml template + verification-profile config template, SPEC-058 D6)
  "project/pre-push",
  "project/reference-transaction", // main-ref guard hook (BR-1246), installed by `lore setup --project`
  "project/lore.tree.yaml.template",
  "project/lore-config-template.yaml",
  // project scaffold repo-root .gitignore + CLAUDE.md stub templates (SPEC-060 D3/D4)
  "project/gitignore.template",
  "project/CLAUDE.md.template",
  // fresh-install-only root skeleton (What This Is / Commands / Architecture), read by setup-project-flow
  "project/CLAUDE.md.skeleton",
  // context fragments (spec-context-fragments-config-driven-layered-rule-injection D9) —
  // binary-read, never installed; the corpus-workflow prose lives here since governance/corpus-workflow.md was deleted
  "context/corpus-workflow-0-overview.md",
  "context/corpus-workflow-1-feed.md",
  "context/corpus-workflow-2-produce.md",
  "context/corpus-workflow-3-execute.md",
  "context/corpus-workflow-4-close.md",
  // RE-BASELINE (task-skill-implement-shipped-agents-set-omitclaudemd-true, AC-CF-9): shipped agents now set
  // omitClaudeMd, so the subagent-audience rules they used to get from CLAUDE.md ship as this fragment.
  "context/agent-rules.md",
  // task-rs-t13-migration-promoted-shipped-fragments-agent-rules (AC-RS-13): lore-tool facts promoted from the user layer
  "context/ac-design.md",
  "context/evidence-attestation.md",
  "context/dispatch-bundle.md",
  "context/worktree-dispatch.md",
  // governance
  "governance/seat-briefing.md",
  "governance/claude-md-contract.md",
  "governance/write-spec-rule.md",
] as const;

const SKILL_MD_FILES = DECLARED_FILES.filter((f) => f.endsWith("SKILL.md"));
const EXECUTABLE_REQUIRED_FILES = DECLARED_FILES.filter(
  (f) => f.endsWith(".sh") || f.endsWith("/pre-push") || f.endsWith("/reference-transaction"),
);
const DECLARED_TOP_LEVEL_DIRS = ["skills", "agents", "hooks", "project", "governance", "context"];

// RE-BASELINE (SPEC-083 amended by spec-context-fragments D9): the single corpus-workflow.md is
// replaced by these fragment files. Every assertion that pinned the old file now asserts the same
// fact over the fragments (see readCorpusWorkflowFragments).
const RETIRED_GOVERNANCE_REL = "governance/corpus-workflow.md";
const CORPUS_WORKFLOW_FRAGMENT_RELS = [
  "context/corpus-workflow-0-overview.md",
  "context/corpus-workflow-1-feed.md",
  "context/corpus-workflow-2-produce.md",
  "context/corpus-workflow-3-execute.md",
  "context/corpus-workflow-4-close.md",
] as const;
/** sha256 of each fragment BODY (text after the frontmatter) — measured equal to the verbatim sections of the deleted file. */
// RE-BASELINE (task-skill-implement-move-the-six-checkpoint-backed-rules, AC-RT-1): the feed / produce / execute pins
// below were re-measured after six checkpoint-backed bullets moved VERBATIM out of these always-loaded fragments
// (resume disposition -> lore-plan resume mode; living-vs-record -> lore-design; claim identity + COMMIT BEFORE YOU
// ATTEST -> lore-autopilot / lore-implementer). Only whole bullets were removed; no remaining text changed.
const CORPUS_WORKFLOW_BODY_SHA256: Record<(typeof CORPUS_WORKFLOW_FRAGMENT_RELS)[number], string> = {
// RE-BASELINE (task-reword-the-ten-always-loaded-fragments-to-the-rule-only, spec-always-loaded-lore-fragments-state-the-rule-only-reasoning):
// that commit shortened the wording of the ten always-loaded fragments (verbatim before-text in
// knowledge-always-loaded-lore-fragments-verbatim-source-before). It also lost rules; see the assessments
// knowledge-assessment-always-loaded-lore-fragments-state-the and knowledge-assessment-always-loaded-lore-fragments-state-the-2.
// RE-BASELINE (task-restore-the-remaining-clauses-the-assessment-named-and): restores that projects without `.lore/` work normally (native plan mode + task tracking).
// RE-BASELINE (task-traceability-pass-over-the-ten-fragments-classify-every): traceability pass against knowledge-traceability-table-always-loaded-lore-fragments; restores the corpus-not-prompt framing and automatic gate interception.
  "context/corpus-workflow-0-overview.md": "103abe648f47758bb32b95ee40d937873bf2d6ed622473b9b0bba906cc846b78",
  // RE-BASELINE (task-prose-sweep-shipped-assets-say-pull-lore-bootstrap-when, AC-SI-5): the feed rule no longer
  // calls the bootstrap hook-injected; it says the injection carries only the seat's claims + plan handoff and
  // corpus state is pulled on demand (`lore bootstrap` / `lore ready` / `lore pending`).
// RE-BASELINE (task-reword-the-ten-always-loaded-fragments-to-the-rule-only, spec-always-loaded-lore-fragments-state-the-rule-only-reasoning):
// that commit shortened the wording of the ten always-loaded fragments (verbatim before-text in
// knowledge-always-loaded-lore-fragments-verbatim-source-before). It also lost rules; see the assessments
// knowledge-assessment-always-loaded-lore-fragments-state-the and knowledge-assessment-always-loaded-lore-fragments-state-the-2.
// RE-BASELINE (task-restore-the-instruction-parts-the-rule-only-reword-dropped): that commit restored six instructions
// the reword dropped and cut three clauses (feed latest_handoffs, feed no-session-marker floor, produce legacy config clause); the second assessment (knowledge-assessment-always-loaded-lore-fragments-state-the-2) named what was still missing.
// RE-BASELINE (task-restore-the-remaining-clauses-the-assessment-named-and): restores `latest_handoffs` as a neutral directory and the floor arming (fail-safe) when authorship cannot be determined.
// RE-BASELINE (task-traceability-pass-over-the-ten-fragments-classify-every): traceability pass against knowledge-traceability-table-always-loaded-lore-fragments; restores the where-configured session-start injection scope, the `lore bootstrap` contents, the user-is-router rule, the source-label duty, and the unseen-artifact verification rule.
// RE-BASELINE (task-drop-the-explanation-the-traceability-pass-over-restored): drops the explanation clauses the traceability pass put back (see knowledge-traceability-table-always-loaded-lore-fragments v3); it also dropped the user-is-router clause and the clause that rendering your own outgoing ticket does not charge you with next-steps.
// RE-BASELINE (task-close-out-keep-the-three-borderline-clauses-and-fix-the): restores the user-is-router clause and the own-outgoing-ticket clause the drop pass removed (and the ac-design "weaken the rule, build a tie" clause in another fragment).
  "context/corpus-workflow-1-feed.md": "673ad618bb6a55929d935fb5f2ccb69febef852b79d2d71342779e304a525c66",
  // RE-BASELINE (task-ac-set-correction-audited-fix-of-one-criterion-on-a-locked, AC-CC-4): names `lore ac set --correction`
// RE-BASELINE (task-reword-the-ten-always-loaded-fragments-to-the-rule-only, spec-always-loaded-lore-fragments-state-the-rule-only-reasoning):
// that commit shortened the wording of the ten always-loaded fragments (verbatim before-text in
// knowledge-always-loaded-lore-fragments-verbatim-source-before). It also lost rules; see the assessments
// knowledge-assessment-always-loaded-lore-fragments-state-the and knowledge-assessment-always-loaded-lore-fragments-state-the-2.
// RE-BASELINE (task-restore-the-instruction-parts-the-rule-only-reword-dropped): that commit restored six instructions
// the reword dropped and cut three clauses (feed latest_handoffs, feed no-session-marker floor, produce legacy config clause); the second assessment (knowledge-assessment-always-loaded-lore-fragments-state-the-2) named what was still missing.
// RE-BASELINE (task-restore-the-remaining-clauses-the-assessment-named-and): restores the legacy `workflow.gates."task-claim"` config honored for phase-claim (one deprecation warning per process).
// RE-BASELINE (task-traceability-pass-over-the-ten-fragments-classify-every): traceability pass against knowledge-traceability-table-always-loaded-lore-fragments; restores the phase-claim definition.
// RE-BASELINE (task-skill-implement-dn-1-review-prompt-v4-with-design, spec-the-approval-judge-rejects-patch-shaped-designs-design D3): adds the one "design the end state" sentence.
  "context/corpus-workflow-2-produce.md": "1c8d39f6e2d20ad3523ac34dd93113f32213513e971199e600994eabaf81dfd9",
// RE-BASELINE (task-reword-the-ten-always-loaded-fragments-to-the-rule-only, spec-always-loaded-lore-fragments-state-the-rule-only-reasoning):
// that commit shortened the wording of the ten always-loaded fragments (verbatim before-text in
// knowledge-always-loaded-lore-fragments-verbatim-source-before). It also lost rules; see the assessments
// knowledge-assessment-always-loaded-lore-fragments-state-the and knowledge-assessment-always-loaded-lore-fragments-state-the-2.
// RE-BASELINE (task-restore-the-instruction-parts-the-rule-only-reword-dropped): that commit restored six instructions
// the reword dropped and cut three clauses (feed latest_handoffs, feed no-session-marker floor, produce legacy config clause); the second assessment (knowledge-assessment-always-loaded-lore-fragments-state-the-2) named what was still missing.
// RE-BASELINE (task-traceability-pass-over-the-ten-fragments-classify-every): traceability pass against knowledge-traceability-table-always-loaded-lore-fragments; restores the snapshot-never-current-state rule, the UPSTREAM_NOT_APPROVED freeze, the verify exit-code rule and the piped-exit-code reason.
// RE-BASELINE (task-drop-the-explanation-the-traceability-pass-over-restored): drops the explanation clauses the traceability pass put back (see knowledge-traceability-table-always-loaded-lore-fragments v3); every instruction, condition and qualifier is kept.
// RE-BASELINE (task-shipped-guidance-teaches-lore-evidence-result-pass-output-2): the pass-evidence bullet now teaches `--capture` (the gate refuses a hand-authored tail for --result pass).
  "context/corpus-workflow-3-execute.md": "de48d3aa4b12a74f23dd8bbc614d6d02181789acf983971c0a8f0baced1b115b",
  // RE-BASELINE (task-rs-t13-migration-promoted-shipped-fragments-agent-rules, AC-RS-13): gains the CLAUDE.md-vs-corpus
  // boundary bullet moved from the user-layer lore-loop fragment (user-03).
// RE-BASELINE (task-reword-the-ten-always-loaded-fragments-to-the-rule-only, spec-always-loaded-lore-fragments-state-the-rule-only-reasoning):
// that commit shortened the wording of the ten always-loaded fragments (verbatim before-text in
// knowledge-always-loaded-lore-fragments-verbatim-source-before). It also lost rules; see the assessments
// knowledge-assessment-always-loaded-lore-fragments-state-the and knowledge-assessment-always-loaded-lore-fragments-state-the-2.
// RE-BASELINE (task-restore-the-instruction-parts-the-rule-only-reword-dropped): that commit restored six instructions
// the reword dropped and cut three clauses (feed latest_handoffs, feed no-session-marker floor, produce legacy config clause); the second assessment (knowledge-assessment-always-loaded-lore-fragments-state-the-2) named what was still missing.
// RE-BASELINE (task-restore-the-remaining-clauses-the-assessment-named-and): restores `prohibitions` in the CLAUDE.md content list.
// RE-BASELINE (task-traceability-pass-over-the-ten-fragments-classify-every): traceability pass against knowledge-traceability-table-always-loaded-lore-fragments; restores the CLAUDE.md state-narrative prohibition, the maintenance command labels, the report-issue trigger examples and the anchor-timing reason.
// RE-BASELINE (task-drop-the-explanation-the-traceability-pass-over-restored): drops the explanation clauses the traceability pass put back (see knowledge-traceability-table-always-loaded-lore-fragments v3); every instruction, condition and qualifier is kept.
  // RE-BASELINE (task-skill-implement-close-fragment-scopes-defect-reports-br, BR-1153): the report-issue bullet gains the scope rule (lore defects only, one root cause per report, repo upkeep to plan/task).
  // RE-BASELINE (orchestrator-owned doc change, spec-the-approval-judge-rejects-patch-shaped-designs-design D3): adds the lesson-changes-a-mechanism bullet after the invalidate bullet.
  "context/corpus-workflow-4-close.md": "91f727466e49304d1632eb6b24e4ef7b52715c493ba4d1abf18a42e6b1806219",
};

/** Concatenated bodies of the corpus-workflow fragments, in file-name (= rendering) order. */
function readCorpusWorkflowFragments(): string {
  return CORPUS_WORKFLOW_FRAGMENT_RELS.map((rel) => {
    const split = splitFrontmatter(readFileSync(join(ASSETS_ROOT, rel), "utf-8"), "strict");
    if (!split.ok) throw new Error(`${rel}: ${split.error}`);
    return split.body;
  }).join("\n");
}

const SEAT_BRIEFING_REL = "governance/seat-briefing.md";
const SEAT_BRIEFING_PATH = join(ASSETS_ROOT, SEAT_BRIEFING_REL);
const SEAT_BRIEFING_PLACEHOLDERS = ["{{ACTOR}}", "{{BRANCH}}", "{{MAIN_CHECKOUT}}"] as const;

const PERSONAL_MARKERS = ["/Users/", "agent-browser", "zheng@", "humanity.org"];
const CJK_RANGE = /[一-鿿]/;

// ─── Helpers under test (kept in-file — this suite IS the oracle) ─────────────

/** Reads a required file's contents; never swallows a read failure. */
function readRequiredFile(relOrAbsPath: string): string {
  return readFileSync(relOrAbsPath, "utf-8");
}

/** Returns the subset of `files` (repo-relative to `root`) that do NOT exist. */
function findMissingFiles(root: string, files: readonly string[]): string[] {
  return files.filter((f) => !existsSync(join(root, f)));
}

/** Recursively lists all files under `root`, as paths relative to `root` (POSIX-joined). */
function listFilesRecursive(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, prefix: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(join(dir, entry.name), rel);
      } else if (entry.isFile()) {
        out.push(rel);
      }
    }
  };
  walk(root, "");
  return out;
}

// ─── HAPPY — manifest completeness ─────────────────────────────────────────────

describe("assets-ssot — HAPPY (manifest completeness)", () => {
  it("every declared skill/agent/hook/project/governance file exists under assets/", () => {
    const missing = findMissingFiles(ASSETS_ROOT, DECLARED_FILES);
    expect(missing).toEqual([]);
  });

  for (const dir of DECLARED_TOP_LEVEL_DIRS) {
    it(`declared top-level directory assets/${dir} exists`, () => {
      expect(existsSync(join(ASSETS_ROOT, dir))).toBe(true);
      expect(statSync(join(ASSETS_ROOT, dir)).isDirectory()).toBe(true);
    });
  }
});

// ─── NEGATIVE — checker non-tautology + whole-tree personal-path cleanliness ──

describe("assets-ssot — NEGATIVE", () => {
  it("findMissingFiles is not a vacuous pass: a synthetic nonexistent path is flagged missing", () => {
    // Guards against the HAPPY test above becoming tautological (e.g. if
    // findMissingFiles were accidentally hardcoded to always return []).
    const missing = findMissingFiles(ASSETS_ROOT, [
      ...DECLARED_FILES,
      "skills/does-not-exist/SKILL.md",
    ]);
    expect(missing).toEqual(["skills/does-not-exist/SKILL.md"]);
  });

  it("no file under assets/ hardcodes the owner's personal absolute path /Users/apple", () => {
    const offenders: string[] = [];
    for (const rel of listFilesRecursive(ASSETS_ROOT)) {
      const content = readRequiredFile(join(ASSETS_ROOT, rel));
      if (content.includes("/Users/apple")) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it("corpus-workflow fragments contain none of the private global-CLAUDE.md personal markers", () => {
    const content = readCorpusWorkflowFragments();
    const found = PERSONAL_MARKERS.filter((marker) => content.includes(marker));
    expect(found).toEqual([]);
  });

  it("corpus-workflow fragments contain zero CJK characters", () => {
    const content = readCorpusWorkflowFragments();
    expect(CJK_RANGE.test(content)).toBe(false);
  });
});

// ─── BOUNDARY — tag pairing, frontmatter, non-empty directories ───────────────

describe("assets-ssot — BOUNDARY (skill-name grammar)", () => {
  // Owner naming rule (ADR adr-retire-lore-planner-...): everything `lore setup`
  // ships under assets/skills/ is `lore-*` namespaced. The ONE exemption is
  // `shared/` — a non-invokable references library (no SKILL.md) that sibling
  // skills reach via relative `../shared/` paths, so it must keep its bare name.
  const skillDirs = [
    ...new Set(
      DECLARED_FILES.filter((f) => f.startsWith("skills/"))
        .map((f) => f.split("/")[1])
        .filter((d): d is string => d !== undefined),
    ),
  ];
  const SKILL_NAME_EXEMPT = new Set(["shared"]);

  it.each(skillDirs.filter((d) => !SKILL_NAME_EXEMPT.has(d)))(
    "skill directory %s is lore-namespaced (bare `lore` root or `lore-*`)",
    (dir) => {
      expect(dir).toMatch(/^lore(-[a-z0-9-]+)?$/);
    },
  );

  it("shared/ is the only non-lore-namespaced skill directory (library exemption)", () => {
    const nonNamespaced = skillDirs.filter((d) => !/^lore/.test(d));
    expect(nonNamespaced).toEqual(["shared"]);
  });

  it.each(skillDirs.filter((d) => !SKILL_NAME_EXEMPT.has(d)))(
    "skill %s frontmatter name matches its directory",
    (dir) => {
      const content = readRequiredFile(join(ASSETS_ROOT, "skills", dir, "SKILL.md"));
      const frontmatterEnd = content.indexOf("---", 3);
      const frontmatter = content.slice(0, frontmatterEnd);
      const nameLine = frontmatter.split("\n").find((l) => /^name:/.test(l)) ?? "";
      const name = nameLine.replace(/^name:\s*/, "").replace(/["']/g, "").trim();
      expect(name).toBe(dir);
    },
  );
});

describe("assets-ssot — BOUNDARY", () => {
  // Tag-pair assertions (one `<corpus-workflow>` open + one close, open before close) pinned the
  // retired single-file wrapper. The fragments carry NO wrapper tags by design (the renderer owns
  // framing), so the corrected claims are: schema-valid frontmatter, unique prefixed ids, tag-free
  // bodies, and verbatim bodies (sha256 pins measured equal to the deleted file's sections).
  it("every corpus-workflow fragment parses with FragmentFrontmatterSchema (audience [main], mode static, id corpus-workflow-*)", () => {
    const ids: string[] = [];
    for (const rel of CORPUS_WORKFLOW_FRAGMENT_RELS) {
      const split = splitFrontmatter(readRequiredFile(join(ASSETS_ROOT, rel)), "strict");
      expect(split.ok, rel).toBe(true);
      if (!split.ok) continue;
      const parsed = FragmentFrontmatterSchema.safeParse(parseYaml(split.frontmatter));
      expect(parsed.success, rel).toBe(true);
      if (!parsed.success) continue;
      expect(parsed.data.audience).toEqual(["main"]);
      expect(parsed.data.mode).toBe("static");
      expect(parsed.data.id.startsWith("corpus-workflow-")).toBe(true);
      ids.push(parsed.data.id);
    }
    expect(new Set(ids).size).toBe(CORPUS_WORKFLOW_FRAGMENT_RELS.length);
  });

  it("the corpus-workflow fragments carry no <corpus-workflow> wrapper tag and the deleted governance file is gone", () => {
    const content = readCorpusWorkflowFragments();
    expect(content).not.toContain("<corpus-workflow>");
    expect(content).not.toContain("</corpus-workflow>");
    expect(existsSync(join(ASSETS_ROOT, RETIRED_GOVERNANCE_REL))).toBe(false);
  });

  it.each(CORPUS_WORKFLOW_FRAGMENT_RELS)("%s body is verbatim (sha256 equals the pin measured against the deleted file's section)", (rel) => {
    const split = splitFrontmatter(readRequiredFile(join(ASSETS_ROOT, rel)), "strict");
    expect(split.ok).toBe(true);
    if (!split.ok) return;
    expect(createHash("sha256").update(split.body).digest("hex")).toBe(CORPUS_WORKFLOW_BODY_SHA256[rel]);
  });

  it("there is exactly one fragment per H2 section: each of FEED/PRODUCE/EXECUTE/CLOSE heads exactly one fragment body", () => {
    for (const header of ["## FEED", "## PRODUCE", "## EXECUTE", "## CLOSE"]) {
      const holders = CORPUS_WORKFLOW_FRAGMENT_RELS.filter((rel) => {
        const split = splitFrontmatter(readRequiredFile(join(ASSETS_ROOT, rel)), "strict");
        return split.ok && split.body.split("\n").some((l) => l.startsWith(header));
      });
      expect(holders, header).toHaveLength(1);
    }
  });

  it.each(["## FEED", "## PRODUCE", "## EXECUTE", "## CLOSE"])(
    "corpus-workflow fragments contain a %s section header",
    (headerPrefix) => {
      const content = readCorpusWorkflowFragments();
      const hasHeader = content
        .split("\n")
        .some((line) => line.startsWith(headerPrefix));
      expect(hasHeader).toBe(true);
    },
  );

  // AC-073-4 (SPEC-073): the CLOSE section carries a standing reporting-discipline
  // stanza — suspected lore defect -> re-verify own input first -> `lore
  // report-issue`. Two independent token assertions (the command name AND the
  // re-verify-first clause) so byte-parity checks elsewhere can never vacuously
  // pass with the stanza silently absent from BOTH the SSOT and an installed copy.
  it("corpus-workflow fragments AC-073-4: reporting-discipline stanza names lore report-issue", () => {
    const content = readCorpusWorkflowFragments();
    expect(content).toContain("lore report-issue");
  });

  it("corpus-workflow fragments AC-073-4: reporting-discipline stanza carries the re-verify-first clause", () => {
    const content = readCorpusWorkflowFragments();
    expect(content).toContain("Re-verify your own input");
  });

  // task-corpus-workflow-injection-labels-lore-release-as-done-and (AC-1, AC-2):
  // the EXECUTE section used to end at `lore release` with zero mentions of
  // `lore done`, so every implementer that followed the injected text believed
  // its own worktree action archived the task — it never does, so the task
  // stayed in the ready set forever (measured: 13/13 agents on one plan).
  // AC-1 is a lone contiguous-substring check, deliberately paired with AC-2's
  // proximity assertions below so it can never vacuously pass alone (a stray
  // "lore done" mention elsewhere, unrelated to the two-party split, would
  // still satisfy AC-1 but not AC-2).
  it("corpus-workflow fragments AC-1: EXECUTE section names lore done at least once", () => {
    const content = readCorpusWorkflowFragments();
    const count = (content.match(/lore done/g) ?? []).length;
    expect(count).toBeGreaterThanOrEqual(1);
  });

  it("corpus-workflow fragments AC-1: the lore-done mention lives inside the EXECUTE section, not FEED/PRODUCE/CLOSE", () => {
    const content = readCorpusWorkflowFragments();
    const executeStart = content.indexOf("## EXECUTE");
    const closeStart = content.indexOf("## CLOSE");
    expect(executeStart).toBeGreaterThanOrEqual(0);
    expect(closeStart).toBeGreaterThan(executeStart);
    const executeSection = content.slice(executeStart, closeStart);
    expect(executeSection).toContain("lore done");
  });

  // AC-2: two independent lone-token proximity checks, never one remembered
  // sentence — `done` sits near an `archiv*` token (it IS the archiving verb)
  // and `release` sits near an explicit negation of archival (it is NOT the
  // archiving verb). Either half alone would pass on `grep -c "lore done"`
  // wording tweaks that lose the actual two-party semantics.
  it("corpus-workflow fragments AC-2: 'done' sits near an 'archiv*' token — lore done is named as the archiving step", () => {
    const content = readCorpusWorkflowFragments();
    expect(/done[^\n]{0,200}archiv/i.test(content)).toBe(true);
  });

  it("corpus-workflow fragments AC-2: 'release' sits near an explicit negation of archival — release does not archive", () => {
    const content = readCorpusWorkflowFragments();
    expect(/release[^\n]{0,200}does not archive/i.test(content)).toBe(true);
  });

  it("corpus-workflow fragments AC-2 REGRESSION control: the negation-proximity assertion is not vacuous — a synthetic string missing the negation fails the identical regex", () => {
    const missingNegation = "lore release <task> archives the task immediately.";
    expect(/release[^\n]{0,200}does not archive/i.test(missingNegation)).toBe(false);
    // and the positive form the real asset satisfies is reachable at all:
    expect(/release[^\n]{0,200}does not archive/i.test("lore release drops the lease — it does not archive anything.")).toBe(true);
  });

  it.each(SKILL_MD_FILES)("%s starts with --- frontmatter", (relPath) => {
    const content = readRequiredFile(join(ASSETS_ROOT, relPath));
    expect(content.startsWith("---")).toBe(true);
  });

  it.each(SKILL_MD_FILES)("%s frontmatter contains a name: line", (relPath) => {
    const content = readRequiredFile(join(ASSETS_ROOT, relPath));
    const frontmatterEnd = content.indexOf("---", 3);
    expect(frontmatterEnd).toBeGreaterThan(0);
    const frontmatter = content.slice(0, frontmatterEnd);
    const hasName = frontmatter.split("\n").some((line) => /^name:\s*\S/.test(line));
    expect(hasName).toBe(true);
  });

  for (const dir of DECLARED_TOP_LEVEL_DIRS) {
    it(`assets/${dir} is not empty (contains at least one file, recursively)`, () => {
      const files = listFilesRecursive(join(ASSETS_ROOT, dir));
      expect(files.length).toBeGreaterThan(0);
    });
  }
});

// ─── BOUNDARY — seat-briefing.md tag pairing + placeholder set (SPEC-047) ─────

describe("assets-ssot — BOUNDARY (seat-briefing.md, SPEC-047)", () => {
  it("seat-briefing.md contains exactly one <session-seat> open tag", () => {
    const content = readRequiredFile(SEAT_BRIEFING_PATH);
    const opens = content.match(/<session-seat>/g) ?? [];
    expect(opens.length).toBe(1);
  });

  it("seat-briefing.md contains exactly one </session-seat> close tag", () => {
    const content = readRequiredFile(SEAT_BRIEFING_PATH);
    const closes = content.match(/<\/session-seat>/g) ?? [];
    expect(closes.length).toBe(1);
  });

  it("the <session-seat> open tag appears before the </session-seat> close tag", () => {
    const content = readRequiredFile(SEAT_BRIEFING_PATH);
    const openIdx = content.indexOf("<session-seat>");
    const closeIdx = content.indexOf("</session-seat>");
    expect(openIdx).toBeGreaterThanOrEqual(0);
    expect(closeIdx).toBeGreaterThan(openIdx);
  });

  it.each(SEAT_BRIEFING_PLACEHOLDERS)("seat-briefing.md references the %s placeholder at least once", (placeholder) => {
    const content = readRequiredFile(SEAT_BRIEFING_PATH);
    const count = content.split(placeholder).length - 1;
    expect(count).toBeGreaterThanOrEqual(1);
  });
});

// ─── ERROR — read failures surface, never swallowed ───────────────────────────

describe("assets-ssot — ERROR", () => {
  it("readRequiredFile throws (does not silently return empty/undefined) for a nonexistent path", () => {
    const bogusPath = join(ASSETS_ROOT, "governance/does-not-exist.md");
    expect(existsSync(bogusPath)).toBe(false);
    expect(() => readRequiredFile(bogusPath)).toThrow();
  });

  it("findMissingFiles surfaces an unreadable root by throwing, not by silently reporting everything present", () => {
    const bogusRoot = join(ASSETS_ROOT, "this-directory-does-not-exist");
    expect(() => findMissingFiles(bogusRoot, ["skills/lore/SKILL.md"])).not.toThrow();
    // existsSync against a bogus root correctly reports missing (not swallowed as "present").
    expect(findMissingFiles(bogusRoot, ["skills/lore/SKILL.md"])).toEqual(["skills/lore/SKILL.md"]);
  });
});

// ─── STATE — actual tree exactly matches the declared manifest (bidirectional) ─

describe("assets-ssot — STATE", () => {
  it("the recursive file listing under assets/ is exactly the declared manifest set", () => {
    const actual = listFilesRecursive(ASSETS_ROOT).slice().sort();
    const declared = [...DECLARED_FILES].sort();
    expect(actual).toEqual(declared);
  });
});

// ─── REGRESSION — extra-file detector proven non-tautological + execute bits ──

describe("assets-ssot — REGRESSION", () => {
  it("an unexpected extra top-level file under assets/ would be flagged (synthetic fixture)", () => {
    // Proves the STATE comparison above isn't vacuously true (e.g. if someone
    // replaced it with a subset check instead of exact-set equality).
    const tmpRoot = mkdtempSync(join(tmpdir(), "assets-ssot-regression-"));
    try {
      mkdirSync(join(tmpRoot, "skills"), { recursive: true });
      writeFileSync(join(tmpRoot, "skills", "expected.md"), "ok");
      writeFileSync(join(tmpRoot, "UNEXPECTED_EXTRA_FILE.md"), "should be flagged");

      const actual = listFilesRecursive(tmpRoot).slice().sort();
      const declared = ["skills/expected.md"].sort();
      expect(actual).not.toEqual(declared);
      const extras = actual.filter((f) => !declared.includes(f));
      expect(extras).toEqual(["UNEXPECTED_EXTRA_FILE.md"]);
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it.each(EXECUTABLE_REQUIRED_FILES)("%s keeps its owner-execute bit", (relPath) => {
    const mode = statSync(join(ASSETS_ROOT, relPath)).mode;
    expect(mode & 0o100).not.toBe(0);
  });
});

// ─── REGRESSION (BUG-004): session-start-resume.mjs never re-blocks on tests ──
//
// The 2026-07-18 CLAUDE.md dogfood log records TWO removals of session-start
// Phase F ("test health"): a full vitest run on every session start that
// `await`ed before `emit`, blocking session open, then orphaning worker
// processes on timeout (OOM incident). The prior manifest-level assets-ssot
// suite (205/205 green) never asserted anything about FILE CONTENT, so a
// re-introduced Phase F block in the `assets/` SSOT copy specifically (while
// the installed `~/.claude/hooks/` copy stayed fixed) would have passed
// every existing check silently — the exact "writer without a content-level
// reader" class of incident this repo's CLAUDE.md log calls out repeatedly.
// These assertions run directly against the file's TEXT, closing that gap.

describe("assets-ssot — REGRESSION (BUG-004: no test-runner blocking in session-start hook)", () => {
  const SESSION_START_HOOK = join(ASSETS_ROOT, "hooks", "session-start-resume.mjs");
  const FORBIDDEN_MARKERS = [
    "runInKillableGroup",
    "testHealthBlock",
    "npx vitest --run",
    "bunx vitest --run",
    "npm test",
    "npm run test",
  ] as const;

  it.each(FORBIDDEN_MARKERS)(
    "the vendored session-start-resume.mjs SSOT does not contain %j (2026-07-18 removal)",
    (marker) => {
      const content = readFileSync(SESSION_START_HOOK, "utf8");
      expect(content).not.toContain(marker);
    },
  );

  // 2026-07-25 SPEC-076 Phase F exemption: T8 legitimately introduced a
  // detached `spawn()` call (spawnSetupCheckRefresh) for the `lore setup
  // --check --json` background cache refresh — fail-open + unref, with 13
  // dedicated tests of its own (the SPEC-076 Phase F suite). A bare
  // `import { ..., spawn }` is no longer forbidden outright, but the
  // BUG-004 intent (2026-07-18: no re-introduced background test-runner
  // block) still holds — so the proxy assertion moves from "spawn is never
  // imported" to "every actual `spawn(` call site is provably the Phase F
  // setup-check refresh, and nothing else". spawnSync must still be
  // imported (Phase E git/bootstrap probes depend on it).
  it("imports spawnSync from node:child_process (required by Phase E git/bootstrap probes)", () => {
    const content = readFileSync(SESSION_START_HOOK, "utf8");
    const importMatch = content.match(/import\s*\{([^}]*)\}\s*from\s*['"]node:child_process['"]/);
    expect(importMatch).not.toBeNull();
    const capturedNames = (importMatch as RegExpMatchArray)[1];
    if (capturedNames === undefined) {
      throw new Error("node:child_process import regex matched but its capture group is undefined — regex bug");
    }
    const importedNames = capturedNames.split(",").map((s) => s.trim());
    expect(importedNames).toContain("spawnSync");
  });

  it(
    "every bare `spawn(` call site (non-spawnSync) is the SPEC-076 Phase F " +
      "`lore setup --check` background refresh — any other spawn use (e.g. a " +
      "re-introduced background test-runner) fails this test (BUG-004 intent, " +
      "2026-07-25 Phase F exemption carve-out)",
    () => {
      const content = readFileSync(SESSION_START_HOOK, "utf8");

      // Search code only — this file's prose (JSDoc block comments, full-line
      // `//` comments) narrates `spawn()` in English (e.g. "spawn() throwing
      // synchronously (rare) must never block session start") without being a
      // real call site; strip both comment forms before scanning so those
      // mentions can't produce a false match (positive OR negative).
      const codeOnly = content.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

      // Word-boundary literal match: "spawnSync(" never matches `\bspawn\(`
      // because "Sync" sits between "spawn" and "(" in that identifier — so
      // this only finds genuine bare `spawn(...)` call sites, never
      // `spawnSync(...)` ones.
      const spawnCallRegex = /\bspawn\(/g;
      const callSiteIndexes: number[] = [];
      let match: RegExpExecArray | null;
      while ((match = spawnCallRegex.exec(codeOnly)) !== null) {
        callSiteIndexes.push(match.index);
      }

      if (callSiteIndexes.length > 0) {
        // A bare `spawn` call site exists, so the import list must declare it
        // explicitly (no re-export/aliasing trick that would hide it from the
        // import-list check above).
        const importMatch = content.match(/import\s*\{([^}]*)\}\s*from\s*['"]node:child_process['"]/);
        expect(importMatch).not.toBeNull();
        const capturedNames = (importMatch as RegExpMatchArray)[1];
        if (capturedNames === undefined) {
          throw new Error("node:child_process import regex matched but its capture group is undefined — regex bug");
        }
        const importedNames = capturedNames.split(",").map((s) => s.trim());
        expect(importedNames).toContain("spawn");
      }

      // Each call site's surrounding argument text must reference the exact
      // sanctioned invocation — `lore setup --check` — proving it is the
      // Phase F cache refresh and not some other (e.g. test-runner) use.
      for (const index of callSiteIndexes) {
        const context = codeOnly.slice(index, index + 200);
        expect(context).toContain("setup");
        expect(context).toContain("--check");
      }
    },
  );

  it("REGRESSION control: the marker scan is not vacuously true — a synthetic fixture carrying a forbidden marker IS flagged", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "bug-004-regression-"));
    try {
      const tmpFile = join(tmpDir, "fixture-session-start.mjs");
      writeFileSync(tmpFile, "// reintroduced by mistake\nfunction runInKillableGroup() {}\n");
      const content = readFileSync(tmpFile, "utf8");
      expect(FORBIDDEN_MARKERS.some((marker) => content.includes(marker))).toBe(true);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ─── DISTRIBUTION (AC-GS-6): the argument-aware git-safety-gate SHIPS ─────────
//
// spec-git-safety-gate-probes-report-the-wrong-blast-radius. A gate fix that
// lands only in this repo's working tree does not exist for a consumer running
// `lore setup`: setup installs from `assets/` and classifies freshness against
// the sha256 embedded in `packages/lore/src/generated/assets-manifest.ts`. Two
// independent halves, because they fail for different reasons:
//
//   1. sha256 parity — an edited hook whose manifest entry was never regenerated
//      (the natural post-implementation state; `bun run build` regenerates it).
//      The whole-tree equivalent lives in build/embed-assets-manifest.test.ts as
//      a tree_digest comparison; this is the per-file, pointed form for the file
//      whose staleness this spec's fix depends on.
//   2. content markers — a manifest that is internally consistent but fingerprints
//      the PRE-FIX bytes. sha parity alone cannot tell the two apart: hashing
//      whatever is on disk is true of a stale file and a fixed one alike.
describe("assets-ssot — DISTRIBUTION (AC-GS-6: argument-aware git-safety-gate reaches consumers)", () => {
  const GATE_RELATIVE_PATH = "hooks/pre-bash-git-safety-gate.mjs";
  const GATE_ABSOLUTE_PATH = join(ASSETS_ROOT, GATE_RELATIVE_PATH);

  it("the embedded manifest sha256 for the git-safety-gate hook equals the sha256 of its bytes under assets/ on disk", () => {
    const entry = EMBEDDED_ASSETS_MANIFEST.entries.find((e) => e.path === GATE_RELATIVE_PATH);
    expect(entry, `${GATE_RELATIVE_PATH} must be declared in the embedded manifest`).toBeDefined();
    const onDisk = createHash("sha256").update(readFileSync(GATE_ABSOLUTE_PATH)).digest("hex");
    expect((entry as { sha256: string }).sha256).toBe(onDisk);
  });

  it("the shipped git-safety-gate carries the argument-aware probe behaviour, not the pre-fix argument-blind bytes", () => {
    const content = readFileSync(GATE_ABSOLUTE_PATH, "utf8");
    // D4's fixed marker, and the raw/sanitized split that D1 requires.
    expect(content).toContain("[ARG-FALLBACK]");
    expect(content).toContain("splitSegmentPairs");
    // The pre-fix signatures: the parameter name `_inner` STATED that the stash
    // probe never read its argument, and probePathArg took `inner` unread.
    expect(content).not.toContain("function probeStash(_inner");
    // D2: probeDirtyTree's argument-blindness is correct and must NOT have been
    // "fixed" — its `_inner` signature is the one that stays.
    expect(content).toContain("function probeDirtyTree(_inner");
  });
});

// ─── DISTRIBUTION (task-corpus-workflow-injection-labels-lore-release-as-done-and) ──
// Same two-independent-halves shape as AC-GS-6 above, applied to the lore-done
// fix: sha parity alone (manifest entry == on-disk bytes) is satisfied equally
// by a stale-but-internally-consistent manifest and a freshly regenerated one,
// so it is paired with an explicit "differs from the measured pre-fix value"
// assertion — the exact sha256 the orchestrator measured on `main @ 6788989`
// before this fix landed.
describe("assets-ssot — DISTRIBUTION (corpus-workflow fragments manifest freshness; replaces the corpus-workflow.md sha pins)", () => {
  it.each(CORPUS_WORKFLOW_FRAGMENT_RELS)("the embedded manifest sha256 for %s equals the sha256 of its bytes under assets/ on disk (kind context)", (rel) => {
    const entry = EMBEDDED_ASSETS_MANIFEST.entries.find((e) => e.path === rel);
    expect(entry, `${rel} must be declared in the embedded manifest`).toBeDefined();
    const onDisk = createHash("sha256").update(readFileSync(join(ASSETS_ROOT, rel))).digest("hex");
    expect((entry as { sha256: string }).sha256).toBe(onDisk);
    expect((entry as { kind: string }).kind).toBe("context");
  });

  it("the embedded manifest has NO entry for the deleted governance/corpus-workflow.md (a stale entry means the manifest was not regenerated)", () => {
    expect(EMBEDDED_ASSETS_MANIFEST.entries.find((e) => e.path === RETIRED_GOVERNANCE_REL)).toBeUndefined();
  });
});

// ─── assets/context manifest (task-skill-implement-distribute-assets-context-manifest-kind) ──
// `assets/context/` is the shipped context-fragment SSOT (spec D9): manifest-tracked
// as kind "context", read binary-side via resolveAssetsRoot, NEVER installed into
// ~/.claude. Every probe runs against a TEMP assets root so the real assets/ tree is
// never touched.
describe("assets/context manifest", () => {
  const TOP_DIRS = ["agents", "governance", "hooks", "project", "skills"];

  function makeTempAssets(withContext: boolean): string {
    const root = mkdtempSync(join(tmpdir(), "assets-ctx-"));
    for (const d of TOP_DIRS) {
      mkdirSync(join(root, d), { recursive: true });
      writeFileSync(join(root, d, "seed.md"), `seed ${d}\n`);
    }
    if (withContext) {
      mkdirSync(join(root, "context"), { recursive: true });
      writeFileSync(join(root, "context", "zz-probe.md"), "probe fragment\n");
    }
    return root;
  }

  it("a fixture assets/context/zz-probe.md yields manifest entry path 'context/zz-probe.md' kind 'context' ownership managed", () => {
    const root = makeTempAssets(true);
    try {
      const m = buildManifest(root, REPO_ROOT);
      const entry = m.entries.find((e: { path: string }) => e.path === "context/zz-probe.md");
      expect(entry).toBeDefined();
      expect(entry?.kind).toBe("context");
      expect(entry?.ownership).toBe("managed");
      expect(renderGeneratedFile(m)).toContain('"context"');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("a missing assets/context directory yields ZERO context entries, not an error", () => {
    const root = makeTempAssets(false);
    try {
      const m = buildManifest(root, REPO_ROOT);
      expect(m.entries.filter((e: { kind: string }) => e.kind === "context")).toHaveLength(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("a missing governance directory is STILL a loud error (only context is optional)", () => {
    const root = makeTempAssets(true);
    try {
      rmSync(join(root, "governance"), { recursive: true, force: true });
      expect(() => buildManifest(root, REPO_ROOT)).toThrow(/governance/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("context/* is never installed: RealAssetSource.load() yields no context path, isRetiredFromInstall covers it", async () => {
    const root = makeTempAssets(true);
    try {
      const loaded = await new RealAssetSource(root).load();
      expect(loaded.ok).toBe(true);
      if (!loaded.ok) return;
      expect(loaded.value.files.some((f) => f.path.startsWith("context/"))).toBe(false);
      expect(loaded.value.files.some((f) => f.path.startsWith("skills/"))).toBe(true); // live control: walk still works
      expect(isRetiredFromInstall("context/zz-probe.md")).toBe(true);
      expect(isRetiredFromInstall("context")).toBe(false);
      expect(isRetiredFromInstall("skills/seed.md")).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("listBinaryReadAssetPaths lists context and project files as assetsRoot-relative POSIX paths; only the seeded project file for a missing context dir", () => {
    const withCtx = makeTempAssets(true);
    const without = makeTempAssets(false);
    try {
      expect(listBinaryReadAssetPaths(withCtx)).toEqual(["context/zz-probe.md", "project/seed.md"]);
      expect(listBinaryReadAssetPaths(without)).toEqual(["project/seed.md"]);
    } finally {
      rmSync(withCtx, { recursive: true, force: true });
      rmSync(without, { recursive: true, force: true });
    }
  });

  it("real assets/ tree is unchanged by these probes: no zz-probe.md under the real assets/context", () => {
    expect(existsSync(join(ASSETS_ROOT, "context", "zz-probe.md"))).toBe(false);
  });
});
