// @spawns-external git commits the miniature checkout (declared once here: every test that reaches this helper inherits it)
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
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { saveConfig } from "@lore/core/node";
import { SQLiteStore } from "../../src/store/sqlite-store";
import { actedStore } from "../live-invocation";
import { pendingCountOf } from "../../src/service/baseline-pending";
import { approvePending } from "./approve-baseline";
import { runLoreInProcess } from "./run-lore-in-process";
import { templatedFieldsArgs } from "./templated-create";
import { sessionEnvFor } from "./session-actor";

const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");

/** Directory of the CLI sources inside the mini checkout (the census root finder looks for `<it>/commands`). */
export const MINI_CLI = "packages/lore/src/adapters/cli";

export interface MiniCorpus {
  readonly dir: string;
  readonly root: string;
  /** The branch node leaves A and B sit under; new leaves are added beneath it. */
  readonly branch: string;
  readonly leafA: string;
  readonly leafB: string;
  run(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }>;
  /** `run` without the auto-approval of a write verb's pending revision: for a test whose subject is the pending state. */
  runRaw(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }>;
  /** Approve every pending revision of the given nodes (a node a test adds after build is draft, its rules pending). */
  approve(...nodes: string[]): Promise<void>;
  /** Write (or overwrite) a source file of the mini checkout; `rel` is relative to the checkout root. */
  writeSource(rel: string, content: string): void;
  /** Census site keys of a registry command (`lore baseline sites <command> --json`). */
  sitesOf(command: string): Promise<string[]>;
  /** The rule id each fixture leaf (A and B) carries from build time. */
  readonly ruleOf: ReadonlyMap<string, string>;
  /** Declare the leaf's own rule at one coded census site, in the site's source file (`rule: "BR-n"` on the refusal literal). */
  mapSite(leaf: string, siteKey: string): Promise<void>;
  /** Declare the leaf's own rule at every coded census site of `command` (a site's rule lives in code, never in the corpus). */
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
  "package.json": JSON.stringify({ name: "mini-checkout", private: true, scripts: { install: "true", build: "true", typecheck: "true" } }),
};

export async function buildMiniCorpus(opts: { autoApprove?: boolean; requireCreate?: boolean } = {}): Promise<MiniCorpus> {
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
  // the AI behind `lore review` is a shell-script test double that always approves (a review is the first half of an approval)
  const aiScript = join(dir, "fake-ai.sh");
  writeFileSync(
    aiScript,
    `#!/bin/sh\ncat > /dev/null\ncat <<'JSONEOF'\n${JSON.stringify({ decision: "approve", confidence: 0.9, reasons: [{ dimension: "completeness", finding: "fine" }], blocking_questions: [] })}\nJSONEOF\n`,
    { mode: 0o755 },
  );
  saveConfig(dir, {
    project: { name: "bcr-mini", author: "tester" },
    ai: { provider: "claude-cli", providers: { "claude-cli": { command: aiScript, args: [], timeout_ms: 5000 } }, templates: {}, telemetry: false },
    ...(opts.requireCreate === true ? { workflow: { structured_documents: { require_create: true } } } : {}),
  } as never);
  const prd = slugOf(await must(["create", "prd", "--title", "BCR PRD", "--no-ai", ...templatedFieldsArgs("prd")]));
  const root = slugOf(await must(["baseline", "add", prd, "--node", "root", "--label", "root", "--title", "BCR Root", ...templatedFieldsArgs("baseline", { kind: "root" })]));
  const branch = slugOf(await must(["baseline", "add", root, "--node", "branch", "--label", "br", "--title", "BCR Branch", ...templatedFieldsArgs("baseline", { kind: "branch" })]));
  const leafA = slugOf(await must(["baseline", "add", branch, "--node", "leaf", "--label", "la", "--title", "BCR Leaf A", ...templatedFieldsArgs("baseline", { kind: "leaf" })]));
  const leafB = slugOf(await must(["baseline", "add", branch, "--node", "leaf", "--label", "lb", "--title", "BCR Leaf B", ...templatedFieldsArgs("baseline", { kind: "leaf" })]));
  const ruleArgs = ["--confidence", "established", "--enforced-by", "guaranteed", "--example", "fixture example"];
  const ruleOf = new Map<string, string>();
  for (const leaf of [leafA, leafB]) {
    const out = await must(["rule", "add", leaf, "--statement", `Fixture rule of ${leaf} holds`, ...ruleArgs]);
    const id = out.match(/BR-\d+/)?.[0];
    if (id === undefined) throw new Error(`no rule id in: ${out}`);
    ruleOf.set(leaf, id);
  }
  await must(["baseline", "map", leafA, "--command", "alpha"]);
  await must(["baseline", "map", leafB, "--command", "beta"]);
  // reason: a direct rule add and a command declaration are PENDING revisions (BR-626/BR-628) and a new node is born draft;
  // the coverage tests measure an APPROVED tree, so every node is approved through a bare ReviewService (no AI judge).
  const approve = async (...nodes: string[]): Promise<void> => {
    const side = actedStore(new SQLiteStore(join(dir, ".lore", "lore.db")));
    try {
      for (const node of nodes) await approvePending(side, node);
    } finally {
      side.close();
    }
  };
  await approve(root, branch, leafA, leafB);
  // reason: the tests below keep writing through the CLI (`baseline map`, `rule add|set`, `baseline add`) and measure the tree as
  // an approved one, so a successful write verb is followed by approving whatever it left pending (`autoApprove: false` keeps
  // the pending state for a test whose subject is approval).
  const approveAllPending = async (): Promise<void> => {
    const side = actedStore(new SQLiteStore(join(dir, ".lore", "lore.db")));
    try {
      const nodes = await side.findMany({ type: "baseline" });
      if (!nodes.ok) throw new Error(`fixture listing failed: ${JSON.stringify(nodes.error)}`);
      for (const node of nodes.value) if (pendingCountOf(node.extra) > 0) await approvePending(side, node.id);
    } finally {
      side.close();
    }
  };
  const WRITE_VERBS = new Set(["baseline add", "baseline map", "baseline set-label", "baseline depends", "baseline glossary", "rule add", "rule set"]);
  const runApproving = async (args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> => {
    const result = await run(args);
    if (result.exitCode === 0 && WRITE_VERBS.has(`${args[0]} ${args[1]}`)) await approveAllPending();
    return result;
  };
  const sitesOf = async (command: string): Promise<string[]> => {
    const parsed = JSON.parse(await must(["baseline", "sites", command, "--json"])) as { data: { sites: { key: string }[] } };
    return parsed.data.sites.map((s) => s.key);
  };
  const mapSite = async (leaf: string, siteKey: string): Promise<void> => {
    const rule = ruleOf.get(leaf);
    if (rule === undefined) throw new Error(`mapSite: leaf ${leaf} has no fixture rule`);
    const [file, , code] = siteKey.split("#");
    if (file === undefined || code === undefined) throw new Error(`mapSite: not a coded site key: ${siteKey}`);
    const path = join(dir, file);
    const before = readFileSync(path, "utf8");
    const literal = `{ code: "${code}" }`;
    if (!before.includes(literal)) throw new Error(`mapSite: ${file} has no refusal literal ${literal}`);
    writeFileSync(path, before.replace(literal, `{ code: "${code}", rule: "${rule}" }`));
  };
  return {
    dir,
    root,
    branch,
    leafA,
    leafB,
    ruleOf,
    run: opts.autoApprove === false ? run : runApproving,
    runRaw: run,
    approve,
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
