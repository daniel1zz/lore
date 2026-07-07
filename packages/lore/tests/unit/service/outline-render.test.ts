/**
 * Tests for OutlineService.renderResolvedToMarkdown — text-projection splice.
 *
 * Test design techniques:
 *   EP: one rendering path per whitelisted component (ChildrenOf, RecentDecisions,
 *       ActivePlans, ModuleTree, RelatedOf, Embed, HealthStats)
 *   BVA: zero resolvedComponents (no-op passthrough), empty list data per component
 *   Regression: multiple placeholders in one doc — descending-position splice must
 *     not corrupt an earlier placeholder's recorded offset
 *   Error/Negative: malformed/degraded resolver data (Embed notFound/error, null
 *     ModuleTree root, unreachable/unknown component name) never throws — always
 *     degrades to a labeled markdown line
 *   State: N/A — pure function, no store, no IO
 *
 * Source: SPEC-032 §3.3 AC-3
 */

import { describe, expect, it } from "vitest";
import { renderResolvedToMarkdown } from "../../../src/service/outline-service.js";
import type { ResolvedComponent, ResolvedDoc } from "../../../src/service/outline-service.js";
import type { DocSummary } from "@lore/core";

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeDocSummary(overrides: Partial<DocSummary> & { id: string; title: string }): DocSummary {
  return {
    id: overrides.id,
    slug: overrides.slug ?? `${overrides.id}-slug`,
    type: overrides.type ?? "spec",
    title: overrides.title,
    status: overrides.status ?? "draft",
    updated_at: overrides.updated_at ?? "2026-06-08T00:00:00.000Z",
    tags: overrides.tags ?? [],
    priority: overrides.priority ?? "medium",
  };
}

function makeResolvedDoc(content: string, resolvedComponents: ResolvedComponent[]): ResolvedDoc {
  return { content, resolvedComponents, warnings: [] };
}

/** Build a ResolvedComponent spanning the tag's exact position within `content`. */
function componentAt(
  content: string,
  tag: string,
  name: string,
  data: unknown,
  props: Record<string, unknown> = {},
): ResolvedComponent {
  const start = content.indexOf(tag);
  if (start === -1) throw new Error(`fixture error: tag "${tag}" not found in content`);
  return { name, props, data, position: { start, end: start + tag.length } };
}

// ─── Boundary: no components ─────────────────────────────────────────────────

describe("renderResolvedToMarkdown — boundary", () => {
  it("returns content unchanged when resolvedComponents is empty", () => {
    const resolved = makeResolvedDoc("# Plain doc\n\nNo placeholders here.", []);
    expect(renderResolvedToMarkdown(resolved)).toBe(resolved.content);
  });
});

// ─── ChildrenOf / RecentDecisions / ActivePlans (shared bullet-list rendering) ──

describe("renderResolvedToMarkdown — ChildrenOf", () => {
  it("splices a bulleted child list in place of the tag", () => {
    const content = "# PRD\n\n<ChildrenOf />\n\nEnd.";
    const children = [
      makeDocSummary({ id: "s1", title: "Spec One", type: "spec", status: "draft" }),
      makeDocSummary({ id: "s2", title: "Spec Two", type: "spec", status: "approved" }),
    ];
    const resolved = makeResolvedDoc(content, [
      componentAt(content, "<ChildrenOf />", "ChildrenOf", { children }),
    ]);

    expect(renderResolvedToMarkdown(resolved)).toBe(
      "# PRD\n\n- [spec] Spec One (draft)\n- [spec] Spec Two (approved)\n\nEnd.",
    );
  });

  it("empty children list renders a labeled empty state, not a crash", () => {
    const content = "<ChildrenOf />";
    const resolved = makeResolvedDoc(content, [
      componentAt(content, "<ChildrenOf />", "ChildrenOf", { children: [] }),
    ]);

    expect(renderResolvedToMarkdown(resolved)).toBe("_(no children)_");
  });

  it("malformed data (missing children key) degrades to empty state, never throws", () => {
    const content = "<ChildrenOf />";
    const resolved = makeResolvedDoc(content, [
      componentAt(content, "<ChildrenOf />", "ChildrenOf", {}),
    ]);

    expect(() => renderResolvedToMarkdown(resolved)).not.toThrow();
    expect(renderResolvedToMarkdown(resolved)).toBe("_(no children)_");
  });
});

describe("renderResolvedToMarkdown — RecentDecisions", () => {
  it("renders a decisions bullet list", () => {
    const content = "<RecentDecisions />";
    const decisions = [makeDocSummary({ id: "a1", title: "Use SQLite", type: "adr", status: "approved" })];
    const resolved = makeResolvedDoc(content, [
      componentAt(content, "<RecentDecisions />", "RecentDecisions", { decisions }),
    ]);

    expect(renderResolvedToMarkdown(resolved)).toBe("- [adr] Use SQLite (approved)");
  });
});

describe("renderResolvedToMarkdown — ActivePlans", () => {
  it("renders an active-plans bullet list", () => {
    const content = "<ActivePlans />";
    const plans = [makeDocSummary({ id: "p1", title: "Phase 1", type: "plan", status: "active" })];
    const resolved = makeResolvedDoc(content, [
      componentAt(content, "<ActivePlans />", "ActivePlans", { plans }),
    ]);

    expect(renderResolvedToMarkdown(resolved)).toBe("- [plan] Phase 1 (active)");
  });
});

// ─── RelatedOf ────────────────────────────────────────────────────────────────

describe("renderResolvedToMarkdown — RelatedOf", () => {
  it("renders related docs with the link_type suffix", () => {
    const content = "<RelatedOf />";
    const related = [{ ...makeDocSummary({ id: "r1", title: "Related Spec", type: "spec", status: "approved" }), link_type: "informs" }];
    const resolved = makeResolvedDoc(content, [
      componentAt(content, "<RelatedOf />", "RelatedOf", { related }),
    ]);

    expect(renderResolvedToMarkdown(resolved)).toBe("- [spec] Related Spec (approved) — informs");
  });

  it("empty related list renders a labeled empty state", () => {
    const content = "<RelatedOf />";
    const resolved = makeResolvedDoc(content, [
      componentAt(content, "<RelatedOf />", "RelatedOf", { related: [] }),
    ]);

    expect(renderResolvedToMarkdown(resolved)).toBe("_(no related docs)_");
  });
});

// ─── ModuleTree ───────────────────────────────────────────────────────────────

describe("renderResolvedToMarkdown — ModuleTree", () => {
  it("renders a nested tree with two-space indentation per depth", () => {
    const content = "<ModuleTree />";
    const modules = {
      doc: makeDocSummary({ id: "root", title: "Root", type: "prd", status: "approved" }),
      children: [
        {
          doc: makeDocSummary({ id: "child", title: "Child Spec", type: "spec", status: "draft" }),
          children: [
            {
              doc: makeDocSummary({ id: "grandchild", title: "Grandchild Task", type: "task", status: "draft" }),
              children: [],
            },
          ],
        },
      ],
    };
    const resolved = makeResolvedDoc(content, [
      componentAt(content, "<ModuleTree />", "ModuleTree", { modules }),
    ]);

    expect(renderResolvedToMarkdown(resolved)).toBe(
      "- [prd] Root (approved)\n  - [spec] Child Spec (draft)\n    - [task] Grandchild Task (draft)",
    );
  });

  it("null root renders a labeled not-found state, not a crash", () => {
    const content = '<ModuleTree root="missing" />';
    const resolved = makeResolvedDoc(content, [
      componentAt(content, '<ModuleTree root="missing" />', "ModuleTree", { modules: null }, { root: "missing" }),
    ]);

    expect(renderResolvedToMarkdown(resolved)).toBe("_(module tree root not found)_");
  });
});

// ─── Embed ────────────────────────────────────────────────────────────────────

describe("renderResolvedToMarkdown — Embed", () => {
  it("renders the embedded doc's title + content", () => {
    const content = '<Embed id="doc-1" />';
    const resolved = makeResolvedDoc(content, [
      componentAt(
        content,
        '<Embed id="doc-1" />',
        "Embed",
        { embedded: { id: "doc-1", title: "Embedded Doc", content: "Body text." } },
        { id: "doc-1" },
      ),
    ]);

    expect(renderResolvedToMarkdown(resolved)).toBe("**Embedded Doc**\n\nBody text.");
  });

  it("notFound degrades to a labeled line, not a crash", () => {
    const content = '<Embed id="missing" />';
    const resolved = makeResolvedDoc(content, [
      componentAt(
        content,
        '<Embed id="missing" />',
        "Embed",
        { embedded: null, notFound: "missing" },
        { id: "missing" },
      ),
    ]);

    expect(renderResolvedToMarkdown(resolved)).toBe("_(embed not found: missing)_");
  });

  it("missing-id error data degrades to a labeled line", () => {
    const content = "<Embed />";
    const resolved = makeResolvedDoc(content, [
      componentAt(content, "<Embed />", "Embed", { embedded: null, error: "Embed requires an id prop" }),
    ]);

    expect(renderResolvedToMarkdown(resolved)).toBe("_(embed error: Embed requires an id prop)_");
  });
});

// ─── HealthStats ──────────────────────────────────────────────────────────────

describe("renderResolvedToMarkdown — HealthStats", () => {
  it("renders a markdown summary list from stats data", () => {
    const content = "<HealthStats />";
    const stats = {
      total: 10,
      by_type: { spec: 6, adr: 4 },
      by_status: { draft: 3, approved: 7 },
      stale: 2,
      orphans: 1,
    };
    const resolved = makeResolvedDoc(content, [
      componentAt(content, "<HealthStats />", "HealthStats", { stats }),
    ]);

    expect(renderResolvedToMarkdown(resolved)).toBe(
      [
        "- Total: 10",
        "- By type: spec: 6, adr: 4",
        "- By status: draft: 3, approved: 7",
        "- Stale (>30d): 2",
        "- Orphans: 1",
      ].join("\n"),
    );
  });
});

// ─── Regression: multiple placeholders, descending-position splice stability ───

describe("renderResolvedToMarkdown — multiple placeholders (regression)", () => {
  it("splices two placeholders in one doc without shifting the earlier one's offset", () => {
    // ChildrenOf's rendering is much longer than its own tag; splicing it (later in the
    // string) must not corrupt RecentDecisions's already-recorded position (earlier in
    // the string) — this is exactly what the DESCENDING position walk guarantees.
    const content = "Decisions: <RecentDecisions /> | Children: <ChildrenOf /> | End.";
    const decisions = [makeDocSummary({ id: "a1", title: "Decision One", type: "adr", status: "approved" })];
    const children = [
      makeDocSummary({ id: "s1", title: "Spec A", type: "spec", status: "draft" }),
      makeDocSummary({ id: "s2", title: "Spec B", type: "spec", status: "approved" }),
      makeDocSummary({ id: "s3", title: "Spec C", type: "spec", status: "in-review" }),
    ];

    const resolved = makeResolvedDoc(content, [
      componentAt(content, "<RecentDecisions />", "RecentDecisions", { decisions }),
      componentAt(content, "<ChildrenOf />", "ChildrenOf", { children }),
    ]);

    expect(renderResolvedToMarkdown(resolved)).toBe(
      "Decisions: - [adr] Decision One (approved) | Children: " +
        "- [spec] Spec A (draft)\n- [spec] Spec B (approved)\n- [spec] Spec C (in-review) | End.",
    );
  });

  it("order of resolvedComponents in the input array does not matter — result is identical either way", () => {
    const content = "A <HealthStats /> B <ActivePlans /> C";
    const stats = { total: 1, by_type: {}, by_status: {}, stale: 0, orphans: 0 };
    const plans = [makeDocSummary({ id: "p1", title: "Plan One", type: "plan", status: "active" })];

    const healthComponent = componentAt(content, "<HealthStats />", "HealthStats", { stats });
    const plansComponent = componentAt(content, "<ActivePlans />", "ActivePlans", { plans });

    const forward = makeResolvedDoc(content, [healthComponent, plansComponent]);
    const backward = makeResolvedDoc(content, [plansComponent, healthComponent]);

    expect(renderResolvedToMarkdown(forward)).toBe(renderResolvedToMarkdown(backward));
  });
});

// ─── Negative: unreachable component name ────────────────────────────────────

describe("renderResolvedToMarkdown — unreachable component name (defensive)", () => {
  it("an unrecognized component name degrades to a labeled string rather than throwing", () => {
    // resolve() never actually produces this (WHITELISTED_COMPONENTS gates entry into
    // resolvedComponents) — this exercises renderResolvedToMarkdown's own defensive
    // default branch directly, since the function's contract doesn't re-validate its input.
    const content = "<Bogus />";
    const resolved: ResolvedDoc = {
      content,
      resolvedComponents: [
        { name: "Bogus", props: {}, data: {}, position: { start: 0, end: content.length } },
      ],
      warnings: [],
    };

    expect(() => renderResolvedToMarkdown(resolved)).not.toThrow();
    expect(renderResolvedToMarkdown(resolved)).toBe("_(unknown component: Bogus)_");
  });
});
