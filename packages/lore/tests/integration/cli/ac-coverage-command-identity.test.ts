// @reads scripts/check-unclaimed-oracle.ts
// @reads assets/project/lore-config-template.yaml
// @reads packages/core/src/acceptance.ts
// @reads packages/lore/src/service/ac-service.ts
// @reads packages/lore/src/adapters/cli/commands/ac.ts
// @reads packages/lore/src/adapters/cli/commands/status.ts
// @reads scripts/export-spec-mirror.ts
// @reads packages/lore/src/service/outline-service.ts
/**
 * AC-EI-1 — an attested evidence row counts toward an AC only for the check it ran
 * (spec-evidence-identity-an-attested-row-counts-only-for-the; BR-40, AS-17).
 *
 * Drives the REAL command surfaces in a THROWAWAY corpus (mkdtemp + `lore init`, HOME and cwd inside it —
 * never this repository's own `.lore/`). Exit codes are asserted exactly. Every assertion reads a rendered
 * surface (`lore ac list` text and --json, `lore status --json`, the exported spec mirror), never the aggregator alone: a unit test over `computeAcCoverage` passes whether or not any surface
 * shows the `other_command` tally.
 *
 * Halves (spec text, AC-EI-1):
 *   (1) a captured attested pass of `echo ok` with --ac AC-X, whose declared command differs, leaves AC-X not
 *       attested_pass and shows other_command=1;
 *   (2) control: a `lore verify` pass of AC-X's declared command renders attested_pass;
 *   (3) after `lore ac set --correction` changes AC-X's command, the earlier verify pass moves to other_command
 *       and AC-X stops rendering attested_pass until re-verified;
 *   (4) symmetric: an attested fail under a superseded command does not hold AC-X at fail once an
 *       equal-command attested pass exists;
 *   (5) one derivation: no evidence-row command is compared against an AC command in the named surface files.
 *
 * Dimensions: HAPPY (2), NEGATIVE (1), STATE (3), BOUNDARY (4, strict equality: a whitespace-only difference is
 * a different command), REGRESSION (5, every surface shows the tally), ERROR (unknown spec exits 3).
 *
 * @spec_ref spec-evidence-identity-an-attested-row-counts-only-for-the
 */

import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { runLoreInProcess } from "../../helpers/run-lore-in-process";
import { planFieldsArgs, templatedFieldsArgs } from "../../helpers/templated-create.js";

vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 });

const REPO_ROOT = new URL("../../../../../", import.meta.url).pathname.replace(/\/$/, "");

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

async function runLore(args: string[], cwd: string): Promise<RunResult> {
  const proc = await runLoreInProcess(args, {
    cwd,
    home: cwd,
    env: { ...process.env, HOME: cwd, EDITOR: "true", LORE_ACTOR: "agent:ac-command-identity-test" },
  });
  return { stdout: proc.stdout, stderr: proc.stderr, exitCode: proc.exitCode };
}

/** Fixture step: throws (never asserts) so a setup failure cannot pass for the behaviour under test. */
async function mustRun(args: string[], cwd: string): Promise<RunResult> {
  const result = await runLore(args, cwd);
  if (result.exitCode !== 0) {
    throw new Error(`FIXTURE FAILURE - \`lore ${args.join(" ")}\` exited ${result.exitCode}: ${result.stderr || result.stdout}`);
  }
  return result;
}

interface CoverageFactJson {
  readonly ac_id: string;
  readonly pass: number;
  readonly fail: number;
  readonly attested_pass: number;
  readonly attested_fail: number;
  readonly other_command?: number;
  readonly state: string;
}

async function coverageOf(acId: string): Promise<CoverageFactJson> {
  const result = await runLore(["ac", "list", SPEC, "--json"], dir);
  expect(result.exitCode, result.stderr).toBe(0);
  const data = (JSON.parse(result.stdout) as { data: { coverage: CoverageFactJson[] | null } }).data;
  const fact = data.coverage?.find((f) => f.ac_id === acId);
  if (fact === undefined) throw new Error(`no coverage fact for ${acId}`);
  return fact;
}

async function textLineOf(acId: string): Promise<string> {
  const result = await runLore(["ac", "list", SPEC], dir);
  expect(result.exitCode, result.stderr).toBe(0);
  const lines = result.stdout.split("\n").filter((l) => l.includes(`${acId} —`));
  if (lines.length !== 1) throw new Error(`expected 1 line for ${acId}, got ${lines.length}:\n${result.stdout}`);
  return lines[0] as string;
}

const SPEC = "spec-ei-spec";
const PLAN = "plan-ei-plan";
const TASK = "task-ei-task";
let dir: string;

async function addScriptAc(id: string, command: string): Promise<void> {
  await mustRun(
    ["ac", "add", SPEC, id, "--statement", `${id} holds in the throwaway corpus.`, "--mode", "script", "--oracle", "other", "--command", command],
    dir,
  );
}

async function verifyAc(acId: string): Promise<RunResult> {
  return runLore(["verify", PLAN, "--task", TASK, "--yes", "--ac", acId], dir);
}

async function captureOnAc(acId: string, command: string, result: "pass" | "fail"): Promise<RunResult> {
  return runLore(["evidence", TASK, "--oracle", "other", "--command", command, "--result", result, "--capture", "--ac", acId], dir);
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "lore-ac-command-identity-"));
  await mustRun(["init"], dir);
  await mustRun(["create", "prd", "--title", "EI PRD", "--no-ai", ...templatedFieldsArgs("prd", { refTarget: "problem" })], dir);
  await mustRun(["create", "spec", "--title", "EI Spec", "--no-ai", ...templatedFieldsArgs("spec", { kind: "feature", refTarget: "prd-ei-prd" })], dir);
  await addScriptAc("AC-EI-A", "echo a-declared");
  await addScriptAc("AC-EI-B", "echo b-declared");
  await addScriptAc("AC-EI-C", "echo c-v1");
  await addScriptAc("AC-EI-D", "sh -c 'exit 1'");
  await addScriptAc("AC-EI-E", "echo e-declared");
  await mustRun(["create", "plan", "--title", "EI Plan", "--parent", SPEC, "--no-ai", ...planFieldsArgs(SPEC)], dir);
  await mustRun(
    [
      "create", "task", "--kind", "code", "--title", "EI Task", "--parent", PLAN, "--plan-id", PLAN, "--no-ai", ...templatedFieldsArgs("task"),
      "--ac-scope", "AC-EI-A", "--ac-scope", "AC-EI-B", "--ac-scope", "AC-EI-C", "--ac-scope", "AC-EI-D", "--ac-scope", "AC-EI-E",
    ],
    dir,
  );
}, 240_000);

afterAll(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore cleanup errors */
  }
});

describe("AC-EI-1 half 1 (NEGATIVE): an attested pass of a different command does not count", () => {
  it("a captured `echo ok` with --ac AC-EI-A exits 0, leaves AC-EI-A not attested_pass, shows other_command=1 on every surface", async () => {
    const recorded = await captureOnAc("AC-EI-A", "echo ok", "pass");
    expect(recorded.exitCode, recorded.stderr + recorded.stdout).toBe(0);

    const fact = await coverageOf("AC-EI-A");
    expect(fact.state).not.toBe("attested_pass");
    expect(fact.attested_pass).toBe(0);
    expect(fact.pass).toBe(0);
    expect(fact.other_command).toBe(1);

    expect(await textLineOf("AC-EI-A")).toContain("other_command=1");
  });
});

describe("AC-EI-1 half 2 (HAPPY control): a verify pass of the declared command renders attested_pass", () => {
  it("lore verify of AC-EI-B exits 0 and AC-EI-B is attested_pass with other_command absent from the line", async () => {
    const verified = await verifyAc("AC-EI-B");
    expect(verified.exitCode, verified.stderr + verified.stdout).toBe(0);
    const fact = await coverageOf("AC-EI-B");
    expect(fact.state).toBe("attested_pass");
    expect(fact.attested_pass).toBe(1);
    expect(fact.other_command ?? 0).toBe(0);
    expect(await textLineOf("AC-EI-B")).not.toContain("other_command");
  });
});

describe("AC-EI-1 half 3 (STATE): a command correction moves the earlier pass to other_command", () => {
  it("attested_pass before the correction, other_command=1 and not attested_pass after, attested_pass again once re-verified", async () => {
    const first = await verifyAc("AC-EI-C");
    expect(first.exitCode, first.stderr + first.stdout).toBe(0);
    expect((await coverageOf("AC-EI-C")).state).toBe("attested_pass");

    const corrected = await runLore(
      ["ac", "set", SPEC, "AC-EI-C", "--command", "echo c-v2", "--correction", "command rewritten for the identity test"],
      dir,
    );
    expect(corrected.exitCode, corrected.stderr + corrected.stdout).toBe(0);

    const afterCorrection = await coverageOf("AC-EI-C");
    expect(afterCorrection.state).not.toBe("attested_pass");
    expect(afterCorrection.attested_pass).toBe(0);
    expect(afterCorrection.other_command).toBe(1);

    const again = await verifyAc("AC-EI-C");
    expect(again.exitCode, again.stderr + again.stdout).toBe(0);
    const reverified = await coverageOf("AC-EI-C");
    expect(reverified.state).toBe("attested_pass");
    expect(reverified.other_command).toBe(1);
  });
});

describe("AC-EI-1 half 4 (symmetric): a fail under a superseded command stops holding the AC at fail", () => {
  it("an attested fail of the declared command holds AC-EI-D at fail; after a correction and a green verify it is attested_pass with the fail in other_command", async () => {
    const failed = await verifyAc("AC-EI-D");
    expect(failed.exitCode, failed.stderr + failed.stdout).not.toBe(0);
    const failing = await coverageOf("AC-EI-D");
    expect(failing.state).toBe("fail");
    expect(failing.attested_fail).toBe(1);

    const corrected = await runLore(
      ["ac", "set", SPEC, "AC-EI-D", "--command", "echo d-v2", "--correction", "command rewritten for the identity test"],
      dir,
    );
    expect(corrected.exitCode, corrected.stderr + corrected.stdout).toBe(0);
    const stale = await coverageOf("AC-EI-D");
    expect(stale.state).not.toBe("fail");
    expect(stale.state).not.toBe("fail_superseded");
    expect(stale.fail).toBe(0);
    expect(stale.other_command).toBe(1);

    const green = await verifyAc("AC-EI-D");
    expect(green.exitCode, green.stderr + green.stdout).toBe(0);
    const healed = await coverageOf("AC-EI-D");
    expect(healed.state).toBe("attested_pass");
    expect(healed.attested_fail).toBe(0);
    expect(healed.other_command).toBe(1);
  });
});

describe("AC-EI-1 BOUNDARY: equality is strict, with no normalisation", () => {
  it("a captured pass whose command differs from the declared one only by a trailing space counts as other_command", async () => {
    const recorded = await captureOnAc("AC-EI-E", "echo e-declared ", "pass");
    expect(recorded.exitCode, recorded.stderr + recorded.stdout).toBe(0);
    const fact = await coverageOf("AC-EI-E");
    expect(fact.state).not.toBe("attested_pass");
    expect(fact.attested_pass).toBe(0);
    expect(fact.other_command).toBe(1);
  });
});

describe("AC-EI-1 REGRESSION: every surface that renders the coverage state shows the other_command tally", () => {
  it("lore status --json reports the corpus-wide other_command AC count and its members", async () => {
    const status = await runLore(["status", "--json"], dir);
    expect(status.exitCode, status.stderr).toBe(0);
    const payload = JSON.parse(status.stdout) as { data: Record<string, unknown> };
    expect(typeof payload.data["ac_other_command_count"]).toBe("number");
    expect(payload.data["ac_other_command_count"] as number).toBeGreaterThanOrEqual(3);
    const members = await runLore(["status", "--enumerate", "ac_other_command_count"], dir);
    expect(members.exitCode, members.stderr).toBe(0);
    expect(members.stdout).toContain(`${SPEC}#AC-EI-A`);
  });

  it("lore status text names the other_command count", async () => {
    const status = await runLore(["status"], dir);
    expect(status.exitCode, status.stderr).toBe(0);
    expect(status.stdout).toMatch(/other[_ -]command/i);
  });

  it("the exported spec mirror body names other_command under the AC", async () => {
    const exported = await runLore(["export-docs", "--type", "spec"], dir);
    expect(exported.exitCode, exported.stderr + exported.stdout).toBe(0);
    const files: string[] = [];
    const walk = (d: string): void => {
      for (const name of readdirSync(d)) {
        const p = join(d, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (name.endsWith(".md")) files.push(p);
      }
    };
    walk(dir);
    const specFile = files.find((f) => readFileSync(f, "utf8").includes("AC-EI-A:"));
    if (specFile === undefined) throw new Error("FIXTURE FAILURE - exported spec file not found");
    expect(readFileSync(specFile, "utf8")).toContain("other_command=1");
  });
});

describe("AC-EI-1 half 5 (one derivation): no surface compares an evidence-row command itself", () => {
  const SURFACE_FILES = [
    "packages/lore/src/service/ac-service.ts",
    "packages/lore/src/adapters/cli/commands/ac.ts",
    "packages/lore/src/adapters/cli/commands/status.ts",
    "scripts/export-spec-mirror.ts",
    "packages/lore/src/service/outline-service.ts",
  ];
  const COMPARES_EVIDENCE_COMMAND = /\b(entry|row|ref|ev|evidence\w*|e)\.command\s*[!=]==?|[!=]==?\s*(entry|row|ref|ev|evidence\w*|e)\.command\b/;

  it("grep over the named file set finds no comparison of an evidence row command against an AC command", () => {
    const offenders: string[] = [];
    for (const rel of SURFACE_FILES) {
      readFileSync(join(REPO_ROOT, rel), "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (COMPARES_EVIDENCE_COMMAND.test(line)) offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(offenders).toEqual([]);
  });

  it("the comparison does live in computeAcCoverage (control: the scan can see a real comparison)", () => {
    const source = readFileSync(join(REPO_ROOT, "packages/core/src/acceptance.ts"), "utf8");
    expect(source).toMatch(/entry\.command\s*[!=]==\s*/);
    expect(COMPARES_EVIDENCE_COMMAND.test("if (entry.command === criterion.verify.command) {")).toBe(true);
  });
});

describe("AC-EI-1 ERROR: an unknown spec", () => {
  it("lore ac list of a missing spec exits 3", async () => {
    const result = await runLore(["ac", "list", "spec-does-not-exist"], dir);
    expect(result.exitCode).toBe(3);
  });
});
