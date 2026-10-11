/**
 * Adversarial six-dimension sweep for `CorpusService.set`'s `--slug` repair
 * path (SPEC-068 D5), covering gaps NOT exercised by `set-slug.test.ts`
 * (AC-068-7, AC-068-8): freed-slug reuse, exhaustive invalid-shape boundary
 * matrix, version-log semantics across multiple renames (ordering, and
 * whether the slug value itself is captured in the snapshot), the
 * slug+content COMBINED patch on an approved doc (what wins), multi-rename
 * old-slug 404 chains, renaming a nonexistent doc, and whether `set --slug`
 * enforces the target doc's OWN type prefix (spec is silent — documents
 * actual behavior).
 *
 * Uses InMemoryStore — no file I/O, no SQLite dependency — runs under vitest.
 * @spec_ref SPEC-068
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import type { CreateDocInput } from "@lore/core";

function makeService() {
  const store = new InMemoryStore();
  return { service: new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined))), store };
}

function prdInput(title: string): CreateDocInput {
  return { type: "prd", title };
}

describe("CorpusService.set --slug — adversarial sweep (SPEC-068 D5)", () => {
  // ─── HAPPY: freed-slug reuse ──────────────────────────────────────────

  it("a slug freed by rename becomes available for a NEW doc's create-time collision check", async () => {
    const { service } = makeService();
    // Both docs share a title that collides on create — the second one
    // would normally get a `-2` suffix.
    const original = await service.create(prdInput("Shared Title Doc"));
    expect(original.ok).toBe(true);
    if (!original.ok) return;
    const freedSlug = original.value.slug;

    const renamed = await service.set(freedSlug, { slug: "prd-moved-away" });
    expect(renamed.ok).toBe(true);

    // Now a BRAND NEW doc with the SAME title should claim the just-freed
    // base slug directly — not "-2" (proves the slug is truly released, not
    // merely shadowed).
    const newcomer = await service.create(prdInput("Shared Title Doc"));
    expect(newcomer.ok).toBe(true);
    if (!newcomer.ok) return;
    expect(newcomer.value.slug).toBe(freedSlug);
    expect(newcomer.value.id).not.toBe(original.value.id);
  });

  // ─── NEGATIVE: exhaustive invalid-shape boundary matrix ──────────────

  describe("invalid slug shapes are rejected with VALIDATION_ERROR naming the slug field", () => {
    const invalidShapes: Array<{ label: string; candidate: string }> = [
      { label: "uppercase letters", candidate: "PRD-Uppercase-Slug" },
      { label: "too short (2 chars, below the 3-char minimum)", candidate: "ab" },
      { label: "too long (65 chars, one over the 64-char maximum)", candidate: "prd-" + "x".repeat(61) },
      { label: "leading hyphen", candidate: "-prd-leading-hyphen" },
      { label: "trailing hyphen", candidate: "prd-trailing-hyphen-" },
      { label: "contains an underscore", candidate: "prd_with_underscore" },
      { label: "contains a space", candidate: "prd with space" },
      { label: "empty string", candidate: "" },
    ];

    for (const { label, candidate } of invalidShapes) {
      it(`rejects: ${label} ("${candidate}")`, async () => {
        const { service } = makeService();
        const created = await service.create(prdInput("Shape Target Doc"));
        expect(created.ok).toBe(true);
        if (!created.ok) return;

        const result = await service.set(created.value.slug, { slug: candidate });
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.code).toBe("VALIDATION_ERROR");
        if (result.error.code === "VALIDATION_ERROR") {
          expect(result.error.field).toBe("slug");
        }

        // The doc's slug must be untouched by a rejected patch.
        const stillOriginal = await service.get(created.value.slug);
        expect(stillOriginal.ok).toBe(true);
      });
    }
  });

  // ─── BOUNDARY: exact 3-char / 64-char slug shapes ─────────────────────

  describe("boundary-exact valid slug shapes are ACCEPTED (paired against the invalid-shape matrix above)", () => {
    it("a 3-char slug (the schema minimum) is accepted", async () => {
      const { service } = makeService();
      const created = await service.create(prdInput("Min Length Target"));
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const result = await service.set(created.value.slug, { slug: "abc" });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.slug).toBe("abc");
    });

    it("a 64-char slug (the schema maximum) is accepted", async () => {
      const { service } = makeService();
      const created = await service.create(prdInput("Max Length Target"));
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const candidate = "prd-" + "x".repeat(60); // 4 + 60 = 64
      expect(candidate.length).toBe(64);
      const result = await service.set(created.value.slug, { slug: candidate });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.slug).toBe(candidate);
    });
  });

  // ─── NEGATIVE: collision error names the ACTUAL (dynamic) holder ──────

  it("the collision error message names the CURRENT holder dynamically — not a fixed/hardcoded string across different setups", async () => {
    const { service } = makeService();
    const holderOne = await service.create(prdInput("First Holder"));
    const challengerOne = await service.create(prdInput("First Challenger"));
    expect(holderOne.ok && challengerOne.ok).toBe(true);
    if (!holderOne.ok || !challengerOne.ok) return;

    const resultOne = await service.set(challengerOne.value.slug, { slug: holderOne.value.slug });
    expect(resultOne.ok).toBe(false);
    if (resultOne.ok) return;
    expect(resultOne.error.code).toBe("VALIDATION_ERROR");
    if (resultOne.error.code === "VALIDATION_ERROR") {
      expect(resultOne.error.message).toContain(holderOne.value.id);
    }

    // A SECOND, independent collision with a DIFFERENT holder must name
    // THAT holder — proves the message is computed per-call, not memoized
    // or hardcoded from the first collision above.
    const holderTwo = await service.create(prdInput("Second Holder"));
    const challengerTwo = await service.create(prdInput("Second Challenger"));
    expect(holderTwo.ok && challengerTwo.ok).toBe(true);
    if (!holderTwo.ok || !challengerTwo.ok) return;

    const resultTwo = await service.set(challengerTwo.value.slug, { slug: holderTwo.value.slug });
    expect(resultTwo.ok).toBe(false);
    if (resultTwo.ok) return;
    if (resultTwo.error.code === "VALIDATION_ERROR") {
      expect(resultTwo.error.message).toContain(holderTwo.value.id);
      expect(resultTwo.error.message).not.toContain(holderOne.value.id);
    }
  });

  // ─── ERROR: renaming a nonexistent doc ────────────────────────────────

  it("renaming a slug that resolves to no document returns DOC_NOT_FOUND, not a silent success", async () => {
    const { service } = makeService();
    const result = await service.set("prd-does-not-exist-at-all", { slug: "prd-new-name" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("DOC_NOT_FOUND");
  });

  // ─── STATE: version log across MULTIPLE renames ───────────────────────

  describe("version log across multiple sequential renames", () => {
    it("each rename bumps the version by exactly 1, in strict monotonic order", async () => {
      const { service, store } = makeService();
      const created = await service.create(prdInput("Multi Rename Doc"));
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const r1 = await service.set(created.value.slug, { slug: "prd-rename-one" });
      expect(r1.ok).toBe(true);
      if (!r1.ok) return;
      expect(r1.value.version).toBe(created.value.version + 1);

      const r2 = await service.set(r1.value.slug, { slug: "prd-rename-two" });
      expect(r2.ok).toBe(true);
      if (!r2.ok) return;
      expect(r2.value.version).toBe(r1.value.version + 1);

      const r3 = await service.set(r2.value.slug, { slug: "prd-rename-three" });
      expect(r3.ok).toBe(true);
      if (!r3.ok) return;
      expect(r3.value.version).toBe(r2.value.version + 1);

      const versions = await store.findVersions(created.value.id);
      expect(versions.ok).toBe(true);
      if (!versions.ok) return;
      // create (v1) + 3 renames = 4 version rows total.
      expect(versions.value.length).toBe(4);
      const versionNumbers = versions.value.map((v) => v.version).sort((a, b) => a - b);
      expect(versionNumbers).toEqual([1, 2, 3, 4]);
    });

    it("version snapshot rows DO carry a slug field — the slug value at each historical version IS recoverable from `lore log` (SPEC-072, closes this gap)", async () => {
      // SPEC-068 D5 said "Slug change is recorded in the version log like
      // title changes" — but until SPEC-072, `VersionRecord` (@lore/core
      // types.ts) had no `slug` field at all, so a rename's version count
      // increased (AC-068-7) without the row ever saying what the slug WAS
      // at that version. SPEC-072 closes this gap: `VersionRecord.slug` is
      // now written at every version-insert point (create/update/restore).
      // See `version-slug.test.ts` (AC-072-1..3) for the full behavioral
      // suite; this test is updated in place (not deleted) so this file's
      // own historical narrative — "here's the gap, here's the fix" —
      // stays readable in one place.
      const { service, store } = makeService();
      const created = await service.create(prdInput("Slug History Doc"));
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      const originalSlug = created.value.slug;

      const renamed = await service.set(originalSlug, { slug: "prd-history-repaired" });
      expect(renamed.ok).toBe(true);
      if (!renamed.ok) return;

      const versions = await store.findVersions(created.value.id);
      expect(versions.ok).toBe(true);
      if (!versions.ok) return;
      for (const v of versions.value) {
        expect(Object.prototype.hasOwnProperty.call(v, "slug")).toBe(true);
      }

      // The pre-rename slug is recoverable from the version-1 row (state as
      // of that version, written at create time); the rename's own row (v2)
      // carries the NEW slug — see version-slug.test.ts's convention note.
      const v1 = versions.value.find((v) => v.version === 1);
      const v2 = versions.value.find((v) => v.version === 2);
      expect(v1?.slug).toBe(originalSlug);
      expect(v2?.slug).toBe("prd-history-repaired");
    });

    it("old slugs from EVERY step of a multi-rename chain 404, not just the immediately-prior one", async () => {
      const { service } = makeService();
      const created = await service.create(prdInput("Chain Doc"));
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      const slugA = created.value.slug;

      const r1 = await service.set(slugA, { slug: "prd-chain-b" });
      expect(r1.ok).toBe(true);
      if (!r1.ok) return;
      const slugB = r1.value.slug;

      const r2 = await service.set(slugB, { slug: "prd-chain-c" });
      expect(r2.ok).toBe(true);

      const lookupA = await service.get(slugA);
      expect(lookupA.ok).toBe(false);
      if (!lookupA.ok) expect(lookupA.error.code).toBe("DOC_NOT_FOUND");

      const lookupB = await service.get(slugB);
      expect(lookupB.ok).toBe(false);
      if (!lookupB.ok) expect(lookupB.error.code).toBe("DOC_NOT_FOUND");

      const lookupC = await service.get("prd-chain-c");
      expect(lookupC.ok).toBe(true);
    });
  });

  // ─── STATE: combined slug+content patch on an approved doc — what wins? ─

  it("a COMBINED slug+content patch on an approved doc resets to draft (content wins the status decision) AND updates the slug in the same call", async () => {
    const { service } = makeService();
    const created = await service.create(prdInput("Combined Patch Doc"));
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const approved = await service.set(created.value.slug, { status: "approved" });
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;
    expect(approved.value.status).toBe("approved");

    const combined = await service.set(approved.value.slug, {
      slug: "prd-combined-repaired",
      content: "New body content replacing the old one.",
    });
    expect(combined.ok).toBe(true);
    if (!combined.ok) return;

    // Content changed -> the pre-existing approved->draft auto-reset fires,
    // exactly as it would for a content-only patch — slug being ALSO
    // present in the same call must not suppress it.
    expect(combined.value.status).toBe("draft");
    // The slug change is honored in the SAME call, not silently dropped.
    expect(combined.value.slug).toBe("prd-combined-repaired");

    const resolved = await service.get("prd-combined-repaired");
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    // reason: CorpusService.set canonicalises content on write (`canonicaliseBody`
    // ensures exactly one trailing newline) — same invariant as _createImpl.
    expect(resolved.value.doc.content).toBe("New body content replacing the old one.\n");
    expect(resolved.value.doc.status).toBe("draft");
  });

  // ─── REGRESSION: title-only patch on an approved doc still resets to draft ─

  it("REGRESSION: a title-only patch (no slug involved at all) on an approved doc still resets to draft — SPEC-068's slug logic did not disturb this pre-existing invariant", async () => {
    const { service } = makeService();
    const created = await service.create(prdInput("Untouched By Slug Logic"));
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const approved = await service.set(created.value.slug, { status: "approved" });
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;

    const titleOnly = await service.set(approved.value.slug, { title: "A Brand New Title" });
    expect(titleOnly.ok).toBe(true);
    if (!titleOnly.ok) return;
    expect(titleOnly.value.status).toBe("draft");
  });

  // ─── NEGATIVE (documents actual behavior): no type-prefix enforcement ──

  it("documents actual behavior: `set --slug` does NOT enforce that the new slug's prefix matches the doc's OWN type — a prd can be renamed to a spec-prefixed slug", async () => {
    // SPEC-068 D5 says only: validate via slugSchema, reject if taken,
    // no-op if unchanged. It does not mention cross-checking the new slug's
    // leading segment against `existing.type`. This test pins the ACTUAL
    // (permissive) behavior — worth flagging in the completion report as a
    // possible spec gap, not asserted here as "correct".
    const { service } = makeService();
    const created = await service.create(prdInput("Type Mismatch Target"));
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const result = await service.set(created.value.slug, { slug: "spec-totally-unrelated-prefix" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.slug).toBe("spec-totally-unrelated-prefix");
    expect(result.value.type).toBe("prd"); // the doc's actual type is untouched
  });
});
