/** @spec_ref AC-VER-001 */
/**
 * Tests for VersionService — version history, diffing, and rollback.
 * Source: SPEC-006, SPEC-001 §3.3
 *
 * Test design:
 *   EP: valid/invalid docId, valid/invalid version numbers
 *   BVA: single version, limit=1, offset=0, version=1 (minimum)
 *   Decision Table: from/to explicit vs. default, single vs. multi version
 *   State Transition: restore creates N+1, history remains intact
 *
 * AC-VER-001: VersionService log, diff, and restore behavior per SPEC-006 §6
 *
 * Dimensions:
 *   HAPPY: normal log, diff, restore flows
 *   NEGATIVE: nonexistent doc, nonexistent version, invalid from/to
 *   BOUNDARY: single version diff, limit/offset pagination, restore to v1
 *   ERROR: store errors propagate correctly
 *   STATE: restore is non-destructive, doc version counter advances
 *   REGRESSION: N/A — no known regressions
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { VersionService } from "../../../src/service/version-service.js";
import { err } from "@lore/core";
import type { DocRecord, VersionRecord } from "@lore/core";

// ─── Factories ────────────────────────────────────────────────────────────────

let _seq = 0;

function nextId(): string {
  _seq += 1;
  return `01HVSVC${String(_seq).padStart(19, "0")}`;
}

function makeDoc(overrides: Partial<DocRecord> = {}): DocRecord {
  return {
    id: nextId(),
    slug: `prd-test-${_seq}`,
    type: "prd",
    role: "intent",
    title: "Test Document",
    status: "draft",
    priority: "medium",
    content: "Initial content",
    parent_id: null,
    extra: {},
    tags: [],
    version: 1,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    created_by: "agent-test",
    deleted_at: null,
    ...overrides,
  };
}

function makeVersionRecord(
  docId: string,
  version: number,
  overrides: Partial<VersionRecord> = {},
): VersionRecord {
  return {
    doc_id: docId,
    version,
    content: `Content at version ${version}`,
    extra: {},
    status: "draft",
    title: "Test Document",
    action: version === 1 ? "create" : "update",
    created_at: `2026-01-0${version}T00:00:00.000Z`,
    created_by: "agent-test",
    ...overrides,
  };
}

// ─── Test Setup ───────────────────────────────────────────────────────────────

let store: InMemoryStore;
let service: VersionService;

beforeEach(() => {
  _seq = 0;
  store = new InMemoryStore();
  service = new VersionService(store, new RecordLockService(store));
});

// ─── Helper: insert doc + version records to simulate history ─────────────────

async function setupDocWithVersions(
  versionCount: number,
  extraOverrides?: Partial<DocRecord>,
): Promise<DocRecord> {
  const doc = makeDoc({
    version: versionCount,
    ...extraOverrides,
  });

  await store.insert(doc);

  for (let i = 1; i <= versionCount; i++) {
    await store.insertVersion(makeVersionRecord(doc.id, i));
  }

  return doc;
}

// ─── VersionService.log ───────────────────────────────────────────────────────

describe("VersionService.log", () => {
  describe("happy path", () => {
    it("returns 3 versions newest first after create + 2 edits", async () => {
      const doc = await setupDocWithVersions(3);

      const result = await service.log(doc.id);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value).toHaveLength(3);
      expect(result.value[0]!.version).toBe(3);
      expect(result.value[1]!.version).toBe(2);
      expect(result.value[2]!.version).toBe(1);
    });

    it("populates action and created_by fields", async () => {
      const doc = await setupDocWithVersions(2);

      const result = await service.log(doc.id);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value[0]!.action).toBe("update");
      expect(result.value[0]!.created_by).toBe("agent-test");
      expect(result.value[1]!.action).toBe("create");
    });

    it("propagates change_summary when present", async () => {
      const doc = makeDoc({ version: 1 });
      await store.insert(doc);
      await store.insertVersion(
        makeVersionRecord(doc.id, 1, { change_summary: "initial draft" }),
      );

      const result = await service.log(doc.id);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value[0]!.change_summary).toBe("initial draft");
    });
  });

  describe("boundary values", () => {
    it("returns only 2 most recent versions when limit=2", async () => {
      const doc = await setupDocWithVersions(3);

      const result = await service.log(doc.id, { limit: 2 });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value).toHaveLength(2);
      expect(result.value[0]!.version).toBe(3);
      expect(result.value[1]!.version).toBe(2);
    });

    it("returns correct page when offset is used", async () => {
      const doc = await setupDocWithVersions(3);

      const result = await service.log(doc.id, { offset: 1, limit: 2 });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value).toHaveLength(2);
      expect(result.value[0]!.version).toBe(2);
      expect(result.value[1]!.version).toBe(1);
    });

    it("returns empty array for doc with no versions", async () => {
      const doc = makeDoc();
      await store.insert(doc);

      const result = await service.log(doc.id);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(0);
    });

    it("returns empty array when offset exceeds version count", async () => {
      const doc = await setupDocWithVersions(2);

      const result = await service.log(doc.id, { offset: 10 });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(0);
    });
  });

  describe("negative cases", () => {
    it("returns DOC_NOT_FOUND for unknown docId", async () => {
      const result = await service.log("01HUNKNOWN00000000000000000");

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("DOC_NOT_FOUND");
    });
  });

  // error handling: N/A — InMemoryStore.findVersions never returns an error
  // state transitions: N/A — log is a read-only operation with no state side effects
  // regression: N/A — no known regressions
});

// ─── VersionService.diff ──────────────────────────────────────────────────────

describe("VersionService.diff", () => {
  describe("happy path", () => {
    it("returns diff between v1 and v3 when explicitly specified", async () => {
      const doc = makeDoc({ version: 3 });
      await store.insert(doc);
      await store.insertVersion(
        makeVersionRecord(doc.id, 1, { content: "Hello world" }),
      );
      await store.insertVersion(
        makeVersionRecord(doc.id, 2, { content: "Hello world\nLine two" }),
      );
      await store.insertVersion(
        makeVersionRecord(doc.id, 3, {
          content: "Hello world\nLine two\nLine three",
        }),
      );

      const result = await service.diff(doc.id, { from: 1, to: 3 });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.doc_id).toBe(doc.id);
      expect(result.value.from_version).toBe(1);
      expect(result.value.to_version).toBe(3);
      expect(result.value.content_diff).toContain("+Line two");
      expect(result.value.content_diff).toContain("+Line three");
    });

    it("defaults to diff between latest and previous (v2 vs v3)", async () => {
      const doc = makeDoc({ version: 3 });
      await store.insert(doc);
      await store.insertVersion(
        makeVersionRecord(doc.id, 1, { content: "Version one content" }),
      );
      await store.insertVersion(
        makeVersionRecord(doc.id, 2, { content: "Version two content" }),
      );
      await store.insertVersion(
        makeVersionRecord(doc.id, 3, { content: "Version three content" }),
      );

      const result = await service.diff(doc.id);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.from_version).toBe(2);
      expect(result.value.to_version).toBe(3);
      expect(result.value.content_diff).toContain("-Version two content");
      expect(result.value.content_diff).toContain("+Version three content");
    });

    it("detects frontmatter field changes between versions", async () => {
      const doc = makeDoc({ version: 2 });
      await store.insert(doc);
      await store.insertVersion(
        makeVersionRecord(doc.id, 1, {
          extra: { decision_status: "proposed", reviewer: "alice" },
        }),
      );
      await store.insertVersion(
        makeVersionRecord(doc.id, 2, {
          extra: { decision_status: "accepted", reviewer: "alice" },
        }),
      );

      const result = await service.diff(doc.id, { from: 1, to: 2 });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const changes = result.value.frontmatter_changes;
      expect(changes).toHaveLength(1);
      expect(changes[0]!.field).toBe("decision_status");
      expect(changes[0]!.old_value).toBe("proposed");
      expect(changes[0]!.new_value).toBe("accepted");
    });

    it("reports status_change when status differs between versions", async () => {
      const doc = makeDoc({ version: 2 });
      await store.insert(doc);
      await store.insertVersion(makeVersionRecord(doc.id, 1, { status: "draft" }));
      await store.insertVersion(
        makeVersionRecord(doc.id, 2, { status: "approved" }),
      );

      const result = await service.diff(doc.id, { from: 1, to: 2 });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.status_change).toEqual({
        from: "draft",
        to: "approved",
      });
    });

    it("omits status_change when status is unchanged", async () => {
      const doc = await setupDocWithVersions(2);

      const result = await service.diff(doc.id, { from: 1, to: 2 });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.status_change).toBeUndefined();
    });
  });

  describe("boundary values", () => {
    it("handles doc with only 1 version gracefully (no previous to diff)", async () => {
      const doc = await setupDocWithVersions(1);

      const result = await service.diff(doc.id);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // from_version = 0 (v1-1), to_version = 1
      expect(result.value.to_version).toBe(1);
      expect(result.value.content_diff).toBe("");
      expect(result.value.frontmatter_changes).toHaveLength(0);
    });

    it("returns no changed +/- lines when from and to have identical content", async () => {
      const doc = makeDoc({ version: 2 });
      await store.insert(doc);
      await store.insertVersion(
        makeVersionRecord(doc.id, 1, { content: "Same content" }),
      );
      await store.insertVersion(
        makeVersionRecord(doc.id, 2, { content: "Same content" }),
      );

      const result = await service.diff(doc.id, { from: 1, to: 2 });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // Split into lines, filter out the unified diff header lines (--- +++)
      // and check no added/removed content lines (lines starting with + or -)
      const lines = result.value.content_diff.split("\n");
      const contentChanges = lines.filter(
        (l) =>
          (l.startsWith("+") && !l.startsWith("+++")) ||
          (l.startsWith("-") && !l.startsWith("---")),
      );
      expect(contentChanges).toHaveLength(0);
    });
  });

  describe("negative cases", () => {
    it("returns DOC_NOT_FOUND error for doc with no versions", async () => {
      const result = await service.diff("01HUNKNOWN00000000000000000");

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("DOC_NOT_FOUND");
    });

    it("returns DOC_NOT_FOUND when explicit from version does not exist", async () => {
      const doc = await setupDocWithVersions(2);

      const result = await service.diff(doc.id, { from: 99, to: 2 });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("DOC_NOT_FOUND");
    });

    it("returns DOC_NOT_FOUND when explicit to version does not exist", async () => {
      const doc = await setupDocWithVersions(2);

      const result = await service.diff(doc.id, { from: 1, to: 99 });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("DOC_NOT_FOUND");
    });
  });

  // error handling: N/A — InMemoryStore.findVersions does not fail; propagation covered by negative cases
  // state transitions: N/A — diff is a read-only operation
  // regression: N/A — no known regressions
});

// ─── VersionService.restore ───────────────────────────────────────────────────

describe("VersionService.restore", () => {
  describe("happy path", () => {
    it("restores doc at v3 to v1 content, creating new v4", async () => {
      const doc = makeDoc({ version: 3 });
      await store.insert(doc);
      await store.insertVersion(
        makeVersionRecord(doc.id, 1, { content: "Original content" }),
      );
      await store.insertVersion(
        makeVersionRecord(doc.id, 2, { content: "Edited content" }),
      );
      await store.insertVersion(
        makeVersionRecord(doc.id, 3, { content: "Latest content" }),
      );

      const result = await service.restore(doc.id, 1);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const updated = result.value;
      expect(updated.version).toBe(4);
      expect(updated.content).toBe("Original content");
      expect(updated.status).toBe("draft");
    });

    it("creates a new version record with action=restore", async () => {
      const doc = makeDoc({ version: 3 });
      await store.insert(doc);
      for (let i = 1; i <= 3; i++) {
        await store.insertVersion(makeVersionRecord(doc.id, i));
      }

      const restoreResult = await service.restore(doc.id, 1);
      expect(restoreResult.ok).toBe(true);

      const versionsResult = await store.findVersions(doc.id);
      expect(versionsResult.ok).toBe(true);
      if (!versionsResult.ok) return;

      const versions = versionsResult.value;
      expect(versions).toHaveLength(4);

      const v4 = versions.find((v) => v.version === 4);
      expect(v4).toBeDefined();
      expect(v4!.action).toBe("restore");
      expect(v4!.change_summary).toContain("Restored from v1");
    });

    it("restores title and extra fields from the target version", async () => {
      const doc = makeDoc({ version: 2 });
      await store.insert(doc);
      await store.insertVersion(
        makeVersionRecord(doc.id, 1, {
          title: "Original Title",
          extra: { priority: "high" },
        }),
      );
      await store.insertVersion(
        makeVersionRecord(doc.id, 2, {
          title: "Updated Title",
          extra: { priority: "low" },
        }),
      );

      const result = await service.restore(doc.id, 1);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.title).toBe("Original Title");
      expect(result.value.extra).toEqual({ priority: "high" });
    });
  });

  describe("state transitions", () => {
    it("v1-v3 remain intact (non-destructive) after restore", async () => {
      const doc = makeDoc({ version: 3 });
      await store.insert(doc);
      for (let i = 1; i <= 3; i++) {
        await store.insertVersion(makeVersionRecord(doc.id, i));
      }

      await service.restore(doc.id, 1);

      const versionsResult = await store.findVersions(doc.id);
      expect(versionsResult.ok).toBe(true);
      if (!versionsResult.ok) return;

      const versions = versionsResult.value;
      expect(versions).toHaveLength(4);

      // All original versions still present
      expect(versions.find((v) => v.version === 1)).toBeDefined();
      expect(versions.find((v) => v.version === 2)).toBeDefined();
      expect(versions.find((v) => v.version === 3)).toBeDefined();
    });

    it("restoring again increments version to N+2 (restore is idempotent-safe)", async () => {
      const doc = makeDoc({ version: 2 });
      await store.insert(doc);
      await store.insertVersion(makeVersionRecord(doc.id, 1, { content: "v1" }));
      await store.insertVersion(makeVersionRecord(doc.id, 2, { content: "v2" }));

      const first = await service.restore(doc.id, 1);
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      expect(first.value.version).toBe(3);

      const second = await service.restore(doc.id, 2);
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      expect(second.value.version).toBe(4);
    });

    it("restore sets status to draft regardless of target version status", async () => {
      const doc = makeDoc({ version: 2 });
      await store.insert(doc);
      await store.insertVersion(
        makeVersionRecord(doc.id, 1, { status: "approved" }),
      );
      await store.insertVersion(
        makeVersionRecord(doc.id, 2, { status: "approved" }),
      );

      const result = await service.restore(doc.id, 1);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.status).toBe("draft");
    });
  });

  describe("negative cases", () => {
    it("returns DOC_NOT_FOUND error for nonexistent version", async () => {
      const doc = await setupDocWithVersions(3);

      const result = await service.restore(doc.id, 99);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("DOC_NOT_FOUND");
    });

    it("returns DOC_NOT_FOUND error when doc has no versions", async () => {
      const doc = makeDoc();
      await store.insert(doc);

      const result = await service.restore(doc.id, 1);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("DOC_NOT_FOUND");
    });

    it("returns DOC_NOT_FOUND error for entirely unknown docId", async () => {
      const result = await service.restore("01HUNKNOWN00000000000000000", 1);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("DOC_NOT_FOUND");
    });
  });

  describe("boundary values", () => {
    it("can restore to version 1 (minimum valid version)", async () => {
      const doc = makeDoc({ version: 3 });
      await store.insert(doc);
      for (let i = 1; i <= 3; i++) {
        await store.insertVersion(
          makeVersionRecord(doc.id, i, { content: `v${i} content` }),
        );
      }

      const result = await service.restore(doc.id, 1);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.content).toBe("v1 content");
      expect(result.value.version).toBe(4);
    });
  });

  // error handling: N/A — InMemoryStore never fails on valid operations; propagation tested via negative cases
  // regression: N/A — no known regressions
});

// ─── VersionService.restore — atomic CAS write ordering (M4 blocker fix) ──────
// reason: pre-fix, restore() ran insertVersion + appendAuditEntry UNCONDITIONALLY
// before the CAS-guarded store.update call. If a concurrent writer bumped the
// doc's version between the find() read and the update() write, the CAS failed
// with STALE_VERSION — but the versions/audit tables already permanently held a
// "restore" entry for a version number the live doc never reached, a phantom
// history entry lore log/diff would surface forever. Fix: update first, only
// insertVersion + appendAuditEntry on its success.

describe("VersionService.restore — atomic CAS write ordering (M4)", () => {
  /**
   * Test double that fails the NEXT `update` call with STALE_VERSION exactly
   * once — simulating a concurrent writer bumping the doc's version between
   * VersionService.restore's find() and its CAS update() — and counts
   * insertVersion/appendAuditEntry invocations so the test can assert neither
   * ran when the CAS write failed.
   */
  class StaleOnceStore extends InMemoryStore {
    insertVersionCalls = 0;
    appendAuditEntryCalls = 0;
    private failNextUpdate = false;

    triggerStaleUpdateOnNextCall(): void {
      this.failNextUpdate = true;
    }

    override async update(
      id: Parameters<InMemoryStore["update"]>[0],
      patch: Parameters<InMemoryStore["update"]>[1],
      opts?: Parameters<InMemoryStore["update"]>[2],
    ): ReturnType<InMemoryStore["update"]> {
      if (this.failNextUpdate) {
        this.failNextUpdate = false;
        const expected = opts?.expected_version ?? 0;
        return err({
          code: "STALE_VERSION",
          id,
          expected,
          actual: expected + 1,
        });
      }
      return super.update(id, patch, opts);
    }

    override async insertVersion(
      record: Parameters<InMemoryStore["insertVersion"]>[0],
    ): ReturnType<InMemoryStore["insertVersion"]> {
      this.insertVersionCalls += 1;
      return super.insertVersion(record);
    }

    override async appendAuditEntry(
      entry: Parameters<InMemoryStore["appendAuditEntry"]>[0],
    ): ReturnType<InMemoryStore["appendAuditEntry"]> {
      this.appendAuditEntryCalls += 1;
      return super.appendAuditEntry(entry);
    }
  }

  it("ERROR/STATE: concurrent version bump → CAS update fails with STALE_VERSION, NO versions/audit rows written", async () => {
    const staleStore = new StaleOnceStore();
    const staleService = new VersionService(staleStore, new RecordLockService(staleStore));

    const doc = makeDoc({ version: 2 });
    await staleStore.insert(doc);
    await staleStore.insertVersion(makeVersionRecord(doc.id, 1, { content: "v1" }));
    await staleStore.insertVersion(makeVersionRecord(doc.id, 2, { content: "v2" }));

    // reason: reset the call counters AFTER setup — the two insertVersion
    // calls above are test fixture writes, not part of the restore() flow
    // under test. Only calls made by restore() itself must count.
    staleStore.insertVersionCalls = 0;
    staleStore.appendAuditEntryCalls = 0;

    staleStore.triggerStaleUpdateOnNextCall();

    const result = await staleService.restore(doc.id, 1);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("STALE_VERSION");

    // Neither insertVersion nor appendAuditEntry ran — the CAS failure aborted
    // the restore before either write, leaving no phantom history entry.
    expect(staleStore.insertVersionCalls).toBe(0);
    expect(staleStore.appendAuditEntryCalls).toBe(0);

    // The versions table for this doc still holds exactly the pre-restore 2
    // entries — no v3 "restore" row was ever inserted.
    const versionsResult = await staleStore.findVersions(doc.id);
    expect(versionsResult.ok).toBe(true);
    if (!versionsResult.ok) return;
    expect(versionsResult.value).toHaveLength(2);

    // The live doc record is untouched — still at version 2.
    const docResult = await staleStore.find(doc.id);
    expect(docResult.ok).toBe(true);
    if (!docResult.ok) return;
    expect(docResult.value?.version).toBe(2);
  });

  it("REGRESSION: happy-path restore still lands doc update + version snapshot + audit entry, all joined on the SAME nextVersion", async () => {
    const doc = makeDoc({ version: 2 });
    await store.insert(doc);
    await store.insertVersion(makeVersionRecord(doc.id, 1, { content: "v1" }));
    await store.insertVersion(makeVersionRecord(doc.id, 2, { content: "v2" }));

    const result = await service.restore(doc.id, 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.version).toBe(3);

    const versionsResult = await store.findVersions(doc.id);
    expect(versionsResult.ok).toBe(true);
    if (!versionsResult.ok) return;
    const v3 = versionsResult.value.find((v) => v.version === 3);
    expect(v3).toBeDefined();
    expect(v3!.action).toBe("restore");

    const auditResult = await store.queryAudit({ doc_id: doc.id });
    expect(auditResult.ok).toBe(true);
    if (!auditResult.ok) return;
    const restoreAudit = auditResult.value.find(
      (a) => a.action === "restore" && a.doc_id === doc.id,
    );
    expect(restoreAudit).toBeDefined();
    expect((restoreAudit!.details as { version?: number })["version"]).toBe(3);
  });
});
