// @spawns packages/lore/src/index.ts
/**
 * The retired `workflow.gates."plan-close".cited_rule_check` key at the CLI (BR-1372: plan close is gated by the
 * milestone review only): the strict schema refuses it, `lore migrate config-keys` removes it.
 *
 * A throwaway repo (`mkdtemp` + `lore init`) whose `.lore/config.yaml` still carries the key:
 *   - ANY command (`lore status`) refuses with exit 4 naming the key, from the owning checkout AND from a linked
 *     worktree, and writes nothing;
 *   - `lore migrate config-keys` (dry run) reports the removal at exit 0 and writes nothing;
 *   - `--apply` from a linked worktree is refused (exit 4, foreign provenance): it never edits another checkout's config;
 *   - `--apply` from the owning checkout cuts only the key's lines, names the file, exits 0; a rerun is a no-op;
 *     `lore status` then runs (exit 0).
 * The repo's own `.lore/` is never touched.
 *
 * Dimensions: NEGATIVE (refusal, foreign apply), BOUNDARY (dry run), HAPPY+STATE (apply bytes), REGRESSION (rerun).
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const setDefaultTimeout = (ms: number): void => { vi.setConfig({ testTimeout: ms, hookTimeout: ms }); };
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { patchLoreConfig } from "../../helpers/patch-lore-config.js";

setDefaultTimeout(300_000);

const REPO_ROOT = new URL("../../../../../", import.meta.url).pathname.replace(/\/$/, "");
const ENTRY = join(REPO_ROOT, "packages", "lore", "src", "index.ts");
const ACTOR = "agent:config-retired-plan-close-keys-test";

let dir = "";
let linked = "";
let oldText = "";

function runLore(cwd: string, args: string[]): { stdout: string; stderr: string; exitCode: number } {
  const env = { ...process.env, HOME: dir, CLAUDECODE: "1", LORE_ACTOR: ACTOR };
  const proc = Bun.spawnSync(["bun", "run", ENTRY, ...args], { cwd, env });
  return { stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), exitCode: proc.exitCode ?? 1 };
}

const configPath = (): string => join(dir, ".lore", "config.yaml");

beforeAll(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "prdsyncrename-")));
  if (dir.startsWith(REPO_ROOT)) throw new Error("fixture must live outside the repo");
  const git = (args: string[]): void => void execFileSync("git", args, { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "pr@example.invalid"]);
  git(["config", "user.name", "prd sync rename"]);
  writeFileSync(join(dir, "README.md"), "fixture\n");
  git(["add", "."]);
  git(["commit", "-q", "-m", "init"]);
  const init = runLore(dir, ["init"]);
  if (init.exitCode !== 0) throw new Error(`lore init failed: ${init.stderr}${init.stdout}`);
  linked = join(realpathSync(mkdtempSync(join(tmpdir(), "prdsyncrename-wt-"))), "wt");
  git(["worktree", "add", "-q", "-b", "linked", linked]);
  // the retired key is merged into the seeded `workflow:` block (a second `workflow:` key would make the file unparsable, BR-926)
  patchLoreConfig(dir, "workflow:\n  gates:\n    plan-close:\n      cited_rule_check:\n        enabled: true\n");
  oldText = readFileSync(configPath(), "utf8");
});

afterAll(() => {
  if (dir !== "") rmSync(dir, { recursive: true, force: true });
  if (linked !== "") rmSync(join(linked, ".."), { recursive: true, force: true });
});

describe("retired plan-close key cited_rule_check at the CLI (BR-1372)", () => {
  it("NEGATIVE: loading a config with the retired key refuses with exit 4 naming it, from the owner and from a linked worktree; nothing is written", () => {
    for (const cwd of [dir, linked]) {
      const r = runLore(cwd, ["status"]);
      expect(r.exitCode).toBe(4);
      expect(r.stderr).toContain("cited_rule_check");
      expect(readFileSync(configPath(), "utf8")).toBe(oldText);
    }
  });

  it("BOUNDARY: `migrate config-keys` (dry run) reports the removal at exit 0 and writes nothing", () => {
    const r = runLore(dir, ["migrate", "config-keys"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain(`${configPath()}: workflow.gates."plan-close".cited_rule_check removed`);
    expect(readFileSync(configPath(), "utf8")).toBe(oldText);
  });

  it("NEGATIVE: --apply from a linked worktree is refused (exit 4) and never edits the owner's config", () => {
    const r = runLore(linked, ["migrate", "config-keys", "--apply"]);
    expect(r.exitCode).toBe(4);
    expect(r.stderr).toContain("Run it there");
    expect(readFileSync(configPath(), "utf8")).toBe(oldText);
  });

  it("HAPPY+STATE: --apply from the owner cuts only the key's lines, names the file, exits 0; `status` then runs", () => {
    const r = runLore(dir, ["migrate", "config-keys", "--apply"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain(configPath());
    const after = readFileSync(configPath(), "utf8");
    expect(after).not.toContain("cited_rule_check");
    // every surviving line is a line of the old file, in order: only lines were cut
    const oldLines = oldText.split("\n");
    let cursor = 0;
    for (const line of after.split("\n")) {
      const at = oldLines.indexOf(line, cursor);
      expect(at, `line survived out of order: ${line}`).toBeGreaterThanOrEqual(0);
      cursor = at + 1;
    }
    expect(runLore(dir, ["status"]).exitCode).toBe(0);
  });

  it("REGRESSION: a rerun of --apply changes nothing and reports no retired keys", () => {
    const after = readFileSync(configPath(), "utf8");
    const r = runLore(dir, ["migrate", "config-keys", "--apply"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain(`${configPath()}: no retired keys`);
    expect(readFileSync(configPath(), "utf8")).toBe(after);
  });
});
