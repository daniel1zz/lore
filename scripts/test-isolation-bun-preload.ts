/**
 * Bun half of the test-run marker (task-skill-implement-tg-4, AC-TG-2).
 *
 * Purpose: verify the LORE_TEST_SANDBOX guard is armed for `bun test` from packages/lore.
 * Why verify, not just set: under bun, children spawned WITHOUT an explicit `env`
 * (node:child_process spawnSync/execFileSync AND Bun.spawnSync) inherit the STARTUP
 * environment, not later `process.env` mutations — so the marker must already be in the
 * startup env. `packages/lore/.env.test` (auto-loaded by `bun test`) supplies it; this preload
 * FAILS LOUD when it is absent or untrustworthy.
 *
 * Consistency rule for LORE_TEST_SANDBOX_REPO (the protected repository):
 *   1. LORE_TEST_SANDBOX must be "1";
 *   2. REPO must be set and absolute;
 *   3. REPO must be a lore checkout — it contains `scripts/test-isolation-setup.ts` and
 *      `packages/lore/bunfig.toml`.
 * REPO is NOT required to equal this file's own checkout: a nested run (the falsifier runs
 * `bun test` inside a scratch worktree under $TMPDIR) legitimately inherits the OUTER repo as
 * the protected one, and bun's .env.test does not override an existing variable. The inherited
 * value is kept (normalised), never replaced by this checkout's root — replacing it would
 * un-protect the outer repo. The wrong-`${PWD}` mistake (`bun test` started outside
 * packages/lore) still fails loud: `${PWD}/../..` then lands on a directory that is not a lore
 * checkout (the repo's parent, `packages/`, a stray directory), so rule 3 rejects it.
 *
 * Side-effect class: stateful (normalises LORE_TEST_SANDBOX_REPO in process.env); throws on violation.
 */
import { existsSync, realpathSync } from "node:fs";
import { isAbsolute, join } from "node:path";

const marker = process.env["LORE_TEST_SANDBOX"];
const repo = process.env["LORE_TEST_SANDBOX_REPO"];

if (marker !== "1") {
  throw new Error(
    `test-isolation-bun-preload: LORE_TEST_SANDBOX is ${JSON.stringify(marker ?? null)} in the bun startup ` +
      `environment, expected "1". packages/lore/.env.test must be loaded (run \`bun test\` with cwd packages/lore) — ` +
      `without it spawned children would run unguarded against this repository's corpus.`,
  );
}
if (repo === undefined || repo === "" || !isAbsolute(repo)) {
  throw new Error(
    `test-isolation-bun-preload: LORE_TEST_SANDBOX_REPO is ${JSON.stringify(repo ?? null)}; it must be an absolute path ` +
      `to the protected lore checkout. packages/lore/.env.test derives it from \${PWD}; run \`bun test\` from packages/lore.`,
  );
}
const isLoreCheckout =
  existsSync(join(repo, "scripts", "test-isolation-setup.ts")) && existsSync(join(repo, "packages", "lore", "bunfig.toml"));
if (!isLoreCheckout) {
  throw new Error(
    `test-isolation-bun-preload: LORE_TEST_SANDBOX_REPO=${JSON.stringify(repo)} is not a lore checkout (no ` +
      `scripts/test-isolation-setup.ts and packages/lore/bunfig.toml). Most likely \`bun test\` was started from a directory ` +
      `other than packages/lore, so \${PWD}/../.. in packages/lore/.env.test points elsewhere.`,
  );
}
process.env["LORE_TEST_SANDBOX_REPO"] = realpathSync(repo);
