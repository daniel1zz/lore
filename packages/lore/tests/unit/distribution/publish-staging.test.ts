/**
 * `scripts/publish-npm.ts` `stageFilesToDisk` convergence suite
 * (task-skill-implement-spec-083-amendment-corpus-workflow-prose follow-up).
 *
 * Defect: staging wrote into `<repo>/dist-npm/<pkg>-<target>/` with `mkdirSync` only and
 * never cleared it, so an asset retired from the repo (here the deleted
 * `governance/corpus-workflow.md`) survived in a stale staging dir from an older build and
 * shipped in the tarball. A fresh checkout/worktree has no `dist-npm`, which is why a
 * from-scratch probe cannot reach this defect — the test therefore builds BOTH ends of the
 * diff: a staging dir PRE-SEEDED with a stale retired asset, plus a live control that a
 * currently-shipped asset is present after staging.
 *
 * Runs against a throwaway repo root (mkdtemp) through the `repoRoot` seam of
 * `stageFilesToDisk`; the real repo's `dist-npm` is never touched.
 *
 * Coverage:
 *   HAPPY:      a currently-shipped asset and the binary/package.json are staged
 *   NEGATIVE:   a stale file pre-seeded under the staging dir is absent afterwards
 *   STATE:      sibling dirs under dist-npm (other targets, artifacts) are left alone
 *   REGRESSION: a staging dir that does not exist yet still stages cleanly
 *
 * Import note: dynamic `import()` with a computed specifier (see publish-pipeline.test.ts).
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "..");
const PUBLISH_NPM_SPECIFIER = pathToFileURL(join(REPO_ROOT, "scripts", "publish-npm.ts")).href;

interface MinimalPlan {
  stagingRoot: string;
  stagingFiles: Record<string, string>;
  packageJson: Record<string, unknown>;
}

type StageFn = (plan: MinimalPlan, repoRoot?: string) => { ok: boolean; error?: { message: string } };

let stageFilesToDisk: StageFn;

beforeAll(async () => {
  const mod = (await import(/* @vite-ignore */ PUBLISH_NPM_SPECIFIER)) as { stageFilesToDisk: StageFn };
  stageFilesToDisk = mod.stageFilesToDisk;
});

const STAGING_ROOT = "dist-npm/cli-test-target/";
const README_SOURCE = "README.md";

let root = "";

function seedRepo(): void {
  mkdirSync(join(root, "dist"), { recursive: true });
  writeFileSync(join(root, "dist", "lore"), "#!/bin/sh\n");
  writeFileSync(join(root, README_SOURCE), "readme\n");
  mkdirSync(join(root, "assets", "governance"), { recursive: true });
  writeFileSync(join(root, "assets", "governance", "seat-briefing.md"), "live shipped asset\n");
}

function makePlan(): MinimalPlan {
  return {
    stagingRoot: STAGING_ROOT,
    stagingFiles: {
      [`${STAGING_ROOT}dist/lore`]: "dist/lore",
      [`${STAGING_ROOT}assets/governance/seat-briefing.md`]: "assets/governance/seat-briefing.md",
    },
    packageJson: { name: "@scope/cli-test-target", version: "0.0.0" },
  };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "publish-staging-"));
  seedRepo();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("stageFilesToDisk — stale staging convergence", () => {
  it("HAPPY: a currently-shipped asset, the binary and package.json are present after staging", () => {
    const result = stageFilesToDisk(makePlan(), root);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(readFileSync(join(root, STAGING_ROOT, "assets/governance/seat-briefing.md"), "utf8")).toBe("live shipped asset\n");
    expect(existsSync(join(root, STAGING_ROOT, "dist/lore"))).toBe(true);
    expect(existsSync(join(root, STAGING_ROOT, "package.json"))).toBe(true);
  });

  it("NEGATIVE: a stale retired asset pre-seeded in the staging dir is ABSENT after staging, while the live control is present", () => {
    const stale = join(root, STAGING_ROOT, "assets", "governance", "corpus-workflow.md");
    mkdirSync(dirname(stale), { recursive: true });
    writeFileSync(stale, "stale file from an older build\n");
    expect(existsSync(stale)).toBe(true); // both ends exist before staging: the probe is not vacuous

    const result = stageFilesToDisk(makePlan(), root);
    expect(result.ok, JSON.stringify(result)).toBe(true);

    expect(existsSync(stale)).toBe(false);
    expect(existsSync(join(root, STAGING_ROOT, "assets/governance/seat-briefing.md"))).toBe(true);
  });

  it("STATE: sibling directories under dist-npm (another target, artifacts) are left untouched", () => {
    const sibling = join(root, "dist-npm", "artifacts", "keep.tgz");
    const otherTarget = join(root, "dist-npm", "cli-other-target", "package.json");
    mkdirSync(dirname(sibling), { recursive: true });
    mkdirSync(dirname(otherTarget), { recursive: true });
    writeFileSync(sibling, "keep");
    writeFileSync(otherTarget, "keep");

    expect(stageFilesToDisk(makePlan(), root).ok).toBe(true);

    expect(readFileSync(sibling, "utf8")).toBe("keep");
    expect(readFileSync(otherTarget, "utf8")).toBe("keep");
  });

  it("REGRESSION: staging into a directory that does not exist yet still succeeds", () => {
    expect(existsSync(join(root, "dist-npm"))).toBe(false);
    expect(stageFilesToDisk(makePlan(), root).ok).toBe(true);
  });
});
