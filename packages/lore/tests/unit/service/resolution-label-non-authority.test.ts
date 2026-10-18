/**
 * RED-first scenarios for `lore issues --verify` — the drift DETECTOR that
 * proves the `resolution:*` GitHub label is write-only and never authority
 * (spec-the-defect-channel-reaches-no-machine-but-its-own-github, Per-Field
 * Authority table row "resolution (9 states) | corpus | resolution:* label |
 * NEVER — drift check only"; AC-GI-5; risk R5).
 *
 * `commands/issues.ts` DOES NOT recognise `--verify` yet — this file is
 * authored RED, before the paired implementation task
 * (`task-skill-implement-lore-issues-verify-plus-batched-read-side`) lands
 * it. Every assertion below that touches the `--verify`-specific JSON shape
 * (`data.clean` / `data.divergences`) is expected to fail TODAY at the
 * ASSERTION level (`--verify` is silently ignored by the current `run()`,
 * which falls back to the ordinary listing shape with neither field) — that
 * is the correct RED signal for this task
 * (`task-skill-test-issues-verify-drift-detection-and-filtered`), never a
 * module-resolution failure, because `commands/issues.ts` already exists.
 *
 * ## The contract this file pins for the implementer
 *
 * Since `--verify` does not exist yet, this file's fixtures and assertions
 * ARE the contract the paired implementation task must satisfy:
 *
 *   - New boolean flag `--verify`. When passed (any `mode`/`--all` value),
 *     the command scans every issue-report task carrying a GitHub ref
 *     (`readGithubIssueRef`, `service/resolution-projector.js` — reused,
 *     never reimplemented) and, via ONE batched `GhRunner.run(...)` call
 *     covering every such ref, reads back each issue's CURRENT
 *     `resolution:*` label.
 *   - `--json` output shape for `--verify` (a DELIBERATELY separate shape
 *     from the ordinary listing's `data.reports`, because a verify run is a
 *     diagnostic report, not a row listing):
 *       `{ ok: true, data: { corpus_path, mode: "verify", clean: boolean,
 *          divergences: Array<{ id, slug, corpus_resolution, github_label_resolution }> } }`
 *     `clean` is `true` iff `divergences` is empty. Each divergence entry
 *     NAMES BOTH VALUES — the corpus-computed resolution
 *     (`computeIssueResolution`, unchanged, never re-derived from the
 *     label) and the label's decoded resolution (`labelToResolution`,
 *     `service/resolution-projector.js` — reused).
 *   - Exit code: `0` (or `process.exitCode` left `undefined`, this repo's
 *     own convention for a clean run) when `clean`; a DEDICATED
 *     business-outcome code, `11`, when at least one divergence was found.
 *     `11` is deliberately the NEXT integer past this file's own
 *     `exitCode()` taxonomy's highest claimed value (`RATE_LIMITED` → `10`,
 *     `adapters/cli/utils.ts`) — `1` is already `STORE_ERROR` in that SAME
 *     function, which `issues.ts` already calls for its OTHER failure
 *     paths (`rowsResult.error`), so reusing `1` for "divergence found"
 *     would make an actual store failure and a clean-corpus-dirty-label
 *     finding indistinguishable on the same command. `11` collides with
 *     nothing `exitCode()` maps today.
 *   - `--verify` performs ZERO corpus writes (`corpusService.set` is never
 *     called) and ZERO GitHub writes — this file's REST-shaped read-only
 *     check below (no call's argv carries `-X`) covers every plausible
 *     write verb `gh api` uses for a REST mutation; see that scenario's own
 *     comment for the one thing it cannot see (a GraphQL mutation, which
 *     needs no `-X` flag at all — out of scope here because a GraphQL
 *     MUTATION has no business inside a documented "read-only" detector in
 *     the first place, see this spec's Scope entry for `ResolutionProjector`
 *     "read back only to detect drift").
 *
 * ## Why this file mocks `gh-runner.js` instead of importing a real `GhRunner`
 *
 * `gh-runner.ts` is documented (this repo's own header comment on that
 * file, AC-GI-7) as the ONLY module permitted to spawn/name `gh`. The
 * paired implementation task's file anchor is `commands/issues.ts` ALONE —
 * it cannot add a new module file — so whatever batched-read mechanism it
 * builds MUST construct `GhRunner` (imported from `../../../service/gh-
 * runner.js`, the same relative specifier this file's `vi.mock` below
 * resolves) directly inside `issues.ts`, mirroring how `app.ts` already
 * constructs one for `ResolutionProjector`. Replacing the WHOLE module with
 * one shared `run()` spy (`ghRunMock`) — rather than trying to intercept
 * `node:child_process` two layers down — means every `new GhRunner(...)`
 * construction in the implementation, however many, funnels into the SAME
 * countable spy, regardless of exactly how many instances get created.
 *
 * ## Why this file mocks `loader.js` instead of importing a real `App`
 *
 * Same reasoning as the sibling `resolution-projector.test.ts`:
 * `commands/issues.ts` statically imports `loadLoreApp` from `../loader.js`,
 * which transitively pulls in `bun:sqlite` — unresolvable under vitest. The
 * full-replacement `vi.mock` below lets this file still invoke the REAL
 * `issues.ts` command object end to end.
 *
 * Scenarios (task doc, verbatim, this file covers all three):
 *   1. A hand-edited `resolution:*` label diverging from the corpus state:
 *      `lore issues --verify` reports the divergence naming both values,
 *      exit code marks a divergence found. Also folds in the Per-Field
 *      Authority invariant this AC's title names: the label edit does NOT
 *      move what a PLAIN (non-`--verify`) `lore issues` reports.
 *   2. No divergence anywhere → `--verify` reports clean, exits 0 —
 *      MANDATORY per this task's own AC: a detector that reports divergence
 *      unconditionally would pass scenario 1 alone.
 *   3. `--verify` performs zero writes to GitHub and zero writes to the
 *      corpus.
 *
 * Coverage: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION.
 *
 * @spec_ref AC-GI-5 — spec-the-defect-channel-reaches-no-machine-but-its-own-github
 */

import type { Invocation } from "@lore/core";
import { liveInvocation, runHandlerForExit } from "../../live-invocation.js";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { ok, err, type DocRecord, type IssueResolution, type LoreError } from "@lore/core";

// ─── The real, ALREADY-LANDED projector module — used to BUILD fixture
//     labels, never mocked (it is pure and has no bun:sqlite dependency). ──
import { resolutionToLabel } from "../../../src/service/resolution-projector.js";

// ─── Hoisted mock handles (referenced inside vi.mock factories below) ───────

const { listMock, getMock, setMock, closeMock, ghRunMock, loadLoreAppMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  getMock: vi.fn(),
  setMock: vi.fn(),
  closeMock: vi.fn(),
  ghRunMock: vi.fn(),
  loadLoreAppMock: vi.fn(),
}));

// Full replacement (never `importOriginal`) — the real loader.ts pulls in
// bun:sqlite and must never be evaluated under vitest.
vi.mock("../../../src/adapters/cli/loader.js", () => ({
  loadLoreApp: loadLoreAppMock,
}));

// `commands/issues.ts` ALSO statically imports `../report-issue-wiring.js`.
// ⛔ HISTORICAL (kept defensively): before P4 of spec-the-defect-channel-
// reaches-no-machine-but-its-own-github, `commands/issues.ts` and
// `report-issue-wiring.js` both reached `bun:sqlite` independently of
// `loader.js`, at MODULE LOAD TIME, via the (now-deleted) SQLite-shaped
// legacy upstream port — regardless of which branch a test's fixture ever
// exercised at runtime. That import graph no longer exists post-P4, but
// this mock is left in place rather than removed on the strength of a
// static read: it is harmless when unneeded (nothing in this file asserts
// on `bun:sqlite` behavior), and re-verifying "is it STILL unneeded" on
// every future change to this file's import graph is a burden a stale
// mock does not impose. Every fixture in this file configures `config: {}`
// (no `feedback.upstream`), so `resolveIssueReadSource` always resolves
// "local" regardless.
vi.mock("bun:sqlite", () => ({
  Database: class {},
}));

// Full replacement of the ONE module permitted to spawn `gh` — every
// `new GhRunner(...)` constructed by whatever the implementation builds
// funnels its `.run()` calls into the single shared `ghRunMock` spy.
vi.mock("../../../src/service/gh-runner.js", () => ({
  GhRunner: class {
    run(args: readonly string[]) {
      return ghRunMock(args);
    }
  },
  createNodeGhExecFile: vi.fn(() => vi.fn()),
}));

// Imported AFTER both mocks above so `issues.ts`'s own `../loader.js` and
// `../../../service/gh-runner.js` specifiers resolve to the mocked
// factories, never the real ones.
import issuesCommand from "../../../src/adapters/cli/commands/issues.js";

// ═══════════════════════════════════════════════════════════════════════════
// Shared fixture plumbing
// ═══════════════════════════════════════════════════════════════════════════

/** A minimal issue-report task doc; mirrors the sibling projector test's fixture shape. */
function makeIssueTaskDoc(overrides: Partial<DocRecord> & { extra: Record<string, unknown> }): DocRecord {
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
    ...overrides,
  } as DocRecord;
}

/** Real `run()` extracted directly off the flat (non-subcommand) `issues` command. */
async function callIssuesRun(args: Record<string, unknown>): Promise<void> {
  const run = issuesCommand.run as unknown as (ctx: { args: Record<string, unknown>; inv: Invocation }) => Promise<void>;
  if (run === undefined) {
    throw new Error("lore issues has no run() handler");
  }
  lastExitCode = await runHandlerForExit(() => run({ args, inv: liveInvocation() }));
}

/** The exit code the most recent `callIssuesRun` ended with (commands return it; none sets `process.exitCode`). */
let lastExitCode = 0;

/** Wires `loadLoreAppMock` to a synthetic App exposing exactly what `issues.ts` reads. */
function wireApp(): void {
  loadLoreAppMock.mockReturnValue({
    app: {
      corpusService: { listFull: listMock, get: getMock, set: setMock },
      close: closeMock,
    },
    dbPath: "/fake/corpus/.lore/lore.db",
    config: {}, // no feedback.upstream configured -> resolveIssueReadSource picks "local"
  });
}

/** Parses the `--json` payload out of whichever `console.log` call produced valid JSON. */
function parseJsonPayload(logSpy: ReturnType<typeof vi.spyOn>): { ok: boolean; data: Record<string, unknown> } {
  for (const call of logSpy.mock.calls) {
    try {
      return JSON.parse(String(call[0]));
    } catch {
      continue;
    }
  }
  throw new Error(`no console.log call produced parseable JSON (${logSpy.mock.calls.length} calls captured)`);
}

let stderrSpy: MockInstance;
let logSpy: MockInstance;

beforeEach(() => {
  stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

  listMock.mockReset();
  getMock.mockReset();
  setMock.mockReset();
  closeMock.mockReset();
  ghRunMock.mockReset();
  loadLoreAppMock.mockReset();
  wireApp();
});

afterEach(() => {
  stderrSpy.mockRestore();
  logSpy.mockRestore();
});

// ═══════════════════════════════════════════════════════════════════════════
// Scenario 1 — a hand-edited label diverges; --verify names BOTH values;
//              a plain (non-verify) listing is unaffected by the label
// ═══════════════════════════════════════════════════════════════════════════

describe("AC-GI-5 scenario 1 — a hand-edited resolution label diverges from the corpus state", () => {
  const githubRef = { repo: "acme/widget", number: 42 };
  let issueDoc: DocRecord;

  beforeEach(() => {
    issueDoc = makeIssueTaskDoc({
      extra: {
        issue_report: {
          resolution: { state: "rejected" }, // explicit terminal state -> deterministic "rejected"
          github: githubRef,
        },
      },
    });
    listMock.mockResolvedValue(ok({ docs: [issueDoc], total: 1 }));
    getMock.mockResolvedValue(ok({ doc: issueDoc, navigation: { related: [] } }));
    // Hand-edited on GitHub to "duplicate" — disagrees with the corpus's "rejected".
    ghRunMock.mockResolvedValue(
      ok({ stdout: JSON.stringify([{ number: githubRef.number, labels: [{ name: resolutionToLabel("duplicate") }] }]) }),
    );
  });

  it("REGRESSION (Per-Field Authority, 'read back as truth: never'): a PLAIN listing (no --verify) still reports the CORPUS resolution, unmoved by the hand-edited label", async () => {
    await callIssuesRun({ all: true, json: true });
    const payload = parseJsonPayload(logSpy);
    // Liveness: the fixture was genuinely reached.
    expect(listMock).toHaveBeenCalledTimes(1);
    const reports = payload.data["reports"] as Array<{ resolution: IssueResolution }>;
    expect(reports).toHaveLength(1);
    expect(reports[0]?.resolution).toBe("rejected");
    expect(reports[0]?.resolution).not.toBe("duplicate");
  });

  it("HAPPY: --verify reports the divergence, naming BOTH the corpus value and the github-label value", async () => {
    await callIssuesRun({ all: true, verify: true, json: true });
    const payload = parseJsonPayload(logSpy);
    expect(payload.data["clean"]).toBe(false);
    const divergences = payload.data["divergences"] as Array<{
      id: string;
      slug: string;
      corpus_resolution: string;
      github_label_resolution: string;
    }>;
    expect(divergences).toHaveLength(1);
    expect(divergences[0]).toMatchObject({
      id: issueDoc.id,
      slug: issueDoc.slug,
      corpus_resolution: "rejected",
      github_label_resolution: "duplicate",
    });
  });

  it("ERROR/STATE: the exit code marks a divergence found — distinct from the clean exit", async () => {
    await callIssuesRun({ all: true, verify: true, json: true });
    expect(lastExitCode).toBe(11);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Scenario 2 (MANDATORY) — no divergence anywhere -> clean, exit 0
// ═══════════════════════════════════════════════════════════════════════════

describe("AC-GI-5 scenario 2 (MANDATORY) — no divergence -> --verify reports clean and exits 0", () => {
  const githubRef = { repo: "acme/widget", number: 7 };
  let issueDoc: DocRecord;

  beforeEach(() => {
    issueDoc = makeIssueTaskDoc({
      id: "01HISSUEFIXTURECLEAN00001",
      slug: "task-fixture-issue-report-clean",
      extra: {
        issue_report: {
          resolution: { state: "wontfix" },
          github: githubRef,
        },
      },
    });
    listMock.mockResolvedValue(ok({ docs: [issueDoc], total: 1 }));
    getMock.mockResolvedValue(ok({ doc: issueDoc, navigation: { related: [] } }));
    // Label matches the corpus value exactly -> no divergence.
    ghRunMock.mockResolvedValue(
      ok({ stdout: JSON.stringify([{ number: githubRef.number, labels: [{ name: resolutionToLabel("wontfix") }] }]) }),
    );
  });

  it("HAPPY: reports clean with an empty divergences list — not vacuously because nothing was checked", async () => {
    await callIssuesRun({ all: true, verify: true, json: true });
    // Liveness: the fixture was genuinely reached and IS what got checked —
    // a detector that never looks at anything must not be able to pass this
    // "clean" case by accident (this is exactly why scenario 2 is mandatory).
    expect(listMock).toHaveBeenCalledTimes(1);
    expect(ghRunMock).toHaveBeenCalled();

    const payload = parseJsonPayload(logSpy);
    expect(payload.data["clean"]).toBe(true);
    expect(payload.data["divergences"]).toEqual([]);
  });

  it("BOUNDARY: the clean run's exit code is 0 (or left undefined, this repo's own clean-exit convention) — never the divergence code", async () => {
    await callIssuesRun({ all: true, verify: true, json: true });
    expect(lastExitCode).toBe(0);
    expect(lastExitCode).not.toBe(11);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Scenario 3 — --verify performs zero writes to GitHub and zero to the corpus
// ═══════════════════════════════════════════════════════════════════════════

describe("AC-GI-5 scenario 3 — --verify writes nothing, to GitHub or to the corpus", () => {
  const githubRef = { repo: "acme/widget", number: 99 };
  let issueDoc: DocRecord;

  beforeEach(() => {
    issueDoc = makeIssueTaskDoc({
      id: "01HISSUEFIXTUREWRITES0001",
      slug: "task-fixture-issue-report-writes",
      extra: {
        issue_report: {
          resolution: { state: "duplicate" },
          github: githubRef,
        },
      },
    });
    listMock.mockResolvedValue(ok({ docs: [issueDoc], total: 1 }));
    getMock.mockResolvedValue(ok({ doc: issueDoc, navigation: { related: [] } }));
    // Deliberately DIVERGENT — a write-safety check must hold even when a
    // divergence is found, not only on the clean path.
    ghRunMock.mockResolvedValue(
      ok({ stdout: JSON.stringify([{ number: githubRef.number, labels: [{ name: resolutionToLabel("rejected") }] }]) }),
    );
  });

  it("STATE: the corpus is never written during --verify (corpusService.set is never called)", async () => {
    await callIssuesRun({ all: true, verify: true, json: true });
    // Liveness re-affirmed inline: the run genuinely reached the read path.
    expect(listMock).toHaveBeenCalledTimes(1);
    expect(setMock).not.toHaveBeenCalled();
  });

  it("STATE: no gh invocation during --verify carries a REST mutating verb (-X) — read-only by construction", async () => {
    await callIssuesRun({ all: true, verify: true, json: true });
    expect(ghRunMock).toHaveBeenCalled();
    for (const call of ghRunMock.mock.calls) {
      const args = call[0] as readonly string[];
      // Documented limitation: this catches every REST write (`gh api ... -X
      // POST/PATCH/DELETE`), which is what this codebase's own
      // GhResolutionLabelPort uses for its writes. It does NOT distinguish a
      // GraphQL query from a GraphQL mutation (both are plain HTTP POST at
      // the gh CLI layer with no `-X` flag) — out of scope here because a
      // documented READ-ONLY detector (this spec's own Scope entry for
      // `ResolutionProjector`, "read back only to detect drift") has no
      // legitimate reason to ever issue a GraphQL mutation in the first
      // place; scenario 1's "zero calls beyond the batched read" bound
      // (asserted via the sibling batching test's call-count equality) is
      // the check that would catch that class of regression instead.
      expect(args.includes("-X")).toBe(false);
    }
  });
});
