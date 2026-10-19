// @layer service-export-docs
/**
 * task-export-never-falls-back-to-a-title-name-for-an-unnumbered (BR-1284 restated).
 *
 * A spec or decision record of a numbered kind that carries no number at export is a corpus
 * integrity failure: the export is refused (VALIDATION_ERROR, exit 4) naming the documents and
 * writes no file and no index. It is never exported under a title-derived or sequential fallback
 * name, and the report carries no migration warning. A kind that never gets a number
 * (domain-overview spec) exports with no number and no warning. After the numbering upgrade
 * (`OrdinalMigrationService.migrateOrdinals`, `lore migrate ordinals --apply`) the same export
 * succeeds under the allocated number.
 *
 * Uses InMemoryStore + a real temp filesystem; no mocks. Coverage: HAPPY / NEGATIVE / BOUNDARY /
 * ERROR / STATE / REGRESSION.
 */

import { describe, it, expect, afterEach } from "vitest";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { ExportDocsService } from "../../../src/service/export-docs-service.js";
import { OrdinalMigrationService } from "../../../src/service/ordinal-migration-service.js";
import { ok, DOC_TYPE_ROLE_MAP } from "@lore/core";
import type { DocRecord, Slug } from "@lore/core";
import { actedStore } from "../../live-invocation.js";

const tmpDirs: string[] = [];

function makeTempProjectDir(): string {
  const dir = join(tmpdir(), `lore-export-unnumbered-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(dir, ".lore"), { recursive: true });
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeDoc(o: Pick<DocRecord, "id" | "type" | "title"> & { slug: string; extra?: Record<string, unknown>; ordinal?: number }): DocRecord {
  const now = "2024-01-15T10:00:00.000Z";
  return {
    id: o.id,
    slug: o.slug as Slug,
    type: o.type,
    role: DOC_TYPE_ROLE_MAP[o.type],
    title: o.title,
    status: "draft",
    priority: "medium",
    content: "# Body\n\ntext",
    parent_id: null,
    created_at: now,
    updated_at: now,
    created_by: "test-agent",
    version: 1,
    deleted_at: null,
    tags: [],
    extra: o.extra ?? {},
    ...(o.ordinal !== undefined ? { ordinal: o.ordinal } : {}),
  };
}

function makeService(store: InMemoryStore): ExportDocsService {
  return new ExportDocsService(store, async (doc) => ok(doc.content));
}

async function seed(store: InMemoryStore, doc: DocRecord): Promise<void> {
  const r = await store.insert(doc);
  if (!r.ok) throw new Error(`insert failed: ${r.error.code}`);
}

describe("task-export-never-falls-back-to-a-title-name-for-an-unnumbered", () => {
  it("NEGATIVE: an unnumbered spec refuses the export naming it, writing no file and no index", async () => {
    const store = actedStore(new InMemoryStore());
    const projectDir = makeTempProjectDir();
    await seed(store, makeDoc({ id: "01J0000000000000000000U001", type: "spec", title: "Legacy Unnumbered Spec", slug: "spec-legacy-unnumbered" }));

    const result = await makeService(store).exportDocs({ projectDir, dryRun: false });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    expect(result.error.message).toContain("Legacy Unnumbered Spec");
    expect(result.error.message).toContain("01J0000000000000000000U001");
    expect(result.error.message).toContain("lore migrate ordinals");
    expect(existsSync(join(projectDir, ".lore", "export-index.json"))).toBe(false);
    expect(existsSync(join(projectDir, "docs"))).toBe(false);
  });

  it("NEGATIVE: an unnumbered decision record refuses too, and every offender is named", async () => {
    const store = actedStore(new InMemoryStore());
    const projectDir = makeTempProjectDir();
    await seed(store, makeDoc({ id: "01J0000000000000000000U002", type: "adr", title: "Legacy Decision", slug: "adr-legacy-decision", extra: { decision_status: "proposed" } }));
    await seed(store, makeDoc({ id: "01J0000000000000000000U003", type: "spec", title: "Second Legacy Spec", slug: "spec-second-legacy" }));

    const result = await makeService(store).exportDocs({ projectDir, dryRun: false });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("Legacy Decision");
    expect(result.error.message).toContain("Second Legacy Spec");
  });

  it("STATE: a dry run refuses as well (the integrity failure does not depend on writing)", async () => {
    const store = actedStore(new InMemoryStore());
    const projectDir = makeTempProjectDir();
    await seed(store, makeDoc({ id: "01J0000000000000000000U004", type: "spec", title: "Dry Legacy", slug: "spec-dry-legacy" }));
    const result = await makeService(store).exportDocs({ projectDir, dryRun: true });
    expect(result.ok).toBe(false);
  });

  it("REGRESSION: a numbered doc beside an unnumbered one is not exported either (nothing partial)", async () => {
    const store = actedStore(new InMemoryStore());
    const projectDir = makeTempProjectDir();
    await seed(store, makeDoc({ id: "01J0000000000000000000U005", type: "spec", title: "Numbered", slug: "spec-numbered", ordinal: 7 }));
    await seed(store, makeDoc({ id: "01J0000000000000000000U006", type: "spec", title: "Unnumbered", slug: "spec-unnumbered" }));
    const result = await makeService(store).exportDocs({ projectDir, dryRun: false });
    expect(result.ok).toBe(false);
    expect(existsSync(join(projectDir, "docs"))).toBe(false);
    expect(existsSync(join(projectDir, ".lore", "export-index.json"))).toBe(false);
  });

  it("HAPPY: after the numbering upgrade the same export succeeds under the allocated number", async () => {
    const store = actedStore(new InMemoryStore());
    const projectDir = makeTempProjectDir();
    const id = "01J0000000000000000000U007";
    await seed(store, makeDoc({ id, type: "spec", title: "Upgrade Me", slug: "spec-upgrade-me" }));
    const service = makeService(store);

    expect((await service.exportDocs({ projectDir, dryRun: false })).ok).toBe(false);

    const migrated = await new OrdinalMigrationService(store).migrateOrdinals({ dryRun: false, projectDir });
    expect(migrated.ok).toBe(true);

    const after = await service.exportDocs({ projectDir, dryRun: false });
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.value.created).toHaveLength(1);
    expect(after.value.created[0]).toMatch(/SPEC-\d{3}/);
    expect(after.value).not.toHaveProperty("ordinal_warnings");
  });

  it("BOUNDARY: a domain-overview spec still exports with no number and no warning", async () => {
    const store = actedStore(new InMemoryStore());
    const projectDir = makeTempProjectDir();
    await seed(store, makeDoc({ id: "01J0000000000000000000U008", type: "spec", title: "Overview Doc", slug: "spec-overview-doc", extra: { spec_kind: "domain-overview" } }));
    const result = await makeService(store).exportDocs({ projectDir, dryRun: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.created).toHaveLength(1);
    expect(result.value).not.toHaveProperty("ordinal_warnings");
  });

  it("REGRESSION: a non-numbered type (plan) without an ordinal exports normally", async () => {
    const store = actedStore(new InMemoryStore());
    const projectDir = makeTempProjectDir();
    await seed(store, makeDoc({ id: "01J0000000000000000000U009", type: "plan", title: "A Plan", slug: "plan-a-plan" }));
    const result = await makeService(store).exportDocs({ projectDir, dryRun: false });
    expect(result.ok).toBe(true);
  });
});
