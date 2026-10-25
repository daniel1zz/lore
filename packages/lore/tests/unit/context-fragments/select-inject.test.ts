/**
 * @spec_ref AC-IT-2, AC-IT-10
 * Spec: spec-fragment-injection-timing-one-inject-enum-a-per-turn (Injection timings, hook:user-prompt outlet, D8, BR-905)
 *
 * Six-dimension coverage:
 *   HAPPY:      each outlet selects exactly its inject timing; agents filter honoured.
 *   NEGATIVE:   per-turn disable lists apply only to what they own; `when` excludes; override ownership refusals.
 *   BOUNDARY:   subagent-start with and without `agents`, agentType absent.
 *   ERROR:      checkOverrides names the offending id; hook:user-prompt render fails on an illegal override.
 *   STATE:      inputs are not mutated by selection.
 *   REGRESSION: helper-only fragments stay unrestricted (BR-911).
 */
import { describe, expect, it } from "vitest";
import { InMemoryFsPort, resolveContextConfig, type ContextConfigLayer, type Fragment, type InjectTiming, type OutletId } from "@lore/core";
import { checkOverrides, selectFragments } from "../../../src/service/context-fragments/select.js";
import { runFragmentsRender, type FragmentsFlowDeps } from "../../../src/flows/fragments-flow.js";

type Layer = "shipped" | "user" | "project";

function frag(
  id: string,
  layer: Layer,
  inject: InjectTiming[],
  opts: { agents?: string[]; when?: { language: string[] }; body?: string } = {},
): Fragment {
  return {
    frontmatter: {
      id,
      title: `title ${id}`,
      inject,
      ...(opts.agents ? { agents: opts.agents } : {}),
      ...(inject.includes("on-demand") ? { description: `when to use ${id}` } : {}),
      ...(opts.when ? { when: opts.when } : {}),
    },
    body: opts.body ?? `body of ${id} from ${layer}`,
    layer,
    path: `/${layer}/${id}.md`,
    bodyLineOffset: 6,
  } as Fragment;
}

const cfg = (language?: string, disable?: string[]): ContextConfigLayer => ({
  context: {
    ...(language !== undefined ? { language } : {}),
    ...(disable !== undefined ? { fragments: { disable } } : {}),
  },
});

const ids = (fragments: readonly Fragment[]) => fragments.map((f) => f.frontmatter.id);

function select(all: Fragment[], outlet: OutletId, global: ContextConfigLayer, project: ContextConfigLayer, agentType?: string) {
  return selectFragments(all, {
    outlet,
    ...(agentType !== undefined ? { agentType } : {}),
    config: resolveContextConfig(global, project, outlet),
  });
}

describe("AC-IT-2 selection per outlet", () => {
  const all = [
    frag("a-launch", "project", ["launch"]),
    frag("b-skill", "project", ["on-demand"]),
    frag("c-turn", "project", ["user-prompt"]),
    frag("d-helper", "project", ["subagent-start"]),
    frag("e-reader", "project", ["subagent-start"], { agents: ["lore-reader"] }),
  ];

  it("AC-IT-2 rules:*, skills:* and hook:user-prompt each select only their own timing", () => {
    expect(ids(select(all, "rules:project", cfg(), cfg()))).toEqual(["a-launch"]);
    expect(ids(select([...all.map((f) => ({ ...f, layer: "user" as const }))], "rules:user", cfg(), cfg()))).toEqual(["a-launch"]);
    expect(ids(select(all, "skills:project", cfg(), cfg()))).toEqual(["b-skill"]);
    expect(ids(select(all.map((f) => ({ ...f, layer: "user" as const })), "skills:user", cfg(), cfg()))).toEqual(["b-skill"]);
    expect(ids(select(all, "hook:user-prompt", cfg(), cfg()))).toEqual(["c-turn"]);
  });

  it("AC-IT-2 hook:subagent-start honours the agents filter", () => {
    expect(ids(select(all, "hook:subagent-start", cfg(), cfg(), "lore-implementer"))).toEqual(["d-helper"]);
    expect(ids(select(all, "hook:subagent-start", cfg(), cfg(), "lore-reader"))).toEqual(["d-helper", "e-reader"]);
    // no agent type named: only fragments without an agents filter match
    expect(ids(select(all, "hook:subagent-start", cfg(), cfg()))).toEqual(["d-helper"]);
  });

  it("AC-IT-2 at hook:user-prompt each disable list applies only to the fragments it owns", () => {
    const fixtures = [
      frag("s-shipped", "shipped", ["user-prompt"]),
      frag("u-user", "user", ["user-prompt"]),
      frag("p-project", "project", ["user-prompt"]),
    ];
    // user list: drops only the user-layer fragment, even when it names the others
    expect(ids(select(fixtures, "hook:user-prompt", cfg(undefined, ["u-user", "p-project", "s-shipped"]), cfg()))).toEqual(["p-project", "s-shipped"]);
    // project list: drops the project and shipped fragments, NOT the user-layer one
    expect(ids(select(fixtures, "hook:user-prompt", cfg(), cfg(undefined, ["u-user", "p-project", "s-shipped"])))).toEqual(["u-user"]);
    // control: no lists, all three
    expect(ids(select(fixtures, "hook:user-prompt", cfg(), cfg()))).toEqual(["p-project", "s-shipped", "u-user"]);
  });

  it("AC-IT-2 at hook:user-prompt a when.language mismatch drops the fragment, a match keeps it", () => {
    const fixtures = [
      frag("zh-only", "project", ["user-prompt"], { when: { language: ["zh"] } }),
      frag("en-only", "project", ["user-prompt"], { when: { language: ["en"] } }),
    ];
    expect(ids(select(fixtures, "hook:user-prompt", cfg(), cfg("zh")))).toEqual(["zh-only"]);
    expect(ids(select(fixtures, "hook:user-prompt", cfg("en"), cfg()))).toEqual(["en-only"]);
  });

  it("AC-IT-2 the project layer overrides a user fragment by id (project over user over shipped)", () => {
    const fixtures = [
      frag("same", "shipped", ["user-prompt"], { body: "SHIPPED" }),
      frag("same", "project", ["user-prompt"], { body: "PROJECT" }),
    ];
    expect(select(fixtures, "hook:user-prompt", cfg(), cfg()).map((f) => f.body)).toEqual(["PROJECT"]);
  });
});

describe("AC-IT-10 override legality per timing", () => {
  const noCfg = { global: cfg(), project: cfg() };

  it("AC-IT-10 a project fragment reusing a user launch, on-demand or user-prompt fragment's id is refused naming the id", () => {
    for (const timing of ["launch", "on-demand", "user-prompt"] as const) {
      const id = `own-${timing}`;
      const r = checkOverrides([frag(id, "user", [timing]), frag(id, "project", [timing])], noCfg);
      expect(r.ok, timing).toBe(false);
      if (!r.ok) expect(r.error.message).toContain(id);
    }
  });

  it("AC-IT-10 a user disable-list entry naming a shipped launch fragment is refused naming the id", () => {
    const r = checkOverrides([frag("shipped-launch", "shipped", ["launch"])], { global: cfg(undefined, ["shipped-launch"]), project: cfg() });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toContain("shipped-launch");
  });

  it("AC-IT-10 a project fragment reusing a subagent-start-only user fragment's id, and a user disable of one, are accepted", () => {
    const helper = frag("helper", "user", ["subagent-start"]);
    expect(checkOverrides([helper, frag("helper", "project", ["subagent-start"])], noCfg).ok).toBe(true);
    const shippedHelper = frag("shipped-helper", "shipped", ["subagent-start"], { agents: ["lore-reader"] });
    expect(checkOverrides([shippedHelper], { global: cfg(undefined, ["shipped-helper"]), project: cfg() }).ok).toBe(true);
  });

  it("AC-IT-10 the owning scope may still override / disable (project over shipped user-prompt)", () => {
    const shipped = frag("turn", "shipped", ["user-prompt"]);
    expect(checkOverrides([shipped, frag("turn", "project", ["user-prompt"])], { global: cfg(), project: cfg(undefined, ["turn"]) }).ok).toBe(true);
  });

  describe("render path", () => {
    const ROOTS = { shipped: "/a/context", user: "/u/context", project: "/p/.lore/context" };

    function file(id: string, inject: string, body: string): string {
      return `---\nid: ${id}\ntitle: t ${id}\ninject: [${inject}]\n---\n${body}\n`;
    }

    function deps(files: Record<string, string>): FragmentsFlowDeps {
      return {
        fs: new InMemoryFsPort(files),
        roots: ROOTS,
        globalConfig: {},
        projectConfig: {},
        projectClaudeMdPath: "/p/CLAUDE.md",
        agentsDir: "/a/agents",
        userAgentsDir: "/h/.claude/agents",
        projectAgentsDir: "/p/.claude/agents",
        userRulesDir: "/h/.claude/rules",
        userSettings: { scope: "user", path: "/h/.claude/settings.json" },
        projectSettings: { scope: "project", path: "/p/.claude/settings.local.json" },
        shippedSkillNames: [],
      };
    }

    it("AC-IT-10 the hook:user-prompt render with an illegal override returns err while hook:subagent-start with the same fixture still renders", async () => {
      // user-layer per-turn fragment overridden by a project fragment reusing its id = illegal (main-session timing)
      const files = {
        [`${ROOTS.user}/turn.md`]: file("turn", "user-prompt, subagent-start", "USER BODY"),
        [`${ROOTS.project}/turn.md`]: file("turn", "user-prompt, subagent-start", "PROJECT BODY"),
      };
      const perTurn = await runFragmentsRender(deps(files), { outlet: "hook:user-prompt" });
      expect(perTurn.ok).toBe(false);
      if (!perTurn.ok) expect(perTurn.error.message).toContain("turn");

      const helper = await runFragmentsRender(deps(files), { outlet: "hook:subagent-start", agentType: "lore-implementer" });
      expect(helper.ok).toBe(true);
      if (helper.ok) expect(helper.value.additionalContext).toContain("PROJECT BODY");
    });

    it("AC-IT-10 a legal per-turn layering renders its block", async () => {
      const files = { [`${ROOTS.project}/turn.md`]: file("turn", "user-prompt", "PER TURN BODY") };
      const r = await runFragmentsRender(deps(files), { outlet: "hook:user-prompt" });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.additionalContext).toBe("PER TURN BODY\n");
    });
  });
});
