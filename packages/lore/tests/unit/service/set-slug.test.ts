/**
 * Unit tests for `CorpusService.set`'s `--slug` repair path (SPEC-066 D5) —
 * AC-066-7, AC-066-8.
 *
 * Uses InMemoryStore — no file I/O, no SQLite dependency, so this runs under
 * vitest (mirrors corpus-service.test.ts's existing convention).
 */

import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import type { CreateDocInput } from "@lore/core";

function makeService() {
  const store = new InMemoryStore();
  return { service: new CorpusService(store), store };
}

function prdInput(title = "My Product"): CreateDocInput {
  return { type: "prd", title };
}

describe("CorpusService.set --slug (SPEC-066 D5)", () => {
  it("AC-066-7: renaming resolves under the new slug", async () => {
    const { service } = makeService();
    const created = await service.create(prdInput("Degenerate CJK Doc"));
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const renamed = await service.set(created.value.slug, { slug: "prd-repaired-name" });
    expect(renamed.ok).toBe(true);
    if (!renamed.ok) return;
    expect(renamed.value.slug).toBe("prd-repaired-name");

    const resolvedNew = await service.get("prd-repaired-name");
    expect(resolvedNew.ok).toBe(true);
    if (!resolvedNew.ok) return;
    expect(resolvedNew.value.doc.id).toBe(created.value.id);
  });

  it("AC-066-7: the old slug returns DOC_NOT_FOUND after a rename", async () => {
    const { service } = makeService();
    const created = await service.create(prdInput("Old Slug Doc"));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const oldSlug = created.value.slug;

    const renamed = await service.set(oldSlug, { slug: "prd-brand-new-slug" });
    expect(renamed.ok).toBe(true);

    const oldLookup = await service.get(oldSlug);
    expect(oldLookup.ok).toBe(false);
    if (oldLookup.ok) return;
    expect(oldLookup.error.code).toBe("DOC_NOT_FOUND");
  });

  it("AC-066-7: the version log gains an entry on a slug rename", async () => {
    const { service, store } = makeService();
    const created = await service.create(prdInput("Versioned Doc"));
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const beforeVersions = await store.findVersions(created.value.id);
    expect(beforeVersions.ok).toBe(true);
    if (!beforeVersions.ok) return;
    const countBefore = beforeVersions.value.length;

    const renamed = await service.set(created.value.slug, { slug: "prd-new-versioned-slug" });
    expect(renamed.ok).toBe(true);
    if (!renamed.ok) return;
    expect(renamed.value.version).toBe(created.value.version + 1);

    const afterVersions = await store.findVersions(created.value.id);
    expect(afterVersions.ok).toBe(true);
    if (!afterVersions.ok) return;
    expect(afterVersions.value.length).toBe(countBefore + 1);
  });

  it("AC-066-7: links (ULID-keyed) survive a slug rename", async () => {
    const { service, store } = makeService();
    const parent = await service.create(prdInput("Parent Doc"));
    expect(parent.ok).toBe(true);
    if (!parent.ok) return;

    const other = await service.create(prdInput("Other Doc"));
    expect(other.ok).toBe(true);
    if (!other.ok) return;

    const linkResult = await store.addLink({
      from_id: other.value.id,
      to_id: parent.value.id,
      link_type: "relates-to",
      created_at: new Date().toISOString(),
      created_by: "test",
    });
    expect(linkResult.ok).toBe(true);

    const renamed = await service.set(parent.value.slug, { slug: "prd-parent-renamed" });
    expect(renamed.ok).toBe(true);
    if (!renamed.ok) return;

    // The link table keys on the immutable ULID (`to_id`), never the slug —
    // it must still resolve, pointing at the SAME id, after the rename.
    const linksAfter = await store.findLinks(parent.value.id, "in");
    expect(linksAfter.ok).toBe(true);
    if (!linksAfter.ok) return;
    expect(linksAfter.value).toHaveLength(1);
    expect(linksAfter.value[0]!.from_id).toBe(other.value.id);
    expect(linksAfter.value[0]!.to_id).toBe(parent.value.id);
  });

  it("AC-066-7: an approved doc does NOT reset to draft when only slug changes", async () => {
    const { service } = makeService();
    const created = await service.create(prdInput("Approved Doc"));
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const approved = await service.set(created.value.slug, { status: "approved" });
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;
    expect(approved.value.status).toBe("approved");

    const renamed = await service.set(approved.value.slug, { slug: "prd-approved-renamed" });
    expect(renamed.ok).toBe(true);
    if (!renamed.ok) return;
    // Slug is an address, not content — unlike title/content edits, a slug-only
    // patch must NOT trigger the approved→draft auto-reset invariant.
    expect(renamed.value.status).toBe("approved");
  });

  it("AC-066-8: rejects with VALIDATION_ERROR when the slug is taken by another doc, naming the holder", async () => {
    const { service } = makeService();
    const holder = await service.create(prdInput("Holder Doc"));
    expect(holder.ok).toBe(true);
    if (!holder.ok) return;

    const other = await service.create(prdInput("Other Doc"));
    expect(other.ok).toBe(true);
    if (!other.ok) return;

    const result = await service.set(other.value.slug, { slug: holder.value.slug });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    if (result.error.code === "VALIDATION_ERROR") {
      expect(result.error.field).toBe("slug");
      expect(result.error.message).toContain(holder.value.slug);
      expect(result.error.message).toContain(holder.value.id);
    }

    // The rejected doc's own slug is untouched.
    const stillOther = await service.get(other.value.slug);
    expect(stillOther.ok).toBe(true);
  });

  it("AC-066-8: rejects with VALIDATION_ERROR when the candidate slug fails slugSchema", async () => {
    const { service } = makeService();
    const created = await service.create(prdInput("Bad Slug Target"));
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const result = await service.set(created.value.slug, { slug: "Not A Valid Slug!" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  it("AC-066-8: restating the doc's own current slug is a no-op (not a self-conflict)", async () => {
    const { service, store } = makeService();
    const created = await service.create(prdInput("Self Restate Doc"));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const currentSlug = created.value.slug;

    const result = await service.set(currentSlug, { slug: currentSlug });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.slug).toBe(currentSlug);

    // The doc still resolves under the exact same slug — a genuine no-op, not
    // an erroneous "taken by another doc" self-collision.
    const stillResolves = await service.get(currentSlug);
    expect(stillResolves.ok).toBe(true);
    if (!stillResolves.ok) return;
    expect(stillResolves.value.doc.id).toBe(created.value.id);

    // Confirm there is exactly one doc holding this slug (never a phantom
    // duplicate produced by the no-op path).
    const bySlug = await store.findBySlug(currentSlug);
    expect(bySlug.ok).toBe(true);
    if (!bySlug.ok) return;
    expect(bySlug.value?.id).toBe(created.value.id);
  });
});
