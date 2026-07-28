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
import { resolve } from "node:path";

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
