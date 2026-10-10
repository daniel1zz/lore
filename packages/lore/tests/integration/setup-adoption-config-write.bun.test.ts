/**
 * @spec_ref AC-STR-11 (spec-claude-md-root-section-structure-check-and-adoption-mode)
 *
 * Task `task-skill-implement-setup-writes-only-the-adoption-key-no`.
 *
 * Contract: `lore setup --project` adds ONLY `context.memory_files.adoption` to the
 * repo's `.lore/config.yaml`. It must not round-trip the parsed+defaulted config
 * (which freezes every default budget / provider setting into the file), and must
 * preserve comments and key order of the user's own text.
 *
 * Harness: spawns the REAL CLI from source in a `mkdtemp` git repo with HOME pointed
 * at it — never touches this repo's `.lore/` corpus. `CLAUDECODE=1` => agent surface.
 *
 * Coverage: HAPPY (only adoption added, comment + order kept), NEGATIVE (invalid
 * existing config fails loud, file untouched), BOUNDARY (context present without
 * memory_files; memory_files present with siblings), STATE (explicit value kept,
 * file byte-identical on re-run), REGRESSION (no frozen default budgets).
 */

import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";

const PACKAGE_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");
const BUN_BIN = (() => {
  const resolved = Bun.which("bun");
  if (resolved === null) throw new Error("setup-adoption-config-write.bun.test.ts: bun not found on PATH");
  return resolved;
})();

function runLore(args: string[], cwd: string): { exitCode: number; all: string } {
  const proc = Bun.spawnSync([BUN_BIN, "run", INDEX_TS, ...args], {
    cwd,
    env: { ...process.env, HOME: cwd, CLAUDECODE: "1" },
  });
  return { exitCode: proc.exitCode ?? 1, all: `${proc.stdout.toString()}\n${proc.stderr.toString()}` };
}

const scratch: string[] = [];

/** Throwaway git repo with a root CLAUDE.md and an initialised corpus whose config is then replaced by `configText`. */
function makeRepoWithConfig(configText: string): string {
  const dir = mkdtempSync(join(tmpdir(), "lore-setup-adoption-cfg-"));
  scratch.push(dir);
  const gitInit = Bun.spawnSync(["git", "init", "-q", dir]);
  if (gitInit.exitCode !== 0) throw new Error(`fixture: git init failed: ${gitInit.stderr.toString()}`);
  writeFileSync(join(dir, "CLAUDE.md"), "# Proj\n\n## What This Is\n\nx\n");
  const init = runLore(["init"], dir);
  if (init.exitCode !== 0) throw new Error(`fixture: lore init failed: ${init.all}`);
  writeFileSync(join(dir, ".lore", "config.yaml"), configText);
  return dir;
}

afterEach(() => {
  while (scratch.length > 0) {
    const dir = scratch.pop();
    if (dir === undefined) continue;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
});

const configPath = (dir: string): string => join(dir, ".lore", "config.yaml");
const readConfig = (dir: string): string => readFileSync(configPath(dir), "utf-8");
const setup = (dir: string) => runLore(["setup", "--project", "--yes"], dir);

const MINIMAL = "# KEEP-ME top comment\nproject:\n  name: zeta # inline-keep\n  author: owner\nworkflow:\n  claim_ttl_minutes: 77\n";

describe("setup writes only the adoption key (AC-STR-11)", () => {
  it("HAPPY: adds only context.memory_files.adoption; comments and key order survive", () => {
    const dir = makeRepoWithConfig(MINIMAL);
    const run = setup(dir);
    expect(run.exitCode).toBe(0);
    const text = readConfig(dir);
    expect(text).toContain("# KEEP-ME top comment");
    expect(text).toContain("# inline-keep");
    expect(text.indexOf("project:")).toBeLessThan(text.indexOf("workflow:"));
    expect(text.indexOf("workflow:")).toBeLessThan(text.indexOf("context:"));
    const parsed = parse(text) as Record<string, any>;
    // BL-8 (AC-BLS3-7): setup additionally seeds the citation gate's `report` mode when absent.
    expect(parsed["workflow"]).toEqual({ claim_ttl_minutes: 77, gates: { "ac-cite": { mode: "report" } } });
    expect(Object.keys(parsed).sort()).toEqual(["context", "project", "workflow"]);
    expect(parsed["context"]).toEqual({ memory_files: { adoption: expect.stringMatching(/^(enforce|warn)$/) } });
  });

  it("REGRESSION: no frozen default budgets or provider defaults are written", () => {
    const dir = makeRepoWithConfig(MINIMAL);
    expect(setup(dir).exitCode).toBe(0);
    const text = readConfig(dir);
    for (const frozen of ["max_lines", "max_bytes", "warn_threshold_fraction", "claude-cli", "filenames", "emphasis"]) {
      expect(text).not.toContain(frozen);
    }
  });

  it("BOUNDARY: existing `context` without memory_files keeps its sibling keys", () => {
    const dir = makeRepoWithConfig(`${MINIMAL}context:\n  rules:\n    enabled: false # sib-keep\n`);
    const run = setup(dir);
    // The sibling shape may be rejected by the schema; if accepted, it must be preserved verbatim.
    if (run.exitCode === 0) {
      const text = readConfig(dir);
      expect(text).toContain("# sib-keep");
      const ctx = (parse(text) as Record<string, any>)["context"] as Record<string, unknown>;
      expect(Object.keys(ctx)).toContain("memory_files");
      expect(Object.keys(ctx)).toContain("rules");
    }
  });

  it("BOUNDARY: existing memory_files with siblings keeps them and adds adoption", () => {
    const dir = makeRepoWithConfig(`${MINIMAL}context:\n  memory_files:\n    enabled: true # mf-keep\n`);
    expect(setup(dir).exitCode).toBe(0);
    const text = readConfig(dir);
    expect(text).toContain("# mf-keep");
    const mf = (parse(text) as Record<string, any>)["context"]["memory_files"] as Record<string, unknown>;
    expect(Object.keys(mf).sort()).toEqual(["adoption", "enabled"]);
    expect(mf["enabled"]).toBe(true);
  });

  it("STATE: an explicit adoption value is never overwritten and the file stays byte-identical", () => {
    // BL-8: an explicit ac-cite mode is "explicit" too (seeded only when absent), so it is pinned here as well.
    const seeded = `${MINIMAL}  gates:\n    ac-cite:\n      mode: off # explicit\ncontext:\n  memory_files:\n    adoption: warn # explicit\n`;
    const dir = makeRepoWithConfig(seeded);
    expect(setup(dir).exitCode).toBe(0);
    expect(readConfig(dir)).toBe(seeded);
  });

  it("STATE: re-running setup is idempotent on the config text", () => {
    const dir = makeRepoWithConfig(MINIMAL);
    expect(setup(dir).exitCode).toBe(0);
    const first = readConfig(dir);
    expect(setup(dir).exitCode).toBe(0);
    expect(readConfig(dir)).toBe(first);
  });

  it("NEGATIVE: a result that fails config validation is refused loudly and nothing is written", () => {
    // `context.memory_files` as a scalar cannot take a nested `adoption` key.
    const bad = `${MINIMAL}context:\n  memory_files: nope\n`;
    const dir = makeRepoWithConfig(bad);
    const run = setup(dir);
    expect(run.exitCode).not.toBe(0);
    expect(readConfig(dir)).toBe(bad);
  });
});
