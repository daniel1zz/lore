/**
 * Regression tests for the SPEC-021 export-collision fix (commit 271c1ec).
 *
 * Spec-first: expected behaviors defined from the invariants documented in
 * export-docs-service.ts's header comment + packages/lore/src/service/CLAUDE.md
 * BEFORE re-reading the implementation body in detail. The bug being regression-
 * tested (SPEC-021 export-collision incident, see PLAN-005 / TASK-027 / TASK-028):
 * two corpus docs sharing a title could end up mapped to the SAME human_id AND
 * file_path — the second doc silently inherited the first doc's identity, and
 * its own (different) content then permanently false-drifted against the
 * first doc's file.
 *
 * The fix has three parts, each covered below:
 *   1. `usedFilePaths` guard on the title-match reconcile branch — a file_path
 *      already claimed by a different doc id in this pass must not be handed
 *      to a second same-titled doc (buildOrExtendIndex).
 *   2. `allocateUniqueFilePath` — sequential fallback allocation dedupes its
 *      computed file_path against already-claimed paths with a -2/-3/...
 *      suffix, fail-loud VALIDATION_ERROR after 999 attempts.
 *   3. `repairCollisions` — self-heals an already-corrupted index (two doc ids
 *      → one file_path): canonical owner = content match against disk, else
 *      earliest created_at; loser(s) stripped and reallocated fresh; every
 *      repair logged in ExportReport.repaired.
 *
 * A key discovery while designing these tests (documented per-test below):
 * because every corpus doc gets a *fresh, unique* human_id within a single
 * buildOrExtendIndex pass, two REAL corpus docs cannot make
 * allocateUniqueFilePath's computed `base` path collide with each other in a
 * single run — the human_id prefix alone guarantees uniqueness. The -2/-3
 * suffix loop is only reachable when a file_path is pre-claimed via a
 * mismatched/hand-edited index entry (documented as a supported case: "or a
 * manual hand-edit of export-index.json"). The BOUNDARY and ERROR sections
 * below construct exactly that fixture to exercise the loop deterministically.
 *
 * Uses InMemoryStore + real temp filesystem. No mocks.
 * Runs under vitest (no bun:sqlite dependency).
 *
 * Coverage: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION
 *
 * @spec_ref AC-EXPORT-2, AC-EXPORT-3, AC-EXPORT-6 — SPEC-021 §9.3/§9.4, export-docs-service.ts header
 */

import { describe, it, expect, afterEach } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { ExportDocsService, type ResolveDocBody } from "../../../src/service/export-docs-service.js";
import { OutlineService, renderResolvedToMarkdown } from "../../../src/service/outline-service.js";
import { canonicaliseBody, ok, DOC_TYPE_ROLE_MAP } from "@lore/core";
import type { DocRecord, ExportIndex, Slug } from "@lore/core";

/**
 * Build the real ResolveDocBody wiring (OutlineService.resolve + renderResolvedToMarkdown)
 * against the given store — mirrors app.ts's composition exactly (SPEC-032 §3.3), so these
 * tests exercise the actual splice behavior rather than a stub.
 */
function makeExportService(store: InMemoryStore): ExportDocsService {
  const outlineService = new OutlineService(store);
  const resolveDocBody: ResolveDocBody = async (doc) => {
    const resolved = await outlineService.resolve(doc);
    if (!resolved.ok) return resolved;
    return ok(renderResolvedToMarkdown(resolved.value));
  };
  return new ExportDocsService(store, resolveDocBody);
}

// ─── Temp Directory Lifecycle ─────────────────────────────────────────────────

const tmpDirs: string[] = [];

function makeTempProjectDir(): string {
  const dir = join(
    tmpdir(),
    `lore-export-collision-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(join(dir, ".lore"), { recursive: true });
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
});

// ─── DocRecord Factory ─────────────────────────────────────────────────────────

function makeDoc(
  overrides: Partial<DocRecord> & {
    id: string;
    type: DocRecord["type"];
    title: string;
    slug: string;
  },
): DocRecord {
  const now = "2024-01-15T10:00:00.000Z";
  return {
    id: overrides.id,
    slug: overrides.slug as Slug,
    type: overrides.type,
    role: DOC_TYPE_ROLE_MAP[overrides.type],
    title: overrides.title,
    status: overrides.status ?? "draft",
    priority: overrides.priority ?? "medium",
    content: overrides.content ?? "# Default\n\nContent body.",
    parent_id: overrides.parent_id ?? null,
    created_at: overrides.created_at ?? now,
    updated_at: overrides.updated_at ?? now,
    created_by: overrides.created_by ?? "test-agent",
    version: overrides.version ?? 1,
    deleted_at: overrides.deleted_at ?? null,
    tags: overrides.tags ?? [],
    extra: overrides.extra ?? {},
  };
}

async function insertDoc(store: InMemoryStore, doc: DocRecord): Promise<DocRecord> {
  const result = await store.insert(doc);
  if (!result.ok) throw new Error(`store.insert failed: ${result.error.code}`);
  return result.value;
}

function extractBody(mdContent: string): string {
  const normalized = mdContent.replace(/\r\n/g, "\n");
  const match = normalized.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
  return match ? (match[1] ?? "") : normalized;
}

function writeIndexFile(projectDir: string, index: ExportIndex): void {
  const indexPath = join(projectDir, ".lore", "export-index.json");
  writeFileSync(indexPath, JSON.stringify(index, null, 2) + "\n", "utf8");
}

function readIndexFile(projectDir: string): ExportIndex {
  const indexPath = join(projectDir, ".lore", "export-index.json");
  return JSON.parse(readFileSync(indexPath, "utf8")) as ExportIndex;
}

/** Write a minimal but well-formed exported .md file (frontmatter + body). */
function writeExportedFile(
  projectDir: string,
  relFilePath: string,
  humanId: string,
  title: string,
  body: string,
): void {
  const absPath = join(projectDir, relFilePath);
  mkdirSync(join(absPath, ".."), { recursive: true });
  const fm = `---\nid: ${humanId}\ntype: knowledge\nrole: knowledge\ntitle: "${title}"\nstatus: draft\npriority: medium\ncreated: 2024-01-01\nupdated: 2024-01-01\ntags: []\n---\n`;
  // Mirror how a real export writes the body (canonicalised) so a fixture built
  // to represent "doc X actually wrote this file" round-trips through the same
  // comparison the service itself uses (canonicaliseBody on both sides).
  writeFileSync(absPath, fm + canonicaliseBody(body), "utf8");
}

// ─── HAPPY: two same-titled docs, single export run ───────────────────────────

describe("HAPPY — two same-titled docs in a single export run get distinct human_ids + paths", () => {
  it("both docs export cleanly with different human_id and file_path", async () => {
    const store = new InMemoryStore();
    const service = makeExportService(store);
    const projectDir = makeTempProjectDir();

    await insertDoc(store, makeDoc({
      id: "doc-happy-a",
      type: "knowledge",
      title: "Duplicate Title",
      slug: "knowledge-duplicate-title-a",
      content: "# Content A\n\nUnique body A.",
      updated_at: "2024-01-15T10:00:02.000Z",
    }));
    await insertDoc(store, makeDoc({
      id: "doc-happy-b",
      type: "knowledge",
      title: "Duplicate Title",
      slug: "knowledge-duplicate-title-b",
      content: "# Content B\n\nUnique body B.",
      updated_at: "2024-01-15T10:00:01.000Z",
    }));

    const result = await service.exportDocs({ projectDir, dryRun: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.created).toHaveLength(2);
    expect(result.value.errors).toHaveLength(0);

    const index = readIndexFile(projectDir);
    const mapA = index.mappings["doc-happy-a"]!;
    const mapB = index.mappings["doc-happy-b"]!;

    // Different-inputs-different-outputs: distinct human_id, distinct file_path.
    expect(mapA.human_id).not.toBe(mapB.human_id);
    expect(mapA.file_path).not.toBe(mapB.file_path);

    // Both files physically exist and carry their OWN content, not each other's.
    const bodyA = extractBody(readFileSync(join(projectDir, mapA.file_path), "utf8"));
    const bodyB = extractBody(readFileSync(join(projectDir, mapB.file_path), "utf8"));
    expect(bodyA).toBe(canonicaliseBody("# Content A\n\nUnique body A."));
    expect(bodyB).toBe(canonicaliseBody("# Content B\n\nUnique body B."));
  });

  it("second run on the same unchanged corpus is idempotent-clean (no re-create, no drift)", async () => {
    const store = new InMemoryStore();
    const service = makeExportService(store);
    const projectDir = makeTempProjectDir();

    await insertDoc(store, makeDoc({
      id: "doc-happy-idem-a",
      type: "knowledge",
      title: "Idempotent Duplicate",
      slug: "knowledge-idempotent-duplicate-a",
      content: "# A\n\nBody A.",
    }));
    await insertDoc(store, makeDoc({
      id: "doc-happy-idem-b",
      type: "knowledge",
      title: "Idempotent Duplicate",
      slug: "knowledge-idempotent-duplicate-b",
      content: "# B\n\nBody B.",
    }));

    const first = await service.exportDocs({ projectDir, dryRun: false });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.created).toHaveLength(2);

    const second = await service.exportDocs({ projectDir, dryRun: false });
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(second.value.created).toHaveLength(0);
    expect(second.value.skipped_clean).toHaveLength(2);
    expect(second.value.drift).toHaveLength(0);
    expect(second.value.errors).toHaveLength(0);
    expect(second.value.repaired).toHaveLength(0);
  });
});

// ─── NEGATIVE/STATE: same-titled docs across TWO separate export runs (the real incident) ──

describe("NEGATIVE/STATE — same-titled docs across two export runs must not collide (the SPEC-021 incident shape)", () => {
  it("a second, later-created doc with the same title as an already-exported doc gets its OWN human_id + file, and does not corrupt the first doc's file into false drift", async () => {
    const store = new InMemoryStore();
    const service = makeExportService(store);
    const projectDir = makeTempProjectDir();

    const contentA = "# Repeated Title\n\nOriginal canonical content for doc A.";
    await insertDoc(store, makeDoc({
      id: "doc-incident-a",
      type: "knowledge",
      title: "Repeated Title",
      slug: "knowledge-repeated-title-a",
      content: contentA,
    }));

    // Run 1 — only doc A exists. It gets exported and its file lands on disk.
    const first = await service.exportDocs({ projectDir, dryRun: false });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.created).toHaveLength(1);
    const filePathA = first.value.created[0]!;
    const indexAfterFirst = readIndexFile(projectDir);
    const humanIdA = indexAfterFirst.mappings["doc-incident-a"]!.human_id;

    // Between run 1 and run 2, a SECOND corpus doc is created with the SAME title
    // (this is exactly the incident shape: title collision discovered across runs,
    // not within a single run).
    const contentB = "# Repeated Title\n\nCompletely different content for doc B.";
    await insertDoc(store, makeDoc({
      id: "doc-incident-b",
      type: "knowledge",
      title: "Repeated Title",
      slug: "knowledge-repeated-title-b",
      content: contentB,
    }));

    // Run 2 — buildOrExtendIndex's title-match reconcile path scans the file
    // written in run 1 (title "Repeated Title") and, WITHOUT the usedFilePaths
    // guard, would hand doc B that SAME human_id + file_path (the bug).
    const second = await service.exportDocs({ projectDir, dryRun: false });
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    // Doc B must get its own newly-created file — NOT be silently absorbed into
    // doc A's existing file.
    expect(second.value.created).toHaveLength(1);
    const filePathB = second.value.created[0]!;
    expect(filePathB).not.toBe(filePathA);

    // Crucially: doc A's untouched, correctly-matching file must NOT be reported
    // as drifted. Before the fix, doc B's DIFFERENT content compared against doc
    // A's file (which it wrongly inherited) produced a permanent false drift.
    expect(second.value.drift).toHaveLength(0);
    expect(second.value.errors).toHaveLength(0);

    const indexAfterSecond = readIndexFile(projectDir);
    const mapA = indexAfterSecond.mappings["doc-incident-a"]!;
    const mapB = indexAfterSecond.mappings["doc-incident-b"]!;

    expect(mapA.human_id).toBe(humanIdA); // doc A's identity is stable/unchanged
    expect(mapB.human_id).not.toBe(mapA.human_id);
    expect(mapB.file_path).not.toBe(mapA.file_path);

    // Doc A's file body is exactly what it always was (untouched by the collision).
    const bodyA = extractBody(readFileSync(join(projectDir, mapA.file_path), "utf8"));
    expect(bodyA).toBe(canonicaliseBody(contentA));

    // Doc B's file carries doc B's OWN content, not doc A's.
    const bodyB = extractBody(readFileSync(join(projectDir, mapB.file_path), "utf8"));
    expect(bodyB).toBe(canonicaliseBody(contentB));
  });
});

// ─── Self-heal: unambiguous content match ─────────────────────────────────────

describe("Self-heal — corrupted index (two doc ids -> one file_path), unambiguous content match wins", () => {
  it("repaired[] has exactly one entry; the content-matching doc keeps the mapping; the other is reallocated + its file written; the matching doc's file is untouched", async () => {
    const store = new InMemoryStore();
    const service = makeExportService(store);
    const projectDir = makeTempProjectDir();

    const contentAlpha = "# Alpha\n\nCanonical alpha body.";
    const contentBeta = "# Beta\n\nCanonical beta body.";

    await insertDoc(store, makeDoc({
      id: "doc-heal-alpha",
      type: "knowledge",
      title: "Assessment Alpha",
      slug: "knowledge-assessment-alpha",
      content: contentAlpha,
      created_at: "2024-01-01T00:00:00.000Z",
    }));
    await insertDoc(store, makeDoc({
      id: "doc-heal-beta",
      type: "knowledge",
      title: "Assessment Beta",
      slug: "knowledge-assessment-beta",
      content: contentBeta,
      created_at: "2024-06-01T00:00:00.000Z",
    }));

    const collidedPath = "docs/requirements/knowledge/KN-002-collided.md";

    // Corrupted index: BOTH doc ids mapped to the same human_id + file_path
    // (the exact shape of the SPEC-021 incident, or a hand-edit).
    writeIndexFile(projectDir, {
      version: 1,
      mappings: {
        "doc-heal-alpha": { human_id: "KN-002", file_path: collidedPath },
        "doc-heal-beta": { human_id: "KN-002", file_path: collidedPath },
      },
    });

    // The physical file at the collided path holds Alpha's canonical content —
    // Alpha actually wrote it; Beta's mapping is the corrupted one.
    writeExportedFile(projectDir, collidedPath, "KN-002", "Assessment Alpha", contentAlpha);

    const result = await service.exportDocs({ projectDir, dryRun: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.repaired).toHaveLength(1);
    expect(result.value.repaired[0]).toContain("doc-heal-beta");

    const index = readIndexFile(projectDir);
    // Alpha keeps its original mapping — untouched.
    expect(index.mappings["doc-heal-alpha"]).toEqual({ human_id: "KN-002", file_path: collidedPath });
    // Beta was reallocated to a DIFFERENT human_id + file_path.
    const mapBeta = index.mappings["doc-heal-beta"]!;
    expect(mapBeta.file_path).not.toBe(collidedPath);
    expect(mapBeta.human_id).not.toBe("KN-002");

    // Beta's file was freshly written with Beta's own content.
    expect(result.value.created).toContain(mapBeta.file_path);
    const bodyBeta = extractBody(readFileSync(join(projectDir, mapBeta.file_path), "utf8"));
    expect(bodyBeta).toBe(canonicaliseBody(contentBeta));

    // Alpha's file body is reported skipped_clean (untouched, still matches).
    expect(result.value.skipped_clean).toContain(collidedPath);
    const bodyAlpha = extractBody(readFileSync(join(projectDir, collidedPath), "utf8"));
    expect(bodyAlpha).toBe(canonicaliseBody(contentAlpha));
  });

  it("a follow-up run after self-heal is fully clean: repaired[] is empty, both docs skipped_clean", async () => {
    const store = new InMemoryStore();
    const service = makeExportService(store);
    const projectDir = makeTempProjectDir();

    const contentAlpha = "# Alpha\n\nCanonical alpha body.";
    const contentBeta = "# Beta\n\nCanonical beta body.";

    await insertDoc(store, makeDoc({
      id: "doc-heal2-alpha",
      type: "knowledge",
      title: "Assessment Alpha 2",
      slug: "knowledge-assessment-alpha-2",
      content: contentAlpha,
      created_at: "2024-01-01T00:00:00.000Z",
    }));
    await insertDoc(store, makeDoc({
      id: "doc-heal2-beta",
      type: "knowledge",
      title: "Assessment Beta 2",
      slug: "knowledge-assessment-beta-2",
      content: contentBeta,
      created_at: "2024-06-01T00:00:00.000Z",
    }));

    const collidedPath = "docs/requirements/knowledge/KN-005-collided-2.md";
    writeIndexFile(projectDir, {
      version: 1,
      mappings: {
        "doc-heal2-alpha": { human_id: "KN-005", file_path: collidedPath },
        "doc-heal2-beta": { human_id: "KN-005", file_path: collidedPath },
      },
    });
    writeExportedFile(projectDir, collidedPath, "KN-005", "Assessment Alpha 2", contentAlpha);

    const first = await service.exportDocs({ projectDir, dryRun: false });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.repaired).toHaveLength(1);

    // Second, follow-up run — index is now internally consistent.
    const second = await service.exportDocs({ projectDir, dryRun: false });
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(second.value.repaired).toHaveLength(0);
    expect(second.value.created).toHaveLength(0);
    expect(second.value.skipped_clean).toHaveLength(2);
    expect(second.value.drift).toHaveLength(0);
    expect(second.value.errors).toHaveLength(0);
  });
});

// ─── Self-heal: ambiguous — neither claimant's content matches on-disk file ────

describe("Self-heal — ambiguous collision (on-disk file matches neither claimant, or is absent): earliest created_at wins", () => {
  it("when no on-disk file resolves the collision, the claimant with the earliest created_at is kept as canonical, regardless of index key order", async () => {
    const store = new InMemoryStore();
    const service = makeExportService(store);
    const projectDir = makeTempProjectDir();

    // Deliberately: the LATER-created doc is inserted first and listed FIRST in
    // the corrupted index's mapping keys, to prove the resolution genuinely
    // sorts by created_at rather than defaulting to insertion / iteration order.
    await insertDoc(store, makeDoc({
      id: "doc-ambig-later",
      type: "knowledge",
      title: "Ambiguous Later",
      slug: "knowledge-ambiguous-later",
      content: "# Later\n\nBody of the later-created doc.",
      created_at: "2024-06-01T00:00:00.000Z",
    }));
    await insertDoc(store, makeDoc({
      id: "doc-ambig-earlier",
      type: "knowledge",
      title: "Ambiguous Earlier",
      slug: "knowledge-ambiguous-earlier",
      content: "# Earlier\n\nBody of the earlier-created doc.",
      created_at: "2024-01-01T00:00:00.000Z",
    }));

    const collidedPath = "docs/requirements/knowledge/KN-009-ambiguous.md";

    // No physical file is written at collidedPath at all — repairCollisions'
    // onDiskBody is `undefined`, so contentMatches is empty and it MUST fall
    // through to the earliest-created_at branch (not the content-match branch).
    writeIndexFile(projectDir, {
      version: 1,
      mappings: {
        // later doc listed FIRST in the object
        "doc-ambig-later": { human_id: "KN-009", file_path: collidedPath },
        "doc-ambig-earlier": { human_id: "KN-009", file_path: collidedPath },
      },
    });

    const result = await service.exportDocs({ projectDir, dryRun: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.repaired).toHaveLength(1);
    // The LATER doc is the one that must be stripped/reallocated.
    expect(result.value.repaired[0]).toContain("doc-ambig-later");

    const index = readIndexFile(projectDir);
    // Earlier doc keeps the canonical mapping.
    expect(index.mappings["doc-ambig-earlier"]).toEqual({ human_id: "KN-009", file_path: collidedPath });
    // Later doc was reallocated.
    const mapLater = index.mappings["doc-ambig-later"]!;
    expect(mapLater.file_path).not.toBe(collidedPath);
  });
});

// ─── BOUNDARY: allocateUniqueFilePath suffix dedupe (-2, then -3) ─────────────

describe("BOUNDARY — allocateUniqueFilePath dedupes a computed file_path with -2, then -3, suffixes", () => {
  it("when both the base path and its -2 candidate are already claimed (hand-edited/orphan index entries), a new doc's computed path lands on -3", async () => {
    // Discovery: within ONE buildOrExtendIndex pass, every corpus doc gets a
    // freshly unique human_id, so two REAL docs can never make
    // allocateUniqueFilePath's computed `base` collide with each other — the
    // human_id prefix alone guarantees uniqueness. The -2/-3 suffix loop is
    // only reachable when a file_path is pre-claimed by an entry whose
    // human_id field does NOT match the number embedded in its file_path
    // field (a corrupted / hand-edited index; ExportIndexMapping does not
    // cross-validate the two fields against each other). We construct that
    // fixture here to exercise the loop deterministically. The doc ids below
    // ("orphan-*") are NEVER inserted into the store — they are harmless
    // orphan entries per the documented self-heal contract (repairCollisions
    // only treats a file_path as colliding when >=2 claimant ids exist as
    // ACTIVE corpus docs).
    const store = new InMemoryStore();
    const service = makeExportService(store);
    const projectDir = makeTempProjectDir();

    const dir = "docs/requirements/knowledge";
    writeIndexFile(projectDir, {
      version: 1,
      mappings: {
        // Both orphan entries use human_id "KN-001" so the real doc's counter
        // (seeded from maxNumberForPrefix) still lands on "KN-002" — but their
        // file_path values pre-claim exactly what KN-002's base and -2
        // candidates would compute to.
        "orphan-base": { human_id: "KN-001", file_path: `${dir}/KN-002-widget.md` },
        "orphan-dash2": { human_id: "KN-001", file_path: `${dir}/KN-002-widget-2.md` },
      },
    });

    await insertDoc(store, makeDoc({
      id: "doc-real-widget",
      type: "knowledge",
      title: "Widget",
      slug: "knowledge-widget",
      content: "# Widget\n\nReal widget body.",
    }));

    const result = await service.exportDocs({ projectDir, dryRun: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Orphan entries are harmless (no matching active corpus doc) — no repair.
    expect(result.value.repaired).toHaveLength(0);
    expect(result.value.errors).toHaveLength(0);

    const index = readIndexFile(projectDir);
    const map = index.mappings["doc-real-widget"]!;
    expect(map.human_id).toBe("KN-002");
    // Base and -2 were both pre-claimed — must land on -3.
    expect(map.file_path).toBe(`${dir}/KN-002-widget-3.md`);

    expect(result.value.created).toContain(map.file_path);
    const body = extractBody(readFileSync(join(projectDir, map.file_path), "utf8"));
    expect(body).toBe(canonicaliseBody("# Widget\n\nReal widget body."));
  });
});

// ─── ERROR: allocation exhaustion after 999 attempts fails loud ──────────────

describe("ERROR — allocateUniqueFilePath fails loud (VALIDATION_ERROR) after 999 exhausted attempts", () => {
  it("when every candidate slot from base through -999 is already claimed, exportDocs returns err(VALIDATION_ERROR) naming 'file_path', and writes nothing", async () => {
    const store = new InMemoryStore();
    const service = makeExportService(store);
    const projectDir = makeTempProjectDir();

    const dir = "docs/requirements/knowledge";
    // Pre-claim the base path plus every -2..-999 suffix candidate for KN-002 —
    // exactly the 999 attempts allocateUniqueFilePath will make.
    const mappings: ExportIndex["mappings"] = {
      "orphan-0": { human_id: "KN-001", file_path: `${dir}/KN-002-widget.md` },
    };
    for (let n = 2; n <= 999; n++) {
      mappings[`orphan-${n}`] = { human_id: "KN-001", file_path: `${dir}/KN-002-widget-${n}.md` };
    }
    const preRunIndex: ExportIndex = { version: 1, mappings };
    writeIndexFile(projectDir, preRunIndex);

    await insertDoc(store, makeDoc({
      id: "doc-real-widget-exhausted",
      type: "knowledge",
      title: "Widget",
      slug: "knowledge-widget-exhausted",
      content: "# Widget\n\nReal widget body.",
    }));

    const result = await service.exportDocs({ projectDir, dryRun: false });

    // Must be a top-level err() — never a silent partial report.
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    if (result.error.code === "VALIDATION_ERROR") {
      expect(result.error.field).toBe("file_path");
      expect(result.error.message).toContain("999");
      expect(result.error.message).toContain("KN-002");
    }

    // Nothing was written: no new file, and the index on disk is byte-for-byte
    // the exhausted fixture we pre-wrote (save happens only after a successful
    // Phase 1 index build).
    const noFile = join(projectDir, `${dir}/KN-002-widget.md`);
    expect(existsSync(noFile)).toBe(false);
    const indexOnDisk = readIndexFile(projectDir);
    expect(Object.keys(indexOnDisk.mappings)).toHaveLength(999);
    expect(indexOnDisk.mappings["doc-real-widget-exhausted"]).toBeUndefined();
  });
});

// ─── REGRESSION: existing behaviors unchanged by the collision fix ───────────

describe("REGRESSION — clean corpus still exports clean; real body drift still fires (unaffected by the collision fix)", () => {
  it("a corpus with no title duplicates and no index corruption exports with zero repaired entries", async () => {
    const store = new InMemoryStore();
    const service = makeExportService(store);
    const projectDir = makeTempProjectDir();

    await insertDoc(store, makeDoc({
      id: "doc-regress-clean-1",
      type: "spec",
      title: "Clean Spec One",
      slug: "spec-clean-spec-one",
    }));
    await insertDoc(store, makeDoc({
      id: "doc-regress-clean-2",
      type: "spec",
      title: "Clean Spec Two",
      slug: "spec-clean-spec-two",
    }));

    const result = await service.exportDocs({ projectDir, dryRun: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.created).toHaveLength(2);
    expect(result.value.repaired).toHaveLength(0);
    expect(result.value.errors).toHaveLength(0);
    expect(result.value.drift).toHaveLength(0);
  });

  it("real body drift (on-disk file hand-edited to differ from corpus) still reports drift[] — not masked or auto-repaired by the collision fix", async () => {
    const store = new InMemoryStore();
    const service = makeExportService(store);
    const projectDir = makeTempProjectDir();

    const originalBody = "# Regression Drift Spec\n\nOriginal canonical body.";
    await insertDoc(store, makeDoc({
      id: "doc-regress-drift",
      type: "spec",
      title: "Regression Drift Spec",
      slug: "spec-regression-drift-spec",
      content: originalBody,
    }));

    const first = await service.exportDocs({ projectDir, dryRun: false });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const filePath = first.value.created[0]!;
    const absPath = join(projectDir, filePath);

    const original = readFileSync(absPath, "utf8");
    writeFileSync(absPath, original.replace("Original canonical body", "HAND-EDITED body"), "utf8");

    const second = await service.exportDocs({ projectDir, dryRun: false });
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(second.value.drift).toEqual([filePath]);
    expect(second.value.repaired).toHaveLength(0);
    expect(second.value.created).toHaveLength(0);

    // File must remain the hand-edited version — drift is reported, not fixed.
    const after = readFileSync(absPath, "utf8");
    expect(after).toContain("HAND-EDITED body");
  });
});
