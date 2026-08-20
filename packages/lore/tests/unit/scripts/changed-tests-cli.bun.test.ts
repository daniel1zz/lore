/**
 * Real-repo e2e for `bun run test:changed`'s CLI shell
 * (`spec-two-runner-changed-test-selection-deterministic-test`, AC-TC-2).
 *
 * Unlike `changed-tests-selector.test.ts` (pure algorithm, synthetic
 * fixtures, vitest), this spawns the ACTUAL script — `bun scripts/changed
 * -tests.ts --list HEAD` — against THIS repo's real git state and real
 * `packages/*` file tree, via `Bun.spawnSync` (this file itself runs under
 * `bun test`, so the `Bun` global is always present here — unlike vitest's
 * worker-thread pool). `--list` guarantees no runner subprocess (`vitest`
 * `bun test`) is spawned, and the explicit `HEAD` base keeps the git diff
 * itself empty (`HEAD...HEAD`), so the selection is driven only by
 * uncommitted working-tree changes (`git status --porcelain`) at the moment
 * this suite runs — deterministic enough to assert "both runner lines
 * present, exit 0" without depending on which commit HEAD happens to be.
 *
 * cwd is pinned EXPLICITLY to the repo root (`path.resolve(import.meta.dir,
 * "../../../../..")`) rather than assumed from the process's inherited cwd —
 * this file is itself invoked via `cd packages/lore && bun test <path>`
 * (this repo's `test:bun` convention), so `process.cwd()` at the point this
 * test runs is `packages/lore`, not the repo root the script needs.
 */

import { describe, expect, it, beforeAll } from "bun:test";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

const REPO_ROOT = resolve(import.meta.dir, "../../../../..");

// reason: the selection-reason vocabulary is a runtime SSOT
// (`scripts/changed-tests.ts`'s `SELECTION_REASONS` + `isSelectionReason`) —
// this suite's own accounting-line matcher is built FROM it, never
// hand-transcribed as an independent regex/list. That transcription drift is
// exactly what went stale and turned `main` red when a fourth reason
// (`"tree-scan-oracle"`) was added to the producer's TYPE alone (task
// `task-main-is-red-a-fourth-selectionreason-was-added-to-the`) — a type
// erases at runtime, so a hand-copied regex here had nothing forcing it to
// notice.
//
// A STATIC `import { SELECTION_REASONS } from "../../../../../scripts/
// changed-tests.js"` was tried first and rejected: `scripts/changed-tests.ts`
// lives OUTSIDE `packages/lore/tsconfig.tests.json`'s `rootDir` ("."), and a
// static import pulls it (plus its own `./check-no-nul-bytes.js` import) into
// that tsconfig's program, failing `bun run typecheck` with TS6059 ("File is
// not under rootDir") — this is TRUE REGARDLESS of which test runner
// eventually executes the file; typecheck is runner-agnostic. This is the
// EXACT constraint already documented and worked around in
// `changed-tests-selector.test.ts` (the vitest sibling suite) and
// `tests/unit/distribution/platform-map.test.ts`: a **dynamic** `import()`
// with a runtime-COMPUTED (non-literal) specifier, resolved once in
// `beforeAll`. TypeScript cannot statically resolve a computed specifier, so
// the target file never enters this project's compilation graph — the
// rootDir violation cannot occur. (`tests/e2e/resume-coverage-compiled.bun
// .test.ts`'s STATIC import of `scripts/embed-assets-manifest.mjs` does not
// hit this: that target is plain `.mjs` with no `allowJs`/`checkJs` in this
// repo's tsconfig, so tsc never adds it to the program at all — a `.ts`
// target has no such exemption.)
const CHANGED_TESTS_SPECIFIER = pathToFileURL(join(REPO_ROOT, "scripts", "changed-tests.ts")).href;

let SELECTION_REASONS: readonly string[];
let isSelectionReason: (value: string) => boolean;
/**
 * Accounting-line reason-tag matcher, derived from {@link SELECTION_REASONS}
 * — NEVER an independently hand-transcribed alternation. Captures the tag
 * inside the parens so callers can additionally assert SET MEMBERSHIP on the
 * captured value (see the HAPPY case below): the alternation alone can only
 * ever match a KNOWN member by construction, which makes it structurally
 * incapable of catching an unknown tag — the CONTROL case below proves that
 * capability using synthetic data instead, since this repo's own real
 * accounting output can never legitimately contain an out-of-vocabulary tag.
 */
let KNOWN_REASON_TAG_RE: RegExp;
/**
 * `scripts/changed-tests.ts`'s own `HOOK_OR_ASSET_PAIR_MARKER_RE` — imported
 * (not re-transcribed) so the AC-TC-5 pinning describe block below tests the
 * EXACT literal the production classifier uses, never an independent copy
 * that could silently drift out of sync with it.
 */
let HOOK_OR_ASSET_PAIR_MARKER_RE: RegExp;
/** `scripts/changed-tests.ts`'s own `classifyTreeScanningOracle` — see the AC-TC-5 describe block below. */
let classifyTreeScanningOracle: (path: string, content: string) => ReadonlySet<string> | undefined;

beforeAll(async () => {
  const mod: {
    SELECTION_REASONS: readonly string[];
    isSelectionReason: (value: string) => boolean;
    HOOK_OR_ASSET_PAIR_MARKER_RE: RegExp;
    classifyTreeScanningOracle: (path: string, content: string) => ReadonlySet<string> | undefined;
  } = await import(CHANGED_TESTS_SPECIFIER);
  SELECTION_REASONS = mod.SELECTION_REASONS;
  isSelectionReason = mod.isSelectionReason;
  KNOWN_REASON_TAG_RE = new RegExp(`\\((${SELECTION_REASONS.join("|")})\\)`);
  HOOK_OR_ASSET_PAIR_MARKER_RE = mod.HOOK_OR_ASSET_PAIR_MARKER_RE;
  classifyTreeScanningOracle = mod.classifyTreeScanningOracle;
});

describe("bun run test:changed CLI — --list HEAD (AC-TC-2)", () => {
  it("HAPPY: exits 0 and prints a selected-count line for both runners", () => {
    const result = Bun.spawnSync(["bun", "scripts/changed-tests.ts", "--list", "HEAD"], {
      cwd: REPO_ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = result.stdout.toString("utf8");
    const stderr = result.stderr.toString("utf8");

    expect(result.exitCode, `expected exit 0, stderr:\n${stderr}`).toBe(0);
    expect(stdout).toMatch(/^vitest: selected \d+$/m);
    expect(stdout).toMatch(/^bun: selected \d+$/m);
  });

  it("HAPPY: at least one reason tag is printed for a selected file, and the captured tag is a real SELECTION_REASONS member (this suite's own new test files are uncommitted changed-test entries)", () => {
    const result = Bun.spawnSync(["bun", "scripts/changed-tests.ts", "--list", "HEAD"], {
      cwd: REPO_ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = result.stdout.toString("utf8");
    expect(result.exitCode).toBe(0);
    // reason tags are rendered as "(<reason>)" on a per-file line — assert at least
    // one SELECTION_REASONS member appears somewhere in the accounting block
    // (mandatory accounting, D3 — never a bare count with no detail when something
    // was actually selected). BOUNDARY: when nothing was selected (selectedAny ===
    // false), no tag is required at all — this guard is what keeps a zero-selection
    // run from being wrongly forced to match anything (see the dedicated BOUNDARY
    // case below for a synthetic proof this guard itself still discriminates).
    const selectedAny = /^vitest: selected [1-9]/m.test(stdout) || /^bun: selected [1-9]/m.test(stdout);
    if (selectedAny) {
      const match = KNOWN_REASON_TAG_RE.exec(stdout);
      expect(match, `expected a "(<reason>)" tag somewhere in:\n${stdout}`).not.toBeNull();
      const capturedTag = match![1]!;
      // Explicit membership assertion on the CAPTURED value (not merely "the regex
      // matched") — a future loosened regex (e.g. accidentally widened to `\((\w+)\)`)
      // would still satisfy "match is non-null" but would fail THIS line, since
      // isSelectionReason/SELECTION_REASONS.includes only accept real vocabulary
      // members.
      expect(isSelectionReason(capturedTag)).toBe(true);
      expect(SELECTION_REASONS).toContain(capturedTag);
    }
  });

  it("NEGATIVE (CONTROL): a synthetic accounting line carrying an unknown tag is REJECTED — proves the SSOT-derived matcher can still fail, not just widen forever", () => {
    // Synthetic — this repo's REAL accounting output can never legitimately contain
    // an out-of-vocabulary tag, so the rejection capability must be proven here
    // against constructed data instead. Without this control, "any of the known
    // reasons" trivially matches every tagged line and the assertion above would be
    // vacuous no matter how badly a future regex degraded.
    const syntheticLine = "  [vitest] packages/lore/tests/unit/example.test.ts (not-a-real-reason)";

    // 1) The SSOT-derived alternation itself must not match the unknown tag.
    expect(KNOWN_REASON_TAG_RE.test(syntheticLine)).toBe(false);

    // 2) Even extracted via a generic "(<anything>)" pattern (simulating a future
    //    consumer that loosened the capture), isSelectionReason/SELECTION_REASONS
    //    membership must independently reject it — the two-part mechanism (regex +
    //    membership) required by this task's AC-2, not one lone check that could
    //    itself silently degrade.
    const genericMatch = /\(([^()]+)\)/.exec(syntheticLine);
    expect(genericMatch).not.toBeNull();
    const extractedTag = genericMatch![1]!;
    expect(isSelectionReason(extractedTag)).toBe(false);
    expect(SELECTION_REASONS).not.toContain(extractedTag);
  });

  it("BOUNDARY: a synthetic zero-selection accounting block requires no reason tag — the selectedAny guard stays meaningful (never forced to match on an empty selection)", () => {
    const syntheticZeroAccounting = ["vitest: selected 0", "bun: selected 0", "build-first: no"].join("\n");

    const selectedAny =
      /^vitest: selected [1-9]/m.test(syntheticZeroAccounting) || /^bun: selected [1-9]/m.test(syntheticZeroAccounting);
    expect(selectedAny).toBe(false);
    // No reason tag is present in a genuine zero-selection block, and the guard
    // above must be false here precisely so no tag is ever required in this case —
    // asserted directly rather than left implicit.
    expect(KNOWN_REASON_TAG_RE.test(syntheticZeroAccounting)).toBe(false);
  });

  it("STATE/REGRESSION: the three pre-existing reasons (changed-test, transitive, binary-consumer) remain valid SELECTION_REASONS members alongside the newly added tree-scan-oracle", () => {
    for (const preExisting of ["changed-test", "transitive", "binary-consumer"] as const) {
      expect(SELECTION_REASONS).toContain(preExisting);
      expect(isSelectionReason(preExisting)).toBe(true);
    }
    // tree-scan-oracle — the fourth reason whose TYPE-only addition originally broke
    // the hand-transcribed regex this task replaces — must also be recognised now.
    expect(SELECTION_REASONS).toContain("tree-scan-oracle");
    expect(isSelectionReason("tree-scan-oracle")).toBe(true);
    // ERROR-adjacent: isSelectionReason is a total function over `string` — it never
    // throws for a malformed/empty/unexpected input, only ever returns false.
    expect(isSelectionReason("")).toBe(false);
    expect(isSelectionReason("CHANGED-TEST")).toBe(false); // case-sensitive, not normalized
  });

  it("REGRESSION: --list never spawns vitest or bun test (accounting-only, no runner subprocess side effects) — verified by absence of a runner's own summary output", () => {
    const result = Bun.spawnSync(["bun", "scripts/changed-tests.ts", "--list", "HEAD"], {
      cwd: REPO_ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = result.stdout.toString("utf8");
    expect(result.exitCode).toBe(0);
    // vitest's own summary line format ("Test Files"/"Tests ") and bun test's own
    // ("pass"/"fail" summary footer) must be absent — proof --list did not execute.
    expect(stdout).not.toMatch(/Test Files\s+\d+/);
    expect(stdout).not.toMatch(/\d+ pass\n\d+ fail/);
  });

  it("ERROR: an unresolvable base ref fails loud (non-zero exit, no silent empty selection)", () => {
    const result = Bun.spawnSync(["bun", "scripts/changed-tests.ts", "--list", "this-ref-does-not-exist-12345"], {
      cwd: REPO_ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.exitCode).not.toBe(0);
    const stderr = result.stderr.toString("utf8");
    expect(stderr).toMatch(/changed-tests: \[git\]/);
  });
});

describe("getChangedFiles porcelain-path parsing — modified (' M') files are not corrupted (SPEC-104 fallout T2)", () => {
  /**
   * Isolated synthetic repo (mkdtemp, NEVER this repo's own git state) — a
   * minimal two-package scaffold matching what `loadFileMap`/
   * `loadCoreAliasMap` require: `packages/core/package.json` (the exports
   * SSOT `loadCoreAliasMap` unconditionally reads on every invocation) plus
   * one `packages/lore/src` file and its `packages/lore/tests` consumer,
   * wired by a real relative import so the reverse-dependency BFS has an
   * edge to walk. `--list HEAD` (as in the suite above) keeps the git diff
   * itself empty (`HEAD...HEAD`), so selection is driven ONLY by `git status
   * --porcelain`'s report of the uncommitted, UNSTAGED modification made
   * below — the exact ` M `-prefixed line shape the porcelain-parser bug
   * corrupts (a leading-space status line, trimmed before its fixed 3-char
   * offset slice, loses the path's first character).
   */
  function makeFixtureRepo(): string {
    const root = mkdtempSync(join(tmpdir(), "lore-changed-tests-porcelain-"));
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("git", ["config", "user.email", "porcelain-fixture@example.com"], { cwd: root });
    execFileSync("git", ["config", "user.name", "Porcelain Fixture"], { cwd: root });

    mkdirSync(join(root, "packages", "core"), { recursive: true });
    writeFileSync(
      join(root, "packages", "core", "package.json"),
      JSON.stringify({ exports: { ".": "./src/index.ts", "./node": "./src/node.ts" } }),
    );
    mkdirSync(join(root, "packages", "lore", "src"), { recursive: true });
    mkdirSync(join(root, "packages", "lore", "tests"), { recursive: true });
    writeFileSync(join(root, "packages", "lore", "src", "thing.ts"), "export const thing = 1;\n");
    writeFileSync(
      join(root, "packages", "lore", "tests", "thing.test.ts"),
      'import { thing } from "../src/thing.js";\nexport const _use = thing;\n',
    );

    execFileSync("git", ["add", "-A"], { cwd: root });
    execFileSync("git", ["commit", "-q", "-m", "seed"], { cwd: root });

    // Unstaged modification — `git status --porcelain` reports this as
    // ` M packages/lore/src/thing.ts` (leading space + M + space, then the
    // path): exactly the shape the parser-order bug corrupts.
    writeFileSync(join(root, "packages", "lore", "src", "thing.ts"), "export const thing = 2;\n");

    return root;
  }

  it("REGRESSION: a modified-unstaged (' M') source file's test consumer is selected, not silently dropped", () => {
    const fixtureRoot = makeFixtureRepo();
    try {
      const result = Bun.spawnSync(["bun", join(REPO_ROOT, "scripts", "changed-tests.ts"), "--list", "HEAD"], {
        cwd: fixtureRoot,
        stdout: "pipe",
        stderr: "pipe",
      });

      const stdout = result.stdout.toString("utf8");
      const stderr = result.stderr.toString("utf8");
      expect(result.exitCode, `expected exit 0, stderr:\n${stderr}`).toBe(0);

      // The modified src file's own reverse-dependent test must show up in
      // the vitest accounting — proof the ' M'-prefixed path survived intact.
      // A corrupted path fails `fileMap.has()` and vanishes SILENTLY:
      // "vitest: selected 0", no WARNING line (`zeroSelectionWarning` only
      // fires when >=1 KNOWN-changed file selected zero tests — a dropped,
      // unrecognized path never becomes "known-changed" in the first place).
      expect(stdout).toMatch(/^vitest: selected [1-9]\d*$/m);
      expect(stdout).toContain("packages/lore/tests/thing.test.ts");
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });
});

describe("AC-TC-4: hooks-only and assets-only change sets select both pre-push guards", () => {
  /**
   * The two repo-relative paths the real pre-push guard suites occupy —
   * `packages/lore/tests/unit/assets/pre-push-parity.test.ts` and
   * `packages/lore/tests/integration/pre-push-trip.bun.test.ts`. This fixture
   * reproduces them at the SAME paths (never the real files themselves — this
   * task's file anchors do not include them) so the selector's real-repo
   * `loadFileMap` walk (`packages/*\/tests/**\/*.ts`) picks them up exactly as
   * it would in production.
   */
  const PARITY_TEST_RELATIVE = "packages/lore/tests/unit/assets/pre-push-parity.test.ts";
  const TRIP_TEST_RELATIVE = "packages/lore/tests/integration/pre-push-trip.bun.test.ts";

  /**
   * Fixture content for the two guard tests. Each one carries the SAME
   * `hooks/pre-push` / `assets/project/pre-push` literal substrings the real
   * suites already contain, UNEDITED, in their own doc comments and path
   * constants (verified by `grep -n 'hooks/pre-push\|assets/project/pre-push'`
   * against both real files before this task changed anything) — this is not
   * a marker manufactured for this fixture, it reproduces the membership
   * signal `scripts/changed-tests.ts` must recognize in the PRODUCTION files
   * without this task ever touching them (out of its file anchors).
   */
  const FIXTURE_PARITY_TEST_CONTENT = [
    "// Fixture stand-in for packages/lore/tests/unit/assets/pre-push-parity.test.ts",
    "// Real suite compares hooks/pre-push against assets/project/pre-push byte-for-byte.",
    'import { describe, it, expect } from "vitest";',
    'describe("pre-push hook pair fixture", () => {',
    '  it("stands in for the real parity suite", () => {',
    '    expect("hooks/pre-push").toBeTruthy();',
    '    expect("assets/project/pre-push").toBeTruthy();',
    "  });",
    "});",
    "",
  ].join("\n");

  const FIXTURE_TRIP_TEST_CONTENT = [
    "// Fixture stand-in for packages/lore/tests/integration/pre-push-trip.bun.test.ts",
    "// Real suite drives hooks/pre-push (repo copy) and assets/project/pre-push (shipped copy).",
    'import { describe, it, expect } from "bun:test";',
    'describe("pre-push trip fixture", () => {',
    '  it("stands in for the real trip suite", () => {',
    '    expect("hooks/pre-push").toBeTruthy();',
    '    expect("assets/project/pre-push").toBeTruthy();',
    "  });",
    "});",
    "",
  ].join("\n");

  /**
   * Builds a synthetic repo (mkdtemp, NEVER this repo's own git state) with:
   * `packages/core/package.json` (the exports SSOT `loadCoreAliasMap`
   * unconditionally reads), one real `packages/lore/src`/`packages/lore/tests`
   * reverse-dependency pair (the "some OTHER matched file" the mixed-case
   * scenarios change alongside the hook/asset edit), a `hooks/pre-push` file,
   * an `assets/project/pre-push` file, and the two fixture guard tests above
   * at their real repo-relative paths. Everything is committed once; each
   * `it` below applies its own uncommitted diff on top via `git status
   * --porcelain` (same pattern as the porcelain-parsing suite above).
   */
  function makeHookAssetFixtureRepo(): string {
    const root = mkdtempSync(join(tmpdir(), "lore-changed-tests-hooks-assets-"));
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("git", ["config", "user.email", "hooks-assets-fixture@example.com"], { cwd: root });
    execFileSync("git", ["config", "user.name", "Hooks Assets Fixture"], { cwd: root });

    mkdirSync(join(root, "packages", "core"), { recursive: true });
    writeFileSync(
      join(root, "packages", "core", "package.json"),
      JSON.stringify({ exports: { ".": "./src/index.ts", "./node": "./src/node.ts" } }),
    );

    mkdirSync(join(root, "packages", "lore", "src"), { recursive: true });
    mkdirSync(join(root, "packages", "lore", "tests"), { recursive: true });
    writeFileSync(join(root, "packages", "lore", "src", "unrelated-thing.ts"), "export const unrelatedThing = 1;\n");
    writeFileSync(
      join(root, "packages", "lore", "tests", "unrelated-thing.test.ts"),
      'import { unrelatedThing } from "../src/unrelated-thing.js";\nexport const _use = unrelatedThing;\n',
    );

    mkdirSync(join(root, "packages", "lore", "tests", "unit", "assets"), { recursive: true });
    writeFileSync(join(root, PARITY_TEST_RELATIVE), FIXTURE_PARITY_TEST_CONTENT);
    mkdirSync(join(root, "packages", "lore", "tests", "integration"), { recursive: true });
    writeFileSync(join(root, TRIP_TEST_RELATIVE), FIXTURE_TRIP_TEST_CONTENT);

    mkdirSync(join(root, "hooks"), { recursive: true });
    writeFileSync(join(root, "hooks", "pre-push"), "#!/bin/sh\necho fixture hook v1\n");
    mkdirSync(join(root, "assets", "project"), { recursive: true });
    writeFileSync(join(root, "assets", "project", "pre-push"), "#!/bin/sh\necho fixture hook v1\n");

    execFileSync("git", ["add", "-A"], { cwd: root });
    execFileSync("git", ["commit", "-q", "-m", "seed"], { cwd: root });

    return root;
  }

  /** Runs `--list HEAD` against `fixtureRoot` and returns exit code + stdout/stderr. */
  function runListAgainst(fixtureRoot: string): { exitCode: number; stdout: string; stderr: string } {
    const result = Bun.spawnSync(["bun", join(REPO_ROOT, "scripts", "changed-tests.ts"), "--list", "HEAD"], {
      cwd: fixtureRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    return {
      exitCode: result.exitCode,
      stdout: result.stdout.toString("utf8"),
      stderr: result.stderr.toString("utf8"),
    };
  }

  /**
   * Both guard tests, tagged with their expected `(tree-scan-oracle)` reason —
   * asserting the reason tag (not merely path presence) rules out the guard
   * showing up for an unrelated reason (e.g. `transitive`) that would not
   * actually prove the hooks/assets scope fix.
   */
  function expectBothGuardsSelected(stdout: string): void {
    expect(stdout, `expected the parity guard in:\n${stdout}`).toContain(`${PARITY_TEST_RELATIVE} (tree-scan-oracle)`);
    expect(stdout, `expected the trip guard in:\n${stdout}`).toContain(`${TRIP_TEST_RELATIVE} (tree-scan-oracle)`);
  }

  it("PURE hooks-only change set selects both pre-push guards", () => {
    const fixtureRoot = makeHookAssetFixtureRepo();
    try {
      writeFileSync(join(fixtureRoot, "hooks", "pre-push"), "#!/bin/sh\necho fixture hook v2 — hooks-only edit\n");

      const { exitCode, stdout, stderr } = runListAgainst(fixtureRoot);
      expect(exitCode, `expected exit 0, stderr:\n${stderr}\nstdout:\n${stdout}`).toBe(0);
      expectBothGuardsSelected(stdout);
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("PURE assets-only change set selects both pre-push guards", () => {
    const fixtureRoot = makeHookAssetFixtureRepo();
    try {
      writeFileSync(join(fixtureRoot, "assets", "project", "pre-push"), "#!/bin/sh\necho fixture hook v2 — assets-only edit\n");

      const { exitCode, stdout, stderr } = runListAgainst(fixtureRoot);
      expect(exitCode, `expected exit 0, stderr:\n${stderr}\nstdout:\n${stdout}`).toBe(0);
      expectBothGuardsSelected(stdout);
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("MIXED hooks + another matched file still selects both pre-push guards (the dangerous case: selection is already non-empty from the OTHER file)", () => {
    const fixtureRoot = makeHookAssetFixtureRepo();
    try {
      writeFileSync(join(fixtureRoot, "hooks", "pre-push"), "#!/bin/sh\necho fixture hook v2 — mixed edit\n");
      writeFileSync(join(fixtureRoot, "packages", "lore", "src", "unrelated-thing.ts"), "export const unrelatedThing = 2;\n");

      const { exitCode, stdout, stderr } = runListAgainst(fixtureRoot);
      expect(exitCode, `expected exit 0, stderr:\n${stderr}\nstdout:\n${stdout}`).toBe(0);
      // The OTHER file's own selection must still be present — this is what
      // makes the case "already non-empty" before the guards are considered.
      expect(stdout).toContain("packages/lore/tests/unrelated-thing.test.ts");
      // And the two guards must ALSO be present — a selector that silences
      // loud-zero via the unrelated file while still omitting the guards is
      // exactly the false green this AC exists to exclude.
      expectBothGuardsSelected(stdout);
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("MIXED assets + another matched file still selects both pre-push guards", () => {
    const fixtureRoot = makeHookAssetFixtureRepo();
    try {
      writeFileSync(join(fixtureRoot, "assets", "project", "pre-push"), "#!/bin/sh\necho fixture hook v2 — mixed edit\n");
      writeFileSync(join(fixtureRoot, "packages", "lore", "src", "unrelated-thing.ts"), "export const unrelatedThing = 2;\n");

      const { exitCode, stdout, stderr } = runListAgainst(fixtureRoot);
      expect(exitCode, `expected exit 0, stderr:\n${stderr}\nstdout:\n${stdout}`).toBe(0);
      expect(stdout).toContain("packages/lore/tests/unrelated-thing.test.ts");
      expectBothGuardsSelected(stdout);
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });
});

describe("AC-TC-5: the hooks/assets marker is pinned against the two REAL guard files, not only fixture stand-ins (task-make-tree-scan-scopes-additive-instead-of-pre-emptive-and)", () => {
  /**
   * The AC-TC-4 suite above proves the classifier recognizes the marker
   * using FIXTURE strings that merely reproduce the real suites' literal
   * substrings — it never reads the real files, so a future edit that
   * accidentally rewords `packages/lore/tests/unit/assets/pre-push-parity
   * .test.ts` or `packages/lore/tests/integration/pre-push-trip.bun.test.ts`
   * out of matching `HOOK_OR_ASSET_PAIR_MARKER_RE` would go undetected by any
   * test in this repo. This block closes that gap by reading the two REAL,
   * checked-out files from disk and asserting the PRODUCTION regex — and the
   * production classifier built on it — actually recognizes them.
   */
  const REAL_PARITY_TEST_PATH = "packages/lore/tests/unit/assets/pre-push-parity.test.ts";
  const REAL_TRIP_TEST_PATH = "packages/lore/tests/integration/pre-push-trip.bun.test.ts";

  it("HAPPY: HOOK_OR_ASSET_PAIR_MARKER_RE matches the REAL pre-push-parity.test.ts content read from disk", () => {
    const content = readFileSync(join(REPO_ROOT, REAL_PARITY_TEST_PATH), "utf8");
    expect(HOOK_OR_ASSET_PAIR_MARKER_RE.test(content)).toBe(true);
  });

  it("HAPPY: HOOK_OR_ASSET_PAIR_MARKER_RE matches the REAL pre-push-trip.bun.test.ts content read from disk", () => {
    const content = readFileSync(join(REPO_ROOT, REAL_TRIP_TEST_PATH), "utf8");
    expect(HOOK_OR_ASSET_PAIR_MARKER_RE.test(content)).toBe(true);
  });

  it("REGRESSION: classifyTreeScanningOracle on the REAL pre-push-parity.test.ts keeps BOTH its prior repo-tracked-text-source scope AND hooks-and-assets-pair — never narrowed to hooks-and-assets-pair alone", () => {
    const content = readFileSync(join(REPO_ROOT, REAL_PARITY_TEST_PATH), "utf8");
    const scopes = classifyTreeScanningOracle(REAL_PARITY_TEST_PATH, content);
    expect(scopes).toEqual(new Set(["repo-tracked-text-source", "hooks-and-assets-pair"]));
  });

  it("HAPPY: classifyTreeScanningOracle on the REAL pre-push-trip.bun.test.ts classifies as hooks-and-assets-pair (this file has no bare main() call, so it never had a prior tree-scan scope to retain)", () => {
    const content = readFileSync(join(REPO_ROOT, REAL_TRIP_TEST_PATH), "utf8");
    const scopes = classifyTreeScanningOracle(REAL_TRIP_TEST_PATH, content);
    expect(scopes).toEqual(new Set(["hooks-and-assets-pair"]));
  });
});
