// @spawns-external git initialises the throwaway repository (declared once here: every test that reaches this helper inherits it)
/**
 * Test helper: turns a throwaway directory into a git repository whose working tree stays CLEAN
 * however the `.lore/` corpus inside it is edited.
 *
 * Why it exists (SPEC-143 AC-CT-3): `lore init` arms state binding, so evidence captured on a dirty
 * tree (or outside any git repository) is unbound and refused by `lore done` / plan close. A fixture
 * that runs `lore init` in a bare tmp dir and then records evidence would therefore turn red for a
 * reason unrelated to its subject. The fix is to give the fixture a clean committed tree, not to weaken
 * the rule: the corpus directory is excluded through `.git/info/exclude` (a project that gitignores
 * its corpus), so later config edits and db writes never dirty the tree.
 *
 * Side-effect class: IO (spawns `git` inside `dir` only).
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Initialises `dir` as a git repository with one commit and `.lore/` excluded.
 *
 * @param dir - an existing, empty directory (never the repo's own checkout)
 */
export function makeCleanTreeRepo(dir: string): void {
  const run = (args: string[]): void => {
    execFileSync("git", args, { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
  };
  run(["init", "-q", "-b", "main"]);
  run(["config", "user.email", "fixture@example.invalid"]);
  run(["config", "user.name", "fixture"]);
  appendFileSync(join(dir, ".git", "info", "exclude"), ".lore/\n");
  writeFileSync(join(dir, "README.md"), "fixture\n");
  run(["add", "."]);
  run(["commit", "-q", "-m", "fixture base"]);
}

/**
 * A HOME for spawned `lore`/`bun` processes that lies OUTSIDE every fixture repository. Fixtures that
 * set `HOME: <fixture dir>` let bun write `Library/Caches/...` into the tree under test, which dirties
 * it and makes every captured pass unbound. Shared across fixtures in one tmp location; it still keeps
 * the spawned process away from the real `~/.claude`.
 */
export const FIXTURE_HOME_OUTSIDE_REPO = join(tmpdir(), "lore-fixture-home");
