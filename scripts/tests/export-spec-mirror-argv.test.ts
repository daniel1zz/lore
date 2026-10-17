// @spawns packages/lore/src/index.ts
// @spawns scripts/export-spec-mirror.ts
/**
 * AC-MOS-3 — `spec-the-mirror-oracles-two-command-surfaces-are-o-corpus-by`,
 * `task-a-real-argv-parser-for-export-spec-mirror-unknown-flags`.
 *
 * Proves that `scripts/export-spec-mirror.ts` REFUSES an argument it does not recognise instead of
 * ignoring it, with an exit code that can never be confused with a verdict about the mirror.
 *
 * ## The measured defect this file closes
 *
 * `main` read `argv.includes("--check")` and NOTHING else, then looped `MIRROR_TYPES`
 * unconditionally. Measured 2026-08-25 on main @ `3331a98e`:
 * `bun scripts/export-spec-mirror.ts --check --type prd --definitely-not-a-flag` exited 2 having
 * scanned all six types and printed no refusal line at all — BOTH the bogus flag and the
 * not-yet-existing `--type` were silently inert in that ONE run. Same class as
 * `knowledge-a-dry-run-flag-that-does-not-exist-writes-the-files`. The REGRESSION case below
 * replays that exact invocation and additionally requires stdout to be EMPTY, because "exited with
 * the usage code" alone would still be satisfied by a parser that refused only after scanning the
 * corpus — and "nothing was scanned" is half of what the defect was.
 *
 * ## Why the constants come out of a `bun -e` subprocess instead of a plain import
 *
 * `MIRROR_USAGE_EXIT_CODE` is exported from `scripts/export-spec-mirror.ts`, which
 * top-level-imports `createApp` -> `bun:sqlite` — unresolvable inside a vitest worker (measured
 * 2026-08-25: `Cannot find package 'bun:sqlite'` at import time, the same reason
 * `scripts/tests/spec-mirror-content-drift.test.ts` drives that file only as a subprocess). So the
 * constant is IMPORTED — never re-declared as a literal here, which the criterion forbids — inside
 * a real `bun` process that CAN resolve it, and its value is handed back as JSON.
 *
 * ⛔ That indirection is also STRONGER than an import would have been: a vitest run never proves a
 * symbol is exported (esbuild does not check named exports across modules —
 * `knowledge-under-vitest-importing-a-name-a-module-does-not`), whereas bun's ESM loader fails the
 * link. Measured both ways 2026-08-25: importing `MIRROR_USAGE_EXIT_CODE` exits 0 printing `3`;
 * importing a name the module does not export exits 1 with a SyntaxError. The ERROR case below
 * runs that second half as a live control, so this probe cannot silently degrade into one that
 * would accept a deleted export.
 *
 * ## Why the usage code is compared against BOTH core codes
 *
 * The criterion requires the usage code to differ from `0` and from `MIRROR_DRIFT_EXIT_CODE`. This
 * file also compares it against `MIRROR_HARD_FAILURE_EXIT_CODE`, because the usage constant is
 * declared in `export-spec-mirror.ts` while those two live in `export-spec-mirror-core.ts` — the
 * one mechanism that stops a future core code from quietly taking the same number and aliasing a
 * typo'd flag onto a corpus verdict.
 *
 * Coverage: HAPPY (`--check` alone still runs and never returns the usage code — the green control
 * that proves the parser does not reject everything) / NEGATIVE (unknown flag; unknown type name;
 * `--type` with no value; `--type` given twice; `--type` swallowing a following flag) / BOUNDARY
 * (an empty `--type=` is refused, not read as "no narrowing") / ERROR (the usage code differs from
 * 0 and from both core codes; the export probe's own falsifiability control) / STATE (the refusal
 * is pure: the identical invocation twice yields the identical exit code and stderr, and writes
 * nothing) / REGRESSION (the exact pre-fix invocation is refused AND scans nothing).
 *
 * Side-effect class: IO — spawns `bun` subprocesses that run this repo's mirror script in
 * READ-ONLY `--check` mode or refuse before opening the corpus at all. Writes no files, and never
 * touches `.lore/` or `docs/requirements/`.
 *
 * @spec_ref spec-the-mirror-oracles-two-command-surfaces-are-o-corpus-by AC-MOS-3
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { MIRROR_DRIFT_EXIT_CODE, MIRROR_HARD_FAILURE_EXIT_CODE } from "../export-spec-mirror-core.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");
const MIRROR_SCRIPT = join(REPO_ROOT, "scripts", "export-spec-mirror.ts");
// `.js` specifier — Bun resolves this to the sibling `.ts` source (project CLAUDE.md "Import style").
const MIRROR_SCRIPT_JS_SPECIFIER = join(REPO_ROOT, "scripts", "export-spec-mirror.js");

/** The bogus flag the criterion names verbatim — declared once so the assertion and the invocation cannot drift apart. */
const UNKNOWN_FLAG = "--definitely-not-a-flag";

interface MirrorRun {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** One real `bun scripts/export-spec-mirror.ts <args>` invocation — the production command surface, never `main()` in-process. */
function runMirror(args: readonly string[], cwd: string = REPO_ROOT): MirrorRun {
  const result = spawnSync("bun", [MIRROR_SCRIPT, ...args], {
    cwd,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.status === null) {
    throw new Error(`export-spec-mirror crashed (signal ${result.signal}): ${result.stderr}`);
  }
  return { exitCode: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

interface ExportedExitCodes {
  readonly usage: number;
  readonly drift: number;
  readonly hard: number;
}

/**
 * IMPORTS the three exit-code constants from `scripts/export-spec-mirror.ts` inside a real `bun`
 * process and returns their values. See this file's header for why the import cannot happen in the
 * vitest worker, and why routing it through bun makes the export itself falsifiable.
 */
function importExportedExitCodes(): ExportedExitCodes {
  const program = [
    `import { MIRROR_USAGE_EXIT_CODE, MIRROR_DRIFT_EXIT_CODE, MIRROR_HARD_FAILURE_EXIT_CODE } from ${JSON.stringify(MIRROR_SCRIPT_JS_SPECIFIER)};`,
    `console.log(JSON.stringify({ usage: MIRROR_USAGE_EXIT_CODE, drift: MIRROR_DRIFT_EXIT_CODE, hard: MIRROR_HARD_FAILURE_EXIT_CODE }));`,
  ].join("\n");
  const result = spawnSync("bun", ["-e", program], { cwd: REPO_ROOT, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(
      `could not import the exit-code constants from export-spec-mirror.ts (status ${result.status}): ${result.stderr}`,
    );
  }
  const parsed = JSON.parse((result.stdout ?? "").trim()) as Record<string, unknown>;
  for (const key of ["usage", "drift", "hard"]) {
    if (typeof parsed[key] !== "number") {
      throw new Error(`export-spec-mirror.ts did not export a numeric '${key}' exit code: ${result.stdout}`);
    }
  }
  return parsed as unknown as ExportedExitCodes;
}

describe("an unrecognised flag is refused, not ignored", () => {
  it(
    "AC-MOS-3 (a)+(b)+(c): the unknown flag exits the imported usage code naming it verbatim, that code differs from 0 and both core codes, and `--check` alone never returns it",
    () => {
      const codes = importExportedExitCodes();

      // (b) — inequalities between IMPORTED constants, never literals. `hard` is compared too
      // because `usage` is declared in a different file from `drift`/`hard`; see the header.
      expect(codes.usage).not.toBe(0);
      expect(codes.usage).not.toBe(codes.drift);
      expect(codes.usage).not.toBe(codes.hard);
      // The two core constants this worker CAN import must be the same values that file exports —
      // otherwise `codes` could be describing some other module entirely.
      expect(codes.drift).toBe(MIRROR_DRIFT_EXIT_CODE);
      expect(codes.hard).toBe(MIRROR_HARD_FAILURE_EXIT_CODE);

      // (a) — the refusal itself.
      const refused = runMirror(["--check", UNKNOWN_FLAG]);
      expect(refused.exitCode).toBe(codes.usage);
      expect(refused.stderr).toContain(UNKNOWN_FLAG);

      // (c) — GREEN CONTROL in the same run: a parser that refused everything would satisfy (a)
      // just as well, so the accepted invocation must still reach a real verdict.
      // reason: runs from a throwaway `lore init` corpus, never this repo's own `.lore/` —
      // LORE_TEST_SANDBOX (AC-TG-2) refuses that with exit 4. An empty corpus against this
      // checkout's mirror is drift (2), which is still "a real verdict, not a usage refusal".
      const corpus = realpathSync(mkdtempSync(join(tmpdir(), "mirror-argv-corpus-")));
      try {
        const init = spawnSync("bun", ["run", join(REPO_ROOT, "packages", "lore", "src", "index.ts"), "init"], {
          cwd: corpus,
          encoding: "utf8",
        });
        expect(init.status).toBe(0);
        const accepted = runMirror(["--check"], corpus);
        expect(accepted.exitCode).not.toBe(codes.usage);
        expect([0, MIRROR_DRIFT_EXIT_CODE]).toContain(accepted.exitCode);
      } finally {
        rmSync(corpus, { recursive: true, force: true });
      }
    },
    300_000,
  );

  it(
    "REGRESSION: the exact pre-fix invocation is refused AND scans nothing — stdout is empty, so no type was visited",
    () => {
      const codes = importExportedExitCodes();
      const run = runMirror(["--check", "--type", "prd", UNKNOWN_FLAG]);

      expect(run.exitCode).toBe(codes.usage);
      expect(run.stderr).toContain(UNKNOWN_FLAG);
      // Measured pre-fix, this printed six types' parity reports and exited 2. An empty stdout is
      // what distinguishes "refused before doing anything" from "did the work, then complained".
      expect(run.stdout.trim()).toBe("");
    },
    120_000,
  );

  it(
    "NEGATIVE: an unknown type name, a valueless `--type`, and a repeated `--type` are each refused by naming what was wrong",
    () => {
      const codes = importExportedExitCodes();

      const unknownType = runMirror(["--check", "--type", "notatype"]);
      expect(unknownType.exitCode).toBe(codes.usage);
      expect(unknownType.stderr).toContain("notatype");

      const noValue = runMirror(["--check", "--type"]);
      expect(noValue.exitCode).toBe(codes.usage);
      expect(noValue.stderr).toContain("--type");

      const repeated = runMirror(["--check", "--type", "spec", "--type", "task"]);
      expect(repeated.exitCode).toBe(codes.usage);
      expect(repeated.stderr).toContain("more than once");
    },
    180_000,
  );

  it(
    "BOUNDARY: `--type` never swallows a following flag, and an empty `--type=` is refused rather than read as 'no narrowing'",
    () => {
      const codes = importExportedExitCodes();

      // If `--type` consumed the next token blindly and then fell back to "all types", this would
      // silently run a full check. It must instead report `--check` as an invalid TYPE name.
      const swallowed = runMirror(["--type", "--check"]);
      expect(swallowed.exitCode).toBe(codes.usage);
      expect(swallowed.stderr).toContain("--check");

      const empty = runMirror(["--check", "--type="]);
      expect(empty.exitCode).toBe(codes.usage);
      expect(empty.stdout.trim()).toBe("");
    },
    180_000,
  );

  it(
    "STATE: the refusal is pure — the identical invocation twice returns the identical exit code and stderr",
    () => {
      const first = runMirror(["--check", UNKNOWN_FLAG]);
      const second = runMirror(["--check", UNKNOWN_FLAG]);
      expect(second.exitCode).toBe(first.exitCode);
      expect(second.stderr).toBe(first.stderr);
    },
    120_000,
  );

  it(
    "ERROR: the constant probe is falsifiable — importing a name the module does not export fails instead of yielding a value",
    () => {
      const program = `import { MIRROR_NOT_AN_EXPORT } from ${JSON.stringify(MIRROR_SCRIPT_JS_SPECIFIER)}; console.log(MIRROR_NOT_AN_EXPORT);`;
      const result = spawnSync("bun", ["-e", program], { cwd: REPO_ROOT, encoding: "utf8" });
      expect(result.status).not.toBe(0);
    },
    120_000,
  );
});
