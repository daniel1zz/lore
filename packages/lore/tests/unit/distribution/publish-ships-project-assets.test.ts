// @reads assets/**
// @reads scripts/publish-npm.ts
/**
 * INT-T7: the npm package must ship every `assets/project/**` file (pre-push,
 * reference-transaction, CLAUDE.md.template, ...). `lore setup --project` reads them off
 * the binary's own assets root at runtime; a package without them installs no hooks and
 * fails every scaffold step with "unknown or unreadable project asset".
 *
 * Asserts the REAL shipped-list computation (`computeShippedAssetFiles`, the list
 * `scripts/publish-npm.ts` feeds to `buildPublishPlan`) against the REAL `assets/project`
 * directory listing, so a newly added project asset is covered with no second list.
 *
 * Coverage:
 *   HAPPY:      every file under assets/project is in the shipped list
 *   NEGATIVE:   an assets root with no project dir yields no project entries (no phantom files)
 *   REGRESSION: the install-set files (skills/hooks) are still shipped
 */

import { describe, it, expect } from "vitest";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "..");
const PUBLISH_NPM_SPECIFIER = pathToFileURL(join(REPO_ROOT, "scripts", "publish-npm.ts")).href;

type ComputeFn = (assetsRoot: string) => Promise<{ ok: true; value: string[] } | { ok: false; error: { message: string } }>;

async function loadCompute(): Promise<ComputeFn> {
  const mod = (await import(/* @vite-ignore */ PUBLISH_NPM_SPECIFIER)) as { computeShippedAssetFiles: ComputeFn };
  return mod.computeShippedAssetFiles;
}

describe("npm package ships assets/project", () => {
  it("AC-INT-T7: every assets/project file is in the shipped list", async () => {
    const compute = await loadCompute();
    const result = await compute(join(REPO_ROOT, "assets"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const onDisk = readdirSync(join(REPO_ROOT, "assets", "project")).map((f) => `assets/project/${f}`);
    expect(onDisk.length).toBeGreaterThan(0);
    expect(onDisk).toContain("assets/project/pre-push");
    expect(onDisk).toContain("assets/project/reference-transaction");
    const missing = onDisk.filter((f) => !result.value.includes(f));
    expect(missing).toEqual([]);
    // REGRESSION: install-set files still ship.
    expect(result.value.some((f) => f.startsWith("assets/skills/"))).toBe(true);
  });

  it("AC-INT-T7: an assets root without project/ yields no project entries", async () => {
    const compute = await loadCompute();
    const root = mkdtempSync(join(tmpdir(), "lore-ships-project-"));
    try {
      for (const d of ["skills", "agents", "hooks", "governance"]) mkdirSync(join(root, d), { recursive: true });
      writeFileSync(join(root, "governance", "seat-briefing.md"), "x\n");
      const result = await compute(root);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.filter((f) => f.startsWith("assets/project/"))).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
