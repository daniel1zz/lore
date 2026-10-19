// @spawns assets/hooks/pre-bash-git-safety-gate.mjs
// @layer integration-shell-cwd-sites AC-DCL-4 (the three call sites + the scan; owner is the table-driven parser test packages/core/tests/shell-cwd.test.ts)
// @reads packages/core/src/oracle-file-existence.ts
// @reads packages/core/src/attestation-completeness.ts
// @reads packages/core/src/shell-cwd.ts
// @reads assets/hooks/pre-bash-git-safety-gate.mjs
// @reads assets/hooks/lib/shell-cwd.mjs
/**
 * @spec_ref spec-defect-clusters-round-1-done-floors-judge-real-runs-on (AC-DCL-4; D4)
 * @task task-skill-fix-dcl-4-one-cwd-aware-shell-command-parser-used-by
 *
 * The three sites that read command text for a directory all go through the ONE parser (`@lore/core` shell-cwd):
 *   1. oracle-file-existence precheck — #229 (cd in a later segment), #221 (absolute cd refused)
 *   2. `lore done`'s unfiltered matcher `commandRunsFileUnfiltered` — #164 (`(cd x && …)` subshell)
 *   3. the git-safety-gate hook asset — #211 (decides the command against the cd'd path, `$VAR` from its env)
 * plus a scan that each site imports the parser and carries no cd handling of its own, and that the hook's
 * copy is byte-identical to what its single source generates.
 *
 * HAPPY:      #229 file found; #164 true; #211 clean+merged worktree passes after a cd (relative path, `$W` given)
 * NEGATIVE:   an absolute cd outside the base is refused (file reported missing); a subshell cd does not leak; `$W` unset blocks
 * BOUNDARY:   absolute cd INSIDE the base resolves; cd-then-runner in one segment still true (pre-parser answers kept)
 * ERROR:      not-measured cwd blocks the hook naming the cause
 * REGRESSION: scan — imports the parser, no own cd handling; hook copy identical to its source
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { commandRunsFileUnfiltered, findMissingOracleFiles } from "@lore/core";
import { renderHookShellCwd } from "../../../../scripts/sync-hook-shell-cwd.js";

const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..");
const HOOK = join(REPO_ROOT, "assets", "hooks", "pre-bash-git-safety-gate.mjs");
const HOOK_COPY = join(REPO_ROOT, "assets", "hooks", "lib", "shell-cwd.mjs");
const SITES = {
  oracleFileExistence: join(REPO_ROOT, "packages", "core", "src", "oracle-file-existence.ts"),
  attestationCompleteness: join(REPO_ROOT, "packages", "core", "src", "attestation-completeness.ts"),
  hook: HOOK,
} as const;

describe("AC-DCL-4 site 1: oracle-file-existence precheck", () => {
  const exists = (...present: string[]) => (path: string) => present.includes(path);

  it("HAPPY #229: a cd in a NON-first chain segment is applied — the file under it is not reported missing", () => {
    const command = "bun test tests/a.test.ts && cd packages/lore && bun test tests/b.bun.test.ts";
    const missing = findMissingOracleFiles(command, {
      cwd: "/repo",
      fileExists: exists("/repo/tests/a.test.ts", "/repo/packages/lore/tests/b.bun.test.ts"),
    });
    expect(missing).toEqual([]);
  });

  it("NEGATIVE control: the same command with the file nowhere IS reported missing (no vacuous pass)", () => {
    const command = "bun test tests/a.test.ts && cd packages/lore && bun test tests/b.bun.test.ts";
    const missing = findMissingOracleFiles(command, { cwd: "/repo", fileExists: exists("/repo/tests/a.test.ts") });
    expect(missing).toEqual(["tests/b.bun.test.ts"]);
  });

  it("NEGATIVE #221: an absolute cd OUTSIDE the base is refused — the file under it is not resolved there", () => {
    const missing = findMissingOracleFiles("cd /outside && bun test tests/z.bun.test.ts", {
      cwd: "/repo",
      fileExists: exists("/outside/tests/z.bun.test.ts"),
    });
    expect(missing).toEqual(["tests/z.bun.test.ts"]);
  });

  it("BOUNDARY #221: an absolute cd that lands INSIDE the base resolves against it", () => {
    const missing = findMissingOracleFiles("cd /repo/packages/lore && bun test tests/z.bun.test.ts", {
      cwd: "/repo",
      fileExists: exists("/repo/packages/lore/tests/z.bun.test.ts"),
    });
    expect(missing).toEqual([]);
  });
});

describe("AC-DCL-4 site 2: lore done's unfiltered matcher", () => {
  const X = "packages/lore/tests/x.bun.test.ts";

  it("HAPPY #164: the (cd x && …) subshell form counts as an unfiltered run of the file", () => {
    expect(commandRunsFileUnfiltered("(cd packages/lore && bun test tests/x.bun.test.ts) && bun test tests/y.test.ts", X)).toBe(true);
  });

  it("NEGATIVE #164: the subshell's cd does not leak onto the segment after it", () => {
    const command = "(cd packages/lore && bun test tests/x.bun.test.ts) && bun test tests/y.test.ts";
    expect(commandRunsFileUnfiltered(command, "tests/y.test.ts")).toBe(true);
    expect(commandRunsFileUnfiltered(command, "packages/lore/tests/y.test.ts")).toBe(false);
  });

  it("HAPPY: a cd in an earlier chain segment applies to a later runner segment", () => {
    expect(commandRunsFileUnfiltered("bun run build && cd packages/lore && bun test tests/x.bun.test.ts", X)).toBe(true);
  });

  it("REGRESSION (plan Ownership answers): every case the pre-parser rule answered true is still true", () => {
    expect(commandRunsFileUnfiltered("cd packages/lore && bun test tests/x.bun.test.ts", X)).toBe(true);
    expect(commandRunsFileUnfiltered("bun test packages/lore/tests/x.bun.test.ts", X)).toBe(true);
    // the old rule joined EVERY token to the one cd derived before the first path-naming segment, by value
    expect(commandRunsFileUnfiltered("cd a && cd packages/lore && bun test tests/x.bun.test.ts", X)).toBe(true);
    expect(commandRunsFileUnfiltered("cd packages && cd lore && bun test tests/x.bun.test.ts", X)).toBe(true);
    expect(commandRunsFileUnfiltered("bun test tests/x.bun.test.ts", X, { executionRoot: "packages/lore" })).toBe(true);
  });

  it("NEGATIVE: a case filter, a selective run, and an absolute execution root stay false", () => {
    expect(commandRunsFileUnfiltered("cd packages/lore && bun test tests/x.bun.test.ts -t 'one'", X)).toBe(false);
    expect(commandRunsFileUnfiltered("bun run test:changed main", X)).toBe(false);
    expect(commandRunsFileUnfiltered("bun test tests/x.bun.test.ts", X, { executionRoot: "/elsewhere/packages/lore" })).toBe(false);
  });
});

describe("AC-DCL-4 site 3: the git-safety-gate hook decides against the cd'd path", () => {
  let base = "";
  let repo = "";
  let sub = "";
  let stubDir = "";

  function git(args: string[], cwd: string): string {
    const r = spawnSync("git", args, { cwd, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
    return r.stdout.trim();
  }

  function runHook(command: string, env: Record<string, string> = {}): { code: number; stderr: string; loreArgs: string } {
    writeFileSync(join(stubDir, "lore.args"), "");
    const r = spawnSync(process.execPath, [HOOK], {
      input: JSON.stringify({ cwd: sub, session_id: "S-test", tool_input: { command } }),
      encoding: "utf8",
      env: {
        PATH: [stubDir, ...(process.env["PATH"] ?? "").split(delimiter)].join(delimiter),
        HOME: process.env["HOME"] ?? base,
        STUB_DIR: stubDir,
        ...env,
      },
    });
    return { code: r.status ?? -1, stderr: r.stderr ?? "", loreArgs: readFileSync(join(stubDir, "lore.args"), "utf8") };
  }

  beforeAll(() => {
    base = realpathSync(mkdtempSync(join(tmpdir(), "shell-cwd-sites-")));
    repo = join(base, "repo");
    mkdirSync(repo);
    git(["init", "-q", "-b", "main"], repo);
    git(["config", "user.email", "t@t"], repo);
    git(["config", "user.name", "t"], repo);
    writeFileSync(join(repo, "f.txt"), "v1\n");
    git(["add", "."], repo);
    git(["commit", "-qm", "init"], repo);
    git(["branch", "merged-branch"], repo);
    // reason: a clean, merged worktree at a RELATIVE-to-repo-root path; the session cwd is a different directory
    // inside the repo, so `git worktree remove wts/wt1` only means something after `cd`.
    mkdirSync(join(repo, "wts"));
    git(["worktree", "add", "-q", join(repo, "wts", "wt1"), "merged-branch"], repo);
    sub = join(repo, "sub");
    mkdirSync(sub);

    stubDir = join(base, "stubs");
    mkdirSync(stubDir);
    const removable = JSON.stringify({ ok: true, data: { path: "x", verdict: "removable", reasons: [], owner: null, occupancy: null, processes: [] } });
    writeFileSync(join(stubDir, "lore"), `#!/bin/sh\necho "$@" >> "$STUB_DIR/lore.args"\nprintf '%s' '${removable}'\n`);
    chmodSync(join(stubDir, "lore"), 0o755);
  }, 60_000);

  afterAll(() => {
    if (base) rmSync(base, { recursive: true, force: true });
  });

  it("HAPPY #211: a clean merged worktree named by a path relative to the cd'd directory passes, and lore is asked about the ABSOLUTE path", () => {
    const r = runHook("cd .. && git worktree remove wts/wt1");
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
    expect(r.loreArgs).toContain(`worktree check ${join(repo, "wts", "wt1")} `);
  });

  it("HAPPY #211: `cd $W && …` resolves $W from the hook's env", () => {
    const r = runHook("cd $W && git worktree remove wts/wt1", { W: repo });
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
  });

  it("NEGATIVE #211: the same relative path WITHOUT the cd is not the worktree — the gate refuses rather than guess", () => {
    const r = runHook("git worktree remove wts/wt1");
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("UNSAFE");
  });

  it("ERROR #211: an unset $W blocks and names the variable", () => {
    const r = runHook("cd $W && git worktree remove wts/wt1");
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("$W");
    expect(r.stderr).toContain("unset-variable");
  });

  it("ERROR: `cd -` and command substitution block, naming the cause", () => {
    const dash = runHook("cd - && git worktree remove wts/wt1");
    expect(dash.code).toBe(2);
    expect(dash.stderr).toContain("cd-dash");
    const substitution = runHook("cd $(git rev-parse --show-toplevel) && git worktree remove wts/wt1");
    expect(substitution.code).toBe(2);
    expect(substitution.stderr).toContain("command-substitution");
  });

  it("NEGATIVE: a subshell cd does not reach the command after it", () => {
    const r = runHook("(cd ..) && git worktree remove wts/wt1");
    expect(r.code).toBe(2);
  });

  it("REGRESSION: a git rule with a probe reports against the directory the command runs in, not the session cwd", () => {
    const other = join(base, "other");
    mkdirSync(other);
    git(["init", "-q", "-b", "main"], other);
    writeFileSync(join(other, "only-in-other.txt"), "x\n");
    const r = runHook(`cd ${other} && git reset --hard`);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("only-in-other.txt");
    expect(r.stderr).toContain("WOULD DESTROY 1 uncommitted change");
  });
});

describe("AC-DCL-4 scan: every site imports the shared parser and has no cd handling of its own", () => {
  /** Source with line and block comments removed, so prose about `cd` never counts. */
  function codeOnly(path: string): string {
    return readFileSync(path, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
  }

  const OWN_CD_HANDLING: RegExp[] = [
    /["']cd["']/, // a literal "cd" the code compares against
    /\bcd\\s/, // a regex that matches the cd builtin
    /CD_SEGMENT/, // the retired matcher
    /\^\\s\*cd\b/,
    /startsWith\(["'`]cd\b/,
  ];

  it.each(Object.entries(SITES))("%s imports shell-cwd", (name, path) => {
    const source = codeOnly(path);
    const importPattern = name === "hook" ? /from\s+['"]\.\/lib\/shell-cwd\.mjs['"]/ : /from\s+["']\.\/shell-cwd\.js["']/;
    expect(source).toMatch(importPattern);
  });

  it.each(Object.entries(SITES))("%s contains no cd handling of its own", (_name, path) => {
    const source = codeOnly(path);
    for (const pattern of OWN_CD_HANDLING) expect(source, `${path} matches ${pattern}`).not.toMatch(pattern);
  });

  it("the scan is not vacuous: it flags a source that does handle cd itself", () => {
    const sample = 'const CD_SEGMENT_PATTERN = /^\\s*cd\\s+(\\S+)$/; if (argv[0] === "cd") apply();';
    expect(OWN_CD_HANDLING.filter((pattern) => pattern.test(sample)).length).toBeGreaterThanOrEqual(3);
  });

  it("SINGLE SOURCE: the hook's copy is byte-identical to what packages/core/src/shell-cwd.ts generates", () => {
    expect(readFileSync(HOOK_COPY, "utf8")).toBe(renderHookShellCwd());
  });
});
