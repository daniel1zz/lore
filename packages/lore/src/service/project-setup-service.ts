/**
 * ProjectSetupService — thin `Result`-mapping wrapper around
 * `flows/setup-project-flow.ts`'s `scaffoldProject`, the repo-target scaffold
 * behind `lore setup --project` (SPEC-046 §Design, AC-046-C).
 *
 * Deliberately a SEPARATE service from `service/setup-service.ts` (the
 * global machine-target `~/.claude` installer) — global-machine vs
 * repo-target is a hard split per the SPEC-046 design (mirrors the
 * DriftCheck/TaskWorkflow anchor-command precedent: two services, one per
 * target type, never one service branching on target kind). This file has
 * ZERO imports from `setup-service.ts`, and `setup-service.ts` must have
 * ZERO imports from this file — enforced by a static import-scan REGRESSION
 * test in `project-setup-service.test.ts`.
 *
 * Public surface:
 *   ProjectSetupService — constructor(deps: ProjectScaffoldFlowDeps)
 *     .scaffold(repoDir) → Promise<Result<ProjectScaffoldReport, LoreError>>
 *
 * Invariants:
 *   - Stateless beyond the injected ports — no fs/exec/init/asset IO happens
 *     in this file itself; it exists solely so `commands/setup.ts` has a
 *     class-shaped service to construct once and call, matching every other
 *     service in `service/` (CorpusService, DriftCheckService, ...).
 *
 * Side-effect class: IO (delegates entirely to `scaffoldProject`)
 * Source: SPEC-046 §Design ("service/project-setup-service.ts")
 */

import type { LoreError, Result } from "@lore/core";
import {
  scaffoldProject,
  type ProjectScaffoldFlowDeps,
  type ProjectScaffoldReport,
} from "../flows/setup-project-flow.js";

/**
 * Per-repo scaffold service — the class `lore setup --project` constructs
 * once (with the adapter-built ports) and calls per invocation.
 */
export class ProjectSetupService {
  constructor(private readonly deps: ProjectScaffoldFlowDeps) {}

  /**
   * Scaffolds `repoDir` with the Lore-governed project workflow: `.lore/`
   * init, `assets/project/` hooks, `lore.tree.yaml`, and `core.hooksPath`
   * wiring. See {@link scaffoldProject} for the full per-step contract.
   *
   * @param repoDir - Absolute path to the target git repository root.
   * @returns `ok(report)` with the full per-step outcome, or
   *   `err(VALIDATION_ERROR)` for a malformed `repoDir`.
   * @example
   * const service = new ProjectSetupService(deps);
   * const result = await service.scaffold("/path/to/repo");
   */
  async scaffold(repoDir: string): Promise<Result<ProjectScaffoldReport, LoreError>> {
    return scaffoldProject(this.deps, { repoDir });
  }
}
