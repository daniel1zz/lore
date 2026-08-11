/**
 * AC-DC-3 (spec-the-defect-channel-cannot-be-honestly-maintained-an §M2) — the
 * open-report ceiling is the UPSTREAM corpus's OWN declared policy
 * (`feedback.inbound.open_report_cap`), read from its config, never the
 * compiled `OPEN_REPORT_CAP` literal.
 *
 * ## What makes this suite discriminating
 *
 * "With N=3 the 3rd report is accepted and the 4th refused naming cap 3" alone
 * would ALSO pass against a hardcoded `3` — the AC's own text says as much, and
 * a single declared value can never separate "read from config" from
 * "coincidentally that number". This suite therefore drives THREE DIFFERENT
 * operative ceilings against ONE binary — 3, 1, and (with no `feedback.inbound`
 * section at all) 10 — each asserted at BOTH edges (the Nth accepted, the
 * N+1th refused naming `cap N`). No compiled constant can satisfy all three
 * simultaneously, so the set is falsifiable in a way any single case is not.
 *
 * The fourth independent discriminator is the STATE case: the CONSUMER declares
 * `feedback.inbound.open_report_cap: 99` for itself while the upstream declares
 * 3, and the 4th report is STILL refused naming cap 3. That is the whole point
 * of siting the knob under `feedback.inbound` rather than `feedback.upstream` —
 * a spam ceiling the spammer can raise is not a ceiling (§M2).
 *
 * ⛔ Every corpus here is a throwaway `mkdtempSync` pair (upstream + consumer)
 * asserted to live under `os.tmpdir()` — NEVER this repo's own `.lore/` (root
 * CLAUDE.md). The suite spawns the COMPILED `dist/lore` resolved from THIS
 * worktree's own root and builds it once in `beforeAll`, so a stale binary can
 * never be mistaken for a red assertion (stale-binary false-oracle vector).
 *
 * ⛔ YAML append hazard, inherited from `lore init`'s "project: only" config
 * contract (see `commands/init.ts`'s header): duplicate top-level YAML mapping
 * keys are resolved FIRST-WINS by the `yaml` parser, silently discarding the
 * later block. Every helper below therefore emits AT MOST ONE `feedback:` block
 * per file — the consumer's `upstream:` and its own `inbound:` are written
 * together, never as two appends.
 *
 * Six-dimension coverage:
 *   HAPPY:      upstream declares 3 -> reports 1..3 accepted, the 4th refused
 *               naming `cap 3` (and NOT `cap 10`)
 *   BOUNDARY:   the smallest legal ceiling, 1 -> the 1st accepted, the 2nd
 *               refused naming `cap 1`; and NO `feedback.inbound` section at
 *               all -> byte-for-byte today's behaviour, 10 accepted and the
 *               11th refused naming `cap 10`
 *   NEGATIVE:   a value Zod rejects (0, a negative, a non-integer) refuses the
 *               filing LOUDLY naming `feedback.inbound.open_report_cap` — ⛔ never
 *               clamped, never silently substituted with the schema default
 *   ERROR:      an unknown key under `feedback.inbound` is refused (`.strict()`),
 *               so a typo cannot leave the ceiling silently at 10
 *   STATE:      the CONSUMER's own `feedback.inbound.open_report_cap: 99` does
 *               not move the ceiling — the UPSTREAM's 3 governs
 *   REGRESSION: under a CONFIGURED ceiling the M1 refusal payload is intact
 *               (every blocking id named) and a terminal resolution still frees
 *               a slot
 *
 * Source: spec-the-defect-channel-cannot-be-honestly-maintained-an §M2, AC-DC-3;
 *   task-the-open-report-ceiling-is-the-upstream-corpus-own.
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

/**
 * The ceiling in force when NO `feedback.inbound` section is declared — i.e.
 * `@lore/core`'s `OPEN_REPORT_CAP`, which §M2 demotes from "the operative value"
 * to "the schema default's source of truth". Mirrored as a literal here on
 * purpose: this suite's absent-config case must observe the SHIPPED default
 * from the outside, and importing the constant would make the assertion
 * tautological with whatever the implementation happens to read.
 */
const SHIPPED_DEFAULT_CAP = 10;

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
function runJson<T>(
  args: string[],
  opts: { cwd: string; env?: Record<string, string> },
): { result: RunResult; data: T } {
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

function makeUpstream(prefix: string): UpstreamFixture {
  const root = mkdtempSync(join(TMP_ROOT, `lore-dc3-upstream-${prefix}-`));
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

/**
 * Writes the consumer's SINGLE `feedback:` block — `upstream:` always, plus its
 * OWN `inbound.open_report_cap` when `ownInboundCap` is supplied.
 *
 * ⛔ One append, one `feedback:` key: a second top-level `feedback:` block would
 * be silently discarded (first-wins), which would make the STATE case pass for
 * the wrong reason (the consumer's 99 never parsed at all).
 */
function makeConsumer(prefix: string, upstream: UpstreamFixture, ownInboundCap?: number): string {
  const root = mkdtempSync(join(TMP_ROOT, `lore-dc3-consumer-${prefix}-`));
  assertUnderTmp(root);
  const initResult = run(["init"], { cwd: root });
  if (initResult.exitCode !== 0) throw new Error(`consumer 'lore init' failed: ${initResult.stderr}`);
  const lines = [
    "feedback:",
    "  upstream:",
    `    corpus_path: ${upstream.root}`,
    `    root_prd: ${upstream.rootPrdSlug}`,
  ];
  if (ownInboundCap !== undefined) {
    lines.push("  inbound:", `    open_report_cap: ${ownInboundCap}`);
  }
  lines.push("");
  appendFileSync(join(root, ".lore", "config.yaml"), lines.join("\n"));
  return root;
}

/**
 * Declares the UPSTREAM's own inbound policy — the queue OWNER's declared depth.
 *
 * @param rawValue - emitted VERBATIM into the YAML, so a NEGATIVE case can
 *   declare a value the schema must reject (`0`, `-1`, `2.5`) without this
 *   helper's own type signature filtering it out first
 */
function declareUpstreamInboundCap(upstreamRoot: string, rawValue: string): void {
  assertUnderTmp(upstreamRoot);
  appendFileSync(
    join(upstreamRoot, ".lore", "config.yaml"),
    ["feedback:", "  inbound:", `    open_report_cap: ${rawValue}`, ""].join("\n"),
  );
}

/** Declares an UNKNOWN key under the upstream's `feedback.inbound` — the `.strict()` probe. */
function declareUpstreamInboundTypo(upstreamRoot: string): void {
  assertUnderTmp(upstreamRoot);
  appendFileSync(
    join(upstreamRoot, ".lore", "config.yaml"),
    ["feedback:", "  inbound:", "    open_reports_cap: 3", ""].join("\n"),
  );
}

interface TwinOptions {
  /** Verbatim YAML value for the UPSTREAM's `feedback.inbound.open_report_cap`; omitted → no `feedback.inbound` at all. */
  readonly upstreamCap?: string;
  /** The CONSUMER's own (irrelevant-by-design) `feedback.inbound.open_report_cap`. */
  readonly consumerCap?: number;
  /** Declare an unrecognised key under the upstream's `feedback.inbound` instead of a cap. */
  readonly upstreamTypo?: boolean;
}

function makeTwin(prefix: string, opts: TwinOptions = {}): { upstream: UpstreamFixture; consumerRoot: string } {
  const upstream = makeUpstream(prefix);
  if (opts.upstreamTypo === true) {
    declareUpstreamInboundTypo(upstream.root);
  } else if (opts.upstreamCap !== undefined) {
    declareUpstreamInboundCap(upstream.root, opts.upstreamCap);
  }
  const consumerRoot = makeConsumer(prefix, upstream, opts.consumerCap);
  fixturesToClean.push(upstream.root, consumerRoot);
  return { upstream, consumerRoot };
}

/** Attempts one report WITHOUT asserting success — the observation primitive for both edges. */
function tryFileReport(consumerRoot: string, title: string): RunResult {
  return run(
    ["report-issue", "--title", title, "--description", "desc", "--expected", "exit 0", "--actual", "exit 4"],
    { cwd: consumerRoot, env: { LORE_ACTOR: "agent:dc3-reporter" } },
  );
}

/** Files one report, asserting exit 0; returns its upstream doc id. */
function fileReport(consumerRoot: string, title: string): string {
  const { result, data } = runJson<{ ok: true; data: { upstream_doc_id: string } }>(
    ["report-issue", "--title", title, "--description", "desc", "--expected", "exit 0", "--actual", "exit 4"],
    { cwd: consumerRoot, env: { LORE_ACTOR: "agent:dc3-reporter" } },
  );
  expect(result.exitCode).toBe(0);
  return data.data.upstream_doc_id;
}

/**
 * Drives BOTH edges of one declared ceiling: files exactly `cap` reports (each
 * asserted accepted), then one more (asserted refused). Returns the accepted
 * ids and the refusal, so a caller can assert on the message.
 *
 * The Nth acceptance is half the AC's discriminating pair — a suite that only
 * observed the refusal would pass against a ceiling that was too LOW.
 */
function driveToCeiling(
  consumerRoot: string,
  cap: number,
  prefix: string,
): { acceptedIds: string[]; refused: RunResult } {
  const acceptedIds: string[] = [];
  for (let i = 1; i <= cap; i += 1) {
    acceptedIds.push(fileReport(consumerRoot, `${prefix} report ${i} of ${cap}`));
  }
  const refused = tryFileReport(consumerRoot, `${prefix} report ${cap + 1} — one past the declared ceiling`);
  return { acceptedIds, refused };
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
}, 300_000);

afterAll(() => {
  for (const path of fixturesToClean) {
    try {
      rmSync(path, { recursive: true, force: true });
    } catch {
      // reason: best-effort cleanup — a fixture a test itself removed must not throw here.
    }
  }
});

describe("AC-DC-3: the open-report ceiling is the upstream corpus's own declared policy", () => {
  it("HAPPY/REGRESSION: upstream declares 3 — the 3rd report is ACCEPTED, the 4th refused naming cap 3, and a terminal resolution frees a slot", () => {
    const { upstream, consumerRoot } = makeTwin("cap3", { upstreamCap: "3" });

    const { acceptedIds, refused } = driveToCeiling(consumerRoot, 3, "cap3");
    expect(acceptedIds.length).toBe(3);

    // The refusal names the OPERATIVE ceiling…
    expect(refused.exitCode).toBe(4);
    expect(refused.stderr).toContain("cap 3");
    // …and provably NOT the compiled literal that used to be operative. Without
    // this the case cannot distinguish "read 3 from config" from "still reads 10
    // and something else refused".
    expect(refused.stderr).not.toContain(`cap ${SHIPPED_DEFAULT_CAP}`);

    // REGRESSION: M1's structured payload projection is intact under a
    // CONFIGURED ceiling — every blocking id is still named alongside its
    // computed resolution.
    for (const id of acceptedIds) expect(refused.stderr).toContain(id);
    expect(refused.stderr).toContain("open");

    // …and quota still releases on a terminal resolution, at the new depth.
    // `wontfix` needs no pointer and no gate ceremony in a throwaway upstream.
    const resolveResult = run(
      ["issue", "resolve", acceptedIds[0] as string, "--state", "wontfix", "--reason", "not a defect", "--by", "agent:dc3-maintainer"],
      { cwd: upstream.root },
    );
    expect(resolveResult.exitCode).toBe(0);
    expect(tryFileReport(consumerRoot, "cap3 report 4 — after one release").exitCode).toBe(0);
  }, 300_000);

  it("BOUNDARY: the smallest legal ceiling, 1 — the 1st report is ACCEPTED, the 2nd refused naming cap 1", () => {
    const { consumerRoot } = makeTwin("cap1", { upstreamCap: "1" });

    const { acceptedIds, refused } = driveToCeiling(consumerRoot, 1, "cap1");
    expect(acceptedIds.length).toBe(1);
    expect(refused.exitCode).toBe(4);
    expect(refused.stderr).toContain("cap 1");
    expect(refused.stderr).toContain(acceptedIds[0] as string);
    // A ceiling of 1 must not read as "3" or as the shipped default: this case
    // plus the cap-3 case plus the absent-section case below pin THREE distinct
    // operative values against one binary, which no compiled literal can do.
    expect(refused.stderr).not.toContain("cap 3");
    expect(refused.stderr).not.toContain(`cap ${SHIPPED_DEFAULT_CAP}`);
  }, 300_000);

  it("BOUNDARY: NO feedback.inbound section at all behaves exactly as today — 10 accepted, the 11th refused naming cap 10", () => {
    const { consumerRoot } = makeTwin("absent");

    const { acceptedIds, refused } = driveToCeiling(consumerRoot, SHIPPED_DEFAULT_CAP, "absent");
    expect(acceptedIds.length).toBe(SHIPPED_DEFAULT_CAP);
    expect(refused.exitCode).toBe(4);
    expect(refused.stderr).toContain(`cap ${SHIPPED_DEFAULT_CAP}`);
    for (const id of acceptedIds) expect(refused.stderr).toContain(id);
  }, 300_000);

  it("STATE: the CONSUMER cannot raise the ceiling — its own feedback.inbound.open_report_cap: 99 is inert; the upstream's 3 governs", () => {
    const { consumerRoot } = makeTwin("consumer-raise", { upstreamCap: "3", consumerCap: 99 });

    const { acceptedIds, refused } = driveToCeiling(consumerRoot, 3, "consumer-raise");
    expect(acceptedIds.length).toBe(3);
    expect(refused.exitCode).toBe(4);
    // The whole reason the knob is `feedback.inbound` and not `feedback.upstream`
    // (§M2): a spam ceiling the spammer can raise is not a ceiling.
    expect(refused.stderr).toContain("cap 3");
    expect(refused.stderr).not.toContain("cap 99");
  }, 300_000);

  it("NEGATIVE: a value Zod rejects (0 / negative / non-integer) refuses the filing LOUDLY naming the key — never clamped, never silently defaulted", () => {
    for (const rawValue of ["0", "-1", "2.5"]) {
      const { consumerRoot } = makeTwin(`invalid-${rawValue.replace(/[^0-9a-z]/gi, "")}`, { upstreamCap: rawValue });

      // The FIRST filing already fails: the upstream's config is loaded (step 3)
      // long before the cap is counted (step 6). ⛔ A silent fallback to the
      // schema default would show up here as exit 0.
      const attempt = tryFileReport(consumerRoot, `invalid cap ${rawValue}`);
      expect(attempt.exitCode).toBe(4);
      expect(attempt.stderr).toContain("feedback.inbound.open_report_cap");
    }
  }, 300_000);

  it("ERROR: an unknown key under feedback.inbound is refused (strict) — a typo can never leave the ceiling silently at the shipped default", () => {
    const { consumerRoot } = makeTwin("typo", { upstreamTypo: true });

    const attempt = tryFileReport(consumerRoot, "typo'd inbound key");
    expect(attempt.exitCode).toBe(4);
    expect(attempt.stderr).toContain("open_reports_cap");
    expect(attempt.stderr).toContain("unrecognized key");
  }, 300_000);
});
