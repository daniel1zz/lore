// @spawns packages/lore/src/index.ts
/**
 * The `prd_sync` -> `cited_rule_check` config rename at the CLI (BL-D3, BR-226): the loader refuses, the migration renames.
 *
 * A throwaway repo (`mkdtemp` + `lore init`) whose `.lore/config.yaml` still names `prd_sync`:
 *   - ANY command (`lore status`) refuses with exit 4 and the exact message naming both keys and
 *     `lore migrate config-keys --apply`, from the owning checkout AND from a linked worktree, and writes nothing;
 *   - `lore migrate config-keys` (dry run) reports the rename at exit 0 and writes nothing;
 *   - `--apply` from a linked worktree is refused (exit 4, foreign provenance): it never edits another checkout's config;
 *   - `--apply` from the owning checkout renames the key byte-for-byte (only the key text changes), names the file,
 *     exits 0; a rerun is a no-op; `lore status` then runs (exit 0).
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
const ACTOR = "agent:config-prd-sync-rename-test";
const REFUSAL =
  'workflow.gates."plan-close".prd_sync was renamed to workflow.gates."plan-close".cited_rule_check ' +
  "(it switches the cited-rule check, not outline sync); run `lore migrate config-keys --apply` to rename it in .lore/config.yaml.";

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
  patchLoreConfig(dir, "workflow:\n  gates:\n    plan-close:\n      prd_sync:\n        enabled: true\n");
  oldText = readFileSync(configPath(), "utf8");
});

afterAll(() => {
  if (dir !== "") rmSync(dir, { recursive: true, force: true });
  if (linked !== "") rmSync(join(linked, ".."), { recursive: true, force: true });
});

describe("prd_sync -> cited_rule_check at the CLI (BL-D3)", () => {
  it("NEGATIVE: loading an old-key config refuses with exit 4 and the exact text, from the owner and from a linked worktree; nothing is written", () => {
    for (const cwd of [dir, linked]) {
      const r = runLore(cwd, ["status"]);
      expect(r.exitCode).toBe(4);
      expect(r.stderr).toContain(REFUSAL);
      expect(readFileSync(configPath(), "utf8")).toBe(oldText);
    }
  });

  it("BOUNDARY: `migrate config-keys` (dry run) reports the rename at exit 0 and writes nothing", () => {
    const r = runLore(dir, ["migrate", "config-keys"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain(`${configPath()}: workflow.gates."plan-close".prd_sync renamed to workflow.gates."plan-close".cited_rule_check (enabled: true kept)`);
    expect(readFileSync(configPath(), "utf8")).toBe(oldText);
  });

  it("NEGATIVE: --apply from a linked worktree is refused (exit 4) and never edits the owner's config", () => {
    const r = runLore(linked, ["migrate", "config-keys", "--apply"]);
    expect(r.exitCode).toBe(4);
    expect(r.stderr).toContain("Run it there");
    expect(readFileSync(configPath(), "utf8")).toBe(oldText);
  });

  it("HAPPY+STATE: --apply from the owner renames only the key text, names the file, exits 0; `status` then runs", () => {
    const r = runLore(dir, ["migrate", "config-keys", "--apply"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain(configPath());
    expect(readFileSync(configPath(), "utf8")).toBe(oldText.replace("prd_sync", "cited_rule_check"));
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
