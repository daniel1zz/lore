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
 *   checkProjectLedger(deps, repoDir) — READ-ONLY half of `lore setup
 *     --project --check` (BR-1085): classifies the ledger's hook and skill
 *     files as outdated / diverged / missing / orphaned (ProjectLedgerFindings)
 *
 * Invariants:
 *   - Stateless beyond the injected ports — no fs/exec/init/asset IO happens
 *     in this file itself; it exists solely so `commands/setup.ts` has a
 *     class-shaped service to construct once and call, matching every other
 *     service in `service/` (CorpusService, DriftCheckService, ...).
 *   - `checkProjectLedger` never writes: its deps are `readFile` + asset readers only.
 *
 * Side-effect class: IO (delegates entirely to `scaffoldProject`)
 * Source: SPEC-046 §Design ("service/project-setup-service.ts")
 */

import { createHash } from "node:crypto";
import { join } from "node:path";

import { err, ok, setupManifestSchema } from "@lore/core";
import type { LoreError, Result } from "@lore/core";
import {
  HOOK_ASSET_NAMES,
  PROJECT_MANIFEST_RELATIVE_PATH,
  SKILL_TARGET_PREFIX,
  scaffoldProject,
  type ProjectAssetSource,
  type ProjectFsPort,
  type ProjectScaffoldFlowDeps,
  type ProjectScaffoldReport,
  type ProjectSkillAssetSource,
} from "../flows/setup-project-flow.js";

/**
 * Per-state file lists of the ledger-tracked project files (hooks and the baseline skill) — the
 * ledger half of `lore setup --project --check` (BR-1085). Paths are repo-relative POSIX paths.
 */
export interface ProjectLedgerFindings {
  /** Untouched since install (disk == ledger) but this binary now ships different bytes. */
  outdated: string[];
  /** On disk with bytes that match neither the ledger nor the shipped asset: a hand edit; never overwritten. */
  diverged: string[];
  /** Shipped (or ledger-listed and still shipped) but absent from disk. */
  missing: string[];
  /** Ledger-listed but no longer shipped by this binary. */
  orphaned: string[];
}

/** The narrow read-only deps {@link checkProjectLedger} needs — a subset of `ProjectScaffoldFlowDeps`. */
export interface ProjectLedgerCheckDeps {
  fs: Pick<ProjectFsPort, "readFile">;
  assets: ProjectAssetSource;
  skillAssets: ProjectSkillAssetSource;
}

/** Ledger entry kinds the check classifies; `governance` rows (CLAUDE.md, .gitignore, lore.tree.yaml) are expected to diverge. */
const CHECKED_LEDGER_KINDS: ReadonlySet<string> = new Set(["hook", "skill"]);

function sha256Of(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Classifies every hook and skill file the project ledger (`.lore/.lore-project-manifest.json`) tracks,
 * plus every shipped one it lacks, against the bytes this binary ships. READ-ONLY: writes nothing.
 *
 * Per ledger-tracked path: no longer shipped -> orphaned; absent on disk -> missing; disk == shipped -> in
 * sync; disk == ledger (untouched since install) -> outdated; anything else -> diverged. A shipped path the
 * ledger does not list is `missing` when absent, and ignored when present (the user's own file).
 *
 * @param deps - narrow read-only ports (real ones are built by the CLI adapter).
 * @param repoDir - absolute repo root.
 * @returns `ok(findings)`, or `err(VALIDATION_ERROR)` when the ledger is absent/malformed or a shipped asset is unreadable.
 * @example
 * const result = await checkProjectLedger(deps, "/path/to/repo");
 */
export async function checkProjectLedger(
  deps: ProjectLedgerCheckDeps,
  repoDir: string,
): Promise<Result<ProjectLedgerFindings, LoreError>> {
  const ledgerPath = join(repoDir, PROJECT_MANIFEST_RELATIVE_PATH);
  const raw = deps.fs.readFile(ledgerPath);
  if (raw === null) {
    return err({
      code: "VALIDATION_ERROR",
      field: "manifest",
      message: `no project install ledger at "${ledgerPath}" — nothing to check; run \`lore setup --project\` first.`,
      value: ledgerPath,
      rule: "BR-1181",
    });
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (cause) {
    return err({
      code: "VALIDATION_ERROR",
      field: "manifest",
      message: `malformed JSON in project install ledger "${ledgerPath}": ${cause instanceof Error ? cause.message : String(cause)}`,
      value: ledgerPath,
      rule: "BR-847",
    });
  }
  const ledger = setupManifestSchema.safeParse(parsedJson);
  if (!ledger.success) {
    return err({
      code: "VALIDATION_ERROR",
      field: "manifest",
      message: `project install ledger "${ledgerPath}" failed schema validation: ${ledger.error.message}`,
      value: ledgerPath,
      rule: "BR-847",
    });
  }

  const shipped = new Map<string, string>();
  for (const name of HOOK_ASSET_NAMES) {
    const asset = await deps.assets.readAsset(name);
    if (!asset.ok) return asset;
    shipped.set(`hooks/${name}`, asset.value);
  }
  const skills = deps.skillAssets.listSkillAssets();
  if (!skills.ok) return skills;
  for (const asset of skills.value) shipped.set(`${SKILL_TARGET_PREFIX}${asset.path}`, asset.content);

  const ledgerSha = new Map<string, string>();
  for (const entry of ledger.data.entries) {
    if (CHECKED_LEDGER_KINDS.has(entry.kind)) ledgerSha.set(entry.path, entry.sha256);
  }

  const findings: ProjectLedgerFindings = { outdated: [], diverged: [], missing: [], orphaned: [] };
  for (const [path, recordedSha] of ledgerSha) {
    const shippedContent = shipped.get(path);
    if (shippedContent === undefined) {
      findings.orphaned.push(path);
      continue;
    }
    const onDisk = deps.fs.readFile(join(repoDir, path));
    if (onDisk === null) findings.missing.push(path);
    else if (onDisk === shippedContent) continue;
    else if (sha256Of(onDisk) === recordedSha) findings.outdated.push(path);
    else findings.diverged.push(path);
  }
  for (const path of shipped.keys()) {
    if (ledgerSha.has(path)) continue;
    if (deps.fs.readFile(join(repoDir, path)) === null) findings.missing.push(path);
  }
  for (const list of Object.values(findings)) list.sort();
  return ok(findings);
}

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
