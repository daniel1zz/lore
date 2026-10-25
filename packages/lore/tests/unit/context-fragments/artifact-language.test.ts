/**
 * AC-IT-6 (unit half): `context.artifact_language` resolves per outlet layer into `{{lore:artifact_language}}`.
 * Spec: spec-fragment-injection-timing-one-inject-enum-a-per-turn (context.artifact_language, D10; BR-1377).
 * Pure: drives configVariableValues + expandFragments, no spawn.
 */
import { describe, expect, it } from "vitest";
import { OUTLET_IDS, languageName, type ContextConfigLayer, type Fragment, type OutletId } from "@lore/core";
import { expandFragments } from "../../../src/service/context-fragments/expand.js";
import { LORE_CONTEXT_VARIABLES, configVariableValues } from "../../../src/service/context-variables-registry.js";

const layer = (artifact_language?: string): ContextConfigLayer =>
  artifact_language === undefined ? {} : { context: { artifact_language } };

const PATH = ".lore/context/art.md";
const fragment = (body: string): Fragment =>
  ({ frontmatter: { id: "art", title: "t", inject: ["launch"] }, body, layer: "project", path: PATH, bodyLineOffset: 5 }) as unknown as Fragment;

function render(global: ContextConfigLayer, project: ContextConfigLayer, outlet: OutletId, body = "Write docs in {{lore:artifact_language}}.\n") {
  const values = configVariableValues(global, project, outlet);
  if (!values.ok) return values;
  return expandFragments([fragment(body)], outlet, { invocation: values.value }, LORE_CONTEXT_VARIABLES);
}

function bodyOf(r: ReturnType<typeof render>): string {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r.error)}`);
  return (r.value[0] as Fragment).body;
}

describe("AC-IT-6", () => {
  const g = layer("en");
  const p = layer("ja");

  it("HAPPY: global en + project ja render English at user outlets, Japanese at project and hook outlets", () => {
    expect(bodyOf(render(g, p, "rules:user"))).toContain("English");
    expect(bodyOf(render(g, p, "skills:user"))).toContain("English");
    expect(bodyOf(render(g, p, "rules:project"))).toContain("Japanese");
    expect(bodyOf(render(g, p, "skills:project"))).toContain("Japanese");
    expect(bodyOf(render(g, p, "hook:user-prompt"))).toContain("Japanese");
    expect(bodyOf(render(g, p, "hook:subagent-start"))).toContain("Japanese");
  });

  it("BOUNDARY: hook outlets fall back to global when project is unset", () => {
    expect(bodyOf(render(g, {}, "hook:user-prompt"))).toContain("English");
  });

  it("STATE: the rules:user render is byte-equal under project ja and project unset", () => {
    expect(bodyOf(render(g, p, "rules:user"))).toBe(bodyOf(render(g, {}, "rules:user")));
  });

  it("NEGATIVE: an unknown code is VALIDATION_ERROR naming the field, the layer and the known codes", () => {
    const r = configVariableValues(layer("xx"), {}, "rules:user");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const e = r.error as { code: string; message: string };
    expect(e.code).toBe("VALIDATION_ERROR");
    expect(e.message).toContain("context.artifact_language");
    expect(e.message).toContain("global");
    expect(e.message).toContain("zh, en, ja");
    const named = languageName("xx", "context.artifact_language", "project");
    expect(named.ok).toBe(false);
    if (!named.ok) expect((named.error as { message: string }).message).toContain("project");
  });

  it("ERROR: unset at an outlet makes expansion fail naming file, line and artifact_language, never a default", () => {
    for (const outlet of OUTLET_IDS) {
      const r = render({}, {}, outlet, "a\nb {{lore:artifact_language}}\n");
      expect(r.ok, outlet).toBe(false);
      if (r.ok) continue;
      const message = (r.error as { message: string }).message;
      expect(message).toContain(PATH);
      expect(message).toContain("artifact_language");
      expect(message).toMatch(/:\d+/);
    }
    // layer routing: only the OTHER layer set -> still unset at this outlet
    expect(render(g, {}, "rules:project").ok).toBe(false);
    expect(render({}, p, "rules:user").ok).toBe(false);
  });

  it("REGRESSION: prototype-chain names are not language codes", () => {
    expect(configVariableValues(layer("constructor"), {}, "rules:user").ok).toBe(false);
  });
});
