// @spawns packages/lore/src/index.ts
// @reads packages/lore/src/service/site-census.ts
/**
 * AC-DC2-19 (D19): the site census records where it stops instead of dropping sites.
 *
 * (a) every positional token of `lore baseline sites` forms the command path; an unresolvable path exits 4.
 * (b) a 14-call chain ending in a refusal: the cut at MAX_CALL_DEPTH is ONE not_measured `depth-bound` site naming
 *     the function where the walk stopped, and `baseline coverage` for a leaf declaring that command is incomplete.
 * (c) a function first reached at depth 12 and again at depth 3 keeps its callees' sites (deep-first order forced).
 * (d) `deps.fn = other` after construction: a not_measured dynamic site for `deps.fn`.
 *
 * Every fixture lives in a mkdtemp directory outside the repo; the coverage corpus is a throwaway `lore init`.
 *
 * Coverage:
 *   HAPPY:      (a) nested path resolves; (c) shallow reach keeps its refusal sites
 *   NEGATIVE:   (a) extra token exits 4; (b) a 3-call chain records no depth-bound; (d) no assignment records no dynamic site
 *   BOUNDARY:   (b) chain of exactly MAX_CALL_DEPTH + 1 calls is cut, MAX_CALL_DEPTH calls is not
 *   REGRESSION: (c) shallow-first order gives the same answer as deep-first
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_CALL_DEPTH, listSites } from "../../src/service/site-census.js";
import { withSessionIdentity } from "../helpers/session-actor";

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

const SPEC = "spec-defect-clusters-round-2-part-c-criterion-data-demotion";
const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
const ENTRY = join(REPO_ROOT, "packages", "lore", "src", "index.ts");
const COMMANDS_DIR = "packages/lore/src/adapters/cli/commands";

const scratch: string[] = [];
// reason: HOME must be outside the repo - bun writes its cache under $HOME, and a spawn whose HOME is the repo root dirties the tree.
const SPAWN_HOME = realpathSync(mkdtempSync(join(tmpdir(), "dc2-19-home-")));
scratch.push(SPAWN_HOME);
afterAll(() => {
  for (const d of scratch) rmSync(d, { recursive: true, force: true });
});

function runLore(args: string[], cwd: string): { stdout: string; stderr: string; exitCode: number } {
  const env = withSessionIdentity({ ...process.env, HOME: SPAWN_HOME, CLAUDECODE: "1" }, "agent:dc2-19") as Record<string, string>;
  const proc = Bun.spawnSync(["bun", "run", ENTRY, ...args], { cwd, env });
  return { stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), exitCode: proc.exitCode ?? 1 };
}

function mustRun(args: string[], cwd: string): string {
  const r = runLore(args, cwd);
  if (r.exitCode !== 0) throw new Error(`fixture \`lore ${args.join(" ")}\` failed (${r.exitCode}): ${r.stderr}${r.stdout}`);
  return r.stdout;
}

/** A fixture census root: a mkdtemp dir holding `commands/<name>.ts` files under the layout `findCensusRoot` looks for. */
function fixtureRoot(files: Record<string, string>): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "dc2-19-")));
  scratch.push(root);
  mkdirSync(join(root, COMMANDS_DIR), { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(join(root, COMMANDS_DIR, `${name}.ts`), text);
  return root;
}

const PRELUDE = `
export function err(e: { code: string }) { return { ok: false as const, error: e }; }
function defineCommand<T>(c: T): T { return c; }
`;

/** `run -> c1 -> ... -> c<calls>` where the last function refuses; `calls` counts every call on the path. */
function chainSource(calls: number): string {
  const fns: string[] = [];
  for (let i = 1; i <= calls; i += 1) fns.push(i === calls ? `function c${i}() { return err({ code: "CHAIN_END" }); }` : `function c${i}() { return c${i + 1}(); }`);
  return `${PRELUDE}${fns.join("\n")}\nexport default defineCommand({ run() { return c1(); } });\n`;
}

const sitesOf = (root: string, name: string) => listSites({ rootDir: root, entry: { file: `${COMMANDS_DIR}/${name}.ts`, symbol: "default.run" } });

describe(`${SPEC}#AC-DC2-19 (a) every positional token forms the command path`, () => {
  it(`${SPEC}#AC-DC2-19 HAPPY: gate spec-create resolves to its entry symbol`, () => {
    const r = runLore(["baseline", "sites", "gate", "spec-create", "--json"], REPO_ROOT);
    expect(r.exitCode, r.stderr + r.stdout).toBe(0);
    const data = (JSON.parse(r.stdout) as { data: { command: string; entry: { file: string; symbol: string } } }).data;
    expect(data.command).toBe("gate spec-create");
    expect(data.entry.symbol).toBe("default.subCommands.spec-create.run");
  });

  it(`${SPEC}#AC-DC2-19 NEGATIVE: a third token that is no subcommand exits 4 naming the whole path`, () => {
    const r = runLore(["baseline", "sites", "gate", "spec-create", "extra"], REPO_ROOT);
    expect(r.exitCode, r.stderr + r.stdout).toBe(4);
    expect(r.stderr + r.stdout).toContain("gate spec-create extra");
  });
});

describe(`${SPEC}#AC-DC2-19 (b) a depth cut is recorded, not dropped`, () => {
  it(`${SPEC}#AC-DC2-19 a 14-call chain lists one depth-bound site naming the function where the walk stopped`, () => {
    const root = fixtureRoot({ chain: chainSource(14) });
    const cuts = sitesOf(root, "chain").filter((s) => s.kind === "depth-bound");
    expect(cuts).toHaveLength(1);
    expect(cuts[0]).toMatchObject({ dynamic: true, symbol: `c${MAX_CALL_DEPTH}` });
    expect(sitesOf(root, "chain").some((s) => s.code === "CHAIN_END")).toBe(false);
  });

  it(`${SPEC}#AC-DC2-19 BOUNDARY: a chain of exactly MAX_CALL_DEPTH calls is not cut; MAX_CALL_DEPTH + 1 is`, () => {
    // run -> c1 is depth 1; c<k> is walked at depth k; c<MAX> is the last body that fits, c<MAX+1> is the first one cut.
    const fits = fixtureRoot({ chain: chainSource(MAX_CALL_DEPTH) });
    expect(sitesOf(fits, "chain").filter((s) => s.kind === "depth-bound")).toHaveLength(0);
    expect(sitesOf(fits, "chain").some((s) => s.code === "CHAIN_END")).toBe(true);
    const cut = fixtureRoot({ chain: chainSource(MAX_CALL_DEPTH + 1) });
    expect(sitesOf(cut, "chain").filter((s) => s.kind === "depth-bound")).toHaveLength(1);
  });

  it(`${SPEC}#AC-DC2-19 NEGATIVE: a short chain records no depth-bound site`, () => {
    const root = fixtureRoot({ chain: chainSource(3) });
    const sites = sitesOf(root, "chain");
    expect(sites.filter((s) => s.kind === "depth-bound")).toHaveLength(0);
    expect(sites.some((s) => s.code === "CHAIN_END")).toBe(true);
  });

  it(`${SPEC}#AC-DC2-19 coverage for a leaf declaring the cut command is incomplete (exit 1)`, () => {
    const root = fixtureRoot({ chain: chainSource(14) });
    // reason: `baseline coverage` lists the runnable commands from the registry module before it censuses a leaf.
    writeFileSync(join(root, "packages/lore/src/adapters/cli/index.ts"), `export const COMMAND_LOADERS = { chain: () => import("./commands/chain.js") };\n`);
    mustRun(["init"], root);
    const prd = slugOf(mustRun(["create", "prd", "--title", "DC2-19 PRD", "--content", "root", "--no-ai"], root));
    const base = slugOf(mustRun(["baseline", "add", prd, "--node", "root", "--label", "root", "--title", "DC2-19 Root"], root));
    const branch = slugOf(mustRun(["baseline", "add", base, "--node", "branch", "--label", "br", "--title", "DC2-19 Branch"], root));
    const leaf = slugOf(mustRun(["baseline", "add", branch, "--node", "leaf", "--label", "lf", "--title", "DC2-19 Leaf"], root));
    mustRun(["baseline", "map", leaf, "--command", "chain"], root);
    const r = runLore(["baseline", "coverage", leaf, "--json"], root);
    expect(r.exitCode, r.stderr + r.stdout).toBe(1);
    expect(r.stdout).toContain("depth-bound");
  }, 300_000);
});

describe(`${SPEC}#AC-DC2-19 (c) a deep first visit does not hide the shallow one`, () => {
  /** `shared` is reached at depth MAX (through a chain of MAX-1 hops) AND directly from run at depth 1; its callee refuses. */
  function sharedSource(deepFirst: boolean): string {
    const hops: string[] = [];
    for (let i = 1; i < MAX_CALL_DEPTH; i += 1) hops.push(i === MAX_CALL_DEPTH - 1 ? `function d${i}() { return shared(); }` : `function d${i}() { return d${i + 1}(); }`);
    const body = deepFirst ? "d1(); return shared();" : "shared(); return d1();";
    return `${PRELUDE}
function refuses() { return err({ code: "SHARED_CALLEE" }); }
function shared() { return refuses(); }
${hops.join("\n")}
export default defineCommand({ run() { ${body} } });
`;
  }

  it(`${SPEC}#AC-DC2-19 deep-first order lists the callee's refusal and records no cut`, () => {
    const sites = sitesOf(fixtureRoot({ shared: sharedSource(true) }), "shared");
    expect(sites.some((s) => s.code === "SHARED_CALLEE")).toBe(true);
    expect(sites.filter((s) => s.kind === "depth-bound")).toHaveLength(0);
  });

  it(`${SPEC}#AC-DC2-19 REGRESSION: shallow-first order gives the same answer`, () => {
    const sites = sitesOf(fixtureRoot({ shared: sharedSource(false) }), "shared");
    expect(sites.some((s) => s.code === "SHARED_CALLEE")).toBe(true);
    expect(sites.filter((s) => s.kind === "depth-bound")).toHaveLength(0);
  });

  it(`${SPEC}#AC-DC2-19 a function reached ONLY at the bound records the cut for its callee`, () => {
    const hops: string[] = [];
    for (let i = 1; i < MAX_CALL_DEPTH; i += 1) hops.push(i === MAX_CALL_DEPTH - 1 ? `function d${i}() { return shared(); }` : `function d${i}() { return d${i + 1}(); }`);
    const source = `${PRELUDE}
function refuses() { return err({ code: "SHARED_CALLEE" }); }
function shared() { return refuses(); }
${hops.join("\n")}
export default defineCommand({ run() { return d1(); } });
`;
    const sites = sitesOf(fixtureRoot({ only: source }), "only");
    expect(sites.filter((s) => s.kind === "depth-bound")).toHaveLength(1);
    expect(sites.some((s) => s.code === "SHARED_CALLEE")).toBe(false);
  });
});

describe(`${SPEC}#AC-DC2-19 (d) an unmodelled binding is recorded not_measured`, () => {
  const source = (assign: boolean): string => `${PRELUDE}
interface Deps { fn: () => unknown }
class Svc { constructor(private readonly deps: Deps) {} go() { return this.deps.fn(); } }
function original() { return err({ code: "ORIGINAL" }); }
function other() { return err({ code: "OTHER" }); }
export default defineCommand({
  run() {
    const deps: Deps = { fn: original };
    const svc = new Svc(deps);
    ${assign ? "deps.fn = other;" : ""}
    return svc.go();
  },
});
`;

  it(`${SPEC}#AC-DC2-19 deps.fn = other after construction records a dynamic site for deps.fn`, () => {
    const sites = sitesOf(fixtureRoot({ inj: source(true) }), "inj");
    const dynamic = sites.filter((s) => s.dynamic);
    expect(dynamic.map((s) => s.key).some((k) => k.includes("deps.fn"))).toBe(true);
    expect(sites.map((s) => s.code)).toEqual(expect.arrayContaining(["ORIGINAL", "OTHER"]));
  });

  it(`${SPEC}#AC-DC2-19 NEGATIVE control: without the assignment the single binding is followed and nothing is dynamic`, () => {
    const sites = sitesOf(fixtureRoot({ inj: source(false) }), "inj");
    expect(sites.filter((s) => s.dynamic)).toHaveLength(0);
    expect(sites.map((s) => s.code)).toEqual(["ORIGINAL"]);
  });

  it(`${SPEC}#AC-DC2-19 a spread into the typed literal records a dynamic site`, () => {
    const spreadSource = `${PRELUDE}
interface Deps { fn: () => unknown }
class Svc { constructor(private readonly deps: Deps) {} go() { return this.deps.fn(); } }
function original() { return err({ code: "ORIGINAL" }); }
export default defineCommand({
  run() {
    const base = JSON.parse("{}");
    const svc = new Svc({ fn: original, ...base });
    return svc.go();
  },
});
`;
    const sites = sitesOf(fixtureRoot({ inj: spreadSource }), "inj");
    expect(sites.filter((s) => s.dynamic).map((s) => s.key).some((k) => k.includes("deps.fn"))).toBe(true);
  });
});

function slugOf(stdout: string): string {
  const m = stdout.match(/Slug:\s+(\S+)/) ?? stdout.match(/Created baseline \w+ (\S+) \(/);
  if (!m?.[1]) throw new Error(`no slug in: ${stdout}`);
  return m[1];
}
