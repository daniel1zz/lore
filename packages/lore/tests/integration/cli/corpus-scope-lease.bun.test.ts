// @spawns packages/lore/src/index.ts
/**
 * RED test for claim-scoped corpus authoring (Baseline slice 2a, component C8).
 *
 * Spec: spec-baseline-slice-2-completeness-census-per-branch-citation.
 *
 * Behaviour under test: `lore claim <task> --worktree <wt> --corpus-scope <branch>`
 * declares on the claim lease that the worktree session may write baseline docs
 * UNDER that one branch into the main checkout's corpus. Everything else a
 * worktree session writes into the main corpus stays refused with the
 * foreign-corpus-write token (`gate:corpus-write:foreign-provenance`).
 *
 * Never touches the repo's own `.lore/`: every fixture is a mkdtemp git repo
 * with its own `lore init` corpus, asserted to live outside the repo root.
 * The CLI is driven via `bun run packages/lore/src/index.ts` (no dist build).
 *
 * Coverage:
 *   CONTROL:  main-checkout rule add succeeds (proves the harness works)
 *   HAPPY:    scoped worktree session adds a rule on a leaf of branch X; the
 *             write lands and the version log carries the claiming actor
 *   NEGATIVE: leaf of branch Y refused; non-baseline doc refused; unscoped
 *             worktree session refused (all with the foreign-write token)
 *   STATE:    two scoped sessions on two leaves of X in parallel both land
 *             with distinct actors
 *   HAPPY:    scoped `ac cite` and `baseline map` accepted inside scope
 *
 * @spec_ref AC-BLS2-8
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const setDefaultTimeout = (ms: number): void => { vi.setConfig({ testTimeout: ms, hookTimeout: ms }); };
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sessionActorFor, withSessionIdentity } from "../../helpers/session-actor";
import { patchLoreConfig } from "../../helpers/patch-lore-config.js";

setDefaultTimeout(180_000);

// tests/integration/cli/ -> repo root is 5 levels up.
const REPO_ROOT = new URL("../../../../../", import.meta.url).pathname.replace(/\/$/, "");
const ENTRY = join(REPO_ROOT, "packages", "lore", "src", "index.ts");
const FOREIGN_TOKEN = "gate:corpus-write:foreign-provenance";

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** `actor` is a fixture LABEL: the spawn runs under the session identity `sessionIdFor(actor)` (no `--by`, BR-1055); `undefined` = unnamed. */
function spawnEnv(cwd: string, actor?: string): Record<string, string | undefined> {
  return withSessionIdentity({ ...process.env, HOME: cwd, CLAUDECODE: "1" }, actor ?? null);
}

function runLore(args: string[], cwd: string, actor?: string): RunResult {
  const proc = Bun.spawnSync(["bun", "run", ENTRY, ...args], { cwd, env: spawnEnv(cwd, actor) as Record<string, string> });
  return { stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), exitCode: proc.exitCode ?? 1 };
}

async function runLoreAsync(args: string[], cwd: string, actor?: string): Promise<RunResult> {
  const proc = Bun.spawn(["bun", "run", ENTRY, ...args], {
    cwd,
    env: spawnEnv(cwd, actor) as Record<string, string>,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

function mustRun(args: string[], cwd: string, actor?: string): RunResult {
  const r = runLore(args, cwd, actor);
  if (r.exitCode !== 0) {
    throw new Error(`fixture \`lore ${args.join(" ")}\` failed (${r.exitCode}): ${r.stderr}${r.stdout}`);
  }
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

const RULE_ARGS = (statement: string): string[] => [
  "--statement",
  statement,
  "--confidence",
  "established",
  "--enforced-by",
  "guaranteed",
  "--example",
  "example one",
];

interface Fixture {
  readonly repo: string;
  readonly worktrees: string;
  readonly leafX1: string;
  readonly leafX2: string;
  readonly leafY: string;
  readonly branchX: string;
  readonly branchY: string;
  readonly spec: string;
  readonly plan: string;
  readonly knowledge: string;
  readonly tasks: string[];
}

let scratch: string[] = [];
let fx: Fixture;

function buildFixture(): Fixture {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), "csl-repo-")));
  const worktrees = realpathSync(mkdtempSync(join(tmpdir(), "csl-wt-")));
  scratch.push(repo, worktrees);
  if (repo.startsWith(REPO_ROOT)) throw new Error("fixture must live outside the repo");

  git(repo, ["init", "-q", "-b", "main"]);
  git(repo, ["config", "user.email", "csl@example.invalid"]);
  git(repo, ["config", "user.name", "csl test"]);
  writeFileSync(join(repo, "README.md"), "fixture\n");
  git(repo, ["add", "."]);
  git(repo, ["commit", "-q", "-m", "init"]);

  mustRun(["init"], repo);
  patchLoreConfig(
    repo,
    [
      "workflow:",
      "  gates:",
      "    spec-create:",
      "      enabled: false",
      "    spec-promote:",
      "      enabled: false",
      "    plan-promote:",
      "      enabled: false",
      "    task-claim:",
      "      enabled: false",
      "",
    ].join("\n"),
  );

  const prd = slugOf(mustRun(["create", "prd", "--title", "CSL PRD", "--content", "root", "--no-ai"], repo).stdout);
  const root = slugOf(
    mustRun(["baseline", "add", prd, "--node", "root", "--label", "root", "--title", "CSL Root"], repo).stdout,
  );
  const branchX = slugOf(
    mustRun(["baseline", "add", root, "--node", "branch", "--label", "bx", "--title", "CSL Branch X"], repo).stdout,
  );
  const branchY = slugOf(
    mustRun(["baseline", "add", root, "--node", "branch", "--label", "by", "--title", "CSL Branch Y"], repo).stdout,
  );
  const leafX1 = slugOf(
    mustRun(["baseline", "add", branchX, "--node", "leaf", "--label", "lx1", "--title", "CSL Leaf X1"], repo).stdout,
  );
  const leafX2 = slugOf(
    mustRun(["baseline", "add", branchX, "--node", "leaf", "--label", "lx2", "--title", "CSL Leaf X2"], repo).stdout,
  );
  const leafY = slugOf(
    mustRun(["baseline", "add", branchY, "--node", "leaf", "--label", "ly", "--title", "CSL Leaf Y"], repo).stdout,
  );

  const plan = slugOf(
    mustRun(["create", "plan", "--title", "CSL Plan", "--parent", prd, "--content", "x", "--no-ai"], repo).stdout,
  );
  const spec = slugOf(
    mustRun(["create", "spec", "--title", "CSL Spec","--content", "x", "--no-ai"], repo).stdout,
  );
  mustRun(
    ["ac", "add", spec, "AC-CSL-1", "--statement", "something holds", "--mode", "human"],
    repo,
  );
  const knowledge = slugOf(
    mustRun(["create", "knowledge", "--title", "CSL Knowledge", "--sub-type", "reference", "--content", "k", "--no-ai"], repo).stdout,
  );

  const tasks: string[] = [];
  for (const n of ["a", "b", "c"]) {
    tasks.push(
      slugOf(
        mustRun(
          [
            "create",
            "task",
            "--title",
            `CSL Task ${n}`,
            "--parent",
            plan,
            "--plan-id",
            plan,
            "--content",
            "x",
            "--no-ai",
          ],
          repo,
        ).stdout,
      ),
    );
  }
  return { repo, worktrees, leafX1, leafX2, leafY, branchX, branchY, spec, plan, knowledge, tasks };
}

/** Adds a git worktree and claims `task` from it; returns the worktree path. */
function claimFromWorktree(name: string, task: string, actor: string, scope: string | undefined): {
  readonly wt: string;
  readonly claim: RunResult;
} {
  const wt = join(fx.worktrees, name);
  git(fx.repo, ["worktree", "add", "-q", "-b", `csl-${name}`, wt]);
  const claim = runLore(
    [
      "claim",
      task,
      "--worktree",
      wt,
      ...(scope !== undefined ? ["--corpus-scope", scope] : []),
    ],
    wt,
    actor,
  );
  return { wt, claim };
}

beforeAll(() => {
  fx = buildFixture();
});

afterAll(() => {
  for (const d of scratch) rmSync(d, { recursive: true, force: true });
  scratch = [];
});

describe("claim-scoped corpus authoring from a worktree (AC-BLS2-8)", () => {
  it("CONTROL: a rule add from the main checkout itself succeeds (harness works)", () => {
    const r = runLore(["rule", "add", fx.leafX1, ...RULE_ARGS("control rule from main checkout")], fx.repo, "agent:csl-control");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/BR-\d+/);
  });

  it("HAPPY: claim --corpus-scope <branch X> is accepted and recorded on the lease", () => {
    const { claim } = claimFromWorktree("scoped-claim", fx.tasks[0]!, "agent:csl-claim", fx.branchX);
    expect(claim.stderr).not.toMatch(/unknown (flag|option)|unrecognized/i);
    expect(claim.exitCode).toBe(0);
    const doc = (JSON.parse(mustRun(["get", fx.tasks[0]!, "--json"], fx.repo).stdout) as {
      data: { doc: { extra: { claim?: { corpus_scope?: unknown } } } };
    }).data.doc;
    expect(JSON.stringify(doc.extra.claim?.corpus_scope ?? null)).toContain(fx.branchX);
  });

  it("HAPPY: scoped session adds a rule on a leaf of branch X; it lands with the claiming actor in the version log", () => {
    const actor = "agent:csl-writer-x";
    const { wt, claim } = claimFromWorktree("scoped-x", fx.tasks[1]!, actor, fx.branchX);
    expect(claim.exitCode).toBe(0);
    const add = runLore(["rule", "add", fx.leafX1, ...RULE_ARGS("scoped worktree rule on X leaf")], wt, actor);
    expect(add.stderr).not.toContain(FOREIGN_TOKEN);
    expect(add.exitCode).toBe(0);
    const log = mustRun(["log", fx.leafX1], fx.repo).stdout;
    expect(log).toContain(sessionActorFor(actor));
  });

  it("NEGATIVE: scoped session writing a leaf of branch Y is refused with the foreign-corpus-write token", () => {
    const actor = "agent:csl-writer-y";
    const { wt, claim } = claimFromWorktree("scoped-y", fx.tasks[2]!, actor, fx.branchX);
    expect(claim.exitCode).toBe(0);
    const add = runLore(["rule", "add", fx.leafY, ...RULE_ARGS("must not land on Y")], wt, actor);
    expect(add.exitCode).not.toBe(0);
    expect(add.stderr + add.stdout).toContain(FOREIGN_TOKEN);
  });

  it("NEGATIVE: scoped session writing a non-baseline doc is refused with the foreign-corpus-write token", () => {
    const actor = "agent:csl-writer-nb";
    const wt = join(fx.worktrees, "scoped-y");
    const set = runLore(["set", fx.knowledge, "--content", "tampered from scoped worktree"], wt, actor);
    expect(set.exitCode).not.toBe(0);
    expect(set.stderr + set.stdout).toContain(FOREIGN_TOKEN);
  });

  it("NEGATIVE: worktree session claimed WITHOUT corpus scope adding a rule is refused", () => {
    const actor = "agent:csl-unscoped";
    const taskSlug = slugOf(
      mustRun(
        ["create", "task", "--title", "CSL Task unscoped", "--parent", fx.plan, "--plan-id", fx.plan, "--content", "x", "--no-ai"],
        fx.repo,
      ).stdout,
    );
    const { wt, claim } = claimFromWorktree("unscoped", taskSlug, actor, undefined);
    expect(claim.exitCode).toBe(0);
    const add = runLore(["rule", "add", fx.leafX2, ...RULE_ARGS("unscoped must be refused")], wt, actor);
    expect(add.exitCode).not.toBe(0);
    expect(add.stderr + add.stdout).toContain(FOREIGN_TOKEN);
  });

  it("STATE: two scoped sessions on two leaves of X in parallel both land with distinct actors", async () => {
    const mk = (n: string) =>
      slugOf(
        mustRun(
          ["create", "task", "--title", `CSL Task par ${n}`, "--parent", fx.plan, "--plan-id", fx.plan, "--content", "x", "--no-ai"],
          fx.repo,
        ).stdout,
      );
    const actorA = "agent:csl-par-a";
    const actorB = "agent:csl-par-b";
    const a = claimFromWorktree("par-a", mk("a"), actorA, fx.branchX);
    const b = claimFromWorktree("par-b", mk("b"), actorB, fx.branchX);
    expect(a.claim.exitCode).toBe(0);
    expect(b.claim.exitCode).toBe(0);
    const [ra, rb] = await Promise.all([
      runLoreAsync(["rule", "add", fx.leafX1, ...RULE_ARGS("parallel rule A")], a.wt, actorA),
      runLoreAsync(["rule", "add", fx.leafX2, ...RULE_ARGS("parallel rule B")], b.wt, actorB),
    ]);
    expect(ra.exitCode).toBe(0);
    expect(rb.exitCode).toBe(0);
    expect(mustRun(["log", fx.leafX1], fx.repo).stdout).toContain(sessionActorFor(actorA));
    expect(mustRun(["log", fx.leafX2], fx.repo).stdout).toContain(sessionActorFor(actorB));
    expect(mustRun(["log", fx.leafX2], fx.repo).stdout).not.toContain(sessionActorFor(actorA));
  });

  it("HAPPY: scoped `lore ac cite` of an in-scope rule is accepted from the worktree", () => {
    const actor = "agent:csl-cite";
    const wt = join(fx.worktrees, "scoped-x");
    const ruleId = mustRun(["rule", "add", fx.leafX1, ...RULE_ARGS("rule to cite")], fx.repo, "agent:csl-main").stdout.match(
      /BR-\d+/,
    )?.[0];
    expect(ruleId).toBeDefined();
    const cite = runLore(["ac", "cite", fx.spec, "AC-CSL-1", ruleId!], wt);
    expect(cite.stderr).not.toContain(FOREIGN_TOKEN);
    expect(cite.exitCode).toBe(0);
    void actor;
  });

  it("HAPPY: scoped `lore baseline map` inside scope is accepted (command must exist)", () => {
    const wt = join(fx.worktrees, "scoped-x");
    const map = runLore(["baseline", "map", fx.leafX1], wt);
    expect(map.stderr).not.toMatch(/unknown command|not a command|unrecognized/i);
    expect(map.stderr).not.toContain(FOREIGN_TOKEN);
    expect(map.exitCode).toBe(0);
  });
});
