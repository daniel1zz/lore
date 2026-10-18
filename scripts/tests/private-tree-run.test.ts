// @reads scripts/private-tree-run.ts
// @spawns scripts/private-tree-run.ts
/**
 * TG-46: the private copy a test run executes in (scripts/private-tree-run.ts). The end-to-end claim (a concurrent
 * edit by a process outside the run is not blamed on it; a real test write still is) is proved against a real vitest
 * run in test-tree-snapshot-guard.test.ts; these cases cover the copy itself.
 * Coverage: HAPPY (dirty and untracked content copied, command runs in the copy, exit code relayed) / NEGATIVE
 * (ignored content not copied, a tracked file deleted in the work tree not copied) / BOUNDARY (ignored dirs are
 * links to the real ones, mtime preserved) / ERROR (not a git repo, no command, no node_modules) / STATE (dispose
 * removes the copy and never the link targets; writes in the copy never reach the real tree).
 */
import { afterAll, describe, expect, it } from "vitest";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createPrivateTree, nearestNodeModules, rebaseReport, runInPrivateTree } from "../private-tree-run";

const REPO = join(fileURLToPath(import.meta.url), "..", "..", "..");
const CLI = join(REPO, "scripts", "private-tree-run.ts");
const made: string[] = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): void {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
}

function scratch(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  made.push(dir);
  return dir;
}

/** A repo with tracked.txt (modified after commit), gone.txt (tracked, deleted), new.txt (untracked), ignored/ and a node_modules holding `vitest`. */
function fixtureRepo(): string {
  const root = scratch("private-tree-fixture-");
  git(root, "init", "-q");
  git(root, "config", "user.email", "t@t");
  git(root, "config", "user.name", "t");
  writeFileSync(join(root, ".gitignore"), "ignored/\nnode_modules/\n");
  writeFileSync(join(root, "tracked.txt"), "one\n");
  writeFileSync(join(root, "gone.txt"), "going\n");
  mkdirSync(join(root, "sub"));
  writeFileSync(join(root, "sub", "nested.txt"), "nested\n");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "init");
  writeFileSync(join(root, "tracked.txt"), "dirty content\n");
  rmSync(join(root, "gone.txt"));
  writeFileSync(join(root, "new.txt"), "untracked\n");
  mkdirSync(join(root, "ignored"));
  writeFileSync(join(root, "ignored", "build.out"), "built\n");
  mkdirSync(join(root, "node_modules", "vitest"), { recursive: true });
  return root;
}

describe("TG-46 private tree copy", () => {
  it("HAPPY: the copy holds the work tree's current content, dirty and untracked files included", () => {
    const root = fixtureRepo();
    const tree = createPrivateTree(root);
    try {
      expect(readFileSync(join(tree.dir, "tracked.txt"), "utf8")).toBe("dirty content\n");
      expect(readFileSync(join(tree.dir, "new.txt"), "utf8")).toBe("untracked\n");
      expect(readFileSync(join(tree.dir, "sub", "nested.txt"), "utf8")).toBe("nested\n");
    } finally {
      tree.dispose();
    }
  });

  it("NEGATIVE: a tracked file deleted in the work tree is absent from the copy", () => {
    const root = fixtureRepo();
    const tree = createPrivateTree(root);
    try {
      expect(existsSync(join(tree.dir, "gone.txt"))).toBe(false);
    } finally {
      tree.dispose();
    }
  });

  it("BOUNDARY: ignored content is a link to the real one, not a copy; mtime of copied files is preserved", () => {
    const root = fixtureRepo();
    const when = new Date("2020-01-02T03:04:05Z");
    utimesSync(join(root, "tracked.txt"), when, when);
    const tree = createPrivateTree(root);
    try {
      expect(lstatSync(join(tree.dir, "ignored")).isSymbolicLink()).toBe(true);
      expect(readlinkSync(join(tree.dir, "ignored"))).toBe(join(root, "ignored"));
      expect(lstatSync(join(tree.dir, "node_modules")).isSymbolicLink()).toBe(true);
      expect(statSync(join(tree.dir, "tracked.txt")).mtimeMs).toBe(when.getTime());
    } finally {
      tree.dispose();
    }
  });

  it("STATE: a write in the copy never reaches the real tree; dispose removes the copy and spares the link targets", () => {
    const root = fixtureRepo();
    const tree = createPrivateTree(root);
    writeFileSync(join(tree.dir, "tracked.txt"), "written by the run\n");
    writeFileSync(join(tree.dir, "ignored", "from-run.out"), "ignored output\n");
    tree.dispose();
    expect(existsSync(tree.dir)).toBe(false);
    expect(readFileSync(join(root, "tracked.txt"), "utf8")).toBe("dirty content\n");
    expect(readFileSync(join(root, "ignored", "build.out"), "utf8")).toBe("built\n");
    expect(existsSync(join(root, "node_modules", "vitest"))).toBe(true);
  });

  it("ERROR: a directory that is not a git work tree fails loud and leaves no copy behind", () => {
    const parent = scratch("private-tree-parent-");
    const notRepo = scratch("private-tree-nogit-");
    expect(() => createPrivateTree(notRepo, parent)).toThrow(/git ls-files .* failed/);
    expect(spawnSync("ls", [parent], { encoding: "utf8" }).stdout).toBe("");
  });

  it("ERROR: no node_modules holding vitest at or above the root fails loud", () => {
    const orphan = scratch("private-tree-orphan-");
    expect(() => nearestNodeModules(orphan)).toThrow(/no node_modules with vitest/);
  });

  it("BOUNDARY: a root whose own node_modules holds no vitest borrows the nearest ancestor's that does", () => {
    const outer = scratch("private-tree-outer-");
    mkdirSync(join(outer, "node_modules", "vitest"), { recursive: true });
    const inner = join(outer, "wt");
    mkdirSync(join(inner, "node_modules", ".cache"), { recursive: true });
    expect(nearestNodeModules(inner)).toBe(join(outer, "node_modules"));
  });
});

describe("TG-46 running a command from the copy", () => {
  it("HAPPY: the command's cwd is the copy and its exit status is relayed; the copy is gone afterwards", () => {
    const root = fixtureRepo();
    const marker = join(scratch("private-tree-marker-"), "cwd.txt");
    const status = runInPrivateTree(root, "sh", ["-c", `pwd -P > ${marker}; exit 7`]);
    expect(status).toBe(7);
    const cwd = readFileSync(marker, "utf8").trim();
    expect(cwd).not.toBe(realpathSync(root));
    expect(existsSync(cwd)).toBe(false);
  });

  it("NEGATIVE: a command that cannot start throws, never reports success", () => {
    const root = fixtureRepo();
    expect(() => runInPrivateTree(root, "definitely-not-a-program-tg46", [])).toThrow(/could not start/);
  });

  it("ERROR: the CLI without --root or without a command is a usage error (exit 2)", () => {
    const none = spawnSync("bun", [CLI], { encoding: "utf8" });
    expect(none.status).toBe(2);
    expect(none.stderr).toContain("usage");
    const noCommand = spawnSync("bun", [CLI, "--root", REPO, "--"], { encoding: "utf8" });
    expect(noCommand.status).toBe(2);
  });

  it("HAPPY: the CLI relays the command's exit status", () => {
    const root = fixtureRepo();
    const r = spawnSync("bun", [CLI, "--root", root, "--", "sh", "-c", "exit 5"], { encoding: "utf8" });
    expect(r.status).toBe(5);
  });
});

describe("TG-46 rebaseReport", () => {
  it("HAPPY: file names under the copy are rebased onto the real checkout; other names are untouched", () => {
    const dir = scratch("private-tree-report-");
    const report = join(dir, "r.json");
    writeFileSync(report, JSON.stringify({ testResults: [{ name: "/tmp/copy/a/x.test.ts" }, { name: "/elsewhere/y.test.ts" }], other: 1 }));
    rebaseReport(report, "/tmp/copy", "/real");
    const out = JSON.parse(readFileSync(report, "utf8")) as { testResults: { name: string }[]; other: number };
    expect(out.testResults.map((r) => r.name)).toEqual(["/real/a/x.test.ts", "/elsewhere/y.test.ts"]);
    expect(out.other).toBe(1);
  });

  it("ERROR: a missing report, and JSON that is not a vitest report, fail loud", () => {
    const dir = scratch("private-tree-report-");
    expect(() => rebaseReport(join(dir, "absent.json"), "/a", "/b")).toThrow();
    writeFileSync(join(dir, "bad.json"), JSON.stringify({ nope: true }));
    expect(() => rebaseReport(join(dir, "bad.json"), "/a", "/b")).toThrow(/not a vitest JSON report/);
  });

  it("BOUNDARY: a sibling directory sharing the prefix is not rebased", () => {
    const dir = scratch("private-tree-report-");
    const report = join(dir, "r.json");
    writeFileSync(report, JSON.stringify({ testResults: [{ name: "/tmp/copy-other/x.test.ts" }] }));
    rebaseReport(report, "/tmp/copy", "/real");
    expect((JSON.parse(readFileSync(report, "utf8")) as { testResults: { name: string }[] }).testResults[0]?.name).toBe("/tmp/copy-other/x.test.ts");
  });
});
