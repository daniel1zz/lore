/**
 * AC-DC-17 — REWRITTEN (task-skill-test-retire-or-rewrite-ac-dc-17-whose-
 * subject-cap), not retired. Compiled-binary e2e, the bun-runner half of
 * §M7's `adopted` mechanism, split from AC-DC-14 because this repo's two
 * test runners cannot share one attestable command
 * (spec-the-defect-channel-cannot-be-honestly-maintained-an §M7, superseded
 * by spec-the-defect-channel-reaches-no-machine-but-its-own-github).
 *
 * ⛔ WHY REWRITTEN, NOT RETIRED: the superseding spec's P1 deletes the
 * open-report rate cap outright (its six symbols scanned for zero survivors
 * by AC-GI-9; `task-skill-implement-delete-the-six-cap-symbols-and-retire-
 * the`). This file's ORIGINAL subject — that an `adopted` resolution FREES
 * CAP QUOTA — is not merely failing, it is UNFALSIFIABLE: there is no
 * implementation that could make "quota is freed" true when there is no
 * quota to free. That half is deleted, not weakened (byte-identical
 * disposition to `AC-DC-14` in
 * unit/service/issue-resolution.test.ts and `AC-072-6` in
 * unit/service/issue-report-cross-corpus.bun.test.ts).
 *
 * What SURVIVES §M7, and is what this file now proves through the COMPILED
 * `dist/lore` binary from a throwaway corpus (`mkdtemp` + `lore init`): a
 * real `lore issue resolve --state adopted --adopted-by <doc>` (a) REFUSES
 * a pointer that is missing or does not resolve to a live plan/task, exit
 * EXACTLY 4, before any write; (b) ACCEPTS a pointer that does resolve, exit
 * 0; and (c) once accepted, the report's computed resolution reads back as
 * EXACTLY `"adopted"` and the report STILL appears in `lore issues`'
 * default (unresolved-only) listing — i.e. `adopted` is non-terminal, never
 * a substitute for a real terminal verdict. None of this depended on quota
 * ever existing. `checkResolutionPointer`/`isDanglingAdoption`
 * (service/issue-resolution.ts) already carry unit coverage of the SAME
 * claim (AC-DC-15/AC-DC-16, unit/service/issue-resolution.test.ts) — but
 * only as pure functions fed synthetic inputs. This file remains the ONLY
 * place in the repo driving that claim through the REAL compiled CLI: real
 * corpus lookups, real doc-type checks, real `lore issues --json` read-back.
 * Retiring it outright would leave that wiring with zero surface-level
 * coverage — the mirror image of
 * `knowledge-an-attested-pass-is-not-evidence-of-production-wiring`: a
 * unit-only pass never proves the CLI actually wires the pure decision in.
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
 *   HAPPY:      `--adopted-by <live plan>` resolves and is ACCEPTED (exit 0)
 *   NEGATIVE:   no `--adopted-by` at all, and an `--adopted-by` naming no
 *               doc in this corpus, are both REFUSED (exit 4) before any
 *               write — the exact wiring §M7's pointer requirement exists
 *               to enforce, now exercised through the real CLI, not a pure
 *               function
 *   BOUNDARY:   the adopted report's computed resolution is EXACTLY
 *               `"adopted"`, read back via the compiled `lore issues --json`
 *   ERROR:      every exit code asserted EXACTLY (`toBe`, never "non-zero")
 *   STATE:      `lore issues` (default, unresolved-only) still carries the
 *               adopted report's id AFTER the accept — the non-terminal
 *               claim §M7 requires (AC-DC-14(a)'s cross-runner counterpart)
 *   REGRESSION: the provenance preflight itself: RED verified by hand
 *               (recorded separately) that pointing this suite at a
 *               deliberately stale binary makes the provenance assertion
 *               FAIL rather than skip
 *
 * Source: spec-the-defect-channel-reaches-no-machine-but-its-own-github
 *   (supersedes spec-the-defect-channel-cannot-be-honestly-maintained-an
 *   §M7, AC-DC-17); task-land-the-adopted-resolution-state-its-required-
 *   owner; task-skill-test-retire-or-rewrite-ac-dc-17-whose-subject-cap.
 */

import { RecordLockService } from "../../src/service/record-lock-service.js";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { SQLiteStore } from "../../src/store/sqlite-store.js";
import { CorpusService } from "../../src/service/corpus-service.js";

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
 * site (`makeUpstream`) — never this repo's own `.lore/`.
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

// ─── Single-corpus fixture: the corpus that owns the queue + the owner plan ──
//
// ⛔ REWRITTEN (P4, spec-the-defect-channel-reaches-no-machine-but-its-own-
// github): this used to be a TWIN-corpus fixture — a separate "consumer"
// filed reports via `lore report-issue` against this "upstream", configured
// with the legacy `feedback.upstream.{corpus_path,root_prd}` shape. That
// legacy SQLite transport is deleted outright in P4 — filing through it now
// refuses loudly by design. This file's ACTUAL subject, §M7's `adopted`
// mechanism on `lore issue resolve`, has never depended on HOW a report was
// created. `fileReport` now constructs that shape DIRECTLY via `SQLiteStore`
// + `CorpusService` (the established in-process bun-test seeding pattern —
// see `tests/unit/store/schema-probe.bun.test.ts`'s own header), and every
// downstream CLI operation runs with `cwd: upstream.root` (unchanged from
// before, since that is where the doc actually lives).

interface UpstreamFixture {
  readonly root: string;
  readonly rootPrdSlug: string;
}

function makeUpstream(): UpstreamFixture {
  const root = mkdtempSync(join(TMP_ROOT, "lore-dc17-upstream-"));
  assertUnderTmp(root);
  fixturesToClean.push(root);
  expect(run(["init"], { cwd: root }).exitCode).toBe(0);

  const prd = runJson<{ ok: true; data: { slug: string } }>(
    ["create", "prd", "--title", "Upstream Root PRD (dc17)", "--content", "root prd content"],
    { cwd: root },
  );
  expect(prd.result.exitCode).toBe(0);
  return { root, rootPrdSlug: prd.data.data.slug };
}

/**
 * Seeds one issue-report draft task DIRECTLY into `upstream.root` via
 * `SQLiteStore` + `CorpusService`, replicating the now-deleted legacy
 * `UpstreamPort.createDraft`'s exact shape: `extra.adhoc: true`, NO
 * `parent_id` (the omission is deliberate — `CorpusService._createImpl`'s
 * own `--adhoc` auto-parenting special case, which resolves the corpus's
 * root PRD as parent, fires ONLY when `parent_id` is omitted; passing it
 * explicitly would instead hit the normal `PARENT_TYPE_CONTRACT` check, which
 * does not allow `task` under `prd`). Returns the created task's id.
 */
async function fileReport(upstream: UpstreamFixture, title: string): Promise<string> {
  const store = new SQLiteStore(join(upstream.root, ".lore", "lore.db"));
  const corpusService = new CorpusService(store, new RecordLockService(store));
  try {
    const result = await corpusService.create({
      type: "task",
      title,
      content: "desc",
      extra: {
        adhoc: true,
        ac_scope: [],
        issue_report: {
          reporter_project: "test-seed (direct)",
          reporter_actor: "agent:dc17-reporter",
          lore_version: "0.0.0-test",
          expected: "exit 0",
          actual: "exit 4",
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

interface IssuesJsonRow {
  readonly id: string;
  readonly resolution: string;
}
interface IssuesJsonPayload {
  ok: true;
  data: { reports: IssuesJsonRow[] };
}

describe("AC-DC-17 rewritten: production wiring, compiled binary — adopted is non-terminal and requires a live owner pointer", () => {
  it("NEGATIVE/HAPPY/BOUNDARY/STATE: --adopted-by is refused without a resolvable owner, accepted with a live plan, and the adopted report reads back as non-terminal", async () => {
    const upstream = makeUpstream();

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

    const reportId = await fileReport(upstream, "dc17 report needing adoption");

    // NEGATIVE (a) — no `--adopted-by` at all: argv-only refusal, before
    // `loadLoreApp()` ever runs, so it provably writes zero bytes.
    const missingPointer = run(["issue", "resolve", reportId, "--state", "adopted", "--reason", "no owner given"], {
      cwd: upstream.root,
    });
    expect(missingPointer.exitCode).toBe(4);

    // NEGATIVE (b) — an `--adopted-by` that resolves to nothing in this
    // corpus: refused for a DIFFERENT reason (unresolvable, not missing),
    // same exit code — the real corpus lookup this pure-function unit tests
    // (AC-DC-15) cannot exercise on its own.
    const unresolvablePointer = run(
      [
        "issue",
        "resolve",
        reportId,
        "--state",
        "adopted",
        "--adopted-by",
        "plan-this-slug-does-not-exist-anywhere-dc17",
        "--reason",
        "owner does not exist",
      ],
      { cwd: upstream.root },
    );
    expect(unresolvablePointer.exitCode).toBe(4);

    // HAPPY — a pointer resolving to a live plan is accepted, via the REAL
    // compiled CLI, against the corpus that actually holds the doc (upstream).
    const adoptResult = run(
      [
        "issue",
        "resolve",
        reportId,
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

    // BOUNDARY/STATE — `lore issues` (default: unresolved-only) still carries
    // the adopted report's id, with computed resolution EXACTLY "adopted" —
    // the non-terminal claim §M7 requires, read back through the compiled
    // CLI's OWN read surface (never re-derived by this test). Reads
    // `cwd: upstream.root` directly (P4 rewrite: no more separate consumer —
    // that is where the doc actually lives, and local reads are unaffected
    // by the retired transport).
    const issuesListing = runJson<IssuesJsonPayload>(["issues"], { cwd: upstream.root });
    expect(issuesListing.result.exitCode, `lore issues failed: ${issuesListing.result.stderr}`).toBe(0);
    const adoptedRow = issuesListing.data.data.reports.find((r) => r.id === reportId);
    expect(adoptedRow, `adopted report ${reportId} must still appear in the default (unresolved-only) listing`).toBeDefined();
    expect(adoptedRow?.resolution).toBe("adopted");
  }, 15000);
  // ^ explicit timeout (spec-a-test-case-s-timeout-budget-must-be-declared-when-its
  // D1/D2, check-test-budgets.ts): this body calls the `run`/`runJson` spawn
  // helper 3 DIRECT times (missingPointer, unresolvablePointer, adoptResult)
  // — the structural oracle's own counted shape — plus 2 more via `runJson`
  // (ownerPlan create, issuesListing) and 2 more inside `makeUpstream` (init,
  // create prd): 7 real `dist/lore` spawns total per run. Measured (junit
  // reporter, 3 consecutive runs on this machine, no induced load): 1264ms /
  // 1218ms / 1218ms. 15000ms gives ~12x headroom over the worst observed
  // figure against bun:test's DEFAULT 5000ms budget, without policing the
  // number (the oracle only requires the argument be present) — the same
  // spawn-count-driven phantom-timeout risk `cli-plan-promote-advisory.bun.
  // test.ts`'s AC-VRW-5b case measured (6222ms/6981ms against the 5000ms
  // default under load).
});
