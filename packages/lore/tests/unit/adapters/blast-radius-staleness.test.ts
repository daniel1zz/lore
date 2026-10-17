/**
 * AC-CT-4 (spec-corpus-truthfulness): staleness is measured by blast radius via
 * `git diff --quiet <recorded HEAD> HEAD -- <paths>`, on a REAL throwaway repo.
 * Halves (a)-(d) plus falsifier controls and resolver unit cases.
 * @reads git
 * @spawns git
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SpawnGitPort } from "../../../src/service/rule-state-git-port.js";
import { gitDiffChangedSince } from "../../../src/adapters/real-git-port.js";
import {
  blastRadiusChanged,
  readStampVerdict,
  resolveBlastRadiusPaths,
} from "../../../src/service/gate-predicates.js";

let repo: string;
const git = (...args: string[]): string =>
  execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
const commit = (msg: string): string => {
  git("add", "-A");
  git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", msg);
  return git("rev-parse", "HEAD");
};

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "ct4-"));
  git("init", "-q");
  mkdirSync(join(repo, "packages/x"), { recursive: true });
  writeFileSync(join(repo, "packages/x/a.test.ts"), "1\n");
  writeFileSync(join(repo, "keep.txt"), "k\n");
  writeFileSync(join(repo, "del.txt"), "d\n");
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

const CMD = "bunx --bun vitest run packages/x/a.test.ts";
const measure = (head: string, command: string, anchors: string[] = []) =>
  blastRadiusChanged({ command, fileAnchors: anchors, recordedHead: head }, new SpawnGitPort(repo));

describe("AC-CT-4 blast radius staleness", () => {
  it("(a) a peer commit INSIDE the radius classifies stale", () => {
    const base = commit("base");
    writeFileSync(join(repo, "packages/x/a.test.ts"), "2\n");
    commit("peer inside");
    const m = measure(base, CMD);
    expect(m).toEqual({ status: "measured", changed: true });
    expect(readStampVerdict({ stamp: "stamped", radius: m })).toBe("stale");
  });

  it("(b) a peer commit touching ONLY paths outside the radius stays bound", () => {
    const base = commit("base");
    writeFileSync(join(repo, "keep.txt"), "k2\n");
    commit("peer outside");
    const m = measure(base, CMD);
    expect(m).toEqual({ status: "measured", changed: false });
    expect(readStampVerdict({ stamp: "stamped", radius: m })).toBe("bound");
  });

  it("(c) a pathspec CREATED after the recorded HEAD is stale; a never-existing one stays bound", () => {
    const base = commit("base");
    writeFileSync(join(repo, "created.txt"), "c\n");
    commit("peer creates");
    expect(measure(base, "bun run typecheck", ["created.txt"])).toEqual({ status: "measured", changed: true });
    expect(measure(base, "bun run typecheck", ["never.txt"])).toEqual({ status: "measured", changed: false });
  });

  it("(c') a pathspec DELETED after the recorded HEAD is stale", () => {
    const base = commit("base");
    git("rm", "-q", "del.txt");
    commit("peer deletes");
    expect(measure(base, "bun run typecheck", ["del.txt"])).toEqual({ status: "measured", changed: true });
  });

  it("(d) an AC whose command yields no pathspec is unmeasured; a sibling yielding one stays bound", () => {
    const base = commit("base");
    const none = measure(base, "bun run typecheck");
    expect(none).toEqual({ status: "unmeasured" });
    expect(readStampVerdict({ stamp: "stamped", radius: none })).toBe("radius_unmeasured");
    expect(measure(base, CMD)).toEqual({ status: "measured", changed: false });
  });

  it("falsifier: ancestry would read fine while a radius path changed (diff is the decision)", () => {
    const base = commit("base");
    writeFileSync(join(repo, "packages/x/a.test.ts"), "3\n");
    commit("peer");
    const ancestry = new SpawnGitPort(repo).isAncestor(base);
    expect(ancestry.ok && ancestry.value).toBe(true);
    expect(measure(base, CMD)).toEqual({ status: "measured", changed: true });
  });

  it("an unknown recorded head (git cannot answer) is unmeasured, never bound", () => {
    commit("base");
    expect(measure("0".repeat(40), CMD)).toEqual({ status: "unmeasured" });
  });

  it("shares ONE diff implementation: SpawnGitPort.changedSince equals gitDiffChangedSince", () => {
    const base = commit("base");
    writeFileSync(join(repo, "keep.txt"), "z\n");
    commit("peer");
    expect(new SpawnGitPort(repo).changedSince(base, ["keep.txt"])).toEqual(
      gitDiffChangedSince(repo, base, ["keep.txt"]),
    );
  });
});

describe("resolveBlastRadiusPaths", () => {
  it("unions command test-file tokens with task anchors, de-duplicated", () => {
    expect(resolveBlastRadiusPaths(CMD, ["src/a.ts", "packages/x/a.test.ts"])).toEqual([
      "packages/x/a.test.ts",
      "src/a.ts",
    ]);
  });
  it("rejects syntactically invalid pathspecs (absolute, parent-escaping, option-like, empty)", () => {
    expect(resolveBlastRadiusPaths("bun run typecheck", ["/etc/passwd", "../x", "--output=x", "", "  "])).toEqual([]);
  });
  it("does not require existence", () => {
    expect(resolveBlastRadiusPaths("bun run typecheck", ["no/such/file.ts"])).toEqual(["no/such/file.ts"]);
  });
});
