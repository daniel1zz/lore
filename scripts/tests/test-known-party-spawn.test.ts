/**
 * The test run's known-party spawn rewrite (scripts/test-known-party-spawn.ts): a `lore` start made by a test gets a
 * registered run in its per-call `LORE_HARNESS_RUN` env value, everything else is left alone
 * (spec-every-write-is-made-by-a-known-party-an-attested-agent-run, BR-1351;
 * spec-a-lore-call-s-run-identity-is-injected-per-bash-call-and).
 *
 * Dimensions: HAPPY (source entry and compiled binary get a run; the run is registered with the test process as its
 * harness), NEGATIVE (opt-out, explicit run, MCP server, not-lore starts are untouched), BOUNDARY (session env names the
 * run; entry depth; no corpus yet), STATE (registration is idempotent), REGRESSION (the argv is never rewritten).
 */
import { afterAll, describe, expect, it } from "vitest";
import { Database } from "bun:sqlite";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HARNESS_RUN_ENV as CORE_HARNESS_RUN_ENV } from "@lore/core";
import { SQLiteStore } from "../../packages/lore/src/store/sqlite-store";
import { DEFAULT_TEST_RUN, HARNESS_RUN_ENV } from "../../packages/lore/tests/helpers/test-run-identity";
import { KNOWN_PARTY_OPT_OUT_ENV, rewriteLoreStart, rewriteNodeSpawnArgs } from "../test-known-party-spawn";

const ENTRY = "/work/lore/packages/lore/src/index.ts";
const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

function corpus(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "known-party-spawn-")));
  scratch.push(dir);
  mkdirSync(join(dir, ".lore"), { recursive: true });
  new SQLiteStore(join(dir, ".lore", "lore.db")).close();
  return dir;
}

function registeredRuns(dir: string): string[] {
  const db = new Database(join(dir, ".lore", "lore.db"), { readonly: true });
  try {
    return (db.query("SELECT id FROM runs ORDER BY id").all() as Array<{ id: string }>).map((r) => r.id);
  } finally {
    db.close();
  }
}

function harnessPidOf(dir: string, run: string): number | null {
  const db = new Database(join(dir, ".lore", "lore.db"), { readonly: true });
  try {
    return (db.query("SELECT harness_pid AS pid FROM runs WHERE id = ?").get(run) as { pid: number | null }).pid;
  } finally {
    db.close();
  }
}

describe("rewriteLoreStart", () => {
  it("HAPPY: a source-entry start keeps its argv and gets the default test run in its env, registered in cwd's corpus", () => {
    const dir = corpus();
    const out = rewriteLoreStart(["bun", "run", ENTRY, "create", "prd"], { cwd: dir, env: { A: "1" } });
    expect(out?.argv).toEqual(["bun", "run", ENTRY, "create", "prd"]);
    expect(out?.env).toEqual({ A: "1", [HARNESS_RUN_ENV]: DEFAULT_TEST_RUN });
    expect(registeredRuns(dir)).toEqual([DEFAULT_TEST_RUN]);
  });

  it("HAPPY: the run's harness process is the test process (the spawned lore descends from it)", () => {
    const dir = corpus();
    rewriteLoreStart(["bun", "run", ENTRY, "list"], { cwd: dir, env: {} });
    expect(harnessPidOf(dir, DEFAULT_TEST_RUN)).toBe(process.pid);
  });

  it("HAPPY: a compiled-binary start and a start with a preload before the entry get the run too, argv untouched", () => {
    const dir = corpus();
    const binary = rewriteLoreStart(["/repo/dist/lore", "list"], { cwd: dir, env: {} });
    expect(binary?.argv).toEqual(["/repo/dist/lore", "list"]);
    expect(binary?.env).toEqual({ [HARNESS_RUN_ENV]: DEFAULT_TEST_RUN });
    const preload = rewriteLoreStart(["bun", "run", "--preload", "/p.ts", ENTRY, "list"], { cwd: dir, env: {} });
    expect(preload?.argv).toEqual(["bun", "run", "--preload", "/p.ts", ENTRY, "list"]);
    expect(preload?.env?.[HARNESS_RUN_ENV]).toBe(DEFAULT_TEST_RUN);
  });

  it("BOUNDARY: the session its env names is the run (so the writer's name derives from it), registered once however often it starts", () => {
    const dir = corpus();
    const env = { CLAUDE_CODE_SESSION_ID: "3de02220-5d69-4b5a-ac23-d66e14c0261b" };
    for (let i = 0; i < 3; i++) {
      expect(rewriteLoreStart(["bun", "run", ENTRY, "status"], { cwd: dir, env })?.env?.[HARNESS_RUN_ENV]).toBe("cc:3de02220-5d69-4b5a-ac23-d66e14c0261b");
    }
    expect(registeredRuns(dir)).toEqual(["cc:3de02220-5d69-4b5a-ac23-d66e14c0261b"]);
  });

  it("BOUNDARY: with no corpus yet (the `init` start) the run value is still set and nothing is registered or created", () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "known-party-spawn-empty-")));
    scratch.push(dir);
    const out = rewriteLoreStart(["bun", "run", ENTRY, "init"], { cwd: dir, env: {} });
    expect(out?.env?.[HARNESS_RUN_ENV]).toBe(DEFAULT_TEST_RUN);
  });

  it("NEGATIVE: LORE_TEST_IDENTITY=none leaves the start as written and removes the variable from the child's env", () => {
    const dir = corpus();
    const out = rewriteLoreStart(["bun", "run", ENTRY, "set", "x"], { cwd: dir, env: { [KNOWN_PARTY_OPT_OUT_ENV]: "none", HOME: "/h" } });
    expect(out?.argv).toEqual(["bun", "run", ENTRY, "set", "x"]);
    expect(out?.env).toEqual({ HOME: "/h" });
    expect(registeredRuns(dir)).toEqual([]);
  });

  it.each([
    ["an env that already carries a run value", ["bun", "run", ENTRY, "claim", "t"], { [HARNESS_RUN_ENV]: "cc:mine" }],
    ["the MCP server", ["bun", "run", ENTRY, "--mcp-server"], {}],
    ["a program that is not lore", ["git", "status"], {}],
    ["a lore entry deeper than the search depth", ["a", "b", "c", "d", "e", "f", "g", "h", ENTRY, "list"], {}],
  ])("NEGATIVE: %s is never rewritten", (_label, argv, env) => {
    expect(rewriteLoreStart(argv, { cwd: corpus(), env })).toBeUndefined();
  });

  it("REGRESSION: the env value spelling is core's", () => {
    expect(HARNESS_RUN_ENV).toBe(CORE_HARNESS_RUN_ENV);
  });
});

describe("rewriteNodeSpawnArgs", () => {
  it("rewrites (file, args, options) keeping args and trailing arguments; options gain the run, the opt-out variable is stripped", () => {
    const dir = corpus();
    const callback = (): void => undefined;
    const out = rewriteNodeSpawnArgs(["bun", ["run", ENTRY, "list"], { cwd: dir, env: { A: "1" } }]);
    expect(out).toEqual(["bun", ["run", ENTRY, "list"], { cwd: dir, env: { A: "1", [HARNESS_RUN_ENV]: DEFAULT_TEST_RUN } }]);
    expect(rewriteNodeSpawnArgs(["bun", ["run", ENTRY, "list"], { cwd: dir, env: {} }, callback])).toEqual([
      "bun",
      ["run", ENTRY, "list"],
      { cwd: dir, env: { [HARNESS_RUN_ENV]: DEFAULT_TEST_RUN } },
      callback,
    ]);
  });

  it("rewrites a compiled-binary start with no args array", () => {
    const dir = corpus();
    const out = rewriteNodeSpawnArgs(["/repo/dist/lore", { cwd: dir, env: {} }]);
    expect(out).toEqual(["/repo/dist/lore", [], { cwd: dir, env: { [HARNESS_RUN_ENV]: DEFAULT_TEST_RUN } }]);
  });

  it("an opted-out start keeps its env minus the variable", () => {
    const dir = corpus();
    const out = rewriteNodeSpawnArgs(["bun", ["run", ENTRY, "set"], { cwd: dir, env: { [KNOWN_PARTY_OPT_OUT_ENV]: "none", B: "2" } }]);
    expect(out).toEqual(["bun", ["run", ENTRY, "set"], { cwd: dir, env: { B: "2" } }]);
  });

  it("never rewrites a start that is not lore, or whose second argument is a callback", () => {
    expect(rewriteNodeSpawnArgs(["git", ["status"], {}])).toBeUndefined();
    expect(rewriteNodeSpawnArgs(["bun", () => undefined])).toBeUndefined();
  });
});
