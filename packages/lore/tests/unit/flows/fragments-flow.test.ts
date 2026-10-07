/**
 * Unit oracles for flows/fragments-flow.ts (render + check), injected InMemoryFsPort.
 * Spec: spec-context-fragments-config-driven-layered-rule-injection D3, D6, D7, D12 —
 * AC-CF-4 (check half), AC-CF-12 (render half), AC-CF-18 (language drift half).
 * Task: task-skill-implement-lore-fragments-render-check-cli-fragments.
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
import { buildFragmentsSection } from "../../../src/service/context-fragments/section.js";
import { spliceManagedSections } from "../../../src/service/context-projection.js";

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

/** A project CLAUDE.md whose Z1 fragments section was rendered from `bodies`. */
function claudeMdWithZ1(bodies: string[]): string {
  const text = bodies.join("\n\n");
  const section = buildFragmentsSection({ text, chars: text.length, fragmentIds: [] }, "project");
  const spliced = spliceManagedSections("# Narrative\n", [section]);
  if (!spliced.ok) throw new Error("fixture splice failed");
  return spliced.value.content;
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

  it("flags Z1 drift when the project CLAUDE.md fragments section differs from a fresh render, clean when equal", async () => {
    const frag = { [`${ROOTS.project}/m.md`]: fragmentFile("m", ["main"], "static", "Body M") };
    const fresh = await runFragmentsCheck(makeDeps({ ...frag, [CLAUDE_MD]: claudeMdWithZ1(["Body M"]) }));
    expect(fresh.findings).toEqual([]);

    const stale = await runFragmentsCheck(makeDeps({ ...frag, [CLAUDE_MD]: claudeMdWithZ1(["Old body"]) }));
    expect(stale.ok).toBe(false);
    expect(stale.findings.map((f) => f.kind)).toContain("z1_drift");
  });

  it("no CLAUDE.md at all is not drift", async () => {
    const r = await runFragmentsCheck(makeDeps({ [`${ROOTS.project}/m.md`]: fragmentFile("m", ["main"], "static", "Body M") }));
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

  it("render session-start end to end: fresh Z1 silent, stale Z1 carries marker + new body, dynamic block kept", async () => {
    const files = {
      [`${ROOTS.project}/dyn.md`]: fragmentFile("dyn", ["main"], "dynamic", "DYN-BLOCK"),
      [`${ROOTS.project}/st.md`]: fragmentFile("st", ["main"], "static", "Changed NONCE-9"),
    };
    const fresh = await runFragmentsRender(makeDeps({ ...files, [CLAUDE_MD]: claudeMdWithZ1(["Changed NONCE-9"]) }), { outlet: "hook:session-start" });
    expect(fresh.ok && fresh.value.additionalContext.trim()).toBe("DYN-BLOCK");

    const stale = await runFragmentsRender(makeDeps({ ...files, [CLAUDE_MD]: claudeMdWithZ1(["Original"]) }), { outlet: "hook:session-start" });
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
