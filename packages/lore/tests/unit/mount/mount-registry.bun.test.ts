/** @spec_ref spec-078-dashboard-multi-project-mount-registry-machine-scope AC-078-1 */

/**
 * RED-phase scenarios for `MountRegistry` (SPEC-078 D2/D7) — the classify →
 * probe → parallel-`createApp` registry that lets one `lore dashboard`
 * process mount N independent corpora behind a project switcher.
 *
 * TDD-Role: red | Paired-Impl: T5 (`packages/lore/src/mount/mount-registry.ts`,
 * a `createMountRegistry<TApp>()` factory implementing the `MountRegistry<TApp>`
 * contract already landed at `packages/lore/src/mount/types.ts`, T3).
 *
 * This file writes ONLY the test scenarios — `mount-registry.ts` does not
 * exist yet. The import below is expected to fail module resolution until T5
 * lands; that is an ACCEPTABLE RED reason alongside per-scenario behavioral
 * failures (both are "missing implementation", never a test bug). Once T5
 * creates the module, these assertions should drive its behavior to GREEN
 * without any edits to this file.
 *
 * Why `bun test` and not vitest: every scenario constructs real
 * `.lore/lore.db` corpora via the production `createApp` composition root,
 * which transitively reaches `bun:sqlite` (external to vitest's SSR graph —
 * see root CLAUDE.md's "`bun:sqlite` is external to vitest" invariant).
 *
 * ⛔ Every corpus here is a throwaway `mkdtemp` directory — NEVER the repo's
 * own `.lore/` (root CLAUDE.md's 2026-07-07 pollution-incident convention).
 *
 * Six-dimension framing (per scenario, from the T4 dispatch):
 *   HAPPY:    2 valid mkdtemp corpora both classify mountable, live Apps.
 *   NEGATIVE: a path lacking `.lore/` classifies missing, names the path,
 *             and is never passed to `createApp`; a duplicate registry name
 *             is rejected at validation, before any probe.
 *   BOUNDARY: a version-skewed corpus classifies schema-skew, names both
 *             versions, and its db file is byte-identical before/after the
 *             mount attempt (R-11 "never auto-migrates").
 *   ERROR:    an all-error registry (every `createApp` call rejects) still
 *             yields a running registry with 0 mounted entries — `init()`
 *             itself never throws or rejects.
 */

import { afterEach, describe, expect, it } from "vitest";
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createApp } from "../../../src/app.js";
import type { App } from "../../../src/app.js";
import { LATEST_SCHEMA_VERSION } from "../../../src/store/sqlite-store.js";
// ⛔ RED: this module does not exist yet (T5). Import kept at top-level so a
// missing-implementation failure surfaces as a module-resolution error for
// every scenario below, not a per-test surprise.
import { createMountRegistry } from "../../../src/mount/mount-registry.js";
import type { MountRegistryDeps } from "../../../src/mount/types.js";
import type { DashboardConfig } from "@lore/core";
import { liveAmbient, liveWriteContext } from "../../live-invocation.js";

const scratchDirs: string[] = [];

afterEach(() => {
  while (scratchDirs.length > 0) {
    const dir = scratchDirs.pop();
    if (dir === undefined) continue;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // reason: best-effort scratch cleanup — a failure here must never fail
      // the test that already ran (mirrors deleted-corpus-liveness.bun.test.ts's
      // afterEach in this same directory).
    }
  }
});

/**
 * Builds a real, throwaway, fully-migrated `.lore/lore.db` corpus via the
 * production `createApp` composition root, then closes the connection so the
 * caller is free to reopen it (a fresh mount, or a raw `bun:sqlite` handle to
 * simulate schema skew) without file-lock contention.
 */
function makeRealCorpus(prefix: string): { root: string; dbPath: string } {
  const root = mkdtempSync(join(tmpdir(), prefix));
  scratchDirs.push(root);
  mkdirSync(join(root, ".lore"), { recursive: true });
  const dbPath = join(root, ".lore", "lore.db");
  const app = createApp(dbPath, undefined, liveAmbient(), liveWriteContext());
  app.close();
  return { root, dbPath };
}

/** Directly rewrites `PRAGMA user_version` on a real corpus file, simulating a
 * schema that is newer/older than what this binary's `LATEST_SCHEMA_VERSION`
 * supports — WITHOUT going through `SQLiteStore`'s migrating constructor. */
function bumpUserVersion(dbPath: string, version: number): void {
  const db = new Database(dbPath);
  db.run(`PRAGMA user_version = ${version}`);
  db.close();
}

function sha256OfFile(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** A `MountRegistryDeps<App>` whose `createApp` counts calls and delegates to
 * the real production `createApp` — used by every scenario that expects at
 * least one entry to genuinely mount. */
function realCreateAppDeps(): { deps: MountRegistryDeps<App>; callCount: () => number } {
  let calls = 0;
  return {
    deps: {
      createApp: async (dbPath: string) => {
        calls++;
        return createApp(dbPath, undefined, liveAmbient(), liveWriteContext());
      },
    },
    callCount: () => calls,
  };
}

// ─── HAPPY ────────────────────────────────────────────────────────────────────

describe("MountRegistry — HAPPY", () => {
  it("classifies both entries mountable and exposes live Apps for a 2-corpus registry", async () => {
    const a = makeRealCorpus("mount-happy-a-");
    const b = makeRealCorpus("mount-happy-b-");
    const config: DashboardConfig = {
      projects: [
        { name: "proj-a", path: a.root },
        { name: "proj-b", path: b.root },
      ],
    };
    const { deps, callCount } = realCreateAppDeps();

    const registry = createMountRegistry<App>();
    await registry.init(config, deps);

    const entries = registry.listEntries();
    expect(entries).toHaveLength(2);
    expect(callCount()).toBe(2);

    const entryA = registry.resolve("proj-a");
    const entryB = registry.resolve("proj-b");
    expect(entryA?.state).toBe("mounted");
    expect(entryB?.state).toBe("mounted");
    expect(entryA?.app).toBeDefined();
    expect(entryB?.app).toBeDefined();

    // "expose live Apps" — not just object presence: a real write against
    // each mounted App's own corpusService must succeed.
    const writeA = await entryA!.app!.corpusService.create({ type: "prd", title: "Live A", content: "a" });
    const writeB = await entryB!.app!.corpusService.create({ type: "prd", title: "Live B", content: "b" });
    expect(writeA.ok).toBe(true);
    expect(writeB.ok).toBe(true);

    await registry.closeAll();
  });
});

// ─── NEGATIVE ─────────────────────────────────────────────────────────────────

describe("MountRegistry — NEGATIVE", () => {
  it("classifies an entry whose path lacks .lore/ as missing, names the path in the diagnosis, and never calls createApp for it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mount-missing-"));
    scratchDirs.push(dir);
    // deliberately no .lore subdir — this is the "path does not resolve to an
    // existing corpus" case (SPEC-078 D7 "missing").
    expect(existsSync(join(dir, ".lore"))).toBe(false);

    const config: DashboardConfig = { projects: [{ name: "ghost", path: dir }] };
    const { deps, callCount } = realCreateAppDeps();

    const registry = createMountRegistry<App>();
    await registry.init(config, deps);

    const entry = registry.resolve("ghost");
    expect(entry?.state).toBe("missing");
    expect(entry?.diagnosis).toBeDefined();
    expect(entry?.diagnosis).toContain(dir);
    expect(entry?.app).toBeUndefined();
    // R-11 "never auto-migrates" extends to "never even attempts createApp"
    // for an entry that failed classification before the probe stage.
    expect(callCount()).toBe(0);

    await registry.closeAll();
  });

  it("rejects a registry config with two entries sharing the same name BEFORE any probe/createApp call", async () => {
    const a = makeRealCorpus("mount-dup-a-");
    const b = makeRealCorpus("mount-dup-b-");
    const dupConfig: DashboardConfig = {
      projects: [
        { name: "dup", path: a.root },
        { name: "dup", path: b.root },
      ],
    };
    const { deps, callCount } = realCreateAppDeps();

    const registry = createMountRegistry<App>();

    // ⛔ the assertion this scenario exists for: a structural name collision
    // is a config-validation failure, not a per-entry mount failure — it must
    // reject the WHOLE init() call before touching either entry.
    await expect(registry.init(dupConfig, deps)).rejects.toThrow();
    expect(callCount()).toBe(0);
  });
});

// ─── BOUNDARY ─────────────────────────────────────────────────────────────────

describe("MountRegistry — BOUNDARY", () => {
  it("classifies a version-skewed corpus as schema-skew, names both versions, and leaves the db file byte-identical before/after the mount attempt", async () => {
    const corpus = makeRealCorpus("mount-skew-");
    const skewedVersion = LATEST_SCHEMA_VERSION + 1;
    bumpUserVersion(corpus.dbPath, skewedVersion);

    const beforeHash = sha256OfFile(corpus.dbPath);

    const config: DashboardConfig = { projects: [{ name: "skewed", path: corpus.root }] };
    const { deps, callCount } = realCreateAppDeps();

    const registry = createMountRegistry<App>();
    await registry.init(config, deps);

    const entry = registry.resolve("skewed");
    expect(entry?.state).toBe("schema-skew");
    expect(entry?.diagnosis).toBeDefined();
    expect(entry?.diagnosis).toContain(String(skewedVersion));
    expect(entry?.diagnosis).toContain(String(LATEST_SCHEMA_VERSION));
    expect(entry?.app).toBeUndefined();
    // R-11 "never auto-migrates" — a schema-skewed corpus must never reach
    // createApp (which would run SQLiteStore's migrating constructor).
    expect(callCount()).toBe(0);

    const afterHash = sha256OfFile(corpus.dbPath);
    expect(afterHash).toBe(beforeHash);

    await registry.closeAll();
  });
});

// ─── ERROR ────────────────────────────────────────────────────────────────────

describe("MountRegistry — ERROR", () => {
  it("runs with 0 mounted entries and never throws when every entry's createApp call fails", async () => {
    const a = makeRealCorpus("mount-allerr-a-");
    const b = makeRealCorpus("mount-allerr-b-");
    const config: DashboardConfig = {
      projects: [
        { name: "broken-a", path: a.root },
        { name: "broken-b", path: b.root },
      ],
    };
    const deps: MountRegistryDeps<App> = {
      createApp: async () => {
        throw new Error("simulated createApp failure — every entry invalid");
      },
    };

    const registry = createMountRegistry<App>();

    // ⛔ THE assertion this scenario exists for (AC-078-1's "all-error
    // registry yields a running MountRegistry ... no throw"): init() must
    // resolve cleanly even though every single entry's createApp rejects.
    await expect(registry.init(config, deps)).resolves.toBeUndefined();

    const entries = registry.listEntries();
    expect(entries).toHaveLength(2);
    const mountedCount = entries.filter((e) => e.state === "mounted").length;
    expect(mountedCount).toBe(0);
    for (const entry of entries) {
      expect(entry.state).toBe("error");
      expect(entry.diagnosis).toBeDefined();
      expect(entry.app).toBeUndefined();
    }

    await registry.closeAll();
  });
});
