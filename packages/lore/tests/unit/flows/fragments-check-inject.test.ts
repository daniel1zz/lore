/**
 * @spec_ref AC-IT-8
 * Spec: spec-fragment-injection-timing-one-inject-enum-a-per-turn (Other consumers re-keyed, hook:user-prompt outlet)
 *
 * Drives the REAL `runFragmentsCheck` (not a hand-built reading group): the per-turn block is part of the
 * main-session duplicate-line group, is capped at USER_PROMPT_FRAGMENT_CAP, and a shipped fragment may not name it.
 *
 * Six-dimension coverage: HAPPY (clean control), NEGATIVE (each finding case), BOUNDARY (cap 1000 ok / 1001 finding),
 * REGRESSION (per-turn vs helper-only fragments are different reading groups).
 */
import { describe, expect, it } from "vitest";
import { InMemoryFsPort } from "@lore/core";
import { runFragmentsCheck, type FragmentsFlowDeps } from "../../../src/flows/fragments-flow.js";

const ROOTS = { shipped: "/a/context", user: "/u/context", project: "/p/.lore/context" };

function file(id: string, inject: string[], body: string, agents?: string[]): string {
  const agentsLine = agents === undefined ? "" : `agents: [${agents.join(", ")}]\n`;
  return `---\nid: ${id}\ntitle: t ${id}\ninject: [${inject.join(", ")}]\n${agentsLine}---\n${body}\n`;
}

function deps(files: Record<string, string>): FragmentsFlowDeps {
  return {
    fs: new InMemoryFsPort({ "/a/agents/lore-a.md": "x", ...files }),
    roots: ROOTS,
    globalConfig: {},
    projectConfig: {},
    projectClaudeMdPath: "/p/CLAUDE.md",
    agentsDir: "/a/agents",
    userAgentsDir: "/u/.claude/agents",
    projectAgentsDir: "/p/.claude/agents",
    userRulesDir: "/u/.claude/rules",
    userSettings: { scope: "user", path: "/h/.claude/settings.json" },
    projectSettings: { scope: "project", path: "/p/.claude/settings.local.json" },
    shippedSkillNames: [],
  };
}

const kinds = (r: Awaited<ReturnType<typeof runFragmentsCheck>>) => r.findings.map((f) => f.kind);

describe("AC-IT-8 runFragmentsCheck with the per-turn outlet", () => {
  it("AC-IT-8 the same line in a launch and a user-prompt fragment is a duplicate_line finding (main-session group)", async () => {
    const r = await runFragmentsCheck(
      deps({
        [`${ROOTS.project}/l.md`]: file("l", ["launch"], "Shared rule line."),
        [`${ROOTS.project}/t.md`]: file("t", ["user-prompt"], "Shared rule line."),
      }),
    );
    expect(r.ok).toBe(false);
    const finding = r.findings.find((f) => f.kind === "duplicate_line");
    expect(finding?.message).toContain("Shared rule line.");
    expect(finding?.message).toContain("main");
  });

  it("AC-IT-8 the same line in a user-prompt fragment and a subagent-start-only fragment is no finding (different reading groups)", async () => {
    const r = await runFragmentsCheck(
      deps({
        [`${ROOTS.project}/t.md`]: file("t", ["user-prompt"], "Shared rule line."),
        [`${ROOTS.project}/h.md`]: file("h", ["subagent-start"], "Shared rule line."),
      }),
    );
    expect(kinds(r)).not.toContain("duplicate_line");
    expect(r.findings).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("AC-IT-8 a user-layer per-turn block of 1,001 chars is a cap finding for hook:user-prompt; 1,000 is clean", async () => {
    // reason: `file` ends the body with "\n" and discovery keeps it, so N x's make an (N + 1)-char body.
    const over = await runFragmentsCheck(deps({ [`${ROOTS.user}/t.md`]: file("t", ["user-prompt"], "x".repeat(1_000)) }));
    expect(over.ok).toBe(false);
    const cap = over.findings.find((f) => f.kind === "cap");
    expect(cap?.code).toBe("BUDGET_EXCEEDED");
    expect(cap?.message).toContain("hook:user-prompt");

    const edge = await runFragmentsCheck(deps({ [`${ROOTS.user}/t.md`]: file("t", ["user-prompt"], "x".repeat(999)) }));
    expect(kinds(edge)).not.toContain("cap");
  });

  it("AC-IT-8 a shipped-layer fragment naming user-prompt is a shipped_user_prompt finding and the result is not ok", async () => {
    const r = await runFragmentsCheck(deps({ [`${ROOTS.shipped}/s.md`]: file("s", ["user-prompt"], "per turn") }));
    expect(r.ok).toBe(false);
    expect(r.findings.find((f) => f.kind === "shipped_user_prompt")?.message).toContain('"s"');
  });

  it("AC-IT-8 the check reports a hook:user-prompt row", async () => {
    const r = await runFragmentsCheck(deps({ [`${ROOTS.project}/t.md`]: file("t", ["user-prompt"], "per turn") }));
    const row = r.checks.find((c) => c.outlet === "hook:user-prompt");
    expect(row?.fragmentIds).toEqual(["t"]);
  });

  it("AC-IT-8 agent types come from the agents filter and the any-helper row is still reported as subagent:*", async () => {
    const r = await runFragmentsCheck(deps({ [`${ROOTS.project}/h.md`]: file("h", ["subagent-start"], "helper", ["ghost-type"]) }));
    expect(r.agentTypes).toContain("ghost-type");
    expect(r.agentTypes).toContain("subagent:*");
  });
});
