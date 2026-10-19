// @spawns packages/lore/src/index.ts
/**
 * The one-time `prd_sync` -> `cited_rule_check` config migration at the CLI loader (BL-D3, BR-226).
 *
 * A throwaway repo (`mkdtemp` + `lore init`) whose `.lore/config.yaml` still names `prd_sync`:
 *   - run from the checkout that OWNS the corpus: the file is rewritten once, ONE named notice goes to stderr, the
 *     command succeeds (exit 0), and the next run is silent;
 *   - run from a LINKED WORKTREE (the corpus resolves to the main checkout): the main checkout's config is NOT
 *     written, the command fails loud (exit 4) naming both keys, never falling back to default settings.
 * The repo's own `.lore/` is never touched.
 *
 * Dimensions: HAPPY (own tree), NEGATIVE (linked worktree refused), STATE (file bytes), REGRESSION (second run silent).
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const setDefaultTimeout = (ms: number): void => { vi.setConfig({ testTimeout: ms, hookTimeout: ms }); };
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

setDefaultTimeout(300_000);

const REPO_ROOT = new URL("../../../../../", import.meta.url).pathname.replace(/\/$/, "");
const ENTRY = join(REPO_ROOT, "packages", "lore", "src", "index.ts");
const ACTOR = "agent:config-prd-sync-rename-test";
const NOTICE_PREFIX = 'lore: workflow.gates."plan-close".prd_sync was renamed to workflow.gates."plan-close".cited_rule_check';

let dir = "";
let linked = "";

function runLore(cwd: string, args: string[]): { stdout: string; stderr: string; exitCode: number } {
  const env = { ...process.env, HOME: dir, CLAUDECODE: "1", LORE_ACTOR: ACTOR };
  const proc = Bun.spawnSync(["bun", "run", ENTRY, ...args], { cwd, env });
  return { stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), exitCode: proc.exitCode ?? 1 };
}

const configPath = (): string => join(dir, ".lore", "config.yaml");

function addOldKey(): string {
  const text = `${readFileSync(configPath(), "utf8").trimEnd()}\nworkflow:\n  gates:\n    plan-close:\n      prd_sync:\n        enabled: true\n`;
  writeFileSync(configPath(), text);
  return text;
}

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
});

afterAll(() => {
  if (dir !== "") rmSync(dir, { recursive: true, force: true });
  if (linked !== "") rmSync(join(linked, ".."), { recursive: true, force: true });
});

describe("prd_sync -> cited_rule_check at the CLI loader (BL-D3)", () => {
  it("NEGATIVE: a linked worktree never rewrites the main checkout's config; it fails loud (exit 4) naming both keys", () => {
    const text = addOldKey();
    const r = runLore(linked, ["status"]);
    expect(r.exitCode).toBe(4);
    expect(r.stderr).toContain("prd_sync");
    expect(r.stderr).toContain("cited_rule_check");
    expect(readFileSync(configPath(), "utf8")).toBe(text);
  });

  it("HAPPY+STATE: the owning checkout migrates once: exit 0, ONE named notice on stderr, only the key token changed", () => {
    const text = readFileSync(configPath(), "utf8");
    const r = runLore(dir, ["status"]);
    expect(r.exitCode).toBe(0);
    expect(r.stderr.split("\n").filter((l) => l.startsWith(NOTICE_PREFIX))).toHaveLength(1);
    expect(readFileSync(configPath(), "utf8")).toBe(text.replace("prd_sync", "cited_rule_check"));
  });

  it("REGRESSION: the next run is silent about the migration", () => {
    const r = runLore(dir, ["status"]);
    expect(r.exitCode).toBe(0);
    expect(r.stderr).not.toContain(NOTICE_PREFIX);
  });
});
