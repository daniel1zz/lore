/**
 * SPEC-045 §Design Decisions D10 — "## Code anchors" text-projection splice tests.
 * Pure unit tests against `OutlineService.resolve()` / `renderResolvedToMarkdown()`
 * directly — no MCP server, no CLI subprocess, no real filesystem I/O (mirrors
 * `validity-projection.test.ts`'s general shape: a hand-built `DocRecord` via a
 * `makeDoc` fixture helper, a real `InMemoryStore`+`OutlineService` pair, no App
 * needed at all since this seam never touches `App`).
 *
 * A `spec` doc's declared `extra.code_anchors` is projected SYNCHRONOUSLY — zero
 * store calls, zero filesystem probing (that's `lore status --check-drift`'s job,
 * never this read-only projection's, D10). The black-box proof of "zero fs probing"
 * is that resolving/rendering succeeds identically whether the declared anchor path
 * exists on disk or not — there is no probe call site to short-circuit.
 *
 * @spec_ref SPEC-045 §Acceptance Criteria AC-DR-6
 *
 * Six-dimension coverage for this file:
 *   HAPPY:      a spec with 2 declared code_anchors → "## Code anchors" section,
 *               one "- <anchor>" bullet per entry, declaration order preserved
 *   NEGATIVE:   n/a — this is a pure synchronous projection with no external input
 *               to reject; every "bad" shape (empty array, non-spec doc) is a
 *               legitimate no-op case, not a rejection (see BOUNDARY/STATE below)
 *   BOUNDARY:   `extra.code_anchors` absent vs. an explicit empty array `[]` both
 *               take NO rendering branch — byte-identical to pre-SPEC-045 output
 *   ERROR:      n/a — no I/O failure mode exists at this seam (resolve() never
 *               calls the store for this projection, never touches disk); noted
 *               here rather than padded with a vacuous throw-test
 *   STATE:      a declared anchor pointing at a path that does not exist ANYWHERE
 *               on disk still renders correctly (the zero-fs-probing proof)
 *   REGRESSION: a non-spec doc (task) with a hand-crafted `extra.code_anchors`
 *               field never sets `resolved.codeAnchors` (the type-gate); Code
 *               anchors splices AFTER the pre-existing AC checklist splice, never
 *               reordering it
 */

import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { OutlineService, renderResolvedToMarkdown } from "../../../src/service/outline-service.js";
import { DOC_TYPE_ROLE_MAP } from "@lore/core";
import type { DocRecord, Slug } from "@lore/core";
import { actedStore } from "../../live-invocation.js";

const PAST_ISO = "2026-07-01T00:00:00.000Z";

// ─── Fixtures (mirrors validity-projection.test.ts's makeDoc) ────────────────

function makeDoc(overrides: Partial<DocRecord> & { id: string; type: DocRecord["type"]; title: string; slug: string }): DocRecord {
  return {
    id: overrides.id,
    slug: overrides.slug as Slug,
    type: overrides.type,
    role: DOC_TYPE_ROLE_MAP[overrides.type],
    title: overrides.title,
    status: overrides.status ?? "approved",
    priority: overrides.priority ?? "medium",
    content: overrides.content ?? "# Doc\n\nBody.",
    parent_id: overrides.parent_id ?? null,
    created_at: overrides.created_at ?? PAST_ISO,
    updated_at: overrides.updated_at ?? PAST_ISO,
    created_by: overrides.created_by ?? "test-agent",
    version: overrides.version ?? 1,
    deleted_at: overrides.deleted_at ?? null,
    tags: overrides.tags ?? [],
    extra: overrides.extra ?? {},
  };
}

function makeOutlineService(): OutlineService {
  return new OutlineService(actedStore(new InMemoryStore()));
}

// ─── HAPPY: 2 declared anchors → "## Code anchors" section, declaration order ─

describe("OutlineService.resolve + renderResolvedToMarkdown — HAPPY (declared code_anchors)", () => {
  it("appends a '## Code anchors' section with one '- <anchor>' bullet per entry, in declaration order", async () => {
    const outlineService = makeOutlineService();
    const doc = makeDoc({
      id: "spec-1",
      slug: "spec-happy-anchors",
      type: "spec",
      title: "Spec With Anchors",
      content: "# Spec With Anchors\n\nBody text.",
      extra: { spec_kind: "feature", code_anchors: ["src/a.ts#Foo", "src/b.ts"] },
    });

    const resolvedResult = await outlineService.resolve(doc);
    expect(resolvedResult.ok).toBe(true);
    if (!resolvedResult.ok) return;

    expect(resolvedResult.value.codeAnchors).toEqual(["src/a.ts#Foo", "src/b.ts"]);

    const rendered = renderResolvedToMarkdown(resolvedResult.value);
    expect(rendered).toContain("## Code anchors\n\n- src/a.ts#Foo\n- src/b.ts");
    // Declaration order preserved — "Foo" bullet strictly precedes "b.ts" bullet.
    expect(rendered.indexOf("src/a.ts#Foo")).toBeLessThan(rendered.indexOf("src/b.ts"));
  });

  it("a single-anchor spec renders exactly one bullet — different input, different output (defeats a hardcoded rendering)", async () => {
    const outlineService = makeOutlineService();
    const doc = makeDoc({
      id: "spec-2",
      slug: "spec-single-anchor",
      type: "spec",
      title: "Spec With One Anchor",
      content: "# Spec With One Anchor\n\nBody.",
      extra: { spec_kind: "feature", code_anchors: ["only/one.ts"] },
    });

    const resolvedResult = await outlineService.resolve(doc);
    expect(resolvedResult.ok).toBe(true);
    if (!resolvedResult.ok) return;

    const rendered = renderResolvedToMarkdown(resolvedResult.value);
    expect(rendered).toContain("## Code anchors\n\n- only/one.ts");
    expect(rendered).not.toContain("src/a.ts#Foo");
  });
});

// ─── BOUNDARY: absent vs. empty array — both byte-identical, no rendering branch ─

describe("OutlineService.resolve + renderResolvedToMarkdown — BOUNDARY (absent / empty code_anchors)", () => {
  it("extra.code_anchors absent entirely → resolved.codeAnchors is undefined, output equals doc.content verbatim", async () => {
    const outlineService = makeOutlineService();
    const content = "# Spec Without Anchors\n\nJust body text, no placeholders.";
    const doc = makeDoc({
      id: "spec-3",
      slug: "spec-no-anchors",
      type: "spec",
      title: "Spec Without Anchors",
      content,
      extra: { spec_kind: "feature" },
    });

    const resolvedResult = await outlineService.resolve(doc);
    expect(resolvedResult.ok).toBe(true);
    if (!resolvedResult.ok) return;

    expect(resolvedResult.value.codeAnchors).toBeUndefined();
    const rendered = renderResolvedToMarkdown(resolvedResult.value);
    expect(rendered).toBe(content);
    expect(rendered).not.toContain("## Code anchors");
  });

  it("extra.code_anchors: [] (explicit empty array) → byte-identical to the absent case, REGRESSION", async () => {
    const outlineService = makeOutlineService();
    const content = "# Spec With Empty Anchors\n\nBody.";
    const doc = makeDoc({
      id: "spec-4",
      slug: "spec-empty-anchors",
      type: "spec",
      title: "Spec With Empty Anchors",
      content,
      extra: { spec_kind: "feature", code_anchors: [] },
    });

    const resolvedResult = await outlineService.resolve(doc);
    expect(resolvedResult.ok).toBe(true);
    if (!resolvedResult.ok) return;

    expect(resolvedResult.value.codeAnchors).toBeUndefined();
    const rendered = renderResolvedToMarkdown(resolvedResult.value);
    expect(rendered).toBe(content);
    expect(rendered).not.toContain("## Code anchors");
  });
});

// ─── STATE: zero fs probing — a never-existing path still renders correctly ──

describe("OutlineService.resolve + renderResolvedToMarkdown — STATE (zero fs probing proof)", () => {
  it("a declared anchor whose path does not exist ANYWHERE on disk still resolves + renders identically to a real one", async () => {
    const outlineService = makeOutlineService();
    const doc = makeDoc({
      id: "spec-5",
      slug: "spec-nonexistent-anchor",
      type: "spec",
      title: "Spec Anchoring A Nonexistent Path",
      content: "# Spec\n\nBody.",
      extra: { spec_kind: "feature", code_anchors: ["this/path/definitely/does/not/exist.ts#Foo"] },
    });

    // No fs probe exists at this seam to short-circuit — resolve() completes
    // successfully (no throw, no store call needed for this projection) and the
    // rendering carries the literal declared string verbatim, unverified.
    const resolvedResult = await outlineService.resolve(doc);
    expect(resolvedResult.ok).toBe(true);
    if (!resolvedResult.ok) return;

    expect(resolvedResult.value.codeAnchors).toEqual(["this/path/definitely/does/not/exist.ts#Foo"]);
    const rendered = renderResolvedToMarkdown(resolvedResult.value);
    expect(rendered).toContain("## Code anchors\n\n- this/path/definitely/does/not/exist.ts#Foo");
  });
});

// ─── REGRESSION: non-spec doc type-gate + splice ordering after AC checklist ─

describe("OutlineService.resolve — REGRESSION (type-gate: non-spec docs never project code_anchors)", () => {
  it("a task doc with a hand-crafted extra.code_anchors field never sets resolved.codeAnchors", async () => {
    const outlineService = makeOutlineService();
    const doc = makeDoc({
      id: "task-1",
      slug: "task-with-fake-code-anchors",
      type: "task",
      title: "Task Pretending To Have Code Anchors",
      content: "# Task\n\nBody.",
      // extra.code_anchors is spec-only by CorpusService's write-time grammar
      // validation — this doc could never legally exist, but resolve() must still
      // ignore the field defensively (the type-gate check runs BEFORE inspecting
      // extra at all).
      extra: { plan_id: "plan-1", code_anchors: ["src/should-be-ignored.ts"] },
    });

    const resolvedResult = await outlineService.resolve(doc);
    expect(resolvedResult.ok).toBe(true);
    if (!resolvedResult.ok) return;

    expect(resolvedResult.value.codeAnchors).toBeUndefined();
    const rendered = renderResolvedToMarkdown(resolvedResult.value);
    expect(rendered).not.toContain("## Code anchors");
  });

  it("a prd doc with a hand-crafted extra.code_anchors field never sets resolved.codeAnchors either", async () => {
    const outlineService = makeOutlineService();
    const doc = makeDoc({
      id: "prd-1",
      slug: "prd-with-fake-code-anchors",
      type: "prd",
      title: "PRD Pretending To Have Code Anchors",
      content: "# PRD\n\nBody.",
      extra: { code_anchors: ["src/should-be-ignored.ts"] },
    });

    const resolvedResult = await outlineService.resolve(doc);
    expect(resolvedResult.ok).toBe(true);
    if (!resolvedResult.ok) return;

    expect(resolvedResult.value.codeAnchors).toBeUndefined();
  });

  it("Code anchors splices AFTER the AC checklist splice — order is content, then AC checklist, then Code anchors", async () => {
    const outlineService = makeOutlineService();
    const content = "# Spec With Both Sections\n\nBody.";
    const doc = makeDoc({
      id: "spec-6",
      slug: "spec-ac-and-anchors",
      type: "spec",
      title: "Spec With Both AC And Anchors",
      content,
      extra: {
        spec_kind: "feature",
        acceptance_criteria: [
          {
            id: "AC-ANCHOR-1",
            statement: "Composition ordering holds.",
            verify: { mode: "script", oracle: "test", command: "bun test" },
          },
        ],
        code_anchors: ["src/ordering.ts"],
      },
    });

    const resolvedResult = await outlineService.resolve(doc);
    expect(resolvedResult.ok).toBe(true);
    if (!resolvedResult.ok) return;

    expect(resolvedResult.value.acceptanceCriteria).toBeDefined();
    expect(resolvedResult.value.codeAnchors).toEqual(["src/ordering.ts"]);

    const rendered = renderResolvedToMarkdown(resolvedResult.value);
    const contentIdx = rendered.indexOf(content);
    const acIdx = rendered.indexOf("## Acceptance Criteria (structured)");
    const anchorsIdx = rendered.indexOf("## Code anchors");

    expect(contentIdx).toBe(0);
    expect(acIdx).toBeGreaterThan(contentIdx);
    expect(anchorsIdx).toBeGreaterThan(acIdx);
  });
});
