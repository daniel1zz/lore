// @spawns packages/lore/src/index.ts
/**
 * @spec_ref AC-STR-11 (spec-claude-md-root-section-structure-check-and-adoption-mode)
 *
 * Task `task-memory-file-limits-are-always-enforced-the-warn-adoption` (supersedes
 * `task-skill-implement-setup-writes-only-the-adoption-key-no`).
 *
 * Contract: `lore setup --project` writes NO memory-file setting (the adoption key is retired, limits are
 * always enforced). It must not round-trip the parsed+defaulted config (which freezes every default budget /
 * provider setting into the file), must preserve comments and key order of the user's own text, and must
 * refuse a config that still names the retired key, naming `lore migrate memory-limits --apply`.
 *
 * Harness: spawns the REAL CLI from source in a `mkdtemp` git repo with HOME pointed
 * at it — never touches this repo's `.lore/` corpus. `CLAUDECODE=1` => agent surface.
 *
 * Coverage: HAPPY (only adoption added, comment + order kept), NEGATIVE (invalid
 * existing config fails loud, file untouched), BOUNDARY (context present without
 * memory_files; memory_files present with siblings), STATE (explicit value kept,
 * file byte-identical on re-run), REGRESSION (no frozen default budgets).
 */

import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { initRepoWithMainCommit } from "./support/main-guard-repo.js";
import { patchLoreConfig } from "../helpers/patch-lore-config.js";

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
  initRepoWithMainCommit(dir); // setup refuses a main with no commit (BR-1343)
  writeFileSync(join(dir, "CLAUDE.md"), "# Proj\n\n## What This Is\n\nx\n");
  const init = runLore(["init"], dir);
  if (init.exitCode !== 0) throw new Error(`fixture: lore init failed: ${init.all}`);
  patchLoreConfig(dir, configText, { replace: true });
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

describe("setup writes no memory-file setting (AC-STR-11 superseded: the adoption key is retired)", () => {
  it("HAPPY: adds no `context` block at all; comments and key order survive; only the citation-gate seed is added", () => {
    const dir = makeRepoWithConfig(MINIMAL);
    const run = setup(dir);
    expect(run.exitCode).toBe(0);
    const text = readConfig(dir);
    expect(text).toContain("# KEEP-ME top comment");
    expect(text).toContain("# inline-keep");
    expect(text).not.toContain("adoption");
    const parsed = parse(text) as Record<string, any>;
    // BL-8 (AC-BLS3-7): setup additionally seeds the citation gate's `report` mode when absent.
    expect(parsed["workflow"]).toEqual({ claim_ttl_minutes: 77, gates: { "ac-cite": { mode: "report" } } });
    expect(Object.keys(parsed).sort()).toEqual(["project", "workflow"]);
  });

  it("REGRESSION: no frozen default budgets or provider defaults are written", () => {
    const dir = makeRepoWithConfig(MINIMAL);
    expect(setup(dir).exitCode).toBe(0);
    const text = readConfig(dir);
    for (const frozen of ["max_lines", "max_bytes", "warn_threshold_fraction", "claude-cli", "filenames", "emphasis"]) {
      expect(text).not.toContain(frozen);
    }
  });

  it("STATE: an existing memory_files block with siblings is left byte-identical", () => {
    // BL-8: an explicit ac-cite mode is "explicit" too (seeded only when absent), so it is pinned here as well.
    const seeded = `${MINIMAL}  gates:\n    ac-cite:\n      mode: off # explicit\ncontext:\n  memory_files:\n    enabled: true # mf-keep\n`;
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

  it("NEGATIVE: a config still naming the retired adoption setting is refused loudly, naming the migrate action, nothing written", () => {
    const retired = `${MINIMAL}context:\n  memory_files:\n    adoption: warn\n`;
    const dir = makeRepoWithConfig(retired);
    const run = setup(dir);
    expect(run.exitCode).not.toBe(0);
    expect(run.all).toContain("lore migrate memory-limits --apply");
    expect(readConfig(dir)).toBe(retired);
  });
});
