// @spawns scripts/check-ac-state-renderers.ts
// @reads .gitattributes
// @reads .gitignore
// @reads CHANGELOG.md
// @reads CLAUDE.md
// @reads README.md
// @reads assets/**
// @reads bun.lock
// @reads bunfig.toml
// @reads hooks/**
// @reads lore.tree.yaml
// @reads lore.tree.yaml.example
// @reads package.json
// @reads packages/**
// @reads scripts/**
// @reads tsconfig.base.json
// @reads tsconfig.json
// @reads vitest.config.ts
// @reads vitest.node-files.ts
// @reads vitest.node.config.ts
// @reads vitest.shared.ts
// @reads workspace-aliases.ts
/**
 * RED suite for SPEC-143's two-rule renderer site scan,
 * `scripts/check-ac-state-renderers.ts` — AC-CT-7 (the scan and its RULE 1
 * `fact-field-read`) and AC-CT-1's UNIQUENESS ORACLE half (RULE 2 `glyph-projection`,
 * and the proof that `--rule` is not silently inert). Spec components C8 and C4.
 *
 * Written BEFORE the implementation by
 * `task-skill-test-glyph-projection-and-the-two-rule-renderer-scan`; the paired
 * implementation task is `task-skill-implement-projectaccoverageglyph-the-two-rule-site`.
 * AC-CT-1's PROJECTION half lives in `packages/core/tests/unit/ac-coverage-glyph.test.ts`.
 *
 * ## ⛔ THE CONTRACT THIS SUITE PINS, which the implementation MUST honour
 *
 *   1. Script path: `scripts/check-ac-state-renderers.ts`, run as `bun run <path>`.
 *   2. Rule selector: `--rule glyph-projection` / `--rule fact-field-read` selects
 *      EXACTLY ONE rule; NO flag runs BOTH.
 *   3. Exit codes: **0** clean, **EXACTLY 1** on a violation (output naming the
 *      offending function and file), **EXACTLY 2** when the scan itself cannot
 *      complete. ⛔ This differs from `check-plan-membership-sites.ts` (3/4) and
 *      follows `check-anchor-coverage.ts` (1/2), which is what AC-CT-7 pins.
 *   4. **A repo-root override env var, `LORE_AC_STATE_RENDERERS_REPO_ROOT`** — the
 *      seam every case below drives. It mirrors `check-anchor-coverage.ts`'s
 *      `LORE_ANCHOR_COVERAGE_REPO_ROOT` and the `main(repoRoot)` parameter
 *      `check-plan-membership-sites.ts` already documents as "overridable so tests
 *      can point it at a throwaway fixture tree". ⛔ Never set by production callers.
 *      Validate it rather than trusting it: an empty-string value must fail loud, not
 *      silently resolve the scan roots against the process cwd.
 *
 * ## Why a MIRROR of the real tree, and not an in-repo fixture
 *
 * Scenarios 3/4/5 need files that GENUINELY violate a rule. An in-repo fixture that
 * genuinely violates one would redden the real repo-wide scan for everyone (and
 * `bun run test`, into which AC-CT-7 wires it), so it would have to be allowlisted —
 * at which point it is no longer a violation and cannot drive exit 1. Writing one into
 * the live tree at test time is worse: a peer session's `git status`/typecheck sees it,
 * and a crashed run leaks it. So every case here copies the real source tree into a
 * `mkdtemp` mirror (`node_modules`/`.git`/`dist`/`docs`/`.lore` excluded — the scan is
 * a purely textual site scan and reads none of them), drops ONE generated fixture in,
 * and points the scan at the mirror. Consequence, deliberately: **this suite creates NO
 * fixture file inside the repository**, so there are no extra file anchors to declare.
 *
 * ⛔ The mirror filter keys on the path RELATIVE to the repo root, never the absolute
 * path: a worktree checkout lives under `.claude/worktrees/…`, so an absolute-path
 * filter that skips `.claude` rejects every entry and yields a silently EMPTY mirror
 * that makes every scan exit 2. Measured while building this harness, 2026-08-23.
 *
 * ## Six scenarios (the task's own AC), plus two controls and one symmetry case
 *
 *   1-2. (`packages/core/tests/unit/ac-coverage-glyph.test.ts` — projection + `never`.)
 *   3. rule-2-only fixture + `--rule glyph-projection` → exit EXACTLY 1, naming it.
 *   4. rule-1-only fixture + `--rule glyph-projection` → exit EXACTLY 0. ⛔ THIS is the
 *      direction that proves the flag is not silently inert: an inert flag that scans
 *      nothing also exits 0, which is why case 3 (same flag, exit 1) is mandatory
 *      alongside it, and why case 5 (same fixture, no flag, exit 1) is mandatory too.
 *      No one of the three has discriminating power alone.
 *   5. rule-1-only fixture + NO flag → exit EXACTLY 1 (no flag runs both rules).
 *   6. the scan cannot complete → exit EXACTLY 2, output naming the scan, PAIRED with
 *      the clean-mirror control below on the same harness. ⛔ A fatal-path probe placed
 *      outside the tree the tool scans exits fatal for an unrelated reason and has zero
 *      discriminating power, so the fatal here is the scan's OWN undecidable condition
 *      (its scan roots are absent from the tree it was pointed at) and the assertions
 *      pin the exit code AND that the scan named itself, against a live green control.
 *   +. CLEAN-MIRROR CONTROL: the unmodified mirror exits EXACTLY 0 under both flag
 *      shapes — without it, cases 3/5's exit 1 could be some pre-existing violation
 *      rather than the fixture, and case 6's exit 2 could be the mirror itself.
 *   +. SYMMETRY: rule-2-only fixture + `--rule fact-field-read` → exit EXACTLY 0, the
 *      mirror image of case 4, so neither rule name can be the one that does nothing.
 *   +. HARNESS SELF-CHECK: the mirror really contains the source files the scan needs
 *      and really excludes `node_modules`. Green TODAY, pre-implementation — so a later
 *      red here is attributable to the scan, never to the mirror.
 *
 * ## Why the projection is loaded through a DYNAMIC import
 *
 * The rule-2 fixture must yield a glyph from `projectAcCoverageGlyph`'s OWN alphabet,
 * so the glyphs are read from the projection at test time rather than hard-coded — a
 * hard-coded `✘` would silently stop being a violation the moment the implementation
 * picks a different alphabet, and scenario 3 would then pass vacuously. The import is
 * dynamic (not top-level) so the harness self-check and the fatal-path case still run
 * during the RED phase, and so the implementation task has no `@ts-expect-error`
 * pragma to remove.
 * ⛔ KNOWN SELECTION GAP, twice over: `bun run test:changed` is structurally blind BOTH
 * to a tree-scanning test that names no literal path AND to a consumer that reaches its
 * target through `await import()`. Neither an edit to `acceptance.ts` nor one to
 * `scripts/check-ac-state-renderers.ts` selects this file. Run it BY HAND.
 *
 * ## ⛔ The false-green this suite had to close, measured before it was written
 *
 * `bun run scripts/check-ac-state-renderers.ts` on a tree where that file does not
 * exist prints `error: Module not found "scripts/check-ac-state-renderers.ts"` and
 * exits **1** — the exact code scenarios 3 and 5 pin as "a violation was found".
 * Measured 2026-08-23, before any assertion below was written. Asserting the scan's own
 * name in the output does NOT discriminate either: the module-not-found message
 * contains that name too. So `runScan` asserts the script EXISTS before spawning, and
 * a missing scan is reported as a missing scan. Without that guard, scenarios 3 and 5
 * would have passed on an empty repository.
 *
 * ⛔ NEVER WRITES TO THE REPO'S OWN `.lore/` — this suite touches no corpus at all.
 *
 * Six-dimension coverage:
 *   HAPPY:      the clean mirror scans to exit 0 under both flag shapes.
 *   NEGATIVE:   cases 3 and 5 — a real violation drives exit EXACTLY 1, named.
 *   BOUNDARY:   cases 4 and the symmetry case — the OTHER rule's violation is exit 0
 *               under the selecting flag; the selector's two edges are both measured.
 *   ERROR:      case 6 — an undecidable scan is exit EXACTLY 2, distinct from 1.
 *   STATE:      one mirror per file, each fixture removed in `finally`, so no case can
 *               observe another's fixture.
 *   REGRESSION: exact exit codes with `toBe`, never "non-zero"; and each generated
 *               fixture is self-checked to violate ONLY its own rule, so a fixture that
 *               drifts into violating both cannot silently destroy case 4's power.
 *
 * @spec_ref spec-corpus-truthfulness-a-verdict-must-carry-the-state-it AC-CT-7, AC-CT-1 (C8, C4)
 * @spec_ref task-skill-test-glyph-projection-and-the-two-rule-renderer-scan
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

// ─── Paths and the pinned contract ──────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
/** `packages/lore/tests/unit/scripts` → repo root is five levels up. */
const REPO_ROOT = join(__dirname, "..", "..", "..", "..", "..");
/** The scan under test — run from the REAL repo, pointed at a mirror. */
const SCAN_SCRIPT_REL = "scripts/check-ac-state-renderers.ts";
const SCAN_SCRIPT = join(REPO_ROOT, "scripts", "check-ac-state-renderers.ts");
/** The repo-root override seam — see the contract block in the header. */
const REPO_ROOT_ENV = "LORE_AC_STATE_RENDERERS_REPO_ROOT";
/** Substring every scan message must carry so a fatal is attributable to THIS scan. */
const SCAN_SELF_NAME = "check-ac-state-renderers";

const RULE_GLYPH_PROJECTION = "glyph-projection";
const RULE_FACT_FIELD_READ = "fact-field-read";

/** AC-CT-7's exit contract — asserted with `toBe`, never "non-zero". */
const EXIT_CLEAN = 0;
const EXIT_VIOLATION = 1;
const EXIT_SCAN_BROKE = 2;

/**
 * The seven `deriveAcCoverageState` outputs, transcribed from that function's return
 * union in `packages/core/src/acceptance.ts`. That the seven are all REACHABLE is
 * proven by `packages/core/tests/unit/ac-coverage-glyph.test.ts`'s INPUT CONTROL,
 * which drives real facts through the real function — this list is only the argument
 * vector for reading the projection's alphabet.
 */
const AC_COVERAGE_STATE_NAMES = [
  "fail",
  "fail_superseded",
  "attested_pass",
  "not_measured",
  "pass_unfalsified",
  "pass",
  "none",
] as const;

// ─── Mirror of the real source tree ─────────────────────────────────────────

/**
 * Directory names excluded from the mirror. The scan is a textual site scan over
 * source files (C8), so none of these can change its verdict; `docs`/`.lore` are
 * excluded because they are large and contain no scannable `.ts`.
 */
const MIRROR_SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "coverage",
  "docs",
  ".lore",
  ".lore-bootstrap",
  ".serena",
  ".claude",
  "npm-pkg",
]);

/** Files the mirror MUST contain for the scan to have anything to measure. */
const MIRROR_REQUIRED_FILES = [
  "packages/core/src/acceptance.ts",
  "packages/lore/src/service/outline-service.ts",
  "scripts/check-plan-membership-sites.ts",
] as const;

/**
 * Copies the repo's source tree into a fresh `mkdtemp` root.
 *
 * @returns the mirror root.
 * @throws when a required file is missing from the result — a silently empty mirror
 *   makes every scan exit 2 for a reason that has nothing to do with the scan.
 */
function buildMirror(): string {
  const root = mkdtempSync(join(tmpdir(), "ac-state-renderers-mirror-"));
  for (const entry of readdirSync(REPO_ROOT, { withFileTypes: true })) {
    if (MIRROR_SKIP_DIRS.has(entry.name)) continue;
    const from = join(REPO_ROOT, entry.name);
    const to = join(root, entry.name);
    if (entry.isDirectory()) {
      cpSync(from, to, {
        recursive: true,
        dereference: false,
        // ⛔ RELATIVE segments only — see the header's worktree note.
        filter: (candidate) => !relative(REPO_ROOT, candidate).split(sep).some((seg) => MIRROR_SKIP_DIRS.has(seg)),
      });
    } else if (entry.isFile()) {
      cpSync(from, to);
    }
  }
  const missing = MIRROR_REQUIRED_FILES.filter((rel) => !existsSync(join(root, rel)));
  if (missing.length > 0) {
    rmSync(root, { recursive: true, force: true });
    throw new Error(`mirror is incomplete — missing ${missing.join(", ")}; refusing to scan a tree nobody copied`);
  }
  return root;
}

let mirrorRoot: string;
/** An empty directory: the scan's own scan roots are absent from it (scenario 6). */
let rootlessTree: string;

beforeAll(() => {
  mirrorRoot = buildMirror();
  rootlessTree = mkdtempSync(join(tmpdir(), "ac-state-renderers-rootless-"));
}, 120000);

afterAll(() => {
  if (mirrorRoot !== undefined) rmSync(mirrorRoot, { recursive: true, force: true });
  if (rootlessTree !== undefined) rmSync(rootlessTree, { recursive: true, force: true });
});

// ─── Scan invocation ────────────────────────────────────────────────────────

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  /** The child's real exit code, or `-1` when signal-killed — never `1`, which is a code this suite pins. */
  readonly exitCode: number;
  readonly combined: string;
}

/**
 * Refuses to measure an exit code produced by a MISSING scan.
 *
 * @throws when `scripts/check-ac-state-renderers.ts` does not exist — see the
 *   false-green section in the module header. `bun run <missing>.ts` exits 1, the same
 *   code a real violation produces, and its message even contains the scan's own name,
 *   so this existence check is the ONLY thing that distinguishes the two.
 */
function assertScanExists(): void {
  if (!existsSync(SCAN_SCRIPT)) {
    throw new Error(
      `${SCAN_SCRIPT_REL} does not exist — SPEC-143 C8's two-rule renderer site scan is not ` +
        "implemented yet. This is the expected RED. ⛔ Its absence is NOT reported through an exit " +
        "code: `bun run <missing>.ts` exits 1, which is exactly what this suite pins as a violation.",
    );
  }
}

/**
 * Spawns the REAL scan from the real repo, pointed at `treeRoot`.
 *
 * `REPO_ROOT_ENV` is DELETED from the child env before being set, so an ambient value
 * inherited from the parent shell can never silently redirect the scan at a different
 * tree and turn one of these assertions into a measurement of some other directory.
 *
 * @param treeRoot - the tree the scan should walk.
 * @param ruleArgs - `["--rule", "<name>"]`, or `[]` for the no-flag (both rules) shape.
 */
function runScan(treeRoot: string, ruleArgs: readonly string[]): RunResult {
  assertScanExists();
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env[REPO_ROOT_ENV];
  env[REPO_ROOT_ENV] = treeRoot;
  const result = spawnSync("bun", ["run", SCAN_SCRIPT, ...ruleArgs], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    // explicit maxBuffer per this repo's spawnSync-truncation discipline
    maxBuffer: 20 * 1024 * 1024,
    env,
  });
  if (result.error !== undefined) {
    throw new Error(`spawn failed: bun run ${SCAN_SCRIPT_REL} ${ruleArgs.join(" ")} — ${result.error.message}`);
  }
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  return { stdout, stderr, exitCode: result.status ?? -1, combined: stdout + stderr };
}

// ─── Generated fixtures ─────────────────────────────────────────────────────

/**
 * Reads the projection's glyph alphabet by projecting all seven states — never a
 * hard-coded glyph list, which would stop being a violation the moment the
 * implementation chose a different alphabet (AC-CT-1 R9's own argument, applied to the
 * test as well as to the scan).
 *
 * @throws with an explicit "not implemented" message during the RED phase.
 */
async function readGlyphAlphabet(): Promise<Record<string, string>> {
  // ⛔ `@lore/core`, NOT a relative `../../../../core/src/acceptance.js`. Measured
  // 2026-08-23: `packages/lore/tsconfig.tests.json` sets `rootDir: "."` (=
  // `packages/lore`), so a relative reach into `packages/core/src` pulls 8 files
  // outside that rootDir and `bun run typecheck` exits 2 with TS6059 — which would
  // have broken INV-1 on `main`. The monorepo rule in the project CLAUDE.md is the
  // fix: cross-package imports go through the workspace specifier. The barrel
  // re-exports `acceptance.ts` wholesale (`export * from "./acceptance.js"`), so the
  // projection appears here as soon as it exists.
  const mod = (await import("@lore/core")) as unknown as Record<string, unknown>;
  const projection = mod["projectAcCoverageGlyph"];
  if (typeof projection !== "function") {
    throw new Error(
      "@lore/core (packages/core/src/acceptance.ts) does not export `projectAcCoverageGlyph` — SPEC-143 C4's " +
        "single state-to-glyph projection is not implemented yet, so a rule-2 fixture cannot be " +
        "generated from its alphabet. This is the expected RED.",
    );
  }
  const project = projection as (state: string) => unknown;
  const alphabet: Record<string, string> = {};
  for (const state of AC_COVERAGE_STATE_NAMES) {
    const glyph = project(state);
    if (typeof glyph !== "string" || glyph.length === 0) {
      throw new Error(`projectAcCoverageGlyph(${JSON.stringify(state)}) did not yield a non-empty string glyph`);
    }
    alphabet[state] = glyph;
  }
  return alphabet;
}

/** Where a generated fixture lands inside the mirror — under a certain scan root, plain `.ts`, not under any `tests/` segment. */
const FIXTURE_DIR_REL = join("packages", "lore", "src", "service");
const RULE2_FIXTURE_REL = join(FIXTURE_DIR_REL, "ac-state-renderer-rule2-red-fixture.ts");
const RULE1_FIXTURE_REL = join(FIXTURE_DIR_REL, "ac-state-renderer-rule1-red-fixture.ts");
const RULE2_FIXTURE_FN = "renderCoverageGlyphRedFixture";
const RULE1_FIXTURE_FN = "countFailRefsRedFixture";

/**
 * A file violating ONLY rule 2: it satisfies BOTH of that rule's mandatory conditions
 * — (i) it names `AcCoverageFact` in its signature AND `AcCoverageState` in a local
 * type annotation, and (ii) it yields glyphs from the projection's alphabet as bare
 * string literals (the first of the four enumerated forms) — while reading NO `.fail`
 * or `.pass` field off the fact, so rule 1 has nothing to find.
 *
 * The two states it renders are `none` and `not_measured`, chosen so the fixture's own
 * text contains neither the token `fail` nor `pass` anywhere: a rule-1 matcher that is
 * looser than "a field read" must not be able to fire on this file by accident, which
 * would destroy scenario 4's discriminating power silently.
 */
function rule2OnlyFixture(alphabet: Record<string, string>): string {
  return [
    "/**",
    " * ⛔ GENERATED RED FIXTURE — never present in the repository.",
    " *",
    " * Written into a throwaway mkdtemp MIRROR of the source tree by",
    " * packages/lore/tests/unit/scripts/check-ac-state-renderers.test.ts and removed",
    " * immediately after the scan runs. It is a DELIBERATE violation of RULE 2",
    " * (glyph-projection) of scripts/check-ac-state-renderers.ts and of nothing else.",
    " *",
    " * It is excluded from any live repo-wide run by NOT EXISTING there: no allowlist",
    " * entry is needed, and none must be added — an allowlisted fixture is not a",
    " * violation and could not drive the exit code this suite measures.",
    " */",
    "",
    'import type { AcCoverageFact, AcCoverageState } from "@lore/core";',
    "",
    `export function ${RULE2_FIXTURE_FN}(fact: AcCoverageFact): string {`,
    '  const state: AcCoverageState = fact.mode === "script" ? "none" : "not_measured";',
    `  if (state === "none") return ${JSON.stringify(alphabet["none"])};`,
    `  return ${JSON.stringify(alphabet["not_measured"])};`,
    "}",
    "",
  ].join("\n");
}

/**
 * A file violating ONLY rule 1: it reads `.fail` off an `AcCoverageFact` outside
 * `acceptance.ts`. It names `AcCoverageFact` (rule 2's condition (i)) but yields NO
 * glyph at all — it returns a number — so rule 2's condition (ii) is unsatisfied and
 * the conjunction does not fire. That is what makes it a rule-1-ONLY violation rather
 * than a violation of both.
 */
function rule1OnlyFixture(): string {
  return [
    "/**",
    " * ⛔ GENERATED RED FIXTURE — never present in the repository.",
    " *",
    " * Written into a throwaway mkdtemp MIRROR of the source tree by",
    " * packages/lore/tests/unit/scripts/check-ac-state-renderers.test.ts and removed",
    " * immediately after the scan runs. It is a DELIBERATE violation of RULE 1",
    " * (fact-field-read) of scripts/check-ac-state-renderers.ts and of nothing else.",
    " *",
    " * It is excluded from any live repo-wide run by NOT EXISTING there: no allowlist",
    " * entry is needed, and none must be added.",
    " */",
    "",
    'import type { AcCoverageFact } from "@lore/core";',
    "",
    `export function ${RULE1_FIXTURE_FN}(fact: AcCoverageFact): number {`,
    "  return fact.fail;",
    "}",
    "",
  ].join("\n");
}

/**
 * Writes `content` into the mirror at `relPath`, runs `body`, and removes the fixture
 * in `finally` so no case can observe another's.
 */
function withFixture<T>(relPath: string, content: string, body: () => T): T {
  const abs = join(mirrorRoot, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, "utf8");
  try {
    return body();
  } finally {
    rmSync(abs, { force: true });
  }
}

// ─── Harness self-check (green TODAY) ───────────────────────────────────────

describe("check-ac-state-renderers — fixture-tree harness", () => {
  it("HARNESS SELF-CHECK: the mirror carries the real source tree and excludes node_modules", () => {
    for (const rel of MIRROR_REQUIRED_FILES) {
      expect(existsSync(join(mirrorRoot, rel))).toBe(true);
    }
    // A mirror that dragged node_modules in would make every scan walk ~600 packages.
    expect(existsSync(join(mirrorRoot, "node_modules"))).toBe(false);
    expect(existsSync(join(mirrorRoot, "packages", "lore", "node_modules"))).toBe(false);
    // The scenario-6 tree really is rootless — the fatal must come from an absent
    // scan root, not from a directory that happens to hold sources.
    expect(readdirSync(rootlessTree)).toEqual([]);
  });
});

// ─── Clean-mirror control ───────────────────────────────────────────────────

describe("check-ac-state-renderers — clean-mirror control (AC-CT-7)", () => {
  it("CONTROL: the unmodified mirror scans clean at exit EXACTLY 0 with no --rule flag", () => {
    const result = runScan(mirrorRoot, []);
    expect(result.exitCode).toBe(EXIT_CLEAN);
  }, 180000);

  it("CONTROL: the unmodified mirror scans clean at exit EXACTLY 0 under each --rule flag", () => {
    const glyph = runScan(mirrorRoot, ["--rule", RULE_GLYPH_PROJECTION]);
    expect(glyph.exitCode).toBe(EXIT_CLEAN);
    const field = runScan(mirrorRoot, ["--rule", RULE_FACT_FIELD_READ]);
    expect(field.exitCode).toBe(EXIT_CLEAN);
  }, 180000);
});

// ─── Scenario 3 ─────────────────────────────────────────────────────────────

describe("check-ac-state-renderers — RULE 2 glyph-projection (AC-CT-1)", () => {
  it("scenario 3: a rule-2-ONLY violation exits EXACTLY 1 under --rule glyph-projection, naming the function", async () => {
    const alphabet = await readGlyphAlphabet();
    const fixture = rule2OnlyFixture(alphabet);

    // FIXTURE SELF-CHECK: it must violate rule 2 and NOTHING else. A fixture that
    // also read `.fail`/`.pass` would make scenario 4's exit-0 assertion untestable
    // and this exit-1 assertion unattributable.
    expect(fixture).not.toMatch(/\.(fail|pass)\b/);
    expect(fixture).not.toMatch(/\b(fail|pass)\b/);
    expect(fixture).toContain("AcCoverageFact");
    expect(fixture).toContain("AcCoverageState");
    expect(fixture).toContain(alphabet["none"]);

    const result = withFixture(RULE2_FIXTURE_REL, fixture, () =>
      runScan(mirrorRoot, ["--rule", RULE_GLYPH_PROJECTION]),
    );

    expect(result.exitCode).toBe(EXIT_VIOLATION);
    // AC-CT-1: "exiting EXACTLY 1 naming it" — the function, and the file it is in.
    expect(result.combined).toContain(RULE2_FIXTURE_FN);
    expect(result.combined).toContain(RULE2_FIXTURE_REL.split(sep).join("/"));
  }, 180000);

  it("SYMMETRY: the same rule-2-only violation exits EXACTLY 0 under --rule fact-field-read", async () => {
    const alphabet = await readGlyphAlphabet();
    const result = withFixture(RULE2_FIXTURE_REL, rule2OnlyFixture(alphabet), () =>
      runScan(mirrorRoot, ["--rule", RULE_FACT_FIELD_READ]),
    );

    // The mirror image of scenario 4 — so neither rule name can be the inert one.
    expect(result.exitCode).toBe(EXIT_CLEAN);
  }, 180000);
});

// ─── Scenarios 4 and 5 ──────────────────────────────────────────────────────

describe("check-ac-state-renderers — RULE 1 fact-field-read and the selector (AC-CT-7)", () => {
  it("scenario 4: a rule-1-ONLY violation exits EXACTLY 0 under --rule glyph-projection — the flag is not inert", async () => {
    const alphabet = await readGlyphAlphabet();
    const fixture = rule1OnlyFixture();

    // FIXTURE SELF-CHECK: it violates rule 1 (a `.fail` read off an AcCoverageFact)
    // and must NOT satisfy rule 2's condition (ii) — NO glyph from the real alphabet
    // may occur anywhere in its text. A fixture that violated both rules would make
    // this exit-0 assertion impossible to satisfy for a CORRECT scan, and the failure
    // would read as a scan defect.
    expect(fixture).toContain("fact.fail");
    expect(fixture).toContain("AcCoverageFact");
    expect(fixture).toContain(": number {");
    // ⛔ If this ever fails, read it as "the projection chose a glyph so common that
    // rule 2's bare-string-literal form cannot discriminate" — a degenerate alphabet —
    // NOT as a fixture defect to be papered over.
    expect(Object.values(alphabet).filter((glyph) => fixture.includes(glyph))).toEqual([]);

    const result = withFixture(RULE1_FIXTURE_REL, fixture, () =>
      runScan(mirrorRoot, ["--rule", RULE_GLYPH_PROJECTION]),
    );

    expect(result.exitCode).toBe(EXIT_CLEAN);
  }, 180000);

  it("scenario 5: the same rule-1-only violation exits EXACTLY 1 with NO --rule flag — no flag runs both rules", () => {
    const result = withFixture(RULE1_FIXTURE_REL, rule1OnlyFixture(), () => runScan(mirrorRoot, []));

    expect(result.exitCode).toBe(EXIT_VIOLATION);
    // AC-CT-7's mandatory falsifier: the scan names the offending file.
    expect(result.combined).toContain(RULE1_FIXTURE_REL.split(sep).join("/"));
    expect(result.combined).toContain(RULE1_FIXTURE_FN);
  }, 180000);
});

// ─── Scenario 6 ─────────────────────────────────────────────────────────────

describe("check-ac-state-renderers — an undecidable scan (AC-CT-7)", () => {
  it("scenario 6: a tree with none of the scan's roots exits EXACTLY 2, naming the scan, against a live green control", () => {
    // GREEN CONTROL FIRST, on the same harness and the same env seam — without it, an
    // exit 2 here could be the harness, the env var, or the scan script being absent,
    // none of which is "the scan could not complete on this tree".
    const control = runScan(mirrorRoot, []);
    expect(control.exitCode).toBe(EXIT_CLEAN);

    const broken = runScan(rootlessTree, []);

    // EXACTLY 2, distinct from EXIT_VIOLATION — an undecidable scan and a violation
    // must never render as the same verdict.
    expect(broken.exitCode).toBe(EXIT_SCAN_BROKE);
    expect(broken.exitCode).not.toBe(EXIT_VIOLATION);
    // The scan must say it was the scan that could not complete, and over which tree.
    expect(broken.combined).toContain(SCAN_SELF_NAME);
    expect(broken.combined).toContain(rootlessTree);
  }, 180000);

  it("scenario 6 (guard): an EMPTY repo-root override is refused rather than silently resolved against cwd", () => {
    assertScanExists();
    const env: NodeJS.ProcessEnv = { ...process.env };
    env[REPO_ROOT_ENV] = "";
    const result = spawnSync("bun", ["run", SCAN_SCRIPT], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
      env,
    });
    if (result.error !== undefined) throw new Error(`spawn failed: ${result.error.message}`);

    // A set-but-empty override that fell through to the real repo would make every
    // fixture-tree assertion in this file measure the live tree instead.
    expect(result.status ?? -1).toBe(EXIT_SCAN_BROKE);
    expect(`${result.stdout ?? ""}${result.stderr ?? ""}`).toContain(REPO_ROOT_ENV);
  }, 180000);
});
