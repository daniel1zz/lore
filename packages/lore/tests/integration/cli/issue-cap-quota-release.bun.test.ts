/**
 * AC-DC-1 (spec-the-defect-channel-cannot-be-honestly-maintained-an §M1) — a
 * terminal RESOLUTION releases open-report cap quota, end-to-end through the
 * real compiled CLI over two throwaway corpora.
 *
 * This suite replays the EXACT sequence measured on 2026-08-11 (§Measured, not
 * inferred, F1), which refused: 10 reports filed -> the 11th refused (exit 4)
 * -> all 10 resolved -> the 12th refused with the BYTE-IDENTICAL cap message,
 * still naming all 10 ULIDs. The mechanism: `countOpenReports` filtered on
 * `task.status !== "draft"` while `lore issue resolve` writes only
 * `extra.issue_report.resolution`, and `VALID_TRANSITIONS` has no
 * `draft -> archived` edge — so NO closure verb could move a report off
 * `draft`, making the refusal's own advice ("resolve or wait for review") a
 * FALSE remedy.
 *
 * The decisive control in every case below: the resolved reports' own doc
 * `status` STAYS `draft`. Quota is therefore proven to be released by the
 * COMPUTED RESOLUTION, not by a lifecycle transition that the corpus cannot
 * even express.
 *
 * ⛔ Every corpus here is a throwaway `mkdtempSync` pair (upstream + consumer)
 * asserted to live under `os.tmpdir()` — NEVER this repo's own `.lore/` (root
 * CLAUDE.md). The suite spawns the COMPILED `dist/lore` resolved from THIS
 * worktree's own root and builds it once in `beforeAll` (stale-binary
 * false-oracle vector).
 *
 * Six-dimension coverage:
 *   HAPPY:      10 filed -> 11th refused -> all 10 resolved NON-DEROGATORY
 *               (superseded/duplicate) -> 11th ACCEPTED (exit 0)
 *   REGRESSION: that same case IS the measured F1 sequence; the accepted exit 0
 *               is the byte-for-byte inverse of the recorded refusal
 *   STATE:      every resolved report is still `status: "draft"` upstream, and
 *               all 10 appear under `lore issues --resolved` with their new
 *               resolutions (the states stay VISIBLE, they are not a trash can)
 *   NEGATIVE:   with 12 candidates of which 2 are released, the refusal names
 *               EXACTLY the 10 that still block — never a released one
 *   ERROR:      a FAILED resolve (unresolvable `--superseded-by` pointer) frees
 *               no quota — the report keeps blocking
 *   BOUNDARY:   at cap: resolve exactly one -> one more report is accepted ->
 *               the next one is refused again (the ceiling still binds)
 *   STATE(2):   a COMPUTED `fixed` resolution (a `resolves` edge to an archived
 *               fixing doc, never an explicit write) also frees quota
 *
 * Source: spec-the-defect-channel-cannot-be-honestly-maintained-an §M1, AC-DC-1;
 *   task-one-terminal-resolution-ssot-two-non-derogatory-states-and.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// ─── Worktree-anchored dist/lore binary (never the main checkout's) ───────────

/** packages/lore/tests/integration/cli -> this worktree's root (5 levels up). */
const WORKTREE_ROOT = resolve(import.meta.dir, "..", "..", "..", "..", "..");
const DIST_LORE = join(WORKTREE_ROOT, "dist", "lore");
const TMP_ROOT = tmpdir();

/** The R-5d ceiling this suite fills. Mirrors `@lore/core`'s `OPEN_REPORT_CAP`. */
const OPEN_REPORT_CAP = 10;

/** Every fixture path MUST resolve under the OS tmpdir — never the repo's own `.lore/`. */
function assertUnderTmp(path: string): void {
  if (!path.startsWith(TMP_ROOT)) {
    throw new Error(`Refusing to use a fixture path outside ${TMP_ROOT}: ${path}`);
  }
}

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** Synchronous `dist/lore <args>` spawn — CLAUDECODE=1 (agent surface, no AI nesting). */
function run(args: string[], opts: { cwd: string; env?: Record<string, string> }): RunResult {
  assertUnderTmp(opts.cwd);
  const proc = Bun.spawnSync([DIST_LORE, ...args], {
    cwd: opts.cwd,
    env: { ...process.env, CLAUDECODE: "1", ...opts.env },
  });
  return {
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    exitCode: proc.exitCode ?? 1,
  };
}

/** `run` + `--json`, parsed. Throws with full stdio context on a non-JSON response. */
function runJson<T>(args: string[], opts: { cwd: string; env?: Record<string, string> }): { result: RunResult; data: T } {
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

// ─── Twin-corpus fixtures ─────────────────────────────────────────────────────

interface UpstreamFixture {
  readonly root: string;
  readonly rootPrdId: string;
  readonly rootPrdSlug: string;
}

const fixturesToClean: string[] = [];
function track(...paths: string[]): void {
  for (const p of paths) fixturesToClean.push(p);
}

function makeUpstream(prefix: string): UpstreamFixture {
  const root = mkdtempSync(join(TMP_ROOT, `lore-dc1-upstream-${prefix}-`));
  assertUnderTmp(root);
  const initResult = run(["init"], { cwd: root });
  if (initResult.exitCode !== 0) throw new Error(`upstream 'lore init' failed: ${initResult.stderr}`);
  const { result, data } = runJson<{ ok: true; data: { id: string; slug: string } }>(
    ["create", "prd", "--title", `Upstream Root PRD (${prefix})`, "--content", "root prd content"],
    { cwd: root },
  );
  if (result.exitCode !== 0) throw new Error(`upstream root PRD creation failed: ${result.stderr}`);
  return { root, rootPrdId: data.data.id, rootPrdSlug: data.data.slug };
}

function makeConsumer(prefix: string, upstream: UpstreamFixture): string {
  const root = mkdtempSync(join(TMP_ROOT, `lore-dc1-consumer-${prefix}-`));
  assertUnderTmp(root);
  const initResult = run(["init"], { cwd: root });
  if (initResult.exitCode !== 0) throw new Error(`consumer 'lore init' failed: ${initResult.stderr}`);
  appendFileSync(
    join(root, ".lore", "config.yaml"),
    ["feedback:", "  upstream:", `    corpus_path: ${upstream.root}`, `    root_prd: ${upstream.rootPrdSlug}`, ""].join(
      "\n",
    ),
  );
  return root;
}

function makeTwin(prefix: string): { upstream: UpstreamFixture; consumerRoot: string } {
  const upstream = makeUpstream(prefix);
  const consumerRoot = makeConsumer(prefix, upstream);
  track(upstream.root, consumerRoot);
  return { upstream, consumerRoot };
}

/**
 * Disables the upstream `spec-promote`/`review-judgment` gates so a throwaway
 * fixture can walk a fixing spec draft->approved->archived without unrelated
 * ceremony. APPENDS (never overwrites): `lore init`'s own `project:` stanza is
 * REQUIRED by `LoreConfigSchema`, and a replaced file silently degrades to "no
 * config" (= every gate enabled), i.e. a disable that never takes effect.
 */
function disableUpstreamGates(upstreamRoot: string): void {
  assertUnderTmp(upstreamRoot);
  appendFileSync(
    join(upstreamRoot, ".lore", "config.yaml"),
    ["workflow:", "  gates:", '    "spec-promote":', "      enabled: false", '    "review-judgment":', "      enabled: false", ""].join(
      "\n",
    ),
  );
}

/** Files one report from the consumer; returns its upstream doc id. Asserts exit 0. */
function fileReport(consumerRoot: string, title: string): string {
  const { result, data } = runJson<{ ok: true; data: { upstream_doc_id: string } }>(
    ["report-issue", "--title", title, "--description", "desc", "--expected", "exit 0", "--actual", "exit 4"],
    { cwd: consumerRoot, env: { LORE_ACTOR: "agent:dc1-reporter" } },
  );
  expect(result.exitCode).toBe(0);
  return data.data.upstream_doc_id;
}

/** Attempts one report WITHOUT asserting success — used to observe a refusal. */
function tryFileReport(consumerRoot: string, title: string): RunResult {
  return run(
    ["report-issue", "--title", title, "--description", "desc", "--expected", "exit 0", "--actual", "exit 4"],
    { cwd: consumerRoot, env: { LORE_ACTOR: "agent:dc1-reporter" } },
  );
}

/** Fills the cap: files exactly `OPEN_REPORT_CAP` reports, returning their ids. */
function fillCap(consumerRoot: string, prefix: string): string[] {
  const ids: string[] = [];
  for (let i = 0; i < OPEN_REPORT_CAP; i += 1) {
    ids.push(fileReport(consumerRoot, `${prefix} report ${i}`));
  }
  return ids;
}

interface ResolveOptions {
  readonly pointerFlag?: string;
  readonly pointerValue?: string;
}

function resolveIssue(upstreamRoot: string, issueId: string, state: string, opts: ResolveOptions = {}): RunResult {
  const args = ["issue", "resolve", issueId, "--state", state, "--reason", `resolved as ${state}`, "--by", "agent:dc1-maintainer"];
  if (opts.pointerFlag !== undefined && opts.pointerValue !== undefined) {
    args.push(opts.pointerFlag, opts.pointerValue);
  }
  return run(args, { cwd: upstreamRoot });
}

interface IssueRow {
  id: string;
  slug: string;
  resolution: string;
}

function listIssues(upstreamRoot: string, mode: "--open" | "--resolved" | "--all"): { result: RunResult; rows: IssueRow[] } {
  const { result, data } = runJson<{ ok: true; data: { reports: IssueRow[] } }>(["issues", mode], { cwd: upstreamRoot });
  return { result, rows: data.data.reports };
}

/** The raw lifecycle status of an upstream doc — the decisive "nothing moved" control. */
function docStatus(upstreamRoot: string, idOrSlug: string): string {
  const { result, data } = runJson<{ ok: true; data: { doc: { status: string } } }>(["get", idOrSlug], {
    cwd: upstreamRoot,
  });
  expect(result.exitCode).toBe(0);
  return data.data.doc.status;
}

// ─── Suite setup ──────────────────────────────────────────────────────────────

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
      // reason: best-effort cleanup — a fixture a test itself removed must not throw here.
    }
  }
});

describe("AC-DC-1: a non-derogatory resolution releases cap quota end-to-end", () => {
  it("AC-DC-1: 10 filed, 11th refused, all 10 resolved superseded/duplicate, then the 11th is ACCEPTED", () => {
    const { upstream, consumerRoot } = makeTwin("release");
    disableUpstreamGates(upstream.root);
    const ids = fillCap(consumerRoot, "quota-release");
    expect(ids.length).toBe(OPEN_REPORT_CAP);

    // Step 2 of the measured sequence: the cap binds.
    const refusedBefore = tryFileReport(consumerRoot, "the 11th, before any resolution");
    expect(refusedBefore.exitCode).toBe(4);
    for (const id of ids) expect(refusedBefore.stderr).toContain(id);

    // Step 3: resolve ALL 10 with the two NON-DEROGATORY states. Half point at a
    // real upstream doc (the root PRD stands in for "the doc that supersedes
    // this report"); half are marked duplicates of the FIRST report.
    const firstId = ids[0] as string;
    ids.forEach((id, index) => {
      const resolveResult =
        index % 2 === 0
          ? resolveIssue(upstream.root, id, "superseded", {
              pointerFlag: "--superseded-by",
              pointerValue: upstream.rootPrdSlug,
            })
          : resolveIssue(upstream.root, id, "duplicate", { pointerFlag: "--duplicate-of", pointerValue: firstId });
      expect(resolveResult.exitCode).toBe(0);
    });

    // STATE control: nothing moved off `draft` — the corpus cannot even express
    // that transition, which is why the cap had to stop counting raw status.
    for (const id of ids) expect(docStatus(upstream.root, id)).toBe("draft");

    // Step 4, inverted: the report the measured probe saw refused is ACCEPTED.
    const acceptedId = fileReport(consumerRoot, "the 11th, after 10 non-derogatory resolutions");
    expect(acceptedId.length).toBeGreaterThan(0);

    // The new states stay VISIBLE under --resolved (never a silent trash can),
    // and the freshly-filed report is the ONLY thing still open.
    const resolved = listIssues(upstream.root, "--resolved");
    expect(resolved.result.exitCode).toBe(0);
    const resolvedById = new Map(resolved.rows.map((row) => [row.id, row.resolution]));
    ids.forEach((id, index) => {
      expect(resolvedById.get(id)).toBe(index % 2 === 0 ? "superseded" : "duplicate");
    });

    const open = listIssues(upstream.root, "--open");
    expect(open.rows.map((row) => row.id)).toEqual([acceptedId]);
  }, 300_000);

  it("AC-DC-1: a refusal at cap names EXACTLY the non-terminal reports, excluding every released one; a FAILED resolve frees nothing", () => {
    // ⛔ In-flight fixture correction, recorded because "AC went red -> AC was
    // edited -> AC went green" is indistinguishable from covering up a failure
    // unless the edit is disclosed (root CLAUDE.md). The FIRST version of this
    // case resolved 9 of 10 and expected the next filing to be REFUSED; it
    // measured exit 0. That expectation was arithmetically impossible — with 9
    // slots released only 1 report blocks, and 1 < the cap of 10, so an
    // acceptance is the CORRECT behaviour and the fixture, not the
    // implementation, was wrong. The scenario below is STRICTER than the one it
    // replaces: it drives the candidate set to 12 (2 released + 10 blocking) so
    // the refusal must name a SUBSET, which is the property the old fixture
    // wanted to assert and structurally could not reach.
    const { upstream, consumerRoot } = makeTwin("partial");
    const ids = fillCap(consumerRoot, "partial");

    // Two released via the two DEROGATORY states — the measured F1 probe used
    // `rejected` and got nothing back; it must free a slot now too.
    const releasedIds = [ids[0] as string, ids[1] as string];
    expect(resolveIssue(upstream.root, releasedIds[0] as string, "rejected").exitCode).toBe(0);
    expect(resolveIssue(upstream.root, releasedIds[1] as string, "wontfix").exitCode).toBe(0);

    // Refill the two freed slots, so the candidate set is 12 while exactly 10 block.
    const refilledIds = [
      fileReport(consumerRoot, "refill after the rejected release"),
      fileReport(consumerRoot, "refill after the wontfix release"),
    ];
    const blockingIds = [...ids.slice(2), ...refilledIds];
    expect(blockingIds.length).toBe(OPEN_REPORT_CAP);

    const refused = tryFileReport(consumerRoot, "one past the cap");
    expect(refused.exitCode).toBe(4);
    for (const id of blockingIds) expect(refused.stderr).toContain(id);
    for (const releasedId of releasedIds) expect(refused.stderr).not.toContain(releasedId);

    // ERROR dimension: a REFUSED resolve (pointer that resolves to nothing) must
    // not release a slot — the report it targeted keeps blocking.
    const targetId = blockingIds[0] as string;
    const failedResolve = resolveIssue(upstream.root, targetId, "superseded", {
      pointerFlag: "--superseded-by",
      pointerValue: "spec-this-doc-does-not-exist-anywhere",
    });
    expect(failedResolve.exitCode).toBe(4);
    const stillRefused = tryFileReport(consumerRoot, "still blocking after a failed resolve");
    expect(stillRefused.exitCode).toBe(4);
    expect(stillRefused.stderr).toContain(targetId);

    // And once that one is legitimately released, filing proceeds.
    expect(
      resolveIssue(upstream.root, targetId, "superseded", {
        pointerFlag: "--superseded-by",
        pointerValue: upstream.rootPrdSlug,
      }).exitCode,
    ).toBe(0);
    expect(tryFileReport(consumerRoot, "accepted after the release").exitCode).toBe(0);
  }, 300_000);

  it("AC-DC-1: the ceiling still binds — one release admits exactly one more report, then refuses again", () => {
    const { upstream, consumerRoot } = makeTwin("boundary");
    const ids = fillCap(consumerRoot, "boundary");

    expect(resolveIssue(upstream.root, ids[3] as string, "duplicate", {
      pointerFlag: "--duplicate-of",
      pointerValue: ids[0] as string,
    }).exitCode).toBe(0);

    expect(tryFileReport(consumerRoot, "the one freed slot").exitCode).toBe(0);
    const refusedAgain = tryFileReport(consumerRoot, "one past the refilled ceiling");
    expect(refusedAgain.exitCode).toBe(4);
    expect(refusedAgain.stderr).not.toContain(ids[3] as string);
  }, 300_000);

  it("AC-DC-1: a COMPUTED 'fixed' resolution (resolves edge to an archived doc) also frees quota", () => {
    const { upstream, consumerRoot } = makeTwin("computed");
    disableUpstreamGates(upstream.root);
    const ids = fillCap(consumerRoot, "computed");
    const fixedId = ids[0] as string;

    const spec = runJson<{ ok: true; data: { id: string } }>(
      [
        "create",
        "spec",
        "--title",
        "Fixing spec for the computed-resolution path",
        "--parent",
        upstream.rootPrdId,
        "--content",
        "# Overview/Goal\nfix\n## Scope\nn/a\n## Acceptance Criteria\nn/a",
      ],
      { cwd: upstream.root },
    );
    expect(spec.result.exitCode).toBe(0);
    const specId = spec.data.data.id;
    expect(run(["set", specId, "--status", "approved", "--by", "tester"], { cwd: upstream.root }).exitCode).toBe(0);
    expect(run(["set", specId, "--status", "archived", "--by", "tester"], { cwd: upstream.root }).exitCode).toBe(0);
    expect(run(["link", specId, fixedId, "--type", "resolves", "--by", "tester"], { cwd: upstream.root }).exitCode).toBe(0);

    // Nothing was written to the report itself — its resolution is COMPUTED.
    expect(docStatus(upstream.root, fixedId)).toBe("draft");
    expect(tryFileReport(consumerRoot, "admitted because one report is computed-fixed").exitCode).toBe(0);
  }, 300_000);
});
