// @reads packages/core/src/oracle-file-existence.ts
// @reads assets/governance/write-spec-rule.md
// @reads assets/project/lore-config-template.yaml
// @reads packages/core/src/acceptance.ts
// @reads packages/lore/src/service/ac-service.ts
// @reads packages/lore/src/adapters/cli/commands/ac.ts
// @reads packages/lore/src/adapters/cli/commands/status.ts
// @reads packages/lore/src/service/task-workflow-service.ts
// @reads scripts/check-unclaimed-oracle.ts
/**
 * AC-EI-2 — a missing oracle is not measured, whatever it is and whatever ran before
 * (spec-evidence-identity-an-attested-row-counts-only-for-the; AC-TG-6's text never had TG-22's narrowing; AS-17).
 *
 * Drives the REAL command surfaces in a THROWAWAY corpus (mkdtemp + `lore init`, HOME and cwd inside it —
 * never this repository's own `.lore/`). Exit codes are asserted exactly; every assertion reads a rendered
 * surface (`lore ac list` text and --json, `lore ac add` stderr).
 *
 * Halves (spec text, AC-EI-2):
 *   (1) a script-path AC (`sh scripts/ok-one.sh`) whose script is deleted after an attested pass renders
 *       not_measured naming the path;
 *   (2) control: the same shape with the script present renders attested_pass;
 *   (3) a test-path AC whose missing file was never the file an earlier pass was about (two-file command, one
 *       file deleted, the surviving one still exists) also renders not_measured (the TG-22 case);
 *   (4) `lore ac add` with a missing script path and no --allow-missing-path exits 4 naming the path (control:
 *       with the escape it exits 0);
 *   (6) `lore verify` of a missing script or test path exits 3 naming it and records inconclusive;
 *   (7) `lore status` (--json, text, --enumerate) names each missing-oracle AC with its path;
 *   (5) a segment the extractor cannot classify is listed in --json as oracle_paths_unchecked and counted on
 *       the text line as "N segment(s) not checked"; a fully classified command shows neither.
 *
 * Dimensions: HAPPY (2), NEGATIVE (1, 3), BOUNDARY (3), ERROR (4), STATE (1: present then deleted), REGRESSION (5).
 *
 * @spec_ref spec-evidence-identity-an-attested-row-counts-only-for-the
 */

import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { runLoreInProcess } from "../../helpers/run-lore-in-process";

vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 });

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

async function runLore(args: string[]): Promise<RunResult> {
  const proc = await runLoreInProcess(args, {
    cwd: dir,
    home: dir,
    env: { ...process.env, HOME: dir, EDITOR: "true", LORE_ACTOR: "agent:missing-oracle-any-path-test" },
  });
  return { stdout: proc.stdout, stderr: proc.stderr, exitCode: proc.exitCode };
}

/** Fixture step: throws (never asserts) so a setup failure cannot pass for the behaviour under test. */
async function mustRun(args: string[]): Promise<RunResult> {
  const result = await runLore(args);
  if (result.exitCode !== 0) {
    throw new Error(`FIXTURE FAILURE - \`lore ${args.join(" ")}\` exited ${result.exitCode}: ${result.stderr || result.stdout}`);
  }
  return result;
}

interface CoverageFactJson {
  readonly ac_id: string;
  readonly attested_pass: number;
  readonly state: string;
  readonly oracle_file_missing?: readonly string[];
  readonly oracle_paths_unchecked?: readonly string[];
}

async function coverageOf(acId: string): Promise<CoverageFactJson> {
  const result = await runLore(["ac", "list", SPEC, "--json"]);
  expect(result.exitCode, result.stderr).toBe(0);
  const data = (JSON.parse(result.stdout) as { data: { coverage: CoverageFactJson[] | null } }).data;
  const fact = data.coverage?.find((f) => f.ac_id === acId);
  if (fact === undefined) throw new Error(`no coverage fact for ${acId}`);
  return fact;
}

async function lastEvidenceResult(): Promise<string | undefined> {
  const result = await runLore(["get", TASK, "--json"]);
  expect(result.exitCode, result.stderr).toBe(0);
  const rows = (JSON.parse(result.stdout) as { data: { doc: { extra: { verification_evidence?: Array<{ result: string }> } } } }).data.doc.extra
    .verification_evidence ?? [];
  return rows[rows.length - 1]?.result;
}

async function textLineOf(acId: string): Promise<string> {
  const result = await runLore(["ac", "list", SPEC]);
  expect(result.exitCode, result.stderr).toBe(0);
  const lines = result.stdout.split("\n").filter((l) => l.includes(`${acId} —`));
  if (lines.length !== 1) throw new Error(`expected 1 line for ${acId}, got ${lines.length}:\n${result.stdout}`);
  return lines[0] as string;
}

const SPEC = "spec-ei2-spec";
const PLAN = "plan-ei2-plan";
const TASK = "task-ei2-task";
let dir: string;

async function addScriptAc(id: string, command: string): Promise<void> {
  await mustRun(
    ["ac", "add", SPEC, id, "--statement", `${id} holds in the throwaway corpus.`, "--mode", "script", "--oracle", "other", "--command", command],
  );
}

async function verifyAc(acId: string): Promise<RunResult> {
  return runLore(["verify", PLAN, "--task", TASK, "--yes", "--ac", acId]);
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "lore-missing-oracle-any-path-"));
  mkdirSync(join(dir, "scripts"), { recursive: true });
  writeFileSync(join(dir, "scripts", "ok-one.sh"), "echo one-ok\n");
  writeFileSync(join(dir, "scripts", "ok-two.sh"), "echo two-ok\n");
  writeFileSync(join(dir, "a.test.ts"), 'import { test, expect } from "bun:test";\ntest("a", () => expect(1).toBe(1));\n');
  writeFileSync(join(dir, "b.test.ts"), 'import { test, expect } from "bun:test";\ntest("b", () => expect(1).toBe(1));\n');
  await mustRun(["init"]);
  await mustRun(["create", "prd", "--title", "EI2 PRD", "--no-ai", "--content", "## Overview\nbody"]);
  await mustRun(["create", "spec", "--title", "EI2 Spec", "--no-ai", "--content", "## Overview\nbody"]);
  await addScriptAc("AC-EI2-A", "sh scripts/ok-one.sh");
  await addScriptAc("AC-EI2-B", "sh scripts/ok-two.sh");
  await addScriptAc("AC-EI2-C", "bun test a.test.ts b.test.ts");
  await addScriptAc("AC-EI2-U", "python3 check.py && echo done");
  await mustRun(["create", "plan", "--title", "EI2 Plan", "--parent", SPEC, "--no-ai", "--content", "body"]);
  await mustRun([
    "create", "task", "--kind", "code", "--title", "EI2 Task", "--parent", PLAN, "--plan-id", PLAN, "--no-ai", "--content", "body",
    "--ac-scope", "AC-EI2-A", "--ac-scope", "AC-EI2-B", "--ac-scope", "AC-EI2-C",
  ]);
}, 240_000);

afterAll(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore cleanup errors */
  }
});

describe("AC-EI-2 half 2 (HAPPY control): a script-path AC with the script present renders attested_pass", () => {
  it("lore verify of AC-EI2-B exits 0 and AC-EI2-B is attested_pass with nothing missing and nothing unchecked", async () => {
    const verified = await verifyAc("AC-EI2-B");
    expect(verified.exitCode, verified.stderr + verified.stdout).toBe(0);
    const fact = await coverageOf("AC-EI2-B");
    expect(fact.state).toBe("attested_pass");
    expect(fact.oracle_file_missing).toEqual([]);
    expect(fact.oracle_paths_unchecked).toEqual([]);
    const line = await textLineOf("AC-EI2-B");
    expect(line).not.toContain("oracle_file_missing");
    expect(line).not.toContain("not checked");
  });
});

describe("AC-EI-2 half 1 (NEGATIVE/STATE): a script deleted after an attested pass is not measured", () => {
  it("AC-EI2-A is attested_pass, then not_measured naming scripts/ok-one.sh once the script is gone", async () => {
    const verified = await verifyAc("AC-EI2-A");
    expect(verified.exitCode, verified.stderr + verified.stdout).toBe(0);
    expect((await coverageOf("AC-EI2-A")).state).toBe("attested_pass");

    rmSync(join(dir, "scripts", "ok-one.sh"));

    const fact = await coverageOf("AC-EI2-A");
    expect(fact.state).toBe("not_measured");
    expect(fact.oracle_file_missing).toEqual(["scripts/ok-one.sh"]);
    expect(await textLineOf("AC-EI2-A")).toContain("scripts/ok-one.sh");
  });
});

describe("AC-EI-2 half 3 (NEGATIVE/BOUNDARY): a missing test file is not measured although the surviving file was run", () => {
  it("AC-EI2-C is attested_pass, then not_measured naming b.test.ts once only b.test.ts is deleted", async () => {
    const verified = await verifyAc("AC-EI2-C");
    expect(verified.exitCode, verified.stderr + verified.stdout).toBe(0);
    expect((await coverageOf("AC-EI2-C")).state).toBe("attested_pass");

    rmSync(join(dir, "b.test.ts"));

    const fact = await coverageOf("AC-EI2-C");
    expect(fact.state).toBe("not_measured");
    expect(fact.oracle_file_missing).toEqual(["b.test.ts"]);
  });
});

describe("AC-EI-2 half 6 (STATE): lore verify records not-measured for a missing script or test path, never pass/fail", () => {
  it("verify of AC-EI2-A (script gone) exits 3, names scripts/ok-one.sh, and the last recorded result is inconclusive", async () => {
    const verified = await verifyAc("AC-EI2-A");
    expect(verified.exitCode, verified.stdout + verified.stderr).toBe(3);
    expect(verified.stdout + verified.stderr).toContain("scripts/ok-one.sh");
    expect(verified.stdout + verified.stderr).toContain("NOT MEASURED");
    expect(await lastEvidenceResult()).toBe("inconclusive");
    expect((await coverageOf("AC-EI2-A")).state).toBe("not_measured");
  });

  it("verify of AC-EI2-C (test path b.test.ts gone) exits 3 naming b.test.ts and records inconclusive", async () => {
    const verified = await verifyAc("AC-EI2-C");
    expect(verified.exitCode, verified.stdout + verified.stderr).toBe(3);
    expect(verified.stdout + verified.stderr).toContain("b.test.ts");
    expect(await lastEvidenceResult()).toBe("inconclusive");
  });
});

describe("AC-EI-2 half 7 (REGRESSION): lore status names each AC with a missing oracle path", () => {
  it("status --json lists both missing-oracle ACs with their paths and counts them; the text report names them too", async () => {
    const json = await runLore(["status", "--json"]);
    expect(json.exitCode, json.stderr).toBe(0);
    const data = (JSON.parse(json.stdout) as { data: { ac_oracle_file_missing_count: number; ac_oracle_file_missing: string[] } }).data;
    expect(data.ac_oracle_file_missing).toContain(`${SPEC}#AC-EI2-A: scripts/ok-one.sh`);
    expect(data.ac_oracle_file_missing).toContain(`${SPEC}#AC-EI2-C: b.test.ts`);
    expect(data.ac_oracle_file_missing_count).toBe(data.ac_oracle_file_missing.length);
    expect(data.ac_oracle_file_missing.some((m) => m.startsWith(`${SPEC}#AC-EI2-B`))).toBe(false);

    const counted = await runLore(["status"]);
    expect(counted.exitCode, counted.stderr).toBe(0);
    expect(counted.stdout).toContain("Criteria with a missing oracle file:");
    expect(counted.stdout).not.toContain(`${SPEC}#AC-EI2-A: scripts/ok-one.sh`);
    expect(counted.stdout).toContain("lore status --detail");

    const text = await runLore(["status", "--detail"]);
    expect(text.exitCode, text.stderr).toBe(0);
    expect(text.stdout).toContain("Criteria with a missing oracle file:");
    expect(text.stdout).toContain(`${SPEC}#AC-EI2-A: scripts/ok-one.sh`);

    const enumerated = await runLore(["status", "--enumerate", "ac_oracle_file_missing_count"]);
    expect(enumerated.exitCode, enumerated.stderr).toBe(0);
    expect(enumerated.stdout).toContain("scripts/ok-one.sh");
  });
});

describe("AC-EI-2 half 4 (ERROR): lore ac add refuses a missing script path", () => {
  it("exits 4 naming scripts/nope.sh without --allow-missing-path; exits 0 with it", async () => {
    const refused = await runLore([
      "ac", "add", SPEC, "AC-EI2-R", "--statement", "Refusal control.", "--mode", "script", "--oracle", "other", "--command", "sh scripts/nope.sh",
    ]);
    expect(refused.exitCode, refused.stderr + refused.stdout).toBe(4);
    expect(refused.stderr).toContain("scripts/nope.sh");

    const allowed = await runLore([
      "ac", "add", SPEC, "AC-EI2-R", "--statement", "Refusal control.", "--mode", "script", "--oracle", "other", "--command", "sh scripts/nope.sh",
      "--allow-missing-path", "script lands with the implementing task",
    ]);
    expect(allowed.exitCode, allowed.stderr + allowed.stdout).toBe(0);
  });
});

describe("AC-EI-2 half 5 (REGRESSION): an unclassifiable segment is listed, never read as checked-clean", () => {
  it("--json lists the segment as oracle_paths_unchecked and the text line counts it", async () => {
    const fact = await coverageOf("AC-EI2-U");
    expect(fact.oracle_paths_unchecked).toEqual(["python3 check.py"]);
    expect(await textLineOf("AC-EI2-U")).toContain("1 segment(s) not checked");
  });
});

describe("AC-EI-2 half 8 (NEGATIVE/BOUNDARY): a missing oracle is not measured even with ZERO evidence rows (EI-6)", () => {
  it("a test-path AC whose file is missing and that has no evidence renders not_measured naming the path (--json and text)", async () => {
    // reason: NOT declared --allow-missing-path. AC-TG-6 reads a DECLARED red-first AC with no pass on record as none; this case is the
    // undeclared one (EI-6), so the file exists when the AC is added and is deleted before it is read.
    const oracle = join(dir, "never-written.test.ts");
    writeFileSync(oracle, 'import { test, expect } from "bun:test";\ntest("n", () => expect(1).toBe(1));\n');
    await mustRun([
      "ac", "add", SPEC, "AC-EI2-N", "--statement", "Never-run criterion whose oracle file is missing.", "--mode", "script", "--oracle", "test",
      "--command", "bun test never-written.test.ts",
    ]);
    rmSync(oracle);
    const fact = await coverageOf("AC-EI2-N");
    expect(fact.state).toBe("not_measured");
    expect(fact.oracle_file_missing).toEqual(["never-written.test.ts"]);
    expect(await textLineOf("AC-EI2-N")).toContain("never-written.test.ts");
  });

  it("control: a present oracle with no evidence stays none", async () => {
    await mustRun([
      "ac", "add", SPEC, "AC-EI2-P", "--statement", "Never-run criterion whose oracle file exists.", "--mode", "script", "--oracle", "test",
      "--command", "bun test a.test.ts",
    ]);
    const fact = await coverageOf("AC-EI2-P");
    expect(fact.state).toBe("none");
    expect(fact.oracle_file_missing).toEqual([]);
  });
});
