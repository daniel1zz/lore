/**
 * `lore baseline tree` rule counts on every rule-holding node (issue #125, BR-674, AC-BLC-6), over a throwaway corpus.
 *
 * BR-674: a node that holds rules (business leaf, architecture standard, architecture debt-registry) shows
 * `[rules: live N / deprecated N / retired N]`; a node that holds none (root, branch, section, module-card)
 * shows no counts. `--json` carries the same tallies in `rules`.
 *
 * Dimensions: HAPPY (standard + debt-registry counts), NEGATIVE (section / module-card / roots show none),
 * STATE (a deprecated rule moves from live to deprecated), REGRESSION (business leaf line unchanged).
 * The repo's own `.lore/` is never touched; the corpus is an `mkdtemp` outside the repo.
 *
 * @spec_ref AC-BLC-6
 */

import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

setDefaultTimeout(300_000);

const REPO_ROOT = new URL("../../../../../", import.meta.url).pathname.replace(/\/$/, "");
const ENTRY = join(REPO_ROOT, "packages", "lore", "src", "index.ts");
const ACTOR = "agent:tree-counts-test";
const RULE = ["--confidence", "established", "--enforced-by", "guaranteed", "--example", "e.g. one"];
const FOUR_PARTS = ["--current-reality", "r", "--target-rule", "t", "--migration", "m", "--current-exceptions-none"];

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

function runLore(args: string[]): RunResult {
  const env = { ...process.env, HOME: dir, CLAUDECODE: "1", LORE_ACTOR: ACTOR };
  const proc = Bun.spawnSync(["bun", "run", ENTRY, ...args], { cwd: dir, env });
  return { stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), exitCode: proc.exitCode ?? 1 };
}

function mustRun(args: string[]): RunResult {
  const r = runLore(args);
  if (r.exitCode !== 0) throw new Error(`fixture \`lore ${args.join(" ")}\` failed (${r.exitCode}): ${r.stderr}${r.stdout}`);
  return r;
}

function slugOf(stdout: string): string {
  const m = stdout.match(/Slug:\s+(\S+)/) ?? stdout.match(/Created baseline [\w-]+ (\S+) \(/);
  if (!m?.[1]) throw new Error(`no slug in: ${stdout}`);
  return m[1];
}

function archAdd(parent: string, node: string, label: string, title: string): string {
  return slugOf(mustRun(["baseline", "add", parent, "--tree", "architecture", "--node", node, "--label", label, "--title", title]).stdout);
}

/** The single text row of `lore baseline tree` that names `slug`. */
function rowOf(slug: string): string {
  const row = mustRun(["baseline", "tree"]).stdout.split("\n").find((line) => line.includes(`(${slug},`));
  if (row === undefined) throw new Error(`no tree row for ${slug}`);
  return row;
}

let dir = "";
let businessLeaf = "";
let businessRoot = "";
let archRoot = "";
let section = "";
let moduleCard = "";
let standard = "";
let debtRegistry = "";

beforeAll(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "treecounts-")));
  if (dir.startsWith(REPO_ROOT)) throw new Error("fixture must live outside the repo");
  const git = (args: string[]): void => void execFileSync("git", args, { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "tc@example.invalid"]);
  git(["config", "user.name", "tree counts"]);
  writeFileSync(join(dir, "README.md"), "fixture\n");
  git(["add", "."]);
  git(["commit", "-q", "-m", "init"]);
  mustRun(["init"]);
  const prd = slugOf(mustRun(["create", "prd", "--title", "Counts PRD", "--content", "root", "--no-ai"]).stdout);
  businessRoot = slugOf(mustRun(["baseline", "add", prd, "--node", "root", "--label", "biz", "--title", "Biz Root"]).stdout);
  businessLeaf = slugOf(mustRun(["baseline", "add", businessRoot, "--node", "leaf", "--label", "l", "--title", "Biz Leaf"]).stdout);
  archRoot = archAdd(prd, "root", "arch", "Arch Root");
  section = archAdd(archRoot, "section", "svc", "Service Layer");
  moduleCard = archAdd(section, "module-card", "mod", "Module Card");
  standard = archAdd(section, "standard", "std", "Result Standard");
  debtRegistry = archAdd(section, "debt-registry", "debt", "Debt Registry");
  mustRun(["rule", "add", debtRegistry, "--statement", "Legacy throw A", ...RULE]);
  mustRun(["rule", "add", debtRegistry, "--statement", "Legacy throw B", ...RULE]);
  mustRun(["rule", "add", standard, "--statement", "Services return Result", ...RULE, ...FOUR_PARTS]);
  mustRun(["rule", "add", businessLeaf, "--statement", "Business rule", ...RULE]);
});

afterAll(() => {
  if (dir !== "") rmSync(dir, { recursive: true, force: true });
});

describe("lore baseline tree rule counts (AC-BLC-6, BR-674)", () => {
  it("HAPPY: a standard row shows its live/deprecated/retired counts", () => {
    expect(rowOf(standard)).toContain("[rules: live 1 / deprecated 0 / retired 0]");
  });

  it("HAPPY: a debt-registry row shows its live/deprecated/retired counts", () => {
    expect(rowOf(debtRegistry)).toContain("[rules: live 2 / deprecated 0 / retired 0]");
  });

  it("NEGATIVE: section, module-card and both roots show no counts", () => {
    for (const slug of [section, moduleCard, archRoot, businessRoot]) {
      expect(rowOf(slug)).not.toContain("[rules:");
    }
  });

  it("REGRESSION: a business leaf row keeps its counts", () => {
    expect(rowOf(businessLeaf)).toContain("[rules: live 1 / deprecated 0 / retired 0]");
  });

  it("STATE: retiring a debt entry moves it from live to retired in the row (no rule enters deprecated since D4)", () => {
    mustRun(["rule", "set", "AD-2", "--lifecycle", "retired", "--note", "paid down"]);
    expect(rowOf(debtRegistry)).toContain("[rules: live 1 / deprecated 0 / retired 1]");
  });

  it("--json entries carry the same tallies for standard and debt-registry", () => {
    const entries = (JSON.parse(mustRun(["baseline", "tree", "--json"]).stdout) as {
      data: { slug: string; rules: { live: number; deprecated: number; retired: number } }[];
    }).data;
    const bySlug = new Map(entries.map((e) => [e.slug, e.rules]));
    expect(bySlug.get(standard)).toEqual({ live: 1, deprecated: 0, retired: 0 });
    expect(bySlug.get(debtRegistry)).toEqual({ live: 1, deprecated: 0, retired: 1 });
    expect(bySlug.get(section)).toEqual({ live: 0, deprecated: 0, retired: 0 });
  });
});
