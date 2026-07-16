/**
 * Direct-behavior suite for the SPEC-046 P1 real `SetupService` port
 * implementations (`RealAssetSource`, `RealSetupFsReader`/`RealSetupFsWriter`,
 * `RealMcpRegistrar`). `setup-service.test.ts` (a sibling suite) exercises
 * `SetupService` exclusively against FAKE ports — this suite is the only
 * automated oracle these three concrete implementations get.
 *
 * ALL fixtures are `mkdtemp` scratch directories or a synthetic recording
 * `claude` shim script — NEVER the real `~/.claude` (mirrors this repo's
 * "never write to the repo's own corpus/real machine state from a test"
 * convention). The one exception is READ-ONLY: one HAPPY case points
 * `RealAssetSource` at this repo's own checked-in `assets/` tree to prove it
 * enumerates the real, shipped file set correctly (never writes to it).
 *
 * Coverage (spread across the three ports, per the task's six-dimension AC):
 *   HAPPY:      RealAssetSource enumerates the real repo assets/ tree
 *               correctly (kinds/counts/executable flags) AND a synthetic
 *               mkdtemp tree (path mapping); RealSetupFsWriter.write is
 *               atomic; RealMcpRegistrar.add/remove produce the correct argv
 *               against a recording shim
 *   NEGATIVE:   RealMcpRegistrar with `claude` unreachable (PATH="") returns
 *               err naming the exact manual command — never throws
 *   BOUNDARY:   RealAssetSource tolerates an EMPTY declared subdirectory
 *               (zero files, no error)
 *   ERROR:      RealAssetSource surfaces an unreadable/missing subdirectory
 *               as err(STORE_ERROR) — never a thrown exception
 *   STATE:      RealSetupFsWriter.backup creates the backup directory
 *               (mkdir -p) BEFORE writing the backup file into it
 *   REGRESSION: RealSetupFsWriter.write leaves no leftover `.tmp-*` sibling
 *               file after a successful write
 *
 * @spec_ref AC-046-E (task-skill-implement-real-setup-ports-asset-source-fs-mcp-regist)
 */

import { describe, it, expect, afterEach } from "vitest";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildMcpAddArgs, buildMcpRemoveArgs } from "@lore/core";
import type { LoreError } from "@lore/core";

import { RealAssetSource } from "../../../src/adapters/real-asset-source.js";
import { RealSetupFsReader, RealSetupFsWriter } from "../../../src/adapters/real-setup-fs.js";
import { RealMcpRegistrar } from "../../../src/adapters/real-mcp-registrar.js";

// ─── Shared fixtures ────────────────────────────────────────────────────────

const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "..");
const REPO_ASSETS_ROOT = join(REPO_ROOT, "assets");

/** Mirrors `assets-ssot.test.ts`'s declared manifest, restricted to this port's scope (NOT assets/project/). */
const DECLARED_FILES_IN_SCOPE = [
  "skills/lore/SKILL.md",
  "skills/lore-kickoff/SKILL.md",
  "skills/lore-session/SKILL.md",
  "skills/lore-session/references/knowledge-types.md",
  "skills/lore-doctor/SKILL.md",
  "skills/lore-autopilot/SKILL.md",
  "agents/lore-explorer.md",
  "agents/lore-planner.md",
  "agents/lore-implementer.md",
  "agents/lore-reviewer.md",
  "hooks/session-start-resume.mjs",
  "hooks/stop-doc-sync.mjs",
  "hooks/subagent-context.mjs",
  "hooks/pre-subagent-gate.mjs",
  "hooks/pre-no-general-agent-gate.mjs",
  "hooks/lore-gate-g1-spec-create.sh",
  "hooks/lore-gate-g2-spec-promote.sh",
  "hooks/lore-gate-g3-plan-promote.sh",
  "hooks/lore-gate-g4-task-claim.sh",
  "hooks/lib/turn-state.mjs",
  "governance/corpus-workflow.md",
  "governance/seat-briefing.md",
].sort();

const DECLARED_EXECUTABLE_PATHS = new Set([
  "hooks/lore-gate-g1-spec-create.sh",
  "hooks/lore-gate-g2-spec-promote.sh",
  "hooks/lore-gate-g3-plan-promote.sh",
  "hooks/lore-gate-g4-task-claim.sh",
  "hooks/session-start-resume.mjs",
  "hooks/subagent-context.mjs",
  "hooks/pre-no-general-agent-gate.mjs",
]);

const KIND_BY_TOP_DIR: Record<string, string> = {
  skills: "skill",
  agents: "agent",
  hooks: "hook",
  governance: "governance",
};

function sha256Hex(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * Awaits `fn()` and captures whether it rejected, WITHOUT ever re-throwing —
 * the only correct way to assert "this async method never throws" in a test.
 * `expect(asyncFn).not.toThrow()` is NOT sufficient for this: it only invokes
 * the function and checks for a SYNCHRONOUS throw, never awaiting the promise
 * the function returns, so a later rejection is silently missed.
 */
async function awaitNeverThrows<T>(fn: () => Promise<T>): Promise<{ value: T | undefined; thrown: unknown }> {
  try {
    return { value: await fn(), thrown: undefined };
  } catch (thrown) {
    return { value: undefined, thrown };
  }
}

/**
 * Narrows a `LoreError` union value to the member matching `code`, so the
 * caller can then access that member's own fields (e.g. `message`) without a
 * TS2339 error — `LoreError` is a discriminated union and several members
 * (e.g. `DOC_NOT_FOUND`) do not carry `message`, so `expect(error.code).toBe(...)`
 * alone does not narrow the STATIC type the way an `if` guard does. Fails the
 * test loudly (throws) if the code doesn't match, rather than silently
 * returning a mistyped value.
 */
function narrowErrorCode<C extends LoreError["code"]>(error: LoreError, code: C): Extract<LoreError, { code: C }> {
  if (error.code !== code) {
    throw new Error(`expected LoreError.code "${code}", got "${error.code}": ${JSON.stringify(error)}`);
  }
  return error as Extract<LoreError, { code: C }>;
}

/** Tracks every mkdtemp directory created by a test so `afterEach` can clean them all up unconditionally. */
const scratchDirs: string[] = [];

function makeScratchDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratchDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (scratchDirs.length > 0) {
    const dir = scratchDirs.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

// ─── RealAssetSource — HAPPY (real repo assets/) ───────────────────────────

describe("RealAssetSource — HAPPY (real repo assets/)", () => {
  it("enumerates exactly the P0-vendor declared set (skills/agents/hooks/governance, NOT project/)", async () => {
    const source = new RealAssetSource(REPO_ASSETS_ROOT);
    const result = await source.load();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const actualPaths = result.value.files.map((f) => f.path).sort();
    expect(actualPaths).toEqual(DECLARED_FILES_IN_SCOPE);
  });

  it("assigns the correct kind per top-level directory", async () => {
    const source = new RealAssetSource(REPO_ASSETS_ROOT);
    const result = await source.load();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    for (const file of result.value.files) {
      const topDir = file.path.split("/")[0] as string;
      expect(file.kind).toBe(KIND_BY_TOP_DIR[topDir]);
    }
  });

  it("marks exactly the declared .sh gate hooks + executable .mjs hooks as executable:true", async () => {
    const source = new RealAssetSource(REPO_ASSETS_ROOT);
    const result = await source.load();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const executablePaths = result.value.files.filter((f) => f.executable === true).map((f) => f.path).sort();
    expect(executablePaths).toEqual([...DECLARED_EXECUTABLE_PATHS].sort());
  });

  it("omits `executable` (never reports false) for non-executable files", async () => {
    const source = new RealAssetSource(REPO_ASSETS_ROOT);
    const result = await source.load();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const nonExecutable = result.value.files.filter((f) => !DECLARED_EXECUTABLE_PATHS.has(f.path));
    expect(nonExecutable.length).toBeGreaterThan(0);
    for (const file of nonExecutable) {
      expect(file.executable).toBeUndefined();
    }
  });
});

// ─── RealAssetSource — HAPPY (synthetic mkdtemp tree, path mapping) ────────

describe("RealAssetSource — HAPPY (synthetic tree, path mapping)", () => {
  it("maps a synthetic tree's files to the correct path/kind/content/sha256/executable", async () => {
    const root = makeScratchDir("asset-source-synthetic-");
    mkdirSync(join(root, "skills", "foo"), { recursive: true });
    mkdirSync(join(root, "agents"), { recursive: true });
    mkdirSync(join(root, "hooks"), { recursive: true });
    mkdirSync(join(root, "governance"), { recursive: true });

    writeFileSync(join(root, "skills", "foo", "SKILL.md"), "skill content");
    writeFileSync(join(root, "agents", "bar.md"), "agent content");
    writeFileSync(join(root, "hooks", "baz.sh"), "#!/bin/sh\necho hi\n");
    chmodSync(join(root, "hooks", "baz.sh"), 0o755);
    writeFileSync(join(root, "hooks", "qux.mjs"), "export const x = 1;\n");
    chmodSync(join(root, "hooks", "qux.mjs"), 0o644);
    writeFileSync(join(root, "governance", "gov.md"), "governance content");

    const source = new RealAssetSource(root);
    const result = await source.load();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const byPath = new Map(result.value.files.map((f) => [f.path, f] as const));
    expect([...byPath.keys()].sort()).toEqual(
      ["skills/foo/SKILL.md", "agents/bar.md", "hooks/baz.sh", "hooks/qux.mjs", "governance/gov.md"].sort(),
    );

    const skillFile = byPath.get("skills/foo/SKILL.md");
    expect(skillFile?.kind).toBe("skill");
    expect(skillFile?.content).toBe("skill content");
    expect(skillFile?.sha256).toBe(sha256Hex("skill content"));
    expect(skillFile?.executable).toBeUndefined();

    const agentFile = byPath.get("agents/bar.md");
    expect(agentFile?.kind).toBe("agent");

    const shHook = byPath.get("hooks/baz.sh");
    expect(shHook?.kind).toBe("hook");
    expect(shHook?.executable).toBe(true);

    const mjsHook = byPath.get("hooks/qux.mjs");
    expect(mjsHook?.executable).toBeUndefined();

    const governanceFile = byPath.get("governance/gov.md");
    expect(governanceFile?.kind).toBe("governance");
  });
});

// ─── RealAssetSource — BOUNDARY (empty subdir) ─────────────────────────────

describe("RealAssetSource — BOUNDARY (empty declared subdirectory)", () => {
  it("returns zero files for an empty subdirectory, without error", async () => {
    const root = makeScratchDir("asset-source-empty-subdir-");
    mkdirSync(join(root, "skills"), { recursive: true }); // empty — no files inside
    mkdirSync(join(root, "agents"), { recursive: true });
    mkdirSync(join(root, "hooks"), { recursive: true });
    mkdirSync(join(root, "governance"), { recursive: true });
    writeFileSync(join(root, "agents", "only.md"), "content");

    const source = new RealAssetSource(root);
    const result = await source.load();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.files.map((f) => f.path)).toEqual(["agents/only.md"]);
  });
});

// ─── RealAssetSource — ERROR (missing/unreadable subdir surfaces as err) ───

describe("RealAssetSource — ERROR (missing subdirectory surfaces as err, never thrown)", () => {
  it("returns err(STORE_ERROR) — does not throw — when a declared subdirectory is entirely absent", async () => {
    const root = makeScratchDir("asset-source-missing-subdir-");
    mkdirSync(join(root, "skills"), { recursive: true });
    mkdirSync(join(root, "agents"), { recursive: true });
    mkdirSync(join(root, "hooks"), { recursive: true });
    // governance/ deliberately never created.

    const source = new RealAssetSource(root);
    // reason: `expect(fn).not.toThrow()` only checks a SYNCHRONOUS throw — it never awaits an
    // async function's returned promise, so it would pass vacuously here even if `load()`
    // rejected. `awaitNeverThrows` below actually awaits the call and captures any rejection
    // explicitly, which is the only way to assert "never throws" for an async port method.
    const { value: result, thrown } = await awaitNeverThrows(() => source.load());

    expect(thrown).toBeUndefined();
    expect(result).toBeDefined();
    expect(result?.ok).toBe(false);
    if (result?.ok !== false) return;
    const error = narrowErrorCode(result.error, "STORE_ERROR");
    expect(error.message).toContain("governance");
  });
});

// ─── RealSetupFsReader ──────────────────────────────────────────────────────

describe("RealSetupFsReader", () => {
  it("HAPPY: read returns file content; stat reports exists + sha256", async () => {
    const root = makeScratchDir("fs-reader-happy-");
    const filePath = join(root, "file.txt");
    writeFileSync(filePath, "hello reader");

    const reader = new RealSetupFsReader();
    expect(await reader.read(filePath)).toBe("hello reader");

    const stat = await reader.stat(filePath);
    expect(stat.exists).toBe(true);
    expect(stat.sha256).toBe(createHash("sha256").update(readFileSync(filePath)).digest("hex"));
  });

  it("NEGATIVE: read returns null (not an error) for a nonexistent path", async () => {
    const root = makeScratchDir("fs-reader-negative-");
    const reader = new RealSetupFsReader();
    expect(await reader.read(join(root, "does-not-exist.txt"))).toBeNull();
  });

  it("BOUNDARY: stat reports exists:false (never throws) for a nonexistent path", async () => {
    const root = makeScratchDir("fs-reader-boundary-");
    const reader = new RealSetupFsReader();
    const stat = await reader.stat(join(root, "does-not-exist.txt"));
    expect(stat).toEqual({ exists: false });
  });
});

// ─── RealSetupFsWriter ──────────────────────────────────────────────────────

describe("RealSetupFsWriter — HAPPY (atomic write) + REGRESSION (no leftover tmp)", () => {
  it("writes the final content and leaves no leftover .tmp-* sibling file", async () => {
    const root = makeScratchDir("fs-writer-atomic-");
    const targetPath = join(root, "nested", "dir", "file.txt");
    const writer = new RealSetupFsWriter();

    await writer.write(targetPath, "final content, atomically written");

    expect(readFileSync(targetPath, "utf8")).toBe("final content, atomically written");

    const siblingNames = readdirSync(dirname(targetPath));
    const tmpSiblings = siblingNames.filter((name) => name.startsWith(`${basename(targetPath)}.tmp-`));
    expect(tmpSiblings).toEqual([]);
  });

  it("overwrites existing content fully (no stale trailing bytes from a shorter new write)", async () => {
    const root = makeScratchDir("fs-writer-overwrite-");
    const targetPath = join(root, "file.txt");
    const writer = new RealSetupFsWriter();

    await writer.write(targetPath, "a very long original piece of content");
    await writer.write(targetPath, "short");

    expect(readFileSync(targetPath, "utf8")).toBe("short");
  });

  it("chmods to 0o755 when opts.executable is true", async () => {
    const root = makeScratchDir("fs-writer-chmod-");
    const targetPath = join(root, "script.sh");
    const writer = new RealSetupFsWriter();

    await writer.write(targetPath, "#!/bin/sh\necho hi\n", { executable: true });

    expect(statSync(targetPath).mode & 0o777).toBe(0o755);
  });

  it("does not set the executable bit when opts.executable is omitted", async () => {
    const root = makeScratchDir("fs-writer-no-chmod-");
    const targetPath = join(root, "notes.md");
    const writer = new RealSetupFsWriter();

    await writer.write(targetPath, "just text");

    expect(statSync(targetPath).mode & 0o111).toBe(0);
  });

  it("mkdir creates missing parent directories (idempotent — a second call does not throw)", async () => {
    const root = makeScratchDir("fs-writer-mkdir-");
    const nested = join(root, "a", "b", "c");
    const writer = new RealSetupFsWriter();

    await writer.mkdir(nested);
    expect(statSync(nested).isDirectory()).toBe(true);

    await expect(writer.mkdir(nested)).resolves.toBeUndefined();
  });
});

describe("RealSetupFsWriter.backup — STATE (backup dir created before write) + byte/mode fidelity", () => {
  it("creates the backup destination directory before writing into it, preserving bytes and mode", async () => {
    const root = makeScratchDir("fs-writer-backup-");
    const srcPath = join(root, "source.sh");
    writeFileSync(srcPath, "#!/bin/sh\necho original\n");
    chmodSync(srcPath, 0o750);

    const destDir = join(root, ".lore-backups", "2026-07-16T00-00-00-000Z");
    expect(existsSync(destDir)).toBe(false);

    const writer = new RealSetupFsWriter();
    await writer.backup(srcPath, destDir);

    expect(statSync(destDir).isDirectory()).toBe(true);
    const backupPath = join(destDir, "source.sh");
    expect(readFileSync(backupPath, "utf8")).toBe(readFileSync(srcPath, "utf8"));
    expect(statSync(backupPath).mode & 0o777).toBe(statSync(srcPath).mode & 0o777);
  });
});

describe("RealSetupFsWriter.remove", () => {
  it("HAPPY: removes an existing file", async () => {
    const root = makeScratchDir("fs-writer-remove-file-");
    const target = join(root, "file.txt");
    writeFileSync(target, "content");

    const writer = new RealSetupFsWriter();
    await writer.remove(target);

    expect(existsSync(target)).toBe(false);
  });

  it("HAPPY: removes an existing directory recursively", async () => {
    const root = makeScratchDir("fs-writer-remove-dir-");
    const target = join(root, "dir");
    mkdirSync(join(target, "nested"), { recursive: true });
    writeFileSync(join(target, "nested", "file.txt"), "content");

    const writer = new RealSetupFsWriter();
    await writer.remove(target);

    expect(existsSync(target)).toBe(false);
  });

  it("BOUNDARY: a missing target is a no-op, not an error", async () => {
    const root = makeScratchDir("fs-writer-remove-missing-");
    const writer = new RealSetupFsWriter();
    await expect(writer.remove(join(root, "does-not-exist"))).resolves.toBeUndefined();
  });
});

// ─── RealMcpRegistrar ───────────────────────────────────────────────────────

/** Writes an executable shim named `claude` that records its argv (one per line) into `recorderPath` and exits 0. */
function writeClaudeRecorderShim(binDir: string, recorderPath: string): void {
  const shimPath = join(binDir, "claude");
  writeFileSync(shimPath, `#!/bin/sh\nprintf '%s\\n' "$@" > "${recorderPath}"\nexit 0\n`);
  chmodSync(shimPath, 0o755);
}

function readRecordedArgv(recorderPath: string): string[] {
  const raw = readFileSync(recorderPath, "utf8");
  return raw.split("\n").filter((line) => line.length > 0);
}

describe("RealMcpRegistrar — HAPPY (recording shim)", () => {
  it("add() invokes claude with buildMcpAddArgs(binPath)'s exact argv", async () => {
    const root = makeScratchDir("mcp-registrar-add-");
    const recorderPath = join(root, "recorded-argv.txt");
    writeClaudeRecorderShim(root, recorderPath);

    const registrar = new RealMcpRegistrar({ ...process.env, PATH: `${root}:${process.env["PATH"] ?? ""}` });
    const binPath = "/usr/local/bin/lore";
    const result = await registrar.add(binPath);

    expect(result.ok).toBe(true);
    expect(readRecordedArgv(recorderPath)).toEqual(buildMcpAddArgs(binPath));
  });

  it("remove() invokes claude with buildMcpRemoveArgs()'s exact argv", async () => {
    const root = makeScratchDir("mcp-registrar-remove-");
    const recorderPath = join(root, "recorded-argv.txt");
    writeClaudeRecorderShim(root, recorderPath);

    const registrar = new RealMcpRegistrar({ ...process.env, PATH: `${root}:${process.env["PATH"] ?? ""}` });
    const result = await registrar.remove();

    expect(result.ok).toBe(true);
    expect(readRecordedArgv(recorderPath)).toEqual(buildMcpRemoveArgs());
  });
});

describe("RealMcpRegistrar — NEGATIVE (claude absent from PATH)", () => {
  it("add() returns err naming the exact manual command, never throws", async () => {
    const registrar = new RealMcpRegistrar({ ...process.env, PATH: "" });
    const binPath = "/usr/local/bin/lore";

    // reason: see the AssetSource ERROR test above for why `expect(fn).not.toThrow()` cannot
    // be used to assert "an async method never throws" — it never awaits the callback.
    const { value: result, thrown } = await awaitNeverThrows(() => registrar.add(binPath));

    expect(thrown).toBeUndefined();
    expect(result).toBeDefined();
    expect(result?.ok).toBe(false);
    if (result?.ok !== false) return;
    const error = narrowErrorCode(result.error, "VALIDATION_ERROR");
    expect(error.message).toContain(`claude mcp add -s user lore -- ${binPath} --mcp-server`);
  });

  it("remove() returns err naming the exact manual command, never throws", async () => {
    const registrar = new RealMcpRegistrar({ ...process.env, PATH: "" });

    const { value: result, thrown } = await awaitNeverThrows(() => registrar.remove());

    expect(thrown).toBeUndefined();
    expect(result).toBeDefined();
    expect(result?.ok).toBe(false);
    if (result?.ok !== false) return;
    const error = narrowErrorCode(result.error, "VALIDATION_ERROR");
    expect(error.message).toContain("claude mcp remove -s user lore");
  });
});
