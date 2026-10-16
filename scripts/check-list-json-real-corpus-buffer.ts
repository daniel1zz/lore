#!/usr/bin/env bun
/**
 * Live-corpus oracle for AC-MOS-2 of `spec-the-mirror-oracles-two-command-surfaces-are-o-corpus-by`
 * (`bun scripts/check-list-json-real-corpus-buffer.ts`) — PRODUCTION WIRING of the `lore list --json`
 * row contract.
 *
 * PURPOSE: spawn the SAME invocation the live mirror consumer spawns —
 * `lore list --type knowledge --json --include-invalid` — against THIS repo's REAL corpus under the
 * consumer's OWN declared `maxBuffer`, and assert three conjuncts in one run:
 *   (a) BEHAVIOUR  `status === 0`, `error === undefined`, `signal === null` — three separate facts.
 *   (b) SHAPE      every row's key set EQUALS the closed ten-key row contract; no row carries a
 *                  wide-only `DocRecord` key (`content`, `extra`, ...).
 *   (c) NON-VACUITY >= {@link MINIMUM_KNOWLEDGE_ROWS} rows, all `knowledge` — a corpus that shrank
 *                  until it fits the cap by itself must FAIL, not pass.
 * plus a REGRESSION cross-check that the consumer's own source still declares the same cap.
 *
 * This reads the repo's live `.lore/` corpus, so it runs from a check script and not from the unit
 * suite (task-skill-test-tg-2). The logic below is exercised against a mkdtemp corpus by
 * `packages/lore/tests/integration/list-json-real-corpus-buffer.test.ts`.
 *
 * ## Why `spawnSync`'s facts are never collapsed into an exit code
 *
 * `spawnSync` reports a buffer overflow as `status: null` + `error.code: "ENOBUFS"` — never a
 * nonzero exit code. A helper returning `status ?? 1` launders an infrastructure failure into "the
 * command exited 1" with empty stderr (measured 2026-08-25 @ 3331a98e: 20 MB cap -> status null /
 * SIGTERM / ENOBUFS / stdout truncated at 20,849,318; 64 MB cap -> status 0 / 22,988,107 bytes).
 *
 * ## ⛔ Read-only, and mechanically so
 *
 * {@link refuseNonListVerb} refuses every verb but `list`: `lore get` APPENDS a `trace_events` row to
 * the live corpus, `lore list` moves nothing.
 *
 * ## ⛔ No byte threshold anywhere
 *
 * Every byte figure is a point measurement of a growing corpus. The oracle is `status === 0` under
 * the consumer's cap — a threshold the CONSUMER owns — plus a SHAPE assertion.
 *
 * Exit codes: 0 all conjuncts hold; 1 a conjunct failed (every failure printed); 2 a precondition
 * failed loudly (no corpus reachable, entry missing, consumer source unreadable). Never "clean".
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SCRIPT_REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LORE_ENTRY = join(SCRIPT_REPO_ROOT, "packages", "lore", "src", "index.ts");

/**
 * The buffer AC-MOS-2 pins, in MEGABYTES. ⛔ Not a budget this spec chose — it is the cap the live
 * consumer declares. {@link consumerDeclaredMaxBufferMb} re-reads it from that consumer's source and
 * the cross-check in {@link main} compares the two.
 */
export const CONSUMER_MAX_BUFFER_MB = 20;

/** The live consumer whose declared buffer this criterion borrows. ⛔ Read as TEXT, never imported or run. */
export const CONSUMER_SOURCE_PATH = join(SCRIPT_REPO_ROOT, "scripts", "lib", "mirror-integrity.ts");

/** The exact invocation the live consumer spawns. ⛔ `list` only — see {@link refuseNonListVerb}. */
export const REAL_CORPUS_ARGS = ["list", "--type", "knowledge", "--json", "--include-invalid"] as const;

/** NON-VACUITY FLOOR (conjunct c). 555 rows measured 2026-08-25 @ 3331a98e. */
export const MINIMUM_KNOWLEDGE_ROWS = 400;

/** The CLOSED ten-key row contract, identical to AC-MOS-1's. */
export const CANONICAL_ROW_KEYS = [
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

/** The nine `DocRecord` keys the contract drops. */
export const WIDE_ONLY_KEYS = [
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

/** The raw `spawnSync` facts this criterion asserts on — deliberately NOT collapsed into an exit code. */
export interface RealCorpusRun {
  /** `null` when the process produced no exit code at all (signal / ENOBUFS). ⛔ Never defaulted. */
  readonly status: number | null;
  readonly signal: NodeJS.Signals | null;
  /** `spawnSync`'s own error, carrying `code: "ENOBUFS"` on buffer overflow. ⛔ Never discarded. */
  readonly error: (Error & { code?: string }) | undefined;
  readonly stdout: string;
  readonly stderr: string;
  readonly stdoutBytes: number;
}

/**
 * ⛔ The read-only guard: this script runs against the TEAM'S LIVE KNOWLEDGE BASE, so the allowlist
 * is a single verb enforced in code.
 *
 * @param args - The argv about to be spawned
 * @throws when `args[0]` is anything but `list`
 */
export function refuseNonListVerb(args: readonly string[]): void {
  if (args[0] !== "list") {
    throw new Error(`refusing to run \`lore ${args.join(" ")}\` against a corpus — this script is allowed the "list" verb ONLY`);
  }
}

/**
 * Spawns one `list` read in `cwd` under `maxBufferMb`.
 *
 * ⛔ Returns `spawnSync`'s facts VERBATIM — no `status ?? 1`, no discarded `error`.
 * Side-effect class: IO (spawns a subprocess); the subprocess itself is a corpus READ.
 *
 * @param args - argv after the CLI entry; the verb MUST be `list`
 * @param cwd - the directory whose nearest `.lore/lore.db` is read
 * @param maxBufferMb - buffer cap in megabytes
 */
export function runListIn(args: readonly string[], cwd: string, maxBufferMb: number): RealCorpusRun {
  refuseNonListVerb(args);
  if (!existsSync(LORE_ENTRY)) throw new Error(`CLI entry ${LORE_ENTRY} does not exist`);
  const proc = spawnSync("bun", [LORE_ENTRY, ...args], {
    cwd,
    encoding: "utf8",
    maxBuffer: maxBufferMb * 1024 * 1024,
    env: {
      ...process.env,
      // reason: SPEC-024 — AI is OFF for agent surfaces; pinned so a shell without CLAUDECODE=1
      // cannot make a corpus read nest a Claude call.
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

/** Parses a successful run's stdout into rows; throws NAMING the run's facts rather than yielding a default. */
export function rowsOf(run: RealCorpusRun): Record<string, unknown>[] {
  if (run.status !== 0) {
    throw new Error(
      `the read produced status ${String(run.status)} / signal ${String(run.signal)} / error ` +
        `${String(run.error?.code ?? run.error?.message)} after ${run.stdoutBytes} stdout bytes`,
    );
  }
  const parsed = JSON.parse(run.stdout) as { ok?: boolean; data?: { docs?: unknown } };
  if (parsed.ok !== true || !Array.isArray(parsed.data?.docs)) {
    throw new Error(`the read returned a non-ok envelope: ${run.stdout.slice(0, 400)}`);
  }
  return parsed.data.docs as Record<string, unknown>[];
}

/**
 * Evaluates conjuncts (a), (b) and (c) over one run. Every failing conjunct is reported on its own
 * line, so ENOBUFS never reads as a shape failure and a shape failure never reads as a cap failure.
 *
 * @param run - the raw run facts
 * @param minRows - the non-vacuity floor
 * @returns one line per violated conjunct; empty when all hold
 */
export function evaluateRun(run: RealCorpusRun, minRows: number): string[] {
  const violations: string[] = [];
  // ⛔ `!== 0`, never "falsy": under ENOBUFS the status is `null`.
  if (run.status !== 0) {
    violations.push(`(a) status is ${String(run.status)}, not exactly 0 (stdout ${run.stdoutBytes} bytes; stderr: ${run.stderr.slice(0, 300)})`);
  }
  if (run.error !== undefined) {
    violations.push(`(a) spawnSync reported error ${String(run.error.code ?? run.error.message)} — an ENOBUFS surfaces HERE, not as an exit code`);
  }
  if (run.signal !== null) violations.push(`(a) the process was killed by signal ${run.signal}`);
  if (run.status !== 0) return violations; // no payload to read shape/floor from

  let rows: Record<string, unknown>[];
  try {
    rows = rowsOf(run);
  } catch (e) {
    return [...violations, `(b) ${e instanceof Error ? e.message : String(e)}`];
  }
  const offenders = rows.filter((row) => "content" in row || "extra" in row).map((row) => String(row["slug"]));
  if (offenders.length > 0) violations.push(`(b) ${offenders.length} row(s) carry content or extra: ${offenders.slice(0, 5).join(", ")}`);
  const widePresent = WIDE_ONLY_KEYS.filter((key) => rows.some((row) => key in row));
  if (widePresent.length > 0) violations.push(`(b) wide-only key(s) present: ${widePresent.join(", ")}`);
  const distinctKeySets = [...new Set(rows.map((row) => Object.keys(row).sort().join(" ")))];
  const canonical = [...CANONICAL_ROW_KEYS].join(" ");
  if (distinctKeySets.length !== 1 || distinctKeySets[0] !== canonical) {
    violations.push(`(b) row key sets are not exactly the closed ten-key contract: ${JSON.stringify(distinctKeySets)}`);
  }
  if (rows.length < minRows) violations.push(`(c) ${rows.length} row(s) < the non-vacuity floor ${minRows}`);
  const types = [...new Set(rows.map((row) => row["type"]))];
  if (types.length !== 1 || types[0] !== "knowledge") violations.push(`(c) rows are not all knowledge docs: ${JSON.stringify(types)}`);
  return violations;
}

/** Strips `//` line and block comments so a regex over source text sees code, not prose that quotes it. */
export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/**
 * The `maxBuffer` megabyte value the LIVE CONSUMER declares, read from its source CODE (comments
 * stripped — an earlier revision matched a figure quoted in a comment and so measured nothing).
 * Throws when the file is missing, no declaration matches, or declarations disagree.
 *
 * @param sourcePath - the consumer source to read; defaults to {@link CONSUMER_SOURCE_PATH}
 */
export function consumerDeclaredMaxBufferMb(sourcePath: string = CONSUMER_SOURCE_PATH): number {
  if (!existsSync(sourcePath)) {
    throw new Error(`the live consumer ${sourcePath} is missing — AC-MOS-2's buffer has no source to borrow`);
  }
  const code = stripComments(readFileSync(sourcePath, "utf8"));
  const matches = [...code.matchAll(/maxBuffer:\s*(\d+)\s*\*\s*1024\s*\*\s*1024/g)].map((m) => Number(m[1]));
  if (matches.length === 0) throw new Error(`no \`maxBuffer: N * 1024 * 1024\` declaration found in the code of ${sourcePath}`);
  const distinct = [...new Set(matches)];
  if (distinct.length !== 1) throw new Error(`${sourcePath} declares disagreeing maxBuffer values: ${distinct.join(", ")} MB`);
  const [only] = distinct;
  if (only === undefined) throw new Error("unreachable: a single-element set yielded no element");
  return only;
}

/** The nearest `.lore/lore.db` at or above `start`, resolved the way the CLI resolves its corpus. */
export function resolveLiveCorpusDb(start: string): string | undefined {
  let dir = start;
  for (;;) {
    const candidate = join(dir, ".lore", "lore.db");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/** `--root <dir>` selects the checkout whose corpus is read; defaults to this repository. */
function parseRoot(argv: readonly string[]): string {
  const i = argv.indexOf("--root");
  if (i === -1) return SCRIPT_REPO_ROOT;
  const value = argv[i + 1];
  if (value === undefined || value.startsWith("--")) throw new Error("--root requires a directory argument");
  return resolve(value);
}

function main(argv: readonly string[]): number {
  let run: RealCorpusRun;
  let declared: number;
  try {
    const root = parseRoot(argv);
    if (resolveLiveCorpusDb(root) === undefined) {
      throw new Error(`no .lore/lore.db at or above ${root} — there is no live corpus to measure`);
    }
    declared = consumerDeclaredMaxBufferMb();
    run = runListIn(REAL_CORPUS_ARGS, root, CONSUMER_MAX_BUFFER_MB);
  } catch (e) {
    console.error(`check-list-json-real-corpus-buffer: precondition failed — ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }
  const violations = evaluateRun(run, MINIMUM_KNOWLEDGE_ROWS);
  if (declared !== CONSUMER_MAX_BUFFER_MB) {
    violations.push(
      `REGRESSION: the consumer ${CONSUMER_SOURCE_PATH} now declares maxBuffer ${declared} MB, but this criterion pins ${CONSUMER_MAX_BUFFER_MB} MB`,
    );
  }
  if (violations.length > 0) {
    for (const v of violations) console.error(`check-list-json-real-corpus-buffer: ${v}`);
    return 1;
  }
  const rowCount = rowsOf(run).length;
  console.log(
    `check-list-json-real-corpus-buffer: OK — the real-corpus include-invalid read returned status exactly 0 under a ${CONSUMER_MAX_BUFFER_MB}MB maxBuffer with error undefined, over ${rowCount} rows (>= ${MINIMUM_KNOWLEDGE_ROWS}) none carrying content or extra`,
  );
  return 0;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
