// @reads assets/agents/**
// @reads assets/skills/**
// @reads assets/hooks/**
// @reads assets/context/**
// @reads scripts/agent-hygiene-allowlist.json
// @reads scripts/check-agent-hygiene.ts
// @reads packages/lore/tests/integration/helpers/run-process-group.ts
/**
 * AC-AU-6 oracle (`spec-autonomy-phase-1-decision-function-human-channel-lore`): agents stop creating the mess.
 *
 * Coverage:
 *   HAPPY — the real shipped assets scan clean (exit 0); an allowlisted line with a reason is exempt.
 *   NEGATIVE — a fixture asset with each stash form / each pgrep wait loop exits 1 naming file:line.
 *   BOUNDARY — `git stash drop` (a refusal pattern, not a steer) is not flagged; all four asset dirs are scanned.
 *   ERROR — a missing allowlist / a reason-less entry throws (scan failure), never reads as clean.
 *   STATE — a stale allowlist entry (exempts no line) is itself a finding.
 *   REGRESSION — lore-implementer.md names the recorded-pid wait and the red-first route; run-process-group reaps
 *     its detached child groups on SIGTERM and SIGINT (a signal-killed worker once orphaned a 25 h `npm pack`);
 *     a fresh checkout stays `git status --porcelain`-empty after build + the worktree-cleanup test.
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { runProcessGroup } from "../../packages/lore/tests/integration/helpers/run-process-group";
import { AgentHygieneScanError, main, SCANNED_ASSET_DIRS } from "../check-agent-hygiene";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const HELPER_PATH = join(REPO_ROOT, "packages/lore/tests/integration/helpers/run-process-group.ts");
const EMPTY_ALLOWLIST = JSON.stringify({ entries: [] });

const cleanupDirs: string[] = [];
afterEach(() => {
  while (cleanupDirs.length > 0) {
    const dir = cleanupDirs.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

function makeFixture(files: Record<string, string>, allowlist: string | null = EMPTY_ALLOWLIST): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "agent-hygiene-")));
  cleanupDirs.push(root);
  for (const dir of SCANNED_ASSET_DIRS) mkdirSync(join(root, dir), { recursive: true });
  mkdirSync(join(root, "scripts"), { recursive: true });
  if (allowlist !== null) writeFileSync(join(root, "scripts/agent-hygiene-allowlist.json"), allowlist);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

function scan(root: string): { code: number; output: string } {
  const lines: string[] = [];
  const code = main(root, (line) => lines.push(line));
  return { code, output: lines.join("\n") };
}

describe("AC-AU-6 half 1: no stash steer in shipped assets", () => {
  it("AC-AU-6 the real shipped assets scan clean (exit 0)", () => {
    const { code, output } = scan(REPO_ROOT);
    expect(output).toBe("");
    expect(code).toBe(0);
  });

  it.each(["push", "save", "pop", "apply"])("AC-AU-6 a fixture line with `git stash %s` exits 1 naming file:line", (verb) => {
    const root = makeFixture({ "assets/agents/x.md": `fine\nrun \`git stash ${verb} -m wip\` now\n` });
    const { code, output } = scan(root);
    expect(code).toBe(1);
    expect(output).toContain("assets/agents/x.md:2");
  });

  it.each(SCANNED_ASSET_DIRS)("AC-AU-6 %s is scanned", (dir) => {
    const root = makeFixture({ [`${dir}/nested/y.md`]: "git stash push\n" });
    const { code, output } = scan(root);
    expect(code).toBe(1);
    expect(output).toContain(`${dir}/nested/y.md:1`);
  });

  it("AC-AU-6 `git stash drop` (a refusal pattern, not a steer) is not flagged", () => {
    const root = makeFixture({ "assets/hooks/h.mjs": "// refuses git stash drop\n" });
    expect(scan(root).code).toBe(0);
  });

  it("AC-AU-6 an allowlisted line with a reason is exempt", () => {
    const allowlist = JSON.stringify({
      entries: [{ file: "assets/hooks/h.mjs", line: "// git stash push is quoted here", reason: "documents the hook's own refusal pattern text" }],
    });
    const root = makeFixture({ "assets/hooks/h.mjs": "  // git stash push is quoted here\n" }, allowlist);
    expect(scan(root).code).toBe(0);
  });

  it("AC-AU-6 a stale allowlist entry that exempts no line is a finding (exit 1)", () => {
    const allowlist = JSON.stringify({
      entries: [{ file: "assets/hooks/h.mjs", line: "git stash push gone", reason: "documents the hook's own refusal pattern text" }],
    });
    const root = makeFixture({ "assets/hooks/h.mjs": "nothing here\n" }, allowlist);
    const { code, output } = scan(root);
    expect(code).toBe(1);
    expect(output).toContain("stale-allowlist-entry");
  });

  it("AC-AU-6 a missing allowlist and a reason-less entry are scan failures, never clean", () => {
    expect(() => scan(makeFixture({}, null))).toThrow(AgentHygieneScanError);
    const noReason = JSON.stringify({ entries: [{ file: "a", line: "b", reason: "short" }] });
    expect(() => scan(makeFixture({}, noReason))).toThrow(AgentHygieneScanError);
  });

  it("AC-AU-6 lore-implementer.md names the commit-the-test-first / --falsify route and no longer sanctions a stash", () => {
    const text = readFileSync(join(REPO_ROOT, "assets/agents/lore-implementer.md"), "utf8");
    expect(text).toMatch(/commit(ting)? the test first/i);
    expect(text).toContain("lore verify --falsify");
  });

  it("AC-AU-6 the git-safety hook safe-hints do not point at git stash", () => {
    const text = readFileSync(join(REPO_ROOT, "assets/hooks/pre-bash-git-safety-gate.mjs"), "utf8");
    const hints = text.split("\n").filter((line) => line.trimStart().startsWith("safe:"));
    expect(hints.length).toBeGreaterThanOrEqual(4);
    for (const hint of hints.filter((line) => !line.includes("git stash list"))) expect(hint).not.toMatch(/git stash/);
  });
});

describe("AC-AU-6 half 2: no self-matching waits", () => {
  it.each([
    ["until ! pgrep -f 'vitest'; do sleep 1; done", "until"],
    ["while pgrep -f build >/dev/null; do sleep 1; done", "while"],
  ])("AC-AU-6 a fixture `%s` exits 1 naming file:line", (line) => {
    const root = makeFixture({ "assets/skills/lore-x/SKILL.md": `ok\n${line}\n` });
    const { code, output } = scan(root);
    expect(code).toBe(1);
    expect(output).toContain("assets/skills/lore-x/SKILL.md:2");
    expect(output).toContain("pgrep-poll");
  });

  it("AC-AU-6 lore-implementer.md waits on a recorded pid and forbids pgrep -f polling", () => {
    const text = readFileSync(join(REPO_ROOT, "assets/agents/lore-implementer.md"), "utf8");
    expect(text).toContain("pid=$!");
    expect(text).toContain("kill -0");
    expect(text).toMatch(/never poll with `pgrep -f`/i);
  });
});

/** Polls `predicate` every 50 ms until true or `budgetMs` elapses; returns the last value. */
async function waitUntil(predicate: () => boolean, budgetMs: number): Promise<boolean> {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((done) => setTimeout(done, 50));
  }
  return predicate();
}

function groupAlive(pgid: number): boolean {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("AC-AU-6 half 3: run-process-group reaps child groups on signals", () => {
  it.each(["SIGTERM", "SIGINT"] as const)("AC-AU-6 a parent killed by %s leaves no orphan child group", async (signal) => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "agent-hygiene-signal-")));
    cleanupDirs.push(dir);
    const pidFile = join(dir, "child.pid");
    const parentScript = join(dir, "parent.ts");
    writeFileSync(
      parentScript,
      `import { runProcessGroup } from ${JSON.stringify(HELPER_PATH)};\n` +
        `void runProcessGroup("/bin/sh", ["-c", "echo $$ > ${pidFile}; exec sleep 300"], { cwd: ${JSON.stringify(dir)}, env: {}, timeoutMs: 600000 });\n`,
    );
    const runtime = process.versions.bun !== undefined ? process.execPath : "bun";
    const parent = spawn(runtime, [parentScript], { stdio: "ignore" });
    let childGroup = 0;
    try {
      expect(await waitUntil(() => existsSync(pidFile) && readFileSync(pidFile, "utf8").trim() !== "", 15_000)).toBe(true);
      childGroup = Number(readFileSync(pidFile, "utf8").trim());
      expect(groupAlive(childGroup)).toBe(true); // control: the group really exists before the signal

      const parentExit = new Promise<string | null>((done) => parent.once("exit", (_code, sig) => done(sig)));
      parent.kill(signal);
      expect(await parentExit).toBe(signal); // the handler re-raises: the parent still dies of the signal
      expect(await waitUntil(() => !groupAlive(childGroup), 5_000)).toBe(true);
    } finally {
      if (childGroup > 0 && groupAlive(childGroup)) process.kill(-childGroup, "SIGKILL");
      parent.kill("SIGKILL");
    }
  }, 30_000);
});

describe("AC-AU-6 half 5: a fresh checkout stays clean after build and the worktree-cleanup test", () => {
  it("AC-AU-6 `git status --porcelain` is empty after `bun run build && vitest run worktree-cleanup.test.ts`", async () => {
    const parent = realpathSync(mkdtempSync(join(tmpdir(), "agent-hygiene-fresh-")));
    cleanupDirs.push(parent);
    const checkout = join(parent, "checkout");
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
    const step = async (bin: string, args: string[], cwd: string): Promise<void> => {
      const result = await runProcessGroup(bin, args, { cwd, env, timeoutMs: 240_000 });
      expect({ step: `${bin} ${args.join(" ")}`, exit: result.exitCode, tail: result.exitCode === 0 ? "" : result.stderr.slice(-800) }).toEqual({
        step: `${bin} ${args.join(" ")}`,
        exit: 0,
        tail: "",
      });
    };
    // reason: a local clone is the fresh checkout; unlike `git worktree add` it registers nothing in this repo's .git
    await step("git", ["clone", "-q", "--no-hardlinks", REPO_ROOT, checkout], parent);
    await step("bun", ["install", "--frozen-lockfile"], checkout);
    await step("bun", ["run", "build"], checkout);
    await step("bunx", ["--bun", "vitest", "run", "packages/lore/tests/unit/service/worktree-cleanup.test.ts"], checkout);
    const status = spawnSync("git", ["status", "--porcelain"], { cwd: checkout, encoding: "utf8" });
    expect(status.status).toBe(0);
    expect(status.stdout).toBe("");

    // control: the probe is not vacuous — a tracked-file edit makes the same command non-empty
    writeFileSync(join(checkout, "package.json"), `${readFileSync(join(checkout, "package.json"), "utf8")} `);
    const dirty = spawnSync("git", ["status", "--porcelain"], { cwd: checkout, encoding: "utf8" });
    expect(dirty.stdout).toContain("package.json");
  }, 300_000);
});
