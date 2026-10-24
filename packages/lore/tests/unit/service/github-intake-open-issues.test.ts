// @reads packages/lore/src/service/github-intake-port.ts
/**
 * `GitHubIntakePort.listOpenIssues` — the plan-close open-issue reader (AC-PCR-4, BR-1372): OPEN issues only, every
 * page, pull requests excluded. A fake runner stands in for `gh`; no process is spawned.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ok } from "@lore/core";
import { GitHubIntakePort } from "../../../src/service/github-intake-port.js";
import type { GhRunner } from "../../../src/service/gh-runner.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function issue(number: number, extra: Record<string, unknown> = {}) {
  return { number, title: `issue ${String(number)}`, state: "open", body: "", labels: [], ...extra };
}

function portWith(stdout: string): { port: GitHubIntakePort; calls: string[][] } {
  const dir = mkdtempSync(join(tmpdir(), "lore-open-issues-"));
  dirs.push(dir);
  const calls: string[][] = [];
  const runner = {
    run: async (args: readonly string[]) => {
      calls.push([...args]);
      return ok({ stdout, stderr: "", exitCode: 0 });
    },
  } as unknown as GhRunner;
  return { port: new GitHubIntakePort({ runner, repo: "o/r", receiptsPath: join(dir, "receipts.jsonl") }), calls };
}

describe("AC-PCR-4 GitHubIntakePort.listOpenIssues", () => {
  it("HAPPY: an open issue only on page 2 is returned, from one paginated open-state call", async () => {
    const pages = [Array.from({ length: 100 }, (_, i) => issue(i + 1000)), [issue(5)]];
    const { port, calls } = portWith(JSON.stringify(pages));
    const listed = await port.listOpenIssues();
    expect(listed.ok && listed.value.map((i) => i.number)).toContain(5);
    expect(listed.ok && listed.value.length).toBe(101);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("--paginate");
    expect(calls[0]?.join(" ")).toContain("state=open");
    expect(calls[0]?.join(" ")).not.toContain("state=all");
  });

  it("NEGATIVE: a closed issue never counts, and a pull request is excluded", async () => {
    const pages = [[issue(1), issue(2, { state: "closed" }), issue(3, { pull_request: { url: "x" } })]];
    const { port } = portWith(JSON.stringify(pages));
    const listed = await port.listOpenIssues();
    expect(listed.ok && listed.value.map((i) => i.number)).toEqual([1]);
  });

  it("ERROR: a malformed payload is an error, never an empty listing", async () => {
    const { port } = portWith("not json");
    const listed = await port.listOpenIssues();
    expect(listed.ok).toBe(false);
  });
});
