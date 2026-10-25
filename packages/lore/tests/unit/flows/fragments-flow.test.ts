// @layer unit-fragments-flow AC-CF-4 AC-CF-18 AC-RS-8 (in-process runFragmentsCheck; owners drive the compiled dist/lore)
/**
 * Unit oracles for flows/fragments-flow.ts (render + check), injected InMemoryFsPort.
 * Spec: spec-context-fragments-config-driven-layered-rule-injection D3, D6, D7, D12 —
 * AC-CF-4 (check half), AC-CF-12 (render half), AC-CF-18 (language drift half).
 * Task: task-skill-implement-lore-fragments-render-check-cli-fragments.
 *
 * D15 re-baseline (task-skill-test-d15-red-static-fragments-as-lore-rules-files, owner decision
 * 2026-10-07): static main fragments live in lore-owned `<project>/.claude/rules/lore-<id>.md`
 * files, so drift/staleness is measured against those files (changed, missing or extra), not a
 * CLAUDE.md Z1 `fragments` section. Fresh/stale rules files are produced by the REAL
 * `runContextRefresh` (the hash algorithm is the renderer's business, never re-derived here).
 */
import { describe, expect, it } from "vitest";
import { HOOK_BANNER_CAP, InMemoryFsPort } from "@lore/core";
import {
  buildHookBanner,
  runFragmentsCheck,
  runFragmentsRender,
  type FragmentsFlowDeps,
} from "../../../src/flows/fragments-flow.js";
import { runContextRefresh } from "../../../src/flows/context-flow.js";
import { discoverFragments } from "../../../src/service/context-fragments/discover.js";
import { renderSkillFile } from "../../../src/service/context-fragments/section.js";

const ROOTS = { shipped: "/a/context", user: "/u/context", project: "/p/.lore/context" };
const CLAUDE_MD = "/p/CLAUDE.md";
const USER_SETTINGS = "/h/.claude/settings.json";
const PROJECT_SETTINGS = "/p/.claude/settings.local.json";

function fragmentFile(id: string, inject: string[], body: string, agents?: string[]): string {
  const agentsLine = agents === undefined ? "" : `agents: [${agents.join(", ")}]\n`;
  return `---\nid: ${id}\ntitle: t ${id}\ninject: [${inject.join(", ")}]\n${agentsLine}---\n${body}\n`;
}

function makeDeps(files: Record<string, string>, over: Partial<FragmentsFlowDeps> = {}): FragmentsFlowDeps {
  return {
    fs: new InMemoryFsPort({
      "/a/agents/lore-a.md": "x",
      "/a/agents/lore-b.md": "x",
      "/a/agents/lore-c.md": "x",
      ...files,
    }),
    roots: ROOTS,
    globalConfig: {},
    projectConfig: {},
    projectClaudeMdPath: CLAUDE_MD,
    agentsDir: "/a/agents",
    userAgentsDir: "/u/.claude/agents",
    projectAgentsDir: "/p/.claude/agents",
    userRulesDir: "/u/.claude/rules",
    userSettings: { scope: "user", path: USER_SETTINGS },
    projectSettings: { scope: "project", path: PROJECT_SETTINGS },
    shippedSkillNames: [],
    ...over,
  };
}

const RULES_DIR = "/p/.claude/rules";

/**
 * Runs the REAL refresh over `files` (this file's absolute fixture paths are mapped onto the
 * port-relative layout refresh expects: `/a/context` -> `assets/context`, `/p/.lore/context` ->
 * `.lore/context`) and returns the rules files it wrote, keyed by this file's absolute path.
 */
async function renderedRules(files: Record<string, string>): Promise<Record<string, string>> {
  const rel: Record<string, string> = { "CLAUDE.md": "# Narrative\n\n## What This Is\n\nx\n\n## Commands\n\nx\n\n## Architecture\n\nx\n" };
  for (const [path, content] of Object.entries(files)) {
    if (path.startsWith("/a/context/")) rel[`assets/context/${path.slice("/a/context/".length)}`] = content;
    else if (path.startsWith("/p/.lore/context/")) rel[`.lore/context/${path.slice("/p/.lore/context/".length)}`] = content;
  }
  const fs = new InMemoryFsPort(rel);
  const deps = {
    fs,
    assetsRoot: "assets",
    home: "/h",
    xdgConfigHome: "/x",
    globalConfig: {},
    projectConfig: {},
  } as unknown as Parameters<typeof runContextRefresh>[0];
  const r = await runContextRefresh(deps, "", { scope: "project" } as never);
  if (!r.ok) throw new Error(`fixture refresh failed: ${JSON.stringify(r.error)}`);
  const out: Record<string, string> = {};
  for (const name of await fs.listDir(".claude/rules")) {
    out[`${RULES_DIR}/${name}`] = (await fs.readFile(`.claude/rules/${name}`)) ?? "";
  }
  return out;
}

/** makeDeps whose rules files were rendered from `rendered` sources while the live sources are `current`. */
async function depsWithRules(rendered: Record<string, string>, current: Record<string, string> = rendered) {
  const rules = await renderedRules(rendered);
  return makeDeps({ ...current, ...rules });
}

describe("AC-CF-4 runFragmentsCheck", () => {
  it("clean shipped-only baseline is ok and enumerates agent files + subagent:*", async () => {
    const r = await runFragmentsCheck(makeDeps({ [`${ROOTS.shipped}/s.md`]: fragmentFile("s", ["subagent-start"], "hi") }));
    expect(r.findings).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.agentTypes).toEqual(["lore-a", "lore-b", "lore-c", "subagent:*"]);
    // every agent type was checked at hook:subagent-start
    expect(r.checks.filter((c) => c.outlet === "hook:subagent-start").map((c) => c.agentType)).toEqual(r.agentTypes);
  });

  it("reports BUDGET_EXCEEDED naming the oversized id", async () => {
    const r = await runFragmentsCheck(
      makeDeps({ [`${ROOTS.project}/big.md`]: fragmentFile("cf4-oversized", ["subagent-start"], "x".repeat(9_401)) }),
    );
    expect(r.ok).toBe(false);
    const cap = r.findings.filter((f) => f.kind === "cap");
    expect(cap.length).toBeGreaterThan(0);
    expect(cap[0]?.code).toBe("BUDGET_EXCEEDED");
    expect(cap[0]?.message).toContain("cf4-oversized");
  });

  it("exactly-at-cap fragment is accepted (boundary control)", async () => {
    const r = await runFragmentsCheck(
      makeDeps({ [`${ROOTS.project}/b.md`]: fragmentFile("cf4-edge", ["subagent-start"], "x".repeat(9_399)) }),
    );
    // discoverFragments keeps one leading newline in the body, so 9,399 x's is exactly the 9,400 cap.
    expect(r.findings.filter((f) => f.kind === "cap")).toEqual([]);
    const over = await runFragmentsCheck(
      makeDeps({ [`${ROOTS.project}/b.md`]: fragmentFile("cf4-edge", ["subagent-start"], "x".repeat(9_400)) }),
    );
    expect(over.findings.some((f) => f.kind === "cap")).toBe(true);
  });

  const MAIN = (body: string) => ({ [`${ROOTS.project}/m.md`]: fragmentFile("m", ["launch"], body) });

  it("rules files equal to a fresh render are clean (control: refresh really wrote one)", async () => {
    const deps = await depsWithRules(MAIN("Body M"));
    expect(await deps.fs.exists(`${RULES_DIR}/lore-m.md`)).toBe(true);
    const fresh = await runFragmentsCheck(deps);
    expect(fresh.findings).toEqual([]);
    expect(fresh.ok).toBe(true);
  });

  it("flags rules drift when a lore rules file differs from a fresh render (fragment changed since refresh)", async () => {
    const stale = await runFragmentsCheck(await depsWithRules(MAIN("Old body"), MAIN("Body M")));
    expect(stale.ok).toBe(false);
    expect(stale.findings.map((f) => f.kind)).toContain("rules_drift");
    expect(stale.findings.find((f) => f.kind === "rules_drift")?.message).toContain("lore-m.md");
  });

  it("flags rules drift when a winning static main fragment has NO rules file (missing)", async () => {
    const r = await runFragmentsCheck(await depsWithRules({}, MAIN("Body M")));
    expect(r.ok).toBe(false);
    expect(r.findings.find((f) => f.kind === "rules_drift")?.message).toContain("lore-m.md");
  });

  it("flags rules drift when a lore-*.md file exists for a fragment that no longer exists (extra)", async () => {
    const deps = await depsWithRules(MAIN("Body M"), {});
    await (deps.fs as InMemoryFsPort).writeFile(`${RULES_DIR}/lore-ghost.md`, "<!-- lore:managed fragment=ghost hash=deadbeef -->\nghost body\n");
    const r = await runFragmentsCheck(deps);
    expect(r.ok).toBe(false);
    expect(r.findings.find((f) => f.kind === "rules_drift")?.message).toContain("lore-ghost.md");
  });

  it("a non-lore rules file (team.md) is never drift", async () => {
    const deps = await depsWithRules(MAIN("Body M"));
    await (deps.fs as InMemoryFsPort).writeFile(`${RULES_DIR}/team.md`, "team rule\n");
    expect((await runFragmentsCheck(deps)).findings).toEqual([]);
  });

  it("an old CLAUDE.md Z1 fragments section is NOT consulted any more (no z1_drift kind)", async () => {
    const deps = await depsWithRules(MAIN("Body M"));
    await (deps.fs as InMemoryFsPort).writeFile(CLAUDE_MD, "# N\n\n<!-- lore:managed section=fragments hash=00000000 -->\nstale\n<!-- /lore:managed -->\n");
    const r = await runFragmentsCheck(deps);
    expect(r.findings.map((f) => f.kind)).not.toContain("z1_drift");
    expect(r.findings).toEqual([]);
  });

  it("no rules files and no static main fragments at all is not drift", async () => {
    const r = await runFragmentsCheck(makeDeps({ [`${ROOTS.project}/d.md`]: fragmentFile("d", ["subagent-start"], "dyn") }));
    expect(r.findings).toEqual([]);
  });

  it("refuses a user-layer override of a shipped static main fragment", async () => {
    const r = await runFragmentsCheck(
      makeDeps({
        [`${ROOTS.shipped}/m.md`]: fragmentFile("m", ["launch"], "shipped"),
        [`${ROOTS.user}/m.md`]: fragmentFile("m", ["launch"], "user"),
      }),
    );
    expect(r.findings.map((f) => f.kind)).toContain("override_refusal");
  });

  it("reports a discovery failure (duplicate id in one layer) instead of throwing", async () => {
    const r = await runFragmentsCheck(
      makeDeps({
        [`${ROOTS.project}/a.md`]: fragmentFile("dup", ["launch"], "1"),
        [`${ROOTS.project}/b.md`]: fragmentFile("dup", ["launch"], "2"),
      }),
    );
    expect(r.findings[0]?.kind).toBe("discovery");
  });

  it("fails loud when no agent files exist", async () => {
    const deps = makeDeps({}, { agentsDir: "/missing/agents" });
    const r = await runFragmentsCheck(deps);
    expect(r.findings.map((f) => f.kind)).toContain("no_agent_types");
  });
});

describe("AC-CF-18 language drift in runFragmentsCheck", () => {
  const withLang = (settings: string | undefined, over: Partial<FragmentsFlowDeps> = {}) =>
    makeDeps(settings === undefined ? {} : { [USER_SETTINGS]: settings }, { globalConfig: { context: { language: "zh" } }, ...over });

  it("equal -> clean; different -> finding naming both values", async () => {
    expect((await runFragmentsCheck(withLang(JSON.stringify({ language: "Chinese" })))).findings).toEqual([]);
    const drifted = await runFragmentsCheck(withLang(JSON.stringify({ language: "French" })));
    const finding = drifted.findings.find((f) => f.kind === "language_drift");
    expect(finding?.message).toContain("French");
    expect(finding?.message).toContain("Chinese");
  });

  it("project language is compared against settings.local.json only", async () => {
    const r = await runFragmentsCheck(
      makeDeps(
        { [PROJECT_SETTINGS]: JSON.stringify({ language: "English" }), [USER_SETTINGS]: JSON.stringify({ language: "French" }) },
        { projectConfig: { context: { language: "en" } } },
      ),
    );
    expect(r.findings).toEqual([]); // user settings has no global language to disagree with
  });

  it("unknown language code and malformed settings are findings, not silence", async () => {
    const unknown = await runFragmentsCheck(makeDeps({}, { globalConfig: { context: { language: "zz9" } } }));
    expect(unknown.findings.find((f) => f.kind === "language_unknown")?.message).toContain("zz9");
    const bad = await runFragmentsCheck(withLang("{not json"));
    expect(bad.findings.map((f) => f.kind)).toContain("settings_unreadable");
  });
});

describe("runFragmentsRender (helper start only; hook:session-start retired, BR-912)", () => {
  it("helper-start carries no stale-rules notice even when a rules file drifted (BR-909/BR-910 retired)", async () => {
    const sub = { [`${ROOTS.project}/sub.md`]: fragmentFile("sub", ["subagent-start"], "SUB-BLOCK") };
    const st = (body: string) => ({ [`${ROOTS.project}/st.md`]: fragmentFile("st", ["launch"], body) });
    const stale = await runFragmentsRender(await depsWithRules({ ...sub, ...st("Original") }, { ...sub, ...st("Changed NONCE-9") }), {
      outlet: "hook:subagent-start",
    });
    expect(stale.ok).toBe(true);
    if (!stale.ok) return;
    expect(stale.value.additionalContext.trim()).toBe("SUB-BLOCK");
    expect(stale.value.additionalContext).not.toContain("stale-managed-context");
    expect(stale.value.additionalContext).not.toContain("NONCE-9");
  });

  it("render subagent-start selects subagent:<type> and rejects over-cap with BUDGET_EXCEEDED", async () => {
    const ok = await runFragmentsRender(
      makeDeps({
        [`${ROOTS.shipped}/all.md`]: fragmentFile("all", ["subagent-start"], "ALL"),
        [`${ROOTS.shipped}/t.md`]: fragmentFile("t", ["subagent-start"], "ONLY-TESTER", ["tester"]),
      }),
      { outlet: "hook:subagent-start", agentType: "tester" },
    );
    // discoverFragments keeps each body's raw newlines; pin the content and order, not the whitespace.
    expect(ok.ok && ok.value.additionalContext.split(/\s+/).filter(Boolean)).toEqual(["ALL", "ONLY-TESTER"]);

    const over = await runFragmentsRender(
      makeDeps({ [`${ROOTS.project}/big.md`]: fragmentFile("big-one", ["subagent-start"], "x".repeat(9_401)) }),
      { outlet: "hook:subagent-start" },
    );
    expect(over.ok).toBe(false);
    if (over.ok) return;
    expect(over.error.code).toBe("BUDGET_EXCEEDED");
    expect(over.error.message).toContain("big-one");
  });

  it("render surfaces discovery errors as VALIDATION_ERROR", async () => {
    const r = await runFragmentsRender(makeDeps({ [`${ROOTS.project}/bad.md`]: "no frontmatter" }), { outlet: "hook:subagent-start" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("D12 buildHookBanner", () => {
  it("is at most HOOK_BANNER_CAP chars and keeps the error code first", () => {
    const banner = buildHookBanner({ code: "BUDGET_EXCEEDED", message: "z".repeat(2_000) });
    expect(banner.length).toBeLessThanOrEqual(HOOK_BANNER_CAP);
    expect(banner).toContain("BUDGET_EXCEEDED");
  });

  it("short message passes through untruncated", () => {
    expect(buildHookBanner({ code: "VALIDATION_ERROR", message: "bad" })).toBe("lore fragments VALIDATION_ERROR: bad");
  });
});

// ─── rule-store T6: duplicate / selection / skill findings ──────────────────
// Spec: spec-rule-store-fragment-selection-on-demand-skill (Scope 6, AC-RS-8 unit half;
// BR-1062, BR-1064, BR-1066, BR-1067). Each new finding kind has a failing case AND a clean control.
describe("AC-RS-8 runFragmentsCheck rule-store findings", () => {
  // A helper (any agent type) fragment: one reading group, no rules file needed.
  const dyn = (id: string, body: string, layer: keyof typeof ROOTS = "project") => ({
    [`${ROOTS[layer]}/${id}.md`]: fragmentFile(id, ["subagent-start"], body),
  });
  const skillSource = (id: string, body: string) => ({
    [`${ROOTS.project}/${id}.md`]: `---\nid: ${id}\ntitle: t ${id}\ninject: [on-demand]\ndescription: d ${id}\n---\n${body}\n`,
  });
  const SKILLS_DIR = "/p/.claude/skills";
  const selectionText = (ids: string[]) => `schemaVersion: 1\ndisable: [${ids.join(", ")}]\n`;

  /** The REAL renderer's SKILL.md for every skill fragment in `files`, keyed by absolute path. */
  async function renderedSkills(files: Record<string, string>): Promise<Record<string, string>> {
    const found = await discoverFragments(new InMemoryFsPort(files), {
      shipped: "/none-shipped",
      user: "/none-user",
      project: ROOTS.project,
    });
    if (!found.ok) throw new Error(`fixture discovery failed: ${found.error.message}`);
    const out: Record<string, string> = {};
    for (const fragment of found.value) {
      if (!fragment.frontmatter.inject.includes("on-demand")) continue;
      const rendered = renderSkillFile(fragment);
      if (!rendered.ok) throw new Error(rendered.error.message);
      out[`${SKILLS_DIR}/${rendered.value.dirName}/SKILL.md`] = rendered.value.content;
    }
    return out;
  }

  const kinds = (r: Awaited<ReturnType<typeof runFragmentsCheck>>) => r.findings.map((f) => f.kind);

  it("duplicate_line: the same line in two fragments one session reads fails; distinct lines are clean", async () => {
    const dup = await runFragmentsCheck(
      makeDeps({ ...dyn("a", "Always run the linter first."), ...dyn("b", "Always run the linter first.") }),
    );
    expect(dup.ok).toBe(false);
    const finding = dup.findings.find((f) => f.kind === "duplicate_line");
    expect(finding?.code).toBe("VALIDATION_ERROR");
    expect(finding?.message).toContain("Always run the linter first.");
    expect(finding?.message).toContain("a");
    expect(finding?.message).toContain("b");

    const clean = await runFragmentsCheck(
      makeDeps({ ...dyn("a", "Always run the linter first."), ...dyn("b", "Never skip the type check.") }),
    );
    expect(clean.findings).toEqual([]);
  });

  it("shipped_user_prompt: a shipped fragment naming user-prompt is a finding naming its id; a project one is not (spec D7)", async () => {
    const hit = await runFragmentsCheck(makeDeps({ [`${ROOTS.shipped}/up.md`]: fragmentFile("up", ["user-prompt"], "x") }));
    expect(hit.ok).toBe(false);
    const finding = hit.findings.find((f) => f.kind === "shipped_user_prompt");
    expect(finding?.code).toBe("VALIDATION_ERROR");
    expect(finding?.message).toContain('"up"');

    const project = await runFragmentsCheck(makeDeps({ [`${ROOTS.project}/up.md`]: fragmentFile("up", ["user-prompt"], "x") }));
    expect(kinds(project)).not.toContain("shipped_user_prompt");
  });

  it("duplicate_line: fragments of different reading groups are not compared (main vs helper control)", async () => {
    const files = {
      [`${ROOTS.project}/m.md`]: fragmentFile("m", ["launch"], "Shared line."),
      [`${ROOTS.project}/h.md`]: fragmentFile("h", ["subagent-start"], "Shared line."),
    };
    expect(kinds(await runFragmentsCheck(makeDeps(files)))).not.toContain("duplicate_line");
  });

  it("selection_unknown_id: a disable id no fragment has fails; a known id is clean", async () => {
    const files = dyn("known", "Some rule.");
    const bad = await runFragmentsCheck(makeDeps(files, { projectSelectionText: selectionText(["ghost-id"]) }));
    expect(bad.ok).toBe(false);
    const finding = bad.findings.find((f) => f.kind === "selection_unknown_id");
    expect(finding?.message).toContain("ghost-id");
    expect(finding?.message).toContain("project");

    const userBad = await runFragmentsCheck(makeDeps(files, { userSelectionText: selectionText(["ghost-user"]) }));
    expect(userBad.findings.find((f) => f.kind === "selection_unknown_id")?.message).toContain("ghost-user");

    const clean = await runFragmentsCheck(makeDeps(files, { projectSelectionText: selectionText(["known"]) }));
    expect(clean.findings).toEqual([]);
  });

  it("selection_in_config: fragments.disable left in a settings-file layer fails; the same list in selection.yaml is clean", async () => {
    const files = dyn("known", "Some rule.");
    const inConfig = await runFragmentsCheck(
      makeDeps(files, { projectConfig: { context: { fragments: { disable: ["known"] } } } }),
    );
    expect(inConfig.ok).toBe(false);
    const finding = inConfig.findings.find((f) => f.kind === "selection_in_config");
    expect(finding?.message).toContain("selection.yaml");
    expect(finding?.message).toContain("known");

    const inSelection = await runFragmentsCheck(makeDeps(files, { projectSelectionText: selectionText(["known"]) }));
    expect(kinds(inSelection)).not.toContain("selection_in_config");
  });

  it("selection file that is not valid YAML/shape is a finding, not a throw", async () => {
    const r = await runFragmentsCheck(makeDeps(dyn("known", "x"), { projectSelectionText: "disable: nope" }));
    expect(r.ok).toBe(false);
    expect(r.findings.find((f) => f.kind === "selection")?.message).toContain("selection");
  });

  it("selection really disables: a duplicate vanishes once one side is disabled in selection.yaml", async () => {
    const files = { ...dyn("a", "Same line here."), ...dyn("b", "Same line here.") };
    expect(kinds(await runFragmentsCheck(makeDeps(files)))).toContain("duplicate_line");
    const r = await runFragmentsCheck(makeDeps(files, { projectSelectionText: selectionText(["b"]) }));
    expect(r.findings).toEqual([]);
  });

  it("skill_collision: a skill fragment named like a shipped skill fails; another name is clean", async () => {
    const files = skillSource("ai-native-coding", "Body.");
    const deps = async (shipped: string[]) =>
      makeDeps({ ...files, ...(await renderedSkills(files)) }, { shippedSkillNames: shipped });

    const hit = await runFragmentsCheck(await deps(["lore-ai-native-coding", "lore-plan"]));
    expect(hit.ok).toBe(false);
    const finding = hit.findings.find((f) => f.kind === "skill_collision");
    expect(finding?.message).toContain("lore-ai-native-coding");
    expect(finding?.message).toContain("ai-native-coding");

    const clean = await runFragmentsCheck(await deps(["lore-plan"]));
    expect(clean.findings).toEqual([]);
  });

  it("skills_drift: missing, changed and extra project skill dirs fail; fresh dirs and foreign dirs are clean", async () => {
    const files = skillSource("my-skill", "Body one.");
    const rendered = await renderedSkills(files);
    const fresh = await runFragmentsCheck(makeDeps({ ...files, ...rendered }));
    expect(fresh.findings).toEqual([]); // control: the real renderer's output is clean

    const missing = await runFragmentsCheck(makeDeps(files));
    expect(missing.findings.find((f) => f.kind === "skills_drift")?.message).toContain("lore-my-skill");

    const stalePath = `${SKILLS_DIR}/lore-my-skill/SKILL.md`;
    const changed = await runFragmentsCheck(makeDeps({ ...files, ...rendered, [stalePath]: `${rendered[stalePath]}edited\n` }));
    expect(changed.findings.find((f) => f.kind === "skills_drift")?.message).toContain("changed");

    const ghost = await renderedSkills(skillSource("ghost", "Gone."));
    const extra = await runFragmentsCheck(makeDeps({ ...files, ...rendered, ...ghost }));
    expect(extra.findings.find((f) => f.kind === "skills_drift")?.message).toContain("lore-ghost");

    const foreign = await runFragmentsCheck(
      makeDeps({
        ...files,
        ...rendered,
        [`${SKILLS_DIR}/lore-shipped-thing/SKILL.md`]: "---\nname: x\n---\nnot fingerprinted\n",
        [`${SKILLS_DIR}/team-skill/SKILL.md`]: "mine",
      }),
    );
    expect(foreign.findings).toEqual([]);
  });
});
