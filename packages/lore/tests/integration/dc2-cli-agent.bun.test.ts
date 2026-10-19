// @reads assets/**
/**
 * D28 — `lore agent` takes the name as `--name` on both subcommands and ends each error with its proper exit code
 * (duplicate 4, unknown 3, missing `--name` 2), over a throwaway corpus (never the repo's `.lore/`), through the
 * real CLI entry in-process.
 *
 * @spec_ref spec-defect-clusters-round-2-part-d-store-selection-runs
 */

import { afterAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { runLoreInProcess } from "../helpers/run-lore-in-process";

const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
const SPEC = "spec-defect-clusters-round-2-part-d-store-selection-runs";

interface Sandbox {
  readonly root: string;
  readonly corpus: string;
  readonly env: Record<string, string>;
}

const sandboxRoots: string[] = [];
afterAll(() => {
  for (const root of sandboxRoots) rmSync(root, { recursive: true, force: true });
});

async function lore(sb: Sandbox, ...args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = await runLoreInProcess(args, { cwd: sb.corpus, home: join(sb.root, "home"), env: sb.env });
  return { code: proc.exitCode, stdout: proc.stdout, stderr: proc.stderr };
}

/** Fresh lore project in a temp dir outside the repo. */
async function makeSandbox(): Promise<Sandbox> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "lore-dc2-agent-")));
  expect(root.startsWith(REPO_ROOT)).toBe(false);
  sandboxRoots.push(root);
  const home = join(root, "home");
  const corpus = join(root, "corpus");
  for (const d of [home, join(root, "xdg"), corpus]) mkdirSync(d, { recursive: true });
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  for (const k of ["CLAUDE_CONFIG_DIR", "LORE_CONFIG_HOME"]) delete env[k];
  env["HOME"] = home;
  env["XDG_CONFIG_HOME"] = join(root, "xdg");
  const sb: Sandbox = { root, corpus, env };
  const init = await lore(sb, "init");
  if (init.code !== 0) throw new Error(`harness: lore init failed: ${init.stderr}`);
  return sb;
}

describe("lore agent argument style and exit codes", () => {
  it(`${SPEC}#AC-DC2-28 duplicate create exits 4, unknown revoke exits 3 naming it, --name on both, positional exits 2`, async () => {
    const sb = await makeSandbox();

    const first = await lore(sb, "agent", "create", "--name", "dup");
    expect(first.code).toBe(0);

    // The green-but-broken case: a bare non-zero would pass while the duplicate exited 1.
    const dup = await lore(sb, "agent", "create", "--name", "dup");
    expect(dup.code).toBe(4);
    expect(dup.stderr).toContain("dup");

    const ghost = await lore(sb, "agent", "revoke", "--name", "ghost");
    expect(ghost.code).toBe(3);
    expect(ghost.stderr).toContain("ghost");

    const positional = await lore(sb, "agent", "revoke", "dup");
    expect(positional.code).toBe(2);
    expect(positional.stderr).toContain("--name");

    // The positional attempt must not have revoked anything: the --name form still succeeds.
    const revoke = await lore(sb, "agent", "revoke", "--name", "dup");
    expect(revoke.code).toBe(0);

    const missingCreate = await lore(sb, "agent", "create");
    expect(missingCreate.code).toBe(2);
  }, 120_000);
});
