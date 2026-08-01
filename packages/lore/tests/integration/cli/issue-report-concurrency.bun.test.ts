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
 * counted as conforming. Their RATE is a property of the machine (measured 83%
 * on a host running 25+ concurrent `bun` processes), so AC-IC-1 bounds the
 * COST of collecting its sample and then reports the sample it actually got —
 * see `MIN_CONCLUSIVE_RUNS` and `classifySamplingPower`. A systemic problem
 * still cannot hide behind exclusions: an epidemic of them starves the sample
 * below the floor, which is RED. And a regression of the enforcement itself
 * fails LOUDLY regardless, because AC-IC-2's forced-contention control demands
 * the declared loud failure in all 10 of its runs.
 *
 * ── D7 discharge (task-discharge-d7-in-code) ──
 *   Gap 1: `classifyForcedContentionOutcome` now ALSO excludes a startup-phase
 *     lock refusal (D7 forced-contention table row 4) instead of reporting it
 *     `undetected` — a false RED, since the external holder blocks the
 *     STARTUP write first and the run never reached the report-write contract.
 *     See `@lore/core`'s `issue-report.ts` and the row-4/precedence/control
 *     unit cases in `issue-concurrency-classifier.test.ts`.
 *   Gap 2: the readable-run floor (`MIN_CONCLUSIVE_RUNS`) is raised to EQUAL
 *     `TARGET_RUNS` — no degraded-power pass. Proven without spawning via the
 *     "Gap 2" describe block below, which injects a synthetic census into the
 *     extracted `assertConclusiveSample`.
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
/**
 * The floor of contract-readable runs below which AC-IC-1 goes RED instead of
 * declaring itself inconclusive.
 *
 * DERIVATION (D7 "Sampling power" — §Contract Details): at the measured ~10%
 * per-run defect rate, the probability that an n-run sample misses the defect
 * ENTIRELY is `(1 - 0.10)^n`.
 *   - n=20 → `0.9^20 ≈ 12.2%` miss probability. That is the EXACT number this
 *     file's own `TARGET_RUNS` comment rejects ("a 20-run harness misses the
 *     bug ~12% of the time") — so 20 cannot ALSO be the floor a passing run is
 *     allowed to clear, or a pass would land at precisely the detection power
 *     this criterion exists to reject (a false green wearing a census banner).
 *   - Target chosen here: miss probability under 1%. Solving `0.9^n <= 0.01`
 *     gives `n >= ln(0.01)/ln(0.9) ≈ 43.7`, so n=44 already clears it
 *     (`0.9^44 ≈ 0.97%`).
 *   - n=50 (`TARGET_RUNS`) → `0.9^50 ≈ 0.52%` — comfortably inside the chosen
 *     target with margin to spare. Raising the floor to `TARGET_RUNS` both
 *     clears this derived requirement AND matches the spec's explicit
 *     resolution: "the floor EQUALS TARGET_RUNS = 50 … there is no
 *     degraded-power pass" — floor and sizing COINCIDE by construction (this
 *     references `TARGET_RUNS` rather than repeating the literal `50`, so the
 *     two can never drift apart), so a shortfall can never be dressed up as an
 *     inconclusive pass. See `assertConclusiveSample` / `SamplingPower` below
 *     for where the old "degraded" pass state was removed.
 *
 * It is also the guard that keeps exclusions from swallowing a real
 * regression: `hasContentionOutsideReportWrite` excuses ANY locked-database
 * failure that carries an uncaught stack trace, so a regression which starts
 * throwing one would be EXCLUDED rather than counted non-conforming. Such a
 * regression shows up here as an exclusion epidemic — collected runs collapsing
 * toward zero — which this floor turns into a loud RED.
 */
const MIN_CONCLUSIVE_RUNS = TARGET_RUNS;
/** AC-IC-2's control-run budget. */
const CONTROL_RUNS = 10;
/**
 * AC-IC-1's attempt ceiling — ATTEMPTS, not samples. An attempt that
 * classifies `not_attributable` does not count toward `TARGET_RUNS`, so the
 * ceiling has to absorb the exclusion RATE, and that rate is a property of the
 * MACHINE rather than of the code under test. Both invocations of a pair start
 * simultaneously and each opens the SHARED CONSUMER corpus for its own
 * startup-phase write, so they collide there far more often than they collide
 * on the upstream write this contract actually governs.
 *
 * MEASURED, not assumed — the readable rate, and what the excluded remainder
 * actually consists of (300 attempts, load ~3.8, one upstream fixture):
 *   - 8 of 300 attempts readable (2.7%);
 *   - of the excluded invocations, 200 carried `loader.ts`'s startup hint —
 *     genuine CONSUMER-corpus startup contention, correctly excluded;
 *   - but 92 carried an UNCAUGHT `database is locked` thrown from
 *     `openValidatedUpstream` / `report` — the GOVERNED upstream path, excused
 *     only by `hasContentionOutsideReportWrite`'s stack-frame branch. Those
 *     are contract violations the classifier cannot presently see, and they
 *     are what starves this sample; the rate rises as the upstream fixture
 *     grows, so a bigger attempt budget does not buy more readable runs (0 of
 *     the last 500 attempts of an 800-attempt run were readable).
 *
 * 800 is therefore sized for the rate this loop sees once an invocation can no
 * longer die by uncaught throw (~33%: the readable runs plus the runs now lost
 * to it), not for the degraded rate above — the degraded rate has no budget
 * that rescues it, which is the point of `MIN_CONCLUSIVE_RUNS` going RED
 * rather than of a larger ceiling. The cost is affordable because an attempt
 * is cheap (0.28s measured, so a worst-case 800 attempts is ~220s) and it is
 * bounded on purpose: past the ceiling the loop STOPS and reports its own
 * shortfall (see `classifySamplingPower`) rather than looping forever or
 * pretending the sample was full. Each attempt also leaves one mkdtemp'd
 * consumer corpus behind until `afterAll` (~300KB), which is the other reason
 * this is not simply set to "very large".
 */
const MAX_ATTEMPTS = 800;
const MAX_CONTROL_ATTEMPTS = CONTROL_RUNS + 10;
/**
 * Wall-clock ceiling on the same loop, and the reason the raised attempt
 * ceiling is safe. `MAX_ATTEMPTS` bounds the number of attempts but not their
 * COST, and per-attempt cost is exactly what machine load inflates; without a
 * time bound, 800 attempts on a saturated host could run into bun's own test
 * timeout, whose failure carries NO census at all — precisely the
 * uninformative RED this slice exists to remove. This is a LOWER internal
 * budget, not a raised timeout, and not a sleep or a backoff (D3): whichever
 * ceiling is hit first, the loop still reaches its verdict. 300s against a
 * measured ~200s worst case leaves headroom without letting one test file own
 * a quarter-hour.
 */
const SAMPLING_BUDGET_MS = 300_000;
/** Structurally above `SAMPLING_BUDGET_MS`, so the census always beats the timeout. */
const AC_IC_1_TIMEOUT_MS = SAMPLING_BUDGET_MS + 300_000;
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

// ─── AC-IC-1 sampling census (the harness measuring ITSELF) ─────────────────

/**
 * How much statistical power AC-IC-1's loop actually achieved. This is a
 * verdict about the HARNESS's sample, never about the contract — every
 * contract verdict still comes from `@lore/core`'s classifiers (D6).
 *
 * Gap 2 REMOVED the `"degraded"` state that used to sit here: D7 "Sampling
 * power" is explicit that "the floor IS the sizing, and a short sample never
 * passes" — with `MIN_CONCLUSIVE_RUNS` now equal to `TARGET_RUNS` (see its
 * derivation above), a "ceiling hit but still ≥ floor" state is no longer
 * reachable, so keeping it as a type member would have been dead code
 * pretending to be a real outcome.
 *
 * - `full`       — `TARGET_RUNS` contract-readable runs collected. The ONLY
 *                  passing power.
 * - `unmeasured` — fewer than `TARGET_RUNS`. RED, reported as measured-nothing
 *                  with the collected count and every exclusion reason: an
 *                  exclusion epidemic can itself BE the defect, and machine
 *                  load never buys a smaller counted sample — only more
 *                  attempts (see `MAX_ATTEMPTS` / `SAMPLING_BUDGET_MS`).
 */
type SamplingPower = "full" | "unmeasured";

interface SamplingCensus {
  /** Runs the contract could be read from — conforming plus non-conforming. */
  readonly collected: number;
  /** Runs dropped as `not_attributable`, keyed by the classifier's own reason. */
  readonly exclusionsByReason: ReadonlyMap<string, number>;
  readonly excluded: number;
  readonly attempts: number;
  readonly elapsedMs: number;
}

function classifySamplingPower(collected: number): SamplingPower {
  return collected >= TARGET_RUNS ? "full" : "unmeasured";
}

const POWER_HEADLINES: Readonly<Record<SamplingPower, string>> = {
  full: "CONCLUSIVE — full sample collected",
  unmeasured: `FAILURE — fewer than ${TARGET_RUNS} contract-readable runs; no degraded-power pass (D7 Sampling power)`,
};

/**
 * The census banner. PRINTED on every run, passing or failing, so the two
 * numbers the acceptance criterion asks for (collected samples, exclusions)
 * are attested by the run itself rather than by whoever narrates it — a green
 * run that collected exactly the minimum has to be distinguishable from one
 * that collected the target with headroom to spare.
 */
function renderCensus(census: SamplingCensus, power: SamplingPower): string {
  const reasons =
    [...census.exclusionsByReason.entries()].map(([reason, count]) => `${reason}=${count}`).join(", ") ||
    "none";
  return [
    `[AC-IC-1] sampling power: ${POWER_HEADLINES[power]}`,
    `[AC-IC-1]   collected (contract-readable) runs: ${census.collected}/${TARGET_RUNS} (floor ${MIN_CONCLUSIVE_RUNS})`,
    `[AC-IC-1]   excluded (not attributable) runs:   ${census.excluded} [${reasons}]`,
    `[AC-IC-1]   attempts: ${census.attempts}/${MAX_ATTEMPTS}` +
      `   elapsed: ${(census.elapsedMs / 1000).toFixed(1)}s/${SAMPLING_BUDGET_MS / 1000}s`,
  ].join("\n");
}

/**
 * D7 "Sampling power" made unit-testable without a spawn: the census's OWN
 * pass/fail evaluation, extracted from the live spawning test below so Gap 2
 * (fewer than `TARGET_RUNS` collected runs must FAIL, never degrade to a
 * pass) can be proven by INJECTING a synthetic census and synthetic run
 * arrays — never by loading the machine to starve a real run, which is
 * unreproducible on demand. The live `AC-IC-1` test calls this with its real
 * accumulated arrays; the "Gap 2" pure describe block below calls it with
 * fabricated ones.
 *
 * Throws (via `expect`) in the same order the live test always has:
 *   1. the contract itself, over every collected sample, unconditionally;
 *   2. the readable-run floor — D7: no degraded-power pass, so a shortfall
 *      fails HERE, loud and named, never as a bare length mismatch below;
 *   3. the exact collected count, asserted unconditionally now that the floor
 *      EQUALS `TARGET_RUNS` (Gap 2) — gating this behind `power === "full"`
 *      would silently reintroduce the reduced-sample pass Gap 2 removes.
 *
 * @param conformingShapes - every collected run's conforming `shape` string
 * @param nonConforming - every collected run's non-conforming detail string
 *   (must be empty for the contract check to pass)
 * @param census - the sampling census (collected/excluded/attempts/elapsed)
 * @param excludedDetails - one line per excluded run, quoted into the floor
 *   failure message so a shortfall names its exclusions, not just a count
 */
function assertConclusiveSample(
  conformingShapes: readonly string[],
  nonConforming: readonly string[],
  census: SamplingCensus,
  excludedDetails: readonly string[],
): void {
  const power = classifySamplingPower(census.collected);

  // 1. THE CONTRACT, over every collected sample, first and unconditionally.
  //    A sample shortfall never suppresses a violation, and diagnostics come
  //    first so a failure names the offending runs rather than just a count.
  expect(nonConforming).toEqual([]);

  // 2. The floor. Exclusions are unbounded in COUNT (they scale with MACHINE
  //    LOAD, so capping their count would fail a busy host whose contract
  //    held perfectly) but the COUNTED sample must still reach it — see
  //    MIN_CONCLUSIVE_RUNS's derivation.
  expect(
    census.collected,
    `AC-IC-1 measured nothing — fewer than ${MIN_CONCLUSIVE_RUNS} contract-readable runs.\n` +
      `${renderCensus(census, power)}\n` +
      `excluded runs:\n${excludedDetails.join("\n")}`,
  ).toBeGreaterThanOrEqual(MIN_CONCLUSIVE_RUNS);

  // 3. The sample is exact — never a silent short count dressed up as a pass.
  expect(conformingShapes).toHaveLength(TARGET_RUNS);
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
      const exclusionsByReason = new Map<string, number>();
      let successfulInvocations = 0;
      let attempts = 0;
      const samplingStartedAt = performance.now();

      // Attempts are DECOUPLED from samples: only a contract-readable run
      // (conforming or non-conforming) advances the target, while both ceilings
      // bound the cost. See MAX_ATTEMPTS / SAMPLING_BUDGET_MS on why neither
      // ceiling is allowed to be the verdict by itself.
      while (
        conformingShapes.length + nonConforming.length < TARGET_RUNS &&
        attempts < MAX_ATTEMPTS &&
        performance.now() - samplingStartedAt < SAMPLING_BUDGET_MS
      ) {
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
          exclusionsByReason.set(verdict.reason, (exclusionsByReason.get(verdict.reason) ?? 0) + 1);
          continue;
        }
        if (verdict.outcome === "non_conforming") {
          nonConforming.push(`${label}: ${verdict.detail}`);
          continue;
        }
        conformingShapes.push(verdict.shape);
      }

      const census: SamplingCensus = {
        collected: conformingShapes.length + nonConforming.length,
        exclusionsByReason,
        excluded: excluded.length,
        attempts,
        elapsedMs: performance.now() - samplingStartedAt,
      };
      // Always printed, green or red — see renderCensus.
      console.log(renderCensus(census, classifySamplingPower(census.collected)));

      // Contract, floor, and exact-count checks — see `assertConclusiveSample`
      // (D7 "Sampling power": no degraded-power pass, Gap 2).
      assertConclusiveSample(conformingShapes, nonConforming, census, excluded);

      // REGRESSION: the upstream holds exactly one task per successful
      // invocation — a refusal wrote nothing, and no success was lost.
      expect(upstreamTaskCount(upstream)).toBe(successfulInvocations);
    },
    AC_IC_1_TIMEOUT_MS,
  );
});

// ─── Gap 2: the readable-run floor rejects a short sample (pure, no spawn) ──
//
// D7 "Sampling power" resolves a contradiction the old MIN_CONCLUSIVE_RUNS=20
// left standing: §Acceptance Criteria's own rationale for AC-IC-1's 50 runs
// rejects 20 as underpowered ("a 20-run harness misses the bug ~12% of the
// time"), so a harness that PASSED at 20 collected runs was landing at exactly
// the detection power the criterion exists to reject — a false green wearing
// a census banner. These three cases inject a synthetic census into
// `assertConclusiveSample` rather than starving a real run by machine load
// (unreproducible on demand, and the dispatch constraint above forbids
// contending with it anyway).
describe("Gap 2 — D7 Sampling power: the floor now EQUALS TARGET_RUNS, no degraded-power pass", () => {
  it("GAP-2 CONTROL: 50 counted runs, all conforming — still passes", () => {
    const conformingShapes = Array.from({ length: TARGET_RUNS }, () => "both_succeeded");
    const census: SamplingCensus = {
      collected: TARGET_RUNS,
      exclusionsByReason: new Map(),
      excluded: 0,
      attempts: TARGET_RUNS,
      elapsedMs: 1000,
    };
    expect(() => assertConclusiveSample(conformingShapes, [], census, [])).not.toThrow();
  });

  it("GAP-2: fewer than TARGET_RUNS collected runs FAILS, naming the collected count and every exclusion reason", () => {
    const shortfall = TARGET_RUNS - 1; // one below the floor — simulates machine-load starvation
    const conformingShapes = Array.from({ length: shortfall }, () => "both_succeeded");
    const exclusionsByReason = new Map([
      ["native_module_load_race", 12],
      ["contention_outside_report_write", 7],
    ]);
    const census: SamplingCensus = {
      collected: shortfall,
      exclusionsByReason,
      excluded: 19,
      attempts: MAX_ATTEMPTS,
      elapsedMs: 250_000,
    };
    let thrown: unknown;
    try {
      assertConclusiveSample(
        conformingShapes,
        [],
        census,
        ["r1: native_module_load_race — compiled-binary native module load race: …", "r2: contention_outside_report_write — a locked-database refusal …"],
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown, "expected assertConclusiveSample to throw on a below-floor census").toBeDefined();
    const message = String((thrown as { message?: unknown } | undefined)?.message ?? thrown);
    expect(message).toContain(String(shortfall));
    expect(message).toContain("native_module_load_race");
    expect(message).toContain("contention_outside_report_write");
  });

  it("GAP-2 REGRESSION: the OLD floor (20) would have wrongly passed a 20-run sample — it must fail now", () => {
    // Pinned so this cannot silently regress back toward the rejected 12%
    // miss-probability floor: a HARNESS RUN that collected exactly the old
    // MIN_CONCLUSIVE_RUNS=20 must now be rejected, not accepted.
    const conformingShapes = Array.from({ length: 20 }, () => "both_succeeded");
    const census: SamplingCensus = {
      collected: 20,
      exclusionsByReason: new Map(),
      excluded: 0,
      attempts: 20,
      elapsedMs: 5000,
    };
    expect(() => assertConclusiveSample(conformingShapes, [], census, [])).toThrow();
  });
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

      // The control's own two numbers, printed for the same reason AC-IC-1's
      // census is (its budget is small, so a near-exhausted run is worth
      // seeing). Its assertions stay STRICT and unconditional: the control is
      // what proves this harness can still see the declared loud failure, so it
      // is the one measurement that must never be allowed to degrade.
      console.log(
        `[AC-IC-2] detected: ${detected.length}/${CONTROL_RUNS} | undetected: ${undetected.length} | ` +
          `excluded: ${excluded.length} | attempts: ${attempts}/${MAX_CONTROL_ATTEMPTS}`,
      );

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
