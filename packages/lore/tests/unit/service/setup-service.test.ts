/**
 * Six-dimension + invariant (I1-I5, I6 safety-guard) tests for SetupService
 * (SPEC-046 §Design, AC-046-B). Every scenario except the STATE/REGRESSION
 * roundtrips uses hand-built in-memory fakes (`MapFs`, `FixedAssetSource`,
 * `OkMcpRegistrar`/`FailingMcpRegistrar`) — no real filesystem, no store.
 *
 * The STATE and REGRESSION roundtrip tests use a THROWAWAY test-local real-fs
 * port (`node:fs/promises` against an `os.tmpdir()` mkdtemp dir) defined ONLY
 * in this file — this is deliberately NOT the production `real-setup-fs.ts`
 * (a downstream task, blocked by this one; faking the roundtrip would defeat
 * the byte-identical-restore invariant it exists to prove).
 *
 * Dimension mapping:
 *   HAPPY:      fresh install writes every asset, merges settings.json,
 *                registers mcp, and the manifest's sha256 per entry equals
 *                sha256 of the FINAL on-disk bytes (I5, reinforced by its own
 *                dedicated describe block below)
 *   NEGATIVE:   I1 — malformed existing settings.json aborts install with
 *                ZERO SetupFsWriter calls; uninstall with no manifest present
 *                fails loud (nothing to uninstall)
 *   BOUNDARY:   I2 — a byte-identical re-run reports every entry skipped and
 *                fires ZERO SetupFsWriter calls (including the manifest
 *                itself); an empty asset payload still installs successfully
 *   ERROR:      fault injection — write #2 of 3 throws: file 1 committed,
 *                file 3 never attempted, the error names the partial state,
 *                the manifest is NOT written; a subsequent re-run converges
 *                (I2's general form); an MCP registrar failure is non-fatal
 *                (`receipt.mcp === "failed"`, overall Result stays `ok`, file
 *                writes stand)
 *   STATE:      I3 — real mkdtemp fs: install() → uninstall() roundtrip
 *                restores a pre-existing foreign `settings.json` byte-
 *                identically and leaves the manifest/backups dir absent
 *   REGRESSION: foreign, non-lore `settings.json` top-level keys AND foreign
 *                hook entries under an unrelated event survive
 *                install()+uninstall() byte-identical
 *
 * I4 ("planInstall is reader-only") and I6 (the test-pollution safety guard)
 * each get their own dedicated describe block, outside the six-dimension grid.
 *
 * @spec_ref SPEC-046 §Design, §Acceptance Criteria AC-046-B, invariants I1-I5
 */

import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import fsp from "node:fs/promises";
import { describe, it, expect } from "vitest";
import { ok, err, buildHookSettingsEntries } from "@lore/core";
import type { Result, LoreError, AssetPayload, SettingsHookEntry } from "@lore/core";
import {
  SetupService,
  assertSafeTargetDir,
  type AssetSource,
  type SetupFsReader,
  type SetupFsWriter,
  type McpAddOutcome,
  type McpRegistrar,
} from "../../../src/service/setup-service.js";

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/** A non-existent, non-real path used by every in-memory-fake scenario — never touches the real filesystem. */
const TARGET_DIR = "/fake-target/claude-dir";

// ─── Fakes ──────────────────────────────────────────────────────────────────

class FixedAssetSource implements AssetSource {
  constructor(private readonly payload: AssetPayload) {}
  async load(): Promise<Result<AssetPayload, LoreError>> {
    return ok(this.payload);
  }
}

/**
 * In-memory fs double implementing BOTH `SetupFsReader` and `SetupFsWriter`,
 * backed by one `Map<absolutePath, content>` — reader calls see whatever the
 * writer half has stored, mirroring a real filesystem's single source of truth.
 */
class MapFs implements SetupFsReader, SetupFsWriter {
  readonly store = new Map<string, string>();
  readonly executableFlags = new Map<string, boolean>();
  readonly readerCalls: string[] = [];
  readonly writerCalls: string[] = [];
  /** 1-indexed `write()` call number to throw on — fault-injection knob. */
  failWriteOnCall: number | undefined;
  private writeCallCount = 0;

  seed(absolutePath: string, content: string): void {
    this.store.set(absolutePath, content);
  }

  async read(p: string): Promise<string | null> {
    this.readerCalls.push(`read:${p}`);
    return this.store.has(p) ? (this.store.get(p) as string) : null;
  }

  async stat(p: string): Promise<{ exists: boolean; sha256?: string }> {
    this.readerCalls.push(`stat:${p}`);
    if (!this.store.has(p)) return { exists: false };
    return { exists: true, sha256: sha256(this.store.get(p) as string) };
  }

  async write(p: string, content: string, opts?: { executable?: boolean }): Promise<void> {
    this.writeCallCount += 1;
    this.writerCalls.push(`write:${p}`);
    if (this.failWriteOnCall === this.writeCallCount) {
      throw new Error(`simulated write failure on call #${this.writeCallCount} for "${p}"`);
    }
    this.store.set(p, content);
    if (opts?.executable) this.executableFlags.set(p, true);
  }

  async mkdir(p: string): Promise<void> {
    this.writerCalls.push(`mkdir:${p}`);
  }

  async backup(src: string, destDir: string): Promise<void> {
    this.writerCalls.push(`backup:${src}`);
    const content = this.store.get(src);
    if (content === undefined) throw new Error(`backup: source not found: "${src}"`);
    this.store.set(path.join(destDir, path.basename(src)), content);
  }

  async remove(p: string): Promise<void> {
    this.writerCalls.push(`remove:${p}`);
    const prefix = `${p}${path.sep}`;
    for (const key of [...this.store.keys()]) {
      if (key === p || key.startsWith(prefix)) this.store.delete(key);
    }
  }

  /**
   * `MapFs` never models directories as first-class entries (only file
   * paths are keys) — there is no "is this directory empty" question to ask
   * against this fake's storage model, so this just records the call for
   * assertion purposes (mirroring `mkdir`'s no-op-but-recorded shape). The
   * STATE/REGRESSION dimension exercises the REAL empty-only contract via
   * `makeRealFsPorts` below, against an actual mkdtemp filesystem.
   */
  async removeDirIfEmpty(p: string): Promise<void> {
    this.writerCalls.push(`removeDirIfEmpty:${p}`);
  }
}

/** Every method throws — a runtime proof that a caller never invoked the writer port (invariant I4). */
class PoisonedWriter implements SetupFsWriter {
  async write(): Promise<void> {
    throw new Error("PoisonedWriter.write must never be called");
  }
  async mkdir(): Promise<void> {
    throw new Error("PoisonedWriter.mkdir must never be called");
  }
  async backup(): Promise<void> {
    throw new Error("PoisonedWriter.backup must never be called");
  }
  async remove(): Promise<void> {
    throw new Error("PoisonedWriter.remove must never be called");
  }
  async removeDirIfEmpty(): Promise<void> {
    throw new Error("PoisonedWriter.removeDirIfEmpty must never be called");
  }
}

class OkMcpRegistrar implements McpRegistrar {
  readonly addCalls: string[] = [];
  removeCalls = 0;
  async add(binPath: string): Promise<Result<McpAddOutcome, LoreError>> {
    this.addCalls.push(binPath);
    return ok("added");
  }
  async remove(): Promise<Result<void, LoreError>> {
    this.removeCalls += 1;
    return ok(undefined);
  }
}

/** Resolves `ok("already_registered")` on `add` — the idempotent-reclassification path
 * (task-lore-setup-mcp-add-step-is-non-idempotent-already-exists). */
class AlreadyRegisteredMcpRegistrar implements McpRegistrar {
  readonly addCalls: string[] = [];
  async add(binPath: string): Promise<Result<McpAddOutcome, LoreError>> {
    this.addCalls.push(binPath);
    return ok("already_registered");
  }
  async remove(): Promise<Result<void, LoreError>> {
    return ok(undefined);
  }
}

class FailingMcpRegistrar implements McpRegistrar {
  async add(): Promise<Result<McpAddOutcome, LoreError>> {
    return err({ code: "STORE_ERROR", message: "claude binary not found on PATH" });
  }
  async remove(): Promise<Result<void, LoreError>> {
    return err({ code: "STORE_ERROR", message: "claude binary not found on PATH" });
  }
}

/** The standard five-asset payload (skill/agent/hook/governance/settings-hook) most scenarios install. */
function buildPayload(loreHookEntries: SettingsHookEntry[] = [{ event: "Stop", command: "lore-stop-hook.mjs" }]): AssetPayload {
  return {
    files: [
      { path: "skills/lore/SKILL.md", kind: "skill", content: "# Lore skill\n", sha256: "placeholder" },
      { path: "agents/lore-explorer.md", kind: "agent", content: "# Explorer agent\n", sha256: "placeholder" },
      { path: "hooks/stop-doc-sync.mjs", kind: "hook", content: "#!/usr/bin/env node\nconsole.log('stop');\n", sha256: "placeholder" },
      { path: "governance/corpus-workflow.md", kind: "governance", content: "# Corpus workflow\n", sha256: "placeholder" },
      { path: "settings.json", kind: "settings-hook", content: JSON.stringify(loreHookEntries), sha256: "placeholder" },
    ],
  };
}

// ─── Real-fs test helper (THROWAWAY — not production code, see module doc) ──

async function makeTempDir(): Promise<string> {
  return fsp.mkdtemp(path.join(os.tmpdir(), "lore-setup-test-"));
}

function makeRealFsPorts(): { reader: SetupFsReader; writer: SetupFsWriter } {
  const reader: SetupFsReader = {
    async read(p: string): Promise<string | null> {
      try {
        return await fsp.readFile(p, "utf8");
      } catch {
        return null;
      }
    },
    async stat(p: string): Promise<{ exists: boolean; sha256?: string }> {
      try {
        const content = await fsp.readFile(p, "utf8");
        return { exists: true, sha256: sha256(content) };
      } catch {
        return { exists: false };
      }
    },
  };

  const writer: SetupFsWriter = {
    async write(p: string, content: string, opts?: { executable?: boolean }): Promise<void> {
      await fsp.mkdir(path.dirname(p), { recursive: true });
      await fsp.writeFile(p, content, "utf8");
      if (opts?.executable) await fsp.chmod(p, 0o755);
    },
    async mkdir(p: string): Promise<void> {
      await fsp.mkdir(p, { recursive: true });
    },
    async backup(src: string, destDir: string): Promise<void> {
      await fsp.mkdir(destDir, { recursive: true });
      await fsp.copyFile(src, path.join(destDir, path.basename(src)));
    },
    async remove(p: string): Promise<void> {
      await fsp.rm(p, { recursive: true, force: true });
    },
    async removeDirIfEmpty(p: string): Promise<void> {
      try {
        await fsp.rmdir(p);
      } catch (cause) {
        const errno = cause as NodeJS.ErrnoException;
        if (errno.code === "ENOTEMPTY" || errno.code === "ENOENT") return;
        throw cause;
      }
    },
  };

  return { reader, writer };
}

// ─── HAPPY ───────────────────────────────────────────────────────────────────

describe("HAPPY", () => {
  it("fresh install writes every asset, merges settings.json, registers mcp — manifest sha256 == sha256 of final on-disk bytes (I5)", async () => {
    const fs = new MapFs();
    const mcp = new OkMcpRegistrar();
    const service = new SetupService(new FixedAssetSource(buildPayload()), fs, fs, mcp);

    const result = await service.install(
      { targetDir: TARGET_DIR, binPath: "/usr/local/bin/lore" },
      () => "2026-07-16T00:00:00.000Z",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");

    const receipt = result.value;
    expect(receipt.written).toHaveLength(5);
    expect(receipt.skipped).toHaveLength(0);
    expect(receipt.mcp).toBe("registered");
    expect(mcp.addCalls).toEqual(["/usr/local/bin/lore"]);

    // I5: every written entry's sha256 equals sha256 of the FINAL on-disk bytes.
    for (const entry of receipt.written) {
      const onDisk = fs.store.get(path.join(TARGET_DIR, entry.path));
      expect(onDisk).toBeDefined();
      expect(entry.sha256).toBe(sha256(onDisk as string));
    }

    // hook-kind assets get the executable bit; other kinds don't.
    expect(fs.executableFlags.get(path.join(TARGET_DIR, "hooks/stop-doc-sync.mjs"))).toBe(true);
    expect(fs.executableFlags.get(path.join(TARGET_DIR, "skills/lore/SKILL.md"))).toBeUndefined();

    // settings.json merge landed the lore hook entry.
    const settingsOnDisk = JSON.parse(fs.store.get(path.join(TARGET_DIR, "settings.json")) as string) as {
      hooks?: Record<string, unknown>;
    };
    expect(JSON.stringify(settingsOnDisk.hooks)).toContain("lore-stop-hook.mjs");

    // manifest written, valid JSON, references every file entry plus the mcp entry.
    const manifestRaw = fs.store.get(receipt.manifestPath);
    expect(manifestRaw).toBeDefined();
    const manifest = JSON.parse(manifestRaw as string) as { entries: Array<{ kind: string }> };
    expect(manifest.entries).toHaveLength(6); // 5 files + 1 mcp entry
    expect(manifest.entries.some((e) => e.kind === "mcp")).toBe(true);
  });
});

// ─── NEGATIVE ────────────────────────────────────────────────────────────────

describe("NEGATIVE", () => {
  it("I1: malformed existing settings.json aborts install with ZERO SetupFsWriter calls and an err Result", async () => {
    const fs = new MapFs();
    fs.seed(path.join(TARGET_DIR, "settings.json"), "{not valid json");
    const mcp = new OkMcpRegistrar();
    const service = new SetupService(new FixedAssetSource(buildPayload()), fs, fs, mcp);

    const result = await service.install({ targetDir: TARGET_DIR, binPath: "/usr/local/bin/lore" });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected err");
    expect(result.error.code).toBe("VALIDATION_ERROR");
    expect(fs.writerCalls).toHaveLength(0);
    expect(mcp.addCalls).toHaveLength(0); // planning failed before the mcp step was ever reached
  });

  it("uninstall with no manifest present fails loud — nothing to uninstall", async () => {
    const fs = new MapFs();
    const service = new SetupService(new FixedAssetSource(buildPayload()), fs, fs, new OkMcpRegistrar());

    const result = await service.uninstall({ targetDir: TARGET_DIR });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected err");
    expect(result.error.code).toBe("VALIDATION_ERROR");
    expect(fs.writerCalls).toHaveLength(0);
  });
});

// ─── BOUNDARY ────────────────────────────────────────────────────────────────

describe("BOUNDARY", () => {
  it("I2: a byte-identical re-run reports every entry skipped and fires ZERO SetupFsWriter calls", async () => {
    const fs = new MapFs();
    const mcp = new OkMcpRegistrar();
    const service = new SetupService(new FixedAssetSource(buildPayload()), fs, fs, mcp);

    const first = await service.install(
      { targetDir: TARGET_DIR, binPath: "/usr/local/bin/lore" },
      () => "2026-07-16T00:00:00.000Z",
    );
    expect(first.ok).toBe(true);

    fs.writerCalls.length = 0; // reset the call log, keep the on-disk state

    const second = await service.install(
      { targetDir: TARGET_DIR, binPath: "/usr/local/bin/lore" },
      () => "2026-07-16T01:00:00.000Z",
    );

    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error("expected ok");
    expect(second.value.written).toHaveLength(0);
    expect(second.value.skipped.slice().sort()).toEqual(
      buildPayload()
        .files.map((f) => f.path)
        .sort(),
    );
    expect(fs.writerCalls).toHaveLength(0);
  });

  it("an empty asset payload still installs successfully (manifest + mcp only)", async () => {
    const fs = new MapFs();
    const mcp = new OkMcpRegistrar();
    const service = new SetupService(new FixedAssetSource({ files: [] }), fs, fs, mcp);

    const result = await service.install({ targetDir: TARGET_DIR, binPath: "/usr/local/bin/lore" });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.value.written).toHaveLength(0);
    expect(result.value.skipped).toHaveLength(0);
    expect(result.value.mcp).toBe("registered");
  });
});

// ─── ERROR ───────────────────────────────────────────────────────────────────

describe("ERROR", () => {
  it("fault injection: write #2 of 3 throws — file 1 committed, file 3 never attempted, manifest not written, re-run converges", async () => {
    const payload: AssetPayload = {
      files: [
        { path: "skills/a/SKILL.md", kind: "skill", content: "A\n", sha256: "x" },
        { path: "skills/b/SKILL.md", kind: "skill", content: "B\n", sha256: "x" },
        { path: "skills/c/SKILL.md", kind: "skill", content: "C\n", sha256: "x" },
      ],
    };
    const fs = new MapFs();
    fs.failWriteOnCall = 2;
    const service = new SetupService(new FixedAssetSource(payload), fs, fs, new OkMcpRegistrar());

    const result = await service.install({ targetDir: TARGET_DIR, binPath: "/usr/local/bin/lore" });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected err");
    if (result.error.code !== "STORE_ERROR") throw new Error(`expected STORE_ERROR, got ${result.error.code}`);
    expect(result.error.message).toContain("skills/a/SKILL.md");
    expect(result.error.message).not.toContain("skills/c/SKILL.md");

    expect(fs.store.has(path.join(TARGET_DIR, "skills/a/SKILL.md"))).toBe(true);
    expect(fs.store.has(path.join(TARGET_DIR, "skills/b/SKILL.md"))).toBe(false);
    expect(fs.store.has(path.join(TARGET_DIR, "skills/c/SKILL.md"))).toBe(false);
    expect(fs.store.has(path.join(TARGET_DIR, ".lore-setup-manifest.json"))).toBe(false);

    // re-run (writer no longer configured to fail) converges — I2's general form.
    fs.failWriteOnCall = undefined;
    const rerun = await service.install({ targetDir: TARGET_DIR, binPath: "/usr/local/bin/lore" });

    expect(rerun.ok).toBe(true);
    if (!rerun.ok) throw new Error("expected ok");
    expect(
      rerun.value.written
        .map((e) => e.path)
        .slice()
        .sort(),
    ).toEqual(["skills/b/SKILL.md", "skills/c/SKILL.md"]);
    expect(rerun.value.skipped).toEqual(["skills/a/SKILL.md"]);
    expect(fs.store.has(path.join(TARGET_DIR, ".lore-setup-manifest.json"))).toBe(true);
  });

  it("MCP registrar failure is non-fatal — file writes stand, receipt.mcp is 'failed', overall Result stays ok", async () => {
    const fs = new MapFs();
    const service = new SetupService(new FixedAssetSource(buildPayload()), fs, fs, new FailingMcpRegistrar());

    const result = await service.install({ targetDir: TARGET_DIR, binPath: "/usr/local/bin/lore" });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.value.mcp).toBe("failed");
    expect(result.value.written.length).toBeGreaterThan(0);
    expect(fs.store.has(path.join(TARGET_DIR, "skills/lore/SKILL.md"))).toBe(true);
  });

  it("MCP registrar 'already_registered' outcome is idempotent success — receipt.mcp is 'already_registered', not 'failed', overall Result stays ok (task-lore-setup-mcp-add-step-is-non-idempotent-already-exists)", async () => {
    const fs = new MapFs();
    const mcp = new AlreadyRegisteredMcpRegistrar();
    const service = new SetupService(new FixedAssetSource(buildPayload()), fs, fs, mcp);

    const result = await service.install({ targetDir: TARGET_DIR, binPath: "/usr/local/bin/lore" });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.value.mcp).toBe("already_registered");
    expect(mcp.addCalls).toEqual(["/usr/local/bin/lore"]);
    expect(result.value.written.length).toBeGreaterThan(0);
    expect(fs.store.has(path.join(TARGET_DIR, "skills/lore/SKILL.md"))).toBe(true);
  });
});

// ─── STATE ───────────────────────────────────────────────────────────────────

describe("STATE", () => {
  it("I3: install() then uninstall() over a real mkdtemp dir restores the backed-up settings.json byte-identically and removes the manifest", async () => {
    const targetDir = await makeTempDir();
    try {
      const preExistingSettings =
        `${JSON.stringify(
          { theme: "dark", hooks: { SomeEvent: [{ hooks: [{ type: "command", command: "foreign-cmd" }] }] } },
          null,
          2,
        )}\n`;
      await fsp.writeFile(path.join(targetDir, "settings.json"), preExistingSettings, "utf8");

      const { reader, writer } = makeRealFsPorts();
      const service = new SetupService(new FixedAssetSource(buildPayload()), reader, writer, new OkMcpRegistrar());

      const installResult = await service.install({ targetDir, binPath: "/usr/local/bin/lore" });
      expect(installResult.ok).toBe(true);
      if (!installResult.ok) throw new Error("expected ok");
      expect(installResult.value.backups).toContain("settings.json");

      const merged = JSON.parse(await fsp.readFile(path.join(targetDir, "settings.json"), "utf8")) as {
        theme?: string;
      };
      expect(merged.theme).toBe("dark");

      const uninstallResult = await service.uninstall({ targetDir });
      expect(uninstallResult.ok).toBe(true);
      if (!uninstallResult.ok) throw new Error("expected ok");
      expect(uninstallResult.value.backups).toContain("settings.json"); // restored FROM backup

      const restoredSettings = await fsp.readFile(path.join(targetDir, "settings.json"), "utf8");
      expect(restoredSettings).toBe(preExistingSettings); // byte-identical restore

      // Manifest + backups tree are gone; lore-created files are gone.
      await expect(fsp.access(path.join(targetDir, ".lore-setup-manifest.json"))).rejects.toThrow();
      await expect(fsp.access(path.join(targetDir, ".lore-backups"))).rejects.toThrow();
      await expect(fsp.access(path.join(targetDir, "skills", "lore", "SKILL.md"))).rejects.toThrow();
      await expect(fsp.access(path.join(targetDir, "agents", "lore-explorer.md"))).rejects.toThrow();
      await expect(fsp.access(path.join(targetDir, "hooks", "stop-doc-sync.mjs"))).rejects.toThrow();
      await expect(fsp.access(path.join(targetDir, "governance", "corpus-workflow.md"))).rejects.toThrow();
      // AC-046-F: the now-empty directories our removed files leave behind (skills/,
      // skills/lore/, agents/, hooks/, governance/) are pruned too — the ONLY thing
      // left in targetDir is the restored (foreign, pre-existing) settings.json.
      await expect(fsp.access(path.join(targetDir, "skills"))).rejects.toThrow();
      await expect(fsp.access(path.join(targetDir, "agents"))).rejects.toThrow();
      await expect(fsp.access(path.join(targetDir, "hooks"))).rejects.toThrow();
      await expect(fsp.access(path.join(targetDir, "governance"))).rejects.toThrow();
      const topLevelEntries = await fsp.readdir(targetDir);
      expect(topLevelEntries).toEqual(["settings.json"]);
    } finally {
      await fsp.rm(targetDir, { recursive: true, force: true });
    }
  });

  it("AC-046-F: install() into a fully empty dir then uninstall() leaves ZERO entries behind (no empty directory skeletons)", async () => {
    const targetDir = await makeTempDir();
    try {
      const { reader, writer } = makeRealFsPorts();
      const service = new SetupService(new FixedAssetSource(buildPayload()), reader, writer, new OkMcpRegistrar());

      const installResult = await service.install({ targetDir, binPath: "/usr/local/bin/lore" });
      expect(installResult.ok).toBe(true);
      // Nothing pre-existed, so settings.json itself was a fresh write (no backup) too.
      if (installResult.ok) expect(installResult.value.backups).toHaveLength(0);

      const uninstallResult = await service.uninstall({ targetDir });
      expect(uninstallResult.ok).toBe(true);

      const remaining = await fsp.readdir(targetDir, { recursive: true });
      expect(remaining).toHaveLength(0);
    } finally {
      await fsp.rm(targetDir, { recursive: true, force: true });
    }
  });
});

// ─── REGRESSION ──────────────────────────────────────────────────────────────

describe("REGRESSION", () => {
  it("foreign, non-lore settings.json keys AND foreign hook entries under an unrelated event survive install+uninstall byte-identical", async () => {
    const targetDir = await makeTempDir();
    try {
      const original = `${JSON.stringify(
        {
          theme: "dark",
          someOtherTopLevelKey: { nested: true },
          hooks: {
            SomeForeignEvent: [{ matcher: "Bash", hooks: [{ type: "command", command: "foreign-bash-guard.mjs" }] }],
          },
        },
        null,
        2,
      )}\n`;
      await fsp.writeFile(path.join(targetDir, "settings.json"), original, "utf8");

      const { reader, writer } = makeRealFsPorts();
      const service = new SetupService(new FixedAssetSource(buildPayload()), reader, writer, new OkMcpRegistrar());

      const installResult = await service.install({ targetDir, binPath: "/usr/local/bin/lore" });
      expect(installResult.ok).toBe(true);

      const merged = JSON.parse(await fsp.readFile(path.join(targetDir, "settings.json"), "utf8")) as {
        theme?: string;
        someOtherTopLevelKey?: unknown;
        hooks?: { SomeForeignEvent?: unknown };
      };
      expect(merged.theme).toBe("dark");
      expect(merged.someOtherTopLevelKey).toEqual({ nested: true });
      expect(JSON.stringify(merged.hooks?.SomeForeignEvent)).toContain("foreign-bash-guard.mjs");

      const uninstallResult = await service.uninstall({ targetDir });
      expect(uninstallResult.ok).toBe(true);

      const restored = await fsp.readFile(path.join(targetDir, "settings.json"), "utf8");
      expect(restored).toBe(original);
    } finally {
      await fsp.rm(targetDir, { recursive: true, force: true });
    }
  });

  it("AC-046-F: a pre-existing user file inside skills/ (untracked by any manifest entry) survives uninstall, AND its directory is left intact", async () => {
    const targetDir = await makeTempDir();
    try {
      await fsp.mkdir(path.join(targetDir, "skills"), { recursive: true });
      await fsp.writeFile(path.join(targetDir, "skills", "my-user-skill.md"), "# my own skill\n", "utf8");

      const { reader, writer } = makeRealFsPorts();
      const service = new SetupService(new FixedAssetSource(buildPayload()), reader, writer, new OkMcpRegistrar());

      const installResult = await service.install({ targetDir, binPath: "/usr/local/bin/lore" });
      expect(installResult.ok).toBe(true);
      await expect(fsp.access(path.join(targetDir, "skills", "lore", "SKILL.md"))).resolves.toBeUndefined();

      const uninstallResult = await service.uninstall({ targetDir });
      expect(uninstallResult.ok).toBe(true);

      // Our tracked entry is gone, and its now-empty parent (skills/lore/) is pruned...
      await expect(fsp.access(path.join(targetDir, "skills", "lore"))).rejects.toThrow();
      // ...but the user's OWN file, and skills/ itself (non-empty because of it), survive untouched.
      const userContent = await fsp.readFile(path.join(targetDir, "skills", "my-user-skill.md"), "utf8");
      expect(userContent).toBe("# my own skill\n");
    } finally {
      await fsp.rm(targetDir, { recursive: true, force: true });
    }
  });
});

// ─── I4 — planInstall is reader-only ────────────────────────────────────────

describe("I4 — planInstall never touches the writer port", () => {
  it("I4: planInstall uses ONLY the reader; a poisoned writer proves zero writer calls (no exception thrown)", async () => {
    const fs = new MapFs();
    const poison = new PoisonedWriter();
    const service = new SetupService(new FixedAssetSource(buildPayload()), fs, poison, new OkMcpRegistrar());

    const result = await service.planInstall({ targetDir: TARGET_DIR });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.value.writes).toHaveLength(5);
    expect(result.value.skips).toHaveLength(0);
    // Reaching this line without a thrown "PoisonedWriter.* must never be called" IS the proof.
  });
});

// ─── I5 — manifest sha256 is over FINAL on-disk bytes, not the raw payload ──

describe("I5 — manifest sha256 reflects final on-disk bytes", () => {
  it("I5: a settings-hook entry's manifest sha256 equals sha256 of the POST-MERGE content, not the raw payload's sha", async () => {
    const fs = new MapFs();
    fs.seed(path.join(TARGET_DIR, "settings.json"), `${JSON.stringify({ theme: "dark" }, null, 2)}\n`);
    const payload = buildPayload();
    const service = new SetupService(new FixedAssetSource(payload), fs, fs, new OkMcpRegistrar());

    const result = await service.install({ targetDir: TARGET_DIR, binPath: "/usr/local/bin/lore" });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");

    const settingsEntry = result.value.written.find((e) => e.path === "settings.json");
    expect(settingsEntry).toBeDefined();

    const settingsFile = payload.files.find((f) => f.path === "settings.json");
    if (settingsFile === undefined) throw new Error("fixture missing settings.json");
    const rawPayloadSha = sha256(settingsFile.content);
    const onDiskContent = fs.store.get(path.join(TARGET_DIR, "settings.json")) as string;

    expect(settingsEntry?.sha256).not.toBe(rawPayloadSha);
    expect(settingsEntry?.sha256).toBe(sha256(onDiskContent));
  });
});

// ─── I6 — test-pollution safety guard ───────────────────────────────────────

describe("I6 — test-pollution safety guard", () => {
  const realClaudeDir = path.join(os.homedir(), ".claude");

  it("I6: assertSafeTargetDir refuses the real ~/.claude directory and any nested path", () => {
    expect(assertSafeTargetDir(realClaudeDir).ok).toBe(false);
    expect(assertSafeTargetDir(path.join(realClaudeDir, "skills", "lore")).ok).toBe(false);
  });

  it("I6: assertSafeTargetDir allows an unrelated directory", () => {
    expect(assertSafeTargetDir("/tmp/some-mkdtemp-dir").ok).toBe(true);
  });

  it("I6: LORE_SETUP_ALLOW_REAL=1 is the documented production escape hatch", () => {
    const prev = process.env["LORE_SETUP_ALLOW_REAL"];
    process.env["LORE_SETUP_ALLOW_REAL"] = "1";
    try {
      expect(assertSafeTargetDir(realClaudeDir).ok).toBe(true);
    } finally {
      if (prev === undefined) delete process.env["LORE_SETUP_ALLOW_REAL"];
      else process.env["LORE_SETUP_ALLOW_REAL"] = prev;
    }
  });

  it("I6: install() itself refuses to run against the real ~/.claude directory", async () => {
    const fs = new MapFs();
    const service = new SetupService(new FixedAssetSource(buildPayload()), fs, fs, new OkMcpRegistrar());

    const result = await service.install({ targetDir: realClaudeDir, binPath: "/usr/local/bin/lore" });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected err");
    expect(result.error.code).toBe("VALIDATION_ERROR");
    expect(fs.writerCalls).toHaveLength(0);
  });
});

// ─── {{CLAUDE_DIR}} settings-hook placeholder resolution ────────────────────
//
// Proves the real-distribution shape end-to-end: a `settings-hook` asset
// carrying `buildHookSettingsEntries("{{CLAUDE_DIR}}")`-shaped content (what
// `RealAssetSource` actually emits) gets its placeholder resolved to the real
// `targetDir` BEFORE merging, so the on-disk `settings.json` carries real
// absolute hook commands and `mergeSettings`' command-identity key stays
// stable across repeated installs/uninstalls for a given targetDir.
//
// This whole describe block is a RED->GREEN proof: before this task's
// `resolveClaudeDirPlaceholder` wiring in `SetupService.resolvePayload`, the
// FIRST test below would have found the literal `{{CLAUDE_DIR}}` token
// verbatim in the on-disk settings.json instead of `TARGET_DIR`.

/** Builds a settings-hook-only payload using the SAME builder RealAssetSource calls, so these tests exercise the real distribution shape. */
function buildPlaceholderHookPayload(): AssetPayload {
  return {
    files: [
      {
        path: "settings.json",
        kind: "settings-hook",
        content: JSON.stringify(buildHookSettingsEntries("{{CLAUDE_DIR}}")),
        sha256: "placeholder",
      },
    ],
  };
}

describe("{{CLAUDE_DIR}} settings-hook placeholder resolution", () => {
  it("resolves {{CLAUDE_DIR}} to the real targetDir in every registered hook command, all 10 hook files registered, matchers/events correct, existing foreign hook preserved", async () => {
    const fs = new MapFs();
    fs.seed(
      path.join(TARGET_DIR, "settings.json"),
      `${JSON.stringify(
        { hooks: { SomeForeignEvent: [{ hooks: [{ type: "command", command: "foreign-user-hook.sh" }] }] } },
        null,
        2,
      )}\n`,
    );
    const mcp = new OkMcpRegistrar();
    const service = new SetupService(new FixedAssetSource(buildPlaceholderHookPayload()), fs, fs, mcp);

    const result = await service.install({ targetDir: TARGET_DIR, binPath: "/usr/local/bin/lore" });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");

    const onDisk = fs.store.get(path.join(TARGET_DIR, "settings.json")) as string;
    expect(onDisk).toBeDefined();

    // No unresolved placeholder token survives onto disk.
    expect(onDisk).not.toContain("{{CLAUDE_DIR}}");

    const parsed = JSON.parse(onDisk) as { hooks: Record<string, Array<{ matcher?: string; hooks: Array<{ command: string }> }>> };

    // Every registered command now carries the real targetDir prefix.
    const allCommands = Object.values(parsed.hooks)
      .flat()
      .flatMap((group) => group.hooks.map((h) => h.command));
    const loreCommands = allCommands.filter((c) => c !== "foreign-user-hook.sh");
    expect(loreCommands.length).toBeGreaterThan(0);
    for (const command of loreCommands) {
      expect(command.startsWith(`node ${TARGET_DIR}/hooks/`) || command.startsWith(`bash ${TARGET_DIR}/hooks/`)).toBe(
        true,
      );
    }

    // All 10 distinct hook files are present in the merged command set.
    const distinctFiles = new Set(loreCommands.map((c) => c.split("/hooks/")[1]));
    expect([...distinctFiles].sort()).toEqual(
      [
        "pre-bash-git-safety-gate.mjs",
        "lore-gate-g1-spec-create.sh",
        "lore-gate-g2-spec-promote.sh",
        "lore-gate-g3-plan-promote.sh",
        "lore-gate-g4-task-claim.sh",
        "session-start-resume.mjs",
        "stop-doc-sync.mjs",
        "subagent-context.mjs",
        "subagent-stop-commit-guard.mjs",
        "claude-md-guard.sh",
      ].sort(),
    );

    // event/matcher wiring spot-checks.
    expect(parsed.hooks["SessionStart"]?.some((g) => g.hooks.some((h) => h.command.includes("session-start-resume.mjs")))).toBe(true);
    const preToolUseBash = parsed.hooks["PreToolUse"]?.find((g) => g.matcher === "Bash");
    expect(preToolUseBash?.hooks.some((h) => h.command.includes("pre-bash-git-safety-gate.mjs"))).toBe(true);

    // The pre-existing FOREIGN hook under an unrelated event is untouched.
    expect(parsed.hooks["SomeForeignEvent"]).toEqual([{ hooks: [{ type: "command", command: "foreign-user-hook.sh" }] }]);
  });

  it("is idempotent — a byte-identical re-run against the same targetDir fires ZERO writer calls (I2, extended to the placeholder-carrying payload)", async () => {
    const fs = new MapFs();
    const mcp = new OkMcpRegistrar();
    const service = new SetupService(new FixedAssetSource(buildPlaceholderHookPayload()), fs, fs, mcp);

    const first = await service.install(
      { targetDir: TARGET_DIR, binPath: "/usr/local/bin/lore" },
      () => "2026-07-20T00:00:00.000Z",
    );
    expect(first.ok).toBe(true);

    fs.writerCalls.length = 0; // reset the call log, keep the on-disk state

    const second = await service.install(
      { targetDir: TARGET_DIR, binPath: "/usr/local/bin/lore" },
      () => "2026-07-20T01:00:00.000Z",
    );

    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error("expected ok");
    expect(second.value.written).toHaveLength(0);
    expect(second.value.skipped).toEqual(["settings.json"]);
    expect(fs.writerCalls).toHaveLength(0);
  });

  it("resolves to a DIFFERENT targetDir's commands for a different install location (command identity is per-targetDir, not global)", async () => {
    const fsA = new MapFs();
    const serviceA = new SetupService(new FixedAssetSource(buildPlaceholderHookPayload()), fsA, fsA, new OkMcpRegistrar());
    await serviceA.install({ targetDir: "/fake-target/dir-a", binPath: "/usr/local/bin/lore" });
    const onDiskA = fsA.store.get("/fake-target/dir-a/settings.json") as string;
    expect(onDiskA).toContain("/fake-target/dir-a/hooks/");
    expect(onDiskA).not.toContain("/fake-target/dir-b/hooks/");

    const fsB = new MapFs();
    const serviceB = new SetupService(new FixedAssetSource(buildPlaceholderHookPayload()), fsB, fsB, new OkMcpRegistrar());
    await serviceB.install({ targetDir: "/fake-target/dir-b", binPath: "/usr/local/bin/lore" });
    const onDiskB = fsB.store.get("/fake-target/dir-b/settings.json") as string;
    expect(onDiskB).toContain("/fake-target/dir-b/hooks/");
    expect(onDiskB).not.toContain("/fake-target/dir-a/hooks/");
  });

  it("install() then uninstall() over a real mkdtemp dir restores a pre-existing settings.json byte-identically, with resolved (not placeholder) hook commands landing during install", async () => {
    const targetDir = await makeTempDir();
    try {
      const preExisting = `${JSON.stringify({ theme: "dark" }, null, 2)}\n`;
      await fsp.writeFile(path.join(targetDir, "settings.json"), preExisting, "utf8");

      const { reader, writer } = makeRealFsPorts();
      const service = new SetupService(new FixedAssetSource(buildPlaceholderHookPayload()), reader, writer, new OkMcpRegistrar());

      const installResult = await service.install({ targetDir, binPath: "/usr/local/bin/lore" });
      expect(installResult.ok).toBe(true);

      const mergedRaw = await fsp.readFile(path.join(targetDir, "settings.json"), "utf8");
      expect(mergedRaw).not.toContain("{{CLAUDE_DIR}}");
      expect(mergedRaw).toContain(`${targetDir}/hooks/session-start-resume.mjs`);

      const uninstallResult = await service.uninstall({ targetDir });
      expect(uninstallResult.ok).toBe(true);

      const restored = await fsp.readFile(path.join(targetDir, "settings.json"), "utf8");
      expect(restored).toBe(preExisting); // byte-identical restore
    } finally {
      await fsp.rm(targetDir, { recursive: true, force: true });
    }
  });
});
