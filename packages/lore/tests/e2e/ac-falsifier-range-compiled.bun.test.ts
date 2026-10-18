/**
 * ac-falsifier-range-compiled.bun.test.ts — AC-EH-4: the falsifier exit-code range (1..255) on the REAL compiled
 * binary's `lore ac add` / `lore ac set`, on a throwaway corpus.
 *
 * Covers (spec-evidence-labels-and-reds-are-honest, BR-1076):
 *   (a) `ac add ... --falsifier-exit-code 0` exits exactly 4, stderr names 'falsifier', '1' and '255', and
 *       `ac list --json` shows no AC-X
 *   (b) the same with `--falsifier-exit-code 1` exits exactly 0 and AC-X is listed with expected_exit_code 1
 *   (c) `ac set ... --falsifier-exit-code 256` (the other falsifier flags repeated) exits exactly 4 and the
 *       listed value stays 1
 *
 * Dimension mapping:
 *   HAPPY:      (b) 1 is accepted, listed with expected_exit_code 1
 *   NEGATIVE:   (a) 0 -> exit 4 naming the range
 *   BOUNDARY:   0 and 256 (the two edges outside 1..255) are each refused
 *   ERROR:      (a)/(c) the exit code is exactly 4 (validation), not 1/2, and stderr names the range
 *   STATE:      (a) nothing is written (AC-X absent); (c) the stored value stays 1
 *   REGRESSION: (b) is also the existing happy path of `ac add` with a falsifier — it must keep working
 *
 * RED-first: against current code (a) exits 0 and (c) exits 0 — ASSERTION failures, not harness errors.
 *
 * bun test (not vitest): spawns `dist/lore` against `mkdtemp` + `lore init` (cwd AND HOME inside it) — never the
 * repo's own `.lore/`. `assertFreshBinary` fails loud on a stale `dist/lore` (`bun run build` first).
 *
 * Coverage: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION
 *
 * @spec_ref AC-EH-4 — spec-evidence-labels-and-reds-are-honest; BR-1076
 *
 * TG-25 (adr-tg-1 option b): the commands run IN-PROCESS through tests/helpers/run-lore-in-process.ts, not through
 * dist/lore. Wherever the prose above says the compiled binary is spawned or its freshness asserted, that is the
 * history of this file; the assertions and the throwaway-corpus rule are unchanged.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const setDefaultTimeout = (ms: number): void => { vi.setConfig({ testTimeout: ms, hookTimeout: ms }); };
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { runLoreInProcess } from "../helpers/run-lore-in-process";

setDefaultTimeout(120_000);

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

// tests/e2e/ -> packages/lore/ -> packages/ -> repo root (4 levels up).
const PROJECT_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
const AC_ID = "AC-X";
const FALSIFIER_FLAGS = ["--falsifier-path", "target.txt", "--falsifier-find", "MAGIC", "--falsifier-replace", "NOPE"] as const;

let dir = "";
let spec = "";

function cleanEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (typeof v === "string") env[k] = v;
  return { ...env, HOME: dir, CLAUDE_CODE_SESSION_ID: "a77e57e1-aaaa-bbbb-cccc-444444444444" };
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

interface ListedCriterion {
  id: string;
  verify: { falsifier?: { expected_exit_code?: number } };
}

async function criteriaJson(): Promise<ListedCriterion[]> {
  const payload = JSON.parse(await mustLore(["ac", "list", spec, "--json"])) as { data: { criteria: ListedCriterion[] } };
  return payload.data.criteria;
}

function addArgs(exitCode: number): string[] {
  return [
    "ac", "add", spec, AC_ID, "--statement", "Declares a falsifier.",
    "--mode", "script", "--oracle", "test", "--command", "cat target.txt",
    ...FALSIFIER_FLAGS, "--falsifier-exit-code", String(exitCode),
  ];
}

describe("lore ac add / ac set falsifier exit-code range, compiled binary (AC-EH-4)", () => {
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "lore-falsifier-range-e2e-"));
    expect(dir.startsWith(PROJECT_ROOT)).toBe(false);
    await mustLore(["init"]);
    // The command and the falsifier target are real files in the corpus dir (declaration-time path precheck).
    writeFileSync(join(dir, "target.txt"), "MAGIC marker\n", "utf8");
    await mustLore(["create", "prd", "--title", "Range PRD", "--content", "PRD body.", "--no-ai"]);
    spec = parseSlug(
      await mustLore(["create", "spec", "--title", "Range Spec", "--kind", "tech", "--content", "## Overview\n\nBody.\n", "--no-ai"]),
    );
  });

  afterAll(() => {
    if (dir !== "") rmSync(dir, { recursive: true, force: true });
  });

  it("(a) ac add --falsifier-exit-code 0 exits exactly 4, stderr names falsifier, 1 and 255, and AC-X is not listed", async () => {
    const r = await runLore(addArgs(0));
    expect(r.exitCode).toBe(4);
    expect(r.stderr).toContain("falsifier");
    expect(r.stderr).toContain("1");
    expect(r.stderr).toContain("255");
    expect((await criteriaJson()).map((c) => c.id)).not.toContain(AC_ID);
  });

  it("(b) ac add --falsifier-exit-code 1 exits 0 and AC-X is listed with expected_exit_code 1", async () => {
    const r = await runLore(addArgs(1));
    expect(r.exitCode).toBe(0);
    const listed = (await criteriaJson()).find((c) => c.id === AC_ID);
    expect(listed?.verify.falsifier?.expected_exit_code).toBe(1);
  });

  it("(c) ac set --falsifier-exit-code 256 exits exactly 4 and the listed value stays 1", async () => {
    const r = await runLore(["ac", "set", spec, AC_ID, ...FALSIFIER_FLAGS, "--falsifier-exit-code", "256"]);
    expect(r.exitCode).toBe(4);
    expect(r.stderr).toContain("falsifier");
    expect(r.stderr).toContain("255");
    const listed = (await criteriaJson()).find((c) => c.id === AC_ID);
    expect(listed?.verify.falsifier?.expected_exit_code).toBe(1);
  });
});
