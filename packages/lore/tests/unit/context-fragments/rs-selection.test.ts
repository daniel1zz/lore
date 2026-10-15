/**
 * @spec_ref AC-RS-3
 * Spec: spec-rule-store-git-tracked-fragment-selection-on-demand-skill (BR-1060, BR-1062, BR-1063, BR-1065)
 *
 * Six-dimension coverage:
 *   HAPPY: parse/serialize round trip, add/remove, resolver precedence.
 *   NEGATIVE: unknown id, unowned static main, config-file disable, strict schema.
 *   BOUNDARY: empty disable, empty-string env vars.  ERROR: invalid YAML / wrong version.
 *   STATE: inputs not mutated.  REGRESSION: byte-equal idempotence.
 */
import { describe, it, expect } from "vitest";
import type { Fragment } from "@lore/core";
import {
  addToDisable,
  emptySelection,
  parseSelection,
  removeFromDisable,
  selectionToLayer,
  serializeSelection,
  type Selection,
} from "../../../src/service/context-fragments/selection.js";
import { resolveUserConfigDir } from "../../../src/service/context-fragments/user-config-dir.js";

function frag(id: string, layer: "shipped" | "user" | "project", mode: "static" | "dynamic" = "static"): Fragment {
  return {
    frontmatter: { id, audience: ["main"], mode, delivery: "rules" },
    body: "x",
    layer,
    path: `/${layer}/${id}.md`,
    bodyLineOffset: 6,
  } as unknown as Fragment;
}

const ALL = [frag("alpha", "shipped"), frag("beta", "project"), frag("mine", "user"), frag("dyn", "user", "dynamic")];

function mustOk<T, E>(r: { ok: boolean; value?: T; error?: E }): T {
  if (!r.ok) throw new Error(`expected ok: ${JSON.stringify(r.error)}`);
  return r.value as T;
}

describe("AC-RS-3 selection model", () => {
  it("AC-RS-3 serialize is deterministic: sorted, deduplicated, round-trips", () => {
    const text = serializeSelection({ schemaVersion: 1, disable: ["b", "a", "b"] });
    expect(text).toBe("schemaVersion: 1\ndisable:\n  - a\n  - b\n");
    expect(mustOk(parseSelection(text, "s.yaml"))).toEqual({ schemaVersion: 1, disable: ["a", "b"] });
    expect(serializeSelection(emptySelection())).toBe("schemaVersion: 1\ndisable: []\n");
  });

  it("AC-RS-3 add and remove are idempotent (byte-equal output)", () => {
    const base = emptySelection();
    const once = mustOk(addToDisable(base, "alpha", "project", ALL));
    const twice = mustOk(addToDisable(once, "alpha", "project", ALL));
    expect(serializeSelection(twice)).toBe(serializeSelection(once));
    expect(once.disable).toEqual(["alpha"]);

    const removed = mustOk(removeFromDisable(once, "alpha", ALL));
    const removedAgain = mustOk(removeFromDisable(removed, "alpha", ALL));
    expect(serializeSelection(removedAgain)).toBe(serializeSelection(removed));
    expect(serializeSelection(removed)).toBe(serializeSelection(base));
  });

  it("AC-RS-3 an unknown id is refused for add and remove", () => {
    const a = addToDisable(emptySelection(), "ghost", "project", ALL);
    const r = removeFromDisable(emptySelection(), "ghost", ALL);
    for (const result of [a, r]) {
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("VALIDATION_ERROR");
        expect(result.error.message).toContain("ghost");
      }
    }
  });

  it("AC-RS-3 a project selection that disables a user static-main fragment is refused", () => {
    const result = addToDisable(emptySelection(), "mine", "project", ALL);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("mine");
    // the owning scope may disable it; a dynamic user fragment is unrestricted
    expect(addToDisable(emptySelection(), "mine", "user", ALL).ok).toBe(true);
    expect(addToDisable(emptySelection(), "dyn", "project", ALL).ok).toBe(true);
    // user scope cannot disable a shipped static main fragment
    expect(addToDisable(emptySelection(), "alpha", "user", ALL).ok).toBe(false);
  });

  it("AC-RS-3 a config-file fragments.disable is refused and the error names selection.yaml", () => {
    const sel: Selection = { schemaVersion: 1, disable: [] };
    const bad = selectionToLayer(sel, { context: { fragments: { disable: ["alpha"] } } }, "project");
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.error.message).toContain("selection.yaml");
      expect(bad.error.message).toContain("alpha");
    }
    const badUser = selectionToLayer(sel, { context: { fragments: { disable: ["x"] } } }, "user");
    if (!badUser.ok) expect(badUser.error.message).toContain("context/selection.yaml");
    expect(badUser.ok).toBe(false);
  });

  it("selectionToLayer maps the disable list and keeps language", () => {
    const layer = mustOk(selectionToLayer({ schemaVersion: 1, disable: ["a"] }, { context: { language: "zh" } }, "project"));
    expect(layer).toEqual({ context: { language: "zh", fragments: { disable: ["a"] } } });
    expect(mustOk(selectionToLayer(emptySelection(), {}, "user"))).toEqual({ context: { fragments: { disable: [] } } });
  });

  it("parseSelection refuses invalid YAML, wrong version, unknown keys, empty text", () => {
    for (const text of ["a: [", "schemaVersion: 2\ndisable: []\n", "schemaVersion: 1\ndisable: []\nextra: 1\n", "", "schemaVersion: 1\n"]) {
      const r = parseSelection(text, ".lore/context/selection.yaml");
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error.code).toBe("VALIDATION_ERROR");
        expect(r.error.message).toContain("selection.yaml");
      }
    }
  });

  it("does not mutate its inputs", () => {
    const sel: Selection = Object.freeze({ schemaVersion: 1, disable: Object.freeze(["b"]) as unknown as string[] });
    const next = mustOk(addToDisable(sel, "alpha", "project", ALL));
    expect(sel.disable).toEqual(["b"]);
    expect(next.disable).toEqual(["alpha", "b"]);
  });
});

describe("resolveUserConfigDir (BR-1065)", () => {
  it("LORE_CONFIG_HOME wins over XDG_CONFIG_HOME", () => {
    expect(resolveUserConfigDir({ LORE_CONFIG_HOME: "/l", XDG_CONFIG_HOME: "/x" }, "/h")).toBe("/l");
  });
  it("XDG_CONFIG_HOME/lore beats the home default", () => {
    expect(resolveUserConfigDir({ XDG_CONFIG_HOME: "/x" }, "/h")).toBe("/x/lore");
  });
  it("falls back to ~/.config/lore", () => {
    expect(resolveUserConfigDir({}, "/h")).toBe("/h/.config/lore");
  });
  it("empty-string variables count as unset", () => {
    expect(resolveUserConfigDir({ LORE_CONFIG_HOME: "", XDG_CONFIG_HOME: "" }, "/h")).toBe("/h/.config/lore");
    expect(resolveUserConfigDir({ LORE_CONFIG_HOME: "", XDG_CONFIG_HOME: "/x" }, "/h")).toBe("/x/lore");
  });
});
