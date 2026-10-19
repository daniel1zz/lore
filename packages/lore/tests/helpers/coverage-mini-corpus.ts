/**
 * Test helper: a throwaway lore source checkout in miniature plus a baseline corpus over it, for the root-coverage
 * tests (AC-BCR-2..4). The checkout holds a CLI command registry (`COMMAND_LOADERS`) with two commands, `alpha` and
 * `beta`, each reaching one failure site; one baseline tree (root, branch, leaf A declaring `alpha`, leaf B declaring
 * `beta`) is created through the in-process CLI. Nothing touches the repository's own `.lore/`: everything lives
 * under `mkdtemp`, asserted to be outside the repo root.
 *
 * Public surface: {@link buildMiniCorpus}, {@link MiniCorpus}, {@link MINI_CLI}.
 * Side-effect class: IO (temp directory, source files and corpus writes under it).
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runLoreInProcess } from "./run-lore-in-process";
import { sessionEnvFor } from "./session-actor";

const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");

/** Directory of the CLI sources inside the mini checkout (the census root finder looks for `<it>/commands`). */
export const MINI_CLI = "packages/lore/src/adapters/cli";

export interface MiniCorpus {
  readonly dir: string;
  readonly root: string;
  readonly leafA: string;
  readonly leafB: string;
  run(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }>;
  /** Write (or overwrite) a source file of the mini checkout; `rel` is relative to the checkout root. */
  writeSource(rel: string, content: string): void;
  /** Census site keys of a registry command (`lore baseline sites <command> --json`). */
  sitesOf(command: string): Promise<string[]>;
  /** Account for one site on a leaf with a `non-business` justification. */
  mapSite(leaf: string, siteKey: string): Promise<void>;
  /** Account for every census site of `command` on `leaf`. */
  mapAllSites(leaf: string, command: string): Promise<void>;
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

/** The mini checkout: a registry of two commands, each reaching one failure site through its own library file. */
const MINI_SOURCES: Readonly<Record<string, string>> = {
  [`${MINI_CLI}/index.ts`]: `export const COMMAND_LOADERS = {
  alpha: () => import("./commands/alpha.js"),
  beta: () => import("./commands/beta.js"),
};
`,
  [`${MINI_CLI}/lib/result.ts`]: `export const err = (e: { code: string }) => ({ ok: false as const, code: e.code });\n`,
  [`${MINI_CLI}/lib/shared.ts`]: `import { err } from "./result.js";\nexport function checkShared() {\n  return err({ code: "ALPHA_BAD" });\n}\n`,
  [`${MINI_CLI}/lib/other.ts`]: `import { err } from "./result.js";\nexport function checkOther() {\n  return err({ code: "BETA_BAD" });\n}\n`,
  [`${MINI_CLI}/commands/alpha.ts`]: `import { checkShared } from "../lib/shared.js";\nexport default { run() { return checkShared(); } };\n`,
  [`${MINI_CLI}/commands/beta.ts`]: `import { checkOther } from "../lib/other.js";\nexport default { run() { return checkOther(); } };\n`,
  "package.json": JSON.stringify({ name: "mini-checkout", private: true }),
};

export async function buildMiniCorpus(): Promise<MiniCorpus> {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "bcr-mini-")));
  if (dir.startsWith(REPO_ROOT)) throw new Error("fixture must live outside the repo");
  const home = join(dir, ".home");
  mkdirSync(home, { recursive: true });
  const writeSource = (rel: string, content: string): void => {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), content);
  };
  for (const [rel, content] of Object.entries(MINI_SOURCES)) writeSource(rel, content);
  runGit(dir, ["init", "-q", "-b", "main"]);
  runGit(dir, ["config", "user.email", "bcr@example.invalid"]);
  runGit(dir, ["config", "user.name", "bcr test"]);
  runGit(dir, ["add", "."]);
  runGit(dir, ["commit", "-q", "-m", "init"]);
  const env = { ...process.env, HOME: home, ...sessionEnvFor("bcr") };
  const run = (args: string[]) => runLoreInProcess(args, { cwd: dir, home, env });
  const must = async (args: string[]): Promise<string> => {
    const r = await run(args);
    if (r.exitCode !== 0) throw new Error(`fixture \`lore ${args.join(" ")}\` failed (${r.exitCode}): ${r.stderr}${r.stdout}`);
    return r.stdout;
  };
  await must(["init"]);
  const prd = slugOf(await must(["create", "prd", "--title", "BCR PRD", "--content", "root", "--no-ai"]));
  const root = slugOf(await must(["baseline", "add", prd, "--node", "root", "--label", "root", "--title", "BCR Root"]));
  const branch = slugOf(await must(["baseline", "add", root, "--node", "branch", "--label", "br", "--title", "BCR Branch"]));
  const leafA = slugOf(await must(["baseline", "add", branch, "--node", "leaf", "--label", "la", "--title", "BCR Leaf A"]));
  const leafB = slugOf(await must(["baseline", "add", branch, "--node", "leaf", "--label", "lb", "--title", "BCR Leaf B"]));
  await must(["baseline", "map", leafA, "--command", "alpha"]);
  await must(["baseline", "map", leafB, "--command", "beta"]);
  const sitesOf = async (command: string): Promise<string[]> => {
    const parsed = JSON.parse(await must(["baseline", "sites", command, "--json"])) as { data: { sites: { key: string }[] } };
    return parsed.data.sites.map((s) => s.key);
  };
  const mapSite = async (leaf: string, siteKey: string): Promise<void> => {
    await must(["baseline", "map", leaf, "--site", siteKey, "--non-business", "fixture site, accounted for"]);
  };
  return {
    dir,
    root,
    leafA,
    leafB,
    run,
    writeSource,
    sitesOf,
    mapSite,
    async mapAllSites(leaf, command) {
      for (const key of await sitesOf(command)) await mapSite(leaf, key);
    },
    dispose() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
