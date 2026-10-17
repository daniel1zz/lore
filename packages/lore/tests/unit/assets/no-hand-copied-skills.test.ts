// @reads assets/skills/**
/**
 * Issue #218 guard: `assets/skills/<name>/` is the single source of a shipped
 * skill; `lore setup` renders the real copy. A git-tracked
 * `.claude/skills/<name>/...` for the same `<name>` is a hand-synced second copy
 * that no generator writes and no oracle compares, so it silently drifts.
 *
 * Exception: a rendered fragment skill dir whose SKILL.md carries a
 * `<!-- lore:managed` fingerprint line is generator output, not a hand copy.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "..");
const MANAGED_FINGERPRINT = "<!-- lore:managed";

/** Names of the directories directly under `assets/skills/`. */
function listAssetSkillNames(repoRoot: string): string[] {
  const dir = join(repoRoot, "assets", "skills");
  return readdirSync(dir).filter((entry) => statSync(join(dir, entry)).isDirectory());
}

/** True iff `<repoRoot>/.claude/skills/<name>/SKILL.md` exists with a managed fingerprint line. */
function isManagedRender(repoRoot: string, name: string): boolean {
  const skillMd = join(repoRoot, ".claude", "skills", name, "SKILL.md");
  if (!existsSync(skillMd)) return false;
  return readFileSync(skillMd, "utf8")
    .split("\n")
    .some((line) => line.includes(MANAGED_FINGERPRINT));
}

/**
 * Tracked paths under `.claude/skills/<name>/` where `<name>` is an assets skill
 * and the dir is not a managed render. pure over its inputs except `isManaged`.
 */
function findHandCopiedSkillPaths(
  trackedPaths: readonly string[],
  assetSkillNames: readonly string[],
  isManaged: (name: string) => boolean,
): string[] {
  const names = new Set(assetSkillNames);
  return trackedPaths.filter((path) => {
    const match = /^\.claude\/skills\/([^/]+)\//.exec(path);
    if (!match) return false;
    const name = match[1] as string;
    return names.has(name) && !isManaged(name);
  });
}

describe("no hand-copied shipped skills under .claude/skills (issue #218)", () => {
  it("scans a non-empty assets/skills name set (no vacuous pass)", () => {
    const names = listAssetSkillNames(REPO_ROOT);
    expect(names.length).toBeGreaterThan(0);
    expect(names).toContain("lore");
  });

  it("no git-tracked .claude/skills/<name>/ duplicates an assets/skills/<name>/ (unless a managed render)", () => {
    const tracked = execFileSync("git", ["ls-files", ".claude/skills"], { cwd: REPO_ROOT, encoding: "utf8" })
      .split("\n")
      .filter((line) => line !== "");
    const offenders = findHandCopiedSkillPaths(tracked, listAssetSkillNames(REPO_ROOT), (name) =>
      isManagedRender(REPO_ROOT, name),
    );
    expect(offenders).toEqual([]);
  });

  it("negative control: a tracked list containing .claude/skills/lore/SKILL.md is reported", () => {
    const offenders = findHandCopiedSkillPaths(
      [".claude/skills/lore/SKILL.md", ".claude/skills/not-a-shipped-skill/SKILL.md"],
      ["lore", "lore-plan"],
      () => false,
    );
    expect(offenders).toEqual([".claude/skills/lore/SKILL.md"]);
  });

  it("negative control: a managed render of the same name is exempt", () => {
    const offenders = findHandCopiedSkillPaths([".claude/skills/lore/SKILL.md"], ["lore"], () => true);
    expect(offenders).toEqual([]);
  });
});
