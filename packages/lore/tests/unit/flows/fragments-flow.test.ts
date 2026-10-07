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
import { HOOK_STRING_CAP, InMemoryFsPort, NOTICE_RESERVE } from "@lore/core";
import {
  buildHookBanner,
  composeSessionStart,
  FRAGMENTS_STALE_MARKER,
  runFragmentsCheck,
  runFragmentsRender,
  type FragmentsFlowDeps,
} from "../../../src/flows/fragments-flow.js";
import { runContextRefresh } from "../../../src/flows/context-flow.js";

const ROOTS = { shipped: "/a/context", user: "/u/context", project: "/p/.lore/context" };
const CLAUDE_MD = "/p/CLAUDE.md";
const USER_SETTINGS = "/h/.claude/settings.json";
const PROJECT_SETTINGS = "/p/.claude/settings.local.json";

function fragmentFile(id: string, audience: string[], mode: "static" | "dynamic", body: string): string {
  return `---\nid: ${id}\ntitle: t ${id}\naudience: [${audience.map((a) => JSON.stringify(a)).join(", ")}]\nmode: ${mode}\n---\n${body}\n`;
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
    userSettings: { scope: "user", path: USER_SETTINGS },
    projectSettings: { scope: "project", path: PROJECT_SETTINGS },
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
  const rel: Record<string, string> = { "CLAUDE.md": "# Narrative\n" };
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
    const r = await runFragmentsCheck(makeDeps({ [`${ROOTS.shipped}/s.md`]: fragmentFile("s", ["subagent:*"], "dynamic", "hi") }));
    expect(r.findings).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.agentTypes).toEqual(["lore-a", "lore-b", "lore-c", "subagent:*"]);
    // every agent type was checked at hook:subagent-start
    expect(r.checks.filter((c) => c.outlet === "hook:subagent-start").map((c) => c.agentType)).toEqual(r.agentTypes);
  });

  it("reports BUDGET_EXCEEDED naming the oversized id", async () => {
    const r = await runFragmentsCheck(
      makeDeps({ [`${ROOTS.project}/big.md`]: fragmentFile("cf4-oversized", ["subagent:*"], "dynamic", "x".repeat(9_401)) }),
    );
    expect(r.ok).toBe(false);
    const cap = r.findings.filter((f) => f.kind === "cap");
    expect(cap.length).toBeGreaterThan(0);
    expect(cap[0]?.code).toBe("BUDGET_EXCEEDED");
    expect(cap[0]?.message).toContain("cf4-oversized");
  });

  it("exactly-at-cap fragment is accepted (boundary control)", async () => {
    const r = await runFragmentsCheck(
      makeDeps({ [`${ROOTS.project}/b.md`]: fragmentFile("cf4-edge", ["subagent:*"], "dynamic", "x".repeat(9_399)) }),
    );
    // discoverFragments keeps one leading newline in the body, so 9,399 x's is exactly the 9,400 cap.
    expect(r.findings.filter((f) => f.kind === "cap")).toEqual([]);
    const over = await runFragmentsCheck(
      makeDeps({ [`${ROOTS.project}/b.md`]: fragmentFile("cf4-edge", ["subagent:*"], "dynamic", "x".repeat(9_400)) }),
    );
    expect(over.findings.some((f) => f.kind === "cap")).toBe(true);
  });

  const MAIN = (body: string) => ({ [`${ROOTS.project}/m.md`]: fragmentFile("m", ["main"], "static", body) });

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
    const r = await runFragmentsCheck(makeDeps({ [`${ROOTS.project}/d.md`]: fragmentFile("d", ["main"], "dynamic", "dyn") }));
    expect(r.findings).toEqual([]);
  });

  it("refuses a user-layer override of a shipped static main fragment", async () => {
    const r = await runFragmentsCheck(
      makeDeps({
        [`${ROOTS.shipped}/m.md`]: fragmentFile("m", ["main"], "static", "shipped"),
        [`${ROOTS.user}/m.md`]: fragmentFile("m", ["main"], "static", "user"),
      }),
    );
    expect(r.findings.map((f) => f.kind)).toContain("override_refusal");
  });

  it("reports a discovery failure (duplicate id in one layer) instead of throwing", async () => {
    const r = await runFragmentsCheck(
      makeDeps({
        [`${ROOTS.project}/a.md`]: fragmentFile("dup", ["main"], "static", "1"),
        [`${ROOTS.project}/b.md`]: fragmentFile("dup", ["main"], "static", "2"),
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

describe("AC-CF-12 composeSessionStart / runFragmentsRender", () => {
  it("fresh: block only, no marker", () => {
    expect(composeSessionStart({ block: "B", stale: false, changed: [{ id: "x", body: "nonce" }] })).toBe("B");
  });

  it("stale: marker + changed bodies when they fit", () => {
    const out = composeSessionStart({ block: "B", stale: true, changed: [{ id: "x", body: "NONCE-1" }] });
    expect(out.startsWith("B\n\n")).toBe(true);
    expect(out).toContain(FRAGMENTS_STALE_MARKER);
    expect(out).toContain("NONCE-1");
  });

  it("stale + overflow: ids with +N more instead of bodies, within the hook cap", () => {
    const changed = Array.from({ length: 400 }, (_, i) => ({ id: `fragment-id-number-${i}`, body: "y".repeat(100) }));
    const out = composeSessionStart({ block: "b".repeat(9_300), stale: true, changed });
    expect(out.length).toBeLessThanOrEqual(HOOK_STRING_CAP);
    expect(out).toContain(FRAGMENTS_STALE_MARKER);
    expect(out).toMatch(/\+\d+ more/);
    expect(out).not.toContain("y".repeat(100));
    expect(out).toContain("fragment-id-number-0");
  });

  it("stale with no per-fragment change still emits the notice", () => {
    expect(composeSessionStart({ block: "", stale: true, changed: [] })).toContain(FRAGMENTS_STALE_MARKER);
  });

  it("render session-start end to end: fresh rules files silent, stale rules files carry marker + new body, dynamic block kept", async () => {
    const dyn = { [`${ROOTS.project}/dyn.md`]: fragmentFile("dyn", ["main"], "dynamic", "DYN-BLOCK") };
    const st = (body: string) => ({ [`${ROOTS.project}/st.md`]: fragmentFile("st", ["main"], "static", body) });
    const fresh = await runFragmentsRender(await depsWithRules({ ...dyn, ...st("Changed NONCE-9") }), { outlet: "hook:session-start" });
    expect(fresh.ok && fresh.value.additionalContext.trim()).toBe("DYN-BLOCK");

    const stale = await runFragmentsRender(await depsWithRules({ ...dyn, ...st("Original") }, { ...dyn, ...st("Changed NONCE-9") }), { outlet: "hook:session-start" });
    expect(stale.ok).toBe(true);
    if (!stale.ok) return;
    expect(stale.value.additionalContext).toContain("DYN-BLOCK");
    expect(stale.value.additionalContext).toContain(FRAGMENTS_STALE_MARKER);
    expect(stale.value.additionalContext).toContain("NONCE-9");
  });

  it("render subagent-start selects subagent:<type> and rejects over-cap with BUDGET_EXCEEDED", async () => {
    const ok = await runFragmentsRender(
      makeDeps({
        [`${ROOTS.shipped}/all.md`]: fragmentFile("all", ["subagent:*"], "dynamic", "ALL"),
        [`${ROOTS.shipped}/t.md`]: fragmentFile("t", ["subagent:tester"], "dynamic", "ONLY-TESTER"),
      }),
      { outlet: "hook:subagent-start", agentType: "tester" },
    );
    // discoverFragments keeps each body's raw newlines; pin the content and order, not the whitespace.
    expect(ok.ok && ok.value.additionalContext.split(/\s+/).filter(Boolean)).toEqual(["ALL", "ONLY-TESTER"]);

    const over = await runFragmentsRender(
      makeDeps({ [`${ROOTS.project}/big.md`]: fragmentFile("big-one", ["subagent:*"], "dynamic", "x".repeat(9_401)) }),
      { outlet: "hook:subagent-start" },
    );
    expect(over.ok).toBe(false);
    if (over.ok) return;
    expect(over.error.code).toBe("BUDGET_EXCEEDED");
    expect(over.error.message).toContain("big-one");
  });

  it("render surfaces discovery errors as VALIDATION_ERROR", async () => {
    const r = await runFragmentsRender(makeDeps({ [`${ROOTS.project}/bad.md`]: "no frontmatter" }), { outlet: "hook:session-start" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("D12 buildHookBanner", () => {
  it("is at most NOTICE_RESERVE chars and keeps the error code first", () => {
    const banner = buildHookBanner({ code: "BUDGET_EXCEEDED", message: "z".repeat(2_000) });
    expect(banner.length).toBeLessThanOrEqual(NOTICE_RESERVE);
    expect(banner).toContain("BUDGET_EXCEEDED");
  });

  it("short message passes through untruncated", () => {
    expect(buildHookBanner({ code: "VALIDATION_ERROR", message: "bad" })).toBe("lore fragments VALIDATION_ERROR: bad");
  });
});
