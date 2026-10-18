#!/usr/bin/env bun
/**
 * Re-renders this repo's rendered rules files (`.claude/rules/lore-*.md`) from their fragments
 * (`assets/context/*.md` plus the project's own `.lore/context`), so the committed rules files are a
 * pure function of their fragments — the same way `packages/lore/src/generated/assets-manifest.ts`
 * is a pure function of `assets/`. `scripts/build.ts` calls this at the assets-manifest step.
 *
 * Mechanism: the product renderer, `runContextRefresh(..., { scope: "project", rulesOnly: true })` —
 * the call CL-5 used by hand. That renderer keeps a hand-edited file (`diverged_skip`) rather than
 * overwriting it; here the fragment is the ONLY source, so a diverged file is deleted and re-rendered
 * and the build prints which file it rewrote. Hand edits to a rendered file never survive a build:
 * edit the fragment under `assets/context/` instead.
 *
 * Hermetic: runs against an empty temporary HOME so a developer's own user-level context selection can
 * never leak into committed bytes (project-scope files are byte-identical across machines, AC-CV-3).
 *
 * Exit codes: 0 rendered (or nothing to render) / 1 a rules file the renderer cannot prove it owns
 * (`foreign_skip` / `legacy_skip`) or a renderer error — never reported as clean.
 */
import { existsSync, mkdtempSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { loadConfig, loadGlobalConfig, resolveGlobalConfigPath } from "@lore/core/node";
import { resolveMemoryFileBudgets } from "@lore/core";
import { runContextRefresh, type ContextRefreshReport } from "../packages/lore/src/flows/context-flow.js";
import { buildRefreshFragmentDeps, makeRealContextFsPort, toContextLayer } from "../packages/lore/src/adapters/cli/commands/context.js";

type RulesOutcome = ContextRefreshReport["rules"][number];

export interface RenderRepoRulesResult {
  /** Repo-relative paths whose bytes changed (created, updated, or a hand edit discarded). */
  readonly rewritten: readonly { readonly path: string; readonly reason: "rendered" | "hand-edit discarded" }[];
  /** Files the renderer cannot prove it owns; the caller must fail. */
  readonly unowned: readonly string[];
}

async function refreshRulesOnce(repoDir: string, home: string): Promise<ContextRefreshReport> {
  const projectConfig = loadConfig(repoDir);
  if (!projectConfig.ok) throw new Error(`render-repo-rules: cannot load .lore/config.yaml: ${JSON.stringify(projectConfig.error)}`);
  const env: Record<string, string | undefined> = {};
  const globalConfig = loadGlobalConfig(resolveGlobalConfigPath(env, home));
  if (!globalConfig.ok) throw new Error(`render-repo-rules: cannot load global config: ${JSON.stringify(globalConfig.error)}`);
  const fragmentDeps = buildRefreshFragmentDeps({
    repoRoot: repoDir,
    assetsRoot: join(repoDir, "assets"),
    home,
    env,
    globalLayer: toContextLayer(globalConfig.value),
    projectLayer: toContextLayer(projectConfig.value),
  });
  if (!fragmentDeps.ok) throw new Error(`render-repo-rules: ${JSON.stringify(fragmentDeps.error)}`);
  const refreshed = await runContextRefresh(
    { fs: makeRealContextFsPort(repoDir, [repoDir]), budgets: resolveMemoryFileBudgets(projectConfig.value), ...fragmentDeps.value },
    "",
    { scope: "project", rulesOnly: true },
  );
  if (!refreshed.ok) throw new Error(`render-repo-rules: ${JSON.stringify(refreshed.error)}`);
  return refreshed.value;
}

const rel = (repoDir: string, p: string): string => (p.startsWith("/") ? relative(repoDir, p) : p);
const changed = (o: RulesOutcome): boolean => o.state === "created" || o.state === "updated";

/** Renders the repo's rules files from their fragments, discarding hand edits. */
export async function renderRepoRules(repoDir: string): Promise<RenderRepoRulesResult> {
  if (!existsSync(join(repoDir, ".lore", "config.yaml"))) return { rewritten: [], unowned: [] };
  const home = mkdtempSync(join(tmpdir(), "lore-render-rules-home-"));
  try {
    const first = await refreshRulesOnce(repoDir, home);
    const diverged = first.rules.filter((o) => o.state === "diverged_skip");
    const rewritten: { path: string; reason: "rendered" | "hand-edit discarded" }[] = first.rules
      .filter(changed)
      .map((o) => ({ path: rel(repoDir, o.path), reason: "rendered" as const }));
    let finalRules = first.rules;
    if (diverged.length > 0) {
      for (const o of diverged) {
        const abs = o.path.startsWith("/") ? o.path : join(repoDir, o.path);
        unlinkSync(abs);
        rewritten.push({ path: rel(repoDir, o.path), reason: "hand-edit discarded" });
      }
      const second = await refreshRulesOnce(repoDir, home);
      finalRules = second.rules;
    }
    const unowned = finalRules
      .filter((o) => o.state === "foreign_skip" || o.state === "legacy_skip" || o.state === "diverged_skip")
      .map((o) => rel(repoDir, o.path));
    return { rewritten, unowned };
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const repoDir = join(import.meta.dir, "..");
  const result = await renderRepoRules(repoDir);
  for (const file of result.rewritten) console.log(`  Rules file rewritten from its fragment: ${file.path} (${file.reason})`);
  if (result.rewritten.length === 0) console.log("  Rules files: unchanged (already equal to a fresh render)");
  if (result.unowned.length > 0) {
    console.error(`render-repo-rules: cannot prove ownership of: ${result.unowned.join(", ")} — resolve by hand (not a hand edit of a lore-owned file)`);
    process.exit(1);
  }
  console.log("  Edit rendered rules at their source: assets/context/*.md, never .claude/rules/lore-*.md.");
}
