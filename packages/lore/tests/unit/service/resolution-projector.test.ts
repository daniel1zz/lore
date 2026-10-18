/**
 * RED-first scenarios for `ResolutionProjector` — the one-way projection of the
 * corpus-computed 9-state resolution onto a GitHub `resolution:<state>` label
 * (spec-the-defect-channel-reaches-no-machine-but-its-own-github, Scope entry
 * `ResolutionProjector`; AC-GI-4).
 *
 * `packages/lore/src/service/resolution-projector.ts` DOES NOT EXIST YET — this
 * file is authored RED, before the paired implementation task
 * (`task-skill-implement-resolutionprojector-invoked-from-lore`) lands it. The
 * whole file is expected to fail at MODULE RESOLUTION (missing module), not at
 * an assertion — that is the correct RED signal for this task
 * (`task-skill-test-projector-9-state-round-trip-and-its-live-call`).
 *
 * ## The contract this file pins for the implementer
 *
 * Since the module does not exist, this file's imports below ARE the
 * contract the paired implementation task must satisfy:
 *   - `resolutionToLabel(state: IssueResolution): string` — pure, `resolution:<state>`.
 *   - `labelToResolution(label: string): IssueResolution | undefined` — pure inverse;
 *     `undefined` on anything that isn't a real member (defensive, never throws).
 *   - `ResolutionLabelPort` — the ONE injected write capability
 *     (`setLabel(ref, label): Promise<Result<void, LoreError>>`); the projector
 *     never imports a concrete GitHub client.
 *   - `ResolutionProjector` — `new ResolutionProjector(port)`, then
 *     `project(resolution: IssueResolution, ref: GithubIssueRef): Promise<Result<void, LoreError>>`.
 *     Write-only: it never reads a label back (Per-Field Authority table,
 *     "read back as truth: never" — reading is the SEPARATE AC-GI-5 drift
 *     detector's job, a different file: `resolution-label-non-authority.test.ts`).
 *   - The live call site is `lore issue resolve` (`commands/issue.ts`), reached
 *     through a NEW `app.resolutionProjector` field on the `App` composition
 *     root (`app.ts`) — never a `ResolutionProjector` constructed inline inside
 *     `issue.ts`'s `run()`, which would make it untestable from the app-level
 *     seam every other command's DI already goes through.
 *
 * ## Why scenario 3/5 mock `loader.js` instead of importing a real `App`
 *
 * `commands/issue.ts` statically imports `loadLoreApp` from `../loader.js`,
 * which transitively pulls in `bun:sqlite` — unresolvable under vitest
 * (project CLAUDE.md: "bun:sqlite is external to vitest"; the sibling
 * `foreign-corpus-write-adapters.test.ts` states the same constraint verbatim).
 * `vi.mock("../../../src/adapters/cli/loader.js", ...)` replaces that module
 * for EVERY importer in the graph — including `commands/issue.ts`'s own
 * `../loader.js` specifier, which resolves to the same absolute file — so the
 * REAL `loadLoreApp`/`bun:sqlite` is never evaluated, and this file can still
 * import and invoke the REAL citty command object end to end (same technique
 * `demotion-rule-ssot.test.ts` and `foreign-corpus-write-adapters.test.ts` use
 * for their own module-boundary spies).
 *
 * Scenarios (task doc, verbatim):
 *   1. All 9 resolution states round-trip through the label unchanged.
 *   2. rejected/wontfix/superseded collide on GitHub's `state_reason:
 *      not_planned` but stay distinguishable via the label.
 *   3. `lore issue resolve` actually CALLS the projector (injected spy) — the
 *      mandatory scenario: without it, a zero-caller projector satisfies every
 *      other case (measured 4x in this repo as a false-green capability).
 *   4. A hand-edited label never overrides the corpus value — write-only,
 *      corpus always wins.
 *   5. A projection failure (network) still lets the corpus verdict land, and
 *      reports the failure loudly rather than swallowing it.
 *
 * Coverage: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION.
 *
 * @spec_ref AC-GI-4 — spec-the-defect-channel-reaches-no-machine-but-its-own-github
 */

import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { ok, err, ISSUE_RESOLUTION_MEMBERS, type DocRecord, type IssueResolution, type LoreError } from "@lore/core";

// ─── The module under test — DOES NOT EXIST; this import is the RED signal ──

import {
  resolutionToLabel,
  labelToResolution,
  ResolutionProjector,
  type GithubIssueRef,
  type ResolutionLabelPort,
} from "../../../src/service/resolution-projector.js";

// ─── Hoisted mock handles (referenced inside vi.mock factories below) ───────

const { getMock, setMock, closeMock, projectMock, loadLoreAppMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  setMock: vi.fn(),
  closeMock: vi.fn(),
  projectMock: vi.fn(),
  loadLoreAppMock: vi.fn(),
}));

// Full replacement (never `importOriginal`) — the real loader.ts pulls in
// bun:sqlite and must never be evaluated under vitest.
vi.mock("../../../src/adapters/cli/loader.js", () => ({
  loadLoreApp: loadLoreAppMock,
}));

// Imported AFTER the mock above so `../loader.js` inside this module resolves
// to the mocked factory, never the real one.
import issueCommand from "../../../src/adapters/cli/commands/issue.js";
import type { Invocation } from "@lore/core";
import { liveInvocation, runHandlerForExit } from "../../live-invocation.js";

// ═══════════════════════════════════════════════════════════════════════════
// Scenario 1 — HAPPY / BOUNDARY / NEGATIVE: pure 9-state round trip
// ═══════════════════════════════════════════════════════════════════════════

describe("resolutionToLabel / labelToResolution — AC-GI-4 scenario 1 (pure round trip)", () => {
  it("HAPPY: ISSUE_RESOLUTION_MEMBERS is the 9-state vocabulary this scenario iterates (sampling power)", () => {
    expect(ISSUE_RESOLUTION_MEMBERS.length).toBe(9);
  });

  it("HAPPY: all 9 states round-trip through the label unchanged — 9 for 9", () => {
    let roundTripped = 0;
    for (const state of ISSUE_RESOLUTION_MEMBERS) {
      const label = resolutionToLabel(state);
      const recovered = labelToResolution(label);
      expect(recovered).toBe(state);
      roundTripped += 1;
    }
    expect(roundTripped).toBe(9);
  });

  it("BOUNDARY: the label is exactly the documented `resolution:<state>` shape, not merely a decodable one", () => {
    expect(resolutionToLabel("fixed")).toBe("resolution:fixed");
    expect(resolutionToLabel("open")).toBe("resolution:open");
    for (const state of ISSUE_RESOLUTION_MEMBERS) {
      expect(resolutionToLabel(state)).toBe(`resolution:${state}`);
    }
  });

  it("BOUNDARY: no two of the 9 states collide on the same label (bijective, a precondition of round-tripping)", () => {
    const labels = ISSUE_RESOLUTION_MEMBERS.map(resolutionToLabel);
    expect(new Set(labels).size).toBe(9);
  });

  it("NEGATIVE: a label naming no real resolution state decodes to undefined, never a guess", () => {
    expect(labelToResolution("resolution:not-a-real-state")).toBeUndefined();
    expect(labelToResolution("not-even-the-right-prefix")).toBeUndefined();
    expect(labelToResolution("")).toBeUndefined();
  });

  it("NEGATIVE: decoding is case-sensitive and whitespace-sensitive — no silent normalisation", () => {
    expect(labelToResolution("Resolution:fixed")).toBeUndefined();
    expect(labelToResolution("resolution: fixed")).toBeUndefined();
    expect(labelToResolution(" resolution:fixed")).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Scenario 2 — the state_reason collision the label exists to route around
// ═══════════════════════════════════════════════════════════════════════════

describe("AC-GI-4 scenario 2 — rejected/wontfix/superseded collide on GitHub's state_reason, the label does not", () => {
  /**
   * GitHub's `state_reason` has exactly four values (completed, not_planned,
   * duplicate, reopened, null); `rejected`, `wontfix`, and `superseded` all
   * map onto the SAME one, `not_planned` — documented in the governing spec's
   * Overview. This block does not model that mapping (it belongs to the
   * GitHub-facing read side, out of this task's scope) — it proves the ONE
   * thing that makes the collision survivable: the label still distinguishes
   * all three.
   */
  const collidingStates: readonly IssueResolution[] = ["rejected", "wontfix", "superseded"];

  it("STATE: the three colliding states produce three PAIRWISE-DISTINCT labels", () => {
    const labels = collidingStates.map(resolutionToLabel);
    expect(new Set(labels).size).toBe(3);
  });

  it("STATE: each colliding state's label decodes back to exactly the state that produced it — never one of the other two", () => {
    for (const state of collidingStates) {
      const decoded = labelToResolution(resolutionToLabel(state));
      expect(decoded).toBe(state);
      for (const other of collidingStates) {
        if (other !== state) expect(decoded).not.toBe(other);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Scenario 3 — `lore issue resolve` MUST actually call the injected projector
// ═══════════════════════════════════════════════════════════════════════════

/** A minimal issue-report task doc; `hasIssueReport` needs a non-null `issue_report`. */
function makeIssueDoc(overrides: Partial<DocRecord> = {}): DocRecord {
  return {
    id: "01HISSUEFIXTURE00000000001",
    slug: "task-fixture-issue-report",
    type: "task",
    role: "plan",
    title: "Fixture issue report",
    status: "draft",
    priority: "medium",
    content: "## Issue\n\nFixture.",
    parent_id: "01HPLANFIXTURE0000000000001",
    created_at: "2026-08-23T00:00:00.000Z",
    updated_at: "2026-08-23T00:00:00.000Z",
    created_by: "system",
    version: 1,
    deleted_at: null,
    tags: [],
    extra: {
      issue_report: {
        reporter_project: "fixture-consumer (~/fixture)",
        github: { repo: "acme/widget", number: 42 },
      },
    },
    ...overrides,
  } as DocRecord;
}

/** The real citty subcommand object for `lore issue resolve` — never a reimplementation. */
function resolveRun(): (ctx: { args: Record<string, unknown> }) => Promise<unknown> {
  const subs = issueCommand.subCommands as Record<string, unknown> | undefined;
  const cmd = subs?.["resolve"] as { run?: (ctx: { args: Record<string, unknown>; inv: Invocation }) => Promise<unknown> } | undefined;
  if (cmd?.run === undefined) {
    throw new Error('lore issue has no "resolve" subcommand with a run handler');
  }
  const run = cmd.run;
  // reason: the command reads its Invocation from `ctx.inv` (AS-26); the real entry delivers it, so the test does too.
  return async (ctx) => {
    lastExitCode = await runHandlerForExit(() => run({ ...ctx, inv: liveInvocation() }));
  };
}

/** The exit code the most recent `resolveRun()` call ended with (commands return it; none sets `process.exitCode`). */
let lastExitCode = 0;

const BASE_RESOLVE_ARGS = {
  issue: "task-fixture-issue-report",
  state: "rejected",
  reason: "duplicate of an already-fixed defect",
  by: "agent:resolution-projector-test",
  json: true,
};

describe("AC-GI-4 scenario 3 — lore issue resolve calls the injected ResolutionProjector (REGRESSION: zero-caller)", () => {
  // Typed to the REAL overloaded signature of `process.stderr.write` (what
  // `vi.spyOn(process.stderr, "write")` actually returns) rather than the
  // generic `ReturnType<typeof vi.spyOn>` fallback — the fallback collapses
  // to `MockInstance<(this: unknown, ...args: unknown[]) => unknown>`, which
  // the overloaded `write` signature isn't assignable to.
  let stderrSpy: MockInstance<typeof process.stderr.write>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let issueDoc: DocRecord;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    getMock.mockReset();
    setMock.mockReset();
    closeMock.mockReset();
    projectMock.mockReset();
    loadLoreAppMock.mockReset();

    issueDoc = makeIssueDoc();
    getMock.mockResolvedValue(ok({ doc: issueDoc, navigation: { related: [] } }));
    setMock.mockImplementation(async (_id: string, patch: { extra?: unknown }) =>
      ok({ ...issueDoc, extra: patch.extra ?? issueDoc.extra, version: issueDoc.version + 1 }),
    );
    projectMock.mockResolvedValue(ok(undefined));
    loadLoreAppMock.mockReturnValue({
      app: {
        corpusService: { get: getMock, set: setMock },
        resolutionProjector: { project: projectMock },
        close: closeMock,
      },
    });
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    logSpy.mockRestore();
  });

  // ── Liveness controls: prove the harness genuinely reached the write path,
  //    so an unreached projector call is provably a MISSING call rather than
  //    an artifact of the fixture never getting far enough to matter. ──────

  it("LIVENESS CONTROL: the fixture is genuinely reached — get() and set() both fire, exit stays clean", async () => {
    await resolveRun()({ args: BASE_RESOLVE_ARGS });
    expect(getMock).toHaveBeenCalledTimes(1);
    expect(setMock).toHaveBeenCalledTimes(1);
    expect(lastExitCode).toBe(0);
  });

  // ── The mandatory case ───────────────────────────────────────────────────

  it("REGRESSION: a real `lore issue resolve` run invokes the injected projector exactly once with the corpus-computed resolution", async () => {
    await resolveRun()({ args: BASE_RESOLVE_ARGS });

    // Liveness re-affirmed inline (not just in the sibling test above): a
    // suite-ordering fluke must not be able to make this pass vacuously.
    expect(getMock).toHaveBeenCalledTimes(1);
    expect(setMock).toHaveBeenCalledTimes(1);

    expect(projectMock).toHaveBeenCalledTimes(1);
    const [resolutionArg] = projectMock.mock.calls[0] as [IssueResolution, GithubIssueRef];
    // `--state rejected` with no resolves-edge is EXPLICIT-TERMINAL rule 1 in
    // `computeIssueResolution` — the projector must receive THAT computed
    // value, not the raw `--state` string echoed back uninspected.
    expect(resolutionArg).toBe("rejected");
  });

  it("NEGATIVE CONTROL: a run that is refused before the write (bad --state) never reaches the projector", async () => {
    await resolveRun()({ args: { ...BASE_RESOLVE_ARGS, state: "fixed" } });
    expect(setMock).not.toHaveBeenCalled();
    expect(projectMock).not.toHaveBeenCalled();
    expect(lastExitCode).not.toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Scenario 4 — write-only: the corpus value always overwrites a hand-edited label
// ═══════════════════════════════════════════════════════════════════════════

describe("AC-GI-4 scenario 4 — a hand-edited label never overrides the corpus-derived resolution", () => {
  const ref: GithubIssueRef = { repo: "acme/widget", issueNumber: 42 };

  /** A `ResolutionLabelPort` double that remembers whatever was last written. */
  function makeStatefulPort(initialHandEditedLabel: string): {
    port: ResolutionLabelPort;
    currentLabel: () => string;
    setLabelSpy: ReturnType<typeof vi.fn>;
  } {
    let currentLabel = initialHandEditedLabel;
    const setLabelSpy = vi.fn(async (_ref: GithubIssueRef, label: string) => {
      currentLabel = label;
      return ok(undefined);
    });
    return { port: { setLabel: setLabelSpy }, currentLabel: () => currentLabel, setLabelSpy };
  }

  it("STATE: project() overwrites a pre-existing, disagreeing (hand-edited) label with the corpus value", async () => {
    const handEdited = resolutionToLabel("duplicate");
    const { port, currentLabel, setLabelSpy } = makeStatefulPort(handEdited);
    const projector = new ResolutionProjector(port);

    const result = await projector.project("wontfix", ref);

    expect(result.ok).toBe(true);
    expect(setLabelSpy).toHaveBeenCalledTimes(1);
    expect(currentLabel()).toBe(resolutionToLabel("wontfix"));
    expect(currentLabel()).not.toBe(handEdited);
  });

  it("STATE: the write is IDENTICAL regardless of what was previously on the label — no merge, no preservation", async () => {
    const corpusResolution: IssueResolution = "adopted";
    const fixtureA = makeStatefulPort(resolutionToLabel("open"));
    const fixtureB = makeStatefulPort(resolutionToLabel("superseded"));

    await new ResolutionProjector(fixtureA.port).project(corpusResolution, ref);
    await new ResolutionProjector(fixtureB.port).project(corpusResolution, ref);

    expect(fixtureA.currentLabel()).toBe(resolutionToLabel(corpusResolution));
    expect(fixtureB.currentLabel()).toBe(resolutionToLabel(corpusResolution));
    expect(fixtureA.currentLabel()).toBe(fixtureB.currentLabel());
  });

  it("REGRESSION: a hand-edited label's decode never equals a disagreeing corpus value — no path makes them coincide", () => {
    // `resolution-projector.ts` is write-only (Per-Field Authority: "read back
    // as truth: never"). This pins the negative directly: decoding a
    // hand-edited label that disagrees with the corpus value must NEVER equal
    // that corpus value, because nothing in this module offers a path that
    // would make them coincide by construction.
    const corpusResolution: IssueResolution = "resolving";
    const handEditedLabel = resolutionToLabel("closed");
    expect(labelToResolution(handEditedLabel)).not.toBe(corpusResolution);
    expect(labelToResolution(handEditedLabel)).toBe("closed");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Scenario 5 — a projection failure is reported loudly; the corpus verdict lands anyway
// ═══════════════════════════════════════════════════════════════════════════

describe("AC-GI-4 scenario 5 — a projection (network) failure never swallows the corpus verdict", () => {
  // Typed to the REAL overloaded signature of `process.stderr.write` (what
  // `vi.spyOn(process.stderr, "write")` actually returns) rather than the
  // generic `ReturnType<typeof vi.spyOn>` fallback — the fallback collapses
  // to `MockInstance<(this: unknown, ...args: unknown[]) => unknown>`, which
  // the overloaded `write` signature isn't assignable to.
  let stderrSpy: MockInstance<typeof process.stderr.write>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let issueDoc: DocRecord;

  const NETWORK_FAILURE_MESSAGE = "gh api request failed: network error reaching api.github.com";

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    getMock.mockReset();
    setMock.mockReset();
    closeMock.mockReset();
    projectMock.mockReset();
    loadLoreAppMock.mockReset();

    issueDoc = makeIssueDoc();
    getMock.mockResolvedValue(ok({ doc: issueDoc, navigation: { related: [] } }));
    setMock.mockImplementation(async (_id: string, patch: { extra?: unknown }) =>
      ok({ ...issueDoc, extra: patch.extra ?? issueDoc.extra, version: issueDoc.version + 1 }),
    );
    // Simulate a network-shaped projection failure. `TRANSPORT_UNAVAILABLE`
    // does not exist in this repo yet (it belongs to the separate GhRunner
    // task) — STORE_ERROR is the closest already-shipped generic-failure
    // LoreError code and stands in for "the write-side call failed for an
    // infrastructure reason", which is all this scenario needs to assert.
    const networkFailure: LoreError = { code: "STORE_ERROR", message: NETWORK_FAILURE_MESSAGE };
    projectMock.mockResolvedValue(err(networkFailure));
    loadLoreAppMock.mockReturnValue({
      app: {
        corpusService: { get: getMock, set: setMock },
        resolutionProjector: { project: projectMock },
        close: closeMock,
      },
    });
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    logSpy.mockRestore();
  });

  it("ERROR: the corpus verdict is still recorded (set() fires) even though projection fails", async () => {
    await resolveRun()({ args: BASE_RESOLVE_ARGS });
    expect(setMock).toHaveBeenCalledTimes(1);
    expect(projectMock).toHaveBeenCalledTimes(1);
  });

  it("ERROR: the run never throws — a failed projection is a REPORTED outcome, not an uncaught exception", async () => {
    await expect(resolveRun()({ args: BASE_RESOLVE_ARGS })).resolves.not.toThrow();
  });

  it("ERROR: the failure is surfaced LOUDLY — a nonzero exit code, distinct from the clean happy-path exit", async () => {
    await resolveRun()({ args: BASE_RESOLVE_ARGS });
    expect(lastExitCode).not.toBe(0);
  });

  it("ERROR: the failure's actual reason is named on stderr, not a generic swallow", async () => {
    await resolveRun()({ args: BASE_RESOLVE_ARGS });
    const written = stderrSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(written).toContain(NETWORK_FAILURE_MESSAGE);
  });

  it("REGRESSION CONTROL: the happy path (projection succeeds) exits clean — proves the nonzero exit above is caused by the failure, not by this harness", async () => {
    projectMock.mockResolvedValue(ok(undefined));
    await resolveRun()({ args: BASE_RESOLVE_ARGS });
    expect(lastExitCode).toBe(0);
  });
});
