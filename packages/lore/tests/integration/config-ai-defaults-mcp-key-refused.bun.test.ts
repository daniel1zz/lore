// @spawns packages/lore/src/index.ts
/**
 * @layer lore-integration AC-RMCP-8
 * A project `.lore/config.yaml` that still sets the per-surface AI default key `mcp`
 * (`ai.default_per_surface.mcp`) is REFUSED loudly: `lore status` exits exactly 4 and stderr names the config file
 * and the key. The same config without that key runs (exit 0). The key was removed with the lore MCP server;
 * a config must never keep an inert setting that silently does nothing.
 *
 * Dimensions: NEGATIVE (the key is refused, exit 4, names file and key), HAPPY (without the key, exit 0),
 * BOUNDARY (a live surface key beside it is fine on its own), REGRESSION (the refusal writes nothing to stdout).
 *
 * @spec_ref AC-RMCP-8
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
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
    timeout: SPAWN_TIMEOUT_MS,
    killSignal: "SIGKILL",
  });
  return { stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), exitCode: proc.exitCode ?? -1 };
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lore-ai-mcp-key-"));
  const init = runLore(["init"], dir);
  if (init.exitCode !== 0) throw new Error(`lore init failed: ${init.stderr}`);
}, TEST_TIMEOUT_MS);

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("AC-RMCP-8: a config that still sets the mcp AI-default key fails loud", () => {
  it("lore status exits exactly 4 and names the config file and the key mcp", () => {
    patchLoreConfig(dir, { ai: { default_per_surface: { mcp: false } } });
    const result = runLore(["status"], dir);
    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain(".lore/config.yaml");
    expect(result.stderr).toContain("mcp");
    expect(result.stdout).toBe("");
  }, TEST_TIMEOUT_MS);

  it("the same config without the mcp key runs (exit 0)", () => {
    patchLoreConfig(dir, { ai: { default_per_surface: { cli: true } } });
    const result = runLore(["status"], dir);
    expect(result.exitCode).toBe(0);
  }, TEST_TIMEOUT_MS);

  it("a config with no per-surface section runs (exit 0)", () => {
    expect(runLore(["status"], dir).exitCode).toBe(0);
  }, TEST_TIMEOUT_MS);
});
