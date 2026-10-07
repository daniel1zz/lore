/**
 * Unit oracles for flows/project-pointers-flow.ts (`lore fragments pointers`).
 * Spec: spec-context-fragments-config-driven-layered-rule-injection D6 (POINTER_CEILING 600).
 * Behaviour reproduced from assets/hooks/subagent-context.mjs buildProjectContext.
 * Task: task-skill-implement-lore-fragments-render-check-cli-fragments.
 */
import { describe, expect, it } from "vitest";
import { POINTER_CEILING } from "@lore/core";
import { buildProjectPointers, truncateAtLineBoundary } from "../../../src/flows/project-pointers-flow.js";

const bootstrap = (data: unknown) => JSON.stringify({ ok: true, data });
const deps = (stdout: string, status: number | null = 0, hasCorpus = true) => ({
  hasCorpus: () => hasCorpus,
  runBootstrap: async () => ({ status, stdout }),
});

describe("buildProjectPointers", () => {
  it("renders root, first plan with counts, pending reviews, and the deep-dive line", async () => {
    const r = await buildProjectPointers(
      deps(
        bootstrap({
          root: { title: "Lore", slug: "prd-lore" },
          active_plans: [{ title: "Plan A", slug: "plan-a", task_counts: { ready: 5, claimed: 1, done: 9 } }, { title: "Plan B" }],
          pending_reviews: { count: 170 },
        }),
      ),
    );
    expect(r.text).toBe(
      "## Project Context (lore)\nCorpus root: Lore (prd-lore)\nPlan: Plan A (ready 5 / claimed 1 / done 9)\nPending reviews: 170\n" +
        "Deep-dive: `lore get <slug>` / `lore tree <plan>` / `lore ready <plan> --json`",
    );
  });

  it("zero pending reviews and no plans omit those lines", async () => {
    const r = await buildProjectPointers(deps(bootstrap({ root: { title: "T", slug: "s" }, pending_reviews: { count: 0 } })));
    expect(r.text).not.toContain("Pending reviews");
    expect(r.text).not.toContain("Plan:");
  });

  it("a fresh corpus (real bootstrap shape: root null, no plans) is nothing-to-report, not unparseable", async () => {
    const r = await buildProjectPointers(deps(bootstrap({ root: null, active_plans: [], pending_reviews: { count: 0, slugs: [] } })));
    expect(r).toEqual({ text: "", skipped: "nothing-to-report" });
  });

  it("no .lore corpus -> empty, skipped no-corpus, bootstrap never run", async () => {
    let ran = false;
    const r = await buildProjectPointers({
      hasCorpus: () => false,
      runBootstrap: async () => {
        ran = true;
        return { status: 0, stdout: "" };
      },
    });
    expect(r).toEqual({ text: "", skipped: "no-corpus" });
    expect(ran).toBe(false);
  });

  it("failed, empty, garbled, ok:false and empty-data bootstrap each report a distinct skipped reason", async () => {
    expect((await buildProjectPointers(deps("", 1))).skipped).toBe("bootstrap-failed");
    expect((await buildProjectPointers(deps("", 0))).skipped).toBe("bootstrap-failed");
    expect((await buildProjectPointers(deps("not json"))).skipped).toBe("bootstrap-unparseable");
    expect((await buildProjectPointers(deps(JSON.stringify({ ok: false, data: {} })))).skipped).toBe("bootstrap-unparseable");
    expect((await buildProjectPointers(deps(bootstrap({})))).skipped).toBe("nothing-to-report");
  });

  it("output is at most POINTER_CEILING and cut at a line boundary", async () => {
    const r = await buildProjectPointers(deps(bootstrap({ root: { title: "R".repeat(560), slug: "s" }, pending_reviews: { count: 3 } })));
    expect(r.text.length).toBeLessThanOrEqual(POINTER_CEILING);
    // whole lines only: the oversized trailing lines are dropped, never cut mid-line
    expect(r.text.split("\n").every((line) => line.startsWith("## ") || line.startsWith("Corpus root:"))).toBe(true);
    expect(r.text).not.toContain("Deep-dive");
  });
});

describe("truncateAtLineBoundary", () => {
  it("exactly-at-ceiling is untouched, one over drops the last line", () => {
    expect(truncateAtLineBoundary("aa\nbb", 5)).toBe("aa\nbb");
    expect(truncateAtLineBoundary("aa\nbb", 4)).toBe("aa");
  });

  it("a first line longer than the ceiling is hard-cut, never emptied", () => {
    expect(truncateAtLineBoundary("abcdef\nx", 3)).toBe("abc");
  });
});
