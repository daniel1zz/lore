// @spawns packages/lore/src/index.ts
/**
 * Fixture test of the `lore list --json` production-wiring oracle — the vitest half of AC-MOS-2 of
 * `spec-the-mirror-oracles-two-command-surfaces-are-o-corpus-by`.
 *
 * @spec_ref AC-MOS-2
 *
 * ## Where the LIVE half went
 *
 * AC-MOS-2's subject is THIS repo's REAL corpus: spawn `lore list --type knowledge --json
 * --include-invalid` under the live consumer's declared 20MB `maxBuffer` and assert status 0, no
 * error, no signal, the closed ten-key row shape and a >= 400-row non-vacuity floor. Reading the
 * repo's live `.lore/` from the unit suite made that verdict depend on whatever the shared corpus
 * held at that moment, so it moved to `scripts/check-list-json-real-corpus-buffer.ts` (wired into
 * `bun run test` as `check:live-repo-state`, task-skill-test-tg-2). AC-MOS-2's command runs BOTH:
 * this file (the logic, on a mkdtemp corpus) and that script (the live read).
 *
 * ## What this file proves, on a throwaway `lore init` corpus
 *
 * The script's verdict function `evaluateRun` can PASS (a healthy run yields no violation) and can
 * FAIL for each conjunct on its own, with a message naming that conjunct:
 *
 *   HAPPY:      a seeded corpus read exits 0, error undefined, signal null, all rows the closed key set
 *   NEGATIVE:   a row carrying `content`/`extra` is reported under (b), never accepted
 *   BOUNDARY:   a corpus one row under the floor fails (c); the floor is the caller's parameter
 *   ERROR:      a buffer overflow surfaces as status null + ENOBUFS and is reported under (a) — three
 *               separate facts, never collapsed into an exit code
 *   STATE:      the verb allowlist refuses every verb but `list`, so the read-only promise is code
 *   REGRESSION: the consumer-cap reader reads CODE not comments, and fails loud on none/disagreeing
 *
 * ⛔ Nothing here reads this repo's `.lore/` or scans its tree: every corpus is a mkdtemp +
 * `lore init` fixture with `HOME` redirected inside it.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ⛔ The script is loaded with a DYNAMIC import of a computed path, and its surface is typed here.
// A static `import ... from "../../../../scripts/check-list-json-real-corpus-buffer.js"` makes
// `tsc -p packages/lore/tsconfig.tests.json` pull a file outside its `rootDir` into the program
// (TS6059); the repo's `.mjs` scripts avoid that only because JS is not a rooted source file.
/** The raw `spawnSync` facts the script's verdict reads — mirrors `RealCorpusRun` in the script. */
interface RealCorpusRun {
  readonly status: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly error: (Error & { code?: string }) | undefined;
  readonly stdout: string;
  readonly stderr: string;
  readonly stdoutBytes: number;
}

/** The slice of `scripts/check-list-json-real-corpus-buffer.ts` this file drives. */
interface ListScript {
  readonly CANONICAL_ROW_KEYS: readonly string[];
  readonly CONSUMER_MAX_BUFFER_MB: number;
  readonly REAL_CORPUS_ARGS: readonly string[];
  consumerDeclaredMaxBufferMb(sourcePath: string): number;
  evaluateRun(run: RealCorpusRun, minRows: number): string[];
  refuseNonListVerb(args: readonly string[]): void;
  rowsOf(run: RealCorpusRun): Record<string, unknown>[];
  runListIn(args: readonly string[], cwd: string, maxBufferMb: number): RealCorpusRun;
  stripComments(source: string): string;
}

const SCRIPT_PATH = new URL("../../../../scripts/check-list-json-real-corpus-buffer.ts", import.meta.url).pathname;
const script = (await import(/* @vite-ignore */ SCRIPT_PATH)) as ListScript;
const {
  CANONICAL_ROW_KEYS,
  CONSUMER_MAX_BUFFER_MB,
  REAL_CORPUS_ARGS,
  consumerDeclaredMaxBufferMb,
  evaluateRun,
  refuseNonListVerb,
  rowsOf,
  runListIn,
  stripComments,
} = script;

const LORE_ENTRY = join(new URL("../../src/index.ts", import.meta.url).pathname);
const SEEDED_ROWS = 3;

const fixtureDirs: string[] = [];
let seeded = "";

function makeFixtureDir(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `lore-list-buffer-${label}-`));
  fixtureDirs.push(dir);
  return dir;
}

function runLoreIn(dir: string, args: string[]): void {
  const proc = spawnSync("bun", [LORE_ENTRY, ...args], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, HOME: dir, EDITOR: "true", CLAUDECODE: "1", CI: "true", LORE_AI_DEFAULT: "off" },
  });
  if (proc.status !== 0) throw new Error(`fixture setup: lore ${args.join(" ")} exited ${String(proc.status)}: ${proc.stderr}`);
}

/** A run record carrying a synthetic stdout — for the verdict cases that need a payload the CLI no longer emits. */
function syntheticRun(docs: unknown[]): RealCorpusRun {
  const stdout = JSON.stringify({ ok: true, data: { docs } });
  return { status: 0, signal: null, error: undefined, stdout, stderr: "", stdoutBytes: Buffer.byteLength(stdout, "utf8") };
}

function canonicalRow(slug: string): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const key of CANONICAL_ROW_KEYS) row[key] = key === "type" ? "knowledge" : key === "slug" ? slug : "x";
  return row;
}

beforeAll(() => {
  seeded = makeFixtureDir("seeded");
  runLoreIn(seeded, ["init", "--author", "list-buffer-test"]);
  for (let i = 1; i <= SEEDED_ROWS; i++) {
    runLoreIn(seeded, [
      "create", "knowledge", "--sub-type", "reference", "--title", `Buffer Probe ${i}`,
      "--content", `## Probe ${i}\n\nbody`, "--no-ai",
    ]);
  }
}, 120_000);

afterAll(() => {
  for (const dir of fixtureDirs) rmSync(dir, { recursive: true, force: true });
});

describe("the real corpus read fits the consumer's declared buffer", () => {
  describe("AC-MOS-2(a) — BEHAVIOUR under the consumer's cap, on a seeded corpus", () => {
    it("HAPPY: status is exactly 0, spawnSync reported no error, no signal", () => {
      const run = runListIn(REAL_CORPUS_ARGS, seeded, CONSUMER_MAX_BUFFER_MB);
      expect(run.status, run.stderr.slice(0, 300)).toBe(0);
      expect(run.error).toBeUndefined();
      expect(run.signal).toBeNull();
    });

    it("ERROR: a buffer overflow surfaces as error.code ENOBUFS, and evaluateRun names it under (a)", () => {
      // ⛔ A 1 KiB cap against a 3-row payload overflows: the same shape the 20MB cap produced on the
      // wide payload. `status ?? 1` would have turned this into "exit 1" with empty stderr. Measured
      // under load (2026-10-16): the child can finish before spawnSync's kill lands, so the status is
      // `0` or `null` depending on the race while `error.code` is ENOBUFS either way — which is exactly
      // why `error` is its own conjunct and why this asserts the error, never the status.
      const run = runListIn(REAL_CORPUS_ARGS, seeded, 1 / 1024);
      expect(run.error?.code).toBe("ENOBUFS");
      const violations = evaluateRun(run, 1);
      expect(violations.some((v) => v.startsWith("(a) spawnSync reported error ENOBUFS"))).toBe(true);
    });
  });

  describe("AC-MOS-2(b) — SHAPE, so a status 0 alone cannot satisfy the criterion", () => {
    it("HAPPY: every row of a seeded read carries EXACTLY the closed ten-key set, and evaluateRun finds nothing", () => {
      const run = runListIn(REAL_CORPUS_ARGS, seeded, CONSUMER_MAX_BUFFER_MB);
      const rows = rowsOf(run);
      expect(rows).toHaveLength(SEEDED_ROWS);
      for (const row of rows) expect(Object.keys(row).sort()).toEqual([...CANONICAL_ROW_KEYS]);
      expect(evaluateRun(run, SEEDED_ROWS)).toEqual([]);
    });

    it("NEGATIVE: a row carrying content or extra is reported under (b), naming the slug", () => {
      const wide = { ...canonicalRow("wide-one"), content: "full body", extra: {} };
      const violations = evaluateRun(syntheticRun([canonicalRow("ok-one"), wide]), 1);
      expect(violations.some((v) => v.startsWith("(b)") && v.includes("wide-one"))).toBe(true);
    });

    it("NEGATIVE: a wide-only key other than content/extra is reported under (b)", () => {
      const violations = evaluateRun(syntheticRun([{ ...canonicalRow("a"), created_by: "someone" }]), 1);
      expect(violations.some((v) => v.includes("wide-only key(s) present: created_by"))).toBe(true);
    });

    it("NEGATIVE: a MISSING canonical key is reported under (b) — equality, not containment", () => {
      const { meta: _dropped, ...narrower } = canonicalRow("a");
      const violations = evaluateRun(syntheticRun([narrower]), 1);
      expect(violations.some((v) => v.startsWith("(b)") && v.includes("closed ten-key contract"))).toBe(true);
    });
  });

  describe("AC-MOS-2(c) — NON-VACUITY, because this criterion is environment-coupled", () => {
    it("BOUNDARY: exactly at the floor passes, one row under it fails (c)", () => {
      const run = runListIn(REAL_CORPUS_ARGS, seeded, CONSUMER_MAX_BUFFER_MB);
      expect(evaluateRun(run, SEEDED_ROWS)).toEqual([]);
      const under = evaluateRun(run, SEEDED_ROWS + 1);
      expect(under.some((v) => v.startsWith("(c)") && v.includes("floor"))).toBe(true);
    });

    it("NEGATIVE: rows that are not all knowledge docs fail (c)", () => {
      const task = { ...canonicalRow("t"), type: "task" };
      const violations = evaluateRun(syntheticRun([canonicalRow("k"), task]), 1);
      expect(violations.some((v) => v.startsWith("(c)") && v.includes("not all knowledge"))).toBe(true);
    });
  });

  describe("STATE — the read-only promise is enforced, and the enforcement is not inert", () => {
    it("the verb guard refuses every verb but `list`", () => {
      // ⛔ Positive control: without this, `refuseNonListVerb` could be silently rewritten to a
      // no-op and the script would gain the ability to write to the team's live knowledge base.
      expect(() => refuseNonListVerb(["get", "some-slug"])).toThrow(/"list" verb ONLY/);
      expect(() => refuseNonListVerb(["create", "knowledge"])).toThrow(/"list" verb ONLY/);
      expect(() => refuseNonListVerb([])).toThrow(/"list" verb ONLY/);
      expect(() => refuseNonListVerb(["list", "--json"])).not.toThrow();
    });

    it("runListIn refuses a non-list verb before spawning anything", () => {
      expect(() => runListIn(["get", "x"], seeded, 1)).toThrow(/"list" verb ONLY/);
    });
  });

  describe("REGRESSION — the borrowed buffer is read from the consumer's CODE", () => {
    it("reads the declaration from code and ignores the same figure quoted in a comment", () => {
      const dir = makeFixtureDir("consumer");
      const path = join(dir, "consumer.ts");
      writeFileSync(
        path,
        "// the old cap was maxBuffer: 20 * 1024 * 1024 and overflowed\n/* maxBuffer: 20 * 1024 * 1024 */\nconst opts = { maxBuffer: 64 * 1024 * 1024 };\n",
      );
      expect(consumerDeclaredMaxBufferMb(path)).toBe(64);
    });

    it("fails loud when the consumer declares no maxBuffer in code, or disagreeing ones, or is missing", () => {
      const dir = makeFixtureDir("consumer-bad");
      const none = join(dir, "none.ts");
      writeFileSync(none, "// maxBuffer: 20 * 1024 * 1024 only in a comment\nconst x = 1;\n");
      expect(() => consumerDeclaredMaxBufferMb(none)).toThrow(/no `maxBuffer/);
      const split = join(dir, "split.ts");
      writeFileSync(split, "a({ maxBuffer: 20 * 1024 * 1024 });\nb({ maxBuffer: 64 * 1024 * 1024 });\n");
      expect(() => consumerDeclaredMaxBufferMb(split)).toThrow(/disagreeing/);
      expect(() => consumerDeclaredMaxBufferMb(join(dir, "absent.ts"))).toThrow(/missing/);
    });

    it("stripComments leaves code and string-embedded URLs intact", () => {
      expect(stripComments("const u = 'http://x.y'; // gone\n/* gone */ const k = 1;")).toContain("http://x.y");
      expect(stripComments("a // b\n")).not.toContain("b");
    });
  });
});
