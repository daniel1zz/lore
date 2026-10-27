// @reads assets/project/lore-config-template.yaml
// @reads packages
// @reads scripts/check-unclaimed-oracle.ts
// @spawns packages/lore/src/index.ts
/**
 * @spec_ref AC-RMCP-7
 * @task task-skill-implement-user-facing-messages-name-no-mcp-surface
 * Spec: spec-remove-the-lore-mcp-server (D4, BR-1016)
 *
 * `lore status --json` reports AI defaults for the surfaces that still exist (cli, agent, http_cookie,
 * http_token) and no `mcp` entry, even when the config still sets the legacy `ai.default_per_surface.mcp` key
 * (the key is read for compatibility, never reported).
 *
 * Oracle: the real command tree over a throwaway corpus (`mkdtemp` + `lore init`); the live .lore is never touched.
 */

import { afterAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { patchLoreConfig } from "../../helpers/patch-lore-config.js";
import { FIXTURE_HOME_OUTSIDE_REPO, makeCleanTreeRepo } from "../../helpers/clean-tree-repo";
import { runLoreInProcess } from "../../helpers/run-lore-in-process";

vi.setConfig({ testTimeout: 300_000, hookTimeout: 300_000 });

const dirsToClean: string[] = [];
afterAll(() => {
  for (const dir of dirsToClean) rmSync(dir, { recursive: true, force: true });
});

async function runLore(dir: string, args: string[]) {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined || /^(CLAUDE|LORE|ANTHROPIC)/.test(key)) continue;
    env[key] = value;
  }
  return runLoreInProcess(args, {
    cwd: dir,
    home: FIXTURE_HOME_OUTSIDE_REPO,
    env: { ...env, HOME: FIXTURE_HOME_OUTSIDE_REPO, CLAUDE_CODE_SESSION_ID: "rmcp7fixture", EDITOR: "true" },
  });
}

async function makeCorpus(): Promise<string> {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "lore-ai-surfaces-")));
  dirsToClean.push(dir);
  makeCleanTreeRepo(dir);
  const init = await runLore(dir, ["init"]);
  expect(init.exitCode).toBe(0);
  return dir;
}

async function aiDefaults(dir: string): Promise<Record<string, boolean>> {
  const status = await runLore(dir, ["status", "--json"]);
  expect(status.exitCode).toBe(0);
  const parsed = JSON.parse(status.stdout) as { data: { ai_defaults: Record<string, boolean> } };
  return parsed.data.ai_defaults;
}

describe("AC-RMCP-7 lore status AI defaults", () => {
  it("AC-RMCP-7 reports cli, agent, http_cookie, http_token and no mcp", async () => {
    const defaults = await aiDefaults(await makeCorpus());
    expect(Object.keys(defaults).sort()).toEqual(["agent", "cli", "http_cookie", "http_token"]);
    expect(defaults).not.toHaveProperty("mcp");
  });

  it("AC-RMCP-7 still exits 0 when the config sets the legacy mcp key, and does not report it", async () => {
    const dir = await makeCorpus();
    patchLoreConfig(dir, { ai: { default_per_surface: { mcp: true } } });
    const defaults = await aiDefaults(dir);
    expect(Object.keys(defaults).sort()).toEqual(["agent", "cli", "http_cookie", "http_token"]);
  });
});
