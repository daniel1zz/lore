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
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

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
  readonly consumerRoot: string;
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

  const consumerRoot = mkdtempSync(join(TMP_ROOT, `lore-dc4-consumer-${prefix}-`));
  assertUnderTmp(consumerRoot);
  fixturesToClean.push(consumerRoot);
  expect(run(["init"], { cwd: consumerRoot }).exitCode).toBe(0);
  appendFileSync(
    join(consumerRoot, ".lore", "config.yaml"),
    ["feedback:", "  upstream:", `    corpus_path: ${upstreamRoot}`, `    root_prd: ${prd.data.data.slug}`, ""].join("\n"),
  );

  return { upstreamRoot, consumerRoot, rootPrdId: prd.data.data.id, rootPrdSlug: prd.data.data.slug };
}

function fileReport(fixture: Fixture, title: string): string {
  const filed = runJson<{ ok: true; data: { upstream_doc_id: string } }>(
    ["report-issue", "--title", title, "--description", "d", "--expected", "e", "--actual", "a"],
    { cwd: fixture.consumerRoot },
  );
  expect(filed.result.exitCode).toBe(0);
  return filed.data.data.upstream_doc_id;
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
  it("AC-DC-4: --state superseded with NO --superseded-by exits 4 and leaves extra byte-identical", () => {
    const fixture = makeFixture("missing-superseded");
    const issueId = fileReport(fixture, "report awaiting supersession");
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

  it("AC-DC-4: --state duplicate with NO --duplicate-of exits 4 and leaves extra byte-identical", () => {
    const fixture = makeFixture("missing-duplicate");
    const issueId = fileReport(fixture, "report awaiting duplicate marking");
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

  it("AC-DC-4: a pointer that resolves to NO doc exits 4 (validation, not a bare not-found) and writes nothing", () => {
    const fixture = makeFixture("dangling-pointer");
    const issueId = fileReport(fixture, "report with a dangling supersession pointer");
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

  it("AC-DC-4: a pointer flag passed for a state that takes none is refused (exit 4), nothing written", () => {
    const fixture = makeFixture("pointer-for-wrong-state");
    const issueId = fileReport(fixture, "report resolved as rejected with a stray pointer");
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

  it("AC-DC-4: a RESOLVING pointer is accepted, stored as the resolved doc ID, and every sibling extra key survives", () => {
    const fixture = makeFixture("happy");
    const issueId = fileReport(fixture, "report legitimately superseded");
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

  it("AC-DC-4: re-resolving as the other pointer state replaces the resolution wholesale — no stale pointer lingers", () => {
    const fixture = makeFixture("state-replace");
    const primaryId = fileReport(fixture, "the surviving report");
    const issueId = fileReport(fixture, "the report that changes its terminal state");

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

  it("AC-DC-4: rejected still needs no pointer, and --state fixed is still refused unconditionally (regression)", () => {
    const fixture = makeFixture("regression");
    const issueId = fileReport(fixture, "report resolved the pre-existing way");

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
