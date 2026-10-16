/**
 * AC-R0-4 — ac_scope governing-spec resolution ignores deprecated and invalidated specs
 * (report #237). Two LIVE candidates must stay ambiguous (core rule: never guess).
 */
import { describe, it, expect } from "vitest";
import { resolveGoverningSpecByAcScope } from "../../src/acceptance.js";
import type { DocRecord } from "../../src/types.js";

function spec(slug: string, status: string, extra: Record<string, unknown> = {}): DocRecord {
  return {
    id: slug.toUpperCase(),
    slug,
    type: "spec",
    role: "spec",
    title: slug,
    status,
    priority: "medium",
    content: "",
    parent_id: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    created_by: "t",
    version: 1,
    deleted_at: null,
    tags: [],
    extra: {
      acceptance_criteria: [
        { id: "AC-X-1", statement: "s", verify: { mode: "human" } },
      ],
      ...extra,
    },
  } as unknown as DocRecord;
}

const NOW = "2026-06-01T00:00:00.000Z";

describe("AC-R0-4 resolveGoverningSpecByAcScope ignores non-live specs", () => {
  it("AC-R0-4 deprecated + approved declaring the same id resolves to the approved one", () => {
    const r = resolveGoverningSpecByAcScope(
      ["AC-X-1"],
      [spec("old", "deprecated"), spec("new", "approved")],
      "t",
      NOW,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.spec.slug).toBe("new");
  });

  it("AC-R0-4 an invalidated spec is ignored like a deprecated one", () => {
    const r = resolveGoverningSpecByAcScope(
      ["AC-X-1"],
      [
        spec("inv", "approved", { validity: { invalid_at: "2026-02-01T00:00:00.000Z" } }),
        spec("new", "approved"),
      ],
      "t",
      NOW,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.spec.slug).toBe("new");
  });

  it("AC-R0-4 two live candidates stay ambiguous", () => {
    const r = resolveGoverningSpecByAcScope(
      ["AC-X-1"],
      [spec("a", "approved"), spec("b", "draft"), spec("c", "deprecated")],
      "t",
      NOW,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toMatch(/ambiguous/);
  });

  it("AC-R0-4 only-deprecated is unresolved", () => {
    const r = resolveGoverningSpecByAcScope(["AC-X-1"], [spec("old", "deprecated")], "t", NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toMatch(/matches no/);
  });

  it("AC-R0-4 an invalid_at in the future at the given now does NOT exclude the spec", () => {
    const future = spec("future", "approved", { validity: { invalid_at: "2026-12-01T00:00:00.000Z" } });
    const r = resolveGoverningSpecByAcScope(["AC-X-1"], [future], "t", NOW);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.spec.slug).toBe("future");
    // the same spec IS excluded once `now` passes its invalid_at
    const later = resolveGoverningSpecByAcScope(["AC-X-1"], [future], "t", "2027-01-01T00:00:00.000Z");
    expect(later.ok).toBe(false);
  });
});
