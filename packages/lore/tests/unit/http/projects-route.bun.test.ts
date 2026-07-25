/** @spec_ref spec-078-dashboard-multi-project-mount-registry-machine-scope AC-078-5 */

/**
 * `handleGetProjects` (SPEC-078 D7, T8) — the `GET /api/projects` render function.
 * Pure: exercised directly against a STUB `MountRegistry` (no real corpora, no
 * `bun:sqlite` needed for this file's own scenarios) — the interface contract lives
 * in `packages/lore/src/mount/types.ts` (T3), so a plain object literal satisfies it
 * without going through the bun-only `createMountRegistry` runtime (T5) at all. Kept
 * as a `.bun.test.ts` file per this task's declared boundary/oracle command, not
 * because it needs `bun:sqlite`.
 *
 * Six-dimension framing:
 *   HAPPY:      4 distinct MountState values render with the right per-entry shape
 *               (diagnosis present iff state !== "mounted") + both instance
 *               identity fields present.
 *   NEGATIVE:   a "mounted" entry never carries a `diagnosis` key at all (not even
 *               `undefined` — a JSON round-trip would otherwise leak a null).
 *   BOUNDARY:   an empty registry still renders a valid response shape (`projects: []`,
 *               instance identity still present — never omitted for "nothing to show").
 *   REGRESSION: declaration order from `listEntries()` is preserved byte-for-byte,
 *               never re-sorted by this render layer.
 */

import { describe, expect, it } from "bun:test";

import { handleGetProjects } from "../../../src/adapters/http/projects-route.js";
import type { MountEntry, MountRegistry, ProjectsResponse } from "../../../src/mount/types.js";

function stubRegistry(entries: MountEntry[]): MountRegistry<unknown> {
  return {
    init: async () => {
      // reason: never invoked by this file's scenarios — handleGetProjects only
      // ever calls listEntries().
    },
    resolve: (name: string) => entries.find((e) => e.name === name),
    listEntries: () => entries,
    markError: () => {
      // reason: not exercised here — see runtime-isolation.bun.test.ts (AC-078-10).
    },
    closeAll: async () => {
      // reason: not exercised here.
    },
  };
}

async function readBody(res: Response): Promise<{ ok: boolean; data: ProjectsResponse }> {
  return (await res.json()) as { ok: boolean; data: ProjectsResponse };
}

// ─── HAPPY ────────────────────────────────────────────────────────────────────

describe("handleGetProjects — HAPPY", () => {
  it("renders one entry per registry item across 4 distinct states, plus both instance identity fields", async () => {
    const entries: MountEntry[] = [
      { name: "proj-mounted", path: "/tmp/proj-mounted", state: "mounted", app: {} },
      { name: "proj-missing", path: "/tmp/proj-missing", state: "missing", diagnosis: "no corpus found" },
      {
        name: "proj-skewed",
        path: "/tmp/proj-skewed",
        state: "schema-skew",
        diagnosis: "corpus schema version 3 does not match supported version 2",
      },
      { name: "proj-broken", path: "/tmp/proj-broken", state: "error", diagnosis: "createApp failed: boom" },
    ];

    const res = handleGetProjects(stubRegistry(entries), { port: 4123, registryName: "reg-abc123" });
    expect(res.status).toBe(200);

    const body = await readBody(res);
    expect(body.ok).toBe(true);
    expect(body.data.projects).toHaveLength(4);

    const states = new Set(body.data.projects.map((p) => p.state));
    expect(states.size).toBeGreaterThanOrEqual(3);
    expect(states.has("mounted")).toBe(true);
    expect(states.has("missing")).toBe(true);
    expect(states.has("schema-skew")).toBe(true);
    expect(states.has("error")).toBe(true);

    const missingEntry = body.data.projects.find((p) => p.name === "proj-missing");
    expect(missingEntry?.diagnosis).toBe("no corpus found");

    // Both identity fields present (D7 "two instances, one corpus" debug aid).
    expect(body.data.instance.port).toBe(4123);
    expect(body.data.instance.registry_name).toBe("reg-abc123");
  });
});

// ─── NEGATIVE ─────────────────────────────────────────────────────────────────

describe("handleGetProjects — NEGATIVE", () => {
  it("never carries a diagnosis key for a mounted entry", async () => {
    const entries: MountEntry[] = [{ name: "healthy", path: "/tmp/healthy", state: "mounted", app: {} }];

    const res = handleGetProjects(stubRegistry(entries), { port: 1, registryName: "r" });
    const body = await readBody(res);

    const entry = body.data.projects[0];
    expect(entry).toBeDefined();
    expect("diagnosis" in (entry as object)).toBe(false);
  });
});

// ─── BOUNDARY ─────────────────────────────────────────────────────────────────

describe("handleGetProjects — BOUNDARY", () => {
  it("renders a valid empty-projects response (not an error) when the registry has zero entries", async () => {
    const res = handleGetProjects(stubRegistry([]), { port: 9999, registryName: "empty-reg" });
    expect(res.status).toBe(200);

    const body = await readBody(res);
    expect(body.ok).toBe(true);
    expect(body.data.projects).toEqual([]);
    // Instance identity is still present even with nothing to show.
    expect(body.data.instance.port).toBe(9999);
    expect(body.data.instance.registry_name).toBe("empty-reg");
  });
});

// ─── REGRESSION ───────────────────────────────────────────────────────────────

describe("handleGetProjects — REGRESSION", () => {
  it("preserves listEntries() declaration order without re-sorting", async () => {
    const entries: MountEntry[] = [
      { name: "zeta", path: "/tmp/zeta", state: "mounted", app: {} },
      { name: "alpha", path: "/tmp/alpha", state: "missing", diagnosis: "gone" },
      { name: "mid", path: "/tmp/mid", state: "mounted", app: {} },
    ];

    const res = handleGetProjects(stubRegistry(entries), { port: 1, registryName: "r" });
    const body = await readBody(res);

    expect(body.data.projects.map((p) => p.name)).toEqual(["zeta", "alpha", "mid"]);
  });
});
