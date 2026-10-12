/**
 * @spec_ref AC-RS-11
 * Spec: spec-rule-store
 * rules:project and skills:project selection is byte-equal across two runs that differ only in
 * user layer, user-layer disable input and global config. Compared at the selection level
 * (ids + bodies per outlet); render is owned by a concurrent task.
 */
import { describe, it, expect } from "vitest";
import { resolveContextConfig, type Fragment, type OutletId, type ContextConfigLayer } from "@lore/core";
import { selectFragments } from "../../../src/service/context-fragments/select.js";

type Layer = "shipped" | "user" | "project";
function frag(id: string, layer: Layer, delivery: "rules" | "skill"): Fragment {
  return {
    frontmatter: {
      id,
      title: id,
      audience: ["main"],
      mode: "static",
      delivery,
      ...(delivery === "skill" ? { description: `d ${id}` } : {}),
    },
    body: `body ${id} ${layer}`,
    layer: layer as Fragment["layer"],
    path: `/${layer}/${id}.md`,
  } as Fragment;
}

const shippedProject = [
  frag("a-rule", "shipped", "rules"),
  frag("b-skill", "shipped", "skill"),
  frag("c-rule", "project", "rules"),
  frag("d-skill", "project", "skill"),
];

/** Project outlets resolve config from global + project only; the user-layer disable never reaches them. */
function snapshot(all: Fragment[], global: ContextConfigLayer): string {
  const out: Record<string, unknown> = {};
  for (const outlet of ["rules:project", "skills:project"] as OutletId[]) {
    const config = resolveContextConfig(global, {}, outlet);
    out[outlet] = selectFragments(all, { outlet, config }).map((f) => [f.frontmatter.id, f.body]);
  }
  return JSON.stringify(out);
}

describe("AC-RS-11 project outlets independent of user scope", () => {
  it("AC-RS-11 rules:project and skills:project byte-equal when only user layer / user disable / global config differ", () => {
    const runA = snapshot(shippedProject, {});
    const userLayer = [
      frag("u-rule", "user", "rules"),
      frag("u-skill", "user", "skill"),
      frag("a-rule", "user", "rules"),
      frag("b-skill", "user", "skill"),
    ];
    const runB = snapshot([...shippedProject, ...userLayer], {
      context: { language: "zh", fragments: { disable: ["u-skill", "u-rule"] } },
    });
    expect(runB).toBe(runA);
    expect(runA).toContain("b-skill shipped");
    expect(runA).toContain("d-skill");
  });

  it("AC-RS-11 sanity: a project-layer change DOES change the output", () => {
    const runA = snapshot(shippedProject, {});
    const runB = snapshot([...shippedProject, frag("e-skill", "project", "skill")], {});
    expect(runB).not.toBe(runA);
  });
});
