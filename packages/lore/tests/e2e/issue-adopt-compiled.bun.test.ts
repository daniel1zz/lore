/**
 * AC-DC-17 — compiled-binary e2e, the bun-runner half of §M7's `adopted`
 * mechanism, split from AC-DC-14 because this repo's two test runners cannot
 * share one attestable command (spec-the-defect-channel-cannot-be-honestly-
 * maintained-an §M7). From a throwaway corpus created by `mkdtemp` plus
 * `lore init`, driven by the COMPILED `dist/lore` binary: a real `lore issue
 * resolve --state adopted --adopted-by <live task>` frees quota so the next
 * `lore report-issue` is ACCEPTED, and `lore issues` still shows the adopted
 * row as unfinished.
 *
 * BINARY FRESHNESS IS ASSERTED, NOT ASSUMED. Before spawning anything else,
 * `beforeAll` builds `dist/lore` from THIS worktree (`bun run build`, same
 * pattern `issue-cap-refusal-message.bun.test.ts` establishes) and then runs
 * `lore status --check-binary-provenance` through that SAME resolved dist
 * path, requiring exit EXACTLY 0. A nonzero verdict FAILS THE SUITE loudly,
 * naming the built-from commit and repo HEAD from the check's own `--json`
 * payload — this never skips: a skipped wiring check is indistinguishable
 * from a passing one. `DIST_LORE` is the one dist-path constant every sibling
 * compiled-binary e2e suite in this directory derives the same way (never a
 * bare `lore` on PATH, which would resolve to this machine's global symlink
 * rather than this build).
 *
 * ⛔ Never this repo's own `.lore/` corpus (root CLAUDE.md) — every corpus is
 * a throwaway `mkdtemp` pair asserted under `os.tmpdir()`.
 *
 * Six-dimension coverage:
 *   HAPPY:      cap filled by N reports, one adopted via the compiled CLI,
 *               the N+1th report is ACCEPTED (exit 0)
 *   NEGATIVE:   before adopting, the N+1th report is refused (exit 4) — the
 *               exact baseline this mechanism exists to fix
 *   BOUNDARY:   the adopted report's computed resolution is EXACTLY
 *               `"adopted"`, read back via the compiled `lore issues --json`
 *   ERROR:      every exit code asserted EXACTLY (`toBe`, never "non-zero")
 *   STATE:      `lore issues` (default, unresolved-only) still carries the
 *               adopted report's id AFTER the accept — the non-terminal
 *               claim §M7 requires (AC-DC-14(a)'s cross-runner counterpart)
 *   REGRESSION: the provenance preflight itself: RED verified by hand
 *               (recorded separately) that reverting the cap's candidate
 *               narrowing makes the accept case exit 4, and that pointing this
 *               suite at a deliberately stale binary makes the provenance
 *               assertion FAIL rather than skip
 *
 * Source: spec-the-defect-channel-cannot-be-honestly-maintained-an §M7,
 *   AC-DC-17; task-land-the-adopted-resolution-state-its-required-owner.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// ─── Worktree-anchored dist/lore binary (never the main checkout's, never a
//     bare `lore` on PATH) ─────────────────────────────────────────────────

/** packages/lore/tests/e2e -> this worktree's root (4 levels up). */
const WORKTREE_ROOT = resolve(import.meta.dir, "..", "..", "..", "..");
const DIST_LORE = join(WORKTREE_ROOT, "dist", "lore");
const TMP_ROOT = tmpdir();

/** Every fixture path MUST resolve under the OS tmpdir — never this repo's own `.lore/`. */
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

/**
 * Synchronous `dist/lore <args>` spawn — CLAUDECODE=1 (agent surface, no AI
 * nesting). ⛔ Deliberately does NOT enforce `assertUnderTmp` on every call:
 * the ONE exception is `beforeAll`'s provenance preflight, which MUST run
 * with `cwd: WORKTREE_ROOT` (a `--check-binary-provenance` check against a
 * corpus-free tmp dir would answer "not a dev checkout", not the dev-synced
 * verdict this suite needs). Every OTHER call site in this file passes a
 * `mkdtemp`-created fixture root, each asserted under tmp at ITS OWN creation
 * site (`makeUpstream`/`makeConsumer`) — never this repo's own `.lore/`.
 */
function run(args: string[], opts: { cwd: string; env?: Record<string, string> }): RunResult {
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

const fixturesToClean: string[] = [];

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

  // BINARY FRESHNESS IS ASSERTED, NOT ASSUMED — before spawning anything
  // else, drive the SAME dist binary's own provenance check against THIS
  // worktree's git repo. Exit EXACTLY 0 required; a nonzero verdict fails the
  // suite loudly, naming built-from and HEAD from the check's own payload —
  // never skipped.
  interface ProvenancePayload {
    ok: true;
    data: {
      binary_provenance_check: {
        kind: string;
        build_commit?: string;
        repo_head?: string;
        summary: string;
      };
    };
  }
  const provenanceResult = run(["status", "--check-binary-provenance"], { cwd: WORKTREE_ROOT });
  if (provenanceResult.exitCode !== 0) {
    let detail = `stdout: ${provenanceResult.stdout}\nstderr: ${provenanceResult.stderr}`;
    try {
      const { data } = runJson<ProvenancePayload>(["status", "--check-binary-provenance"], { cwd: WORKTREE_ROOT });
      const check = data.data.binary_provenance_check;
      detail = `kind=${check.kind}, built-from=${check.build_commit ?? "(unknown)"}, HEAD=${check.repo_head ?? "(unknown)"}, summary: ${check.summary}`;
    } catch {
      // reason: JSON re-parse is best-effort diagnostic detail; the raw
      // stdio above already carries the failure either way.
    }
    throw new Error(
      `binary-provenance guard: 'lore status --check-binary-provenance' exited ${provenanceResult.exitCode} ` +
        `(expected EXACTLY 0) — ${detail}. Run 'bun run build' from this worktree's root before running this suite.`,
    );
  }
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

// ─── Twin-corpus fixture: upstream (owns the queue + the owner plan) plus  ──
// ─── consumer (files reports against it)                                  ──

interface UpstreamFixture {
  readonly root: string;
  readonly rootPrdSlug: string;
}

const CAP = 2;

function makeUpstream(): UpstreamFixture {
  const root = mkdtempSync(join(TMP_ROOT, "lore-dc17-upstream-"));
  assertUnderTmp(root);
  fixturesToClean.push(root);
  expect(run(["init"], { cwd: root }).exitCode).toBe(0);

  // §M2 — a small cap, declared by the UPSTREAM's own config, so this suite
  // fills it with 2 reports rather than the shipped default of 10.
  appendFileSync(
    join(root, ".lore", "config.yaml"),
    ["feedback:", "  inbound:", `    open_report_cap: ${CAP}`, ""].join("\n"),
  );

  const prd = runJson<{ ok: true; data: { slug: string } }>(
    ["create", "prd", "--title", "Upstream Root PRD (dc17)", "--content", "root prd content"],
    { cwd: root },
  );
  expect(prd.result.exitCode).toBe(0);
  return { root, rootPrdSlug: prd.data.data.slug };
}

function makeConsumer(upstream: UpstreamFixture): string {
  const root = mkdtempSync(join(TMP_ROOT, "lore-dc17-consumer-"));
  assertUnderTmp(root);
  fixturesToClean.push(root);
  expect(run(["init"], { cwd: root }).exitCode).toBe(0);
  appendFileSync(
    join(root, ".lore", "config.yaml"),
    ["feedback:", "  upstream:", `    corpus_path: ${upstream.root}`, `    root_prd: ${upstream.rootPrdSlug}`, ""].join(
      "\n",
    ),
  );
  return root;
}

/** Attempts one report from `consumerRoot`, WITHOUT asserting success — the observation primitive for both sides of the cap boundary. */
function tryFileReport(consumerRoot: string, title: string): RunResult {
  return run(
    ["report-issue", "--title", title, "--description", "desc", "--expected", "exit 0", "--actual", "exit 4"],
    { cwd: consumerRoot, env: { LORE_ACTOR: "agent:dc17-reporter" } },
  );
}

/** Files one report, asserting exit 0; returns its upstream doc id. */
function fileReport(consumerRoot: string, title: string): string {
  const { result, data } = runJson<{ ok: true; data: { upstream_doc_id: string } }>(
    ["report-issue", "--title", title, "--description", "desc", "--expected", "exit 0", "--actual", "exit 4"],
    { cwd: consumerRoot, env: { LORE_ACTOR: "agent:dc17-reporter" } },
  );
  expect(result.exitCode, `expected report-issue to succeed: ${result.stderr}`).toBe(0);
  return data.data.upstream_doc_id;
}

interface IssuesJsonRow {
  readonly id: string;
  readonly resolution: string;
}
interface IssuesJsonPayload {
  ok: true;
  data: { reports: IssuesJsonRow[] };
}

describe("AC-DC-17: production wiring, compiled binary — adopted frees quota end to end", () => {
  it("HAPPY/NEGATIVE/BOUNDARY/STATE: cap refuses at N, --state adopted --adopted-by <live task> frees a slot, the N+1th is accepted, and the adopted row stays visible as unfinished", () => {
    const upstream = makeUpstream();
    const consumerRoot = makeConsumer(upstream);

    // §M7 — the owner MUST be a live plan or task; never auto-created by
    // this suite's own report-filing (out of scope, same as the mechanism's
    // own declared boundary) — a real pre-existing PLAN doc in the upstream
    // corpus, created here exactly like any other doc (a `plan` needs no
    // `--parent`/`extra.plan_id` the way a non-adhoc `task` would, so this
    // keeps the fixture to one creation call).
    const ownerPlan = runJson<{ ok: true; data: { id: string; slug: string } }>(
      ["create", "plan", "--title", "Owner plan for adopted claim (dc17)", "--content", "# Owner plan"],
      { cwd: upstream.root },
    );
    expect(ownerPlan.result.exitCode, `owner plan creation failed: ${ownerPlan.result.stderr}`).toBe(0);
    const ownerPlanId = ownerPlan.data.data.id;

    // Fill the cap with CAP reports — every one still "open".
    const filedIds: string[] = [];
    for (let i = 0; i < CAP; i += 1) {
      filedIds.push(fileReport(consumerRoot, `dc17 report ${i}`));
    }

    // NEGATIVE — the exact baseline this mechanism fixes: the CAP+1th report
    // is refused, byte-identical in shape to F1's 2026-08-11 measurement.
    const refused = tryFileReport(consumerRoot, "dc17 report overflow (pre-adopt)");
    expect(refused.exitCode).toBe(4);

    // Adopt the FIRST filed report, via the REAL compiled CLI, against the
    // corpus that actually holds the doc (upstream).
    const adoptResult = run(
      [
        "issue",
        "resolve",
        filedIds[0] as string,
        "--state",
        "adopted",
        "--adopted-by",
        ownerPlanId,
        "--reason",
        "owner assigned, work not yet done",
      ],
      { cwd: upstream.root },
    );
    expect(adoptResult.exitCode, `adopt failed: ${adoptResult.stderr}`).toBe(0);

    // HAPPY — quota freed: the same filing that was JUST refused now succeeds.
    const accepted = tryFileReport(consumerRoot, "dc17 report overflow (post-adopt)");
    expect(accepted.exitCode, `expected acceptance after adopting: ${accepted.stderr}`).toBe(0);

    // BOUNDARY/STATE — `lore issues` (default: unresolved-only) still carries
    // the adopted report's id, with computed resolution EXACTLY "adopted" —
    // the non-terminal claim §M7 requires, read back through the compiled
    // CLI's OWN read surface (never re-derived by this test).
    const issuesListing = runJson<IssuesJsonPayload>(["issues"], { cwd: consumerRoot });
    expect(issuesListing.result.exitCode, `lore issues failed: ${issuesListing.result.stderr}`).toBe(0);
    const adoptedRow = issuesListing.data.data.reports.find((r) => r.id === filedIds[0]);
    expect(adoptedRow, `adopted report ${filedIds[0]} must still appear in the default (unresolved-only) listing`).toBeDefined();
    expect(adoptedRow?.resolution).toBe("adopted");
  });
});
