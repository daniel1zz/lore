// @spawns packages/lore/src/index.ts
/**
 * The one write route honours claim-scoped corpus authoring (task-skill-fix-the-one-write-route-honours-claim-scoped-corpus).
 *
 * Regression from DCL-3: rule-service writes (`lore baseline map --sites-file`, rule add/set, rule move) went through
 * `CorpusService.writeDoc`, whose foreign-corpus refusal ignored the caller's claim lease, so a worktree implementer who
 * claimed with `--worktree <abs> --corpus-scope <branch>` was refused on a REAL write while the no-change
 * `lore baseline map <leaf>` still reported "authorized". The route now takes ITS decision from
 * `CorpusWriteAuthority.decide` — the very call the authorization report makes.
 *
 * Every fixture is a mkdtemp git repo with its own `lore init` corpus (never the repo's `.lore/`), driven through the
 * real CLI (`bun run packages/lore/src/index.ts`) from a real linked worktree, so the corpus the write resolves is the
 * main checkout's (provenance `git_common_dir`).
 *
 * Coverage:
 *   HAPPY:      scoped lease -> `baseline map --sites-file` from the worktree exits 0 and lands exactly ONE version
 *   NEGATIVE:   no scoped lease -> the same write exits 4 with gate:corpus-write:foreign-provenance, nothing lands
 *   STATE:      the no-change authorization report and the real write AGREE, in both cases
 *   BOUNDARY:   a scoped lease on ANOTHER branch refuses the write (scope covers only its own subtree)
 *   REGRESSION: the main checkout's own write is untouched
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withSessionIdentity } from "../helpers/session-actor";

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

// tests/integration/ -> repo root is 4 levels up.
const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
const ENTRY = join(REPO_ROOT, "packages", "lore", "src", "index.ts");
const FOREIGN_TOKEN = "gate:corpus-write:foreign-provenance";

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

function runLore(args: string[], cwd: string, actor?: string): RunResult {
  const env = withSessionIdentity({ ...process.env, HOME: cwd, CLAUDECODE: "1" }, actor ?? null) as Record<string, string>;
  const proc = Bun.spawnSync(["bun", "run", ENTRY, ...args], { cwd, env });
  return { stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), exitCode: proc.exitCode ?? 1 };
}

function mustRun(args: string[], cwd: string, actor?: string): RunResult {
  const r = runLore(args, cwd, actor);
  if (r.exitCode !== 0) throw new Error(`fixture \`lore ${args.join(" ")}\` failed (${r.exitCode}): ${r.stderr}${r.stdout}`);
  return r;
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" }).trim();
}

function slugOf(stdout: string): string {
  const m = stdout.match(/Slug:\s+(\S+)/) ?? stdout.match(/Created baseline \w+ (\S+) \(/);
  if (!m?.[1]) throw new Error(`no slug in: ${stdout}`);
  return m[1];
}

interface Fixture {
  readonly repo: string;
  readonly worktrees: string;
  readonly branchX: string;
  readonly branchY: string;
  readonly leafX: string;
  readonly ruleId: string;
  readonly plan: string;
  readonly sitesFile: string;
}

const scratch: string[] = [];
let fx: Fixture;

function buildFixture(): Fixture {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), "wrc-repo-")));
  const worktrees = realpathSync(mkdtempSync(join(tmpdir(), "wrc-wt-")));
  scratch.push(repo, worktrees);
  if (repo.startsWith(REPO_ROOT)) throw new Error("fixture must live outside the repo");

  git(repo, ["init", "-q", "-b", "main"]);
  git(repo, ["config", "user.email", "wrc@example.invalid"]);
  git(repo, ["config", "user.name", "wrc test"]);
  writeFileSync(join(repo, "README.md"), "fixture\n");
  git(repo, ["add", "."]);
  git(repo, ["commit", "-q", "-m", "init"]);

  mustRun(["init"], repo);
  appendFileSync(
    join(repo, ".lore", "config.yaml"),
    ["workflow:", "  gates:", "    plan-promote:", "      enabled: false", "    task-claim:", "      enabled: false", ""].join("\n"),
  );

  const prd = slugOf(mustRun(["create", "prd", "--title", "WRC PRD", "--content", "root", "--no-ai"], repo).stdout);
  const root = slugOf(mustRun(["baseline", "add", prd, "--node", "root", "--label", "root", "--title", "WRC Root"], repo).stdout);
  const branchX = slugOf(mustRun(["baseline", "add", root, "--node", "branch", "--label", "bx", "--title", "WRC Branch X"], repo).stdout);
  const branchY = slugOf(mustRun(["baseline", "add", root, "--node", "branch", "--label", "by", "--title", "WRC Branch Y"], repo).stdout);
  const leafX = slugOf(mustRun(["baseline", "add", branchX, "--node", "leaf", "--label", "lx", "--title", "WRC Leaf X"], repo).stdout);
  const ruleOut = mustRun(
    ["rule", "add", leafX, "--statement", "A mapped site is accounted for.", "--confidence", "established", "--enforced-by", "guaranteed", "--example", "map writes a version"],
    repo,
  );
  const ruleId = ruleOut.stdout.match(/BR-\d+/)?.[0];
  if (ruleId === undefined) throw new Error(`no rule id in: ${ruleOut.stdout}`);
  const plan = slugOf(mustRun(["create", "plan", "--title", "WRC Plan", "--parent", prd, "--content", "x", "--no-ai"], repo).stdout);

  const sitesFile = join(worktrees, "rows.json");
  writeFileSync(sitesFile, JSON.stringify([{ site: "x.ts#fn#CODE", rules: [ruleId] }]));
  return { repo, worktrees, branchX, branchY, leafX, ruleId, plan, sitesFile };
}

let taskCounter = 0;

/** A fresh task claimed from a fresh linked worktree; `scope` undefined = a lease WITHOUT corpus scope. */
function claimFromWorktree(name: string, actor: string, scope: string | undefined): string {
  taskCounter += 1;
  const task = slugOf(
    mustRun(
      ["create", "task", "--title", `WRC Task ${name} ${taskCounter}`, "--parent", fx.plan, "--plan-id", fx.plan, "--content", "x", "--no-ai"],
      fx.repo,
    ).stdout,
  );
  const wt = join(fx.worktrees, name);
  git(fx.repo, ["worktree", "add", "-q", "-b", `wrc-${name}`, wt]);
  const claim = runLore(["claim", task, "--worktree", wt, ...(scope !== undefined ? ["--corpus-scope", scope] : [])], wt, actor);
  expect(claim.exitCode, claim.stderr + claim.stdout).toBe(0);
  return wt;
}

function leafVersion(): number {
  const doc = (JSON.parse(mustRun(["get", fx.leafX, "--json"], fx.repo).stdout) as { data: { doc: { version: number } } }).data.doc;
  return doc.version;
}

beforeAll(() => {
  fx = buildFixture();
});

afterAll(() => {
  for (const d of scratch) rmSync(d, { recursive: true, force: true });
});

describe("the one write route honours claim-scoped corpus authoring", () => {
  it("HAPPY + STATE: a scoped lease lets `baseline map --sites-file` write from the worktree, and the report agreed", () => {
    const actor = "agent:wrc-scoped";
    const wt = claimFromWorktree("scoped", actor, fx.branchX);
    const before = leafVersion();

    const report = runLore(["baseline", "map", fx.leafX], wt, actor);
    expect(report.exitCode, report.stderr + report.stdout).toBe(0);
    expect(report.stderr + report.stdout).not.toContain(FOREIGN_TOKEN);

    const write = runLore(["baseline", "map", fx.leafX, "--sites-file", fx.sitesFile], wt, actor);
    expect(write.stderr).not.toContain(FOREIGN_TOKEN);
    expect(write.exitCode, write.stderr + write.stdout).toBe(0);
    expect(leafVersion()).toBe(before + 1);
  });

  it("NEGATIVE + STATE: with no scoped lease the report and the write are BOTH refused with the foreign-write token (exit 4)", () => {
    const actor = "agent:wrc-unscoped";
    const wt = claimFromWorktree("unscoped", actor, undefined);
    const before = leafVersion();

    const report = runLore(["baseline", "map", fx.leafX], wt, actor);
    expect(report.exitCode).toBe(4);
    expect(report.stderr + report.stdout).toContain(FOREIGN_TOKEN);

    const write = runLore(["baseline", "map", fx.leafX, "--sites-file", fx.sitesFile], wt, actor);
    expect(write.exitCode).toBe(4);
    expect(write.stderr + write.stdout).toContain(FOREIGN_TOKEN);
    expect(leafVersion()).toBe(before);
  });

  it("BOUNDARY: a lease scoped to ANOTHER branch refuses the write, and the report says so too", () => {
    const actor = "agent:wrc-other-branch";
    const wt = claimFromWorktree("other-branch", actor, fx.branchY);
    const before = leafVersion();

    const report = runLore(["baseline", "map", fx.leafX], wt, actor);
    expect(report.exitCode).toBe(4);
    const write = runLore(["baseline", "map", fx.leafX, "--sites-file", fx.sitesFile], wt, actor);
    expect(write.exitCode).toBe(4);
    expect(write.stderr + write.stdout).toContain(FOREIGN_TOKEN);
    expect(leafVersion()).toBe(before);
  });

  it("REGRESSION: the main checkout's own `baseline map --sites-file` is untouched by the scope logic", () => {
    const before = leafVersion();
    const write = runLore(["baseline", "map", fx.leafX, "--site", "y.ts#fn#CODE", "--rule", fx.ruleId], fx.repo, "agent:wrc-main");
    expect(write.exitCode, write.stderr + write.stdout).toBe(0);
    expect(leafVersion()).toBe(before + 1);
  });
});
