/**
 * RED compiled-binary e2e for the declaration-time pipe refusal (AC-EH-7, BR-1078, issue #19) —
 * task-skill-test-red-declaration-time-pipe-refusal-on-service. Paired impl:
 * task-skill-implement-one-shared-pipe-detector-ac-add-set-refuse.
 *
 * Drives the COMPILED `dist/lore` against a THROWAWAY `mkdtemp` corpus (never this repo's own
 * `.lore/`). Run `bun run build` (repo root) first: `beforeAll` calls `assertFreshBinary`, so a stale
 * binary fails loudly instead of validating stale logic.
 *
 * Contract (user decision U1): every script oracle except `other` refuses an unquoted pipe at
 * `lore ac add` / `lore ac set` with exit EXACTLY 4, stderr quoting the pipe segment and naming the
 * `mktemp` pipe-free form, and writes nothing; under `other` the criterion is stored, exit 0, and stderr
 * carries one `advisory:` line naming the pipe.
 *
 * Coverage: (a) the issue's own repro (oracle test), (b) oracle other -> exit 0 + `advisory:`,
 * (c)(d)(e) oracle tsc / lint / build -> exit 4, (f) `ac set --command` piping an existing test criterion
 * -> exit 4, command unchanged.
 *
 * RED NATURE: today every one of these exits 0 and stores the criterion, so each refusal case fails on
 * the exit-code assertion; (b) fails on the missing `advisory:` stderr line. No harness error: the spec
 * and the real test file `a.test.ts` (so `ac set`'s path-existence check cannot be the thing that refuses
 * (f)) are seeded in `beforeAll`.
 *
 * @spec_ref AC-EH-7
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { assertFreshBinary } from "../integration/helpers/assert-fresh-binary";

// tests/e2e/ -> tests/ -> packages/lore/ -> packages/ -> repo root (4 levels up).
const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
const LORE_BIN = join(REPO_ROOT, "dist", "lore");

/** The issue's own repro: the pipe's last command (`tail`) masks the runner's exit code. */
const PIPED = "false | tail -1 && echo PASS";
const PIPED_SEGMENT = "| tail -1";
const SET_PIPED = "bunx vitest run a.test.ts | tail -3";
const SET_CLEAN = "bunx vitest run a.test.ts";

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

function runLore(args: string[], cwd: string): RunResult {
  const proc = Bun.spawnSync([LORE_BIN, ...args], {
    cwd,
    env: { ...process.env, HOME: cwd, CLAUDECODE: "1", LORE_ACTOR: "agent:ac-eh-7-probe" },
  });
  return {
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    exitCode: proc.exitCode ?? 1,
  };
}

function parseSlug(stdout: string): string {
  const slug = stdout.match(/Slug:\s+(\S+)/)?.[1];
  if (slug === undefined) throw new Error(`could not parse slug from: ${stdout}`);
  return slug;
}

interface ListedCriterion {
  id: string;
  verify: { command?: string; oracle?: string };
}

/** The spec's CURRENT criteria as `lore ac list --json` reports them. */
function listCriteria(dir: string, specSlug: string): ListedCriterion[] {
  const r = runLore(["ac", "list", specSlug, "--json"], dir);
  if (r.exitCode !== 0) throw new Error(`lore ac list failed: ${r.stderr}`);
  const parsed = JSON.parse(r.stdout) as { data: { criteria: ListedCriterion[] } };
  return parsed.data.criteria;
}

function addScript(dir: string, specSlug: string, id: string, oracle: string, command: string): RunResult {
  return runLore(
    ["ac", "add", specSlug, id, "--mode", "script", "--oracle", oracle, "--command", command, "--statement", "s"],
    dir,
  );
}

let dir: string;
let specSlug: string;

beforeAll(() => {
  assertFreshBinary(LORE_BIN, [join(REPO_ROOT, "packages", "lore", "src"), join(REPO_ROOT, "packages", "core", "src")]);

  dir = mkdtempSync(join(tmpdir(), "lore-ac-eh-7-"));
  // Never inside this repo — the corpus under test must not be the repo's own.
  expect(dir.startsWith(REPO_ROOT)).toBe(false);

  const init = runLore(["init"], dir);
  if (init.exitCode !== 0) throw new Error(`lore init failed: ${init.stderr}`);
  // The file `ac set` (f) names, so the D8 path-existence check passes and only the pipe check can refuse.
  writeFileSync(join(dir, "a.test.ts"), "// existence-only fixture\n");

  const prd = runLore(["create", "prd", "--title", "AC-EH-7 Root", "--content", "# PRD\n\nroot.", "--no-ai"], dir);
  if (prd.exitCode !== 0) throw new Error(`create prd failed: ${prd.stderr}`);
  const spec = runLore(["create", "spec", "--title", "AC-EH-7 Spec", "--content", "## Spec\n\nbody", "--no-ai"], dir);
  if (spec.exitCode !== 0) throw new Error(`create spec failed: ${spec.stderr}`);
  specSlug = parseSlug(spec.stdout);
});

afterAll(() => {
  if (dir !== undefined) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup of a throwaway dir */
    }
  }
});

describe("AC-EH-7 — compiled lore ac add / set refuse an unquoted pipe (every script oracle except other)", () => {
  it("(a) ac add --oracle test with the issue's own repro exits 4, stderr quotes '| tail -1' and names mktemp, nothing stored", () => {
    const r = addScript(dir, specSlug, "AC-X-A", "test", PIPED);
    expect(r.exitCode).toBe(4);
    expect(r.stderr).toContain(PIPED_SEGMENT);
    expect(r.stderr).toContain("mktemp");
    expect(listCriteria(dir, specSlug).map((c) => c.id)).not.toContain("AC-X-A");
  });

  it("(b) the same command with --oracle other exits 0, is stored, and stderr carries 'advisory:' naming '| tail -1'", () => {
    const r = addScript(dir, specSlug, "AC-X-B", "other", PIPED);
    expect(r.exitCode).toBe(0);
    expect(listCriteria(dir, specSlug).map((c) => c.id)).toContain("AC-X-B");
    expect(r.stderr).toContain("advisory:");
    expect(r.stderr).toContain(PIPED_SEGMENT);
  });

  it.each([
    ["c", "tsc"],
    ["d", "lint"],
    ["e", "build"],
  ])("(%s) the same command with --oracle %s exits 4 and stores nothing", (letter, oracle) => {
    const id = `AC-X-${letter.toUpperCase()}`;
    const r = addScript(dir, specSlug, id, oracle, PIPED);
    expect(r.exitCode).toBe(4);
    expect(listCriteria(dir, specSlug).map((c) => c.id)).not.toContain(id);
  });

  it("(f) ac set --command piping an existing test criterion exits 4 and the listed command is unchanged", () => {
    const seeded = addScript(dir, specSlug, "AC-Y", "test", SET_CLEAN);
    expect(seeded.exitCode).toBe(0);
    const r = runLore(["ac", "set", specSlug, "AC-Y", "--command", SET_PIPED], dir);
    expect(r.exitCode).toBe(4);
    const listed = listCriteria(dir, specSlug).find((c) => c.id === "AC-Y");
    expect(listed?.verify.command).toBe(SET_CLEAN);
  });
});
