/**
 * @spec_ref AC-CF-2, AC-CF-14, AC-CF-19, AC-CF-20, AC-CF-21
 * Spec: spec-context-fragments-config-driven-layered-rule-injection (routing table, D2, D11, D14)
 *
 * RED tests for the not-yet-existing packages/lore/src/service/context-fragments/select.ts.
 *
 * Interface assumptions (spec "Module Boundary" + dispatch bundle):
 *   selectFragments(all, { outlet, agentType?, config }): Fragment[]
 *     - `all` holds fragments of ALL layers un-merged (duplicate ids across layers allowed);
 *       selection resolves id-override (project > user > shipped), disable, audience, when,
 *       outlet layer routing; output order = id ascending.
 *   checkOverrides(all, configs): Result<..., LoreError>
 *     - configs = { global: ContextConfigLayer, project: ContextConfigLayer } (RAW layers,
 *       because disable lists are file-scoped); err message names the offending id.
 *   `Fragment.layer` in @lore/core is typed "shipped" | "project" only; the spec has a third
 *   "user" layer, so fixtures cast it.
 *
 * Six-dimension coverage:
 *   HAPPY: audience/when selection, outlet routing.  NEGATIVE: excluded audience/when/disabled,
 *   cross-file override refusal.  BOUNDARY: subagent:<type> vs subagent:*, agentType absent.
 *   ERROR: err names the id.  STATE: inputs not mutated.  REGRESSION: determinism (id order).
 */
import { describe, it, expect } from "vitest";
import { resolveContextConfig, type Fragment, type OutletId, type ContextConfigLayer } from "@lore/core";
import { selectFragments, checkOverrides } from "../../../src/service/context-fragments/select.js";

type Layer = "shipped" | "user" | "project";

function frag(
  id: string,
  opts: {
    audience?: string[];
    mode?: "static" | "dynamic";
    layer?: Layer;
    when?: { language: string[] };
    body?: string;
  } = {},
): Fragment {
  const layer = opts.layer ?? "shipped";
  return {
    frontmatter: {
      id,
      title: `title ${id}`,
      audience: opts.audience ?? ["main"],
      mode: opts.mode ?? "static",
      ...(opts.when ? { when: opts.when } : {}),
    },
    body: opts.body ?? `body of ${id} from ${layer}`,
    layer: layer as Fragment["layer"],
    path: `/${layer}/${id}.md`,
  } as Fragment;
}

const cfg = (language?: string, disable?: string[]): ContextConfigLayer => ({
  context: {
    ...(language !== undefined ? { language } : {}),
    ...(disable !== undefined ? { fragments: { disable } } : {}),
  },
});

const ids = (fs: readonly Fragment[]) => fs.map((f) => f.frontmatter.id);
const bytes = (fs: readonly Fragment[]) => fs.map((f) => `${f.frontmatter.id}\n${f.body}`).join("\n---\n");

function select(
  all: Fragment[],
  outlet: OutletId,
  global: ContextConfigLayer,
  project: ContextConfigLayer,
  agentType?: string,
) {
  return selectFragments(all, {
    outlet,
    ...(agentType !== undefined ? { agentType } : {}),
    config: resolveContextConfig(global, project, outlet),
  });
}

describe("AC-CF-2 selectFragments hook:subagent-start audience, when and disable", () => {
  const all = [
    frag("a-star", { audience: ["subagent:*"], mode: "dynamic" }),
    frag("b-tester", { audience: ["subagent:tester"], mode: "static" }),
    frag("c-reviewer-only", { audience: ["subagent:lore-reviewer-only"] }),
    frag("d-en-only", { audience: ["subagent:*"], when: { language: ["en"] } }),
    frag("e-disabled", { audience: ["subagent:*"] }),
    frag("f-zh", { audience: ["subagent:*"], when: { language: ["zh"] } }),
    frag("g-main-only", { audience: ["main"], mode: "dynamic" }),
  ];
  const run = (agentType: string | undefined, language = "zh") =>
    select(all, "hook:subagent-start", cfg(), cfg(language, ["e-disabled"]), agentType);

  it("includes subagent:* and subagent:<type> fragments (static and dynamic) in id order", () => {
    expect(ids(run("tester"))).toEqual(["a-star", "b-tester", "f-zh"]);
  });

  it("excludes a fragment addressed to a different subagent type", () => {
    expect(ids(run("tester"))).not.toContain("c-reviewer-only");
  });

  it("excludes a when.language [en] fragment under language zh", () => {
    expect(ids(run("tester"))).not.toContain("d-en-only");
  });

  it("excludes an id listed in context.fragments.disable", () => {
    expect(ids(run("tester"))).not.toContain("e-disabled");
  });

  it("excludes audience-main-only fragments", () => {
    expect(ids(run("tester"))).not.toContain("g-main-only");
  });

  it("selects different sets for a different agent type (not a hardcoded list)", () => {
    expect(ids(run("lore-reviewer-only"))).toEqual(["a-star", "c-reviewer-only", "f-zh"]);
  });

  it("flips when.language fragments when language is en", () => {
    expect(ids(run("tester", "en"))).toEqual(["a-star", "b-tester", "d-en-only"]);
  });

  it("does not treat subagent:<type> as subagent:* for an unlisted agent type", () => {
    expect(ids(run("other-agent"))).toEqual(["a-star", "f-zh"]);
  });

  it("drops when-gated fragments when no language is configured", () => {
    const r = select(all, "hook:subagent-start", cfg(), cfg(undefined, ["e-disabled"]), "tester");
    expect(ids(r)).toEqual(["a-star", "b-tester"]);
  });

  it("does not mutate the input array", () => {
    const copy = [...all];
    run("tester");
    expect(all).toEqual(copy);
  });
});

describe("AC-CF-14 claude-md:user render is independent of project config", () => {
  const all = [
    frag("u-zh", { layer: "user", when: { language: ["zh"] } }),
    frag("u-en", { layer: "user", when: { language: ["en"] } }),
    frag("u-plain", { layer: "user" }),
    frag("s-ship", { layer: "shipped" }),
    frag("p-proj", { layer: "project" }),
  ];

  it("is byte-equal under project language zh vs en", () => {
    const a = select(all, "claude-md:user", cfg("zh"), cfg("zh"));
    const b = select(all, "claude-md:user", cfg("zh"), cfg("en"));
    expect(bytes(a)).toBe(bytes(b));
  });

  it("is byte-equal when project disables a user fragment id", () => {
    const a = select(all, "claude-md:user", cfg("zh"), cfg("zh"));
    const b = select(all, "claude-md:user", cfg("zh"), cfg("zh", ["u-plain"]));
    expect(bytes(a)).toBe(bytes(b));
  });

  it("is non-empty and follows GLOBAL language (control: output is not hardcoded)", () => {
    const zh = select(all, "claude-md:user", cfg("zh"), cfg("en"));
    const en = select(all, "claude-md:user", cfg("en"), cfg("en"));
    expect(ids(zh)).toEqual(["u-plain", "u-zh"]);
    expect(ids(en)).toEqual(["u-en", "u-plain"]);
  });
});

describe("AC-CF-19 each static main fragment reaches exactly one CLAUDE.md outlet", () => {
  const all = [
    frag("m-shipped", { layer: "shipped" }),
    frag("m-user", { layer: "user" }),
    frag("m-project", { layer: "project" }),
    frag("n-dynamic", { layer: "shipped", mode: "dynamic" }),
    frag("n-sub", { layer: "project", audience: ["subagent:*"] }),
  ];
  const proj = () => select(all, "claude-md:project", cfg(), cfg());
  const usr = () => select(all, "claude-md:user", cfg(), cfg());

  it("claude-md:project returns exactly the shipped and project static main fragments", () => {
    expect(ids(proj())).toEqual(["m-project", "m-shipped"]);
  });

  it("claude-md:user returns exactly the user static main fragment", () => {
    expect(ids(usr())).toEqual(["m-user"]);
  });

  it("the two id sets are disjoint", () => {
    const p = new Set(ids(proj()));
    expect(ids(usr()).filter((i) => p.has(i))).toEqual([]);
  });

  it("a project-layer fragment overriding a shipped static main id appears once, with project body", () => {
    const o = [
      frag("rule", { layer: "shipped", body: "SHIPPED" }),
      frag("rule", { layer: "project", body: "PROJECT" }),
    ];
    const r = select(o, "claude-md:project", cfg(), cfg());
    expect(r.map((f) => f.body)).toEqual(["PROJECT"]);
  });
});

describe("AC-CF-20 cross-file override of a static main fragment is refused", () => {
  const shipped = frag("rule", { layer: "shipped" });
  const userStatic = frag("urule", { layer: "user" });

  it("accepts a layering with no cross-file override", () => {
    const r = checkOverrides([shipped, userStatic], { global: cfg(), project: cfg() });
    expect(r.ok).toBe(true);
  });

  it("refuses a user-layer fragment overriding a shipped static main id, naming it", () => {
    const r = checkOverrides([shipped, frag("rule", { layer: "user" })], { global: cfg(), project: cfg() });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toContain("rule");
  });

  it("refuses a global disable of a shipped static main id, naming it", () => {
    const r = checkOverrides([shipped], { global: cfg(undefined, ["rule"]), project: cfg() });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toContain("rule");
  });

  it("refuses a project-layer fragment overriding a user static main id, naming it", () => {
    const r = checkOverrides([userStatic, frag("urule", { layer: "project" })], { global: cfg(), project: cfg() });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toContain("urule");
  });

  it("refuses a project disable of a user static main id, naming it", () => {
    const r = checkOverrides([userStatic], { global: cfg(), project: cfg(undefined, ["urule"]) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toContain("urule");
  });

  it("names the right id when only one of several overrides is illegal", () => {
    const all = [shipped, frag("other", { layer: "shipped" }), frag("other", { layer: "project" }), frag("rule", { layer: "user" })];
    const r = checkOverrides(all, { global: cfg(), project: cfg() });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.message).toContain("rule");
      expect(r.error.message).not.toContain("other");
    }
  });

  it("accepts a project-layer override and a project disable of a shipped static main id (owning scope)", () => {
    const r = checkOverrides([shipped, frag("rule", { layer: "project" })], { global: cfg(), project: cfg(undefined, ["rule"]) });
    expect(r.ok).toBe(true);
  });

  it("accepts the same cross-file targeting when the shipped fragment is dynamic", () => {
    const dyn = frag("dyn", { layer: "shipped", mode: "dynamic" });
    const r = checkOverrides([dyn, frag("dyn", { layer: "user", mode: "dynamic" })], { global: cfg(undefined, ["dyn"]), project: cfg() });
    expect(r.ok).toBe(true);
  });

  it("accepts the same cross-file targeting when the shipped fragment is subagent-only", () => {
    const sub = frag("sub", { layer: "shipped", audience: ["subagent:*"] });
    const r = checkOverrides([sub, frag("sub", { layer: "user", audience: ["subagent:*"] })], { global: cfg(undefined, ["sub"]), project: cfg() });
    expect(r.ok).toBe(true);
  });

  it("accepts project targeting a user dynamic fragment and applies it at the hook outlet", () => {
    const ud = frag("udyn", { layer: "user", mode: "dynamic" });
    const over = frag("udyn", { layer: "project", mode: "dynamic", body: "PROJECT-OVERRIDE" });
    expect(checkOverrides([ud, over], { global: cfg(), project: cfg() }).ok).toBe(true);
    const r = select([ud, over], "hook:session-start", cfg(), cfg());
    expect(r.map((f) => f.body)).toEqual(["PROJECT-OVERRIDE"]);
  });

  it("applies a project disable of a user dynamic fragment at hook:session-start", () => {
    const ud = frag("udyn", { layer: "user", mode: "dynamic" });
    const r = select([ud], "hook:session-start", cfg(), cfg(undefined, ["udyn"]));
    expect(ids(r)).toEqual([]);
  });

  it("applies a global disable of a shipped dynamic fragment at hook:session-start", () => {
    const dyn = frag("dyn", { layer: "shipped", mode: "dynamic" });
    const r = select([dyn], "hook:session-start", cfg(undefined, ["dyn"]), cfg());
    expect(ids(r)).toEqual([]);
  });
});

describe("AC-CF-21 claude-md:project render is independent of user layer and global config", () => {
  const shared = [
    frag("s-one", { layer: "shipped" }),
    frag("p-one", { layer: "project" }),
    frag("s-zh", { layer: "shipped", when: { language: ["zh"] } }),
  ];
  const userA = [frag("u-a", { layer: "user" })];
  const userB = [frag("u-b", { layer: "user" }), frag("u-c", { layer: "user", mode: "dynamic" })];
  const project = cfg("zh");

  it("is byte-equal across differing user-layer fragment sets", () => {
    const a = select([...shared, ...userA], "claude-md:project", cfg(), project);
    const b = select([...shared, ...userB], "claude-md:project", cfg(), project);
    expect(bytes(a)).toBe(bytes(b));
  });

  it("is byte-equal across differing global language", () => {
    const a = select(shared, "claude-md:project", cfg("en"), project);
    const b = select(shared, "claude-md:project", cfg("ja"), project);
    expect(bytes(a)).toBe(bytes(b));
  });

  it("is byte-equal when global config disables an id", () => {
    const a = select(shared, "claude-md:project", cfg(), project);
    const b = select(shared, "claude-md:project", cfg(undefined, ["s-one", "p-one"]), project);
    expect(bytes(a)).toBe(bytes(b));
  });

  it("is byte-equal when the user layer carries an id that shadows a shipped one", () => {
    const a = select(shared, "claude-md:project", cfg(), project);
    const b = select([...shared, frag("s-one", { layer: "user", body: "USER SHADOW" })], "claude-md:project", cfg(), project);
    expect(bytes(a)).toBe(bytes(b));
  });

  it("follows PROJECT language and project disable (control: output is not hardcoded)", () => {
    expect(ids(select(shared, "claude-md:project", cfg(), cfg("zh")))).toEqual(["p-one", "s-one", "s-zh"]);
    expect(ids(select(shared, "claude-md:project", cfg(), cfg("en")))).toEqual(["p-one", "s-one"]);
    expect(ids(select(shared, "claude-md:project", cfg(), cfg("zh", ["p-one"])))).toEqual(["s-one", "s-zh"]);
  });

  it("returns the same order regardless of input order (id ascending, deterministic)", () => {
    const fwd = select(shared, "claude-md:project", cfg(), project);
    const rev = select([...shared].reverse(), "claude-md:project", cfg(), project);
    expect(bytes(fwd)).toBe(bytes(rev));
  });
});
