// @spawns packages/lore/src/index.ts
/**
 * RED test for the CLI surface of the captured-red proof (AC-EH-9 d; issue #53;
 * BR-1077, BR-152; spec-evidence-labels-and-reds-are-honest D8-D10).
 *
 * Drives the REAL CLI (`bun run src/index.ts`, subprocess) in a THROWAWAY corpus
 * (mkdtemp + `lore init`, cwd and HOME inside it — never this repo's own `.lore/`).
 *
 * Today `lore evidence <task> --oracle test --command 'cd /nonexistent && true'
 * --result expected-fail --capture` is ACCEPTED (exit 0, a row recorded): any
 * non-zero exit clears the red-first floor. The paired implement task wires
 * `findCapturedRedProofGap` into commands/evidence.ts; the refusal is exit 4 with
 * no row. Each case fails on an ASSERTION (exit code / row count), not on setup:
 * fixture steps throw a distinct FIXTURE FAILURE error.
 *
 * Dimensions: ERROR (d: refusal + nothing written), HAPPY (a printed runner failure
 * summary is recorded — D8 known limit), BOUNDARY (exit 127 refused even for
 * oracle other), REGRESSION (capture false unaffected).
 *
 * @spec_ref spec-evidence-labels-and-reds-are-honest
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "child_process";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const PACKAGE_ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

function runLore(args: string[], cwd: string): RunResult {
  const result = spawnSync("bun", ["run", INDEX_TS, ...args], {
    cwd,
    env: { ...process.env, HOME: cwd, EDITOR: "true", CLAUDECODE: "1" },
    encoding: "utf8",
  });
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", exitCode: result.status ?? 1 };
}

/** Fixture step: throws (never asserts) so a setup failure cannot pass for the red under test. */
function mustRun(args: string[], cwd: string): RunResult {
  const result = runLore(args, cwd);
  if (result.exitCode !== 0) {
    throw new Error(
      `FIXTURE FAILURE (not the assertion under test) - \`lore ${args.join(" ")}\` exited ${result.exitCode}: ${result.stderr || result.stdout}`,
    );
  }
  return result;
}

interface Row {
  readonly oracle: string;
  readonly result: string;
  readonly command: string;
  readonly output_tail?: string;
}

function readRows(slug: string, cwd: string): Row[] {
  const got = mustRun(["get", slug, "--json"], cwd);
  const parsed = JSON.parse(got.stdout) as { data: { doc: { extra?: { verification_evidence?: Row[] } } } };
  return parsed.data.doc.extra?.verification_evidence ?? [];
}

let tmpDir: string;
let slug: string;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "lore-evidence-captured-red-cli-"));
  mustRun(["init"], tmpDir);
  mustRun(["create", "prd", "--title", "Captured red root", "--content", "## Overview\nroot", "--no-ai"], tmpDir);
  const created = mustRun(
    ["create", "task", "--title", "captured red task", "--adhoc", "--ac-scope", "", "--content", "body", "--no-ai", "--json"],
    tmpDir,
  );
  slug = (JSON.parse(created.stdout) as { data: { slug: string } }).data.slug;
}, 60_000);

afterAll(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore cleanup errors */
  }
});

describe("lore evidence --capture refuses a broken-command red (spec-evidence-labels-and-reds-are-honest#AC-EH-9 d)", () => {
  it("ERROR (d): test + expected-fail + `cd /nonexistent-dir-for-red && true` exits exactly 4 and writes no row", { timeout: 60_000 }, () => {
    const before = readRows(slug, tmpDir).length;
    const run = runLore(
      ["evidence", slug, "--oracle", "test", "--command", "cd /nonexistent-dir-for-red && true", "--result", "expected-fail", "--capture"],
      tmpDir,
    );
    expect(run.exitCode, `stdout=${run.stdout} stderr=${run.stderr}`).toBe(4);
    expect(readRows(slug, tmpDir)).toHaveLength(before);
  });

  it("BOUNDARY: oracle other + fail + `exit 127` exits exactly 4, names 127, writes no row", { timeout: 60_000 }, () => {
    const before = readRows(slug, tmpDir).length;
    const run = runLore(
      ["evidence", slug, "--oracle", "other", "--command", "exit 127", "--result", "fail", "--capture"],
      tmpDir,
    );
    expect(run.exitCode, `stdout=${run.stdout} stderr=${run.stderr}`).toBe(4);
    expect(run.stderr + run.stdout).toContain("127");
    expect(readRows(slug, tmpDir)).toHaveLength(before);
  });

  it("BOUNDARY: exit 127 WITH output (a real 'command not found' line) exits exactly 4, names 127, writes no row", { timeout: 60_000 }, () => {
    const before = readRows(slug, tmpDir).length;
    const run = runLore(
      ["evidence", slug, "--oracle", "other", "--command", "printf 'sh: nope: command not found\\n'; exit 127", "--result", "fail", "--capture"],
      tmpDir,
    );
    expect(run.exitCode, `stdout=${run.stdout} stderr=${run.stderr}`).toBe(4);
    expect(run.stderr + run.stdout).toContain("127");
    expect(readRows(slug, tmpDir)).toHaveLength(before);
  });

  it("HAPPY (D8 known limit): test + expected-fail + a printed vitest failure line + exit 1 is recorded", { timeout: 60_000 }, () => {
    const before = readRows(slug, tmpDir).length;
    const run = runLore(
      ["evidence", slug, "--oracle", "test", "--command", "printf 'Tests  1 failed (1)\\n'; exit 1", "--result", "expected-fail", "--capture"],
      tmpDir,
    );
    expect(run.exitCode, `stdout=${run.stdout} stderr=${run.stderr}`).toBe(0);
    const rows = readRows(slug, tmpDir);
    expect(rows).toHaveLength(before + 1);
    expect(rows[rows.length - 1]?.result).toBe("expected-fail");
  });
});
