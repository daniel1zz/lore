/**
 * RED tests for @lore/core context-variables — the {{lore:<name>}} expander.
 * Pure functions; every test injects its OWN registry (never the real one).
 *
 * Six-dimension coverage:
 *   HAPPY:      code variable replaced; several tokens on several lines
 *   NEGATIVE:   unregistered name / wrong outlet / missing invocation value refused
 *   BOUNDARY:   lineOffset 0, first/last line, adjacent tokens, empty text
 *   ERROR:      validateRegistry returns err (never throws) for malformed entries
 *   STATE:      expandTemplate does not mutate its inputs; repeated calls agree
 *   REGRESSION: lookalikes `{{file_list}}` / `{{ lore:x }}` stay byte-identical
 *
 * @spec_ref spec-lore-owned-agent-context-is-generated-from-templates-and AC-CV-1 (D1-D3)
 */

import { describe, expect, it } from "vitest";
import {
  CAPTURE_TAIL_CHARS,
  expandTemplate,
  findPlaceholders,
  validateRegistry,
  type ContextVariable,
  type VarContext,
  type VariableOutlet,
} from "./context-variables.js";

const codeVar = (
  name: string,
  value: string,
  outlets: readonly VariableOutlet[] = ["rules:project", "rules:user"],
): ContextVariable => ({
  name,
  source: "code",
  outlets,
  describe: `test var ${name}`,
  value: () => value,
});

const invocationVar = (name: string, outlet: VariableOutlet): ContextVariable => ({
  name,
  source: "invocation",
  outlets: [outlet],
  describe: `test invocation var ${name}`,
});

const ctx = (over: Partial<VarContext> = {}): VarContext => ({
  outlet: "rules:project",
  path: "p",
  lineOffset: 0,
  invocation: {},
  ...over,
});

function expectErr(
  result: ReturnType<typeof expandTemplate>,
): { code: string; message: string } {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected err");
  const e = result.error as { code: string; message: string };
  expect(e.code).toBe("VALIDATION_ERROR");
  return e;
}

describe("expandTemplate — happy path", () => {
  it("HAPPY: replaces a code variable with its value", () => {
    const r = expandTemplate("a {{lore:x}} b", ctx(), [codeVar("x", "4000")]);
    expect(r).toEqual({ ok: true, value: "a 4000 b" });
  });

  it("HAPPY: replaces every occurrence across lines and distinct variables", () => {
    const reg = [codeVar("x", "1"), codeVar("y_2", "two")];
    const r = expandTemplate("{{lore:x}}\n{{lore:y_2}} {{lore:x}}\n", ctx(), reg);
    expect(r).toEqual({ ok: true, value: "1\ntwo 1\n" });
  });

  it("BOUNDARY: adjacent tokens and empty text", () => {
    const reg = [codeVar("x", "A")];
    expect(expandTemplate("{{lore:x}}{{lore:x}}", ctx(), reg)).toEqual({ ok: true, value: "AA" });
    expect(expandTemplate("", ctx(), reg)).toEqual({ ok: true, value: "" });
  });

  it("BOUNDARY: text without any token is returned byte-identical", () => {
    const text = "plain\n\ttext  with {single} braces\r\n";
    expect(expandTemplate(text, ctx(), [codeVar("x", "1")])).toEqual({ ok: true, value: text });
  });

  it("HAPPY: an invocation variable supplied at its outlet is replaced", () => {
    const reg = [invocationVar("file_list", "skills:user")];
    const r = expandTemplate(
      "files: {{lore:file_list}}",
      ctx({ outlet: "skills:user", invocation: { file_list: "a.ts b.ts" } }),
      reg,
    );
    expect(r).toEqual({ ok: true, value: "files: a.ts b.ts" });
  });

  it("HAPPY: CAPTURE_TAIL_CHARS is a positive integer", () => {
    expect(Number.isInteger(CAPTURE_TAIL_CHARS)).toBe(true);
    expect(CAPTURE_TAIL_CHARS).toBeGreaterThan(0);
  });
});

describe("expandTemplate — refusals", () => {
  it("NEGATIVE: unregistered name on body line 2 with lineOffset 5 -> VALIDATION_ERROR naming p:7 and the name", () => {
    const e = expectErr(
      expandTemplate("line one\n{{lore:nope}}\n", ctx({ path: "p", lineOffset: 5 }), [codeVar("x", "1")]),
    );
    expect(e.message).toContain("p:7");
    expect(e.message).toContain("nope");
  });

  it("BOUNDARY: lineOffset 0 and body line 1 reports <path>:1", () => {
    const e = expectErr(expandTemplate("{{lore:nope}}", ctx({ path: "f.md", lineOffset: 0 }), []));
    expect(e.message).toContain("f.md:1");
    expect(e.message).toContain("nope");
  });

  it("NEGATIVE: variable allowed only at rules:user, used at rules:project -> err naming var and outlet", () => {
    const reg = [codeVar("only_user", "v", ["rules:user"])];
    const e = expectErr(
      expandTemplate("x\n{{lore:only_user}}", ctx({ outlet: "rules:project", path: "q", lineOffset: 3 }), reg),
    );
    expect(e.message).toContain("only_user");
    expect(e.message).toContain("rules:project");
    expect(e.message).toContain("q:5");
  });

  it("NEGATIVE: invocation variable with no ctx.invocation entry -> err naming the var", () => {
    const reg = [invocationVar("file_list", "rules:project")];
    const e = expectErr(
      expandTemplate("{{lore:file_list}}", ctx({ outlet: "rules:project", path: "z", lineOffset: 1, invocation: {} }), reg),
    );
    expect(e.message).toContain("file_list");
    expect(e.message).toContain("z:2");
  });

  it("NEGATIVE: invocation variable whose entry is for a different name still errs", () => {
    const reg = [invocationVar("file_list", "rules:project")];
    const e = expectErr(
      expandTemplate("{{lore:file_list}}", ctx({ invocation: { other: "x" } }), reg),
    );
    expect(e.message).toContain("file_list");
  });

  it("ERROR: refusal never throws and returns no partially-expanded text", () => {
    const reg = [codeVar("x", "1")];
    let r: ReturnType<typeof expandTemplate> | undefined;
    expect(() => {
      r = expandTemplate("{{lore:x}} {{lore:nope}}", ctx(), reg);
    }).not.toThrow();
    expect(r?.ok).toBe(false);
  });

  it("NEGATIVE: the first offending line is the one reported", () => {
    const e = expectErr(expandTemplate("ok\n{{lore:bad1}}\n{{lore:bad2}}", ctx({ path: "p", lineOffset: 10 }), []));
    expect(e.message).toContain("p:12");
    expect(e.message).toContain("bad1");
  });
});

describe("expandTemplate — lookalikes stay untouched", () => {
  it("REGRESSION: '{{file_list}} {{ lore:x }}' is returned byte-identical", () => {
    const text = "{{file_list}} {{ lore:x }}";
    expect(expandTemplate(text, ctx(), [codeVar("x", "4000")])).toEqual({ ok: true, value: text });
  });

  it("REGRESSION: other malformed spellings are byte-identical, not errors", () => {
    const text = [
      "{{lore:X}}",
      "{{lore:1x}}",
      "{{lore:}}",
      "{{lore:a-b}}",
      "{lore:x}",
      "{{lore:x}",
      "{{ lore:x}}",
      "{{lore:x }}",
    ].join("\n");
    expect(expandTemplate(text, ctx(), [codeVar("x", "4000")])).toEqual({ ok: true, value: text });
  });

  it("REGRESSION: lookalikes next to a real token leave only the real one replaced", () => {
    const r = expandTemplate("{{file_list}} {{lore:x}} {{ lore:x }}", ctx(), [codeVar("x", "9")]);
    expect(r).toEqual({ ok: true, value: "{{file_list}} 9 {{ lore:x }}" });
  });
});

describe("expandTemplate — state", () => {
  it("STATE: does not mutate registry or invocation, and repeated calls agree", () => {
    const reg = [codeVar("x", "1")];
    const invocation = Object.freeze({ k: "v" });
    const snapshot = JSON.stringify(reg);
    const c = ctx({ invocation });
    const a = expandTemplate("{{lore:x}}", c, reg);
    const b = expandTemplate("{{lore:x}}", c, reg);
    expect(a).toEqual(b);
    expect(JSON.stringify(reg)).toBe(snapshot);
  });
});

describe("findPlaceholders", () => {
  it("HAPPY: lists each well-formed token with its 1-based body line", () => {
    expect(findPlaceholders("a {{lore:x}}\nb\n{{lore:y_1}} {{lore:x}}")).toEqual([
      { name: "x", line: 1 },
      { name: "y_1", line: 3 },
      { name: "x", line: 3 },
    ]);
  });

  it("REGRESSION: lookalikes and plain text yield no placeholders", () => {
    expect(findPlaceholders("{{file_list}} {{ lore:x }} {{lore:Bad}} nothing")).toEqual([]);
    expect(findPlaceholders("")).toEqual([]);
  });
});

describe("validateRegistry", () => {
  it("HAPPY: a well-formed registry is ok", () => {
    const r = validateRegistry([codeVar("x", "1"), invocationVar("file_list", "skills:user")]);
    expect(r.ok).toBe(true);
  });

  it("BOUNDARY: an empty registry is ok", () => {
    expect(validateRegistry([]).ok).toBe(true);
  });

  it("ERROR: code entry without value -> err, no throw", () => {
    const bad: ContextVariable = { name: "x", source: "code", outlets: ["rules:project"], describe: "d" };
    let r: ReturnType<typeof validateRegistry> | undefined;
    expect(() => {
      r = validateRegistry([bad]);
    }).not.toThrow();
    expect(r?.ok).toBe(false);
    if (r && !r.ok) {
      expect(r.error.code).toBe("VALIDATION_ERROR");
      expect(JSON.stringify(r.error)).toContain("x");
    }
  });

  it("ERROR: invocation entry with 2 outlets -> err, no throw", () => {
    const bad: ContextVariable = {
      name: "inv",
      source: "invocation",
      outlets: ["rules:project", "rules:user"],
      describe: "d",
    };
    let r: ReturnType<typeof validateRegistry> | undefined;
    expect(() => {
      r = validateRegistry([bad]);
    }).not.toThrow();
    expect(r?.ok).toBe(false);
    if (r && !r.ok) {
      expect(r.error.code).toBe("VALIDATION_ERROR");
      expect(JSON.stringify(r.error)).toContain("inv");
    }
  });

  it("ERROR: malformed names ('Bad-Name', leading digit, empty) -> err, no throw", () => {
    for (const name of ["Bad-Name", "1abc", "", "has space", "UPPER"]) {
      let r: ReturnType<typeof validateRegistry> | undefined;
      expect(() => {
        r = validateRegistry([codeVar(name, "v")]);
      }).not.toThrow();
      expect(r?.ok, `name ${JSON.stringify(name)}`).toBe(false);
      if (r && !r.ok) expect(r.error.code).toBe("VALIDATION_ERROR");
    }
  });
});
