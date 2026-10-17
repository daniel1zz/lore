// @reads packages/lore/src/service/resolution-label-port.ts
/**
 * Test scenarios for `GhResolutionLabelPort` — the `gh`-backed
 * `ResolutionLabelPort` implementation
 * (task-skill-implement-wire-a-real-resolutionlabelport-so-the,
 * spec-the-defect-channel-reaches-no-machine-but-its-own-github, AC-GI-4's
 * production-reachability half).
 *
 * Every scenario constructs a REAL `GhRunner` with a scripted, args-routed
 * `execFile` test double (the same DI shape `gh-runner-auth.test.ts` /
 * `gh-runner-env-scrub.test.ts` use) — never a hand-typed object cast to
 * `GhRunner`, so these scenarios also exercise the real `GhRunner.run`
 * error-classification path, not a bypassed one.
 *
 * Six-dimension coverage:
 *   HAPPY     — no prior resolution:* label, target added via one POST.
 *   STATE     — a stale sibling is deleted and the target added (the
 *               convergence AC-GI-4's 3rd criterion names); a no-op case
 *               where the target already matches (zero mutating calls).
 *   BOUNDARY  — two stale siblings (both deleted) and a label name
 *               containing a raw `:` that must be percent-encoded in the
 *               DELETE path.
 *   ERROR     — the initial GET fails (classified by the REAL GhRunner
 *               taxonomy); the GET returns unparsable JSON; a DELETE fails
 *               mid-sequence and the subsequent POST never fires (proves
 *               the "first failure short-circuits" invariant — this is also
 *               the NEGATIVE case: nothing silently continues after a
 *               failed call).
 *   REGRESSION — the source file imports zero `node:child_process` (AC-GI-7's
 *               own single-seam invariant, pinned locally too).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { GhRunner } from "../../../src/service/gh-runner.js";
import { GhResolutionLabelPort } from "../../../src/service/resolution-label-port.js";
import type { GithubIssueRef } from "../../../src/service/resolution-projector.js";

interface GhExecFileOptions {
  env: NodeJS.ProcessEnv;
  maxBuffer: number;
}
interface GhExecFileResult {
  stdout: string;
  stderr: string;
}
type GhExecFile = (args: readonly string[], options: GhExecFileOptions) => Promise<GhExecFileResult>;

/** One captured `execFile` invocation, for asserting exact argv per call. */
interface CapturedCall {
  args: readonly string[];
}

/**
 * Builds an `execFile` test double that routes on argv: each entry in
 * `script` is tried in order via its `match` predicate against the args for
 * THIS call number; the first match wins. Every call (matched or not) is
 * appended to `calls` before routing, so assertions can inspect exactly what
 * was sent even when a later call in the sequence never happens (proving the
 * short-circuit invariant).
 */
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

const REF: GithubIssueRef = { repo: "daniel1zz/lore-e2e-target", issueNumber: 42 };
const LABELS_PATH = "repos/daniel1zz/lore-e2e-target/issues/42/labels";

function isDelete(args: readonly string[]): boolean {
  return args.includes("-X") && args[args.indexOf("-X") + 1] === "DELETE" && args[0] === "api";
}
function isPost(args: readonly string[]): boolean {
  return args.includes("-X") && args[args.indexOf("-X") + 1] === "POST";
}
function isPlainGet(args: readonly string[]): boolean {
  return args[0] === "api" && args[1] === LABELS_PATH && args.length === 2;
}

function okJson(body: unknown): Promise<GhExecFileResult> {
  return Promise.resolve({ stdout: JSON.stringify(body), stderr: "" });
}

describe("GhResolutionLabelPort (AC-GI-4, spec-the-defect-channel-reaches-no-machine-but-its-own-github)", () => {
  it("HAPPY: no existing resolution:* label — lists once, then adds the target with exactly one POST", async () => {
    const calls: CapturedCall[] = [];
    const execFile = scriptedExecFile(calls, [
      { match: isPlainGet, respond: () => okJson([{ name: "bug" }]) },
      { match: isPost, respond: () => okJson({}) },
    ]);
    const port = new GhResolutionLabelPort(new GhRunner({ execFile }));

    const result = await port.setLabel(REF, "resolution:fixed");

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(2);
    // Non-null: the toHaveLength(2) assertion just above proves indices 0
    // and 1 are populated at runtime; noUncheckedIndexedAccess can't see
    // that cross-statement guarantee.
    expect(calls[0]!.args).toEqual(["api", LABELS_PATH]);
    expect(calls[1]!.args).toEqual(["api", LABELS_PATH, "-X", "POST", "-f", "labels[]=resolution:fixed"]);
  });

  it("STATE: a stale resolution:* sibling is deleted and the target added", async () => {
    const calls: CapturedCall[] = [];
    const execFile = scriptedExecFile(calls, [
      { match: isPlainGet, respond: () => okJson([{ name: "resolution:open" }, { name: "bug" }]) },
      { match: isDelete, respond: () => okJson({}) },
      { match: isPost, respond: () => okJson({}) },
    ]);
    const port = new GhResolutionLabelPort(new GhRunner({ execFile }));

    const result = await port.setLabel(REF, "resolution:fixed");

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(3);
    // Non-null: the toHaveLength(3) assertion just above proves indices 1
    // and 2 are populated at runtime; noUncheckedIndexedAccess can't see
    // that cross-statement guarantee.
    expect(calls[1]!.args).toEqual(["api", `${LABELS_PATH}/resolution%3Aopen`, "-X", "DELETE"]);
    expect(calls[2]!.args).toEqual(["api", LABELS_PATH, "-X", "POST", "-f", "labels[]=resolution:fixed"]);
  });

  it("STATE: the target label already present and no stale sibling — zero mutating calls beyond the GET", async () => {
    const calls: CapturedCall[] = [];
    const execFile = scriptedExecFile(calls, [
      { match: isPlainGet, respond: () => okJson([{ name: "resolution:fixed" }, { name: "bug" }]) },
    ]);
    const port = new GhResolutionLabelPort(new GhRunner({ execFile }));

    const result = await port.setLabel(REF, "resolution:fixed");

    expect(result.ok).toBe(true);
    // Only the GET happened — a wrong implementation that always re-POSTs
    // (or re-deletes-then-adds) the current label would fail this exact count.
    expect(calls).toHaveLength(1);
  });

  it("BOUNDARY: two stale siblings are both deleted, and a `:`-bearing label name is percent-encoded in the DELETE path", async () => {
    const calls: CapturedCall[] = [];
    const execFile = scriptedExecFile(calls, [
      {
        match: isPlainGet,
        respond: () => okJson([{ name: "resolution:duplicate" }, { name: "resolution:wontfix" }]),
      },
      { match: isDelete, respond: () => okJson({}) },
      { match: isPost, respond: () => okJson({}) },
    ]);
    const port = new GhResolutionLabelPort(new GhRunner({ execFile }));

    const result = await port.setLabel(REF, "resolution:rejected");

    expect(result.ok).toBe(true);
    const deleteCalls = calls.filter((c) => isDelete(c.args));
    expect(deleteCalls).toHaveLength(2);
    const deletedPaths = deleteCalls.map((c) => c.args[1]);
    expect(deletedPaths).toContain(`${LABELS_PATH}/resolution%3Aduplicate`);
    expect(deletedPaths).toContain(`${LABELS_PATH}/resolution%3Awontfix`);
    // Every colon in the label name is escaped — never a raw `:` in the path.
    for (const p of deletedPaths) expect(p).not.toMatch(/resolution:/);
  });

  it("ERROR: the initial list call fails (gh missing) — returns AUTH_REQUIRED and makes no further calls", async () => {
    const calls: CapturedCall[] = [];
    const execFile: GhExecFile = async (args) => {
      calls.push({ args });
      const failure = new Error("spawn gh ENOENT") as Error & { code?: string };
      failure.code = "ENOENT";
      throw failure;
    };
    const port = new GhResolutionLabelPort(new GhRunner({ execFile }));

    const result = await port.setLabel(REF, "resolution:fixed");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("AUTH_REQUIRED");
    expect(calls).toHaveLength(1);
  });

  it("ERROR: the list call returns unparsable JSON — VALIDATION_ERROR naming the gh_labels_response field", async () => {
    const calls: CapturedCall[] = [];
    const execFile: GhExecFile = async (args) => {
      calls.push({ args });
      return { stdout: "not json at all", stderr: "" };
    };
    const port = new GhResolutionLabelPort(new GhRunner({ execFile }));

    const result = await port.setLabel(REF, "resolution:fixed");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION_ERROR");
      if (result.error.code === "VALIDATION_ERROR") expect(result.error.field).toBe("gh_labels_response");
    }
  });

  it("ERROR (NEGATIVE — no silent continuation): a mid-sequence DELETE failure short-circuits before the POST ever fires", async () => {
    const calls: CapturedCall[] = [];
    const execFile: GhExecFile = async (args) => {
      calls.push({ args });
      if (isPlainGet(args)) return { stdout: JSON.stringify([{ name: "resolution:open" }]), stderr: "" };
      if (isDelete(args)) {
        const failure = new Error("gh: transport failure") as Error & { code?: number; stderr?: string };
        failure.code = 1;
        failure.stderr = "could not resolve host api.github.com";
        throw failure;
      }
      throw new Error(`unexpected call: ${JSON.stringify(args)}`);
    };
    const port = new GhResolutionLabelPort(new GhRunner({ execFile }));

    const result = await port.setLabel(REF, "resolution:fixed");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("TRANSPORT_UNAVAILABLE");
      if (result.error.code === "TRANSPORT_UNAVAILABLE") expect(result.error.retryable).toBe(true);
    }
    // Exactly GET + the failing DELETE — the POST that would follow a
    // successful convergence never runs.
    expect(calls).toHaveLength(2);
    expect(calls.some((c) => isPost(c.args))).toBe(false);
  });

  it("REGRESSION (AC-GI-7): resolution-label-port.ts imports zero node:child_process", () => {
    const sourcePath = fileURLToPath(
      new URL("../../../src/service/resolution-label-port.ts", import.meta.url),
    );
    const source = readFileSync(sourcePath, "utf8");
    expect(/^import.*child_process/m.test(source)).toBe(false);
  });
});
