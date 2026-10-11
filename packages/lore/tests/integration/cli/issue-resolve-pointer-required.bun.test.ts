/**
 * AC-DC-4 (spec-the-defect-channel-cannot-be-honestly-maintained-an §M3) — the
 * two NON-DEROGATORY terminal states each REQUIRE a pointer that resolves to an
 * existing doc, and a refusal writes ZERO bytes.
 *
 * Why the pointer is required rather than optional: without it, "superseded"
 * degrades into a silent trash can operationally indistinguishable from
 * "rejected" — which IS the defect M3 exists to fix, not a lesser version of the
 * fix. So `--state superseded` with no `--superseded-by`, or with a pointer that
 * resolves to nothing, must fail LOUD (exit 4) and leave the target task's
 * `extra` byte-identical.
 *
 * "Byte-identical" is measured as a SHA-256 over the serialized `extra` from
 * `lore get --json`, taken before and after each refusal, PLUS the doc's own
 * `version` number (two independent conditions: a version bump would prove a
 * write even if some serialization quirk hid it, and vice versa).
 *
 * ⛔ Throwaway `mkdtempSync` corpus only, asserted under `os.tmpdir()` — never
 * this repo's own `.lore/` (root CLAUDE.md). Spawns the COMPILED `dist/lore`
 * from THIS worktree's root, built once in `beforeAll`.
 *
 * Six-dimension coverage:
 *   NEGATIVE:   `--state superseded` / `--state duplicate` with NO pointer →
 *               exit 4, extra SHA + version unchanged, stderr names the flag
 *   ERROR:      a pointer that resolves to no doc → exit 4 (a VALIDATION_ERROR
 *               on the pointer field, NOT a bare DOC_NOT_FOUND), nothing written
 *   BOUNDARY:   a pointer flag passed for a state that takes none
 *               (`--state rejected --superseded-by <real doc>`) → exit 4
 *   HAPPY:      a resolving pointer → exit 0, `superseded_by`/`duplicate_of`
 *               stores the resolved doc's ID (not the slug the caller typed),
 *               and every sibling `extra` key survives the RMW merge
 *   STATE:      re-resolving as the OTHER pointer state replaces the resolution
 *               wholesale — no stale pointer key lingers
 *   REGRESSION: `--state rejected` still works with no pointer at all, and
 *               `--state fixed` is still refused unconditionally
 *
 * Source: spec-the-defect-channel-cannot-be-honestly-maintained-an §M3, AC-DC-4;
 *   task-one-terminal-resolution-ssot-two-non-derogatory-states-and.
 *
 * ⛔ SEEDING REWRITTEN (P4, spec-the-defect-channel-reaches-no-machine-but-
 * its-own-github): this file used to seed each issue-report task by spawning
 * `lore report-issue` from a SEPARATE "consumer" corpus configured with the
 * legacy `feedback.upstream.{corpus_path,root_prd}` shape pointing at this
 * file's real subject, `upstreamRoot`. That legacy SQLite transport (and the
 * `IssueReportService`/`UpstreamPort` pair that implemented it) is deleted
 * outright in P4 — filing through it now refuses loudly by design. This
 * file's ACTUAL subject, AC-DC-4's pointer-requirement validation on `lore
 * issue resolve`, has never depended on HOW a report was created — only that
 * one exists with the right shape. `seedIssueReport` now constructs that
 * shape DIRECTLY via `SQLiteStore` + `CorpusService` against `upstreamRoot`
 * (the established in-process bun-test seeding pattern for exactly this
 * situation — see `tests/unit/store/schema-probe.bun.test.ts`'s own header),
 * so every downstream assertion (all of which already ran with
 * `cwd: fixture.upstreamRoot`) is unchanged. The "consumer" corpus and its
 * `feedback.upstream` config are removed entirely — nothing in this file
 * ever read them for anything but seeding.
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { SQLiteStore } from "../../../src/store/sqlite-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";

/** packages/lore/tests/integration/cli -> this worktree's root (5 levels up). */
const WORKTREE_ROOT = resolve(import.meta.dir, "..", "..", "..", "..", "..");
const DIST_LORE = join(WORKTREE_ROOT, "dist", "lore");
const TMP_ROOT = tmpdir();

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

interface DocSnapshot {
  readonly extraSha: string;
  readonly version: number;
  readonly extra: Record<string, unknown>;
}

/** SHA-256 over the serialized `extra` plus the doc version — the write detector. */
function snapshotDoc(upstreamRoot: string, idOrSlug: string): DocSnapshot {
  const { result, data } = runJson<{ ok: true; data: { doc: { version: number; extra: Record<string, unknown> } } }>(
    ["get", idOrSlug],
    { cwd: upstreamRoot },
  );
  expect(result.exitCode).toBe(0);
  const extra = data.data.doc.extra;
  return {
    extraSha: createHash("sha256").update(JSON.stringify(extra)).digest("hex"),
    version: data.data.doc.version,
    extra,
  };
}

/** Reads `extra.issue_report.resolution` off a snapshot, defensively. */
function readResolution(snapshot: DocSnapshot): Record<string, unknown> {
  const issueReport = snapshot.extra["issue_report"] as Record<string, unknown> | undefined;
  expect(issueReport).toBeDefined();
  return (issueReport?.["resolution"] ?? {}) as Record<string, unknown>;
}

const fixturesToClean: string[] = [];

interface Fixture {
  readonly upstreamRoot: string;
  readonly rootPrdId: string;
  readonly rootPrdSlug: string;
}

function makeFixture(prefix: string): Fixture {
  const upstreamRoot = mkdtempSync(join(TMP_ROOT, `lore-dc4-upstream-${prefix}-`));
  assertUnderTmp(upstreamRoot);
  fixturesToClean.push(upstreamRoot);
  expect(run(["init"], { cwd: upstreamRoot }).exitCode).toBe(0);
  const prd = runJson<{ ok: true; data: { id: string; slug: string } }>(
    ["create", "prd", "--title", `Upstream Root PRD (dc4-${prefix})`, "--content", "root prd content"],
    { cwd: upstreamRoot },
  );
  expect(prd.result.exitCode).toBe(0);

  return { upstreamRoot, rootPrdId: prd.data.data.id, rootPrdSlug: prd.data.data.slug };
}

/**
 * Seeds one issue-report draft task DIRECTLY into `fixture.upstreamRoot` via
 * `SQLiteStore` + `CorpusService` — replicates the exact shape the now-deleted
 * legacy `UpstreamPort.createDraft` used to write: `extra.adhoc: true` and NO
 * `parent_id` at all, deliberately — `CorpusService._createImpl`'s own
 * `--adhoc` auto-parenting special case (only fires when `parent_id` is
 * OMITTED) resolves the corpus's root PRD as parent; passing `parent_id`
 * explicitly here would instead route through the NORMAL `PARENT_TYPE_CONTRACT`
 * check, which does not allow `task` under `prd` (only under `plan`) and is
 * exactly the mismatch `createDraft`'s own auto-parenting exists to bridge.
 * `status: "draft"` is `CorpusService.create`'s default for a `task`. See
 * this file's own header for why direct construction replaces the retired
 * CLI filing path.
 */
async function fileReport(fixture: Fixture, title: string): Promise<string> {
  const store = new SQLiteStore(join(fixture.upstreamRoot, ".lore", "lore.db"));
  const corpusService = new CorpusService(store, new RecordLockService(store));
  try {
    const result = await corpusService.create({
      type: "task",
      title,
      content: "d",
      extra: {
        adhoc: true,
        ac_scope: [],
        issue_report: {
          reporter_project: "test-seed (direct)",
          reporter_actor: "agent:dc4-seed",
          lore_version: "0.0.0-test",
          expected: "e",
          actual: "a",
          reported_at: new Date().toISOString(),
          possible_duplicates: [],
        },
      },
    });
    if (!result.ok) throw new Error(`direct seed create failed: ${JSON.stringify(result.error)}`);
    return result.value.id;
  } finally {
    store.close();
  }
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

describe("AC-DC-4: a non-derogatory terminal state without a resolving pointer is refused and writes nothing", () => {
  it("AC-DC-4: --state superseded with NO --superseded-by exits 4 and leaves extra byte-identical", async () => {
    const fixture = makeFixture("missing-superseded");
    const issueId = await fileReport(fixture, "report awaiting supersession");
    const before = snapshotDoc(fixture.upstreamRoot, issueId);

    const refused = run(["issue", "resolve", issueId, "--state", "superseded", "--reason", "a better report exists"], {
      cwd: fixture.upstreamRoot,
    });

    expect(refused.exitCode).toBe(4);
    expect(refused.stderr).toContain("--superseded-by");
    const after = snapshotDoc(fixture.upstreamRoot, issueId);
    expect(after.extraSha).toBe(before.extraSha);
    expect(after.version).toBe(before.version);
  }, 120_000);

  it("AC-DC-4: --state duplicate with NO --duplicate-of exits 4 and leaves extra byte-identical", async () => {
    const fixture = makeFixture("missing-duplicate");
    const issueId = await fileReport(fixture, "report awaiting duplicate marking");
    const before = snapshotDoc(fixture.upstreamRoot, issueId);

    const refused = run(["issue", "resolve", issueId, "--state", "duplicate", "--reason", "same as another report"], {
      cwd: fixture.upstreamRoot,
    });

    expect(refused.exitCode).toBe(4);
    expect(refused.stderr).toContain("--duplicate-of");
    const after = snapshotDoc(fixture.upstreamRoot, issueId);
    expect(after.extraSha).toBe(before.extraSha);
    expect(after.version).toBe(before.version);
  }, 120_000);

  it("AC-DC-4: a pointer that resolves to NO doc exits 4 (validation, not a bare not-found) and writes nothing", async () => {
    const fixture = makeFixture("dangling-pointer");
    const issueId = await fileReport(fixture, "report with a dangling supersession pointer");
    const before = snapshotDoc(fixture.upstreamRoot, issueId);

    const refused = run(
      [
        "issue",
        "resolve",
        issueId,
        "--state",
        "superseded",
        "--reason",
        "points nowhere",
        "--superseded-by",
        "spec-this-doc-does-not-exist-anywhere",
      ],
      { cwd: fixture.upstreamRoot },
    );

    expect(refused.exitCode).toBe(4);
    expect(refused.stderr).toContain("spec-this-doc-does-not-exist-anywhere");
    const after = snapshotDoc(fixture.upstreamRoot, issueId);
    expect(after.extraSha).toBe(before.extraSha);
    expect(after.version).toBe(before.version);

    // Same for --duplicate-of, so neither pointer has an unvalidated path.
    const refusedDuplicate = run(
      ["issue", "resolve", issueId, "--state", "duplicate", "--reason", "nope", "--duplicate-of", "01NOTAREALDOCID000000000000"],
      { cwd: fixture.upstreamRoot },
    );
    expect(refusedDuplicate.exitCode).toBe(4);
    const afterDuplicate = snapshotDoc(fixture.upstreamRoot, issueId);
    expect(afterDuplicate.extraSha).toBe(before.extraSha);
    expect(afterDuplicate.version).toBe(before.version);
  }, 120_000);

  it("AC-DC-4: a pointer flag passed for a state that takes none is refused (exit 4), nothing written", async () => {
    const fixture = makeFixture("pointer-for-wrong-state");
    const issueId = await fileReport(fixture, "report resolved as rejected with a stray pointer");
    const before = snapshotDoc(fixture.upstreamRoot, issueId);

    const refused = run(
      ["issue", "resolve", issueId, "--state", "rejected", "--reason", "not a defect", "--superseded-by", fixture.rootPrdSlug],
      { cwd: fixture.upstreamRoot },
    );

    expect(refused.exitCode).toBe(4);
    expect(refused.stderr).toContain("--superseded-by");
    const after = snapshotDoc(fixture.upstreamRoot, issueId);
    expect(after.extraSha).toBe(before.extraSha);
    expect(after.version).toBe(before.version);
  }, 120_000);

  it("AC-DC-4: a RESOLVING pointer is accepted, stored as the resolved doc ID, and every sibling extra key survives", async () => {
    const fixture = makeFixture("happy");
    const issueId = await fileReport(fixture, "report legitimately superseded");
    const before = snapshotDoc(fixture.upstreamRoot, issueId);

    // The caller types the SLUG; the stored pointer must be the resolved ID.
    const accepted = run(
      ["issue", "resolve", issueId, "--state", "superseded", "--reason", "superseded by the root PRD", "--superseded-by", fixture.rootPrdSlug],
      { cwd: fixture.upstreamRoot },
    );
    expect(accepted.exitCode).toBe(0);

    const after = snapshotDoc(fixture.upstreamRoot, issueId);
    expect(after.extraSha).not.toBe(before.extraSha);
    const resolution = readResolution(after);
    expect(resolution["state"]).toBe("superseded");
    expect(resolution["superseded_by"]).toBe(fixture.rootPrdId);
    expect(resolution["reason"]).toBe("superseded by the root PRD");

    // RMW merge: sibling extra keys and sibling issue_report fields survive.
    expect(after.extra["adhoc"]).toBe(true);
    expect(after.extra["ac_scope"]).toEqual([]);
    const issueReport = after.extra["issue_report"] as Record<string, unknown>;
    expect(typeof issueReport["reporter_project"]).toBe("string");
    expect(typeof issueReport["reported_at"]).toBe("string");

    // The computed resolution is visible on the upstream read surface.
    const { result, data } = runJson<{ ok: true; data: { reports: Array<{ id: string; resolution: string }> } }>(
      ["issues", "--resolved"],
      { cwd: fixture.upstreamRoot },
    );
    expect(result.exitCode).toBe(0);
    expect(data.data.reports.find((row) => row.id === issueId)?.resolution).toBe("superseded");
  }, 120_000);

  it("AC-DC-4: re-resolving as the other pointer state replaces the resolution wholesale — no stale pointer lingers", async () => {
    const fixture = makeFixture("state-replace");
    const primaryId = await fileReport(fixture, "the surviving report");
    const issueId = await fileReport(fixture, "the report that changes its terminal state");

    expect(
      run(
        ["issue", "resolve", issueId, "--state", "superseded", "--reason", "first call", "--superseded-by", fixture.rootPrdSlug],
        { cwd: fixture.upstreamRoot },
      ).exitCode,
    ).toBe(0);
    expect(readResolution(snapshotDoc(fixture.upstreamRoot, issueId))["superseded_by"]).toBe(fixture.rootPrdId);

    expect(
      run(["issue", "resolve", issueId, "--state", "duplicate", "--reason", "second call", "--duplicate-of", primaryId], {
        cwd: fixture.upstreamRoot,
      }).exitCode,
    ).toBe(0);

    const resolution = readResolution(snapshotDoc(fixture.upstreamRoot, issueId));
    expect(resolution["state"]).toBe("duplicate");
    expect(resolution["duplicate_of"]).toBe(primaryId);
    expect(resolution["superseded_by"]).toBeUndefined();
  }, 120_000);

  it("AC-DC-4: rejected still needs no pointer, and --state fixed is still refused unconditionally (regression)", async () => {
    const fixture = makeFixture("regression");
    const issueId = await fileReport(fixture, "report resolved the pre-existing way");

    const rejected = run(["issue", "resolve", issueId, "--state", "rejected", "--reason", "not a lore defect"], {
      cwd: fixture.upstreamRoot,
    });
    expect(rejected.exitCode).toBe(0);
    const resolution = readResolution(snapshotDoc(fixture.upstreamRoot, issueId));
    expect(resolution["state"]).toBe("rejected");
    expect(resolution["superseded_by"]).toBeUndefined();
    expect(resolution["duplicate_of"]).toBeUndefined();

    const fixedRefused = run(["issue", "resolve", issueId, "--state", "fixed", "--reason", "n/a"], {
      cwd: fixture.upstreamRoot,
    });
    expect(fixedRefused.exitCode).toBe(4);
    expect(fixedRefused.stderr).toContain("lore link");
  }, 120_000);
});
