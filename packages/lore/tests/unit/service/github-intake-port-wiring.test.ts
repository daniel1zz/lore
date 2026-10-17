// @reads packages/lore/src/service/github-intake-port.ts
// @layer service-intake-port-wiring
/**
 * @spec_ref spec-the-defect-channel-reaches-no-machine-but-its-own-github AC-GI-1
 * @task task-skill-implement-githubintakeport-and-the-live-filing-path
 *
 * Structural proof that `GitHubIntakePort.fileIssue` actually CALLS
 * `frontMatterCodec` (`assembleIssueBody`, `@lore/core`) and `ReceiptLogV2`
 * (`service/receipt-log-v2.ts`) — never a byte-identical inline
 * reimplementation of front-matter serialisation that would produce a
 * passing behavioural check while leaving those two modules zero-caller.
 * That exact false-green shape is named, verbatim, by this task's own
 * "Structural" acceptance criterion — the four-times-measured pattern this
 * plan exists to close off.
 *
 * TWO CONJUNCTIVE checks (a behavioural check ALONE is satisfiable by a
 * copy; a static check alone cannot see whether the import is actually
 * exercised at runtime):
 *   (i) STATIC — `github-intake-port.ts`'s source text contains a real
 *       import statement naming `assembleIssueBody`/`redactReporterIdentity`
 *       from `"@lore/core"`, AND `ReceiptLogV2` from the service layer's
 *       `receipt-log-v2.js`.
 *   (ii) BEHAVIOURAL — an injected spy on the REAL `assembleIssueBody`
 *       (via `vi.mock`'s `importOriginal`, so it still calls through) and
 *       on `ReceiptLogV2.prototype`'s `appendIntent`/`appendOutcome` (the
 *       real methods, spied via prototype — `GitHubIntakePort` constructs
 *       its OWN `ReceiptLogV2` instance internally, so there is no
 *       constructor seam to inject a fake through) prove ONE `fileIssue`
 *       call invokes all three exactly once, AND that the `gh api ... -f
 *       body=<...>` argv element the port sends is BYTE-IDENTICAL to the
 *       codec spy's own return value — the read that specifically catches
 *       a "call it, then discard the result and rebuild the body by hand"
 *       variant of the false-green.
 *
 * Runner: vitest (no `bun:sqlite` — `github-intake-port.ts` and its
 * dependencies touch only `node:child_process` via the injected `GhRunner`,
 * which this file never constructs with a real spawn — see the scripted
 * `execFile` double below, same shape `resolution-label-port.test.ts` and
 * `gh-runner-auth.test.ts` already use).
 *
 * Six-dimension coverage note: this file's scope is exactly the structural
 * invariant above (HAPPY: one filing, both dependencies called exactly
 * once, body byte-identical). `fileIssue`'s OWN error taxonomy (a failed
 * `gh api` create call, a malformed response, an `appendIntent`/
 * `appendOutcome` IO failure) is covered by `github-intake-port.ts`'s own
 * JSDoc contract and exercised end-to-end by the paired real-network e2e
 * (`tests/integration/cli/github-intake-reach.bun.test.ts`) — duplicating
 * those paths here would blur which file is the oracle for which concern.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

vi.mock("@lore/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lore/core")>();
  return {
    ...actual,
    // reason: wraps the REAL implementation (vi.fn(fn) delegates to `fn`) —
    // this is a SPY, not a stub. Every other `@lore/core` export (ok/err/
    // redactReporterIdentity/etc.) stays untouched.
    assembleIssueBody: vi.fn(actual.assembleIssueBody),
  };
});

import { assembleIssueBody } from "@lore/core";
import { GhRunner } from "../../../src/service/gh-runner.js";
import { GitHubIntakePort } from "../../../src/service/github-intake-port.js";
import { ReceiptLogV2 } from "../../../src/service/receipt-log-v2.js";

const PORT_SOURCE_PATH = fileURLToPath(
  new URL("../../../src/service/github-intake-port.ts", import.meta.url),
);

interface GhExecFileOptions {
  env: NodeJS.ProcessEnv;
  maxBuffer: number;
}
interface GhExecFileResult {
  stdout: string;
  stderr: string;
}
type GhExecFile = (args: readonly string[], options: GhExecFileOptions) => Promise<GhExecFileResult>;

/** One captured `execFile` invocation — mirrors `resolution-label-port.test.ts`'s own double shape. */
interface CapturedCall {
  args: readonly string[];
}

/** Routes on argv: the first matching script entry wins. Every call is recorded before routing. */
function scriptedExecFile(
  calls: CapturedCall[],
  script: ReadonlyArray<{
    match: (args: readonly string[]) => boolean;
    respond: () => Promise<GhExecFileResult>;
  }>,
): GhExecFile {
  return async (args) => {
    calls.push({ args });
    for (const step of script) {
      if (step.match(args)) return step.respond();
    }
    throw new Error(`scriptedExecFile: no script entry matched args ${JSON.stringify(args)}`);
  };
}

function okJson(body: unknown): Promise<GhExecFileResult> {
  return Promise.resolve({ stdout: JSON.stringify(body), stderr: "" });
}

function isIssueCreate(args: readonly string[]): boolean {
  return args[0] === "api" && args[1] === "repos/acme/widget/issues" && args.includes("-X");
}

describe("(i) STATIC: github-intake-port.ts imports frontMatterCodec + ReceiptLogV2 as real values", () => {
  const source = readFileSync(PORT_SOURCE_PATH, "utf8");

  it("imports assembleIssueBody and redactReporterIdentity from @lore/core", () => {
    expect(source).toMatch(/import\s*\{[^}]*\bassembleIssueBody\b[^}]*\}\s*from\s*["']@lore\/core["']/);
    expect(source).toMatch(/import\s*\{[^}]*\bredactReporterIdentity\b[^}]*\}\s*from\s*["']@lore\/core["']/);
  });

  it("imports ReceiptLogV2 (as a value, not merely a type) from the service layer's receipt-log-v2.js", () => {
    expect(source).toMatch(/import\s*\{[^}]*\bReceiptLogV2\b[^}]*\}\s*from\s*["'][^"']*receipt-log-v2\.js["']/);
    // Not a `import type` — a value import is what lets `new ReceiptLogV2(...)` construct one.
    expect(source).toMatch(/^\s*import\s*\{[^}]*\bReceiptLogV2\b/m);
    expect(source).not.toMatch(/import type\s*\{[^}]*\bReceiptLogV2\b/);
  });

  it("actually constructs a ReceiptLogV2 instance (new ReceiptLogV2(...)) — not merely referencing the type", () => {
    expect(source).toMatch(/new ReceiptLogV2\(/);
  });
});

describe("(ii) BEHAVIOURAL: one fileIssue call invokes assembleIssueBody + appendIntent + appendOutcome exactly once each, body byte-identical to the codec's return value", () => {
  it("HAPPY: filing one issue", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "github-intake-port-wiring-"));
    const receiptsPath = join(tmpDir, "issue-receipts-v2.jsonl");

    const appendIntentSpy = vi.spyOn(ReceiptLogV2.prototype, "appendIntent");
    const appendOutcomeSpy = vi.spyOn(ReceiptLogV2.prototype, "appendOutcome");
    const assembleSpy = assembleIssueBody as unknown as ReturnType<typeof vi.fn>;
    assembleSpy.mockClear();

    const calls: CapturedCall[] = [];
    const execFile = scriptedExecFile(calls, [
      {
        match: isIssueCreate,
        respond: () => okJson({ number: 42, html_url: "https://github.com/acme/widget/issues/42" }),
      },
    ]);
    const runner = new GhRunner({ execFile });
    const port = new GitHubIntakePort({ runner, repo: "acme/widget", receiptsPath });

    try {
      const result = await port.fileIssue({
        title: "structural probe",
        description: "body text for the structural probe",
        severity: "high",
        category: "structural-probe",
        tags: ["a", "b"],
        identity: {
          corpusRoot: "/Users/tester/my-corpus",
          home: "/Users/tester",
          rootPrdId: "prd-x",
          actor: "tester",
          actorSource: "explicit",
        },
      });

      expect(result.ok).toBe(true);

      // Conjunct (ii), part 1: called exactly once each.
      expect(assembleSpy).toHaveBeenCalledTimes(1);
      expect(appendIntentSpy).toHaveBeenCalledTimes(1);
      expect(appendOutcomeSpy).toHaveBeenCalledTimes(1);

      // Conjunct (ii), part 2: the filed body is BYTE-IDENTICAL to the codec
      // spy's own return value — catches a "call it, discard the result,
      // rebuild the body some other way" variant of the false-green.
      const createCall = calls.find((c) => isIssueCreate(c.args));
      expect(createCall, `expected an issue-create call among: ${JSON.stringify(calls)}`).toBeDefined();
      const bodyArg = createCall!.args.find((a) => a.startsWith("body="));
      expect(bodyArg, `expected a 'body=' argv element among: ${JSON.stringify(createCall!.args)}`).toBeDefined();
      const filedBody = (bodyArg as string).slice("body=".length);

      const codecReturnValue = assembleSpy.mock.results[0]?.value;
      expect(typeof codecReturnValue).toBe("string");
      expect(filedBody).toBe(codecReturnValue);

      // And the filed body genuinely carries the six-field front-matter set
      // assembleIssueBody actually produced (not a coincidental match).
      expect(filedBody).toContain("idempotency_key");
      expect(filedBody).toContain("structural-probe");
    } finally {
      appendIntentSpy.mockRestore();
      appendOutcomeSpy.mockRestore();
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("NEGATIVE CONTROL: a hand-rolled body that merely LOOKS like the codec's output would NOT satisfy this test's byte-identity assertion", () => {
    // reason: proves the byte-identity check above has discriminating power
    // — it is not vacuously true for any string containing the right
    // substrings. A body built by concatenation instead of calling the
    // spy could differ by even one byte (key order, whitespace) and this
    // assertion style would catch it.
    const real = assembleIssueBody(
      {
        severity: "high",
        category: "structural-probe",
        tags: ["a", "b"],
        reporter_corpus: "~/my-corpus",
        reporter_root_prd: "prd-x",
        idempotency_key: "same-key",
      },
      "body text for the structural probe",
      "tester",
    );
    const handRolled =
      `---\n{"idempotency_key":"same-key","severity":"high","category":"structural-probe",` +
      `"tags":["a","b"],"reporter_corpus":"~/my-corpus","reporter_root_prd":"prd-x"}\n---\n\n` +
      `body text for the structural probe\n\nReported by: tester`;
    // Different KEY ORDER in the JSON.stringify output is enough to differ byte-for-byte,
    // even though every field/value is identical — exactly the discriminating power claimed.
    expect(handRolled).not.toBe(real);
  });
});
