/**
 * parseGitVersion + the pre-write git-version refusal of `scaffoldProject` (BR-1343: the main-ref guard needs git >= 2.46).
 * The end-to-end refusal through the real CLI is the oracle of AC-MG-3; this file covers the parser boundary
 * and the flow contract with a fake exec: refusal names the version and writes nothing.
 *
 * @spec_ref BR-1246
 */
import { describe, expect, it } from "vitest";
import { parseGitVersion, scaffoldProject, type ProjectScaffoldFlowDeps } from "../../../src/flows/setup-project-flow.js";

describe("parseGitVersion", () => {
  it("reads major.minor from a plain and an Apple version line", () => {
    expect(parseGitVersion("git version 2.28.0\n")).toMatchObject({ major: 2, minor: 28 });
    expect(parseGitVersion("git version 2.39.3 (Apple Git-145)")).toMatchObject({ major: 2, minor: 39 });
  });

  it("returns undefined for text that is not a git version line", () => {
    expect(parseGitVersion("")).toBeUndefined();
    expect(parseGitVersion("command not found: git")).toBeUndefined();
  });
});

describe("scaffoldProject git-version guard", () => {
  function depsWithGit(stdout: string, code: number): { deps: ProjectScaffoldFlowDeps; writes: string[] } {
    const writes: string[] = [];
    const deps = {
      exec: { run: async () => ({ code, stdout, stderr: "" }) },
      fs: new Proxy({}, { get: () => () => { writes.push("fs"); throw new Error("fs must not be touched"); } }),
      initCorpus: async () => { writes.push("init"); throw new Error("init must not run"); },
      assets: { read: () => { writes.push("assets"); throw new Error("assets must not be read"); } },
    } as unknown as ProjectScaffoldFlowDeps;
    return { deps, writes };
  }

  it("refuses git 2.45.2 naming the version and the 2.46 floor before any write", async () => {
    const { deps, writes } = depsWithGit("git version 2.45.2\n", 0);
    const result = await scaffoldProject(deps, { repoDir: "/tmp/never-written" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const text = JSON.stringify(result.error);
    expect(text).toContain("2.45.2");
    expect(text).toContain("git 2.46");
    expect(writes).toEqual([]);
  });

  it("refuses an unreadable version rather than assuming it is new enough", async () => {
    const { deps, writes } = depsWithGit("", 127);
    const result = await scaffoldProject(deps, { repoDir: "/tmp/never-written" });
    expect(result.ok).toBe(false);
    expect(writes).toEqual([]);
  });
});
