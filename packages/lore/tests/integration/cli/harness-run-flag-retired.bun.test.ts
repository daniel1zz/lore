/**
 * @spec_ref spec-a-lore-call-s-run-identity-is-injected-per-bash-call-and#AC-RV-4
 * @task task-red-tests-export-prefix-ancestry-verification-refusal (RED; implementation lands in a later task of the same plan)
 *
 * `--harness-run` is retired: the CLI exits 2 naming the per-call value (LORE_HARNESS_RUN) and writes nothing; and no
 * file under the four trees (src, tests, assets, scripts) names the flag or its rewriter, except the retirement refusal
 * (packages/core/src/run-identity-node.ts) and this file.
 * @spawns packages/lore/src/index.ts
 * The scan uses the SAME grep as the AC command, so the test
 * and the command cannot disagree.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Database } from "bun:sqlite";

const REPO_ROOT = new URL("../../../../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(REPO_ROOT, "packages", "lore", "src", "index.ts");

let root: string;
let corpus: string;

function lore(args: string[]): { status: number; out: string } {
  const env: Record<string, string | undefined> = { ...process.env, HOME: join(root, "home"), XDG_CONFIG_HOME: join(root, "xdg"), EDITOR: "true", CLAUDECODE: "1", LORE_TEST_IDENTITY: "none" };
  delete env["LORE_HARNESS_RUN"];
  // reason: Bun.spawnSync, not node:child_process: the test run's spawn shims patch the node call twice under Bun.
  const proc = Bun.spawnSync(["bun", "run", INDEX_TS, ...args], { cwd: corpus, env: env as Record<string, string> });
  return { status: proc.exitCode ?? -1, out: `${proc.stdout.toString()}${proc.stderr.toString()}` };
}

function auditCount(): number {
  const db = new Database(join(corpus, ".lore", "lore.db"), { readonly: true });
  try {
    return (db.query("SELECT count(*) AS n FROM audit").get() as { n: number }).n;
  } finally {
    db.close();
  }
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "lore-flag-retired-"));
  mkdirSync(join(root, "home"), { recursive: true });
  corpus = join(root, "corpus");
  mkdirSync(corpus, { recursive: true });
  const init = lore(["init"]);
  if (init.status !== 0) throw new Error(`lore init failed: ${init.out}`);
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("AC-RV-4: --harness-run is retired", () => {
  it("`lore claim T --harness-run cc:S` exits 2 naming the per-call value and writes nothing", () => {
    const before = auditCount();
    const r = lore(["claim", "some-task", "--harness-run", "cc:S"]);
    expect(r.status).toBe(2);
    expect(r.out).toContain("LORE_HARNESS_RUN");
    expect(auditCount()).toBe(before);
  }, 120_000);

  it("`--harness-run=cc:S` (equals form) is refused the same way", () => {
    const r = lore(["claim", "some-task", "--harness-run=cc:S"]);
    expect(r.status).toBe(2);
    expect(r.out).toContain("LORE_HARNESS_RUN");
  }, 120_000);

  it("no file in src, tests, assets or scripts names the flag or its rewriter (all four trees are scanned)", () => {
    const grep = spawnSync(
      "grep",
      [
        "-rlE",
        "-e",
        "--harness-run|HARNESS_RUN_FLAG|stripHarnessRunFlag|rewriteBashCommand|function transform\\(",
        "packages/core/src",
        "packages/lore/src",
        "packages/dashboard/src",
        "packages/core/tests",
        "packages/lore/tests",
        "assets",
        "scripts",
      ],
      { cwd: REPO_ROOT, encoding: "utf8" },
    );
    const offenders = (grep.stdout ?? "")
      .split("\n")
      .filter((f) => f !== "")
      .filter((f) => f !== "packages/core/src/run-identity-node.ts" && !f.endsWith("harness-run-flag-retired.bun.test.ts"));
    expect(offenders).toEqual([]);
  }, 120_000);
});
