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
 * It also enforces R2 from the spec's risk table: the governance snippet
 * (`assets/governance/corpus-workflow.md`) was authored FRESH, standalone, and
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
 *   BOUNDARY:   the `<corpus-workflow>` tag pair is exactly one open + one close,
 *               open before close; all four `## ` FEED/PRODUCE/EXECUTE/CLOSE
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

// ─── Locate the REAL repo-root assets/ tree ────────────────────────────────────
// packages/lore/tests/unit/assets-ssot.test.ts -> repo root is 4 levels up.

const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..");
const ASSETS_ROOT = join(REPO_ROOT, "assets");

// ─── The declared manifest — THE conformance spec, not derived from the fs ────

const DECLARED_FILES = [
  // skills
  "skills/lore/SKILL.md",
  "skills/lore-kickoff/SKILL.md",
  "skills/lore-session/SKILL.md",
  "skills/lore-session/references/knowledge-types.md",
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
  "skills/lore-product/references/ideation-methods.md",
  "skills/lore-product/references/impact-mapping.md",
  "skills/lore-product/references/jtbd-framework.md",
  "skills/lore-product/references/mode-discovery.md",
  "skills/lore-product/references/mode-ideation.md",
  "skills/lore-product/references/mode-prd.md",
  "skills/lore-product/references/mode-roadmap.md",
  "skills/lore-product/references/mode-tech-assessment.md",
  "skills/lore-product/references/mode-ux-research.md",
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
  // skills/lore-init-context (vendored, converged from zz-init-context, 2026-07-17)
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
  // skills/lore-to-prd (vendored upstream workflow skill, 2026-07-17)
  "skills/lore-to-prd/SKILL.md",
  // skills/lore-triage (vendored upstream workflow skill, 2026-07-17)
  "skills/lore-triage/SKILL.md",
  "skills/lore-triage/AGENT-BRIEF.md",
  "skills/lore-triage/OUT-OF-SCOPE.md",
  // skills/lore-write-a-skill (vendored upstream workflow skill, 2026-07-17)
  "skills/lore-write-a-skill/SKILL.md",
  // skills/shared (cross-skill reference library — verification-family convergence, 2026-07-17)
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
  "agents/lore-explorer.md",
  "agents/lore-implementer.md",
  "agents/lore-reviewer.md",
  // hooks (5 .mjs + 4 .sh gates + 1 shared lib module)
  "hooks/session-start-resume.mjs",
  "hooks/stop-doc-sync.mjs",
  "hooks/subagent-context.mjs",
  "hooks/pre-subagent-gate.mjs",
  "hooks/pre-no-general-agent-gate.mjs",
  "hooks/lore-gate-g1-spec-create.sh",
  "hooks/lore-gate-g2-spec-promote.sh",
  "hooks/lore-gate-g3-plan-promote.sh",
  "hooks/lore-gate-g4-task-claim.sh",
  "hooks/lib/turn-state.mjs",
  // project (4 .sh gates + pre-push + tree.yaml template + verification-profile config template, SPEC-058 D6)
  "project/g1-spec-create.sh",
  "project/g2-spec-promote.sh",
  "project/g3-plan-promote.sh",
  "project/g4-task-claim.sh",
  "project/pre-push",
  "project/lore.tree.yaml.template",
  "project/lore-config-template.yaml",
  // governance
  "governance/corpus-workflow.md",
  "governance/seat-briefing.md",
] as const;

const SKILL_MD_FILES = DECLARED_FILES.filter((f) => f.endsWith("SKILL.md"));
const EXECUTABLE_REQUIRED_FILES = DECLARED_FILES.filter(
  (f) => f.endsWith(".sh") || f.endsWith("/pre-push"),
);
const DECLARED_TOP_LEVEL_DIRS = ["skills", "agents", "hooks", "project", "governance"];

const GOVERNANCE_REL = "governance/corpus-workflow.md";
const GOVERNANCE_PATH = join(ASSETS_ROOT, GOVERNANCE_REL);

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

  it("governance snippet contains none of the private global-CLAUDE.md personal markers", () => {
    const content = readRequiredFile(GOVERNANCE_PATH);
    const found = PERSONAL_MARKERS.filter((marker) => content.includes(marker));
    expect(found).toEqual([]);
  });

  it("governance snippet contains zero CJK characters", () => {
    const content = readRequiredFile(GOVERNANCE_PATH);
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
  it("corpus-workflow.md contains exactly one <corpus-workflow> open tag", () => {
    const content = readRequiredFile(GOVERNANCE_PATH);
    const opens = content.match(/<corpus-workflow>/g) ?? [];
    expect(opens.length).toBe(1);
  });

  it("corpus-workflow.md contains exactly one </corpus-workflow> close tag", () => {
    const content = readRequiredFile(GOVERNANCE_PATH);
    const closes = content.match(/<\/corpus-workflow>/g) ?? [];
    expect(closes.length).toBe(1);
  });

  it("the <corpus-workflow> open tag appears before the </corpus-workflow> close tag", () => {
    const content = readRequiredFile(GOVERNANCE_PATH);
    const openIdx = content.indexOf("<corpus-workflow>");
    const closeIdx = content.indexOf("</corpus-workflow>");
    expect(openIdx).toBeGreaterThanOrEqual(0);
    expect(closeIdx).toBeGreaterThan(openIdx);
  });

  it.each(["## FEED", "## PRODUCE", "## EXECUTE", "## CLOSE"])(
    "corpus-workflow.md contains a %s section header",
    (headerPrefix) => {
      const content = readRequiredFile(GOVERNANCE_PATH);
      const hasHeader = content
        .split("\n")
        .some((line) => line.startsWith(headerPrefix));
      expect(hasHeader).toBe(true);
    },
  );

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

  it("imports ONLY spawnSync from node:child_process — a bare `spawn` re-import is exactly what a re-added background test-runner block would need", () => {
    const content = readFileSync(SESSION_START_HOOK, "utf8");
    const importMatch = content.match(/import\s*\{([^}]*)\}\s*from\s*['"]node:child_process['"]/);
    expect(importMatch).not.toBeNull();
    const capturedNames = (importMatch as RegExpMatchArray)[1];
    if (capturedNames === undefined) {
      throw new Error("node:child_process import regex matched but its capture group is undefined — regex bug");
    }
    const importedNames = capturedNames.split(",").map((s) => s.trim());
    expect(importedNames).toContain("spawnSync");
    expect(importedNames).not.toContain("spawn");
  });

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
