// @spawns packages/lore/src/index.ts
/**
 * AC-AU-11 oracle — worktree removal goes through decide() and never loses ignored data.
 *
 * Every half drives the REAL CLI (`bun run src/index.ts`) against a THROWAWAY git repo + corpus (`mkdtemp` +
 * `git init` + `lore init`, cwd and HOME inside the temp tree) — never this repo's own `.lore/` or worktrees. Decisions
 * are read back from the corpus DB's `decision_log` (bun:sqlite, readonly) and the chain is checked through
 * `lore status --check-decision-log`. Exit codes are exact equalities, not truthiness.
 *
 * Halves (spec AC-AU-11): (1) clean merged worktree whose only ignored path is node_modules/ -> removed, one auto
 * worktree-remove record; (2) same with an ignored .env -> kept, escalated, .env named, file intact; (3) `lore verify
 * --falsify` on a run that fails mid-way (green control red) leaves no lore-attested-red-* worktree registered or on
 * disk, and its cleanup is an auto worktree-remove record; (4) `sweep --apply` removes a registered orphan
 * lore-attested-red-* worktree of an ended run.
 * Controls: dry run changes and records nothing; a scratch whose owner pid is alive is kept; a scratch with an ignored
 * .env is kept and named; a falsify run whose command wrote an ignored .env into the scratch keeps it (escalated);
 * `lore done`'s path (evaluateRecordedWorktree) keeps a worktree the gate refuses and removes one it allows.
 *
 * @spec_ref AC-AU-11
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Database } from "bun:sqlite";
import { evaluateRecordedWorktree, type WorktreeGitProbe } from "../../src/service/worktree-cleanup.js";
import type { WorktreeRemovalFacts } from "../../src/service/worktree-removal-test.js";

const PACKAGE_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");
const GIT_ID = ["-c", "user.email=lore-test@example.com", "-c", "user.name=Lore Test"] as const;

interface Run {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

interface DecisionRow {
  readonly class: string;
  readonly subject_id: string;
  readonly verdict: string;
  readonly facts: string;
  readonly channel: string;
}

let parent = "";
let repo = "";
let privateTmp = "";

function lore(args: string[], cwd = repo, env: Record<string, string> = {}): Run {
  const r = spawnSync("bun", ["run", INDEX_TS, ...args], {
    cwd,
    env: { ...process.env, HOME: parent, EDITOR: "true", CLAUDECODE: "1", ...env },
    encoding: "utf8",
  });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", exitCode: r.status ?? 1 };
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", [...args], { cwd, encoding: "utf8" });
}

function decisions(): DecisionRow[] {
  const db = new Database(join(repo, ".lore", "lore.db"), { readonly: true });
  try {
    return db.query("SELECT class, subject_id, verdict, facts, channel FROM decision_log WHERE class = 'worktree-remove' ORDER BY id").all() as DecisionRow[];
  } finally {
    db.close();
  }
}

function registeredWorktrees(): string[] {
  return git(repo, "worktree", "list", "--porcelain")
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length));
}

/** A linked worktree on its own branch at main's tip (merged), with node_modules/ ignored; optionally an ignored .env. */
function addWorktree(name: string, opts: { env?: boolean } = {}): string {
  const path = join(parent, name);
  git(repo, "worktree", "add", "-q", "-b", `agent-${name}`, path);
  mkdirSync(join(path, "node_modules"), { recursive: true });
  writeFileSync(join(path, "node_modules", "pkg.js"), "module.exports = 1\n");
  if (opts.env === true) writeFileSync(join(path, ".env"), "SECRET=1\n");
  return path;
}

/** A registered `lore-attested-red-*` scratch worktree, dirty like a mutated falsifier run, with an owner marker. */
function addScratch(opts: { ownerPid: number | null; env?: boolean }): string {
  const scratchParent = mkdtempSync(join(parent, "lore-attested-red-"));
  const path = join(scratchParent, "wt");
  git(repo, "worktree", "add", "-q", "--detach", path, "HEAD");
  writeFileSync(join(path, "README.md"), "mutated by the falsifier\n"); // tracked change: dirty by construction
  mkdirSync(join(path, "node_modules"), { recursive: true });
  if (opts.env === true) writeFileSync(join(path, ".env"), "SECRET=1\n");
  if (opts.ownerPid !== null) writeFileSync(join(scratchParent, "owner.json"), JSON.stringify({ pid: opts.ownerPid }));
  return path;
}

/** A pid that existed and has exited: spawn a no-op child and wait for it. */
function endedPid(): number {
  const child = spawnSync("node", ["-e", "0"]);
  if (child.pid === undefined) throw new Error("could not spawn a child to borrow an ended pid");
  return child.pid;
}

beforeEach(() => {
  parent = realpathSync(mkdtempSync(join(tmpdir(), "lore-au11-")));
  privateTmp = join(parent, "tmp");
  mkdirSync(privateTmp);
  repo = join(parent, "repo");
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  writeFileSync(join(repo, ".gitignore"), "node_modules/\ndist/\n.turbo/\ncoverage/\n.env\n.lore/\n");
  writeFileSync(join(repo, "README.md"), "base\n");
  git(repo, "add", "-A");
  git(repo, ...GIT_ID, "commit", "-q", "-m", "base");
  const init = lore(["init"]);
  if (init.exitCode !== 0) throw new Error(`lore init failed: ${init.stderr}`);
});

afterEach(() => {
  if (parent.startsWith(realpathSync(tmpdir()))) rmSync(parent, { recursive: true, force: true });
});

describe("AC-AU-11 (1)+(2) sweep --apply: the ignored-file rule", () => {
  it("(1) a clean merged worktree with only node_modules/ ignored is removed, with one auto worktree-remove record", () => {
    const wt = addWorktree("one");
    const run = lore(["worktree", "sweep", "--apply", "--json"]);
    expect(run.exitCode).toBe(0);
    const rows = (JSON.parse(run.stdout) as { data: { worktrees: { path: string; removed?: boolean }[] } }).data.worktrees;
    expect(rows.find((row) => row.path === wt)?.removed).toBe(true);
    expect(existsSync(wt)).toBe(false);
    expect(registeredWorktrees()).toEqual([repo]);
    const recorded = decisions();
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ class: "worktree-remove", subject_id: wt, verdict: "auto", channel: "machine" });
    expect(JSON.parse(recorded[0]!.facts)).toMatchObject({ recoverability: "loss-free-by-proof", blast: "own-or-ended-run", evidence: "lore-evaluated" });
    expect(lore(["status", "--check-decision-log"]).exitCode).toBe(0);
  });

  it("(2) the same worktree with an ignored .env is kept, escalated, .env named, and the file survives", () => {
    const wt = addWorktree("two", { env: true });
    const run = lore(["worktree", "sweep", "--apply"]);
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain(".env");
    expect(run.stdout).toContain("keep");
    expect(existsSync(wt)).toBe(true);
    expect(readFileSync(join(wt, ".env"), "utf8")).toBe("SECRET=1\n");
    expect(registeredWorktrees()).toContain(wt);
    const recorded = decisions();
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ subject_id: wt, verdict: "escalate" });
    expect(JSON.parse(recorded[0]!.facts).recoverability).toBe("irreversible-local");

    const json = JSON.parse(lore(["worktree", "sweep", "--apply", "--json"]).stdout) as {
      data: { worktrees: { path: string; verdict: string; escalated?: { ignored_paths: string[] } }[] };
    };
    const row = json.data.worktrees.find((r) => r.path === wt);
    expect(row).toMatchObject({ verdict: "keep", escalated: { ignored_paths: [".env"] } });
  });

  it("control: removing the .env makes the SAME worktree removable (a new decision subject version), never auto before", () => {
    const wt = addWorktree("two-b", { env: true });
    expect(lore(["worktree", "sweep", "--apply"]).exitCode).toBe(0);
    expect(existsSync(wt)).toBe(true);
    rmSync(join(wt, ".env"));
    expect(lore(["worktree", "sweep", "--apply"]).exitCode).toBe(0);
    expect(existsSync(wt)).toBe(false);
    expect(decisions().map((row) => row.verdict)).toEqual(["escalate", "auto"]);
  });

  it("control: a dry run removes nothing and records no decision", () => {
    const wt = addWorktree("dry");
    const run = lore(["worktree", "sweep"]);
    expect(run.exitCode).toBe(0);
    expect(existsSync(wt)).toBe(true);
    expect(decisions()).toHaveLength(0);
  });

  it("control: a regenerable-only set (dist/, .turbo/, coverage/, *.tsbuildinfo) does not block removal", () => {
    const wt = addWorktree("regen");
    for (const dir of ["dist", ".turbo", "coverage"]) {
      mkdirSync(join(wt, dir));
      writeFileSync(join(wt, dir, "x"), "x");
    }
    // *.tsbuildinfo is ignored through the worktree's own info/exclude, so the worktree stays merged with main
    const exclude = git(wt, "rev-parse", "--git-path", "info/exclude").trim();
    appendFileSync(resolve(wt, exclude), "*.tsbuildinfo\n");
    writeFileSync(join(wt, "tsconfig.tsbuildinfo"), "{}");
    const run = lore(["worktree", "sweep", "--apply"]);
    expect(run.exitCode).toBe(0);
    expect(run.stdout).not.toContain("keep");
    expect(existsSync(wt)).toBe(false);
  });
});

/** Ignore `patterns` through the worktree's own info/exclude, so the worktree stays merged with main. */
function ignoreInWorktree(wt: string, ...patterns: string[]): void {
  const exclude = git(wt, "rev-parse", "--git-path", "info/exclude").trim();
  appendFileSync(resolve(wt, exclude), `${patterns.join("\n")}\n`);
}

/** The three generated paths live-measured on 2026-10-18 as "outside the regenerable set". */
function trackGeneratedPathParents(): void {
  // reason: git collapses an untracked directory holding only ignored files into one `dir/` entry; the live repo
  // tracks sources beside every generated path, so the fixture must too or the listing is `packages/` alone.
  for (const file of ["packages/dashboard/package.json", "packages/dashboard/src/main.ts", "packages/lore/src/generated/README.md"]) {
    mkdirSync(dirname(join(repo, file)), { recursive: true });
    writeFileSync(join(repo, file), "tracked\n");
  }
  git(repo, "add", "-A");
  git(repo, ...GIT_ID, "commit", "-q", "-m", "tracked sources beside generated paths");
}

function addGeneratedPaths(wt: string): void {
  mkdirSync(join(wt, "packages/dashboard/dist"), { recursive: true });
  writeFileSync(join(wt, "packages/dashboard/dist/index.js"), "built\n");
  mkdirSync(join(wt, "packages/dashboard/src"), { recursive: true });
  writeFileSync(join(wt, "packages/dashboard/src/routeTree.gen.ts"), "// generated\n");
  mkdirSync(join(wt, "packages/lore/src/generated"), { recursive: true });
  writeFileSync(join(wt, "packages/lore/src/generated/dashboard-assets.ts"), "export const assets = {};\n");
  ignoreInWorktree(wt, "packages/dashboard/dist/", "packages/dashboard/src/routeTree.gen.ts", "packages/lore/src/generated/dashboard-assets.ts");
}

describe("AC-AU-11 / AU-T13 sweep --apply: an ignored path is loss-free when identical to main's copy or declared regenerable", () => {
  it("(b) a worktree whose only ignored data is the three live generated paths is removed (exit 0, removed, one auto record)", () => {
    trackGeneratedPathParents();
    const wt = addWorktree("gen");
    addGeneratedPaths(wt);
    const run = lore(["worktree", "sweep", "--apply", "--json"]);
    expect(run.exitCode).toBe(0);
    const rows = (JSON.parse(run.stdout) as { data: { worktrees: { path: string; removed?: boolean }[] } }).data.worktrees;
    expect(rows.find((row) => row.path === wt)?.removed).toBe(true);
    expect(existsSync(wt)).toBe(false);
    expect(decisions().map((row) => row.verdict)).toEqual(["auto"]);
  });

  it("control: the same generated paths plus an ignored .env absent from main are kept, escalated, only .env named", () => {
    trackGeneratedPathParents();
    const wt = addWorktree("gen-env", { env: true });
    addGeneratedPaths(wt);
    const run = lore(["worktree", "sweep", "--apply", "--json"]);
    expect(run.exitCode).toBe(0);
    const row = (JSON.parse(run.stdout) as { data: { worktrees: { path: string; verdict: string; escalated?: { ignored_paths: string[] } }[] } }).data.worktrees.find((r) => r.path === wt);
    expect(row).toMatchObject({ verdict: "keep", escalated: { ignored_paths: [".env"] } });
    expect(existsSync(join(wt, ".env"))).toBe(true);
    expect(decisions().map((r) => r.verdict)).toEqual(["escalate"]);
  });

  it("(c) a worktree whose only ignored path is dist-npm/ (absent from main) is removed: it is in the regenerable set", () => {
    const wt = addWorktree("npm-out");
    mkdirSync(join(wt, "dist-npm"));
    writeFileSync(join(wt, "dist-npm/package.json"), "{}\n");
    ignoreInWorktree(wt, "dist-npm/");
    const run = lore(["worktree", "sweep", "--apply", "--json"]);
    expect(run.exitCode).toBe(0);
    const rows = (JSON.parse(run.stdout) as { data: { worktrees: { path: string; removed?: boolean }[] } }).data.worktrees;
    expect(rows.find((row) => row.path === wt)?.removed).toBe(true);
    expect(existsSync(wt)).toBe(false);
    expect(decisions().map((row) => row.verdict)).toEqual(["auto"]);
  }, { timeout: 60_000 });

  it("(a) an ignored .env byte-identical to main's copy is loss-free: removed", () => {
    writeFileSync(join(repo, ".env"), "SECRET=1\n");
    const wt = addWorktree("same-env", { env: true });
    expect(lore(["worktree", "sweep", "--apply"]).exitCode).toBe(0);
    expect(existsSync(wt)).toBe(false);
    expect(decisions().map((r) => r.verdict)).toEqual(["auto"]);
  });

  it("control: an ignored .env whose content differs from main's copy is kept and named", () => {
    writeFileSync(join(repo, ".env"), "SECRET=main\n");
    const wt = addWorktree("diff-env", { env: true });
    const run = lore(["worktree", "sweep", "--apply"]);
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain(".env");
    expect(existsSync(join(wt, ".env"))).toBe(true);
    expect(decisions().map((r) => r.verdict)).toEqual(["escalate"]);
  });

  it("(a) an ignored directory is identical only when EVERY file under it is: one differing file keeps it", () => {
    for (const root of [repo]) {
      mkdirSync(join(root, "cache"), { recursive: true });
      writeFileSync(join(root, "cache/a"), "a\n");
      writeFileSync(join(root, "cache/b"), "b\n");
    }
    appendFileSync(join(repo, ".gitignore"), "cache/\n");
    git(repo, "add", "-A");
    git(repo, ...GIT_ID, "commit", "-q", "-m", "ignore cache");
    const same = addWorktree("dir-same");
    mkdirSync(join(same, "cache"));
    writeFileSync(join(same, "cache/a"), "a\n");
    writeFileSync(join(same, "cache/b"), "b\n");
    const differs = addWorktree("dir-differs");
    mkdirSync(join(differs, "cache"));
    writeFileSync(join(differs, "cache/a"), "a\n");
    writeFileSync(join(differs, "cache/b"), "CHANGED\n");
    const run = lore(["worktree", "sweep", "--apply"]);
    expect(run.exitCode).toBe(0);
    expect(existsSync(same)).toBe(false);
    expect(existsSync(differs)).toBe(true);
    expect(run.stdout).toContain("cache/");
  }, { timeout: 60_000 });

  it("control: an ignored path absent in main is NOT identical (kept, named) even when it is empty", () => {
    const wt = addWorktree("absent");
    mkdirSync(join(wt, "scratch-data"));
    writeFileSync(join(wt, "scratch-data/x"), "x\n");
    ignoreInWorktree(wt, "scratch-data/");
    const run = lore(["worktree", "sweep", "--apply"]);
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain("scratch-data/");
    expect(existsSync(wt)).toBe(true);
  });
});

describe("AC-AU-11 (4) sweep --apply: orphan lore-attested-red-* worktrees", () => {
  it("(4) a registered scratch worktree whose owner process ended is removed, directory and registration, via an auto decision", () => {
    const wt = addScratch({ ownerPid: endedPid() });
    expect(registeredWorktrees()).toContain(wt);
    const run = lore(["worktree", "sweep", "--apply", "--json"]);
    expect(run.exitCode).toBe(0);
    expect((JSON.parse(run.stdout) as { data: { worktrees: { path: string; removed?: boolean }[] } }).data.worktrees.find((r) => r.path === wt)?.removed).toBe(true);
    expect(existsSync(wt)).toBe(false);
    expect(existsSync(join(wt, ".."))).toBe(false);
    expect(registeredWorktrees()).toEqual([repo]);
    expect(decisions()).toMatchObject([{ subject_id: wt, verdict: "auto" }]);
  });

  it("control: a scratch whose owner process is alive is kept (its run has not ended)", () => {
    const wt = addScratch({ ownerPid: process.pid });
    const run = lore(["worktree", "sweep", "--apply"]);
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain("run-not-ended");
    expect(existsSync(wt)).toBe(true);
    expect(decisions()).toHaveLength(0);
  });

  it("control: an orphan scratch holding an ignored .env is kept, escalated, .env named", () => {
    const wt = addScratch({ ownerPid: endedPid(), env: true });
    const run = lore(["worktree", "sweep", "--apply"]);
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain(".env");
    expect(existsSync(join(wt, ".env"))).toBe(true);
    expect(decisions()).toMatchObject([{ subject_id: wt, verdict: "escalate" }]);
  });

  it("control: a dirty worktree that is NOT a scratch path is never removed by the scratch rule", () => {
    const wt = addWorktree("plain");
    writeFileSync(join(wt, "README.md"), "edited\n");
    const run = lore(["worktree", "sweep", "--apply"]);
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain("uncommitted-changes");
    expect(existsSync(wt)).toBe(true);
    expect(decisions()).toHaveLength(0);
  });
});

// ── (3) verify --falsify ────────────────────────────────────────────────────

function slugOf(out: string): string {
  const slug = out.match(/Slug:\s+(\S+)/)?.[1];
  if (slug === undefined) throw new Error(`no slug in: ${out}`);
  return slug;
}

function must(run: Run, what: string): Run {
  if (run.exitCode !== 0) throw new Error(`${what} failed (${run.exitCode}): ${run.stderr}${run.stdout}`);
  return run;
}

/** prd -> spec(AC with falsifier) -> plan -> task, gates off, corpus committed; returns what `verify --falsify` needs. */
function falsifyFixture(command: string): { plan: string; task: string; acId: string } {
  appendFileSync(
    join(repo, ".lore", "config.yaml"),
    ["workflow:", "  gates:", "    spec-create:", "      enabled: false", "    spec-promote:", "      enabled: false", "    plan-promote:", "      enabled: false", "    task-claim:", "      enabled: false", '    "task-create":', "      enabled: false", ""].join("\n"),
  );
  const acId = "AC-AU11-FALSIFY";
  must(lore(["create", "prd", "--title", "AU11 Falsify PRD", "--no-ai", "--content", "body"]), "create prd");
  const spec = slugOf(must(lore(["create", "spec", "--title", "AU11 Falsify Spec", "--no-ai", "--content", "body"]), "create spec").stdout);
  must(
    lore(["ac", "add", spec, acId, "--statement", "falsify cleanup oracle", "--mode", "script", "--oracle", "other", "--command", command,
      "--falsifier-path", "dependency.txt", "--falsifier-find", "hello", "--falsifier-replace", "goodbye", "--falsifier-exit-code", "1"]),
    "ac add",
  );
  const plan = slugOf(must(lore(["create", "plan", "--title", "AU11 Falsify Plan", "--parent", spec, "--no-ai", "--content", "body"]), "create plan").stdout);
  const task = slugOf(
    must(lore(["create", "task", "--title", "AU11 Falsify Task", "--parent", plan, "--plan-id", plan, "--no-ai", "--content", "body", "--ac-scope", acId]), "create task").stdout,
  );
  return { plan, task, acId };
}

function scratchDirsIn(dir: string): string[] {
  return readdirSync(dir).filter((name) => name.startsWith("lore-attested-red-"));
}

describe("AC-AU-11 (3) verify --falsify cleanup", () => {
  it("(3) a falsify run that fails mid-way (green control red) leaves no scratch worktree registered or on disk; the cleanup is an auto decision", { timeout: 60_000 }, () => {
    // dependency.txt is created after the commit and never added: the scratch checkout lacks it, so the green control fails.
    const { plan, task, acId } = falsifyFixture("cat dependency.txt");
    git(repo, "add", "-A");
    git(repo, ...GIT_ID, "commit", "-q", "--allow-empty", "-m", "corpus");
    writeFileSync(join(repo, "dependency.txt"), "hello\n");

    const run = lore(["verify", plan, "--task", task, "--falsify", acId], repo, { TMPDIR: privateTmp });
    expect(run.exitCode).toBe(3);
    expect(run.stdout).toContain("Green control failed");
    expect(scratchDirsIn(privateTmp)).toEqual([]);
    expect(registeredWorktrees()).toEqual([repo]);
    const recorded = decisions();
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ class: "worktree-remove", verdict: "auto", channel: "machine" });
    expect(recorded[0]!.subject_id).toContain("lore-attested-red-");
  });

  it("control: a falsify run whose command wrote an ignored .env into the scratch keeps it, escalated, and says so", { timeout: 60_000 }, () => {
    const { plan, task, acId } = falsifyFixture("grep -q hello dependency.txt && echo secret > .env");
    writeFileSync(join(repo, "dependency.txt"), "hello\n");
    git(repo, "add", "-A");
    git(repo, ...GIT_ID, "commit", "-q", "--allow-empty", "-m", "corpus");

    const run = lore(["verify", plan, "--task", task, "--falsify", acId], repo, { TMPDIR: privateTmp });
    expect(run.exitCode).toBe(0);
    expect(run.stderr).toContain("scratch worktree kept");
    expect(run.stderr).toContain(".env");
    expect(scratchDirsIn(privateTmp)).toHaveLength(1);
    expect(decisions()).toMatchObject([{ verdict: "escalate" }]);
  });
});

// ── lore done's path ────────────────────────────────────────────────────────

describe("AC-AU-11 lore done path: evaluateRecordedWorktree consults the gate after the removal test", () => {
  const removableFacts: WorktreeRemovalFacts = {
    linked: { ok: true, value: true },
    callerInside: { ok: true, value: false },
    dirty: { ok: true, value: false },
    unmerged: { ok: true, value: false },
    locked: { ok: true, value: false },
    agentRunLive: { ok: true, value: false },
    openClaims: { ok: true, value: [] },
    processesInside: { ok: true, value: [] },
    owner: { ok: true, value: null },
  };
  const probe = {
    pathExists: () => true,
    realPath: (p: string) => p,
    currentWorkingDirectory: () => "/repo",
    listWorktrees: () => ({ ok: true, value: [{ path: "/repo", branch: "main", locked: false }, { path: "/wt/a", branch: "feat", locked: false }] }),
    countCommits: () => ({ ok: true, value: 1 }),
  } as unknown as WorktreeGitProbe;
  const recorded = { path: "/wt/a", baseSha: "base" };
  const ctx = { callerSession: "S1", activeClaimedPaths: new Set<string>() };

  it("a gate that refuses turns a removable worktree into keep, carrying the gate's reason (.env named)", async () => {
    const asked: string[] = [];
    const port = {
      gatherRemovalFacts: async () => removableFacts,
      gateRemoval: async (path: string) => {
        asked.push(path);
        return { allowed: false as const, reason: "ignored data outside the regenerable set: .env (escalate, decision record 3)", ignored_paths: [".env"] };
      },
    };
    const evaluation = await evaluateRecordedWorktree(probe, port, recorded, ctx);
    expect(evaluation).toMatchObject({ decision: "keep", reason: expect.stringContaining(".env") });
    expect(asked).toEqual(["/wt/a"]);
  });

  it("a gate that allows leaves the removal test's verdict (remove) untouched; the gate is never asked when the test says keep", async () => {
    const allowing = { gatherRemovalFacts: async () => removableFacts, gateRemoval: async () => ({ allowed: true as const, record_id: 1 }) };
    expect((await evaluateRecordedWorktree(probe, allowing, recorded, ctx)).decision).toBe("remove");

    const asked: string[] = [];
    const dirty = {
      gatherRemovalFacts: async () => ({ ...removableFacts, dirty: { ok: true as const, value: true } }),
      gateRemoval: async (path: string) => {
        asked.push(path);
        return { allowed: true as const, record_id: 2 };
      },
    };
    expect((await evaluateRecordedWorktree(probe, dirty, recorded, ctx)).decision).toBe("keep");
    expect(asked).toEqual([]);
  });
});
