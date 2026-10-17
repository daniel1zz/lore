// @layer core-module (pure @lore/core context-fragments config/schema/constants; owners drive packages/lore select/render flows and the compiled dist/lore)
/**
 * @layer core-module (context-fragments.ts; the ACs' oracles are the lore select/render suites and the compiled e2e)
 * @spec_ref AC-CF-2, AC-CF-3, AC-CF-14, AC-CF-18
 * Spec: spec-context-fragments-config-driven-layered-rule-injection (D3, D6, D11, D14)
 *
 * RED tests for the not-yet-existing packages/core/src/context-fragments.ts.
 * Pure module, no IO.
 *
 * Six-dimension coverage:
 *   HAPPY:      outlet-scoped config resolution (user -> global only, project -> project only,
 *               hooks -> project over global); schema accepts the spec example; constants.
 *   NEGATIVE:   schema rejects unknown keys, audience 'subagents:*', mode 'always';
 *               global disable never leaks into rules:project; project config never
 *               leaks into rules:user.
 *   BOUNDARY:   cap arithmetic (10_000 - 600 = 9_400, 10_000 - 400 = 9_600); empty configs.
 *   ERROR:      missing required frontmatter fields fail validation, no silent default.
 *   STATE:      resolveContextConfig does not mutate its inputs.
 *   REGRESSION: GH #20 (silent hook string truncation) is guarded by the cap constants.
 */
import { describe, it, expect } from "vitest";
import {
  resolveContextConfig,
  FragmentFrontmatterSchema,
  HOOK_STRING_CAP,
  POINTER_CEILING,
  HOOK_BANNER_CAP,
  OUTLET_IDS,
  SUBAGENT_FRAGMENT_CAP,
  LANGUAGE_NAMES,
} from "../../src/context-fragments.js";

const cfg = (language?: string, disable?: string[]) => ({
  context: {
    ...(language !== undefined ? { language } : {}),
    ...(disable !== undefined ? { fragments: { disable } } : {}),
  },
});

describe("resolveContextConfig outlet scoping (D11, D14)", () => {
  const global = cfg("zh", ["g-only"]);
  const project = cfg("en", ["p-only"]);

  it("rules:user uses the GLOBAL language only", () => {
    expect(resolveContextConfig(global, project, "rules:user").language).toBe("zh");
  });

  it("rules:project uses the PROJECT language only", () => {
    expect(resolveContextConfig(global, project, "rules:project").language).toBe("en");
  });

  it("hook:subagent-start merges with project over global", () => {
    expect(resolveContextConfig(global, project, "hook:subagent-start").language).toBe("en");
  });

  it("hook outlets fall back to global language when project sets none", () => {
    const r = resolveContextConfig(cfg("zh"), cfg(), "hook:subagent-start");
    expect(r.language).toBe("zh");
  });

  it("different inputs give different outputs (not hardcoded)", () => {
    const r = resolveContextConfig(cfg("ja"), cfg("en"), "rules:user");
    expect(r.language).toBe("ja");
  });

  it("rules:user ignores project language even when global has none", () => {
    const r = resolveContextConfig(cfg(), cfg("en"), "rules:user");
    expect(r.language).toBeNull();
  });

  it("rules:project ignores global language even when project has none", () => {
    const r = resolveContextConfig(cfg("zh"), cfg(), "rules:project");
    expect(r.language).toBeNull();
  });

  it("language is null when neither layer sets it", () => {
    expect(resolveContextConfig({}, {}, "hook:subagent-start").language).toBeNull();
  });

  it("global disable list reaches rules:user", () => {
    const r = resolveContextConfig(global, project, "rules:user");
    expect(r.disabled.has("g-only")).toBe(true);
  });

  it("global disable list does NOT reach rules:project", () => {
    const r = resolveContextConfig(global, project, "rules:project");
    expect(r.disabled.has("g-only")).toBe(false);
  });

  it("project disable list does NOT reach rules:user", () => {
    const r = resolveContextConfig(global, project, "rules:user");
    expect(r.disabled.has("p-only")).toBe(false);
  });

  it("project disable list reaches rules:project", () => {
    const r = resolveContextConfig(global, project, "rules:project");
    expect(r.disabled.has("p-only")).toBe(true);
  });

  it("hook outlets see both global and project disables", () => {
    const r = resolveContextConfig(global, project, "hook:subagent-start");
    expect([...r.disabled].sort()).toEqual(["g-only", "p-only"]);
  });

  it("disabled is an empty set when no config disables anything", () => {
    expect(resolveContextConfig({}, {}, "rules:project").disabled.size).toBe(0);
  });

  it("exposes a languageSource field", () => {
    const r = resolveContextConfig(global, project, "rules:user");
    expect(r).toHaveProperty("languageSource");
  });

  it("does not mutate its inputs", () => {
    const g = cfg("zh", ["a"]);
    const p = cfg("en", ["b"]);
    const before = JSON.stringify([g, p]);
    resolveContextConfig(g, p, "hook:subagent-start");
    expect(JSON.stringify([g, p])).toBe(before);
  });
});

describe("FragmentFrontmatterSchema (D1, routing table)", () => {
  const specExample = {
    id: "comm-zh",
    title: "交流语言与输出风格",
    audience: ["main", "subagent:*"],
    mode: "static",
    when: { language: ["zh"] },
  };

  it("accepts the spec example frontmatter", () => {
    expect(FragmentFrontmatterSchema.safeParse(specExample).success).toBe(true);
  });

  it("accepts audience subagent:<agent_type>", () => {
    const r = FragmentFrontmatterSchema.safeParse({ ...specExample, audience: ["subagent:tester"] });
    expect(r.success).toBe(true);
  });

  it("accepts mode dynamic", () => {
    expect(FragmentFrontmatterSchema.safeParse({ ...specExample, mode: "dynamic" }).success).toBe(true);
  });

  it("accepts a fragment without the optional 'when'", () => {
    const { when: _when, ...noWhen } = specExample;
    expect(FragmentFrontmatterSchema.safeParse(noWhen).success).toBe(true);
  });

  it("rejects unknown keys (strict)", () => {
    expect(FragmentFrontmatterSchema.safeParse({ ...specExample, priority: 5 }).success).toBe(false);
  });

  it("rejects audience 'subagents:*' (typo of subagent:*)", () => {
    const r = FragmentFrontmatterSchema.safeParse({ ...specExample, audience: ["subagents:*"] });
    expect(r.success).toBe(false);
  });

  it("rejects mode 'always'", () => {
    expect(FragmentFrontmatterSchema.safeParse({ ...specExample, mode: "always" }).success).toBe(false);
  });

  it("rejects a missing id", () => {
    const { id: _id, ...noId } = specExample;
    expect(FragmentFrontmatterSchema.safeParse(noId).success).toBe(false);
  });

  it("rejects a missing mode (no silent default)", () => {
    const { mode: _mode, ...noMode } = specExample;
    expect(FragmentFrontmatterSchema.safeParse(noMode).success).toBe(false);
  });

  it("rejects an empty audience list", () => {
    expect(FragmentFrontmatterSchema.safeParse({ ...specExample, audience: [] }).success).toBe(false);
  });

  it("rejects a non-array audience string", () => {
    expect(FragmentFrontmatterSchema.safeParse({ ...specExample, audience: "main" }).success).toBe(false);
  });
});

describe("cap constants (D6, GH #20)", () => {
  it("HOOK_STRING_CAP is 10_000", () => {
    expect(HOOK_STRING_CAP).toBe(10_000);
  });

  it("POINTER_CEILING is 600 and HOOK_BANNER_CAP is 400", () => {
    expect([POINTER_CEILING, HOOK_BANNER_CAP]).toEqual([600, 400]);
  });

  it("HOOK_STRING_CAP - POINTER_CEILING === SUBAGENT_FRAGMENT_CAP === 9400", () => {
    expect(HOOK_STRING_CAP - POINTER_CEILING).toBe(SUBAGENT_FRAGMENT_CAP);
    expect(SUBAGENT_FRAGMENT_CAP).toBe(9400);
  });

  it("hook:session-start is not an outlet (retired, BR-912): helper start is the only hook outlet", () => {
    expect(OUTLET_IDS.filter((id) => id.startsWith("hook:"))).toEqual(["hook:subagent-start"]);
  });
});

describe("LANGUAGE_NAMES (D3)", () => {
  it("maps zh to Chinese", () => {
    expect(LANGUAGE_NAMES.zh).toBe("Chinese");
  });

  it("maps en to English and ja to Japanese", () => {
    expect([LANGUAGE_NAMES.en, LANGUAGE_NAMES.ja]).toEqual(["English", "Japanese"]);
  });

  it("has no entry for an unknown code", () => {
    expect((LANGUAGE_NAMES as Record<string, string>)["xx"]).toBeUndefined();
  });
});
