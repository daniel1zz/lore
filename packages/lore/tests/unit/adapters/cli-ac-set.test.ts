/**
 * BOUNDARY test for `lore ac set` (AC-ACS-3, spec-lore-ac-set-in-place-edit-of-a-
 * declared-acceptance D3/D5a) — no field flag exits 2, stderr names --statement, and
 * the document's version is unchanged (no empty write occurred).
 *
 * Spawns the REAL CLI (`bun run src/index.ts`, mirroring
 * cli-strict-flags-incidents.test.ts's proven subprocess pattern) against a
 * throwaway `lore init` corpus (never the repo's own `.lore/`, per project
 * CLAUDE.md). `commands/ac.ts` transitively imports `loader.ts` → `app.ts` →
 * `bun:sqlite`, which vitest cannot statically resolve (measured: importing
 * `commands/ac.ts` directly under vitest throws "Cannot find package 'bun:sqlite'")
 * — a live subprocess sidesteps that entirely, and is also the ONLY way to observe
 * the real argv-decidable exit-2 path this AC actually asserts (D5a: judged in the
 * command module BEFORE any service call, never a mocked equivalent).
 *
 * Coverage:
 *   BOUNDARY (AC-ACS-3): `lore ac set <spec> <id>` with zero field flags exits 2,
 *     stderr mentions `--statement`, and re-reading the spec's version afterward
 *     shows it unchanged — the version assertion is what distinguishes a genuine
 *     no-op from a "prints an error but writes anyway" false pass that the exit
 *     code alone would not catch.
 *
 * @spec_ref spec-lore-ac-set-in-place-edit-of-a-declared-acceptance D3 D5a AC-ACS-3
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "child_process";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// tests/unit/adapters/ → tests/unit/ → tests/ → packages/lore/
const PACKAGE_ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** Spawn `bun run <INDEX_TS> ...args` in `cwd` with an isolated HOME dir (mirrors cli-strict-flags-incidents.test.ts). */
function runLore(args: string[], cwd: string): RunResult {
  const result = spawnSync("bun", ["run", INDEX_TS, ...args], {
    cwd,
    env: { ...process.env, HOME: cwd, EDITOR: "true" },
    encoding: "utf8",
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status ?? 1,
  };
}

function extractSlug(stdout: string): string {
  const m = stdout.match(/Slug:\s+(\S+)/);
  const slug = m?.[1];
  if (!slug) throw new Error(`Could not extract slug from: ${stdout}`);
  return slug;
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(tmpdir(), `lore-ac-set-cli-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });

  const init = runLore(["init"], tmpDir);
  if (init.exitCode !== 0) {
    throw new Error(`lore init failed: ${init.stderr}`);
  }
});

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore cleanup errors */
  }
});

describe("BOUNDARY — `lore ac set` with zero field flags (AC-ACS-3)", () => {
  it("no field flag exits 2", () => {
    const prd = runLore(
      ["create", "prd", "--title", "AC Set CLI PRD", "--content", "root", "--no-ai"],
      tmpDir,
    );
    if (prd.exitCode !== 0) throw new Error(`create prd failed: ${prd.stderr}`);
    const prdSlug = extractSlug(prd.stdout);

    const spec = runLore(
      [
        "create",
        "spec",
        "--parent",
        prdSlug,
        "--title",
        "AC Set CLI Spec",
        "--content",
        "## Overview/Goal\nbody",
        "--no-ai",
      ],
      tmpDir,
    );
    if (spec.exitCode !== 0) throw new Error(`create spec failed: ${spec.stderr}`);
    const specSlug = extractSlug(spec.stdout);

    const added = runLore(
      [
        "ac",
        "add",
        specSlug,
        "AC-CLI-1",
        "--statement",
        "Rejects malformed input with a named field",
        "--mode",
        "script",
        "--oracle",
        "test",
        "--command",
        "bunx vitest run x.test.ts",
      ],
      tmpDir,
    );
    if (added.exitCode !== 0) throw new Error(`ac add failed: ${added.stderr}`);

    const before = runLore(["get", specSlug, "--json"], tmpDir);
    if (before.exitCode !== 0) throw new Error(`get (before) failed: ${before.stderr}`);
    const versionBefore = (JSON.parse(before.stdout) as { data: { doc: { version: number } } }).data.doc.version;

    const result = runLore(["ac", "set", specSlug, "AC-CLI-1"], tmpDir);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/--statement/);

    const after = runLore(["get", specSlug, "--json"], tmpDir);
    if (after.exitCode !== 0) throw new Error(`get (after) failed: ${after.stderr}`);
    const versionAfter = (JSON.parse(after.stdout) as { data: { doc: { version: number } } }).data.doc.version;
    expect(versionAfter).toBe(versionBefore);
  });
});
