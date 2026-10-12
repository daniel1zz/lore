/**
 * @spec_ref AC-RS-11
 * Spec: spec-rule-store-git-tracked-fragment-selection-on-demand-skill (BR-1060)
 * The rules:project and skills:project renders are byte-equal across two runs that differ only in
 * user layer, user selection.yaml (through selectionToLayer) and global config.
 *
 * Compared on the REAL rendered file bytes (`renderRulesFile` / `renderSkillFile`), not on
 * selection JSON. The user selection enters through T5's `parseSelection` + `selectionToLayer`
 * and is handed to `resolveContextConfig` in the user-layer slot (its `global` argument), which is
 * how the flow feeds it to the user outlets; the project outlets must never see it.
 */
import { describe, it, expect } from "vitest";
import { resolveContextConfig, type Fragment, type OutletId, type ContextConfigLayer } from "@lore/core";
import { selectFragments } from "../../../src/service/context-fragments/select.js";
import { renderRulesFile, renderSkillFile } from "../../../src/service/context-fragments/section.js";
import { parseSelection, selectionToLayer } from "../../../src/service/context-fragments/selection.js";

type Layer = "shipped" | "user" | "project";
function frag(id: string, layer: Layer, delivery: "rules" | "skill", body = `body ${id} ${layer}`): Fragment {
  return {
    frontmatter: {
      id,
      title: id,
      audience: ["main"],
      mode: "static",
      delivery,
      ...(delivery === "skill" ? { description: `d ${id}` } : {}),
    },
    body,
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

const PROJECT_LAYER: ContextConfigLayer = {};

/** The user's selection.yaml, parsed and converted exactly as the flow does. It disables ids that DO exist in the project outlets, so any leak shows up as a changed render. */
function userSelectionLayer(globalConfig: ContextConfigLayer): ContextConfigLayer {
  const selection = parseSelection("schemaVersion: 1\ndisable:\n  - a-rule\n  - b-skill\n  - u-skill\n  - u-rule\n", "selection.yaml");
  if (!selection.ok) throw new Error(selection.error.message);
  const layer = selectionToLayer(selection.value, globalConfig, "user");
  if (!layer.ok) throw new Error(layer.error.message);
  return layer.value;
}

/** Concatenated bytes of every file the two project outlets would write, keyed by path. */
function renderProjectOutlets(all: Fragment[], userLayer: ContextConfigLayer): string {
  const files: Array<[string, string]> = [];
  for (const outlet of ["rules:project", "skills:project"] as OutletId[]) {
    const config = resolveContextConfig(userLayer, PROJECT_LAYER, outlet);
    for (const fragment of selectFragments(all, { outlet, config })) {
      const rendered = outlet === "rules:project" ? renderRulesFile(fragment) : renderSkillFile(fragment);
      if (!rendered.ok) throw new Error(rendered.error.message);
      const name = "fileName" in rendered.value ? rendered.value.fileName : `${rendered.value.dirName}/SKILL.md`;
      files.push([`${outlet}/${name}`, rendered.value.content]);
    }
  }
  return files.map(([path, content]) => `=== ${path}\n${content}`).join("");
}

describe("AC-RS-11 project outlets independent of user scope", () => {
  it("AC-RS-11 rules:project and skills:project rendered bytes are equal when only user layer / user selection / global config differ", () => {
    const globalA: ContextConfigLayer = {};
    const runA = renderProjectOutlets(shippedProject, globalA);

    const userLayerFragments = [
      frag("u-rule", "user", "rules"),
      frag("u-skill", "user", "skill"),
      frag("a-rule", "user", "rules", "user override of a-rule"),
      frag("b-skill", "user", "skill", "user override of b-skill"),
    ];
    const globalB: ContextConfigLayer = { context: { language: "zh" } };
    const runB = renderProjectOutlets([...shippedProject, ...userLayerFragments], userSelectionLayer(globalB));

    expect(runB).toBe(runA);
    expect(runA).toContain("=== rules:project/lore-a-rule.md");
    expect(runA).toContain("=== skills:project/lore-b-skill/SKILL.md");
    expect(runA).toContain("body b-skill shipped");
    expect(runA).toContain("name: lore-d-skill");
  });

  it("AC-RS-11 the user selection really works on the user outlets (the equality above is not vacuous)", () => {
    const layer = userSelectionLayer({});
    const all = [frag("u-skill", "user", "skill"), frag("keep-skill", "user", "skill")];
    const config = resolveContextConfig(layer, PROJECT_LAYER, "skills:user");
    expect(selectFragments(all, { outlet: "skills:user", config }).map((f) => f.frontmatter.id)).toEqual(["keep-skill"]);
  });

  it("AC-RS-11 sanity: a project-layer change DOES change the rendered bytes", () => {
    const runA = renderProjectOutlets(shippedProject, {});
    const runB = renderProjectOutlets([...shippedProject, frag("e-skill", "project", "skill")], {});
    expect(runB).not.toBe(runA);
  });
});
