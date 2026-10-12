/**
 * AC-IC-3 — `GhIssueCloser`, the real `IssueCloser`, over an INJECTED gh runner
 * (spec-archiving-the-work-that-resolves-a-defect-report-closes D2). No subprocess and no network: the
 * runner is a scripted fake that records every argv.
 *   HAPPY:      close as completed (PATCH state=closed + state_reason=completed), comment, label.
 *   NEGATIVE:   a non-zero gh exit on close is a typed failure carrying stderr; nothing is retried.
 *   BOUNDARY:   an already-closed issue is a no-op success that makes no write call.
 *   ERROR:      a 403 on the label call is a typed label failure that does not undo the close; a malformed
 *               issue payload is a VALIDATION_ERROR, never an assumed-empty state.
 *   REGRESSION: swallowing the label error would make the 403 case report success.
 */

import { describe, expect, it } from "vitest";
import { err, ok } from "@lore/core";
import type { LoreError, Result } from "@lore/core";

import type { GhRunner } from "../../../src/service/gh-runner.js";
import { GhIssueCloser } from "../../../src/service/issue-closer-port.js";
import type { GithubIssueRef } from "../../../src/service/resolution-projector.js";

const REF: GithubIssueRef = { repo: "acme/widget", issueNumber: 7, repo_id: 123 };
const ISSUE_PATH = "repos/acme/widget/issues/7";

type Handler = (args: readonly string[]) => Result<{ stdout: string }, LoreError> | undefined;

/** Scripted runner: first handler returning a value answers; no handler answering is a test bug. */
function scriptedRunner(...handlers: Handler[]): { runner: GhRunner; calls: string[][] } {
  const calls: string[][] = [];
  const runner = {
    async run(args: readonly string[]): Promise<Result<{ stdout: string }, LoreError>> {
      calls.push([...args]);
      for (const handler of handlers) {
        const answer = handler(args);
        if (answer !== undefined) return answer;
      }
      throw new Error(`unscripted gh call: ${args.join(" ")}`);
    },
  } as unknown as GhRunner;
  return { runner, calls };
}

const issueJson = (state: "open" | "closed", labels: string[] = []): string =>
  JSON.stringify({ state, labels: labels.map((name) => ({ name })) });

const answerRead = (state: "open" | "closed", labels: string[] = []): Handler => (args) =>
  args.length === 2 && args[0] === "api" && args[1] === ISSUE_PATH ? ok({ stdout: issueJson(state, labels) }) : undefined;

const stderrFailure = (message: string): LoreError => ({
  code: "VALIDATION_ERROR",
  field: "gh",
  message,
  value: message,
});

describe("AC-IC-3: GhIssueCloser.closeIssue", () => {
  it("HAPPY: an open issue is closed as completed with ONE PATCH carrying state=closed and state_reason=completed", async () => {
    const { runner, calls } = scriptedRunner(answerRead("open"), (args) =>
      args.includes("PATCH") ? ok({ stdout: "{}" }) : undefined,
    );

    const result = await new GhIssueCloser(runner).closeIssue(REF);

    expect(result).toEqual(ok({ alreadyClosed: false }));
    expect(calls).toEqual([
      ["api", ISSUE_PATH],
      ["api", ISSUE_PATH, "-X", "PATCH", "-f", "state=closed", "-f", "state_reason=completed"],
    ]);
  });

  it("BOUNDARY: an already-closed issue is a no-op success — no write call is made", async () => {
    const { runner, calls } = scriptedRunner(answerRead("closed"));

    const result = await new GhIssueCloser(runner).closeIssue(REF);

    expect(result).toEqual(ok({ alreadyClosed: true }));
    expect(calls).toEqual([["api", ISSUE_PATH]]);
  });

  it("NEGATIVE: a non-zero gh exit on the close call is a typed failure carrying stderr, and is NOT retried", async () => {
    const { runner, calls } = scriptedRunner(answerRead("open"), (args) =>
      args.includes("PATCH") ? err(stderrFailure("gh: HTTP 502 Bad Gateway (api.github.com)")) : undefined,
    );

    const result = await new GhIssueCloser(runner).closeIssue(REF);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({ code: "VALIDATION_ERROR" });
    expect("message" in result.error && result.error.message).toContain("HTTP 502 Bad Gateway");
    expect(calls.filter((call) => call.includes("PATCH"))).toHaveLength(1);
  });

  it("ERROR: a failing state read is returned as-is and nothing is written", async () => {
    const { runner, calls } = scriptedRunner(() => err(stderrFailure("gh: HTTP 404 Not Found")));

    const result = await new GhIssueCloser(runner).closeIssue(REF);

    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it("ERROR: a malformed issue payload is a VALIDATION_ERROR, never an assumed state", async () => {
    const { runner } = scriptedRunner(() => ok({ stdout: "<html>not json</html>" }));

    const result = await new GhIssueCloser(runner).readIssue(REF);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({ code: "VALIDATION_ERROR", field: "gh_issue_response" });
  });
});

describe("AC-IC-3: GhIssueCloser.readIssue / commentIssue", () => {
  it("HAPPY: readIssue returns the state and the label names", async () => {
    const { runner } = scriptedRunner(answerRead("closed", ["resolution:fixed", "bug"]));

    expect(await new GhIssueCloser(runner).readIssue(REF)).toEqual(
      ok({ state: "closed", labels: ["resolution:fixed", "bug"] }),
    );
  });

  it("HAPPY: commentIssue posts the body as one POST argument", async () => {
    const { runner, calls } = scriptedRunner((args) => (args.includes("POST") ? ok({ stdout: "{}" }) : undefined));

    const result = await new GhIssueCloser(runner).commentIssue(REF, "Fixed by plan plan-x (archived 2026-10-12)");

    expect(result).toEqual(ok(undefined));
    expect(calls).toEqual([
      ["api", `${ISSUE_PATH}/comments`, "-X", "POST", "-f", "body=Fixed by plan plan-x (archived 2026-10-12)"],
    ]);
  });

  it("ERROR: a failing comment call is returned, not swallowed", async () => {
    const { runner } = scriptedRunner(() => err(stderrFailure("gh: HTTP 500")));

    const result = await new GhIssueCloser(runner).commentIssue(REF, "x");

    expect(result.ok).toBe(false);
  });
});

describe("AC-IC-3: GhIssueCloser.labelIssue", () => {
  it("HAPPY: converges to the label — lists current labels, then adds the missing one", async () => {
    const { runner, calls } = scriptedRunner(
      (args) => (args[1] === `${ISSUE_PATH}/labels` && args.length === 2 ? ok({ stdout: "[]" }) : undefined),
      (args) => (args.includes("POST") ? ok({ stdout: "[]" }) : undefined),
    );

    const result = await new GhIssueCloser(runner).labelIssue(REF, "resolution:fixed");

    expect(result).toEqual(ok(undefined));
    expect(calls[calls.length - 1]).toEqual(["api", `${ISSUE_PATH}/labels`, "-X", "POST", "-f", "labels[]=resolution:fixed"]);
  });

  it("ERROR: a 403 on the label add is a typed label failure, and the close stands (the earlier close is not repeated or reverted)", async () => {
    const forbidden = stderrFailure("gh: HTTP 403 Resource not accessible by personal access token");
    const { runner, calls } = scriptedRunner(
      answerRead("open"),
      (args) => (args.includes("PATCH") ? ok({ stdout: "{}" }) : undefined),
      (args) => (args[1] === `${ISSUE_PATH}/labels` && args.length === 2 ? ok({ stdout: "[]" }) : undefined),
      (args) => (args.includes("POST") && args.includes("labels[]=resolution:fixed") ? err(forbidden) : undefined),
    );
    const closer = new GhIssueCloser(runner);

    const closed = await closer.closeIssue(REF);
    const labelled = await closer.labelIssue(REF, "resolution:fixed");

    expect(closed).toEqual(ok({ alreadyClosed: false }));
    expect(labelled.ok).toBe(false);
    if (labelled.ok) return;
    expect("message" in labelled.error && labelled.error.message).toContain("HTTP 403");
    expect(calls.filter((call) => call.includes("PATCH"))).toHaveLength(1);
    expect(calls.some((call) => call.includes("DELETE"))).toBe(false);
  });
});
