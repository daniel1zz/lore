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

import { describe, expect, it } from "bun:test";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

const REPO_ROOT = resolve(import.meta.dir, "../../../../..");

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

  it("HAPPY: at least one reason tag is printed for a selected file (this suite's own new test files are uncommitted changed-test entries)", () => {
    const result = Bun.spawnSync(["bun", "scripts/changed-tests.ts", "--list", "HEAD"], {
      cwd: REPO_ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = result.stdout.toString("utf8");
    expect(result.exitCode).toBe(0);
    // reason tags are rendered as "(changed-test)" / "(transitive)" / "(binary-consumer)"
    // on a per-file line — assert at least one of the three appears somewhere in the
    // accounting block (mandatory accounting, D3 — never a bare count with no detail
    // when something was actually selected).
    const selectedAny = /^vitest: selected [1-9]/m.test(stdout) || /^bun: selected [1-9]/m.test(stdout);
    if (selectedAny) {
      expect(stdout).toMatch(/\((changed-test|transitive|binary-consumer)\)/);
    }
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
