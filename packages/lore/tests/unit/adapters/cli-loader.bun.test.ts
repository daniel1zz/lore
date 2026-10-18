/**
 * @spec_ref SPEC-012 §5 (K3 — full-CLI telemetry coverage)
 *
 * Tests for src/adapters/cli/loader.ts — loadLoreApp() function.
 *
 * Strategy:
 *   - Create a real .lore/lore.db using createApp() + SQLiteStore in a temp dir.
 *   - Use process.chdir() to simulate the CLI running from that directory.
 *   - Verify that loadLoreApp() correctly wires telemetry based on config.yaml.
 *
 * Six-dimension coverage:
 *   HAPPY:      telemetry.enabled=true → JsonlTelemetry (file written after instrumented op)
 *   NEGATIVE:   telemetry.enabled=false → NoOpTelemetry (no file written)
 *   BOUNDARY:   telemetry config absent → NoOpTelemetry; sync section stripped → App not Result<App>
 *   ERROR:      telemetry path unwritable → record() fails silently, app still usable
 *   STATE:      two loadLoreApp() calls return independent App instances
 *   REGRESSION: create/list/get/search/link all work correctly via loadLoreApp
 *
 * Uses bun:sqlite (bun test only — vitest cannot resolve bun:sqlite).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, existsSync, mkdirSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { createApp } from "../../../src/app.js";
import { loadLoreApp } from "../../../src/adapters/cli/loader.js";
import { saveConfig } from "@lore/core/node";
import { liveAmbient, liveInvocation, liveWriteContext } from "../../live-invocation.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Create a temp project dir with a real .lore/lore.db.
 * Uses resolve() to normalize macOS /var vs /private/var symlinks.
 */
function createTempProject(): string {
  const dir = resolve(mkdtempSync(join(tmpdir(), "lore-loader-test-")));
  const loreDir = join(dir, ".lore");
  mkdirSync(loreDir, { recursive: true });
  const dbPath = join(loreDir, "lore.db");
  const app = createApp(dbPath, undefined, liveAmbient(), liveWriteContext());
  app.close();
  return dir;
}

/**
 * Write a config.yaml to the given project dir.
 */
function writeConfig(projectDir: string, config: object): void {
  saveConfig(projectDir, config as never);
}

// ─── cwd save/restore ────────────────────────────────────────────────────────

let originalCwd: string;

beforeEach(() => {
  originalCwd = process.cwd();
});

afterEach(() => {
  process.chdir(originalCwd);
});

// ─── HAPPY ───────────────────────────────────────────────────────────────────

describe("loadLoreApp — HAPPY", () => {
  it("telemetry.enabled=true — JsonlTelemetry wired; file written after instrumented op", async () => {
    const projectDir = createTempProject();
    writeConfig(projectDir, {
      project: { name: "test", author: "tester" },
      telemetry: { enabled: true },
    });

    process.chdir(projectDir);
    const { app, dbPath } = loadLoreApp({ inv: liveInvocation() });

    try {
      // Check path ends with /.lore/lore.db (normalize macOS /var → /private/var symlink)
      expect(dbPath.endsWith("/.lore/lore.db")).toBe(true);
      expect(app).toBeDefined();
      expect(app.corpusService).toBeDefined();

      // Trigger a telemetry-instrumented operation
      await app.corpusService.list({});
    } finally {
      app.close();
    }

    // telemetry.jsonl should be flushed after close()
    const telemetryPath = join(projectDir, ".lore", "telemetry.jsonl");
    expect(existsSync(telemetryPath)).toBe(true);
  });

  it("returns dbPath pointing to the existing .lore/lore.db", () => {
    const projectDir = createTempProject();
    process.chdir(projectDir);
    const { app, dbPath } = loadLoreApp({ inv: liveInvocation() });
    try {
      expect(dbPath.endsWith("/.lore/lore.db")).toBe(true);
      expect(existsSync(dbPath)).toBe(true);
    } finally {
      app.close();
    }
  });
});

// ─── NEGATIVE ────────────────────────────────────────────────────────────────

describe("loadLoreApp — NEGATIVE", () => {
  it("telemetry.enabled=false — NoOpTelemetry; no telemetry.jsonl created", async () => {
    const projectDir = createTempProject();
    writeConfig(projectDir, {
      project: { name: "test", author: "tester" },
      telemetry: { enabled: false },
    });

    process.chdir(projectDir);
    const { app } = loadLoreApp({ inv: liveInvocation() });
    try {
      await app.corpusService.list({});
    } finally {
      app.close();
    }

    const telemetryPath = join(projectDir, ".lore", "telemetry.jsonl");
    expect(existsSync(telemetryPath)).toBe(false);
  });
});

// ─── BOUNDARY ────────────────────────────────────────────────────────────────

describe("loadLoreApp — BOUNDARY", () => {
  it("no config.yaml — defaults to NoOpTelemetry (no telemetry.jsonl written)", async () => {
    const projectDir = createTempProject();
    // Intentionally no config.yaml written

    process.chdir(projectDir);
    const { app } = loadLoreApp({ inv: liveInvocation() });
    try {
      await app.corpusService.list({});
    } finally {
      app.close();
    }

    const telemetryPath = join(projectDir, ".lore", "telemetry.jsonl");
    expect(existsSync(telemetryPath)).toBe(false);
  });

  it("config has sync section — sync is stripped, returns usable App (not Result<App>)", async () => {
    const projectDir = createTempProject();
    // Write a config WITH sync.enabled=false — loadLoreApp must strip sync section
    // to avoid triggering createApp's Result<App> path
    writeConfig(projectDir, {
      project: { name: "test", author: "tester" },
      sync: {
        enabled: false,
        remote_url: "libsql://example.turso.io",
        auth_token_env: "FAKE_TOKEN",
        interval: 60,
      },
    });

    process.chdir(projectDir);
    // Should not throw or wrap in Result
    const { app } = loadLoreApp({ inv: liveInvocation() });

    let result;
    try {
      result = await app.corpusService.list({});
    } finally {
      app.close();
    }

    expect(result?.ok).toBe(true);
  });
});

// ─── ERROR ────────────────────────────────────────────────────────────────────

describe("loadLoreApp — ERROR", () => {
  it("telemetry path is a directory (unwritable as file) — record() silently no-ops, app works", async () => {
    const projectDir = createTempProject();
    // Create a directory where the JSONL file would be written
    const blockingDir = join(projectDir, ".lore", "telemetry-block.jsonl");
    mkdirSync(blockingDir, { recursive: true });

    writeConfig(projectDir, {
      project: { name: "test", author: "tester" },
      telemetry: { enabled: true, path: blockingDir },
    });

    process.chdir(projectDir);
    const { app } = loadLoreApp({ inv: liveInvocation() });

    let thrownError: unknown = null;
    try {
      // JsonlTelemetry.record() MUST swallow IO errors — should not throw
      await app.corpusService.list({});
    } catch (e) {
      thrownError = e;
    } finally {
      app.close();
    }

    expect(thrownError).toBeNull();
  });
});

// ─── STATE ───────────────────────────────────────────────────────────────────

describe("loadLoreApp — STATE", () => {
  it("two consecutive calls return independent App instances with separate service objects", async () => {
    const projectDir = createTempProject();
    process.chdir(projectDir);

    const { app: app1 } = loadLoreApp({ inv: liveInvocation() });
    const { app: app2 } = loadLoreApp({ inv: liveInvocation() });

    try {
      // Different references
      expect(app1).not.toBe(app2);
      expect(app1.corpusService).not.toBe(app2.corpusService);

      // Both independently functional
      const r1 = await app1.corpusService.list({});
      const r2 = await app2.corpusService.list({});
      expect(r1.ok).toBe(true);
      expect(r2.ok).toBe(true);
    } finally {
      app1.close();
      app2.close();
    }
  });
});

// ─── REGRESSION ──────────────────────────────────────────────────────────────

describe("loadLoreApp — REGRESSION (all telemetry-instrumented corpus operations)", () => {
  it("create/list/get/search/link each work and are captured in telemetry.jsonl", async () => {
    const projectDir = createTempProject();
    writeConfig(projectDir, {
      project: { name: "test", author: "tester" },
      telemetry: { enabled: true },
    });

    process.chdir(projectDir);
    const { app } = loadLoreApp({ inv: liveInvocation() });

    try {
      // create (instrumented)
      const createPrd = await app.corpusService.create({
        type: "prd",
        title: "Test PRD",
      });
      expect(createPrd.ok).toBe(true);
      if (!createPrd.ok) return;
      const prd = createPrd.value;

      // reason: spec-create's GateEnforcer checkpoint (retro follow-up item 8) requires
      // a `## ` skeleton heading.
      const createSpec = await app.corpusService.create({
        type: "spec",
        title: "Test Spec",
        content: "## Overview\n\nbody",
      });
      expect(createSpec.ok).toBe(true);
      if (!createSpec.ok) return;
      const spec = createSpec.value;

      // list (instrumented)
      const listResult = await app.corpusService.list({});
      expect(listResult.ok).toBe(true);

      // get (instrumented)
      const getResult = await app.corpusService.get(prd.id);
      expect(getResult.ok).toBe(true);

      // search (instrumented)
      const searchResult = await app.corpusService.search("PRD");
      expect(searchResult.ok).toBe(true);

      // link (instrumented)
      const linkResult = await app.corpusService.link(prd.id, spec.id, "informs");
      expect(linkResult.ok).toBe(true);
    } finally {
      app.close();
    }

    // After close(), telemetry file should exist with ≥ 5 lines
    // (create×2, list×1, get×1, search×1, link×1 = 6 instrumented calls)
    const telemetryPath = join(projectDir, ".lore", "telemetry.jsonl");
    expect(existsSync(telemetryPath)).toBe(true);

    const rawLines = readFileSync(telemetryPath, "utf8").trim().split("\n");
    const lines = rawLines.filter((l) => l.trim().length > 0);
    expect(lines.length).toBeGreaterThanOrEqual(5);

    // Each line should be valid JSON with required fields
    for (const line of lines) {
      const event = JSON.parse(line);
      expect(event).toHaveProperty("ts");
      expect(event).toHaveProperty("service", "CorpusService");
      expect(event).toHaveProperty("method");
      expect(event).toHaveProperty("ok");
      expect(event).toHaveProperty("duration_ms");
    }
  });
});
