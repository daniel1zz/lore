// @spawns dist/lore
// @reads assets/context/*.md
// @reads scripts/render-repo-rules.ts
// @reads scripts/build.ts
/**
 * CL-6: the repo's rendered rules files (`.claude/rules/lore-*.md`) are a pure function of their
 * fragments — `scripts/render-repo-rules.ts` (called by `scripts/build.ts`) re-renders them through the
 * product renderer and overwrites a hand-edited file, naming it.
 *
 * Fixture: a throwaway repo (mkdtemp, `lore init`) carrying a copy of this repo's `assets/context`.
 * The repo's own `.lore/` and `.claude/` are never touched.
 *
 * Coverage:
 *   HAPPY:      first run renders every rules file; `lore fragments check` then exits 0.
 *   REGRESSION: control — a clean tree: a second run changes nothing (bytes identical, no rewrite reported).
 *   NEGATIVE:   a hand-edited rendered file is overwritten, named as "hand-edit discarded", equals the
 *               fresh render again, and `lore fragments check` exits 0 (red-first: before the script the
 *               renderer kept the file as diverged_skip and fragments check exited non-zero with rules_drift).
 *   ERROR:      a file the renderer cannot prove it owns (no managed header) is reported unowned, not deleted.
 *   STATE:      build.ts wires the script outside variant builds only.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { appendFileSync, cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { assertFreshBinary } from "./helpers/assert-fresh-binary";
import { FIXTURE_HOME_OUTSIDE_REPO } from "../helpers/clean-tree-repo";
import { renderRepoRules } from "../../../../scripts/render-repo-rules";

const PROJECT_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
const LORE_BIN = join(PROJECT_ROOT, "dist", "lore");
const RULES_DIR = join(".claude", "rules");
const TARGET = "lore-worktree-dispatch.md";

function lore(args: string[], cwd: string): { exitCode: number; out: string } {
  // reason: HOME must lie OUTSIDE the fixture repo. With HOME = the repo, the user scope's rules dir (`$HOME/.claude/rules`)
  // IS the project's `.claude/rules`, so every project rules file is reported "extra" versus the (empty) user selection.
  const proc = Bun.spawnSync([LORE_BIN, ...args], { cwd, env: { ...process.env, HOME: FIXTURE_HOME_OUTSIDE_REPO } });
  return { exitCode: proc.exitCode ?? 1, out: `${proc.stdout.toString()}${proc.stderr.toString()}` };
}

function snapshot(dir: string): Record<string, string> {
  const rules = join(dir, RULES_DIR);
  return Object.fromEntries(readdirSync(rules).sort().map((name) => [name, readFileSync(join(rules, name), "utf8")]));
}

describe("render-repo-rules — rules files are a pure function of their fragments (CL-6)", () => {
  let repo: string;

  beforeAll(() => {
    assertFreshBinary(LORE_BIN, [join(PROJECT_ROOT, "packages", "lore", "src"), join(PROJECT_ROOT, "packages", "core", "src")]);
  }, 30_000);

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "lore-render-rules-"));
    Bun.spawnSync(["git", "init", "-q"], { cwd: repo });
    const init = lore(["init", "--name", "fixture", "--author", "fixture"], repo);
    if (init.exitCode !== 0) throw new Error(`lore init failed: ${init.out}`);
    cpSync(join(PROJECT_ROOT, "assets", "context"), join(repo, "assets", "context"), { recursive: true });
  }, 60_000);

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it("HAPPY: first run renders the rules files and `lore fragments check` exits 0", async () => {
    const result = await renderRepoRules(repo);
    expect(result.unowned).toEqual([]);
    expect(result.rewritten.length).toBeGreaterThan(0);
    expect(existsSync(join(repo, RULES_DIR, TARGET))).toBe(true);
    const check = lore(["fragments", "check"], repo);
    expect(check.exitCode, check.out).toBe(0);
  }, 120_000);

  it("REGRESSION (control): a clean tree is left unchanged by a second run", async () => {
    await renderRepoRules(repo);
    const before = snapshot(repo);
    const second = await renderRepoRules(repo);
    expect(second.rewritten).toEqual([]);
    expect(second.unowned).toEqual([]);
    expect(snapshot(repo)).toEqual(before);
  }, 120_000);

  it("NEGATIVE (red-first): a hand-edited rendered file is overwritten, named, and fragments check exits 0", async () => {
    await renderRepoRules(repo);
    const before = snapshot(repo);
    appendFileSync(join(repo, RULES_DIR, TARGET), "\nHand-edited line that no fragment renders.\n");
    expect(lore(["fragments", "check"], repo).exitCode).not.toBe(0);

    const result = await renderRepoRules(repo);

    expect(result.rewritten).toEqual([{ path: join(RULES_DIR, TARGET), reason: "hand-edit discarded" }]);
    expect(result.unowned).toEqual([]);
    expect(snapshot(repo)).toEqual(before);
    expect(lore(["fragments", "check"], repo).exitCode).toBe(0);
  }, 120_000);

  it("ERROR: a lore-named file with no managed header is reported unowned and kept", async () => {
    await renderRepoRules(repo);
    const stray = join(repo, RULES_DIR, "lore-not-ours.md");
    writeFileSync(stray, "hand-written, no managed header\n");
    const result = await renderRepoRules(repo);
    expect(result.unowned).toContain(join(RULES_DIR, "lore-not-ours.md"));
    expect(readFileSync(stray, "utf8")).toBe("hand-written, no managed header\n");
  }, 120_000);

  it("STATE: build.ts invokes the script, guarded by the variant-build flag", () => {
    const build = readFileSync(join(PROJECT_ROOT, "scripts", "build.ts"), "utf8");
    expect(build).toMatch(/if \(!isVariantBuild\) \{[^}]*render-repo-rules\.ts/s);
  });
});
