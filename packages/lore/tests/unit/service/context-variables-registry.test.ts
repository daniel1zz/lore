import { describe, expect, it } from "vitest";
import { CAPTURE_TAIL_CHARS, LORE_AGENT_NAMES, expandTemplate, validateRegistry } from "@lore/core";
import { LORE_CONTEXT_VARIABLES } from "../../../src/service/context-variables-registry.js";

describe("LORE_CONTEXT_VARIABLES", () => {
  it("HAPPY: the real registry passes validateRegistry", () => {
    expect(validateRegistry(LORE_CONTEXT_VARIABLES).ok).toBe(true);
  });

  it("HAPPY: expands the three code variables at a rules outlet", () => {
    const r = expandTemplate(
      "{{lore:capture_tail_chars}} {{lore:implementer_agent}} {{lore:reader_agent}}",
      { outlet: "rules:project", path: "p", lineOffset: 0, invocation: {} },
      LORE_CONTEXT_VARIABLES,
    );
    expect(r).toEqual({
      ok: true,
      value: `${CAPTURE_TAIL_CHARS} ${LORE_AGENT_NAMES.implementer} ${LORE_AGENT_NAMES.reader}`,
    });
  });

  it("NEGATIVE: an unregistered name is refused", () => {
    const r = expandTemplate(
      "{{lore:nope}}",
      { outlet: "rules:project", path: "p", lineOffset: 0, invocation: {} },
      LORE_CONTEXT_VARIABLES,
    );
    expect(r.ok).toBe(false);
  });
});
