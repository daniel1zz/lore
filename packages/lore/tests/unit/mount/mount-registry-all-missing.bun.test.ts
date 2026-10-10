/**
 * BR-994 falsifier (AC-P0C-6, launch half): a dashboard launch where every
 * registered project is missing (no readable corpus) still starts — `init()`
 * resolves, zero entries are mounted, every entry is classed `missing`, and
 * `createApp` is never called for a missing entry.
 *
 * Six-dimension framing:
 *   HAPPY/BOUNDARY: the all-missing registry (0 usable) yields 0 mounted entries.
 *   NEGATIVE: no entry is mounted and none carries a live app.
 *   ERROR: init() never throws/rejects when 0 entries are usable.
 *   STATE: every entry stays listed as `missing` (never dropped).
 *   REGRESSION: createApp is never invoked for a path lacking `.lore`.
 *
 * ⛔ Every directory is a throwaway mkdtemp path without `.lore` — never the
 * repo's own `.lore/`.
 */

import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { App } from "../../../src/app.js";
import { createMountRegistry } from "../../../src/mount/mount-registry.js";
import type { MountRegistryDeps } from "../../../src/mount/types.js";
import type { DashboardConfig } from "@lore/core";

const scratchDirs: string[] = [];

afterEach(() => {
  while (scratchDirs.length > 0) {
    const dir = scratchDirs.pop();
    if (dir === undefined) continue;
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeDirWithoutCorpus(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  scratchDirs.push(root);
  return root;
}

describe("BR-994 all-missing launch", () => {
  it("init yields zero mounted entries and does not throw when every registered project is missing", async () => {
    const config: DashboardConfig = {
      projects: [
        { name: "gone-a", path: makeDirWithoutCorpus("mount-allmissing-a-") },
        { name: "gone-b", path: makeDirWithoutCorpus("mount-allmissing-b-") },
      ],
    };
    let createAppCalls = 0;
    const deps: MountRegistryDeps<App> = {
      createApp: async () => {
        createAppCalls++;
        throw new Error("createApp must not be reached for a missing entry");
      },
    };
    const registry = createMountRegistry<App>();

    await expect(registry.init(config, deps)).resolves.toBeUndefined();

    const entries = registry.listEntries();
    expect(entries).toHaveLength(2);
    expect(entries.filter((e) => e.state === "mounted")).toHaveLength(0);
    for (const entry of entries) {
      expect(entry.state).toBe("missing");
      expect(entry.diagnosis).toBeDefined();
      expect(entry.app).toBeUndefined();
    }
    expect(createAppCalls).toBe(0);

    await registry.closeAll();
  });
});
