/** @spec_ref AC-CF-3 */
/**
 * RED tests (module does not exist yet): renderOutlet + buildFragmentsSection.
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
import { SESSION_FRAGMENT_CAP, SUBAGENT_FRAGMENT_CAP, type Fragment } from "@lore/core";
import { renderOutlet } from "../../../src/service/context-fragments/render.js";
import { buildFragmentsSection } from "../../../src/service/context-fragments/section.js";

function frag(id: string, body: string, audience: string[] = ["main"], mode: "static" | "dynamic" = "dynamic"): Fragment {
  return {
    frontmatter: { id, title: `title ${id}`, audience, mode },
    body,
    layer: "shipped",
    path: `/fixture/${id}.md`,
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
    expect(SESSION_FRAGMENT_CAP).toBe(9_600);
    expect(SUBAGENT_FRAGMENT_CAP).toBe(9_400);
  });

  it("hook:session-start accepts a block of exactly 9,600 chars", () => {
    const r = renderOutlet(twoFragmentsTotaling(9_600, ["main"], "dynamic"), "hook:session-start");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.chars).toBe(9_600);
      expect(r.value.text.length).toBe(9_600);
    }
  });

  it("hook:session-start refuses a block of 9,601 chars with BUDGET_EXCEEDED", () => {
    const r = renderOutlet(twoFragmentsTotaling(9_601, ["main"], "dynamic"), "hook:session-start");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("BUDGET_EXCEEDED");
  });

  it("hook:session-start BUDGET_EXCEEDED message lists each fragment id with its char count", () => {
    const r = renderOutlet(twoFragmentsTotaling(9_601, ["main"], "dynamic"), "hook:session-start");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.message).toContain("a-first");
      expect(r.error.message).toContain("1000");
      expect(r.error.message).toContain("b-second");
      expect(r.error.message).toContain(String(9_601 - 1000 - 2));
    }
  });

  it("hook:session-start boundary also holds for a single fragment (no join separator)", () => {
    expect(renderOutlet([frag("solo", "x".repeat(9_600))], "hook:session-start").ok).toBe(true);
    expect(renderOutlet([frag("solo", "x".repeat(9_601))], "hook:session-start").ok).toBe(false);
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

  it("the two hook outlets use different caps (9,500 passes session-start, fails subagent-start)", () => {
    expect(renderOutlet(twoFragmentsTotaling(9_500, ["main"], "dynamic"), "hook:session-start").ok).toBe(true);
    expect(renderOutlet(twoFragmentsTotaling(9_500, ["subagent:*"], "static"), "hook:subagent-start").ok).toBe(false);
  });

  it("the separator counts toward the cap (two 4,800-char bodies render 9,602 chars and are refused)", () => {
    const over = [frag("a", "a".repeat(4_800)), frag("b", "b".repeat(4_800))];
    expect(renderOutlet(over, "hook:session-start").ok).toBe(false);
  });
});

describe("AC-CF-3 render output shape", () => {
  it("joins bodies with a blank line in the given order and reports fragmentIds", () => {
    const r = renderOutlet([frag("one", "alpha"), frag("two", "beta")], "hook:session-start");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.text).toBe("alpha\n\nbeta");
      expect(r.value.chars).toBe(11);
      expect(r.value.fragmentIds).toEqual(["one", "two"]);
    }
  });

  it("different inputs render different text (not a constant)", () => {
    const r = renderOutlet([frag("z", "gamma")], "hook:session-start");
    expect(r.ok && r.value.text).toBe("gamma");
  });

  it("claude-md outlets are not subject to the hook cap", () => {
    const r = renderOutlet([frag("big", "y".repeat(20_000), ["main"], "static")], "claude-md:project");
    expect(r.ok).toBe(true);
  });
});

describe("AC-CF-3 buildFragmentsSection", () => {
  it("returns a ManagedSection with id 'fragments' containing every body", () => {
    const rendered = renderOutlet(
      [frag("one", "BODY-ONE-nonce", ["main"], "static"), frag("two", "BODY-TWO-nonce", ["main"], "static")],
      "claude-md:project",
    );
    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    const section = buildFragmentsSection(rendered.value, "project");
    expect(section.id).toBe("fragments");
    expect(section.body).toContain("BODY-ONE-nonce");
    expect(section.body).toContain("BODY-TWO-nonce");
  });

  it("section body tracks the rendered input (different bodies, different section)", () => {
    const mk = (b: string) => {
      const r = renderOutlet([frag("x", b, ["main"], "static")], "claude-md:project");
      if (!r.ok) throw new Error("render failed");
      return buildFragmentsSection(r.value, "project");
    };
    expect(mk("first-nonce").body).not.toBe(mk("second-nonce").body);
    expect(mk("second-nonce").body).not.toContain("first-nonce");
  });
});
