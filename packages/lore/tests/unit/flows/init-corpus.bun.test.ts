/**
 * Tests for `initCorpusAt` (flows/init-corpus.ts, SPEC-046 §Design, task
 * AC-046-E) — the `.lore/` bootstrap logic shared by `lore setup --project`'s
 * injected `InitCorpus` thunk. Uses `createApp` (bun:sqlite), so this file
 * runs under `bun test`, never vitest.
 *
 * Every fixture is a `mkdtemp` scratch directory (2026-07-07
 * "never write to the repo's own corpus from a test" convention) — never the
 * real repo's own `.lore/`.
 *
 * Coverage:
 *   HAPPY:      a fresh repoDir gets `.lore/config.yaml` (correct
 *               project.name/author), `.lore/.gitignore`, and a migrated
 *               `.lore/lore.db`; custom `{name, author}` opts are honored
 *               over the repoDir-basename/"owner" defaults
 *   BOUNDARY:   a deeply nested, entirely nonexistent repoDir still succeeds
 *               (mkdirSync recursive creates every missing parent)
 *   ERROR:      repoDir pointing at a path whose PARENT is actually a
 *               regular file (not a directory) -> err(STORE_ERROR), no throw
 *   STATE:      calling initCorpusAt twice against the SAME repoDir succeeds
 *               both times (idempotent — no "already initialized" throw)
 *   REGRESSION: omitting `opts.name` derives the project name from repoDir's
 *               own basename (mirrors `commands/init.ts`'s default)
 *
 * @spec_ref AC-046-E
 */

import { describe, expect, it, afterEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parse as parseYaml } from "yaml";

import { initCorpusAt } from "../../../src/flows/init-corpus.js";

const scratchDirs: string[] = [];

function makeScratchDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratchDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (scratchDirs.length > 0) {
    const dir = scratchDirs.pop();
    if (dir === undefined) continue;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore cleanup errors */
    }
  }
});

// ─── HAPPY ────────────────────────────────────────────────────────────────────

describe("initCorpusAt — HAPPY", () => {
  it("bootstraps a fresh repoDir: config.yaml, .gitignore, migrated lore.db", async () => {
    const repoDir = makeScratchDir("init-corpus-happy-");

    const result = await initCorpusAt(repoDir);

    expect(result.ok).toBe(true);
    expect(existsSync(join(repoDir, ".lore", "config.yaml"))).toBe(true);
    expect(existsSync(join(repoDir, ".lore", ".gitignore"))).toBe(true);
    expect(existsSync(join(repoDir, ".lore", "lore.db"))).toBe(true);

    const configText = readFileSync(join(repoDir, ".lore", "config.yaml"), "utf8");
    const config = parseYaml(configText) as { project: { name: string; author: string } };
    expect(config.project.author).toBe("owner");
  });

  it("honors custom {name, author} opts over the defaults", async () => {
    const repoDir = makeScratchDir("init-corpus-custom-");

    const result = await initCorpusAt(repoDir, { name: "my-custom-project", author: "zheng" });

    expect(result.ok).toBe(true);
    const configText = readFileSync(join(repoDir, ".lore", "config.yaml"), "utf8");
    const config = parseYaml(configText) as { project: { name: string; author: string } };
    expect(config.project.name).toBe("my-custom-project");
    expect(config.project.author).toBe("zheng");
  });
});

// ─── BOUNDARY ─────────────────────────────────────────────────────────────────

describe("initCorpusAt — BOUNDARY", () => {
  it("a deeply nested, entirely nonexistent repoDir still succeeds", async () => {
    const scratch = makeScratchDir("init-corpus-nested-");
    const repoDir = join(scratch, "a", "b", "c", "repo");

    const result = await initCorpusAt(repoDir);

    expect(result.ok).toBe(true);
    expect(existsSync(join(repoDir, ".lore", "lore.db"))).toBe(true);
  });
});

// ─── ERROR ────────────────────────────────────────────────────────────────────

describe("initCorpusAt — ERROR", () => {
  it("repoDir whose parent is actually a regular file -> err(STORE_ERROR), never throws", async () => {
    const scratch = makeScratchDir("init-corpus-error-");
    const blockingFilePath = join(scratch, "not-a-directory");
    writeFileSync(blockingFilePath, "i am a file, not a directory");
    const repoDir = join(blockingFilePath, "repo");

    const result = await initCorpusAt(repoDir);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("STORE_ERROR");
    }
  });
});

// ─── STATE ────────────────────────────────────────────────────────────────────

describe("initCorpusAt — STATE", () => {
  it("calling initCorpusAt twice against the SAME repoDir succeeds both times", async () => {
    const repoDir = makeScratchDir("init-corpus-repeat-");

    const first = await initCorpusAt(repoDir);
    const second = await initCorpusAt(repoDir);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(existsSync(join(repoDir, ".lore", "lore.db"))).toBe(true);
  });
});

// ─── REGRESSION ───────────────────────────────────────────────────────────────

describe("initCorpusAt — REGRESSION", () => {
  it("omitting opts.name derives the project name from repoDir's own basename", async () => {
    const scratch = makeScratchDir("init-corpus-regression-");
    const repoDir = join(scratch, "my-repo-basename");
    mkdirSync(repoDir, { recursive: true });

    const result = await initCorpusAt(repoDir);

    expect(result.ok).toBe(true);
    const configText = readFileSync(join(repoDir, ".lore", "config.yaml"), "utf8");
    const config = parseYaml(configText) as { project: { name: string } };
    expect(config.project.name).toBe("my-repo-basename");
  });
});
