/**
 * Tests for @lore/core config — `dashboard.projects` registry section only
 * (SPEC-078 D3, Q3). Pure Zod schema, no IO. Scoped deliberately, mirroring
 * `config-gates.test.ts`'s precedent: this file covers ONLY the new
 * `GlobalLoreConfigSchema.dashboard` field, not the whole schema.
 *
 * Six-dimension coverage for this file:
 *   HAPPY:      a valid registry with unique names parses; `dashboard` absent
 *               parses fine (back-compat, R-15 registry-less mode)
 *   NEGATIVE:   duplicate `projects[].name` is rejected with a named issue;
 *               an unknown key inside a project entry or the `dashboard`
 *               section itself is rejected (`.strict()`)
 *   BOUNDARY:   an empty `projects: []` array is valid (not an error); an
 *               empty-string `name`/`path` is rejected (`.min(1)`)
 *   ERROR:      n/a at this layer (pure schema, no Result channel — schema
 *               violations covered under NEGATIVE/BOUNDARY via safeParse)
 *   STATE:      n/a (pure schema, no accumulation across calls)
 *   REGRESSION: `GlobalLoreConfigSchema.parse({})` (no `dashboard` key at
 *               all) still parses, mirroring every pre-existing global config
 *               file written before this field existed; `MOUNT_STATES`
 *               retains its four documented values
 *
 * @spec_ref SPEC-078 §Design Decisions D3 (Q3 config schema)
 */

import { describe, it, expect } from "vitest";
import { GlobalLoreConfigSchema, MOUNT_STATES } from "./config.js";

describe("GlobalLoreConfigSchema.dashboard", () => {
  it("HAPPY: a registry with unique project names parses", () => {
    const result = GlobalLoreConfigSchema.safeParse({
      dashboard: {
        projects: [
          { name: "alpha", path: "/Users/alice/projects/alpha" },
          { name: "beta", path: "/Users/alice/projects/beta" },
        ],
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.dashboard?.projects).toHaveLength(2);
      expect(result.data.dashboard?.projects?.[0]).toEqual({
        name: "alpha",
        path: "/Users/alice/projects/alpha",
      });
    }
  });

  it("HAPPY/REGRESSION: dashboard key absent parses fine (registry-less mode, R-15)", () => {
    const result = GlobalLoreConfigSchema.safeParse({ defaults: { color: true } });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.dashboard).toBeUndefined();
    }
  });

  it("NEGATIVE: duplicate projects[].name is rejected with a named issue", () => {
    const result = GlobalLoreConfigSchema.safeParse({
      dashboard: {
        projects: [
          { name: "alpha", path: "/a" },
          { name: "beta", path: "/b" },
          { name: "alpha", path: "/c" },
        ],
      },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.join(".") === "dashboard.projects.2.name");
      expect(issue).toBeDefined();
      expect(issue?.message).toContain("alpha");
      expect(issue?.message).toContain("unique");
    }
  });

  it("NEGATIVE: an unknown key inside a project entry is rejected (.strict())", () => {
    const result = GlobalLoreConfigSchema.safeParse({
      dashboard: {
        projects: [{ name: "alpha", path: "/a", extra_typo: true }],
      },
    });
    expect(result.success).toBe(false);
  });

  it("NEGATIVE: an unknown key inside the dashboard section itself is rejected (.strict())", () => {
    const result = GlobalLoreConfigSchema.safeParse({
      dashboard: { corpora: [] },
    });
    expect(result.success).toBe(false);
  });

  it("BOUNDARY: an empty projects array is valid, not an error", () => {
    const result = GlobalLoreConfigSchema.safeParse({ dashboard: { projects: [] } });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.dashboard?.projects).toEqual([]);
    }
  });

  it("BOUNDARY: an empty-string name is rejected", () => {
    const result = GlobalLoreConfigSchema.safeParse({
      dashboard: { projects: [{ name: "", path: "/a" }] },
    });
    expect(result.success).toBe(false);
  });

  it("BOUNDARY: an empty-string path is rejected", () => {
    const result = GlobalLoreConfigSchema.safeParse({
      dashboard: { projects: [{ name: "alpha", path: "" }] },
    });
    expect(result.success).toBe(false);
  });

  it("REGRESSION: MOUNT_STATES retains its four documented values", () => {
    expect(MOUNT_STATES).toEqual(["mounted", "missing", "schema-skew", "error"]);
  });
});
