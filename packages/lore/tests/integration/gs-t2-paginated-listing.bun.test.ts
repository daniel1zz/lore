/**
 * AC-GS-1 — `GitHubIntakePort.listIssues` is complete (paginated), PR-free,
 * all-or-nothing, and costs max(1, ceil(N/100)) requests.
 * (spec-github-owns-issue-report-state-no-mirror-task-work-carries D2; #288)
 *
 * The injected `execFile` stub models GitHub: newest-first pages of 100,
 * `Link: rel="next"` on every page but the last, `-i` response framing.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { GhRunner, type GhExecFile } from "../../src/service/gh-runner.js";
import { GitHubIntakePort } from "../../src/service/github-intake-port.js";

const PAGE_SIZE = 100;

interface StubEntry {
  number: number;
  title: string;
  state: string;
  body: string | null;
  labels: { name: string }[];
  state_reason?: string | null;
  pull_request?: { url: string };
}

/** `total` entries numbered `total..1` (newest first); numbers in `prNumbers` carry `pull_request`. */
function makeEntries(total: number, prNumbers: readonly number[]): StubEntry[] {
  const entries: StubEntry[] = [];
  for (let n = total; n >= 1; n -= 1) {
    entries.push({
      number: n,
      title: `issue ${n}`,
      state: n % 2 === 0 ? "open" : "closed",
      body: `body ${n}`,
      labels: [],
      state_reason: n % 2 === 0 ? null : "completed",
      ...(prNumbers.includes(n) ? { pull_request: { url: `https://example.invalid/pr/${n}` } } : {}),
    });
  }
  return entries;
}

interface Stub {
  readonly execFile: GhExecFile;
  readonly calls: string[][];
}

/** Serves `entries` page by page; `failPage` makes that page reject as a transport failure. */
function makeStub(entries: readonly StubEntry[], failPage?: number): Stub {
  const calls: string[][] = [];
  const execFile: GhExecFile = async (args) => {
    calls.push([...args]);
    const path = args[1] ?? "";
    const page = Number(/[?&]page=(\d+)/.exec(path)?.[1] ?? "1");
    if (failPage === page) {
      throw Object.assign(new Error("boom"), { code: 1, stderr: "could not resolve host: api.github.com" });
    }
    const slice = entries.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    const hasNext = page * PAGE_SIZE < entries.length;
    const link = hasNext
      ? `Link: <https://api.github.com/repositories/1/issues?state=all&per_page=100&page=${page + 1}>; rel="next", ` +
        `<https://api.github.com/repositories/1/issues?state=all&per_page=100&page=99>; rel="last"\r\n`
      : "";
    return { stdout: `HTTP/2.0 200 OK\r\nContent-Type: application/json\r\n${link}\r\n${JSON.stringify(slice)}`, stderr: "" };
  };
  return { execFile, calls };
}

function makePort(stub: Stub): GitHubIntakePort {
  const dir = mkdtempSync(join(tmpdir(), "gs-t2-"));
  return new GitHubIntakePort({
    runner: new GhRunner({ execFile: stub.execFile, env: {} }),
    repo: "owner/repo",
    receiptsPath: join(dir, "receipts.jsonl"),
  });
}

describe("AC-GS-1 paginated PR-free listing", () => {
  it("AC-GS-1 reads 3 pages (100/100/52), drops 2 PRs, keeps #1 from page 3", async () => {
    const stub = makeStub(makeEntries(252, [200, 77]));
    const result = await makePort(stub).listIssues();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.issues).toHaveLength(250);
    expect(result.value.pages).toBe(3);
    const numbers = result.value.issues.map((issue) => issue.number);
    expect(numbers).toContain(1);
    expect(numbers).not.toContain(200);
    expect(numbers).not.toContain(77);
    expect(stub.calls).toHaveLength(3);
    expect(result.value.issues.find((issue) => issue.number === 1)?.state_reason).toBe("completed");
  });

  it("AC-GS-1 a failing page 2 fails the whole listing with that page's code and returns no issues", async () => {
    const stub = makeStub(makeEntries(252, [200, 77]), 2);
    const result = await makePort(stub).listIssues();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("TRANSPORT_UNAVAILABLE");
    expect(result).not.toHaveProperty("value");
    expect(stub.calls).toHaveLength(2);
  });

  it.each([
    [0, 1],
    [1, 1],
    [99, 1],
    [100, 1],
    [101, 2],
    [250, 3],
  ])("AC-GS-1 N=%i issues cost max(1, ceil(N/100)) = %i requests", async (total, expectedRequests) => {
    const stub = makeStub(makeEntries(total, []));
    const result = await makePort(stub).listIssues();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.issues).toHaveLength(total);
    expect(stub.calls).toHaveLength(Math.max(1, Math.ceil(total / 100)));
    expect(stub.calls).toHaveLength(expectedRequests);
    expect(result.value.pages).toBe(expectedRequests);
  });

  it("AC-GS-1 an empty repository makes exactly one request", async () => {
    const stub = makeStub([]);
    const result = await makePort(stub).listIssues();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.issues).toEqual([]);
    expect(stub.calls).toHaveLength(1);
  });

  it("AC-GS-1 a next link that does not advance fails loud instead of looping", async () => {
    const execFile: GhExecFile = async () => ({
      stdout: `HTTP/2.0 200 OK\r\nLink: <https://api.github.com/x?page=1>; rel="next"\r\n\r\n[]`,
      stderr: "",
    });
    const result = await makePort({ execFile, calls: [] }).listIssues();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });
});
