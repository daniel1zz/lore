/**
 * pickBaselineRoot: the baseline root is a BUSINESS-tree root; an architecture root never wins (#122, BR-981).
 * Source: spec-baseline-slice-3a-architecture-tree-baseline-root (Navigation).
 */
import { describe, expect, it } from "vitest";
import type { DocRecord } from "@lore/core";
import { pickBaselineRoot } from "../../../src/service/navigation-roots.js";

function baseline(slug: string, createdAt: string, extra: Record<string, unknown>, deletedAt: string | null = null): DocRecord {
  return { slug, type: "baseline", created_at: createdAt, deleted_at: deletedAt, extra } as unknown as DocRecord;
}

describe("pickBaselineRoot (architecture roots are not the baseline root)", () => {
  it("an older architecture root loses to a newer business root", () => {
    const arch = baseline("arch-root", "2026-01-01T00:00:00Z", { node: "root", tree: "architecture" });
    const biz = baseline("biz-root", "2026-02-01T00:00:00Z", { node: "root", tree: "business" });
    expect(pickBaselineRoot([arch, biz])?.slug).toBe("biz-root");
  });

  it("a business root with no `tree` key still counts as business", () => {
    const arch = baseline("arch-root", "2026-01-01T00:00:00Z", { node: "root", tree: "architecture" });
    const biz = baseline("biz-root", "2026-02-01T00:00:00Z", { node: "root" });
    expect(pickBaselineRoot([arch, biz])?.slug).toBe("biz-root");
  });

  it("only an architecture root yields undefined", () => {
    const arch = baseline("arch-root", "2026-01-01T00:00:00Z", { node: "root", tree: "architecture" });
    expect(pickBaselineRoot([arch])).toBeUndefined();
  });

  it("a soft-deleted business root is skipped for the next business root", () => {
    const dead = baseline("biz-dead", "2026-01-01T00:00:00Z", { node: "root" }, "2026-03-01T00:00:00Z");
    const next = baseline("biz-next", "2026-02-01T00:00:00Z", { node: "root", tree: "business" });
    expect(pickBaselineRoot([dead, next])?.slug).toBe("biz-next");
  });
});
