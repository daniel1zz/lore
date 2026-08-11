/**
 * AC-DC-2 (spec-the-defect-channel-cannot-be-honestly-maintained-an §M1,
 * "Declared contract — the refusal payload is STRUCTURED") — the open-report
 * cap refusal carries a machine-readable payload, and its human stderr render
 * is a projection of that payload which can never advertise a verb that does
 * not free quota.
 *
 * The defect this closes: the measured refusal (2026-08-11) said "resolve or
 * wait for review", and NEITHER worked — `lore issue resolve` wrote only
 * `extra.issue_report.resolution` while the cap counted raw `draft` status, and
 * the review workflow cannot move a report off `draft` at all. A false remedy
 * in a refusal is worse than none: it costs the caller a round trip to learn
 * the refusal was unconditional.
 *
 * Two halves, deliberately:
 *   PAYLOAD (A) — `IssueReportService` is exercised directly over FAKE ports, so
 *     the `LoreError.value` object itself is observable. `quota_freeing_states`
 *     is compared to `TERMINAL_ISSUE_RESOLUTIONS` AS SETS, imported from the
 *     production module — ⛔ never against a remembered literal list, which is
 *     exactly the drift this AC exists to prevent.
 *   RENDER (B) — the COMPILED `dist/lore` is spawned against two throwaway
 *     corpora, so the assertion is about what a real caller actually sees on
 *     stderr, not about a string this test formats itself.
 *
 * ⛔ Every corpus is a throwaway `mkdtempSync` pair asserted under `os.tmpdir()`
 * — never this repo's own `.lore/` (root CLAUDE.md). The binary is built once in
 * `beforeAll` from THIS worktree's root (stale-binary false-oracle vector).
 *
 * Six-dimension coverage:
 *   HAPPY:      a full cap yields one `{id, resolution}` blocking entry per
 *               still-open report plus the derived `quota_freeing_states`
 *   BOUNDARY:   with 12 candidates of which 2 are terminal, exactly 10 block
 *               (refused); with 3 terminal, 9 block and the filing PROCEEDS
 *   ERROR:      a per-report resolution read failure counts the id as STILL
 *               BLOCKING (fail closed) and marks it unreadable — quota is never
 *               freed by a read error, and the failure is not swallowed
 *   NEGATIVE:   the stderr render carries NO "wait for review" advice (the
 *               measured inert remedy), and every `--state <x>` it names is a
 *               member of the terminal set
 *   STATE:      every blocking id is rendered ON THE SAME LINE as its computed
 *               resolution
 *   REGRESSION: the refusal is still `VALIDATION_ERROR`/exit 4 and still names
 *               every blocking id (SPEC-072 AC-072-6's original contract)
 *
 * Source: spec-the-defect-channel-cannot-be-honestly-maintained-an §M1, AC-DC-2;
 *   task-one-terminal-resolution-ssot-two-non-derogatory-states-and.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildIssueReportExtra, err, ok, OPEN_REPORT_CAP, type DocStatus, type LoreConfig, type LoreError } from "@lore/core";
import { IssueReportService } from "../../../src/service/issue-report-service.js";
import { ReceiptLog } from "../../../src/service/receipt-log.js";
import * as issueResolutionModule from "../../../src/service/issue-resolution.js";
import type { IssueResolution } from "../../../src/service/issue-resolution.js";
import type { UpstreamPort } from "../../../src/flows/upstream-context-flow.js";

/**
 * Namespace-imported and asserted at USE time (never a named import) so a
 * not-yet-existing export fails as an ASSERTION naming the missing symbol,
 * rather than as a module-link error that reads as a crashed harness.
 */
function readExportedSet(name: "TERMINAL_ISSUE_RESOLUTIONS" | "EXPLICIT_TERMINAL_RESOLUTIONS"): ReadonlySet<string> {
  const exported = (issueResolutionModule as unknown as Record<string, unknown>)[name];
  expect(exported, `issue-resolution.ts must export ${name}`).toBeInstanceOf(Set);
  return exported as ReadonlySet<string>;
}

// ─── Shared fixture plumbing ─────────────────────────────────────────────────

/** packages/lore/tests/integration/cli -> this worktree's root (5 levels up). */
const WORKTREE_ROOT = resolve(import.meta.dir, "..", "..", "..", "..", "..");
const DIST_LORE = join(WORKTREE_ROOT, "dist", "lore");
const TMP_ROOT = tmpdir();
const NOW_ISO = "2026-08-11T00:00:00.000Z";

function assertUnderTmp(path: string): void {
  if (!path.startsWith(TMP_ROOT)) {
    throw new Error(`Refusing to use a fixture path outside ${TMP_ROOT}: ${path}`);
  }
}

// ─── (A) Payload half — real service, fake ports ──────────────────────────────

/** The blocking-report shape the declared payload carries. */
interface BlockingEntry {
  readonly id: string;
  readonly resolution: IssueResolution | null;
  readonly unreadable_reason?: string;
}

/** The declared structured payload on the cap refusal's `LoreError.value`. */
interface CapRefusalPayload {
  readonly blocking: readonly BlockingEntry[];
  readonly quota_freeing_states: readonly string[];
}

/** Narrows a refusal's `value` to the declared payload, failing loud on any other shape. */
function readCapRefusalPayload(error: LoreError): CapRefusalPayload {
  expect(error.code).toBe("VALIDATION_ERROR");
  const value = (error as { value?: unknown }).value;
  expect(Array.isArray((value as CapRefusalPayload | undefined)?.blocking)).toBe(true);
  expect(Array.isArray((value as CapRefusalPayload | undefined)?.quota_freeing_states)).toBe(true);
  return value as CapRefusalPayload;
}

interface CandidateSpec {
  readonly id: string;
  /** The computed resolution `getResolution` reports, or `"read-failure"` to fail the read. */
  readonly resolution: IssueResolution | "read-failure";
}

interface FakeUpstream {
  readonly port: UpstreamPort;
  readonly createDraftCalls: string[];
  readonly getResolutionCalls: string[];
}

function makeFakeUpstream(candidates: readonly CandidateSpec[]): FakeUpstream {
  const createDraftCalls: string[] = [];
  const getResolutionCalls: string[] = [];
  const byId = new Map(candidates.map((c) => [c.id, c.resolution]));

  const port: UpstreamPort = {
    async resolveRootDoc() {
      return ok({ id: "01ROOTPRD", slug: "prd-lore" });
    },
    async listOpenAdhocDrafts() {
      return ok(
        candidates.map((candidate) => ({
          id: candidate.id,
          status: "draft",
          extra: buildIssueReportExtra({
            reporter_project: "consumer-a",
            reporter_actor: "agent:consumer-a",
            lore_version: "0.9.0",
            expected: "e",
            actual: "a",
            reported_at: NOW_ISO,
            possible_duplicates: [],
          }),
        })),
      );
    },
    async searchDuplicates() {
      return ok([]);
    },
    async createDraft(input) {
      createDraftCalls.push(input.title);
      return ok({ id: "01NEWDOC" });
    },
    async getResolution(id) {
      getResolutionCalls.push(id);
      const resolution = byId.get(id);
      if (resolution === undefined) return ok(null);
      if (resolution === "read-failure") {
        return err({ code: "STORE_ERROR", message: `resolution read failed for ${id}` });
      }
      return ok({ status: "draft" as DocStatus, resolution });
    },
    close() {
      /* no connection to close in the fake */
    },
  };

  return { port, createDraftCalls, getResolutionCalls };
}

/**
 * A REAL `ReceiptLog` over a throwaway file — `IssueReportDeps.receipts` is
 * typed as the class (it carries a private field), so a structural fake cannot
 * satisfy it without a cast, and a cast would hide a future signature change.
 */
function makeThrowawayReceiptLog(): ReceiptLog {
  const dir = mkdtempSync(join(TMP_ROOT, "lore-dc2-receipts-"));
  assertUnderTmp(dir);
  fixturesToClean.push(dir);
  return new ReceiptLog(join(dir, "issue-receipts.jsonl"));
}

function makeService(port: UpstreamPort): IssueReportService {
  return new IssueReportService({
    loadUpstreamConfig: () => ok({} as LoreConfig),
    probe: () => ok({ user_version: 7 }),
    expectedSchemaVersion: 7,
    openUpstream: () => ok(port),
    receipts: makeThrowawayReceiptLog(),
    loreVersion: "0.9.0",
    reporterProject: "consumer-a",
    writeWaitMs: 1234,
    now: () => NOW_ISO,
  });
}

const BASE_INPUT = {
  title: "cap refusal payload probe",
  description: "desc",
  expected: "exit 0",
  actual: "exit 4",
};

const BASE_CFG = { corpus_path: "/tmp/upstream-corpus-does-not-need-to-exist", root_prd: "prd-lore" };

function candidates(count: number, resolution: IssueResolution | "read-failure", offset = 0): CandidateSpec[] {
  return Array.from({ length: count }, (_, i) => ({ id: `01CANDIDATE${offset + i}`, resolution }));
}

// ─── (B) Render half — compiled binary over two throwaway corpora ─────────────

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

function run(args: string[], opts: { cwd: string; env?: Record<string, string> }): RunResult {
  assertUnderTmp(opts.cwd);
  const proc = Bun.spawnSync([DIST_LORE, ...args], {
    cwd: opts.cwd,
    env: { ...process.env, CLAUDECODE: "1", ...opts.env },
  });
  return { stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), exitCode: proc.exitCode ?? 1 };
}

function runJson<T>(args: string[], opts: { cwd: string }): { result: RunResult; data: T } {
  const result = run([...args, "--json"], opts);
  try {
    return { result, data: JSON.parse(result.stdout) as T };
  } catch (e) {
    throw new Error(
      `Failed to parse JSON from 'lore ${args.join(" ")}' (exit ${result.exitCode}):\n` +
        `stdout: ${result.stdout}\nstderr: ${result.stderr}\ncause: ${String(e)}`,
    );
  }
}

const fixturesToClean: string[] = [];

function makeTwinAtCap(): { upstreamRoot: string; consumerRoot: string; filedIds: string[] } {
  const upstreamRoot = mkdtempSync(join(TMP_ROOT, "lore-dc2-upstream-"));
  assertUnderTmp(upstreamRoot);
  fixturesToClean.push(upstreamRoot);
  expect(run(["init"], { cwd: upstreamRoot }).exitCode).toBe(0);
  const prd = runJson<{ ok: true; data: { slug: string } }>(
    ["create", "prd", "--title", "Upstream Root PRD (dc2)", "--content", "root prd content"],
    { cwd: upstreamRoot },
  );
  expect(prd.result.exitCode).toBe(0);

  const consumerRoot = mkdtempSync(join(TMP_ROOT, "lore-dc2-consumer-"));
  assertUnderTmp(consumerRoot);
  fixturesToClean.push(consumerRoot);
  expect(run(["init"], { cwd: consumerRoot }).exitCode).toBe(0);
  appendFileSync(
    join(consumerRoot, ".lore", "config.yaml"),
    ["feedback:", "  upstream:", `    corpus_path: ${upstreamRoot}`, `    root_prd: ${prd.data.data.slug}`, ""].join("\n"),
  );

  const filedIds: string[] = [];
  for (let i = 0; i < OPEN_REPORT_CAP; i += 1) {
    const filed = runJson<{ ok: true; data: { upstream_doc_id: string } }>(
      ["report-issue", "--title", `dc2 report ${i}`, "--description", "d", "--expected", "e", "--actual", "a"],
      { cwd: consumerRoot },
    );
    expect(filed.result.exitCode).toBe(0);
    filedIds.push(filed.data.data.upstream_doc_id);
  }
  return { upstreamRoot, consumerRoot, filedIds };
}

beforeAll(() => {
  const pkg = JSON.parse(readFileSync(join(WORKTREE_ROOT, "package.json"), "utf8")) as { name?: string };
  if (pkg.name !== "lore-workspace") {
    throw new Error(`WORKTREE_ROOT resolved to a non-workspace directory: ${WORKTREE_ROOT}`);
  }
  const buildResult = Bun.spawnSync(["bun", "run", "build"], { cwd: WORKTREE_ROOT });
  if (buildResult.exitCode !== 0) {
    throw new Error(
      `'bun run build' failed (exit ${buildResult.exitCode}):\n` +
        `stdout: ${buildResult.stdout.toString()}\nstderr: ${buildResult.stderr.toString()}`,
    );
  }
  if (!existsSync(DIST_LORE)) throw new Error(`Expected ${DIST_LORE} to exist after 'bun run build'`);
}, 180_000);

afterAll(() => {
  for (const path of fixturesToClean) {
    try {
      rmSync(path, { recursive: true, force: true });
    } catch {
      // reason: best-effort cleanup.
    }
  }
});

describe("AC-DC-2: the cap refusal's structured payload", () => {
  it("AC-DC-2: carries one {id, resolution} entry per blocking report plus quota_freeing_states derived from TERMINAL_ISSUE_RESOLUTIONS", async () => {
    const blockingCandidates = candidates(OPEN_REPORT_CAP, "open");
    const upstream = makeFakeUpstream(blockingCandidates);
    const result = await makeService(upstream.port).report(BASE_INPUT, BASE_CFG);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    const payload = readCapRefusalPayload(result.error);

    expect(payload.blocking.map((entry) => entry.id)).toEqual(blockingCandidates.map((c) => c.id));
    for (const entry of payload.blocking) {
      expect(entry.resolution).toBe("open");
    }

    // ⛔ SET comparison against the production export — never a literal list.
    const terminalResolutions = readExportedSet("TERMINAL_ISSUE_RESOLUTIONS");
    expect(new Set(payload.quota_freeing_states)).toEqual(new Set(terminalResolutions));
    expect(payload.quota_freeing_states.length).toBe(terminalResolutions.size);

    // REGRESSION: the original SPEC-072 contract still holds — every blocking id
    // is still named in the human message.
    const message = (result.error as { message: string }).message;
    for (const candidate of blockingCandidates) expect(message).toContain(candidate.id);
    expect(upstream.createDraftCalls).toEqual([]);
  });

  it("AC-DC-2: terminally-resolved candidates are excluded from blocking — 2 terminal of 12 still refuses, 3 admits", async () => {
    const twoTerminal = [
      ...candidates(OPEN_REPORT_CAP, "open"),
      { id: "01TERMINALA", resolution: "superseded" as IssueResolution },
      { id: "01TERMINALB", resolution: "duplicate" as IssueResolution },
    ];
    const refusedUpstream = makeFakeUpstream(twoTerminal);
    const refused = await makeService(refusedUpstream.port).report(BASE_INPUT, BASE_CFG);

    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    const payload = readCapRefusalPayload(refused.error);
    expect(payload.blocking.length).toBe(OPEN_REPORT_CAP);
    expect(payload.blocking.map((entry) => entry.id)).not.toContain("01TERMINALA");
    expect(payload.blocking.map((entry) => entry.id)).not.toContain("01TERMINALB");
    // Every candidate's resolution was actually READ (the narrowing is not a
    // status shortcut).
    expect(refusedUpstream.getResolutionCalls.length).toBe(twoTerminal.length);

    const threeTerminal = [
      ...candidates(OPEN_REPORT_CAP - 1, "open"),
      { id: "01TERMINALA", resolution: "rejected" as IssueResolution },
      { id: "01TERMINALB", resolution: "wontfix" as IssueResolution },
      { id: "01TERMINALC", resolution: "fixed" as IssueResolution },
    ];
    const admittedUpstream = makeFakeUpstream(threeTerminal);
    const admitted = await makeService(admittedUpstream.port).report(BASE_INPUT, BASE_CFG);

    expect(admitted.ok).toBe(true);
    expect(admittedUpstream.createDraftCalls).toEqual([BASE_INPUT.title]);
  });

  it("AC-DC-2: a resolution READ FAILURE keeps its report blocking and is marked unreadable (fail closed, never swallowed)", async () => {
    const mixed: CandidateSpec[] = [
      ...candidates(OPEN_REPORT_CAP - 1, "open"),
      { id: "01UNREADABLE", resolution: "read-failure" },
    ];
    const upstream = makeFakeUpstream(mixed);
    const result = await makeService(upstream.port).report(BASE_INPUT, BASE_CFG);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    const payload = readCapRefusalPayload(result.error);
    expect(payload.blocking.length).toBe(OPEN_REPORT_CAP);

    const unreadable = payload.blocking.find((entry) => entry.id === "01UNREADABLE");
    expect(unreadable).toBeDefined();
    // ⛔ Never a fabricated resolution: `null` is an explicit NOT MEASURED.
    expect(unreadable?.resolution).toBeNull();
    expect(unreadable?.unreadable_reason ?? "").toContain("STORE_ERROR");
    expect((result.error as { message: string }).message).toContain("01UNREADABLE");
    expect(upstream.createDraftCalls).toEqual([]);
  });
});

describe("AC-DC-2: the human stderr render is a projection of that payload", () => {
  it("AC-DC-2: every blocking id is rendered alongside its resolution, and only quota-freeing verbs are named", () => {
    const { consumerRoot, filedIds } = makeTwinAtCap();

    const refused = run(
      ["report-issue", "--title", "the refused 11th", "--description", "d", "--expected", "e", "--actual", "a"],
      { cwd: consumerRoot },
    );
    expect(refused.exitCode).toBe(4);
    const stderr = refused.stderr;
    const lines = stderr.split("\n");

    // STATE: id and its computed resolution on the SAME line — a reader must
    // never have to join two lists by position.
    for (const id of filedIds) {
      const line = lines.find((candidate) => candidate.includes(id));
      expect(line, `stderr must name blocking report ${id}`).toBeDefined();
      expect(line ?? "").toContain("open");
    }

    // Every quota-freeing state is named…
    const terminalResolutions = readExportedSet("TERMINAL_ISSUE_RESOLUTIONS");
    for (const state of terminalResolutions) {
      expect(stderr, `the refusal must name the quota-freeing state '${state}'`).toContain(state);
    }
    // …each hand-settable one with the verb that actually reaches it…
    for (const state of readExportedSet("EXPLICIT_TERMINAL_RESOLUTIONS")) {
      expect(stderr).toContain(`lore issue resolve`);
      expect(stderr).toContain(`--state ${state}`);
    }
    // …the two pointer-carrying states with their REQUIRED pointer flags…
    expect(stderr).toContain("--superseded-by");
    expect(stderr).toContain("--duplicate-of");
    // …and the two COMPUTED-only states with their non-`issue resolve` routes.
    expect(stderr).toContain("lore link");
    expect(stderr).toContain("resolves");
    expect(stderr.toLowerCase()).toContain("archiv");

    // NEGATIVE: the measured inert remedy is gone, and no `--state` value that
    // cannot free quota is advertised.
    expect(stderr).not.toContain("wait for review");
    const advertisedStates = [...stderr.matchAll(/--state\s+([a-z-]+)/g)].map((match) => match[1] as string);
    expect(advertisedStates.length).toBeGreaterThan(0);
    for (const state of advertisedStates) {
      expect(
        terminalResolutions.has(state),
        `the refusal must not advise --state ${state}: it does not free quota`,
      ).toBe(true);
    }
  }, 300_000);
});
