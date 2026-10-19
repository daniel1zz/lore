// @reads assets/project/reference-transaction
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { copyShippedGuardTo } from "../../integration/support/main-guard-repo.js";
import { IntegrateService, type GitOutcome, type IntegrateDeps } from "../../../src/service/integrate-service.js";

function harness(remote: GitOutcome) {
  const calls: string[][] = [];
  const hooks = mkdtempSync(join(tmpdir(), "lore-remote-listing-hooks-"));
  copyShippedGuardTo(hooks);
  const git: IntegrateDeps["git"] = (_cwd, args) => {
    calls.push([...args]);
    // the guard precondition runs before every other git call: the fake answers it as git >= 2.46 with the shipped hook installed
    if (args[0] === "--version") return { status: 0, stdout: "git version 2.46.0\n", stderr: "" };
    if (args.includes("--git-path") && args.includes("hooks")) return { status: 0, stdout: `${hooks}\n`, stderr: "" };
    if (args[0] === "remote") return remote;
    return { status: 1, stdout: "", stderr: "" }; // every other git call: rev-parse finds nothing
  };
  const unused = (): never => {
    throw new Error("must not be reached");
  };
  const service = new IntegrateService({
    git,
    lease: { acquire: unused },
    corpus: { take: unused, remove: unused },
    runFloor: unused,
    ledger: {} as IntegrateDeps["ledger"],
    attempts: {} as IntegrateDeps["attempts"],
    projectRoot: "/nowhere",
    worktreesRoot: "/nowhere/wt",
    log: () => {},
  });
  const run = (branch: string) => service.integrate({ branch, sessionId: "s1", floorCommand: "true" });
  const sub = (name: string) => calls.filter((c) => c[0] === name);
  return { run, sub };
}

describe("integrate: git remote that cannot list remotes", () => {
  it("refuses a remote-tracking argument with the git-failure error naming git remote, no fetch, no ref move", async () => {
    const h = harness({ status: 1, stdout: "", stderr: "fatal: not a git repository" });
    const result = await h.run("origin/feature");
    expect(result).toEqual({
      ok: false,
      error: { code: "STORE_ERROR", message: "integrate: git remote failed (git exit 1): fatal: not a git repository" },
    });
    expect(h.sub("fetch")).toEqual([]);
    expect(h.sub("update-ref")).toEqual([]);
    // no branch resolution happened (the guard's own `rev-parse --git-path hooks` read is not one)
    expect(h.sub("rev-parse").filter((c) => c.includes("--verify"))).toEqual([]);
  });

  it("a rev with no slash resolves locally: git remote never asked, no fetch", async () => {
    const h = harness({ status: 1, stdout: "", stderr: "boom" });
    const result = await h.run("feature");
    expect(result).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR", field: "branch" } });
    expect(h.sub("remote")).toEqual([]);
    expect(h.sub("fetch")).toEqual([]);
  });

  it("a first segment that is not a configured remote resolves locally with no fetch", async () => {
    const h = harness({ status: 0, stdout: "origin\nupstream\n", stderr: "" });
    const result = await h.run("feature/x");
    expect(result).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR", field: "branch", value: "feature/x" } });
    expect(h.sub("remote")).toHaveLength(1);
    expect(h.sub("fetch")).toEqual([]);
    expect(h.sub("update-ref")).toEqual([]);
  });
});
