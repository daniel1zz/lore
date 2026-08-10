/** @spec_ref AC-072-1, AC-072-2, AC-072-3 */
/**
 * Unit tests for version-snapshot slug capture (SPEC-072).
 *
 * Uses InMemoryStore — no file I/O, no SQLite dependency, so this runs under
 * vitest (mirrors set-slug.test.ts's / version-service.test.ts's existing
 * convention).
 *
 * Convention-consistency note (see corpus-service.ts's `set()` versionRecord
 * comment and packages/core/src/types.ts's `VersionRecord.slug` JSDoc): a
 * version row's `slug`, like its `content`/`extra`/`status`/`title`
 * siblings, snapshots the doc's state AS OF that version (i.e. AFTER
 * whatever patch produced the row) — not a "value from immediately before
 * this specific change" field. AC-072-1's literal wording ("carries the
 * doc's pre-change slug value") is satisfied by walking the log: the
 * PRE-rename slug is recoverable from the PRIOR version row (which itself
 * captures the doc's slug as of ITS OWN creation), not by the rename's own
 * new row carrying an old value. This mirrors the pre-existing title/content
 * convention exactly (see corpus-service.ts's `set()` — a title rename's new
 * version row carries the NEW title, not the old one) — deliberately not
 * inventing a mixed before/after scheme for slug alone.
 *
 * Six-dimension coverage for this file:
 *   HAPPY:      a slug rename writes a version row; log exposes slug per
 *               version; restore leaves the current slug untouched
 *   NEGATIVE:   n/a — slug capture has no invalid-input surface of its own
 *               (slugSchema validation is set-slug.test.ts's concern)
 *   BOUNDARY:   a single-version doc (no rename yet) still carries slug on
 *               its lone create-time row
 *   ERROR:      n/a — no new error path introduced
 *   STATE:      the doc's live `slug` after restore differs from the
 *               restored-from version's snapshot slug (D4 non-restore)
 *   REGRESSION: a legacy version row lacking `slug` still logs/parses
 *               cleanly with no placeholder noise
 */

import { describe, expect, it } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { VersionService } from "../../../src/service/version-service.js";
import { ReviewService } from "../../../src/service/review-service.js";
import { TaskWorkflowService } from "../../../src/service/task-workflow-service.js";
import type { CreateDocInput, DocRecord, VersionRecord } from "@lore/core";

function makeServices() {
  const store = new InMemoryStore();
  return {
    store,
    corpusService: new CorpusService(store),
    versionService: new VersionService(store),
  };
}

function prdInput(title = "My Product"): CreateDocInput {
  return { type: "prd", title };
}

describe("VersionRecord.slug capture (SPEC-072)", () => {
  describe("AC-072-1: version rows capture slug per version; a rename's history recovers the pre-change value", () => {
    it("AC-072-1: create-time (version 1) row carries the doc's original slug", async () => {
      const { corpusService, store } = makeServices();
      const created = await corpusService.create(prdInput("Original Title"));
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const versions = await store.findVersions(created.value.id);
      expect(versions.ok).toBe(true);
      if (!versions.ok) return;

      const v1 = versions.value.find((v) => v.version === 1);
      expect(v1).toBeDefined();
      expect(v1!.slug).toBe(created.value.slug);
    });

    it("AC-072-1: a lore set --slug rename writes a NEW version row, and lore log --json exposes slug per version", async () => {
      const { corpusService, versionService } = makeServices();
      const created = await corpusService.create(prdInput("Rename Target"));
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      const oldSlug = created.value.slug;

      const renamed = await corpusService.set(oldSlug, { slug: "prd-renamed-target" });
      expect(renamed.ok).toBe(true);
      if (!renamed.ok) return;
      expect(renamed.value.slug).toBe("prd-renamed-target");

      const logResult = await versionService.log(created.value.id);
      expect(logResult.ok).toBe(true);
      if (!logResult.ok) return;

      // Newest first: version 2 (the rename) then version 1 (the create).
      expect(logResult.value).toHaveLength(2);
      const [v2, v1] = logResult.value;
      expect(v2!.version).toBe(2);
      expect(v1!.version).toBe(1);

      // The rename's OWN row carries the NEW slug (state-as-of-this-version,
      // matching every other snapshot field's convention).
      expect(v2!.slug).toBe("prd-renamed-target");

      // The doc's PRE-change slug is recoverable from the version row that
      // predates the rename — satisfying AC-072-1's "the slug value at any
      // historical version is unrecoverable from lore log" problem statement.
      expect(v1!.slug).toBe(oldSlug);
    });

    it("AC-072-1: a second rename's log shows all three slugs across the doc's full history", async () => {
      const { corpusService, versionService } = makeServices();
      const created = await corpusService.create(prdInput("Multi Rename Doc"));
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      const slugV1 = created.value.slug;

      const r1 = await corpusService.set(slugV1, { slug: "prd-second-name" });
      expect(r1.ok).toBe(true);
      if (!r1.ok) return;

      const r2 = await corpusService.set("prd-second-name", { slug: "prd-third-name" });
      expect(r2.ok).toBe(true);
      if (!r2.ok) return;

      const logResult = await versionService.log(created.value.id);
      expect(logResult.ok).toBe(true);
      if (!logResult.ok) return;

      expect(logResult.value).toHaveLength(3);
      const byVersion = new Map(logResult.value.map((v) => [v.version, v]));
      expect(byVersion.get(1)!.slug).toBe(slugV1);
      expect(byVersion.get(2)!.slug).toBe("prd-second-name");
      expect(byVersion.get(3)!.slug).toBe("prd-third-name");
    });

    // Rollout follow-up (post-implementation extension) — slug capture is not
    // limited to CorpusService's own write paths. Every OTHER service that
    // independently constructs a VersionRecord via `store.insertVersion(...)`
    // (review-service, task-workflow-service, ac-service, drift-check-service,
    // validity-service, requirement-service, phase-workflow-service,
    // phase-checklist-service, phase-migration-service) now also carries the
    // doc's slug through its shared write-path helper. These two tests prove
    // it end-to-end via a REAL non-corpus-service write, for the two most
    // commonly exercised of those services.
    it("AC-072-1: ReviewService.approve's version row carries the doc's slug (non-corpus-service write path)", async () => {
      const store = new InMemoryStore();
      const reviewService = new ReviewService(store);
      // reason: `ReviewService.approve` resolves via `resolveDoc`'s ULID_REGEX
      // (`^[0-9A-HJKMNP-TV-Z]{26}$/i` — Crockford Base32, excludes I/L/O/U), so
      // a hand-picked id must avoid those 4 letters or the lookup silently
      // falls through to a slug/prefix search and misses (DOC_NOT_FOUND).
      const doc: DocRecord = {
        id: "01HREVAPPR0VE0000000000001",
        slug: "prd-review-approve-slug",
        type: "prd",
        role: "intent",
        title: "Review Approve Slug Doc",
        status: "draft",
        priority: "medium",
        content: "content",
        parent_id: null,
        created_at: "2026-07-24T00:00:00.000Z",
        updated_at: "2026-07-24T00:00:00.000Z",
        created_by: "alice",
        version: 1,
        deleted_at: null,
        tags: [],
        extra: {},
      };
      const insertResult = await store.insert(doc);
      expect(insertResult.ok).toBe(true);

      const approveResult = await reviewService.approve(doc.id, { reviewer: "alice" });
      expect(approveResult.ok).toBe(true);
      if (!approveResult.ok) return;
      expect(approveResult.value.status).toBe("approved");

      const versions = await store.findVersions(doc.id);
      expect(versions.ok).toBe(true);
      if (!versions.ok) return;
      const approveVersion = versions.value.find((v) => v.action === "approve");
      expect(approveVersion).toBeDefined();
      expect(approveVersion!.slug).toBe("prd-review-approve-slug");
    });

    it("AC-072-1: TaskWorkflowService.addEvidence's version row carries the task's slug (non-corpus-service write path)", async () => {
      const store = new InMemoryStore();
      const corpusService = new CorpusService(store);
      const taskWorkflowService = new TaskWorkflowService(store, undefined, { claimTtlMinutes: 120 });

      const plan = await corpusService.create({ type: "plan", title: "Evidence Slug Plan", content: "body" } as CreateDocInput);
      expect(plan.ok).toBe(true);
      if (!plan.ok) return;

      const task = await corpusService.create({
        type: "task",
        title: "Evidence Slug Task",
        parent_id: plan.value.id,
        content: "body",
        extra: { plan_id: plan.value.id },
      } as CreateDocInput);
      expect(task.ok).toBe(true);
      if (!task.ok) return;
      const taskSlug = task.value.slug;

      // reason: SUPERSEDED oracle (task-raise-the-evidence-tail-guard-s-
      // predicate-to-its-own) — "tsc" self-report is now refused regardless of
      // tail content; "manual" is the one oracle that still lets a genuinely
      // non-empty self-reported tail succeed. This test only checks the
      // version row's slug capture, not capture_source semantics.
      const evidenceResult = await taskWorkflowService.addEvidence(task.value.id, {
        oracle: "manual",
        command: "bun run typecheck",
        result: "pass",
        recorded_by: "alice",
        output_tail: "ok",
        capture_source: "self-report",
      });
      expect(evidenceResult.ok).toBe(true);
      if (!evidenceResult.ok) return;

      const versions = await store.findVersions(task.value.id);
      expect(versions.ok).toBe(true);
      if (!versions.ok) return;
      // v1 = create, v2 = evidence append.
      const evidenceVersion = versions.value.find((v) => v.version === 2);
      expect(evidenceVersion).toBeDefined();
      expect(evidenceVersion!.slug).toBe(taskSlug);
    });
  });

  describe("AC-072-2: legacy version rows without slug parse and render without error or placeholder noise", () => {
    it("AC-072-2: a legacy row (no slug field at all) round-trips through the store with slug simply absent", async () => {
      const { corpusService, store } = makeServices();
      const created = await corpusService.create(prdInput("Legacy Row Doc"));
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      // Simulate a pre-migration-007 row written before slug capture existed:
      // insert a version record with no `slug` key at all (not `slug:
      // undefined` — a genuinely absent property, matching how a real legacy
      // DB row parses via rowToVersionRecord's NULL-omission branch).
      const legacyVersion: VersionRecord = {
        doc_id: created.value.id,
        version: 2,
        content: created.value.content,
        extra: created.value.extra,
        status: created.value.status,
        title: created.value.title,
        action: "update",
        created_at: "2026-01-01T00:00:00.000Z",
        created_by: "legacy-writer",
      };
      expect("slug" in legacyVersion).toBe(false);
      const insertResult = await store.insertVersion(legacyVersion);
      expect(insertResult.ok).toBe(true);

      const versions = await store.findVersions(created.value.id);
      expect(versions.ok).toBe(true);
      if (!versions.ok) return;
      const legacyRow = versions.value.find((v) => v.version === 2);
      expect(legacyRow).toBeDefined();
      expect(legacyRow!.slug).toBeUndefined();
    });

    it("AC-072-2: VersionService.log never substitutes a placeholder string for a missing slug", async () => {
      const { corpusService, store, versionService } = makeServices();
      const created = await corpusService.create(prdInput("Placeholder-Free Doc"));
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const legacyVersion: VersionRecord = {
        doc_id: created.value.id,
        version: 2,
        content: "updated content",
        extra: {},
        status: "draft",
        title: created.value.title,
        action: "update",
        created_at: "2026-01-01T00:00:00.000Z",
        created_by: "legacy-writer",
      };
      await store.insertVersion(legacyVersion);

      const logResult = await versionService.log(created.value.id);
      expect(logResult.ok).toBe(true);
      if (!logResult.ok) return;

      const legacyEntry = logResult.value.find((v) => v.version === 2);
      expect(legacyEntry).toBeDefined();
      // No "slug" key present at all — never "unknown"/"" as a stand-in value.
      expect("slug" in legacyEntry!).toBe(false);
      expect(JSON.stringify(legacyEntry)).not.toContain("unknown");
    });
  });

  describe("AC-072-3: lore restore never restores slug, even when the target version's row carries a different one", () => {
    it("AC-072-3: restoring to a version whose row carries the OLD slug leaves the doc's CURRENT slug untouched", async () => {
      const { corpusService, versionService } = makeServices();
      const created = await corpusService.create(prdInput("Restore Slug Doc"));
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      const originalSlug = created.value.slug;

      // Version 2: content edit only (no slug change yet) so restoring TO v1
      // has a real content delta to prove restore actually ran.
      const edited = await corpusService.set(originalSlug, { content: "Edited body" });
      expect(edited.ok).toBe(true);
      if (!edited.ok) return;

      // Version 3: rename — the doc's CURRENT slug is now different from
      // what version 1's row carries.
      const renamed = await corpusService.set(originalSlug, { slug: "prd-renamed-after-edit" });
      expect(renamed.ok).toBe(true);
      if (!renamed.ok) return;
      expect(renamed.value.slug).toBe("prd-renamed-after-edit");

      // Restore to v1 — v1's own row carries `originalSlug`, DIFFERENT from
      // the doc's current slug (`prd-renamed-after-edit`).
      const restoreResult = await versionService.restore(created.value.id, 1);
      expect(restoreResult.ok).toBe(true);
      if (!restoreResult.ok) return;

      // Content restored...
      expect(restoreResult.value.content).toBe(created.value.content);
      // ...but slug is UNCHANGED — never reverted to v1's snapshot slug.
      expect(restoreResult.value.slug).toBe("prd-renamed-after-edit");
      expect(restoreResult.value.slug).not.toBe(originalSlug);

      // The new version-4 snapshot itself also carries the CURRENT
      // (unchanged) slug, not v1's — consistent state-as-of-this-version.
      const logResult = await versionService.log(created.value.id);
      expect(logResult.ok).toBe(true);
      if (!logResult.ok) return;
      const v4 = logResult.value.find((v) => v.version === 4);
      expect(v4).toBeDefined();
      expect(v4!.slug).toBe("prd-renamed-after-edit");

      // The doc still resolves under its CURRENT slug, never the restored one.
      const stillResolves = await corpusService.get("prd-renamed-after-edit");
      expect(stillResolves.ok).toBe(true);
    });

    it("AC-072-3: restoring does not resurrect the old slug as a resolvable address", async () => {
      const { corpusService, versionService } = makeServices();
      const created = await corpusService.create(prdInput("No Resurrection Doc"));
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      const originalSlug = created.value.slug;

      const renamed = await corpusService.set(originalSlug, { slug: "prd-final-address" });
      expect(renamed.ok).toBe(true);
      if (!renamed.ok) return;

      const restoreResult = await versionService.restore(created.value.id, 1);
      expect(restoreResult.ok).toBe(true);

      // The OLD slug must NOT have come back into existence as a lookup key.
      const oldLookup = await corpusService.get(originalSlug);
      expect(oldLookup.ok).toBe(false);
      if (oldLookup.ok) return;
      expect(oldLookup.error.code).toBe("DOC_NOT_FOUND");
    });
  });
});
