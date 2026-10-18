// @reads assets/**
// @spawns packages/lore/src/index.ts
/**
 * INT-T5: lore commands that write TRACKED repository files write them into the invoking working tree,
 * while corpus access still resolves the shared corpus (adr-main-advances-only-by-lore-integrate-per-session,
 * "Corpus home"; spec-corpus-resolution-carries-provenance-and-a-foreign-write M4 stays).
 *
 * Harness: `runLoreInProcess` against `mkdtemp` throwaway repos (main checkout holding the only lore.db plus a
 * linked worktree), HOME pointed at the throwaway dir; never this repository's `.lore/` or CLAUDE.md.
 *
 * Coverage: HAPPY (each command family changes the worktree and leaves the main checkout's bytes identical),
 * BOUNDARY (a subdirectory of the worktree still writes at the worktree toplevel), STATE (corpus reads still
 * resolve the shared corpus), NEGATIVE (a directory outside any git working tree keeps today's behaviour).
 */

import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { runLoreInProcess } from "../helpers/run-lore-in-process";

const scratch: string[] = [];

afterEach(() => {
  while (scratch.length > 0) {
    const dir = scratch.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

async function runLore(args: string[], cwd: string, home: string) {
  const env: Record<string, string | undefined> = { ...process.env, HOME: home, CLAUDECODE: "1" };
  delete env["ANTHROPIC_API_KEY"];
  delete env["OPENAI_API_KEY"];
  delete env["LORE_AI_DEFAULT"];
  return runLoreInProcess(args, { cwd, env });
}

function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${String(result.stderr)}`);
  return String(result.stdout);
}

function put(dir: string, rel: string, content: string): void {
  const full = join(dir, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

/** Every file under `dir` (excluding `.git`, the corpus db and its WAL files) mapped to its bytes. */
function snapshot(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (current: string): void => {
    for (const name of readdirSync(current)) {
      if (name === ".git" || name.startsWith("lore.db") || name === "local-key") continue;
      const full = join(current, name);
      if (statSync(full).isDirectory()) walk(full);
      else out.set(full.slice(dir.length), readFileSync(full, "utf8"));
    }
  };
  walk(dir);
  return out;
}

interface Fixture {
  readonly home: string;
  readonly main: string;
  readonly worktree: string;
}

/** Main checkout with the corpus + one committed baseline, plus a linked worktree OUTSIDE it. */
async function makeFixture(): Promise<Fixture> {
  const home = mkdtempSync(join(tmpdir(), "lore-int-t5-"));
  scratch.push(home);
  const main = join(home, "main");
  mkdirSync(main);
  git(main, ["init", "-q", "-b", "main"]);
  git(main, ["config", "user.email", "t@example.com"]);
  git(main, ["config", "user.name", "t"]);
  const init = await runLore(["init"], main, home);
  if (init.exitCode !== 0) throw new Error(`lore init failed: ${init.stderr}`);
  const ctx = await runLore(["context", "init", "--no-ai"], main, home);
  if (ctx.exitCode !== 0) throw new Error(`lore context init failed: ${ctx.stderr}`);
  put(main, "README.md", "x\n");
  git(main, ["add", "-A"]);
  git(main, ["commit", "-q", "-m", "baseline"]);
  const worktree = join(home, "wt");
  git(main, ["worktree", "add", "-q", "-b", "session", worktree]);
  return { home, main, worktree };
}

describe("INT-T5 tracked-file writes land in the invoking working tree", () => {
  it("INT-T5 context refresh from a linked worktree rewrites the worktree CLAUDE.md and leaves the main checkout identical", async () => {
    const { home, main, worktree } = await makeFixture();
    put(worktree, "src/widget/CLAUDE.md", "# Module: widget\n\n## Purpose\n\nWidget things.\n");
    const before = snapshot(main);
    const worktreeClaudeBefore = readFileSync(join(worktree, "CLAUDE.md"), "utf8");

    const refreshed = await runLore(["context", "refresh"], worktree, home);
    expect(refreshed.exitCode, refreshed.stderr).toBe(0);

    expect(readFileSync(join(worktree, "CLAUDE.md"), "utf8")).not.toBe(worktreeClaudeBefore);
    expect(readFileSync(join(worktree, "CLAUDE.md"), "utf8")).toContain("src/widget");
    expect(snapshot(main)).toEqual(before);
  }, 60_000);

  it("INT-T5 context refresh from a subdirectory of the worktree writes at the worktree toplevel", async () => {
    const { home, main, worktree } = await makeFixture();
    const before = snapshot(main);
    put(worktree, "deep/dir/CLAUDE.md", "# Module: dir\n\n## Purpose\n\nDir things.\n");
    const refreshed = await runLore(["context", "refresh"], join(worktree, "deep", "dir"), home);
    expect(refreshed.exitCode, refreshed.stderr).toBe(0);
    expect(readFileSync(join(worktree, "CLAUDE.md"), "utf8")).toContain("deep/dir");
    expect(snapshot(main)).toEqual(before);
  }, 60_000);

  it("INT-T5 audit anchor from a linked worktree pins the head in the worktree while the chain head comes from the shared corpus", async () => {
    const { home, main, worktree } = await makeFixture();
    const created = await runLore(["create", "prd", "--title", "Anchor seed", "--no-ai", "--content", "seed"], main, home);
    expect(created.exitCode, created.stderr).toBe(0);
    const before = snapshot(main);

    const anchored = await runLore(["audit", "anchor", "--json"], worktree, home);
    expect(anchored.exitCode, anchored.stderr).toBe(0);
    const anchorPath = join(worktree, ".lore", "audit-anchor.json");
    expect(existsSync(anchorPath)).toBe(true);
    expect(JSON.parse(readFileSync(anchorPath, "utf8")).entry_count).toBeGreaterThan(0);
    expect(snapshot(main)).toEqual(before);

    const verified = await runLore(["audit", "--verify"], worktree, home);
    expect(verified.exitCode, verified.stderr).toBe(0);
  }, 60_000);

  it("INT-T5 export-docs from a linked worktree mirrors into the worktree and leaves the main checkout identical", async () => {
    const { home, main, worktree } = await makeFixture();
    const created = await runLore(["create", "prd", "--title", "Mirror seed", "--no-ai", "--content", "# Mirror seed\n\nbody"], main, home);
    expect(created.exitCode, created.stderr).toBe(0);
    const before = snapshot(main);

    const exported = await runLore(["export-docs"], worktree, home);
    expect(exported.exitCode, exported.stderr).toBe(0);
    expect(existsSync(join(worktree, ".lore", "export-index.json"))).toBe(true);
    expect(existsSync(join(worktree, "docs", "requirements"))).toBe(true);
    expect(snapshot(main)).toEqual(before);
  }, 60_000);

  it("INT-T5 migrate ordinals --apply from a linked worktree reconciles the worktree export-index only", async () => {
    const { home, main, worktree } = await makeFixture();
    const created = await runLore(["create", "adr", "--title", "Ordinal seed", "--decision-status", "accepted", "--no-ai", "--content", "# Ordinal seed\n\nbody"], main, home);
    expect(created.exitCode, created.stderr).toBe(0);
    const exported = await runLore(["export-docs"], main, home);
    expect(exported.exitCode, exported.stderr).toBe(0);
    git(main, ["add", "-A"]);
    git(main, ["commit", "-q", "-m", "mirrored"]);
    git(worktree, ["merge", "-q", "main"]);
    const indexPath = join(worktree, ".lore", "export-index.json");
    // Drift only the worktree's tracked copy: a migration that reads the main checkout's index sees nothing to fix.
    writeFileSync(indexPath, readFileSync(indexPath, "utf8").replace(/ADR-001/g, "ADR-007"));
    const before = snapshot(main);
    const migrated = await runLore(["migrate", "ordinals", "--apply"], worktree, home);
    expect(migrated.exitCode, migrated.stderr).toBe(0);
    expect(readFileSync(indexPath, "utf8")).toContain("ADR-001");
    expect(readFileSync(indexPath, "utf8")).not.toContain("ADR-007");
    expect(snapshot(main)).toEqual(before);
  }, 60_000);

  it("INT-T5 setup --project run from a subdirectory of a linked worktree scaffolds the worktree toplevel only", async () => {
    const { home, main, worktree } = await makeFixture();
    const before = snapshot(main);
    mkdirSync(join(worktree, "sub"), { recursive: true });

    const scaffolded = await runLore(["setup", "--project", "--yes"], join(worktree, "sub"), home);
    expect(scaffolded.exitCode, scaffolded.stderr).toBe(0);
    expect(existsSync(join(worktree, ".lore", ".lore-project-manifest.json"))).toBe(true);
    expect(existsSync(join(worktree, "sub", ".lore"))).toBe(false);
    expect(snapshot(main)).toEqual(before);
  }, 120_000);

  it("INT-T5 outside any git working tree the tracked-file root stays the corpus root", async () => {
    const home = mkdtempSync(join(tmpdir(), "lore-int-t5-nogit-"));
    scratch.push(home);
    const init = await runLore(["init"], home, home);
    expect(init.exitCode, init.stderr).toBe(0);
    const ctx = await runLore(["context", "init", "--no-ai"], home, home);
    expect(ctx.exitCode, ctx.stderr).toBe(0);
    put(home, "src/gadget/CLAUDE.md", "# Module: gadget\n\n## Purpose\n\nGadget things.\n");
    const refreshed = await runLore(["context", "refresh"], home, home);
    expect(refreshed.exitCode, refreshed.stderr).toBe(0);
    expect(readFileSync(join(home, "CLAUDE.md"), "utf8")).toContain("src/gadget");
  }, 60_000);
});
