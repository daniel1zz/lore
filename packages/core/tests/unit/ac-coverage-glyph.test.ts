// @reads packages/core/src/**
/**
 * RED suite for SPEC-143 AC-CT-1's PROJECTION half — `projectAcCoverageGlyph`
 * (`packages/core/src/acceptance.ts`, spec component C4). Written BEFORE the
 * implementation by `task-skill-test-glyph-projection-and-the-two-rule-renderer-scan`;
 * the paired implementation task is
 * `task-skill-implement-projectaccoverageglyph-the-two-rule-site`.
 *
 * AC-CT-1's OTHER half — rule 2 of `scripts/check-ac-state-renderers.ts`, the
 * uniqueness ORACLE that refuses a SECOND projection — lives in
 * `packages/lore/tests/unit/scripts/check-ac-state-renderers.test.ts`. Neither file
 * satisfies AC-CT-1 alone.
 *
 * ## Scenario 1 — injectivity is MEASURED, not asserted (`glyph-injectivity`)
 *
 * All SEVEN states `deriveAcCoverageState` can return are enumerated, each proven to
 * be produced by a real fact (the INPUT CONTROL — without it "seven glyphs" could be
 * seven glyphs over six states, or over a hand-written state list that has drifted
 * from the function), then projected, and the glyph SET SIZE is compared to 7.
 * ⛔ Spot-checking two states does not satisfy AC-CT-1 and is not what this does.
 *
 * The failure is reported as the COLLIDING PAIRS, not as a bare `7 !== 6`, so
 * AC-CT-1's mandatory falsifier (a) — "make two switch arms return the same glyph" —
 * reddens with the two states named.
 *
 * ## Scenario 2 — an EIGHTH state must break the build (`never-exhaustiveness`)
 *
 * A compile-failure fixture, not prose, following
 * `packages/lore/tests/unit/core/mirror-human-id-brand.bun.test.ts`'s discipline:
 * drive THIS checkout's own pinned compiler (`<repo>/node_modules/.bin/tsc`, resolved
 * from `import.meta.url` — never `bunx tsc`, which can fetch a DIFFERENT TypeScript
 * than the one this repo compiles with) against an ISOLATED `mkdtemp` project, so a
 * deliberately-broken `.ts` never lands inside a real typechecked glob and redden
 * every concurrent `bun run typecheck` in this checkout.
 *
 * ⛔ WHERE THIS DEPARTS FROM THAT PRECEDENT, DELIBERATELY: that suite needed BOTH an
 * in-tree `@ts-expect-error` guard AND an isolated fixture, because its isolated
 * fixture RECONSTRUCTED the brand shape from scratch and would therefore have stayed
 * green if the real production brand were weakened. This fixture compiles a VERBATIM
 * COPY of the real `packages/core/src/acceptance.ts` (plus its real transitive
 * imports and the repo's real `node_modules`), mutated by exactly one token — so the
 * `never` check under test IS the production one, which is strictly stronger than an
 * `@ts-expect-error` on a call site. No in-tree directive is needed, and none is
 * added.
 *
 * ⛔ AND A SECOND REASON IT WOULD BE INERT HERE: `packages/core/tests/**` is
 * typechecked by NOTHING. `bun run typecheck` runs seven projects (core, lore,
 * lore-tests, scripts, dashboard, dashboard-tests, dashboard-e2e) and
 * `packages/core/tsconfig.json` is `include: ["src/**\/*"]` — there is no
 * `typecheck:core-tests`. Any `@ts-expect-error`/type-level assertion placed in THIS
 * directory is a false oracle: vitest's esbuild transform strips types without
 * checking them, so nothing would ever evaluate it. That is a reported governance
 * gap, not a licence — every compile-time claim here is made through the spawned
 * `tsc` below, whose exit code is measured.
 *
 * Three cases, because exit code alone cannot discriminate (measured against this
 * repo's tsc 5.9.3 under the `--noEmit` shape `bun run typecheck` uses, 2026-08-23):
 *   - CONTROL: the UNMUTATED copy compiles clean, exit EXACTLY 0. Proves the isolated
 *     project harness is not inherently broken, so the negative case is attributable
 *     to the mutation and nothing else. This case is GREEN TODAY, pre-implementation.
 *   - NEGATIVE: one extra member on the `AcCoverageState` union → exit EXACTLY 2 with
 *     `TS2322`, `not assignable to type 'never'`, the injected literal, AND a
 *     diagnostic path naming the SCRATCH copy of `acceptance.ts` (the real file's path
 *     cannot contain the `mkdtemp` basename, so this is what refuses a run that
 *     compiled the production file instead of the mutant).
 *   - REVERSE CONTROL: a project whose `files` entry does not exist is ALSO exit 2,
 *     but with `TS6053` and explicitly WITHOUT `TS2322`/`never` — proving the negative
 *     case discriminates a real detection from a config-level fatal that never
 *     compiled anything. ⛔ Never `not.toBe(0)`; never "non-zero".
 *
 * ## Why the projection is loaded through a DYNAMIC import
 *
 * A top-level `import { projectAcCoverageGlyph }` would fail at module load during the
 * RED phase and take scenario 2's live GREEN CONTROL down with it, leaving no evidence
 * that the compile harness works. The dynamic read below fails with an explicit
 * "not implemented yet" message naming the expected export instead. It also needs no
 * `@ts-expect-error`, so the implementation task has no pragma to remove.
 * ⛔ KNOWN SELECTION GAP: `bun run test:changed` is structurally blind to a consumer
 * that reaches its target through `await import()`, so an edit to `acceptance.ts`
 * does NOT select this file. Run it by hand.
 *
 * Six-dimension coverage:
 *   HAPPY:      seven states → seven pairwise-distinct glyphs (`glyph-injectivity`).
 *   NEGATIVE:   an eighth union member fails the build at the `never` check
 *               (`never-exhaustiveness`).
 *   BOUNDARY:   the INPUT CONTROL — the seven fixtures really do cover all seven
 *               `deriveAcCoverageState` outputs, so 7 glyphs cannot be reached over
 *               fewer than 7 states.
 *   ERROR:      the reverse control's output is asserted to be genuinely ABSENT of the
 *               violation tokens, never merely "not checked for".
 *   STATE:      every scratch project is built fresh per case and removed in
 *               `afterEach`; no shared mutable fixture between cases.
 *   REGRESSION: exact exit codes (0 and EXACTLY 2) are pinned, and every glyph is
 *               required to be a non-empty string, so a projection returning
 *               `undefined` cannot read as a distinct glyph.
 *
 * @spec_ref spec-corpus-truthfulness-a-verdict-must-carry-the-state-it AC-CT-1 (C4)
 * @spec_ref task-skill-test-glyph-projection-and-the-two-rule-renderer-scan
 */

import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deriveAcCoverageState, type AcCoverageFact } from "../../src/acceptance.js";

// ─── Paths ──────────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
/** `packages/core/tests/unit` → repo root is four levels up. */
const REPO_ROOT = join(__dirname, "..", "..", "..", "..");
const TSC_BIN = join(REPO_ROOT, "node_modules", ".bin", "tsc");
const CORE_SRC_DIR = join(REPO_ROOT, "packages", "core", "src");
const ACCEPTANCE_REL = join("src", "acceptance.ts");

// ─── Measured tsc facts (probe transcript 2026-08-23, tsc 5.9.3, --noEmit) ──

/** A real type error AND a config-level fatal BOTH land here — see the header. */
const TSC_EXIT_DIAGNOSTICS = 2;
/** Clean compile. */
const TSC_EXIT_CLEAN = 0;
/** `Type 'X' is not assignable to type 'never'` — what a widened union does to the exhaustiveness arm. */
const TS2322 = "TS2322";
/** `File '…' not found` — the reverse control's config-level fatal. */
const TS6053 = "TS6053";
/** The substring that names the exhaustiveness check itself, not merely "some type error". */
const NEVER_DIAGNOSTIC = "not assignable to type 'never'";

/**
 * The synthetic eighth state injected into the union. Deliberately unlike any real
 * state name so its appearance in a compiler diagnostic is unambiguous evidence that
 * the MUTANT was compiled.
 */
const EIGHTH_STATE = "__eighth_ac_coverage_state__";

/**
 * Locates the `AcCoverageState` union declaration in `acceptance.ts` source.
 *
 * `[^;]*` deliberately spans newlines, so this matches BOTH plausible shapes the
 * implementation may choose: a multi-line string-literal union, and a
 * `(typeof AC_COVERAGE_STATES)[number]` indexed access. Appending ` | "X"` to either
 * capture yields a valid eight-member union.
 */
const AC_COVERAGE_STATE_DECL = /export\s+type\s+AcCoverageState\s*=\s*([^;]*);/g;

// ─── Isolated tsc project harness ───────────────────────────────────────────

const scratchDirs: string[] = [];

afterEach(() => {
  while (scratchDirs.length > 0) {
    const dir = scratchDirs.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

/** The `--noEmit`/`strict` shape `bun run typecheck`'s per-package tsconfigs use. */
const BASE_COMPILER_OPTIONS = {
  target: "ESNext",
  module: "ESNext",
  moduleResolution: "bundler",
  strict: true,
  noEmit: true,
  skipLibCheck: true,
};

/**
 * Builds an isolated project holding a VERBATIM copy of `packages/core/src`, with the
 * repo's real `node_modules` symlinked in so `zod` and friends resolve exactly as they
 * do in production. `files` names only `src/acceptance.ts`, so tsc compiles it plus its
 * real transitive imports and nothing else (the copied `*.test.ts` siblings are not in
 * the program — measured: this control exits 0).
 *
 * @param mutate - applied to the copied `acceptance.ts` source before compiling;
 *   identity for the control case.
 * @param filesEntry - the tsconfig `files` array; the reverse control points it at a
 *   path that does not exist.
 * @returns the scratch project root (registered for `afterEach` cleanup).
 */
function makeIsolatedCoreProject(
  mutate: (source: string) => string = (source) => source,
  filesEntry: string[] = ["src/acceptance.ts"],
): string {
  const root = mkdtempSync(join(tmpdir(), "ac-coverage-glyph-"));
  scratchDirs.push(root);
  mkdirSync(join(root, "src"), { recursive: true });
  cpSync(CORE_SRC_DIR, join(root, "src"), { recursive: true });
  symlinkSync(join(REPO_ROOT, "node_modules"), join(root, "node_modules"));

  const acceptancePath = join(root, ACCEPTANCE_REL);
  writeFileSync(acceptancePath, mutate(readFileSync(acceptancePath, "utf8")), "utf8");

  writeFileSync(
    join(root, "tsconfig.json"),
    JSON.stringify({ compilerOptions: BASE_COMPILER_OPTIONS, files: filesEntry }, null, 2),
    "utf8",
  );
  return root;
}

/** Runs THIS repo's own pinned `tsc -p <root>/tsconfig.json`; `status` is `-1` when signal-killed, never `1`. */
function runTsc(projectRoot: string): { status: number; output: string } {
  const result = spawnSync(TSC_BIN, ["-p", join(projectRoot, "tsconfig.json")], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error !== undefined) throw new Error(`spawn tsc failed: ${result.error.message}`);
  return { status: result.status ?? -1, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

/**
 * Appends one extra member to the `AcCoverageState` union.
 *
 * @throws when the declaration is absent or appears more than once — the RED-phase
 *   failure mode. A silent no-op mutation would make this the same text as the
 *   control, and "the mutation never applied" must never be reported as "the never
 *   check did not fire".
 */
function widenAcCoverageStateUnion(source: string): string {
  const matches = source.match(AC_COVERAGE_STATE_DECL) ?? [];
  if (matches.length !== 1) {
    throw new Error(
      `expected EXACTLY ONE \`export type AcCoverageState = …;\` declaration in ` +
        `packages/core/src/acceptance.ts, found ${matches.length}. SPEC-143 C4 puts the state union ` +
        `and \`projectAcCoverageGlyph\` there; until the implementation task lands, this is the ` +
        `expected RED (missing implementation), not a harness defect.`,
    );
  }
  return source.replace(AC_COVERAGE_STATE_DECL, (_m, body: string) => `export type AcCoverageState =${body} | "${EIGHTH_STATE}";`);
}

// ─── The seven states, each proven to be reachable (INPUT CONTROL) ──────────

/**
 * One fixture per `deriveAcCoverageState` return value, enumerated from the
 * function's own precedence table in `packages/core/src/acceptance.ts` (rows 1-7),
 * NOT from any summary. Each `state` is asserted below to be what the real function
 * actually returns for its `fact` — the fixtures are evidence, never a claim.
 */
const STATE_FIXTURES: ReadonlyArray<{ readonly state: string; readonly fact: AcCoverageFact }> = [
  // row 1 — a fail with no attested pass to supersede it
  {
    state: "fail",
    fact: { ac_id: "AC-G-FAIL", mode: "script", pass: 1, fail: 1, refs: [], attested_pass: 0, attested_fail: 0, falsified: 1 },
  },
  // row 2 — the newest ATTESTED pass is strictly newer than the newest fail
  {
    state: "fail_superseded",
    fact: {
      ac_id: "AC-G-SUP",
      mode: "script",
      pass: 1,
      fail: 1,
      attested_pass: 1,
      attested_fail: 0,
      falsified: 1,
      refs: [
        { task_id: "t1", result: "fail", recorded_at: "2026-08-01T00:00:00.000Z" },
        { task_id: "t2", result: "pass", attested: true, recorded_at: "2026-08-02T00:00:00.000Z" },
      ],
    },
  },
  // row 3 — attested pass outranks every pass-side reading
  {
    state: "attested_pass",
    fact: { ac_id: "AC-G-ATT", mode: "script", pass: 1, fail: 0, refs: [], attested_pass: 1, attested_fail: 0, falsified: 0 },
  },
  // row 4 — `falsified` fails runtime well-formedness despite its declared `number` type (M5)
  {
    state: "not_measured",
    fact: {
      ac_id: "AC-G-NM",
      mode: "script",
      pass: 1,
      fail: 0,
      refs: [],
      attested_pass: 0,
      attested_fail: 0,
      falsified: undefined as unknown as number,
    },
  },
  // row 5 — green, but this oracle was never observed able to go red
  {
    state: "pass_unfalsified",
    fact: { ac_id: "AC-G-PU", mode: "script", pass: 1, fail: 0, refs: [], attested_pass: 0, attested_fail: 0, falsified: 0 },
  },
  // row 6 — green with a real red observation on record
  {
    state: "pass",
    fact: { ac_id: "AC-G-PASS", mode: "script", pass: 1, fail: 0, refs: [], attested_pass: 0, attested_fail: 0, falsified: 2 },
  },
  // row 7 — no evidence at all
  {
    state: "none",
    fact: { ac_id: "AC-G-NONE", mode: "script", pass: 0, fail: 0, refs: [], attested_pass: 0, attested_fail: 0, falsified: 0 },
  },
];

/**
 * Loads `projectAcCoverageGlyph` from the SSOT module (`packages/core/src/acceptance.ts`,
 * not the `@lore/core` barrel) through a dynamic import — see the header for why this is
 * not a top-level import.
 *
 * @throws with an explicit "not implemented" message during the RED phase.
 */
async function loadProjection(): Promise<(state: string) => unknown> {
  const mod = (await import("../../src/acceptance.js")) as unknown as Record<string, unknown>;
  const projection = mod["projectAcCoverageGlyph"];
  if (typeof projection !== "function") {
    throw new Error(
      "packages/core/src/acceptance.ts does not export `projectAcCoverageGlyph` — SPEC-143 C4's " +
        "single state-to-glyph projection is not implemented yet. This is the expected RED.",
    );
  }
  return projection as (state: string) => unknown;
}

// ─── Scenario 1 ─────────────────────────────────────────────────────────────

describe("projectAcCoverageGlyph — rendering is injective (AC-CT-1)", () => {
  it("INPUT CONTROL: the seven fixtures really do produce all seven deriveAcCoverageState outputs — glyph-injectivity", () => {
    const observed = STATE_FIXTURES.map((fixture) => ({
      declared: fixture.state,
      actual: deriveAcCoverageState(fixture.fact),
    }));

    // Every fixture yields the state it claims — a drifted fixture must never be able
    // to stand in for a missing state.
    expect(observed.filter((row) => row.declared !== row.actual)).toEqual([]);
    // …and the seven together are pairwise distinct, so "7 glyphs" cannot be reached
    // over 6 states plus a duplicate.
    expect(new Set(observed.map((row) => row.actual)).size).toBe(7);
  });

  it("all seven states project to seven PAIRWISE-DISTINCT glyphs — glyph-injectivity", async () => {
    const projection = await loadProjection();

    const projected = STATE_FIXTURES.map((fixture) => ({
      state: fixture.state,
      glyph: projection(deriveAcCoverageState(fixture.fact)),
    }));

    // A projection returning `undefined`/`""` for every state would otherwise collapse
    // to one "glyph" and be reported only as a set-size failure.
    expect(projected.filter((row) => typeof row.glyph !== "string" || row.glyph.length === 0)).toEqual([]);

    // Report COLLIDING PAIRS, not a bare size mismatch, so AC-CT-1's mandatory
    // falsifier (a) — two switch arms returning the same glyph — reddens with the two
    // offending states named.
    const byGlyph = new Map<unknown, string[]>();
    for (const row of projected) {
      byGlyph.set(row.glyph, [...(byGlyph.get(row.glyph) ?? []), row.state]);
    }
    const collisions = [...byGlyph.entries()]
      .filter(([, states]) => states.length > 1)
      .map(([glyph, states]) => ({ glyph, states }));
    expect(collisions).toEqual([]);

    expect(new Set(projected.map((row) => row.glyph)).size).toBe(7);
  });
});

// ─── Scenario 2 ─────────────────────────────────────────────────────────────

describe("projectAcCoverageGlyph — an eighth state fails the build (AC-CT-1) — never-exhaustiveness", () => {
  it("CONTROL: the UNMUTATED copy of packages/core/src compiles clean at exit EXACTLY 0 — never-exhaustiveness", () => {
    const root = makeIsolatedCoreProject();
    const { status, output } = runTsc(root);

    // Attribution guard: if this ever fails, the NEGATIVE case below proves nothing.
    expect(status).toBe(TSC_EXIT_CLEAN);
    expect(output).not.toContain(TS2322);
  }, 120000);

  it("NEGATIVE: an eighth AcCoverageState member is TS2322 at the never check, exit EXACTLY 2 — never-exhaustiveness", () => {
    const root = makeIsolatedCoreProject(widenAcCoverageStateUnion);
    const { status, output } = runTsc(root);

    expect(status).toBe(TSC_EXIT_DIAGNOSTICS);
    expect(output).toContain(TS2322);
    // The exhaustiveness ARM specifically — not merely "a type error somewhere".
    expect(output).toContain(NEVER_DIAGNOSTIC);
    expect(output).toContain(EIGHTH_STATE);

    // The diagnostic must name the SCRATCH copy of acceptance.ts. tsc prints the path
    // relative to cwd, so the absolute root is not a substring — the `mkdtemp`
    // basename is, and the production file's path can never contain it. This is what
    // refuses a run that compiled `packages/core/src/acceptance.ts` instead of the mutant.
    const diagnosticLine = output.split("\n").find((line) => line.includes(TS2322)) ?? "";
    expect(diagnosticLine).toContain(basename(root));
    expect(diagnosticLine).toContain("src/acceptance.ts");
  }, 120000);

  it("REVERSE CONTROL: a missing `files` entry is ALSO exit 2 but with TS6053 and no never diagnostic — never-exhaustiveness", () => {
    const root = makeIsolatedCoreProject(undefined, ["src/this-file-does-not-exist.ts"]);
    const { status, output } = runTsc(root);

    // Same exit code as the NEGATIVE case — which is exactly why the assertions above
    // pin the diagnostic tokens rather than the exit code alone.
    expect(status).toBe(TSC_EXIT_DIAGNOSTICS);
    expect(output).toContain(TS6053);
    expect(output).not.toContain(TS2322);
    // ERROR dimension: genuinely absent, never merely "not checked for".
    expect(output).not.toContain(NEVER_DIAGNOSTIC);
    expect(output).not.toContain(EIGHTH_STATE);
  }, 120000);
});
