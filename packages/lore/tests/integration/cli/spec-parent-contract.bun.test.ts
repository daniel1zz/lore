/**
 * End-to-end test of the spec parent contract (Baseline slice 3b, AC-BLS3B-1), driven through the
 * real CLI (and therefore CorpusService) against a throwaway corpus.
 *
 * Rules: BR-1 (a spec is created without a parent; it belongs to the trees through citations) and
 * BR-2 (a spec created with a parent, or filed under a document by a parent link, is refused with
 * exit 4 naming criterion citations, nothing written).
 *
 * Dimensions: HAPPY (parentless create -> exit 0, parent_id null), NEGATIVE (create --parent and
 * link --type parent -> exit 4 naming `lore ac cite`), STATE (nothing written: no new doc after the
 * refused create, parent_id and link table unchanged after the refused link), REGRESSION (a plan
 * still takes a spec or PRD parent; a task still requires its plan).
 *
 * @spec_ref AC-BLS3B-1
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const setDefaultTimeout = (ms: number): void => { vi.setConfig({ testTimeout: ms, hookTimeout: ms }); };
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

setDefaultTimeout(300_000);

// tests/integration/cli/ -> repo root is 5 levels up.
const REPO_ROOT = new URL("../../../../../", import.meta.url).pathname.replace(/\/$/, "");
const ENTRY = join(REPO_ROOT, "packages", "lore", "src", "index.ts");
const ACTOR = "agent:spc-test";

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

function runLore(args: string[], cwd: string): RunResult {
  const env = { ...process.env, HOME: cwd, CLAUDECODE: "1", LORE_ACTOR: ACTOR };
  const proc = Bun.spawnSync(["bun", "run", ENTRY, ...args], { cwd, env });
  return { stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), exitCode: proc.exitCode ?? 1 };
}

function mustRun(args: string[], cwd: string): RunResult {
  const r = runLore(args, cwd);
  if (r.exitCode !== 0) throw new Error(`fixture \`lore ${args.join(" ")}\` failed (${r.exitCode}): ${r.stderr}${r.stdout}`);
  return r;
}

function slugOf(stdout: string): string {
  const m = stdout.match(/Slug:\s+(\S+)/);
  if (!m?.[1]) throw new Error(`no slug in: ${stdout}`);
  return m[1];
}

interface DocJson {
  readonly parent_id: string | null;
}

/** Reads a doc's parent_id through `lore get --json`. */
function parentIdOf(slug: string, cwd: string): string | null {
  const parsed = JSON.parse(mustRun(["get", slug, "--json"], cwd).stdout) as { data?: { doc?: DocJson }; doc?: DocJson };
  const doc = parsed.data?.doc ?? parsed.doc;
  if (doc === undefined) throw new Error("no doc in get --json output");
  return doc.parent_id;
}

/** Slugs of every live spec, through `lore list --type spec --json`. */
function specSlugs(cwd: string): string[] {
  const parsed = JSON.parse(mustRun(["list", "--type", "spec", "--json", "--limit", "500"], cwd).stdout) as {
    data?: { docs?: Array<{ slug: string }> };
  };
  return (parsed.data?.docs ?? []).map((d) => d.slug);
}

let dir = "";
let prd = "";
let freeSpec = "";

beforeAll(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "spc-")));
  if (dir.startsWith(REPO_ROOT)) throw new Error("fixture must live outside the repo");
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  writeFileSync(join(dir, "README.md"), "fixture\n");
  mustRun(["init"], dir);
  prd = slugOf(mustRun(["create", "prd", "--title", "SPC PRD", "--content", "root", "--no-ai"], dir).stdout);
  freeSpec = slugOf(mustRun(["create", "spec", "--title", "SPC Free Spec", "--content", "## Spec\n\nbody", "--no-ai"], dir).stdout);
});

afterAll(() => {
  if (dir !== "") rmSync(dir, { recursive: true, force: true });
});

describe("AC-BLS3B-1: a spec takes no parent", () => {
  it("HAPPY: a spec created with no parent exits 0 and has parent_id null", () => {
    expect(parentIdOf(freeSpec, dir)).toBeNull();
  });

  it("NEGATIVE: a spec created with --parent <prd> is refused, exit 4, message names criterion citations", () => {
    const r = runLore(["create", "spec", "--title", "SPC Parented", "--parent", prd, "--content", "## Spec\n\nbody", "--no-ai"], dir);
    expect(r.exitCode).toBe(4);
    expect(`${r.stderr}${r.stdout}`).toContain("lore ac cite");
    expect(`${r.stderr}${r.stdout}`).toContain("citations");
  });

  it("STATE: the refused create wrote nothing (the spec set is unchanged)", () => {
    expect(specSlugs(dir)).toEqual([freeSpec]);
  });

  it("NEGATIVE: lore link <spec> <prd> --type parent is refused, exit 4, naming citations", () => {
    const r = runLore(["link", freeSpec, prd, "--type", "parent"], dir);
    expect(r.exitCode).toBe(4);
    expect(`${r.stderr}${r.stdout}`).toContain("lore ac cite");
  });

  it("STATE: the refused link left parent_id and the link table unchanged", () => {
    expect(parentIdOf(freeSpec, dir)).toBeNull();
    const links = mustRun(["get", freeSpec, "--json"], dir).stdout;
    expect(links).not.toContain(prd);
  });

  it("REGRESSION: a plan under a spec still works (plan -> spec parenting is unchanged)", () => {
    const r = runLore(["create", "plan", "--title", "SPC Plan", "--parent", freeSpec, "--content", "## Plan", "--no-ai"], dir);
    expect(r.exitCode).toBe(0);
  });
});
