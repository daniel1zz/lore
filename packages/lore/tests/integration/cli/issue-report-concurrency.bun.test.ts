/** @spec_ref AC-IC-1 AC-IC-2 AC-IC-4 */
/**
 * The `lore report-issue` CONCURRENCY CONTRACT harness
 * (spec-report-issue-has-no-specified-concurrency-contract-ac-072, AC-IC-1 /
 * AC-IC-2 / AC-IC-4). Two concurrent invocations against ONE upstream corpus
 * must end in exactly one of two states — both wrote, or exactly one wrote
 * while the other refused with the DECLARED exit code and the DECLARED stderr
 * template.
 *
 * ⛔ Every verdict here comes from `@lore/core`'s pure classifiers
 * (`classifyConcurrencyOutcome` / `classifyForcedContentionOutcome`), never
 * from a rule re-implemented in this file (D6) — an e2e harness that restates
 * the contract can quietly disagree with the code that enforces it.
 *
 * Fixtures: ONE mkdtemp'd upstream corpus per test case plus a FRESH mkdtemp'd
 * consumer per run — never the repo's own `.lore/` (root CLAUDE.md). The fresh
 * consumer is load-bearing, not hygiene: SPEC-072's R-5d rate cap counts open
 * drafts per REPORTER PROJECT (derived from the consumer root), so reusing one
 * consumer would start refusing with a VALIDATION_ERROR after 5 runs and the
 * harness would measure the cap instead of the contract.
 *
 * ── Two failure modes that are NOT this contract's ──
 * `§Contract Details` records both, and requires the harness to distinguish
 * them or it "reports a false RED":
 *   1. the compiled binary's native-module (dlopen) load race — measured here
 *      at 1 of 20 natural pairs before this slice;
 *   2. a locked-database refusal from the per-command STARTUP corpus write
 *      (`app.ts` constructs a `SessionStore` unconditionally), which belongs to
 *      a different layer entirely — also MEASURED here, 1 of 50 natural pairs:
 *      `loadLoreApp()` caught it and rendered a generic store error plus
 *      SPEC-073's hint, on the CONSUMER corpus the pair shares.
 * Both classify as `not_attributable`: the run is EXCLUDED and retried, never
 * counted as conforming. Exclusions are capped and reported, so a systemic
 * problem cannot hide behind them — and a regression of the enforcement itself
 * still fails LOUDLY, because AC-IC-2's forced-contention control demands the
 * declared loud failure in all 10 of its runs.
 *
 * Six-dimension coverage:
 *   HAPPY:      AC-IC-1's 50 runs (the natural case is both-succeed, via the
 *               declared bounded wait).
 *   NEGATIVE:   AC-IC-2's control — contention FORCED by an externally-held
 *               open write transaction must produce the declared loud failure;
 *               a both-succeed run there fails the criterion.
 *   ERROR:      AC-IC-4 — the loud stderr carries all three declared parts,
 *               asserted BOTH via the shared matcher and via independent
 *               regexes (so a matcher bug cannot make this vacuous), and never
 *               the pre-contract `Storage failure` wording.
 *   BOUNDARY:   the DECLARED bound is read from config and actually APPLIED —
 *               a 250ms declaration refuses well inside the 2000ms default, a
 *               3000ms declaration waits past 3000ms. Without this pair the
 *               config key could be printed while being inert (root CLAUDE.md's
 *               fifth false-oracle vector).
 *   STATE:      after the holder releases, the retry the message advises
 *               actually succeeds.
 *   REGRESSION: upstream task count equals the number of invocations that
 *               reported success — a refusal wrote nothing, and no success was
 *               lost.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { appendFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  classifyConcurrencyOutcome,
  classifyForcedContentionOutcome,
  matchesWriteContentionTemplate,
  UNKNOWN_CONTENDING_SOURCE,
  WRITE_CONTENTION_EXIT_CODE,
  type InvocationOutcome,
} from "@lore/core";

// ─── Worktree-anchored dist/lore binary (never the main checkout's) ─────────

const WORKTREE_ROOT = resolve(import.meta.dir, "..", "..", "..", "..", "..");
const DIST_LORE = join(WORKTREE_ROOT, "dist", "lore");
const TMP_ROOT = tmpdir();

/** AC-IC-1's run budget. 50 because at the measured ~10% flake rate a 20-run harness misses the bug ~12% of the time. */
const TARGET_RUNS = 50;
/** AC-IC-2's control-run budget. */
const CONTROL_RUNS = 10;
/**
 * Attempt ceilings. An attempt that classifies `not_attributable` does not
 * count toward the target, so the loop needs headroom — bounded, so a
 * systematically broken binary fails the test instead of looping forever.
 */
const MAX_ATTEMPTS = TARGET_RUNS + 30;
const MAX_CONTROL_ATTEMPTS = CONTROL_RUNS + 10;
/** How long the control's child process holds its open write transaction. */
const HOLD_MS = 6000;

/** Every fixture path MUST resolve under the OS tmpdir — never the repo's own `.lore/`. */
function assertUnderTmp(path: string): void {
  if (!path.startsWith(TMP_ROOT)) {
    throw new Error(`Refusing to use a fixture path outside ${TMP_ROOT}: ${path}`);
  }
}

interface RunResult extends InvocationOutcome {
  readonly stdout: string;
}

/** Synchronous `dist/lore <args>` spawn — CLAUDECODE=1 (agent surface, no AI nesting). */
function runSync(args: string[], opts: { cwd: string; env?: Record<string, string> }): RunResult {
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

/** Async `dist/lore <args>` spawn — for the concurrent pair. */
function spawnAsync(
  args: string[],
  opts: { cwd: string; env?: Record<string, string> },
): ReturnType<typeof Bun.spawn> {
  assertUnderTmp(opts.cwd);
  return Bun.spawn([DIST_LORE, ...args], {
    cwd: opts.cwd,
    env: { ...process.env, CLAUDECODE: "1", ...opts.env },
    stdout: "pipe",
    stderr: "pipe",
  });
}

async function waitFor(proc: ReturnType<typeof Bun.spawn>): Promise<RunResult> {
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout as ReadableStream<Uint8Array>).text(),
    new Response(proc.stderr as ReadableStream<Uint8Array>).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const fixturesToClean: string[] = [];
function track(...paths: string[]): void {
  for (const path of paths) fixturesToClean.push(path);
}

interface UpstreamFixture {
  readonly root: string;
  readonly rootPrdSlug: string;
  readonly dbPath: string;
}

/** Fresh mkdtemp corpus, `lore init`'d, with a seeded root PRD. Shared by every run of one case. */
function makeUpstream(prefix: string): UpstreamFixture {
  const root = mkdtempSync(join(TMP_ROOT, `lore-ic-upstream-${prefix}-`));
  assertUnderTmp(root);
  track(root);
  const initResult = runSync(["init"], { cwd: root });
  if (initResult.exitCode !== 0) throw new Error(`upstream 'lore init' failed: ${initResult.stderr}`);
  const prdResult = runSync(
    ["create", "prd", "--title", `Upstream Root PRD (${prefix})`, "--content", "root prd content", "--json"],
    { cwd: root },
  );
  if (prdResult.exitCode !== 0) throw new Error(`upstream root PRD creation failed: ${prdResult.stderr}`);
  const slug = (JSON.parse(prdResult.stdout) as { data: { slug: string } }).data.slug;
  return { root, rootPrdSlug: slug, dbPath: join(root, ".lore", "lore.db") };
}

/**
 * Fresh mkdtemp consumer corpus wired to `upstream` — one per run (see the
 * module header on why the R-5d rate cap makes this mandatory, not cosmetic).
 *
 * @param writeWaitMs - when given, DECLARES `feedback.upstream.write_wait_ms`;
 *   omitted leaves the schema default in force
 */
function makeConsumer(prefix: string, upstream: UpstreamFixture, writeWaitMs?: number): string {
  const root = mkdtempSync(join(TMP_ROOT, `lore-ic-consumer-${prefix}-`));
  assertUnderTmp(root);
  track(root);
  const initResult = runSync(["init"], { cwd: root });
  if (initResult.exitCode !== 0) throw new Error(`consumer 'lore init' failed: ${initResult.stderr}`);
  appendFileSync(
    join(root, ".lore", "config.yaml"),
    [
      "feedback:",
      "  upstream:",
      `    corpus_path: ${upstream.root}`,
      `    root_prd: ${upstream.rootPrdSlug}`,
      ...(writeWaitMs !== undefined ? [`    write_wait_ms: ${writeWaitMs}`] : []),
      "",
    ].join("\n"),
  );
  return root;
}

/** The report-filing argv for one invocation. */
function reportArgs(title: string): string[] {
  return [
    "report-issue",
    "--title",
    title,
    "--description",
    "concurrency-contract harness report",
    "--expected",
    "exit 0",
    "--actual",
    "exit 4",
    "--json",
  ];
}

interface PairResult {
  readonly first: RunResult;
  readonly second: RunResult;
  readonly elapsedMs: number;
}

/** Runs the two-concurrent-invocation scenario once against `consumerRoot`. */
async function runConcurrentPair(consumerRoot: string, label: string): Promise<PairResult> {
  const startedAt = performance.now();
  const firstProc = spawnAsync(reportArgs(`Concurrent A ${label}`), {
    cwd: consumerRoot,
    env: { LORE_ACTOR: `agent:ic-${label}-a` },
  });
  const secondProc = spawnAsync(reportArgs(`Concurrent B ${label}`), {
    cwd: consumerRoot,
    env: { LORE_ACTOR: `agent:ic-${label}-b` },
  });
  const [first, second] = await Promise.all([waitFor(firstProc), waitFor(secondProc)]);
  return { first, second, elapsedMs: performance.now() - startedAt };
}

/**
 * A standalone child-process script holding an OPEN WRITE TRANSACTION on a
 * corpus. Deliberately self-contained raw `bun:sqlite` (zero coupling to this
 * repo's module resolution), mirroring `tests/unit/store/busy-timeout.bun.test.ts`'s
 * proven holder: `BEGIN IMMEDIATE` takes SQLite's RESERVED lock immediately —
 * no write statement inside the transaction is needed to block other writers —
 * then it signals via a marker file and holds for `holdMs` before committing.
 */
const HOLDER_SCRIPT = `
import { Database } from "bun:sqlite";
import { writeFileSync } from "node:fs";

const [, , dbPath, markerPath, holdMsArg] = process.argv;
const db = new Database(dbPath);
db.exec("BEGIN IMMEDIATE");
writeFileSync(markerPath, "locked");
await Bun.sleep(Number(holdMsArg));
db.exec("COMMIT");
db.close();
`;

/** Polls for the holder's marker file (the lock is held), or throws. */
async function waitForMarker(markerPath: string): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!existsSync(markerPath)) {
    if (Date.now() > deadline) {
      throw new Error(`holder process never signalled lock acquisition: ${markerPath}`);
    }
    await Bun.sleep(5);
  }
}

interface Holder {
  readonly proc: ReturnType<typeof Bun.spawn>;
  readonly markerPath: string;
}

/** Starts the lock holder and returns once it has signalled that the write lock is held. */
async function startWriteLockHolder(upstream: UpstreamFixture, label: string): Promise<Holder> {
  const scriptPath = join(upstream.root, `holder-${label}.mjs`);
  const markerPath = join(upstream.root, `locked-${label}.marker`);
  writeFileSync(scriptPath, HOLDER_SCRIPT);
  const proc = Bun.spawn(["bun", scriptPath, upstream.dbPath, markerPath, String(HOLD_MS)], {
    stdout: "ignore",
    stderr: "pipe",
  });
  await waitForMarker(markerPath);
  return { proc, markerPath };
}

/** Number of `task` docs currently in the upstream corpus. */
function upstreamTaskCount(upstream: UpstreamFixture): number {
  const result = runSync(["list", "--type", "task", "--json"], { cwd: upstream.root });
  if (result.exitCode !== 0) throw new Error(`upstream 'lore list' failed: ${result.stderr}`);
  return (JSON.parse(result.stdout) as { data: { total: number } }).data.total;
}

// ─── Suite setup ─────────────────────────────────────────────────────────────

beforeAll(() => {
  // Stale-binary false-oracle vector (root CLAUDE.md): every case below spawns
  // dist/lore, so build it from THIS worktree first.
  const buildResult = Bun.spawnSync(["bun", "run", "build"], { cwd: WORKTREE_ROOT });
  if (buildResult.exitCode !== 0) {
    throw new Error(
      `'bun run build' failed (exit ${buildResult.exitCode}):\n` +
        `stdout: ${buildResult.stdout.toString()}\nstderr: ${buildResult.stderr.toString()}`,
    );
  }
  if (!existsSync(DIST_LORE)) throw new Error(`Expected ${DIST_LORE} to exist after 'bun run build'`);
}, 300_000);

afterAll(() => {
  for (const path of fixturesToClean) {
    try {
      rmSync(path, { recursive: true, force: true });
    } catch {
      // reason: best-effort cleanup — a fixture already removed must not fail the suite.
    }
  }
});

// ─── AC-IC-1 ─────────────────────────────────────────────────────────────────

describe("AC-IC-1: two concurrent report-issue invocations only ever produce conforming outcomes", () => {
  it(
    "AC-IC-1: fifty runs only conforming outcomes — both write, or exactly one writes while the other refuses with the declared code and template",
    async () => {
      const upstream = makeUpstream("ac-ic-1");

      const conformingShapes: string[] = [];
      const nonConforming: string[] = [];
      const excluded: string[] = [];
      let successfulInvocations = 0;
      let attempts = 0;

      while (conformingShapes.length + nonConforming.length < TARGET_RUNS && attempts < MAX_ATTEMPTS) {
        attempts++;
        const label = `r${attempts}`;
        const consumerRoot = makeConsumer(`${label}`, upstream);
        const { first, second } = await runConcurrentPair(consumerRoot, label);

        // Success accounting runs for EVERY attempt, including excluded ones:
        // an excluded run can still have had ONE invocation write successfully
        // (measured — a pair where one side won and the other hit the dlopen
        // race), and the count invariant below is about writes that landed, not
        // about which runs counted toward the target.
        const succeeded = [first, second].filter((outcome) => outcome.exitCode === 0);
        successfulInvocations += succeeded.length;
        // Each successful invocation reports its own upstream doc id, and two
        // winners in one run must never collide (AC-IC-1's "both issues present").
        const reportedIds = succeeded.map(
          (outcome) => (JSON.parse(outcome.stdout) as { data: { upstream_doc_id: string } }).data.upstream_doc_id,
        );
        expect(new Set(reportedIds).size).toBe(reportedIds.length);

        const verdict = classifyConcurrencyOutcome(first, second);
        if (verdict.outcome === "not_attributable") {
          excluded.push(`${label}: ${verdict.reason} — ${verdict.detail}`);
          continue;
        }
        if (verdict.outcome === "non_conforming") {
          nonConforming.push(`${label}: ${verdict.detail}`);
          continue;
        }
        conformingShapes.push(verdict.shape);
      }

      // Diagnostics first: a failure must name the offending runs, not just a count.
      expect(nonConforming).toEqual([]);
      expect(conformingShapes).toHaveLength(TARGET_RUNS);
      // Excluded (not-attributable) runs are tolerated but capped and reported —
      // an epidemic of them means the measurement itself is broken.
      expect(
        excluded.length,
        `too many non-attributable runs (${excluded.length}/${attempts}):\n${excluded.join("\n")}`,
      ).toBeLessThanOrEqual(MAX_ATTEMPTS - TARGET_RUNS);

      // REGRESSION: the upstream holds exactly one task per successful
      // invocation — a refusal wrote nothing, and no success was lost.
      expect(upstreamTaskCount(upstream)).toBe(successfulInvocations);
    },
    900_000,
  );
});

// ─── AC-IC-2 ─────────────────────────────────────────────────────────────────

describe("AC-IC-2: forced contention proves the harness can see the declared loud failure", () => {
  it(
    "AC-IC-2: forced contention control — an externally-held open write transaction makes at least one invocation refuse loudly, in all ten runs",
    async () => {
      const upstream = makeUpstream("ac-ic-2");

      const detected: string[] = [];
      const undetected: string[] = [];
      const excluded: string[] = [];
      let attempts = 0;

      while (detected.length + undetected.length < CONTROL_RUNS && attempts < MAX_CONTROL_ATTEMPTS) {
        attempts++;
        const label = `c${attempts}`;
        const consumerRoot = makeConsumer(`${label}`, upstream);
        const holder = await startWriteLockHolder(upstream, label);
        const { first, second, elapsedMs } = await runConcurrentPair(consumerRoot, label);
        await holder.proc.exited;

        // The transaction was open for the FULL duration of both invocations:
        // they finished before the holder's own hold window elapsed.
        expect(
          elapsedMs,
          `run ${label} outlasted the holder's ${HOLD_MS}ms window — contention was not held for the full duration`,
        ).toBeLessThan(HOLD_MS);

        const verdict = classifyForcedContentionOutcome(first, second);
        if (verdict.outcome === "not_attributable") {
          excluded.push(`${label}: ${verdict.reason} — ${verdict.detail}`);
          continue;
        }
        if (verdict.outcome === "undetected") {
          undetected.push(`${label}: ${verdict.detail}`);
          continue;
        }
        detected.push(`${label}: ${verdict.refused} invocation(s) refused`);
      }

      expect(undetected).toEqual([]);
      expect(detected).toHaveLength(CONTROL_RUNS);
      expect(
        excluded.length,
        `too many non-attributable control runs (${excluded.length}/${attempts}):\n${excluded.join("\n")}`,
      ).toBeLessThanOrEqual(MAX_CONTROL_ATTEMPTS - CONTROL_RUNS);
    },
    600_000,
  );
});

// ─── AC-IC-4 ─────────────────────────────────────────────────────────────────

describe("AC-IC-4: the loud failure is actionable", () => {
  it(
    "AC-IC-4: failure message names contender and next action — corpus path, declared bound, source field and retry command line",
    async () => {
      const upstream = makeUpstream("ac-ic-4");
      const consumerRoot = makeConsumer("ac-ic-4", upstream);

      const holder = await startWriteLockHolder(upstream, "ac-ic-4");
      const { first, second } = await runConcurrentPair(consumerRoot, "ac-ic-4");
      await holder.proc.exited;

      const refusals = [first, second].filter(
        (outcome) => outcome.exitCode === WRITE_CONTENTION_EXIT_CODE,
      );
      expect(
        refusals.length,
        `expected at least one refusal at exit ${WRITE_CONTENTION_EXIT_CODE};\n` +
          `first (exit ${first.exitCode}): ${first.stderr}\nsecond (exit ${second.exitCode}): ${second.stderr}`,
      ).toBeGreaterThan(0);
      const refusal = refusals[0] as RunResult;

      // The shared matcher the whole contract is keyed on…
      expect(matchesWriteContentionTemplate(refusal.stderr)).toBe(true);
      // …plus INDEPENDENT assertions, so a bug in that matcher cannot make this
      // criterion vacuously true.
      expect(refusal.stderr).toContain(upstream.dbPath);
      expect(refusal.stderr).toMatch(/declared 2000ms bound\./);
      expect(refusal.stderr).toMatch(
        new RegExp(`^Contending source: (?:${UNKNOWN_CONTENDING_SOURCE}|\\S+)$`, "m"),
      );
      expect(refusal.stderr).toMatch(/^Retry: lore report-issue .*--title /m);
      // The pre-contract wording (no source, no retry line) must be gone.
      expect(refusal.stderr).not.toContain("Storage failure");

      // STATE: the advice is sound — once the holder released, a retry of the
      // same invocation succeeds.
      const retry = runSync(reportArgs("Retry after contention"), { cwd: consumerRoot });
      expect(retry.exitCode, `retry stderr: ${retry.stderr}`).toBe(0);
    },
    300_000,
  );
});

// ─── D4: the declared bound is APPLIED, not merely printed ──────────────────

describe("D4: feedback.upstream.write_wait_ms is the applied bound, not decoration", () => {
  it(
    "D4: a declared bound changes both the reported number AND the time actually waited",
    async () => {
      const upstream = makeUpstream("d4");

      const shortConsumer = makeConsumer("d4-short", upstream, 250);
      const shortHolder = await startWriteLockHolder(upstream, "d4-short");
      const shortRun = await runConcurrentPair(shortConsumer, "d4-short");
      await shortHolder.proc.exited;

      const longConsumer = makeConsumer("d4-long", upstream, 3000);
      const longHolder = await startWriteLockHolder(upstream, "d4-long");
      const longRun = await runConcurrentPair(longConsumer, "d4-long");
      await longHolder.proc.exited;

      const shortRefusal = [shortRun.first, shortRun.second].find(
        (outcome) => outcome.exitCode === WRITE_CONTENTION_EXIT_CODE,
      );
      const longRefusal = [longRun.first, longRun.second].find(
        (outcome) => outcome.exitCode === WRITE_CONTENTION_EXIT_CODE,
      );
      expect(shortRefusal?.stderr ?? "(no refusal)").toMatch(/declared 250ms bound\./);
      expect(longRefusal?.stderr ?? "(no refusal)").toMatch(/declared 3000ms bound\./);

      // Side effect, not just text. Two assertions, neither of which an INERT
      // config key could satisfy (an inert key would make both runs wait the
      // same 2000ms schema default):
      //   1. the 3000ms declaration actually waited past 3000ms;
      //   2. the gap between the two runs tracks the 2750ms gap between their
      //      declared bounds — compared as a DIFFERENCE so the ~800ms process
      //      startup cost cancels out and machine load cannot turn this into a
      //      phantom failure (half the declared delta is the threshold).
      expect(longRun.elapsedMs).toBeGreaterThan(3000);
      expect(longRun.elapsedMs - shortRun.elapsedMs).toBeGreaterThan((3000 - 250) / 2);
    },
    300_000,
  );
});
