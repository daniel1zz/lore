// @spawns packages/lore/src/index.ts
// @spawns scripts/check-baseline-coverage.ts
// @reads assets/project/reference-transaction
/**
 * AC-BCR-5 oracle: `lore integrate` refuses to advance main while a runnable command of the MERGED tree is declared by no leaf
 * (spec-baseline-coverage-refuses-only-undeclared-commands-a-site; BR-660, BR-1248).
 *
 * A throwaway repo (the mini lore checkout of coverage-mini-corpus: two registry commands, each declared by one leaf, every
 * site accounted for) with its own throwaway corpus; REAL `lore integrate` processes, REAL git worktrees; the floor command
 * is the real `scripts/check-baseline-coverage.ts` step, run in the integration worktree against the corpus snapshot. The
 * repo's own `.lore/` is never read or written.
 *
 *   - control (not vacuous): a branch that adds no failure site and no command integrates (exit 0, main advances);
 *   - a branch whose merged tree reaches a new, unmapped site integrates (exit 0, main advances): a site is report output;
 *   - a branch adding a runnable command no leaf declares: exit 1, the command and its fix line named, main unchanged.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { claimBranchTask } from "../helpers/claim-branch-task";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { buildMiniCorpus, MINI_CLI, type MiniCorpus } from "../helpers/coverage-mini-corpus";
import { sessionEnvFor } from "../helpers/session-actor";
import { installShippedGuard } from "./support/main-guard-repo.js";

const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(REPO_ROOT, "packages", "lore", "src", "index.ts");
const STEP_TS = join(REPO_ROOT, "scripts", "check-baseline-coverage.ts");

interface RunResult {
  readonly out: string;
  readonly exitCode: number;
}

let mini: MiniCorpus;

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: mini.dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function writeFile(rel: string, content: string): void {
  mkdirSync(dirname(join(mini.dir, rel)), { recursive: true });
  writeFileSync(join(mini.dir, rel), content);
}

/** A branch off main whose single commit writes `files`; the checkout goes back to a detached main. */
function makeBranch(name: string, files: Record<string, string>): string {
  git(["checkout", "-q", "-b", name, "main"]);
  for (const [rel, content] of Object.entries(files)) writeFile(rel, content);
  git(["add", "-A"]);
  git(["commit", "-q", "-m", `work on ${name}`]);
  git(["checkout", "-q", "--detach", "main"]);
  // BR-1348: integrate refuses a branch no task belongs to
  claimBranchTask((args) => {
    const r = spawnSync("bun", ["run", INDEX_TS, ...args], {
      cwd: mini.dir,
      encoding: "utf8",
      env: { ...process.env, HOME: join(mini.dir, ".home"), EDITOR: "true", CLAUDECODE: "1", ...sessionEnvFor("claim") },
    });
    return { status: r.status ?? 1, out: `${r.stdout}${r.stderr}` };
  }, mini.dir, name);
  return name;
}

function integrate(branch: string, session: string): Promise<RunResult> {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: join(mini.dir, ".home"), EDITOR: "true", CLAUDECODE: "1", ...sessionEnvFor(session) };
  return new Promise((resolve) => {
    const child = spawn("bun", ["run", INDEX_TS, "integrate", branch, "--session", session], { cwd: mini.dir, env });
    let out = "";
    child.stdout.on("data", (c: Buffer) => (out += c.toString()));
    child.stderr.on("data", (c: Buffer) => (out += c.toString()));
    child.on("close", (code) => resolve({ out, exitCode: code ?? 1 }));
  });
}

beforeAll(async () => {
  mini = await buildMiniCorpus();
  // the corpus is local state, not a tracked file (the throwaway repo's own `.lore/` is excluded like the real one)
  appendFileSync(join(mini.dir, ".git", "info", "exclude"), ".lore/\n.claude/\n.home/\n");
  // every site of both commands is accounted for: main starts with complete root coverage
  await mini.mapAllSites(mini.leafA, "alpha");
  await mini.mapAllSites(mini.leafB, "beta");
  git(["checkout", "-q", "--detach", "main"]);
  installShippedGuard(mini.dir, `${mini.dir}-guard-hooks`); // integrate requires the guard (BR-1273)
  const cfg = join(mini.dir, ".lore", "config.yaml");
  const base = readFileSync(cfg, "utf8").split("\nworkflow:")[0] ?? "";
  writeFileSync(cfg, `${base.trimEnd()}\nworkflow:\n  integrate:\n    floor_command: ${JSON.stringify(`bun run ${STEP_TS}`)}\n`);
}, 240_000);

afterAll(() => mini?.dispose());

describe("AC-BCR-5 integrate refuses only while a runnable command is undeclared", () => {
  it("control: a branch that adds no failure site and no command lands (exit 0, main advances)", async () => {
    const branch = makeBranch("adds-nothing", { "notes.txt": "nothing the census sees\n" });
    const before = git(["rev-parse", "main"]);

    const r = await integrate(branch, "bcr-control");

    expect(r.exitCode, r.out).toBe(0);
    expect(git(["rev-parse", "main"])).not.toBe(before);
    expect(git(["merge-base", "--is-ancestor", branch, "main"])).toBe("");
  }, 240_000);

  it("a branch whose merged tree reaches a new unmapped site still lands: sites are report output, the floor never names a gap", async () => {
    const branch = makeBranch("new-site", {
      [`${MINI_CLI}/lib/shared.ts`]: `import { err } from "./result.js";\nexport function checkShared() {\n  if (Math.random() > 2) return err({ code: "ALPHA_NEW" });\n  return err({ code: "ALPHA_BAD" });\n}\n`,
    });
    const before = git(["rev-parse", "main"]);

    const landed = await integrate(branch, "bcr-site");

    expect(landed.exitCode, landed.out).toBe(0);
    expect(git(["rev-parse", "main"])).not.toBe(before);
    expect(git(["merge-base", "--is-ancestor", branch, "main"])).toBe("");
    expect(landed.out).not.toMatch(/^\s*gap\s/m);
  }, 480_000);

  it("simplest failing case: a branch adding a runnable command no leaf declares is refused, command and fix named, main unchanged", async () => {
    const branch = makeBranch("new-command", {
      [`${MINI_CLI}/index.ts`]: `export const COMMAND_LOADERS = {\n  alpha: () => import("./commands/alpha.js"),\n  beta: () => import("./commands/beta.js"),\n  gamma: () => import("./commands/gamma.js"),\n};\n`,
      [`${MINI_CLI}/commands/gamma.ts`]: `import { checkOther } from "../lib/other.js";\nexport default { run() { return checkOther(); } };\n`,
    });
    const before = git(["rev-parse", "main"]);

    const r = await integrate(branch, "bcr-cmd");

    expect(r.exitCode, r.out).toBe(1);
    expect(git(["rev-parse", "main"])).toBe(before);
    expect(r.out).toMatch(/undeclared\s+gamma/);
    expect(r.out).toContain("fix: lore baseline map <leaf> --command gamma");
  }, 240_000);
});
