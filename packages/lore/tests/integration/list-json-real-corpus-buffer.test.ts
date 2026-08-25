/**
 * PRODUCTION WIRING for the `lore list --json` row contract — the single file behind
 * AC-MOS-2 of `spec-the-mirror-oracles-two-command-surfaces-are-o-corpus-by`.
 *
 * @spec_ref AC-MOS-2
 *
 * ## Why this exists SEPARATELY from AC-MOS-1
 *
 * AC-MOS-1 proves the row SHAPE in a throwaway corpus. It cannot prove that the change
 * reached the live consumer, and a shape proven only in a fixture is the exact form of
 * `knowledge-an-attested-pass-is-not-evidence-of-production-wiring`. This file spawns
 * the SAME invocation the live consumer spawns, against THIS repo's REAL corpus, under
 * the consumer's OWN declared buffer.
 *
 * ⛔ READ-ONLY, and mechanically so. `lore list` writes nothing — measured in
 * `packages/lore/tests/integration/phase-write-lifecycle-doc-parity.test.ts`, which
 * found `lore get` APPENDS a `trace_events` row while `audit`/`list` move nothing.
 * {@link runListAgainstRealCorpus} is hard-wired to the `list` verb and
 * {@link refuseNonListVerb} refuses anything else, so "it must issue no other verb" is
 * enforced here rather than merely intended. The refusal has its own test below, so the
 * guard cannot rot into a no-op.
 *
 * ## What broke, measured
 *
 * `scripts/tests/spec-mirror-export.test.ts` reads `{id, slug}` from
 * `lore list --type knowledge --json --include-invalid` and declares
 * `maxBuffer: 20 * 1024 * 1024` (its lines 114 and 130). The wide 18-key payload
 * crossed that cap. A/B on 2026-08-25 @ 3331a98e with ONLY `maxBuffer` varied:
 *
 *   | maxBuffer | status | signal    | error.code | stdout bytes         |
 *   |-----------|--------|-----------|------------|----------------------|
 *   | 20 MB     | `null` | `SIGTERM` | `ENOBUFS`  | truncated 20,849,318 |
 *   | 64 MB     | `0`    | `null`    | none       | 22,988,107           |
 *
 * ⛔ `spawnSync` reports a buffer overflow as `status: null` + `error.code: "ENOBUFS"`
 * — NEVER a nonzero exit code. A helper that returns `result.status ?? 1` therefore
 * launders an infrastructure failure into "the command exited 1" with empty stderr.
 * That is why (a) below asserts `status`, `signal` and `error` as THREE separate
 * conjuncts: each has its own failure message, and none can be satisfied by the
 * fallback that hid this for so long. Full diagnosis:
 * `knowledge-corpus-growth-crossed-three-hard-coded-thresholds-in` (its ENOBUFS half;
 * its timeout half is superseded by that doc's own child).
 *
 * ## ⛔ This criterion is ENVIRONMENT-COUPLED, hence the non-vacuity floor
 *
 * It reads a corpus that grows and could in principle shrink. Without (c) it would
 * WEAKEN SILENTLY: a corpus small enough to fit 20 MB even with full records would
 * satisfy (a) and (b) while measuring nothing at all. A shrunken corpus must make this
 * FAIL, not pass. The floor is `>= 400` rows; 555 were measured on 2026-08-25 and 556
 * on the same day in this worktree.
 *
 * ⛔ There is deliberately NO byte threshold anywhere in this file. Every byte figure
 * above is a point measurement of a growing corpus, and a pinned byte budget is the
 * precise defect the diagnosis above records — three hard-coded thresholds that
 * corpus growth crossed. The oracle is `status === 0` under the consumer's OWN cap,
 * which is a threshold the CONSUMER owns, plus a SHAPE assertion.
 *
 * ## Six-dimension coverage
 *
 *   HAPPY:      the real-corpus `--include-invalid` read exits 0 under a 20 MB cap
 *   NEGATIVE:   no returned row carries `content` or `extra` — so a `status === 0`
 *               produced by some unrelated change (a shrunken corpus, a paging
 *               default) cannot satisfy this criterion on behaviour alone
 *   BOUNDARY:   the `>= 400` non-vacuity floor, and the same CLOSED ten-key set
 *               AC-MOS-1 pins — asserted by equality, so re-widening fails here too
 *   ERROR:      `status`, `signal` and `error` asserted as three separate conjuncts,
 *               never as one "it worked"; a `status: null` names ENOBUFS explicitly
 *               instead of being converted to an exit code
 *   STATE:      the verb allowlist is enforced by a guard, and the guard's refusal is
 *               itself tested, so the read-only promise is not a comment
 *   REGRESSION: the consumer's declared `maxBuffer` is re-read from its own source and
 *               cross-checked, so "the payload regressed" and "the consumer moved its
 *               goalposts" can never be reported as the same failure
 */

import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

// ─── Locations ──────────────────────────────────────────────────────────────

/** Repo root — four levels up from `packages/lore/tests/integration/`. Re-asserted on every spawn. */
const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url)).replace(/\/$/, "");

/** The CLI entry under test: this worktree's own SOURCE. ⛔ Never `dist/lore` — see AC-MOS-1's suite header. */
const LORE_ENTRY = join(REPO_ROOT, "packages", "lore", "src", "index.ts");

/** The command surface this criterion is about — its absence proves `REPO_ROOT` is not the repo under test. */
const LIST_COMMAND_PATH = join(REPO_ROOT, "packages", "lore", "src", "adapters", "cli", "commands", "list.ts");

/**
 * The live corpus this file reads, resolved the way the CLI resolves it: the nearest
 * `.lore/lore.db` at or above `REPO_ROOT`.
 *
 * ⛔ NOT `join(REPO_ROOT, ".lore", "lore.db")`. Measured 2026-08-25: a git WORKTREE
 * carries no `.lore/` of its own, so `findLoreDbPath` walks up and resolves the MAIN
 * checkout's corpus — the same split
 * `packages/lore/tests/integration/phase-write-lifecycle-doc-parity.test.ts` records in
 * its header. Pinning the worktree path made this file's premise assert `false` while
 * the ten conjuncts below all passed against the corpus the CLI had actually read; the
 * walk-up measures the fact the premise is about (a live corpus is reachable) at the
 * place it actually lives, and still fails loud when none is reachable at all.
 *
 * @returns The resolved database path, or `undefined` when no ancestor holds one
 */
function resolveLiveCorpusDb(): string | undefined {
  let dir = REPO_ROOT;
  for (;;) {
    const candidate = join(dir, ".lore", "lore.db");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/** The LIVE CONSUMER whose declared buffer this criterion borrows. ⛔ Read as TEXT, never imported — importing would run its suite. */
const CONSUMER_TEST_PATH = join(REPO_ROOT, "scripts", "tests", "spec-mirror-export.test.ts");

// ─── The pinned constants ───────────────────────────────────────────────────

/**
 * The buffer AC-MOS-2 pins, in MEGABYTES. ⛔ Not a budget this spec chose — it is the
 * constant `scripts/tests/spec-mirror-export.test.ts` already declares, which is what
 * makes this criterion go green only when that live consumer stops failing.
 * {@link consumerDeclaredMaxBufferMb} re-reads it from that file and the REGRESSION
 * test below cross-checks the two.
 */
const CONSUMER_MAX_BUFFER_MB = 20;

/** The exact invocation the live consumer spawns. ⛔ `list` only — see {@link refuseNonListVerb}. */
const REAL_CORPUS_ARGS = ["list", "--type", "knowledge", "--json", "--include-invalid"] as const;

/**
 * NON-VACUITY FLOOR (conjunct c). 555 rows measured 2026-08-25 @ 3331a98e; 556 in this
 * worktree the same day. ⛔ A shrunken corpus must FAIL this criterion, not quietly
 * satisfy it by fitting the cap for the wrong reason.
 */
const MINIMUM_KNOWLEDGE_ROWS = 400;

/** The CLOSED ten-key row contract, identical to AC-MOS-1's — restated here so the two criteria cannot drift apart. */
const CANONICAL_ROW_KEYS = [
  "id",
  "meta",
  "priority",
  "slug",
  "status",
  "tags",
  "title",
  "type",
  "updated_at",
  "validity_status",
] as const;

/** The nine `DocRecord` keys the contract drops. `content` and `extra` are the two the diagnosis measured; the rest must go with them. */
const WIDE_ONLY_KEYS = [
  "content",
  "created_at",
  "created_by",
  "deleted_at",
  "extra",
  "ordinal",
  "parent_id",
  "role",
  "version",
] as const;

// ─── Primitives ─────────────────────────────────────────────────────────────

/** The raw `spawnSync` facts this criterion asserts on — deliberately NOT collapsed into an exit code. */
interface RealCorpusRun {
  /** `null` when the process produced no exit code at all (signal / ENOBUFS). ⛔ Never defaulted. */
  readonly status: number | null;
  readonly signal: NodeJS.Signals | null;
  /** `spawnSync`'s own error, carrying `code: "ENOBUFS"` on buffer overflow. ⛔ Never discarded. */
  readonly error: (Error & { code?: string }) | undefined;
  readonly stdout: string;
  readonly stderr: string;
  readonly stdoutBytes: number;
}

/** ⛔ The refusal the invocation-shape clause demands. Runs on every spawn. */
function assertEntryUnderTest(): void {
  const requiredSuffix = join("packages", "lore", "src", "index.ts");
  if (!LORE_ENTRY.startsWith(REPO_ROOT + sep)) {
    throw new Error(`CLI entry ${LORE_ENTRY} is not inside the repo under test (${REPO_ROOT})`);
  }
  if (!LORE_ENTRY.endsWith(requiredSuffix)) {
    throw new Error(`CLI entry ${LORE_ENTRY} does not end with ${requiredSuffix} — refusing to measure a different surface`);
  }
  if (LORE_ENTRY.includes(`${sep}dist${sep}`) || basename(LORE_ENTRY) === "lore") {
    throw new Error(`CLI entry ${LORE_ENTRY} looks like a prebuilt binary — that measures whatever commit last ran \`bun run build\``);
  }
  if (!existsSync(LORE_ENTRY)) throw new Error(`CLI entry ${LORE_ENTRY} does not exist`);
  if (!existsSync(LIST_COMMAND_PATH)) throw new Error(`${REPO_ROOT} is not the repo under test — ${LIST_COMMAND_PATH} is missing`);
}

/**
 * ⛔ The read-only guard. This file runs against the TEAM'S LIVE KNOWLEDGE BASE, so the
 * allowlist is a single verb enforced in code, not a promise in a comment.
 *
 * @param args - The argv about to be spawned
 * @throws when `args[0]` is anything but `list`
 */
function refuseNonListVerb(args: readonly string[]): void {
  const verb = args[0];
  if (verb !== "list") {
    throw new Error(
      `refusing to run \`lore ${args.join(" ")}\` against the live corpus — this file is allowed the "list" verb ONLY`,
    );
  }
}

/**
 * Spawns one read against THIS repo's real corpus under the consumer's declared buffer.
 *
 * ⛔ Returns `spawnSync`'s facts VERBATIM — no `status ?? 1`, no discarded `error`. That
 * fallback is precisely what turned an ENOBUFS into a phantom "exit 1" in the consumer,
 * and reproducing it here would make this criterion unable to see its own subject.
 *
 * Side-effect class: IO (spawns a subprocess); the subprocess itself is a corpus READ.
 *
 * @param args - argv after the CLI entry; the verb MUST be `list`
 * @param maxBufferMb - buffer cap in megabytes, so the A/B in the header is reproducible
 * @returns The raw run facts — see {@link RealCorpusRun}
 */
function runListAgainstRealCorpus(args: readonly string[], maxBufferMb: number): RealCorpusRun {
  refuseNonListVerb(args);
  assertEntryUnderTest();
  const proc = spawnSync("bun", [LORE_ENTRY, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: maxBufferMb * 1024 * 1024,
    env: {
      ...process.env,
      // reason: SPEC-024 — AI is OFF for agent surfaces. Pinned so a developer shell
      // without CLAUDECODE=1 cannot make a corpus read nest a Claude call.
      CI: "true",
      LORE_AI_DEFAULT: "off",
    },
  });
  const stdout = proc.stdout ?? "";
  return {
    status: proc.status,
    signal: proc.signal,
    error: proc.error as (Error & { code?: string }) | undefined,
    stdout,
    stderr: proc.stderr ?? "",
    stdoutBytes: Buffer.byteLength(stdout, "utf8"),
  };
}

/**
 * The `maxBuffer` megabyte value the LIVE CONSUMER declares, read from its source TEXT.
 *
 * ⛔ Read, never imported: importing `spec-mirror-export.test.ts` would execute its
 * suite. Throws when the file is missing, when no declaration matches, or when the
 * declarations disagree — a silent `undefined` here would turn the REGRESSION
 * cross-check below into a no-op.
 *
 * @returns The single megabyte figure every `maxBuffer` in that file declares
 */
function consumerDeclaredMaxBufferMb(): number {
  if (!existsSync(CONSUMER_TEST_PATH)) {
    throw new Error(`the live consumer ${CONSUMER_TEST_PATH} is missing — AC-MOS-2's buffer has no source to borrow`);
  }
  const source = readFileSync(CONSUMER_TEST_PATH, "utf8");
  const matches = [...source.matchAll(/maxBuffer:\s*(\d+)\s*\*\s*1024\s*\*\s*1024/g)].map((m) => Number(m[1]));
  if (matches.length === 0) {
    throw new Error(`no \`maxBuffer: N * 1024 * 1024\` declaration found in ${CONSUMER_TEST_PATH}`);
  }
  const distinct = [...new Set(matches)];
  if (distinct.length !== 1) {
    throw new Error(`${CONSUMER_TEST_PATH} declares disagreeing maxBuffer values: ${distinct.join(", ")} MB`);
  }
  const [only] = distinct;
  if (only === undefined) throw new Error("unreachable: a single-element set yielded no element");
  return only;
}

/** Parses the run's stdout into rows, throwing NAMING the run's facts rather than yielding a default. */
function rowsOf(run: RealCorpusRun): Record<string, unknown>[] {
  if (run.status !== 0) {
    throw new Error(
      `the real-corpus read produced status ${String(run.status)} / signal ${String(run.signal)} / error ` +
        `${String(run.error?.code ?? run.error?.message)} after ${run.stdoutBytes} stdout bytes`,
    );
  }
  const parsed = JSON.parse(run.stdout) as { ok?: boolean; data?: { docs?: unknown } };
  if (parsed.ok !== true || !Array.isArray(parsed.data?.docs)) {
    throw new Error(`the real-corpus read returned a non-ok envelope: ${run.stdout.slice(0, 400)}`);
  }
  return parsed.data.docs as Record<string, unknown>[];
}

// reason: ONE spawn, reused by every case below — the criterion says "assert THREE
// conjuncts in ONE run", and three separate spawns could in principle disagree with
// each other on a corpus another session is writing to.
const realCorpusRun = runListAgainstRealCorpus(REAL_CORPUS_ARGS, CONSUMER_MAX_BUFFER_MB);

// ─── The criterion ──────────────────────────────────────────────────────────

describe("the real corpus read fits the consumer's declared buffer", () => {
  it("PREMISE: a live corpus is reachable from this checkout", () => {
    const resolved = resolveLiveCorpusDb();
    expect(resolved, `no .lore/lore.db at or above ${REPO_ROOT} — there is no live corpus to measure`).toBeDefined();
  });

  describe("AC-MOS-2(a) — BEHAVIOUR under the consumer's 20MB cap", () => {
    it("HAPPY: status is exactly 0", () => {
      // ⛔ `toBe(0)`, never "not null" and never "falsy": under ENOBUFS the status is
      // `null`, and `expect(null).not.toBe(1)` would pass.
      expect(
        realCorpusRun.status,
        `stdout ${realCorpusRun.stdoutBytes} bytes; stderr: ${realCorpusRun.stderr.slice(0, 300)}`,
      ).toBe(0);
    });

    it("ERROR: spawnSync reported no error — an ENOBUFS must surface HERE, not as an exit code", () => {
      expect(realCorpusRun.error?.code).toBeUndefined();
      expect(realCorpusRun.error).toBeUndefined();
    });

    it("ERROR: the process was not killed by a signal", () => {
      // The 20MB A/B produced SIGTERM alongside ENOBUFS; asserted separately so the
      // failure names which of the three facts went wrong.
      expect(realCorpusRun.signal).toBeNull();
    });
  });

  describe("AC-MOS-2(b) — SHAPE, so a status-0 alone cannot satisfy the criterion", () => {
    it("NEGATIVE: no returned row carries content or extra", () => {
      const rows = rowsOf(realCorpusRun);
      const offenders = rows.filter((row) => "content" in row || "extra" in row);
      expect(offenders.map((row) => row["slug"])).toEqual([]);
    });

    it("NEGATIVE: no returned row carries ANY of the wide-only DocRecord keys", () => {
      const rows = rowsOf(realCorpusRun);
      const present = WIDE_ONLY_KEYS.filter((key) => rows.some((row) => key in row));
      expect(present).toEqual([]);
    });

    it("BOUNDARY: every row's sorted key set EQUALS the same closed set AC-MOS-1 pins", () => {
      const rows = rowsOf(realCorpusRun);
      const distinct = [...new Set(rows.map((row) => Object.keys(row).sort().join(" ")))];
      expect(distinct).toEqual([[...CANONICAL_ROW_KEYS].join(" ")]);
    });
  });

  describe("AC-MOS-2(c) — NON-VACUITY, because this criterion is environment-coupled", () => {
    it("BOUNDARY: the read returned at least the floor of rows", () => {
      const rows = rowsOf(realCorpusRun);
      // ⛔ Without this, a corpus that shrank on its own would fit 20MB even with full
      // records and this criterion would keep reporting pass while measuring nothing.
      expect(rows.length).toBeGreaterThanOrEqual(MINIMUM_KNOWLEDGE_ROWS);
    });

    it("BOUNDARY: every returned row really is a knowledge doc, so the count is of the thing that grows", () => {
      const rows = rowsOf(realCorpusRun);
      expect([...new Set(rows.map((row) => row["type"]))]).toEqual(["knowledge"]);
    });
  });

  describe("STATE — the read-only promise is enforced, and the enforcement is not inert", () => {
    it("the verb guard refuses every verb but `list`", () => {
      // ⛔ Positive control: without this, `refuseNonListVerb` could be silently
      // rewritten to a no-op and this file would keep passing while gaining the
      // ability to write to the team's live knowledge base.
      expect(() => refuseNonListVerb(["get", "some-slug"])).toThrow(/allowed the "list" verb ONLY/);
      expect(() => refuseNonListVerb(["create", "knowledge"])).toThrow(/allowed the "list" verb ONLY/);
      expect(() => refuseNonListVerb([])).toThrow(/allowed the "list" verb ONLY/);
      expect(() => refuseNonListVerb(["list", "--json"])).not.toThrow();
    });
  });

  describe("REGRESSION — the borrowed buffer still belongs to the live consumer", () => {
    it("the consumer's own source still declares the same maxBuffer this criterion uses", () => {
      // ⛔ Separated from the behaviour conjuncts on purpose: if the consumer changes
      // its cap, THIS is the assertion that fails, with a message saying so — rather
      // than the run above failing and reading as "our payload regressed".
      expect(consumerDeclaredMaxBufferMb()).toBe(CONSUMER_MAX_BUFFER_MB);
    });
  });
});
