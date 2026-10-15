/** @spec_ref AC-CF-3 */
/**
 * renderOutlet + renderRulesFile/parseRulesFile (D15: the former Z1 buildFragmentsSection became the lore rules-file renderer).
 * Spec: spec-context-fragments-config-driven-layered-rule-injection (D6, D13, Module Boundary).
 *
 * JOIN FORMAT ASSUMED (the spec does not pin it):
 *   rendered.text = bodies in the order given, joined by "\n\n", no per-fragment prefix/suffix.
 *   "block chars" = rendered.text.length. For N bodies: sum(body.length) + 2 * (N - 1).
 *   Bodies are used verbatim (no trim), so fixtures use bodies with no leading/trailing whitespace.
 * BUDGET_EXCEEDED message is assumed to list each fragment id next to its decimal char count
 * (body.length, plain digits, no thousands separator).
 */
import { describe, expect, it } from "vitest";
import { SUBAGENT_FRAGMENT_CAP, type Fragment } from "@lore/core";
import { renderOutlet } from "../../../src/service/context-fragments/render.js";
import { parseRulesFile, renderRulesFile } from "../../../src/service/context-fragments/section.js";

function frag(id: string, body: string, audience: string[] = ["main"], mode: "static" | "dynamic" = "dynamic"): Fragment {
  return {
    frontmatter: { id, title: `title ${id}`, audience, mode, delivery: "rules" },
    body,
    layer: "shipped",
    path: `/fixture/${id}.md`,
    bodyLineOffset: 6,
  };
}

/** Two fragments whose rendered text (joined by "\n\n") is exactly `total` chars. */
function twoFragmentsTotaling(total: number, audience: string[], mode: "static" | "dynamic"): Fragment[] {
  const first = 1000;
  const second = total - first - 2;
  return [frag("a-first", "a".repeat(first), audience, mode), frag("b-second", "b".repeat(second), audience, mode)];
}

describe("AC-CF-3 budget boundary per hook outlet", () => {
  it("pins the cap constants the boundaries derive from", () => {
    expect(SUBAGENT_FRAGMENT_CAP).toBe(9_400);
  });

  it("hook:subagent-start accepts a block of exactly 9,400 chars", () => {
    const r = renderOutlet(twoFragmentsTotaling(9_400, ["subagent:*"], "static"), "hook:subagent-start");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.chars).toBe(9_400);
  });

  it("hook:subagent-start refuses a block of 9,401 chars with BUDGET_EXCEEDED listing ids and sizes", () => {
    const r = renderOutlet(twoFragmentsTotaling(9_401, ["subagent:*"], "static"), "hook:subagent-start");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("BUDGET_EXCEEDED");
      expect(r.error.message).toContain("a-first");
      expect(r.error.message).toContain("1000");
      expect(r.error.message).toContain("b-second");
      expect(r.error.message).toContain(String(9_401 - 1000 - 2));
    }
  });

  it("the separator counts toward the cap (two 4,700-char bodies render 9,402 chars and are refused)", () => {
    const over = [frag("a", "a".repeat(4_700)), frag("b", "b".repeat(4_700))];
    expect(renderOutlet(over, "hook:subagent-start").ok).toBe(false);
  });
});

describe("AC-CF-3 render output shape", () => {
  it("joins bodies with a blank line in the given order and reports fragmentIds", () => {
    const r = renderOutlet([frag("one", "alpha"), frag("two", "beta")], "hook:subagent-start");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.text).toBe("alpha\n\nbeta");
      expect(r.value.chars).toBe(11);
      expect(r.value.fragmentIds).toEqual(["one", "two"]);
    }
  });

  it("different inputs render different text (not a constant)", () => {
    const r = renderOutlet([frag("z", "gamma")], "hook:subagent-start");
    expect(r.ok && r.value.text).toBe("gamma");
  });

  it("rules outlets are not subject to the hook cap", () => {
    const r = renderOutlet([frag("big", "y".repeat(20_000), ["main"], "static")], "rules:project");
    expect(r.ok).toBe(true);
  });
});

describe("AC-CF-3 renderRulesFile (D15 file shape)", () => {
  it("renders lore-<id>.md: fingerprint first line carrying the id + the verbatim body, intact on parse", () => {
    const r = renderRulesFile(frag("one", "BODY-ONE-nonce", ["main"], "static"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.fileName).toBe("lore-one.md");
    expect(r.value.content).toMatch(/^<!-- lore:managed fragment=one hash=[0-9a-f]{8} -->\nBODY-ONE-nonce\n$/);
    expect(parseRulesFile(r.value.content)).toMatchObject({ id: "one", intact: true });
  });

  it("file bytes and hash track the body (different bodies, different file)", () => {
    const mk = (b: string) => {
      const r = renderRulesFile(frag("x", b, ["main"], "static"));
      if (!r.ok) throw new Error("render failed");
      return r.value.content;
    };
    expect(mk("first-nonce")).not.toBe(mk("second-nonce"));
    expect(mk("second-nonce")).not.toContain("first-nonce");
  });

  it("a hand-edited body is parsed as NOT intact, and a fingerprint-less file as null", () => {
    const r = renderRulesFile(frag("x", "orig", ["main"], "static"));
    if (!r.ok) throw new Error("render failed");
    expect(parseRulesFile(r.value.content.replace("orig", "orig EDIT"))).toMatchObject({ id: "x", intact: false });
    expect(parseRulesFile("# no fingerprint\nbody\n")).toBeNull();
  });

  it("refuses an id that cannot be a file-name stem", () => {
    const r = renderRulesFile(frag("../evil", "b", ["main"], "static"));
    expect(r.ok).toBe(false);
  });
});
