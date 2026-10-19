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
 *
 * TG-25 (adr-tg-1 option b): the commands run IN-PROCESS through tests/helpers/run-lore-in-process.ts, not through
 * dist/lore. Wherever the prose above says the compiled binary is spawned or its freshness asserted, that is the
 * history of this file; the assertions and the throwaway-corpus rule are unchanged.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const setDefaultTimeout = (ms: number): void => { vi.setConfig({ testTimeout: ms, hookTimeout: ms }); };
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { patchLoreConfig } from "../helpers/patch-lore-config.js";
import { citeSpecViaAsyncCli, asyncLoreRunnerFor } from "../helpers/cli-live-rule.js";
import { runLoreInProcess } from "../helpers/run-lore-in-process";

setDefaultTimeout(120_000);

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

// tests/e2e/ -> packages/lore/ -> packages/ -> repo root (4 levels up).
const PROJECT_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
const AC_ID = "AC-CCE-1";

let dir = "";
let spec = "";

function cleanEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (typeof v === "string") env[k] = v;
  return { ...env, HOME: dir, CLAUDE_CODE_SESSION_ID: "a77e57e1-aaaa-bbbb-cccc-333333333333" };
}

async function runLore(args: string[], cwd: string = dir): Promise<RunResult> {
  const proc = await runLoreInProcess(args, { cwd, home: dir, env: cleanEnv() });
  return { stdout: proc.stdout, stderr: proc.stderr, exitCode: proc.exitCode };
}

async function mustLore(args: string[]): Promise<string> {
  const r = await runLore(args);
  if (r.exitCode !== 0) throw new Error(`lore ${args.join(" ")} failed (${r.exitCode}): ${r.stderr}${r.stdout}`);
  return r.stdout;
}

function parseSlug(stdout: string): string {
  const slug = stdout.match(/Slug:\s+(\S+)/)?.[1];
  if (slug === undefined) throw new Error(`could not parse slug from: ${stdout}`);
  return slug;
}

async function criteriaJson(): Promise<Array<{ id: string; statement: string; verify: Record<string, unknown> }>> {
  const payload = JSON.parse(await mustLore(["ac", "list", spec, "--json"])) as {
    data: { criteria: Array<{ id: string; statement: string; verify: Record<string, unknown> }> };
  };
  return payload.data.criteria;
}

/** The spec's version-log text: any new version changes it. */
async function logOf(): Promise<string> {
  return await mustLore(["log", spec]);
}

describe("lore ac set --correction, compiled binary (AC-CC-2)", () => {
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "lore-ac-correction-e2e-"));
    expect(dir.startsWith(PROJECT_ROOT)).toBe(false);
    await mustLore(["init"]);
    await mustLore(["create", "prd", "--title", "Correction PRD", "--content", "PRD body.", "--no-ai"]);
    // The review-judgment checkpoint defaults spec/adr into `judgment_required_types`; disabled so the approval
    // below is a fixture step, not the behaviour under test.
    patchLoreConfig(dir, { workflow: { review: { judgment_required_types: [] } } });

    spec = parseSlug(
      await mustLore(["create", "spec", "--title", "Correction Spec", "--kind", "tech", "--content", "## Overview\n\nBody.\n", "--no-ai"]),
    );
    await mustLore([
      "ac", "add", spec, AC_ID, "--statement", "Original statement of the criterion.",
      "--mode", "script", "--oracle", "test", "--command", "bun test",
    ]);
    await citeSpecViaAsyncCli(asyncLoreRunnerFor(runLore, dir), dir, undefined, spec, AC_ID);
    await mustLore(["approve", spec]);

    // One evidence row on a task of a plan under the spec: the state in which `lore reopen` is refused.
    const plan = parseSlug(
      await mustLore(["create", "plan", "--title", "Correction Plan", "--parent", spec, "--content", "## Plan\n\nbody", "--no-ai"]),
    );
    const task = parseSlug(
      await mustLore(["create", "task", "--title", "Correction Task", "--plan-id", plan, "--ac-scope", AC_ID, "--content", "## Task\n\nbody", "--no-ai"]),
    );
    await mustLore(["evidence", task, "--oracle", "test", "--result", "pass", "--command", "echo evidence-ok", "--capture", "--ac", AC_ID]);
  });

  afterAll(() => {
    if (dir !== "") rmSync(dir, { recursive: true, force: true });
  });

  it("(b) without --correction the edit exits exactly 4 and stderr names 'lore ac set' with '--correction'", async () => {
    const r = await runLore(["ac", "set", spec, AC_ID, "--statement", "Rewritten statement."]);
    expect(r.exitCode).toBe(4);
    expect(r.stderr).toContain("lore ac set");
    expect(r.stderr).toContain("--correction");
  });

  it("(c) --correction '' exits exactly 2 and the version log is unchanged", async () => {
    const before = await logOf();
    const r = await runLore(["ac", "set", spec, AC_ID, "--statement", "Rewritten statement.", "--correction", ""]);
    expect(r.exitCode).toBe(2);
    expect(await logOf()).toBe(before);
  });

  it("(d) ac add and ac rm with --correction each exit exactly 2 naming 'ac set --correction', nothing written", async () => {
    const before = await logOf();
    const add = await runLore([
      "ac", "add", spec, "AC-CCE-2", "--statement", "A second criterion.",
      "--mode", "script", "--oracle", "test", "--command", "bun test", "--correction", "r",
    ]);
    const rm = await runLore(["ac", "rm", spec, AC_ID, "--correction", "r"]);
    expect(add.exitCode).toBe(2);
    expect(add.stderr).toContain("ac set --correction");
    expect(rm.exitCode).toBe(2);
    expect(rm.stderr).toContain("ac set --correction");
    expect(await logOf()).toBe(before);
    expect(await criteriaJson()).toHaveLength(1);
  });

  it("(a) --statement with --correction exits 0, prints the correction line, get shows Corrections: 1 and Status approved", async () => {
    const r = await runLore(["ac", "set", spec, AC_ID, "--statement", "Corrected statement of the criterion.", "--correction", "r"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("(correction recorded: r)");
    const out = await mustLore(["get", spec]);
    expect(out).toContain("Corrections: 1");
    expect(out).toContain("Status: approved");
    expect((await criteriaJson())[0]?.statement).toBe("Corrected statement of the criterion.");
  });

  it("(e) a correction declaring the four --falsifier-* flags exits 0 and ac list --json shows the falsifier", async () => {
    const r = await runLore([
      "ac", "set", spec, AC_ID, "--falsifier-path", "src/a.ts", "--falsifier-find", "return 1",
      "--falsifier-replace", "return 2", "--falsifier-exit-code", "1", "--allow-missing-path", "fixture path", "--correction", "declare falsifier",
    ]);
    expect(r.exitCode).toBe(0);
    const verify = (await criteriaJson())[0]?.verify as { falsifier?: Record<string, unknown> } | undefined;
    expect(verify?.falsifier).toEqual({ path: "src/a.ts", find: "return 1", replace: "return 2", expected_exit_code: 1 });
    expect(await mustLore(["get", spec])).toContain("Corrections: 2");
  });
});
