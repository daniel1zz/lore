/**
 * Test helper: a throwaway repo + `lore init` corpus holding one baseline tree (root, branch, TWO leaves,
 * each with one rule), driven through the in-process CLI (`runLoreInProcess`), for the `lore baseline map
 * --sites-file` tests. Never touches the repository's own `.lore/`: the corpus lives under `mkdtemp` and is
 * asserted to be outside the repo root.
 * Side-effect class: IO (temp directory, corpus writes under it).
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runLoreInProcess } from "./run-lore-in-process";
import { sessionEnvFor } from "./session-actor";

const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");

export interface MapFixture {
  readonly dir: string;
  readonly home: string;
  /** Slug of the leaf the tests map sites on (carries rule `ownRule`). */
  readonly leaf: string;
  readonly ownRule: string;
  /** Rule id that exists only on the OTHER leaf. */
  readonly foreignRule: string;
  run(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }>;
  /** Write a sites file under the fixture and return its path. */
  sitesFile(name: string, content: string): string;
  /** The leaf's current `{version, site_map}` read through `lore get --json`. */
  leafState(): Promise<{ version: number; siteMap: Record<string, string[]> }>;
  dispose(): void;
}

function runGit(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
}

function slugOf(stdout: string): string {
  const m = stdout.match(/Slug:\s+(\S+)/) ?? stdout.match(/Created baseline \w+ (\S+) \(/);
  if (!m?.[1]) throw new Error(`no slug in: ${stdout}`);
  return m[1];
}

export async function buildMapFixture(): Promise<MapFixture> {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "bmb-repo-")));
  if (dir.startsWith(REPO_ROOT)) throw new Error("fixture must live outside the repo");
  const home = join(dir, ".home");
  mkdirSync(home, { recursive: true });
  runGit(dir, ["init", "-q", "-b", "main"]);
  runGit(dir, ["config", "user.email", "bmb@example.invalid"]);
  runGit(dir, ["config", "user.name", "bmb test"]);
  writeFileSync(join(dir, "README.md"), "fixture\n");
  runGit(dir, ["add", "."]);
  runGit(dir, ["commit", "-q", "-m", "init"]);
  const env = { ...process.env, HOME: home, ...sessionEnvFor("bmb") };
  const run = (args: string[]) => runLoreInProcess(args, { cwd: dir, home, env });
  const must = async (args: string[]): Promise<string> => {
    const r = await run(args);
    if (r.exitCode !== 0) throw new Error(`fixture \`lore ${args.join(" ")}\` failed (${r.exitCode}): ${r.stderr}${r.stdout}`);
    return r.stdout;
  };
  await must(["init"]);
  const prd = slugOf(await must(["create", "prd", "--title", "BMB PRD", "--content", "root", "--no-ai"]));
  const root = slugOf(await must(["baseline", "add", prd, "--node", "root", "--label", "root", "--title", "BMB Root"]));
  const branch = slugOf(await must(["baseline", "add", root, "--node", "branch", "--label", "br", "--title", "BMB Branch"]));
  const leaf = slugOf(await must(["baseline", "add", branch, "--node", "leaf", "--label", "lf", "--title", "BMB Leaf"]));
  const other = slugOf(await must(["baseline", "add", branch, "--node", "leaf", "--label", "lf2", "--title", "BMB Other Leaf"]));
  const ruleArgs = ["--confidence", "established", "--enforced-by", "guaranteed", "--example", "e"];
  const ruleId = (out: string): string => {
    const m = out.match(/\b(BR-\d+)\b/);
    if (!m?.[1]) throw new Error(`no rule id in: ${out}`);
    return m[1];
  };
  const ownRule = ruleId(await must(["rule", "add", leaf, "--statement", "own rule", ...ruleArgs]));
  const foreignRule = ruleId(await must(["rule", "add", other, "--statement", "foreign rule", ...ruleArgs]));
  if (ownRule === foreignRule) throw new Error("fixture needs distinct rule ids across leaves");
  return {
    dir,
    home,
    leaf,
    ownRule,
    foreignRule,
    run,
    sitesFile(name, content) {
      const p = join(dir, name);
      writeFileSync(p, content);
      return p;
    },
    async leafState() {
      const out = await must(["get", leaf, "--json"]);
      const parsed = JSON.parse(out) as Record<string, unknown>;
      const doc = (parsed["data"] as { doc: unknown }).doc as { version: number; extra?: { site_map?: Record<string, string[]> } };
      return { version: doc.version, siteMap: doc.extra?.site_map ?? {} };
    },
    dispose() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** `n` distinct site rows mapped to `rule`. */
export function rowsFor(n: number, rule: string): { site: string; rules: string[] }[] {
  return Array.from({ length: n }, (_, i) => ({ site: `src/f${i + 1}.ts#fn#E${i + 1}`, rules: [rule] }));
}
