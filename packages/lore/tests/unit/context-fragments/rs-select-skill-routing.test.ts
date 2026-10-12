/**
 * @spec_ref AC-RS-2
 * Spec: spec-rule-store (Scope 3; BR-1061, BR-1060)
 * A `delivery: skill` fragment leaves rules:* and hook:* and lands in exactly one skills outlet.
 */
import { describe, it, expect } from "vitest";
import { resolveContextConfig, type Fragment, type OutletId, type ContextConfigLayer } from "@lore/core";
import { selectFragments } from "../../../src/service/context-fragments/select.js";

type Layer = "shipped" | "user" | "project";

function frag(id: string, layer: Layer, delivery: "rules" | "skill" = "skill"): Fragment {
  return {
    frontmatter: {
      id,
      title: `title ${id}`,
      audience: ["main"],
      mode: "static",
      delivery,
      ...(delivery === "skill" ? { description: `when to use ${id}` } : {}),
    },
    body: `body of ${id} from ${layer}`,
    layer: layer as Fragment["layer"],
    path: `/${layer}/${id}.md`,
  } as Fragment;
}

const OUTLETS: OutletId[] = [
  "rules:project",
  "rules:user",
  "skills:project",
  "skills:user",
  "hook:session-start",
  "hook:subagent-start",
];

const empty: ContextConfigLayer = {};
function ids(all: Fragment[], outlet: OutletId, disable?: string[]): string[] {
  const project: ContextConfigLayer = disable ? { context: { fragments: { disable } } } : empty;
  const config = resolveContextConfig(empty, project, outlet);
  return selectFragments(all, { outlet, agentType: "x", config }).map((f) => f.frontmatter.id);
}

describe("AC-RS-2 skill fragment routing", () => {
  const all = [
    frag("sk-shipped", "shipped"),
    frag("sk-project", "project"),
    frag("sk-user", "user"),
    frag("rule-shipped", "shipped", "rules"),
  ];

  it("AC-RS-2 a skill fragment is in no rules:* and no hook:* outlet", () => {
    for (const outlet of OUTLETS.filter((o) => o.startsWith("rules:") || o.startsWith("hook:"))) {
      const got = ids(all, outlet);
      expect(
        got.filter((i) => i.startsWith("sk-")),
        outlet,
      ).toEqual([]);
    }
  });

  it("AC-RS-2 shipped and project skills are in skills:project only; user skill in skills:user only", () => {
    expect(ids(all, "skills:project")).toEqual(["sk-project", "sk-shipped"]);
    expect(ids(all, "skills:user")).toEqual(["sk-user"]);
  });

  it("AC-RS-2 each skill fragment appears in exactly one outlet overall", () => {
    for (const id of ["sk-shipped", "sk-project", "sk-user"]) {
      const hits = OUTLETS.filter((o) => ids(all, o).includes(id));
      expect(hits, id).toHaveLength(1);
    }
  });

  it("AC-RS-2 a rules fragment never reaches a skills outlet (regression)", () => {
    expect(ids(all, "skills:project")).not.toContain("rule-shipped");
    expect(ids(all, "rules:project")).toContain("rule-shipped");
  });

  it("AC-RS-2 an overriding project skill replaces the shipped one, still one outlet", () => {
    const o = [frag("dup", "shipped"), frag("dup", "project")];
    const got = selectFragments(o, {
      outlet: "skills:project",
      config: resolveContextConfig(empty, empty, "skills:project"),
    });
    expect(got).toHaveLength(1);
    expect(got[0]!.layer).toBe("project");
  });

  it("AC-RS-2 disable removes a skill from its outlet", () => {
    expect(ids(all, "skills:project", ["sk-shipped"])).toEqual(["sk-project"]);
  });
});
