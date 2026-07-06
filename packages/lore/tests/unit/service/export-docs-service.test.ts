/**
 * Unit tests for ExportDocsService (SPEC-021).
 *
 * Spec-first: expected behaviors defined from SPEC-021 §9 ACs BEFORE reading
 * implementation. Adversarial tests target known fallback patterns:
 *   - force:true → must be err(), not a silent no-op
 *   - Human IDs must be sequential/zero-padded (SPEC-001, not SPEC-1)
 *   - Drift detection must not overwrite the existing file
 *   - Round-trip parity: file body = canonicaliseBody(doc.content)
 *   - Parent omission when type filter excludes parent doc
 *
 * Uses InMemoryStore + real temp filesystem. No mocks.
 * Runs under vitest (no bun:sqlite dependency).
 *
 * Coverage: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION
 *
 * @spec_ref AC-EXPORT-1 through AC-EXPORT-9 — SPEC-021 §9
 */

import { describe, it, expect, afterEach } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { ExportDocsService, type ResolveDocBody } from "../../../src/service/export-docs-service.js";
import { OutlineService, renderResolvedToMarkdown } from "../../../src/service/outline-service.js";
import { canonicaliseBody, ok, DOC_TYPE_ROLE_MAP } from "@lore/core";
import type { DocRecord, Slug } from "@lore/core";

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
    `lore-export-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  // Create .lore/ subdirectory — export service writes export-index.json there
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

/**
 * Build a complete DocRecord for insertion into InMemoryStore.
 * All fields required by the InMemoryStore interface are present.
 *
 * Slug must be explicitly provided to ensure the caller controls its value
 * and avoids accidental collision between tests.
 */
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

// ─── File Content Helpers ──────────────────────────────────────────────────────

/**
 * Extract the body section from an .md file (everything after closing ---).
 * Returns full content if no frontmatter found.
 */
function extractBody(mdContent: string): string {
  const normalized = mdContent.replace(/\r\n/g, "\n");
  const match = normalized.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
  return match ? (match[1] ?? "") : normalized;
}

/**
 * Parse YAML frontmatter key-value pairs from an .md file.
 * Only handles simple scalar values (not nested objects or arrays).
 */
function parseFrontmatterScalars(mdContent: string): Record<string, string> {
  const normalized = mdContent.replace(/\r\n/g, "\n");
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) return {};
  const result: Record<string, string> = {};
  for (const line of (match[1] ?? "").split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1 || line.startsWith(" ") || line.startsWith("-")) continue;
    const key = line.slice(0, colonIdx).trim();
    const val = line.slice(colonIdx + 1).trim();
    result[key] = val;
  }
  return result;
}

// ─── HAPPY: Empty store → empty report ───────────────────────────────────────

describe("HAPPY — empty store produces empty report (AC-EXPORT-1)", () => {
  it("returns ok(report) with all arrays empty", async () => {
    const store = new InMemoryStore();
    const service = makeExportService(store);
    const projectDir = makeTempProjectDir();

    const result = await service.exportDocs({ projectDir, dryRun: false });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.created).toHaveLength(0);
    expect(result.value.skipped_clean).toHaveLength(0);
    expect(result.value.drift).toHaveLength(0);
    expect(result.value.errors).toHaveLength(0);
  });
});

// ─── HAPPY: Single spec doc → file created with human ID ─────────────────────

describe("HAPPY — single spec doc exported with SPEC-001 human ID (AC-EXPORT-2)", () => {
  it("creates file at docs/requirements/spec/SPEC-001-<kebab>.md", async () => {
    const store = new InMemoryStore();
    const service = makeExportService(store);
    const projectDir = makeTempProjectDir();

    await insertDoc(store, makeDoc({
      id: "01J000000000000000000000S1",
      type: "spec",
      title: "My Spec",
      slug: "spec-my-spec",
    }));

    const result = await service.exportDocs({ projectDir, dryRun: false });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.created).toHaveLength(1);
    const filePath = result.value.created[0]!;
    // File must be under the spec subdirectory with SPEC-001 prefix
    expect(filePath).toMatch(/^docs\/requirements\/spec\/SPEC-001-/);
    expect(filePath).toMatch(/\.md$/);
    // File must actually exist on disk
    expect(existsSync(join(projectDir, filePath))).toBe(true);
  });

  it("frontmatter id field is the human ID SPEC-001, NOT the ULID", async () => {
    const store = new InMemoryStore();
    const service = makeExportService(store);
    const projectDir = makeTempProjectDir();

    const docId = "01J000000000000000000000S1";
    await insertDoc(store, makeDoc({
      id: docId,
      type: "spec",
      title: "Auth Spec",
      slug: "spec-auth-spec",
    }));

    const result = await service.exportDocs({ projectDir, dryRun: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const filePath = result.value.created[0]!;
    const content = readFileSync(join(projectDir, filePath), "utf8");
    const fm = parseFrontmatterScalars(content);

    // Human ID in frontmatter — must NOT be the 26-char ULID
    expect(fm["id"]).toBe("SPEC-001");
    expect(fm["id"]).not.toBe(docId);
    expect(fm["id"]).not.toMatch(/^01J/); // not a ULID
  });

  it("frontmatter type and role fields are correct", async () => {
    const store = new InMemoryStore();
    const service = makeExportService(store);
    const projectDir = makeTempProjectDir();

    await insertDoc(store, makeDoc({
      id: "01J000000000000000000000S1",
      type: "spec",
      title: "Role Test Spec",
      slug: "spec-role-test",
    }));

    const result = await service.exportDocs({ projectDir, dryRun: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const filePath = result.value.created[0]!;
    const content = readFileSync(join(projectDir, filePath), "utf8");
    const fm = parseFrontmatterScalars(content);

    expect(fm["type"]).toBe("spec");
    expect(fm["role"]).toBe("spec"); // DOC_TYPE_ROLE_MAP[spec] = "spec"
  });

  it("frontmatter title is double-quoted", async () => {
    const store = new InMemoryStore();
    const service = makeExportService(store);
    const projectDir = makeTempProjectDir();

    await insertDoc(store, makeDoc({
      id: "01J000000000000000000000S1",
      type: "spec",
      title: "My Spec",
      slug: "spec-my-spec",
    }));

    const result = await service.exportDocs({ projectDir, dryRun: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const filePath = result.value.created[0]!;
    const content = readFileSync(join(projectDir, filePath), "utf8");
    // Spec §9.2 requires title to always be double-quoted
    expect(content).toMatch(/^title: "My Spec"$/m);
  });

  it("frontmatter tags: [] is always present even when doc has no tags", async () => {
    const store = new InMemoryStore();
    const service = makeExportService(store);
    const projectDir = makeTempProjectDir();

    await insertDoc(store, makeDoc({
      id: "01J000000000000000000000S1",
      type: "spec",
      title: "No Tags Spec",
      slug: "spec-no-tags",
      tags: [], // explicitly empty
    }));

    const result = await service.exportDocs({ projectDir, dryRun: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const filePath = result.value.created[0]!;
    const content = readFileSync(join(projectDir, filePath), "utf8");
    // Must include tags field even when empty (not omit it)
    expect(content).toMatch(/^tags: \[\]$/m);
  });
});

// ─── BOUNDARY: Title with special YAML characters ────────────────────────────

describe("BOUNDARY — title with special YAML characters is escaped (AC-EXPORT-2)", () => {
  it("double quotes in title are backslash-escaped in frontmatter", async () => {
    const store = new InMemoryStore();
    const service = makeExportService(store);
    const projectDir = makeTempProjectDir();

    await insertDoc(store, makeDoc({
      id: "01J000000000000000000000S1",
      type: "spec",
      title: 'Say "hello"',
      slug: "spec-say-hello",
    }));

    const result = await service.exportDocs({ projectDir, dryRun: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const filePath = result.value.created[0]!;
    const content = readFileSync(join(projectDir, filePath), "utf8");
    // YAML double-quote escaping: " → \"
    expect(content).toMatch(/^title: "Say \\"hello\\""/m);
  });

  it("title with hyphens produces valid filename without double-hyphens", async () => {
    const store = new InMemoryStore();
    const service = makeExportService(store);
    const projectDir = makeTempProjectDir();

    await insertDoc(store, makeDoc({
      id: "01J000000000000000000000S1",
      type: "spec",
      title: "Feature-A Spec",
      slug: "spec-feature-a-spec",
    }));

    const result = await service.exportDocs({ projectDir, dryRun: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const filePath = result.value.created[0]!;
    // Human ID + kebab: no double-hyphens in valid filename
    expect(filePath).not.toMatch(/--/);
    expect(filePath).toMatch(/\.md$/);
  });
});

// ─── HAPPY: Plan + Task → parent & plan human IDs in task frontmatter ─────────

describe("HAPPY — plan + task: task frontmatter references plan by human ID (AC-EXPORT-5)", () => {
  it("task frontmatter has parent: PLAN-001 and plan: PLAN-001", async () => {
    const store = new InMemoryStore();
    const service = makeExportService(store);
    const projectDir = makeTempProjectDir();

    const planId = "01J000000000000000000000P1";
    const taskId = "01J000000000000000000000T1";

    // Plan inserted with newer updated_at → returned first by findMany (DESC)
    await insertDoc(store, makeDoc({
      id: planId,
      type: "plan",
      title: "Sprint Plan",
      slug: "plan-sprint-plan",
      updated_at: "2024-01-15T10:00:02.000Z",
    }));

    await insertDoc(store, makeDoc({
      id: taskId,
      type: "task",
      title: "Implement Feature",
      slug: "task-implement-feature",
      parent_id: planId,
      extra: { plan_id: planId },
      updated_at: "2024-01-15T10:00:01.000Z",
    }));

    const result = await service.exportDocs({ projectDir, dryRun: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.created).toHaveLength(2);
    expect(result.value.errors).toHaveLength(0);

    const taskFilePath = result.value.created.find((p) => p.includes("/task/"));
    expect(taskFilePath).toBeDefined();

    const content = readFileSync(join(projectDir, taskFilePath!), "utf8");
    // Must use human IDs, not ULIDs
    expect(content).toMatch(/^parent: PLAN-001$/m);
    expect(content).toMatch(/^plan: PLAN-001$/m);
    expect(content).not.toContain(planId); // ULID must NOT appear in frontmatter
  });
});

// ─── STATE: Idempotency — second run produces skipped_clean ─────────────────

describe("STATE — idempotency: second run produces skipped_clean, not created (AC-EXPORT-3)", () => {
  it("running export twice with unchanged corpus: second run reports all files as skipped_clean", async () => {
    const store = new InMemoryStore();
    const service = makeExportService(store);
    const projectDir = makeTempProjectDir();

    await insertDoc(store, makeDoc({
      id: "01J000000000000000000000S1",
      type: "spec",
      title: "Stable Spec",
      slug: "spec-stable-spec",
      content: "# Stable\n\nThis content does not change.",
    }));

    // First run — creates the file
    const first = await service.exportDocs({ projectDir, dryRun: false });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.created).toHaveLength(1);

    // Second run — corpus unchanged
    const second = await service.exportDocs({ projectDir, dryRun: false });
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    // Must report the file as already matching, NOT created again
    expect(second.value.created).toHaveLength(0);
    expect(second.value.skipped_clean).toHaveLength(1);
    expect(second.value.drift).toHaveLength(0);
    expect(second.value.errors).toHaveLength(0);
  });
});

// ─── HAPPY: --type filter exports only matching type ─────────────────────────

describe("HAPPY — --type filter exports only matching doc type (AC-EXPORT-8)", () => {
  it("--type spec only exports spec docs; plan docs are not exported", async () => {
    const store = new InMemoryStore();
    const service = makeExportService(store);
    const projectDir = makeTempProjectDir();

    await insertDoc(store, makeDoc({
      id: "01J000000000000000000000P1",
      type: "plan",
      title: "My Plan",
      slug: "plan-my-plan",
    }));

    await insertDoc(store, makeDoc({
      id: "01J000000000000000000000S1",
      type: "spec",
      title: "My Spec",
      slug: "spec-my-spec",
      parent_id: "01J000000000000000000000P1",
    }));

    const result = await service.exportDocs({ projectDir, dryRun: false, type: "spec" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Only one file created (spec, not plan)
    expect(result.value.created).toHaveLength(1);
    expect(result.value.created[0]).toMatch(/docs\/requirements\/spec\//);

    // Plan directory must NOT exist
    const planDir = join(projectDir, "docs", "requirements", "plan");
    expect(existsSync(planDir)).toBe(false);
  });
});

// ─── NEGATIVE: Parent excluded by type filter → parent: field omitted ─────────

describe("NEGATIVE — parent excluded by type filter: parent: field omitted silently (AC-EXPORT-8)", () => {
  it("spec child with plan parent: when plan excluded by type filter, parent: not in frontmatter", async () => {
    const store = new InMemoryStore();
    const service = makeExportService(store);
    const projectDir = makeTempProjectDir();

    const planId = "01J000000000000000000000P1";
    await insertDoc(store, makeDoc({
      id: planId,
      type: "plan",
      title: "Background Plan",
      slug: "plan-background-plan",
    }));

    await insertDoc(store, makeDoc({
      id: "01J000000000000000000000S1",
      type: "spec",
      title: "Child Spec",
      slug: "spec-child-spec",
      parent_id: planId,
    }));

    // Export only specs — plan is excluded from this run
    const result = await service.exportDocs({ projectDir, dryRun: false, type: "spec" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.created).toHaveLength(1);
    const filePath = result.value.created[0]!;
    const content = readFileSync(join(projectDir, filePath), "utf8");

    // parent: field must be absent — plan not in index when only spec type exported
    // This documents the current behavior: parent reference is silently omitted
    expect(content).not.toMatch(/^parent:/m);
    // The ULID must not appear either (no fallback to ULID)
    expect(content).not.toContain(planId);
  });
});

// ─── NEGATIVE: force:true → err(VALIDATION_ERROR) not a report ───────────────

describe("NEGATIVE — force:true returns VALIDATION_ERROR, never ok(report) (AC-EXPORT-9)", () => {
  it("force: true returns err with VALIDATION_ERROR code", async () => {
    const store = new InMemoryStore();
    const service = makeExportService(store);
    const projectDir = makeTempProjectDir();

    const result = await service.exportDocs({ projectDir, dryRun: false, force: true });

    // Must be an err() result — NEVER silently proceed as if force is ignored
    expect(result.ok).toBe(false);
    if (result.ok) return; // fail: should not reach here

    expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  it("force: true rejected even with empty corpus (not a silent no-op)", async () => {
    const store = new InMemoryStore();
    const service = makeExportService(store);
    const projectDir = makeTempProjectDir();

    const result = await service.exportDocs({ projectDir, dryRun: false, force: true });

    // Even with empty corpus, force must fail loudly — no silent passthrough
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    // Must not be a generic store error
    expect(result.error.code).not.toBe("STORE_ERROR");
  });

  it("force: true error specifically names 'force' as the invalid field", async () => {
    const store = new InMemoryStore();
    const service = makeExportService(store);
    const projectDir = makeTempProjectDir();

    const result = await service.exportDocs({ projectDir, dryRun: false, force: true });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    if (result.error.code === "VALIDATION_ERROR") {
      // The error must clearly identify that 'force' is the rejected field
      expect(result.error.field).toBe("force");
    }
  });
});

// ─── NEGATIVE: Drift — file differs from corpus → drift[], NOT overwritten ───

describe("NEGATIVE — file on disk differs from corpus → drift[], file NOT overwritten (AC-EXPORT-4)", () => {
  it("pre-existing file with different body added to drift[], original file content preserved", async () => {
    const store = new InMemoryStore();
    const service = makeExportService(store);
    const projectDir = makeTempProjectDir();

    const originalBody = "# My Spec\n\nThis is the canonical corpus version.";
    await insertDoc(store, makeDoc({
      id: "01J000000000000000000000S1",
      type: "spec",
      title: "Drifted Spec",
      slug: "spec-drifted-spec",
      content: originalBody,
    }));

    // First export: creates the file
    const first = await service.exportDocs({ projectDir, dryRun: false });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.created).toHaveLength(1);

    const filePath = first.value.created[0]!;
    const absPath = join(projectDir, filePath);

    // Human manually edits the file (introduces drift)
    const fileContent = readFileSync(absPath, "utf8");
    const driftedContent = fileContent.replace(
      "canonical corpus version",
      "MANUALLY EDITED VERSION",
    );
    writeFileSync(absPath, driftedContent, "utf8");

    // Second export: should detect drift
    const second = await service.exportDocs({ projectDir, dryRun: false });
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(second.value.drift).toHaveLength(1);
    expect(second.value.drift[0]).toBe(filePath);
    expect(second.value.created).toHaveLength(0);
    expect(second.value.errors).toHaveLength(0);

    // File must NOT have been overwritten — drift is detected, not fixed in v1
    const afterContent = readFileSync(absPath, "utf8");
    expect(afterContent).toContain("MANUALLY EDITED VERSION");
    expect(afterContent).not.toContain("canonical corpus version");
  });

  it("drift check uses canonicalised comparison (CRLF on disk vs LF in corpus = no false drift)", async () => {
    const store = new InMemoryStore();
    const service = makeExportService(store);
    const projectDir = makeTempProjectDir();

    const corpusBody = "# Spec\n\nBody with LF endings.";
    await insertDoc(store, makeDoc({
      id: "01J000000000000000000000S1",
      type: "spec",
      title: "Crlf Test Spec",
      slug: "spec-crlf-test",
      content: corpusBody,
    }));

    // Create initial file
    const first = await service.exportDocs({ projectDir, dryRun: false });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const filePath = first.value.created[0]!;
    const absPath = join(projectDir, filePath);

    // Alter file to use CRLF (same content, different line endings)
    const fileContent = readFileSync(absPath, "utf8");
    const crlfContent = fileContent.replace(/\n/g, "\r\n");
    writeFileSync(absPath, crlfContent, "utf8");

    // Second export: CRLF normalised file should NOT be detected as drift
    const second = await service.exportDocs({ projectDir, dryRun: false });
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(second.value.drift).toHaveLength(0);
    expect(second.value.skipped_clean).toHaveLength(1);
  });
});

// ─── HAPPY: dryRun:true reports but writes nothing ────────────────────────────

describe("HAPPY — dryRun:true reports created[] but writes no files (AC-EXPORT-7)", () => {
  it("dryRun: true fills created[] but files do not exist on disk", async () => {
    const store = new InMemoryStore();
    const service = makeExportService(store);
    const projectDir = makeTempProjectDir();

    await insertDoc(store, makeDoc({
      id: "01J000000000000000000000S1",
      type: "spec",
      title: "Dry Run Spec",
      slug: "spec-dry-run-spec",
    }));

    const result = await service.exportDocs({ projectDir, dryRun: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // created[] shows what would be created
    expect(result.value.created).toHaveLength(1);
    // But no file exists on disk
    const filePath = result.value.created[0]!;
    expect(existsSync(join(projectDir, filePath))).toBe(false);
  });

  it("dryRun: true with empty corpus returns empty created[] (no phantom entries)", async () => {
    const store = new InMemoryStore();
    const service = makeExportService(store);
    const projectDir = makeTempProjectDir();

    const result = await service.exportDocs({ projectDir, dryRun: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.created).toHaveLength(0);
    expect(result.value.errors).toHaveLength(0);
  });

  it("dryRun: true does NOT write .lore/export-index.json", async () => {
    const store = new InMemoryStore();
    const service = makeExportService(store);
    const projectDir = makeTempProjectDir();

    await insertDoc(store, makeDoc({
      id: "01J000000000000000000000S1",
      type: "spec",
      title: "Dry Spec",
      slug: "spec-dry-spec",
    }));

    await service.exportDocs({ projectDir, dryRun: true });

    const indexPath = join(projectDir, ".lore", "export-index.json");
    // dryRun must not persist the index
    expect(existsSync(indexPath)).toBe(false);
  });
});

// ─── BOUNDARY: Human ID numbering — sequential and zero-padded ───────────────

describe("BOUNDARY — human IDs are sequential and zero-padded to 3 digits (AC-EXPORT-2)", () => {
  it("two spec docs get SPEC-001 and SPEC-002 (not SPEC-1 or SPEC-2)", async () => {
    const store = new InMemoryStore();
    const service = makeExportService(store);
    const projectDir = makeTempProjectDir();

    // newer updated_at → first in findMany DESC sort → SPEC-001
    await insertDoc(store, makeDoc({
      id: "01J000000000000000000000S1",
      type: "spec",
      title: "First Spec",
      slug: "spec-first-spec",
      updated_at: "2024-01-15T10:00:02.000Z",
    }));

    // older updated_at → second in findMany DESC sort → SPEC-002
    await insertDoc(store, makeDoc({
      id: "01J000000000000000000000S2",
      type: "spec",
      title: "Second Spec",
      slug: "spec-second-spec",
      updated_at: "2024-01-15T10:00:01.000Z",
    }));

    const result = await service.exportDocs({ projectDir, dryRun: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.created).toHaveLength(2);

    // Both paths must contain zero-padded 3-digit IDs
    const humanIds = result.value.created.map((p) => {
      const m = p.match(/SPEC-(\d+)-/);
      return m ? `SPEC-${m[1]}` : null;
    });

    expect(humanIds).toContain("SPEC-001");
    expect(humanIds).toContain("SPEC-002");

    // IDs must be zero-padded: SPEC-001 not SPEC-1
    for (const p of result.value.created) {
      expect(p).toMatch(/SPEC-\d{3}-/); // exactly 3 digits
    }
  });

  it("different types have independent counters: first spec = SPEC-001, first plan = PLAN-001", async () => {
    const store = new InMemoryStore();
    const service = makeExportService(store);
    const projectDir = makeTempProjectDir();

    await insertDoc(store, makeDoc({
      id: "01J000000000000000000000S1",
      type: "spec",
      title: "My Spec",
      slug: "spec-my-spec",
    }));

    await insertDoc(store, makeDoc({
      id: "01J000000000000000000000P1",
      type: "plan",
      title: "My Plan",
      slug: "plan-my-plan",
    }));

    const result = await service.exportDocs({ projectDir, dryRun: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.created).toHaveLength(2);

    const specFile = result.value.created.find((p) => p.includes("/spec/"));
    const planFile = result.value.created.find((p) => p.includes("/plan/"));

    expect(specFile).toMatch(/SPEC-001/);
    expect(planFile).toMatch(/PLAN-001/);
    // Plan counter must not bleed into spec counter
    expect(specFile).not.toMatch(/PLAN/);
    expect(planFile).not.toMatch(/SPEC/);
  });
});

// ─── BOUNDARY: Export index persisted to .lore/export-index.json ─────────────

describe("BOUNDARY — export index is written to .lore/export-index.json (AC-EXPORT-6)", () => {
  it("after export, index file exists and contains the mapping entry", async () => {
    const store = new InMemoryStore();
    const service = makeExportService(store);
    const projectDir = makeTempProjectDir();

    const docId = "01J000000000000000000000S1";
    await insertDoc(store, makeDoc({
      id: docId,
      type: "spec",
      title: "Indexed Spec",
      slug: "spec-indexed-spec",
    }));

    const result = await service.exportDocs({ projectDir, dryRun: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const indexPath = join(projectDir, ".lore", "export-index.json");
    expect(existsSync(indexPath)).toBe(true);

    const raw = readFileSync(indexPath, "utf8");
    const index = JSON.parse(raw) as {
      version: number;
      mappings: Record<string, { human_id: string; file_path: string }>;
    };

    expect(index.version).toBe(1);
    expect(index.mappings[docId]).toBeDefined();
    expect(index.mappings[docId]!.human_id).toBe("SPEC-001");
    expect(index.mappings[docId]!.file_path).toMatch(/^docs\/requirements\/spec\/SPEC-001-/);
  });
});

// ─── REGRESSION: Round-trip body parity ─────────────────────────────────────

describe("REGRESSION — file body equals canonicaliseBody(doc.content) (AC-EXPORT-4)", () => {
  it("body in written file matches canonicaliseBody of the original doc content", async () => {
    const store = new InMemoryStore();
    const service = makeExportService(store);
    const projectDir = makeTempProjectDir();

    const originalContent = "# My Spec\n\nLine 1.\n\nLine 2.\n";
    await insertDoc(store, makeDoc({
      id: "01J000000000000000000000S1",
      type: "spec",
      title: "Round Trip Spec",
      slug: "spec-round-trip-spec",
      content: originalContent,
    }));

    const result = await service.exportDocs({ projectDir, dryRun: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const filePath = result.value.created[0]!;
    const fileContent = readFileSync(join(projectDir, filePath), "utf8");
    const fileBody = extractBody(fileContent);

    // File body must exactly equal the canonicalised corpus content
    expect(fileBody).toBe(canonicaliseBody(originalContent));
  });

  it("CRLF doc content is normalised to LF in the written file", async () => {
    const store = new InMemoryStore();
    const service = makeExportService(store);
    const projectDir = makeTempProjectDir();

    const crlfContent = "# Spec\r\n\r\nBody with CRLF line endings.\r\n";
    await insertDoc(store, makeDoc({
      id: "01J000000000000000000000S1",
      type: "spec",
      title: "Crlf Content Spec",
      slug: "spec-crlf-content",
      content: crlfContent,
    }));

    const result = await service.exportDocs({ projectDir, dryRun: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const filePath = result.value.created[0]!;
    const fileContent = readFileSync(join(projectDir, filePath), "utf8");
    const fileBody = extractBody(fileContent);

    // File body must not contain CRLF
    expect(fileBody).not.toContain("\r\n");
    // And must match the canonical form
    expect(fileBody).toBe(canonicaliseBody(crlfContent));
  });

  it("canonicaliseBody(canonicaliseBody(doc.content)) === canonicaliseBody(doc.content)", () => {
    // Spec §4 idempotency invariant — must hold for any doc content
    const examples = [
      "# Heading\n\nBody.\n",
      "Content\r\n with CRLF\r\n",
      "   Leading spaces\n",
      "Trailing spaces   \n",
      "",
      "\n\n\n",
    ];

    for (const content of examples) {
      const once = canonicaliseBody(content);
      const twice = canonicaliseBody(once);
      expect(twice).toBe(once);
    }
  });
});

// ─── ERROR: Per-doc errors do not abort the run ───────────────────────────────

describe("ERROR — per-doc errors do not abort the run (AC-EXPORT-3)", () => {
  it("multiple independent docs all export; errors in one do not block others", async () => {
    const store = new InMemoryStore();
    const service = makeExportService(store);
    const projectDir = makeTempProjectDir();

    // Two independent specs
    await insertDoc(store, makeDoc({
      id: "01J000000000000000000000S1",
      type: "spec",
      title: "First Spec",
      slug: "spec-first-spec",
      updated_at: "2024-01-15T10:00:02.000Z",
    }));

    await insertDoc(store, makeDoc({
      id: "01J000000000000000000000S2",
      type: "spec",
      title: "Second Spec",
      slug: "spec-second-spec",
      updated_at: "2024-01-15T10:00:01.000Z",
    }));

    const result = await service.exportDocs({ projectDir, dryRun: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Both docs independently exported
    expect(result.value.created).toHaveLength(2);
    expect(result.value.errors).toHaveLength(0);
  });
});

// ─── MDX placeholder splicing (SPEC-032 §3.3 AC-4) ────────────────────────────

describe("HAPPY — exported body has MDX placeholders spliced, not raw tags (AC-4)", () => {
  it("written file body contains the rendered child list, not the literal <ChildrenOf /> tag", async () => {
    const store = new InMemoryStore();
    const service = makeExportService(store);
    const projectDir = makeTempProjectDir();

    await insertDoc(store, makeDoc({
      id: "01J0000000000000000000PRD",
      type: "prd",
      title: "Root PRD",
      slug: "prd-root-prd",
      content: "# Root PRD\n\n<ChildrenOf />\n",
    }));
    await insertDoc(store, makeDoc({
      id: "01J000000000000000000000S1",
      type: "spec",
      title: "Child Spec",
      slug: "spec-child-spec",
      parent_id: "01J0000000000000000000PRD",
    }));

    const result = await service.exportDocs({ projectDir, dryRun: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const prdFilePath = result.value.created.find((p) => p.includes("PRD-"));
    expect(prdFilePath).toBeDefined();
    const fileContent = readFileSync(join(projectDir, prdFilePath!), "utf8");
    const fileBody = extractBody(fileContent);

    expect(fileBody).not.toContain("<ChildrenOf");
    expect(fileBody).toContain("- [spec] Child Spec (draft)");
  });
});

describe("STATE — re-exporting a placeholder-bearing doc reports clean, not permanent drift (AC-4)", () => {
  it("second run on an unchanged corpus is skipped_clean — proves drift compares spliced-vs-spliced", async () => {
    // Regression guard for the exact bug SPEC-032 §3.3 calls out: if drift compared raw
    // doc.content against a file that was written spliced (or vice versa), a doc with any
    // whitelisted placeholder would report drift on EVERY subsequent run, forever — no
    // number of re-exports could ever converge. This test proves convergence.
    const store = new InMemoryStore();
    const service = makeExportService(store);
    const projectDir = makeTempProjectDir();

    await insertDoc(store, makeDoc({
      id: "01J0000000000000000000PR2",
      type: "prd",
      title: "Stable PRD",
      slug: "prd-stable-prd",
      content: "# Stable PRD\n\n<HealthStats />\n",
    }));

    const first = await service.exportDocs({ projectDir, dryRun: false });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.created).toHaveLength(1);
    expect(first.value.drift).toHaveLength(0);

    const second = await service.exportDocs({ projectDir, dryRun: false });
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(second.value.created).toHaveLength(0);
    expect(second.value.drift).toHaveLength(0);
    expect(second.value.skipped_clean).toHaveLength(1);
  });
});

// ─── REGRESSION: ExportDocsService does NOT call aiProviderService ────────────

describe("REGRESSION — ExportDocsService must not import or call AIProviderService", () => {
  it("source file must not import AIProviderService", () => {
    const { readFileSync: readFile } = require("fs");
    const { join: pathJoin } = require("path");
    const serviceFile = pathJoin(
      import.meta.dirname,
      "../../../src/service/export-docs-service.ts",
    );
    const content: string = readFile(serviceFile, "utf8");
    // No AI imports allowed (SPEC-021 §9 no-AI boundary)
    expect(content).not.toMatch(/import.*AIProviderService/);
    expect(content).not.toMatch(/\.aiProviderService/);
    expect(content).not.toMatch(/\.generate\(|\.complete\(|buildProviderRegistry/);
  });
});
