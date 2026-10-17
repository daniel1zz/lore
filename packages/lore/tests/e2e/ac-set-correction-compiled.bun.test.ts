/**
 * ac-set-correction-compiled.bun.test.ts — AC-CC-2: `lore ac set --correction` on a locked spec, observed from
 * the REAL compiled binary on a throwaway corpus.
 *
 * Covers (spec-a-criterion-of-a-locked-specification-can-be-fixed-as-an, BR-1069):
 *   (a) `ac set --statement x --correction r` exits 0, stdout has '(correction recorded: r)', `lore get` shows
 *       'Corrections: 1' and 'Status: approved'
 *   (b) the same call without --correction exits exactly 4, stderr names 'lore ac set' and '--correction'
 *   (c) `--correction ''` exits exactly 2 and `lore log` shows no new version
 *   (d) `ac add` / `ac rm` with --correction exit exactly 2 naming 'ac set --correction', nothing written
 *   (e) a correction declaring --falsifier-path/find/replace/exit-code exits 0 and `ac list --json` shows it
 *
 * bun test (not vitest): spawns `dist/lore` against `mkdtemp` + `lore init` (cwd AND HOME inside it) — never the
 * repo's own `.lore/`. `assertFreshBinary` fails loud on a stale `dist/lore`.
 *
 * Coverage: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION
 *
 * @spec_ref AC-CC-2 — spec-a-criterion-of-a-locked-specification-can-be-fixed-as-an D1, D4, D5
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const setDefaultTimeout = (ms: number): void => { vi.setConfig({ testTimeout: ms, hookTimeout: ms }); };
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import yaml from "yaml";
import { assertFreshBinary } from "../integration/helpers/assert-fresh-binary";
import { citeSpecViaCli, loreRunnerFor } from "../helpers/cli-live-rule.js";

setDefaultTimeout(120_000);

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

// tests/e2e/ -> packages/lore/ -> packages/ -> repo root (4 levels up).
const PROJECT_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
const LORE_BIN = join(PROJECT_ROOT, "dist", "lore");
const AC_ID = "AC-CCE-1";

let dir = "";
let spec = "";

function cleanEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (typeof v === "string") env[k] = v;
  return { ...env, HOME: dir, CLAUDE_CODE_SESSION_ID: "a77e57e1-aaaa-bbbb-cccc-333333333333" };
}

function runLore(args: string[], cwd: string = dir): RunResult {
  const proc = Bun.spawnSync([LORE_BIN, ...args], { cwd, env: cleanEnv() });
  return { stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), exitCode: proc.exitCode ?? 1 };
}

function mustLore(args: string[]): string {
  const r = runLore(args);
  if (r.exitCode !== 0) throw new Error(`lore ${args.join(" ")} failed (${r.exitCode}): ${r.stderr}${r.stdout}`);
  return r.stdout;
}

function parseSlug(stdout: string): string {
  const slug = stdout.match(/Slug:\s+(\S+)/)?.[1];
  if (slug === undefined) throw new Error(`could not parse slug from: ${stdout}`);
  return slug;
}

function criteriaJson(): Array<{ id: string; statement: string; verify: Record<string, unknown> }> {
  const payload = JSON.parse(mustLore(["ac", "list", spec, "--json"])) as {
    data: { criteria: Array<{ id: string; statement: string; verify: Record<string, unknown> }> };
  };
  return payload.data.criteria;
}

/** The spec's version-log text: any new version changes it. */
function logOf(): string {
  return mustLore(["log", spec]);
}

describe("lore ac set --correction, compiled binary (AC-CC-2)", () => {
  beforeAll(() => {
    // reason: `bun run build` produces dist/lore; this fails loud on a missing or stale binary.
    assertFreshBinary(LORE_BIN, [join(PROJECT_ROOT, "packages", "lore", "src"), join(PROJECT_ROOT, "packages", "core", "src")]);
    dir = mkdtempSync(join(tmpdir(), "lore-ac-correction-e2e-"));
    expect(dir.startsWith(PROJECT_ROOT)).toBe(false);
    mustLore(["init"]);
    mustLore(["create", "prd", "--title", "Correction PRD", "--content", "PRD body.", "--no-ai"]);
    // The review-judgment checkpoint defaults spec/adr into `judgment_required_types`; disabled so the approval
    // below is a fixture step, not the behaviour under test.
    const cfgPath = join(dir, ".lore", "config.yaml");
    const existing = yaml.parse(readFileSync(cfgPath, "utf8")) as Record<string, unknown>;
    const workflow = { ...(existing["workflow"] as Record<string, unknown> | undefined), review: { judgment_required_types: [] } };
    writeFileSync(cfgPath, yaml.stringify({ ...existing, workflow }), "utf8");

    spec = parseSlug(
      mustLore(["create", "spec", "--title", "Correction Spec", "--kind", "tech", "--content", "## Overview\n\nBody.\n", "--no-ai"]),
    );
    mustLore([
      "ac", "add", spec, AC_ID, "--statement", "Original statement of the criterion.",
      "--mode", "script", "--oracle", "test", "--command", "bun test",
    ]);
    citeSpecViaCli(loreRunnerFor(runLore, dir), dir, undefined, spec, AC_ID);
    mustLore(["approve", spec]);

    // One evidence row on a task of a plan under the spec: the state in which `lore reopen` is refused.
    const plan = parseSlug(
      mustLore(["create", "plan", "--title", "Correction Plan", "--parent", spec, "--content", "## Plan\n\nbody", "--no-ai"]),
    );
    const task = parseSlug(
      mustLore(["create", "task", "--title", "Correction Task", "--plan-id", plan, "--ac-scope", AC_ID, "--content", "## Task\n\nbody", "--no-ai"]),
    );
    mustLore(["evidence", task, "--oracle", "test", "--result", "pass", "--command", "echo evidence-ok", "--capture", "--ac", AC_ID]);
  });

  afterAll(() => {
    if (dir !== "") rmSync(dir, { recursive: true, force: true });
  });

  it("(b) without --correction the edit exits exactly 4 and stderr names 'lore ac set' with '--correction'", () => {
    const r = runLore(["ac", "set", spec, AC_ID, "--statement", "Rewritten statement."]);
    expect(r.exitCode).toBe(4);
    expect(r.stderr).toContain("lore ac set");
    expect(r.stderr).toContain("--correction");
  });

  it("(c) --correction '' exits exactly 2 and the version log is unchanged", () => {
    const before = logOf();
    const r = runLore(["ac", "set", spec, AC_ID, "--statement", "Rewritten statement.", "--correction", ""]);
    expect(r.exitCode).toBe(2);
    expect(logOf()).toBe(before);
  });

  it("(d) ac add and ac rm with --correction each exit exactly 2 naming 'ac set --correction', nothing written", () => {
    const before = logOf();
    const add = runLore([
      "ac", "add", spec, "AC-CCE-2", "--statement", "A second criterion.",
      "--mode", "script", "--oracle", "test", "--command", "bun test", "--correction", "r",
    ]);
    const rm = runLore(["ac", "rm", spec, AC_ID, "--correction", "r"]);
    expect(add.exitCode).toBe(2);
    expect(add.stderr).toContain("ac set --correction");
    expect(rm.exitCode).toBe(2);
    expect(rm.stderr).toContain("ac set --correction");
    expect(logOf()).toBe(before);
    expect(criteriaJson()).toHaveLength(1);
  });

  it("(a) --statement with --correction exits 0, prints the correction line, get shows Corrections: 1 and Status approved", () => {
    const r = runLore(["ac", "set", spec, AC_ID, "--statement", "Corrected statement of the criterion.", "--correction", "r"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("(correction recorded: r)");
    const out = mustLore(["get", spec]);
    expect(out).toContain("Corrections: 1");
    expect(out).toContain("Status: approved");
    expect(criteriaJson()[0]?.statement).toBe("Corrected statement of the criterion.");
  });

  it("(e) a correction declaring the four --falsifier-* flags exits 0 and ac list --json shows the falsifier", () => {
    const r = runLore([
      "ac", "set", spec, AC_ID, "--falsifier-path", "src/a.ts", "--falsifier-find", "return 1",
      "--falsifier-replace", "return 2", "--falsifier-exit-code", "1", "--allow-missing-path", "fixture path", "--correction", "declare falsifier",
    ]);
    expect(r.exitCode).toBe(0);
    const verify = criteriaJson()[0]?.verify as { falsifier?: Record<string, unknown> } | undefined;
    expect(verify?.falsifier).toEqual({ path: "src/a.ts", find: "return 1", replace: "return 2", expected_exit_code: 1 });
    expect(mustLore(["get", spec])).toContain("Corrections: 2");
  });
});
