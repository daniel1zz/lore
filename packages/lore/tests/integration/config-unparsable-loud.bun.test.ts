// @spawns packages/lore/src/index.ts
/**
 * @spec_ref BR-926
 *
 * A project `.lore/config.yaml` that does not parse (a duplicate top-level key) or fails the schema
 * is REFUSED on every route — CLI, MCP server, `lore serve` — with exit 4, naming the file and the
 * parser's own detail. It never falls back to built-in defaults in silence.
 *
 * This file writes a deliberately BROKEN config with raw bytes; that is the one legitimate raw write
 * (see the allowlist in `unit/test-config-writers-scan.test.ts`).
 *
 * Six-dimension coverage:
 *   NEGATIVE:   duplicate key -> `lore list` exit 4, names the file and the key, writes nothing
 *   ERROR:      MCP server and `lore serve` refuse to start with the same message
 *   BOUNDARY:   an absent config and an empty config still run on defaults (exit 0)
 *   STATE:      schema-invalid (not just unparsable) config is refused too
 *   REGRESSION: a valid patched config (via the helper) still loads (exit 0)
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { patchLoreConfig } from "../helpers/patch-lore-config.js";

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

const INDEX_TS = join(new URL("../../", import.meta.url).pathname.replace(/\/$/, ""), "src", "index.ts");
// reason: each case spawns bun subprocesses (~1-2s startup each).
const TEST_TIMEOUT_MS = 30_000;
const SPAWN_TIMEOUT_MS = 12_000;

function runLore(args: string[], cwd: string): RunResult {
  const proc = Bun.spawnSync(["bun", "run", INDEX_TS, ...args], {
    cwd,
    env: { ...process.env, HOME: cwd },
    stdin: "ignore",
    // reason: without the fix `serve` / `--mcp-server` START and never exit; the bound turns that into a red
    // assertion (exit code null -> 1... reported as -1 below) instead of a hung runner.
    timeout: SPAWN_TIMEOUT_MS,
    killSignal: "SIGKILL",
  });
  return { stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), exitCode: proc.exitCode ?? -1 };
}

/** Every file under `dir` with its size and mtime — a refused run must leave this identical. */
function snapshotTree(dir: string): string {
  const lines: string[] = [];
  const walk = (current: string): void => {
    for (const name of readdirSync(current).sort()) {
      const full = join(current, name);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else lines.push(`${full}|${st.size}|${st.mtimeMs}`);
    }
  };
  walk(dir);
  return lines.join("\n");
}

let dir: string;
let configPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lore-config-unparsable-"));
  const init = runLore(["init"], dir);
  if (init.exitCode !== 0) throw new Error(`lore init failed: ${init.stderr}`);
  configPath = join(dir, ".lore", "config.yaml");
}, TEST_TIMEOUT_MS);

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Appends a second `workflow:` block to the config `lore init` seeded — the duplicate key BR-926 is about. */
function breakWithDuplicateWorkflowKey(): void {
  const seeded = readFileSync(configPath, "utf8");
  expect(seeded, "init must seed a workflow: block, else the duplicate below is not a duplicate").toMatch(/^workflow:/m);
  appendFileSync(configPath, "\nworkflow:\n  gates:\n    task-claim:\n      enabled: false\n");
}

describe("an unparsable project config is refused loudly (BR-926)", () => {
  it("lore list exits 4, names .lore/config.yaml and the duplicate key, and writes nothing", () => {
    breakWithDuplicateWorkflowKey();
    const before = snapshotTree(join(dir, ".lore"));

    const result = runLore(["list"], dir);

    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain(".lore/config.yaml");
    expect(result.stderr).toContain("Map keys must be unique");
    expect(result.stderr).toContain("workflow");
    expect(result.stdout).toBe("");
    expect(snapshotTree(join(dir, ".lore"))).toBe(before);
  }, TEST_TIMEOUT_MS);

  it("the MCP server refuses to start with the same message", () => {
    breakWithDuplicateWorkflowKey();
    const result = runLore(["--mcp-server"], dir);
    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain(".lore/config.yaml");
    expect(result.stderr).toContain("Map keys must be unique");
  }, TEST_TIMEOUT_MS);

  it("lore serve refuses to start with the same message", () => {
    breakWithDuplicateWorkflowKey();
    const result = runLore(["serve", "--port", "48931"], dir);
    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain(".lore/config.yaml");
    expect(result.stderr).toContain("Map keys must be unique");
  }, TEST_TIMEOUT_MS);

  it("a sync section that is switched on without an address is refused (exit 4), never run on the local file", () => {
    appendFileSync(configPath, "\nsync:\n  enabled: true\n");
    const result = runLore(["list"], dir);
    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain(".lore/config.yaml");
    expect(result.stderr).toContain("sync");
  }, TEST_TIMEOUT_MS);

  it("a schema-invalid config (unknown top-level key) is refused too, naming the file", () => {
    appendFileSync(configPath, "\nnot_a_real_section:\n  x: 1\n");
    const result = runLore(["list"], dir);
    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain(".lore/config.yaml");
  }, TEST_TIMEOUT_MS);
});

describe("an absent or empty config still means defaults, and a patched config loads", () => {
  it("no config file at all: lore list exits 0", () => {
    rmSync(configPath);
    expect(runLore(["list"], dir).exitCode).toBe(0);
  }, TEST_TIMEOUT_MS);

  it("an empty config file: lore list exits 0", () => {
    writeFileSync(configPath, "");
    expect(runLore(["list"], dir).exitCode).toBe(0);
  }, TEST_TIMEOUT_MS);

  it("the seeded config patched through the helper keeps one workflow key and loads", () => {
    patchLoreConfig(dir, "workflow:\n  gates:\n    task-claim:\n      enabled: false\n");
    const text = readFileSync(configPath, "utf8");
    expect(text.match(/^workflow:/gm)?.length).toBe(1);
    expect(runLore(["list"], dir).exitCode).toBe(0);
  }, TEST_TIMEOUT_MS);
});

describe("the patch helper itself", () => {
  it("refuses to patch a file that does not parse instead of repairing it in silence", () => {
    breakWithDuplicateWorkflowKey();
    expect(() => patchLoreConfig(dir, { project: { name: "x" } })).toThrow(/unique/i);
  });

  it("deep-merges objects and replaces arrays", () => {
    const scratch = mkdtempSync(join(tmpdir(), "lore-patch-helper-"));
    try {
      mkdirSync(join(scratch, ".lore"), { recursive: true });
      patchLoreConfig(scratch, { a: { keep: 1, list: [1, 2] } });
      patchLoreConfig(scratch, { a: { add: 2, list: [3] } });
      expect(readFileSync(join(scratch, ".lore", "config.yaml"), "utf8")).toBe("a:\n  keep: 1\n  list:\n    - 3\n  add: 2\n");
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
