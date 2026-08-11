/**
 * Unit tests for ExportDocsService (SPEC-021).
 *
 * Spec-first: expected behaviors defined from SPEC-021 §9 ACs BEFORE reading
 * implementation. Adversarial tests target known fallback patterns:
 *   - force:true on a drifted file → overwrites with the CURRENT expected content and
 *     reports it in report.overwritten, never report.drift (SPEC-021 Amendment A2)
 *   - force omitted/false → drift is reported but the file is NEVER overwritten
 *   - Human IDs must be sequential/zero-padded (SPEC-001, not SPEC-1)
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
    // SPEC-084 T5 — ordinal is optional on DocRecord and omitted entirely (rather than
    // spread as `undefined`) when the caller doesn't pass one, matching every pre-existing
    // fixture in this file (which never set it and must keep exercising the pre-migration
    // NULL-ordinal legacy fallback path unchanged).
    ...(overrides.ordinal !== undefined ? { ordinal: overrides.ordinal } : {}),
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

// ─── REGRESSION: SPEC-038 §6 — AC checklist projection is drift-stable ─────────

describe("REGRESSION — a spec with declared acceptance criteria exports without drift false positives (SPEC-038 AC-ACODE-9)", () => {
  it("two consecutive exports of an unchanged AC-bearing spec both report skipped_clean, never drift", async () => {
    // Guards against the 2026-07-07 "export-docs drift-check false positives" incident
    // class: the AC checklist appended by renderResolvedToMarkdown (SPEC-038 §6) must be
    // a pure function of (doc.extra.acceptance_criteria, plan/task evidence state) — if it
    // were non-deterministic (e.g. Map iteration order, wall-clock), a second run against
    // the SAME corpus state would report false drift.
    const store = new InMemoryStore();
    const service = makeExportService(store);
    const projectDir = makeTempProjectDir();

    const spec = makeDoc({
      id: "01J000000000000000000000AC",
      type: "spec",
      title: "AC-Bearing Spec",
      slug: "spec-ac-bearing-spec",
      content: "# AC-Bearing Spec\n\nBody text.",
      extra: {
        acceptance_criteria: [
          { id: "AC-1", statement: "First criterion", verify: { mode: "script", oracle: "test", command: "bun test" } },
          { id: "AC-2", statement: "Second criterion", verify: { mode: "ai", rubric: "Judge on correctness" } },
        ],
      },
    });
    await insertDoc(store, spec);

    const plan = makeDoc({
      id: "01J000000000000000000000PL",
      type: "plan",
      title: "AC Plan",
      slug: "plan-ac-plan",
      parent_id: spec.id,
    });
    await insertDoc(store, plan);

    const task = makeDoc({
      id: "01J000000000000000000000TK",
      type: "task",
      title: "AC Task",
      slug: "task-ac-task",
      parent_id: plan.id,
      extra: {
        plan_id: plan.id,
        verification_evidence: [
          {
            oracle: "test",
            command: "bun test",
            result: "pass",
            recorded_at: "2026-07-08T00:00:00.000Z",
            recorded_by: "alice",
            ac_ref: "AC-1",
          },
        ],
      },
    });
    await insertDoc(store, task);

    const first = await service.exportDocs({ projectDir, dryRun: false });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.created.length).toBeGreaterThan(0);
    expect(first.value.drift).toHaveLength(0);

    const specFilePath = first.value.created.find((p) => p.includes("/spec/"));
    expect(specFilePath).toBeDefined();
    if (specFilePath === undefined) return;
    const firstBody = readFileSync(join(projectDir, specFilePath), "utf8");
    expect(firstBody).toContain("## Acceptance Criteria (structured)");
    expect(firstBody).toContain("- [✔] [script] AC-1: First criterion");
    expect(firstBody).toContain("- [·] [ai] AC-2: Second criterion");

    // Second export against the SAME unchanged corpus state — must be clean.
    const second = await service.exportDocs({ projectDir, dryRun: false });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.drift).toHaveLength(0);
    expect(second.value.errors).toHaveLength(0);
    expect(second.value.skipped_clean.length).toBeGreaterThan(0);

    const secondBody = readFileSync(join(projectDir, specFilePath), "utf8");
    expect(secondBody).toBe(firstBody);
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

// ─── force: true overwrites drift with the current expected content (Amendment A2) ──

describe("HAPPY — force: true overwrites a drifted (hand-edited) file (AC-EXPORT-9 / Amendment A2)", () => {
  it("drifted file is overwritten, reported in overwritten[] not drift[], content matches corpus", async () => {
    const store = new InMemoryStore();
    const service = makeExportService(store);
    const projectDir = makeTempProjectDir();

    const originalBody = "# My Spec\n\nThis is the canonical corpus version.";
    await insertDoc(store, makeDoc({
      id: "01J000000000000000000000S1",
      type: "spec",
      title: "Force Overwrite Spec",
      slug: "spec-force-overwrite-spec",
      content: originalBody,
    }));

    const first = await service.exportDocs({ projectDir, dryRun: false });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const filePath = first.value.created[0]!;
    const absPath = join(projectDir, filePath);

    // Hand-edit the file (introduces drift)
    const fileContent = readFileSync(absPath, "utf8");
    const driftedContent = fileContent.replace(
      "canonical corpus version",
      "MANUALLY EDITED VERSION",
    );
    writeFileSync(absPath, driftedContent, "utf8");

    // Export with force:true — should overwrite, not just report drift
    const second = await service.exportDocs({ projectDir, dryRun: false, force: true });
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(second.value.drift).toHaveLength(0);
    expect(second.value.overwritten).toHaveLength(1);
    expect(second.value.overwritten[0]).toBe(filePath);
    expect(second.value.errors).toHaveLength(0);

    // File now reflects the corpus body again, not the hand edit
    const afterContent = readFileSync(absPath, "utf8");
    expect(afterContent).toContain("canonical corpus version");
    expect(afterContent).not.toContain("MANUALLY EDITED VERSION");
  });

  it("after a force overwrite, a subsequent plain export reports skipped_clean (convergence)", async () => {
    const store = new InMemoryStore();
    const service = makeExportService(store);
    const projectDir = makeTempProjectDir();

    await insertDoc(store, makeDoc({
      id: "01J000000000000000000000S2",
      type: "spec",
      title: "Convergence Spec",
      slug: "spec-convergence-spec",
      content: "# Convergence\n\nOriginal.",
    }));

    const first = await service.exportDocs({ projectDir, dryRun: false });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const filePath = first.value.created[0]!;
    const absPath = join(projectDir, filePath);
    writeFileSync(absPath, readFileSync(absPath, "utf8").replace("Original", "Edited"), "utf8");

    const forced = await service.exportDocs({ projectDir, dryRun: false, force: true });
    expect(forced.ok).toBe(true);
    if (!forced.ok) return;
    expect(forced.value.overwritten).toHaveLength(1);

    // Plain (non-force) run afterwards must converge to clean, not drift again.
    const third = await service.exportDocs({ projectDir, dryRun: false });
    expect(third.ok).toBe(true);
    if (!third.ok) return;
    expect(third.value.drift).toHaveLength(0);
    expect(third.value.overwritten).toHaveLength(0);
    expect(third.value.skipped_clean).toHaveLength(1);
  });
});

describe("BOUNDARY — force: true on an already-clean file is a no-op (AC-EXPORT-9)", () => {
  it("clean file stays skipped_clean, overwritten[] empty, file bytes untouched", async () => {
    const store = new InMemoryStore();
    const service = makeExportService(store);
    const projectDir = makeTempProjectDir();

    await insertDoc(store, makeDoc({
      id: "01J000000000000000000000S3",
      type: "spec",
      title: "Clean Force Spec",
      slug: "spec-clean-force-spec",
      content: "# Clean\n\nNo drift here.",
    }));

    const first = await service.exportDocs({ projectDir, dryRun: false });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const filePath = first.value.created[0]!;
    const absPath = join(projectDir, filePath);
    const beforeBytes = readFileSync(absPath, "utf8");

    const second = await service.exportDocs({ projectDir, dryRun: false, force: true });
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(second.value.skipped_clean).toHaveLength(1);
    expect(second.value.overwritten).toHaveLength(0);
    expect(second.value.drift).toHaveLength(0);
    expect(readFileSync(absPath, "utf8")).toBe(beforeBytes);
  });
});

describe("STATE — force: true + dryRun: true reports overwritten[] but writes nothing (AC-EXPORT-7 x A2)", () => {
  it("drifted file is left untouched on disk, but reported as would-be-overwritten", async () => {
    const store = new InMemoryStore();
    const service = makeExportService(store);
    const projectDir = makeTempProjectDir();

    await insertDoc(store, makeDoc({
      id: "01J000000000000000000000S4",
      type: "spec",
      title: "Dry Force Spec",
      slug: "spec-dry-force-spec",
      content: "# Dry Force\n\nOriginal.",
    }));

    const first = await service.exportDocs({ projectDir, dryRun: false });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const filePath = first.value.created[0]!;
    const absPath = join(projectDir, filePath);
    const driftedContent = readFileSync(absPath, "utf8").replace("Original", "Edited");
    writeFileSync(absPath, driftedContent, "utf8");

    const dryForced = await service.exportDocs({ projectDir, dryRun: true, force: true });
    expect(dryForced.ok).toBe(true);
    if (!dryForced.ok) return;

    expect(dryForced.value.overwritten).toHaveLength(1);
    expect(dryForced.value.overwritten[0]).toBe(filePath);
    expect(dryForced.value.drift).toHaveLength(0);

    // Nothing was actually written — the hand edit is still on disk.
    expect(readFileSync(absPath, "utf8")).toBe(driftedContent);
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

describe("STATE — corpus children change under a placeholder doc → drift IS reported (AC-4 true positive)", () => {
  it("adding a child after export makes the exported projection stale — reported as drift, not clean", async () => {
    // Complement to the "STATE — re-exporting ... reports clean" test above: when the
    // corpus actually changes (a new child is added, so <ChildrenOf /> would render
    // differently), the on-disk file genuinely IS a stale projection of the CURRENT
    // corpus state. This is a TRUE positive, not the permanent-false-positive bug —
    // the file legitimately differs from what export would write today.
    const store = new InMemoryStore();
    const service = makeExportService(store);
    const projectDir = makeTempProjectDir();

    await insertDoc(store, makeDoc({
      id: "01J0000000000000000000PR3",
      type: "prd",
      title: "Growing PRD",
      slug: "prd-growing-prd",
      content: "# Growing PRD\n\n<ChildrenOf />\n",
    }));
    await insertDoc(store, makeDoc({
      id: "01J000000000000000000000C1",
      type: "spec",
      title: "First Child",
      slug: "spec-first-child",
      parent_id: "01J0000000000000000000PR3",
    }));

    const first = await service.exportDocs({ projectDir, dryRun: false });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.drift).toHaveLength(0);

    const prdFilePath = first.value.created.find((p) => p.includes("PRD-"))!;
    const absPath = join(projectDir, prdFilePath);
    const beforeContent = readFileSync(absPath, "utf8");

    // A second child is added — <ChildrenOf /> would now render an extra bullet line,
    // so the on-disk file (from before this doc existed) is stale.
    await insertDoc(store, makeDoc({
      id: "01J000000000000000000000C2",
      type: "spec",
      title: "Second Child",
      slug: "spec-second-child",
      parent_id: "01J0000000000000000000PR3",
    }));

    const second = await service.exportDocs({ projectDir, dryRun: false });
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    // The PRD file is reported as drift (true positive), not skipped_clean.
    expect(second.value.drift).toContain(prdFilePath);
    expect(second.value.skipped_clean).not.toContain(prdFilePath);
    // File on disk is untouched (no force) — still the pre-second-child projection.
    expect(readFileSync(absPath, "utf8")).toBe(beforeContent);

    // force:true refreshes it to the current projection (both children listed).
    const forced = await service.exportDocs({ projectDir, dryRun: false, force: true });
    expect(forced.ok).toBe(true);
    if (!forced.ok) return;
    expect(forced.value.overwritten).toContain(prdFilePath);

    const afterForce = readFileSync(absPath, "utf8");
    expect(afterForce).toContain("First Child");
    expect(afterForce).toContain("Second Child");

    // And now it converges: a plain re-export is clean again.
    const third = await service.exportDocs({ projectDir, dryRun: false });
    expect(third.ok).toBe(true);
    if (!third.ok) return;
    expect(third.value.drift).toHaveLength(0);
    expect(third.value.skipped_clean).toContain(prdFilePath);
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

// ─── Amendment A1: title-declared numbering in export human_id allocation ────
//
// SPEC-021 Amendment A1 — buildOrExtendIndex's NEW-allocation path first tries a doc's
// self-declared number (`^{PREFIX}-(\d+)\b` matched against doc.title, PREFIX keyed to
// doc.type) before falling back to the sequential per-type counter. Fixes the incident
// where a doc titled "SPEC-035 — …" was allocated human_id SPEC-033 by a pure max+1
// counter that ignored the number already embedded in the title.

type TestExportIndex = {
  version: number;
  mappings: Record<string, { human_id: string; file_path: string }>;
};

function readExportIndex(projectDir: string): TestExportIndex {
  const indexPath = join(projectDir, ".lore", "export-index.json");
  return JSON.parse(readFileSync(indexPath, "utf8")) as TestExportIndex;
}

function writeExportIndex(projectDir: string, index: TestExportIndex): void {
  const indexPath = join(projectDir, ".lore", "export-index.json");
  writeFileSync(indexPath, JSON.stringify(index, null, 2) + "\n", "utf8");
}

describe("HAPPY — title-declared number is adopted for an unmapped doc (AC-A1-1)", () => {
  it("spec titled 'SPEC-040 — X' allocates human_id SPEC-040 / filename SPEC-040-...", async () => {
    const store = new InMemoryStore();
    const service = makeExportService(store);
    const projectDir = makeTempProjectDir();

    const docId = "01J0000000000000000000A11A";
    await insertDoc(store, makeDoc({
      id: docId,
      type: "spec",
      title: "SPEC-040 — Declared Number Feature",
      slug: "spec-declared-number-feature",
    }));

    const result = await service.exportDocs({ projectDir, dryRun: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const index = readExportIndex(projectDir);
    expect(index.mappings[docId]!.human_id).toBe("SPEC-040");
    expect(index.mappings[docId]!.file_path).toMatch(/^docs\/requirements\/spec\/SPEC-040-/);
  });
});

describe("BOUNDARY — two unmapped docs both title-claim the same number (AC-A1-2)", () => {
  it("first in iteration order claims SPEC-040, second falls back to sequential — no duplicate", async () => {
    const store = new InMemoryStore();
    const service = makeExportService(store);
    const projectDir = makeTempProjectDir();

    // findMany sorts DESC by updated_at — newer updated_at iterates first.
    const firstDocId = "01J0000000000000000000A12A";
    const secondDocId = "01J0000000000000000000A12B";
    await insertDoc(store, makeDoc({
      id: firstDocId,
      type: "spec",
      title: "SPEC-040 — First Claimant",
      slug: "spec-first-claimant",
      updated_at: "2024-01-15T10:00:02.000Z",
    }));
    await insertDoc(store, makeDoc({
      id: secondDocId,
      type: "spec",
      title: "SPEC-040 — Second Claimant",
      slug: "spec-second-claimant",
      updated_at: "2024-01-15T10:00:01.000Z",
    }));

    const result = await service.exportDocs({ projectDir, dryRun: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const index = readExportIndex(projectDir);
    const firstHumanId = index.mappings[firstDocId]!.human_id;
    const secondHumanId = index.mappings[secondDocId]!.human_id;

    expect(firstHumanId).toBe("SPEC-040");
    expect(secondHumanId).not.toBe("SPEC-040");
    expect(secondHumanId).not.toBe(firstHumanId);
  });
});

describe("NEGATIVE — title-declared number already claimed in the index (AC-A1-3)", () => {
  it("falls back to sequential allocation when SPEC-040 is already mapped to a different doc", async () => {
    const store = new InMemoryStore();
    const service = makeExportService(store);
    const projectDir = makeTempProjectDir();

    // Pre-seed the index with an existing mapping claiming SPEC-040 for a doc id that
    // is not part of this corpus reconcile pass (a harmless orphan entry per
    // repairCollisions' documented semantics) — this is what "already claimed in the
    // index" means for the new-allocation path.
    writeExportIndex(projectDir, {
      version: 1,
      mappings: {
        "orphan-doc-already-mapped": {
          human_id: "SPEC-040",
          file_path: "docs/requirements/spec/SPEC-040-orphan-doc.md",
        },
      },
    });

    const docId = "01J0000000000000000000A13A";
    await insertDoc(store, makeDoc({
      id: docId,
      type: "spec",
      title: "SPEC-040 — Late Claimant",
      slug: "spec-late-claimant",
    }));

    const result = await service.exportDocs({ projectDir, dryRun: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const index = readExportIndex(projectDir);
    expect(index.mappings[docId]!.human_id).not.toBe("SPEC-040");
    // Sequential fallback: counter is seeded from the existing SPEC-040 mapping (max=40),
    // so the freed number is the next one after it.
    expect(index.mappings[docId]!.human_id).toBe("SPEC-041");
  });
});

describe("BOUNDARY — sequential fallback skips a forward title-claimed number (AC-A1-4)", () => {
  it("title-claim of SPEC-036 while counter sits at 035 → next sequential allocation is SPEC-037", async () => {
    const store = new InMemoryStore();
    const service = makeExportService(store);
    const projectDir = makeTempProjectDir();

    // Seed the counter to 035 via an orphan mapping (no corresponding corpus doc) —
    // mirrors the pattern used by the export-docs-collision.test.ts fixtures.
    writeExportIndex(projectDir, {
      version: 1,
      mappings: {
        "orphan-doc-035": {
          human_id: "SPEC-035",
          file_path: "docs/requirements/spec/SPEC-035-orphan-doc.md",
        },
      },
    });

    // First in iteration order (newer updated_at): title-claims SPEC-036.
    const claimDocId = "01J0000000000000000000A14A";
    await insertDoc(store, makeDoc({
      id: claimDocId,
      type: "spec",
      title: "SPEC-036 — Forward Claim",
      slug: "spec-forward-claim",
      updated_at: "2024-01-15T10:00:02.000Z",
    }));

    // Second in iteration order (older updated_at): no title-declared number, must
    // fall through to the sequential counter, which the claim above has advanced.
    const sequentialDocId = "01J0000000000000000000A14B";
    await insertDoc(store, makeDoc({
      id: sequentialDocId,
      type: "spec",
      title: "Plain Sequential Title",
      slug: "spec-plain-sequential-title",
      updated_at: "2024-01-15T10:00:01.000Z",
    }));

    const result = await service.exportDocs({ projectDir, dryRun: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const index = readExportIndex(projectDir);
    expect(index.mappings[claimDocId]!.human_id).toBe("SPEC-036");
    expect(index.mappings[sequentialDocId]!.human_id).toBe("SPEC-037");
  });
});

describe("BOUNDARY — title-declared number normalizes to canonical padded form (AC-A1-5)", () => {
  it("title 'SPEC-7 — X' normalizes to SPEC-007", async () => {
    const store = new InMemoryStore();
    const service = makeExportService(store);
    const projectDir = makeTempProjectDir();

    const docId = "01J0000000000000000000A15A";
    await insertDoc(store, makeDoc({
      id: docId,
      type: "spec",
      title: "SPEC-7 — Short Number",
      slug: "spec-short-number",
    }));

    const result = await service.exportDocs({ projectDir, dryRun: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const index = readExportIndex(projectDir);
    expect(index.mappings[docId]!.human_id).toBe("SPEC-007");
  });
});

describe("REGRESSION — titles with no self-declared number or a foreign prefix stay pure sequential (AC-A1-6)", () => {
  it("title with no leading {PREFIX}-{N} allocates the plain sequential number", async () => {
    const store = new InMemoryStore();
    const service = makeExportService(store);
    const projectDir = makeTempProjectDir();

    const docId = "01J0000000000000000000A16A";
    await insertDoc(store, makeDoc({
      id: docId,
      type: "spec",
      title: "My Plain Spec Title",
      slug: "spec-my-plain-spec-title",
    }));

    const result = await service.exportDocs({ projectDir, dryRun: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const index = readExportIndex(projectDir);
    expect(index.mappings[docId]!.human_id).toBe("SPEC-001");
  });

  it("a plan titled 'SPEC-035 implementation — X' can never claim a SPEC number (foreign prefix)", async () => {
    const store = new InMemoryStore();
    const service = makeExportService(store);
    const projectDir = makeTempProjectDir();

    const docId = "01J0000000000000000000A16B";
    await insertDoc(store, makeDoc({
      id: docId,
      type: "plan",
      title: "SPEC-035 implementation — Rollout Plan",
      slug: "plan-spec-035-implementation-rollout-plan",
    }));

    const result = await service.exportDocs({ projectDir, dryRun: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const index = readExportIndex(projectDir);
    // Prefix for type "plan" is PLAN, not SPEC — the title's "SPEC-035" text can never
    // match `^PLAN-(\d+)\b`, so allocation falls through to the plain sequential counter.
    expect(index.mappings[docId]!.human_id).toBe("PLAN-001");
    expect(index.mappings[docId]!.human_id).not.toMatch(/^SPEC-/);
  });
});

// ─── SPEC-084 T5 — export read-switch + SPEC-021 A1 retirement for numbered types ─────
//
// A "numbered type" (spec/adr, per @lore/core's ORDINAL_REGISTRY) with a store-allocated
// `ordinal` column value composes its human_id via `formatMirrorHumanId` (a pure, zero-padded
// column read — NO title parsing, NO sequential counter, NEVER a silent renumber) instead of
// the Amendment A1 legacy allocator above.
//
// ⛔ RE-BASELINE (task-unify-mirror-identifiers-on-zero-padded-form-export-all, 2026-08-11):
// this block used to assert the OPPOSITE — `formatDocDisplayId` (unpadded, "SPEC-84") — citing
// "SPEC-084 D5". Re-checked against SPEC-084's actual spec text: D5 is about a single
// composition site + never persisting the composite string; it does NOT mandate an unpadded
// OUTPUT format anywhere in the Module Boundary / Design Decisions / structured
// Acceptance-Criteria sections (confirmed: none of AC-084-1..6's oracle commands touch this
// file). "No zero-padding" was this file's OWN prior assertion of `formatDocDisplayId`'s
// then-current implementation choice, not a spec-mandated invariant.
//
// Original command: `bunx vitest run packages/lore/tests/unit/service/export-docs-service.test.ts
// -t "AC-084-6 T5-1"`. Original failure once the ExportDocsService source changed:
// `expect(index.mappings[docId]!.human_id).toBe("SPEC-84")` → received `"SPEC-084"`, and the
// `not.toBe("SPEC-084")` assertion inverted to a hard failure.
// Why this is a correction, not a cover-up: the LEGACY allocator (Amendment A1, same file)
// has ALWAYS zero-padded (`SPEC-001`, `.padStart(3, "0")`), and every mirror filename on disk
// has always been zero-padded too (`SPEC-021-*.md`) — only THIS column-derived branch (added
// later by SPEC-084 T5) diverged, which is the exact `id: SPEC-21` inside a
// `SPEC-021-sync-docs-reverse.md` file corruption this task measured on the live corpus
// (89/142 spec mirrors mismatched). Unifying this branch to pad, like its sibling, is the fix,
// not a weakening — it makes the two allocation paths agree instead of one silently drifting.

describe("HAPPY — numbered-type doc with an allocated ordinal uses the column, not the legacy allocator (AC-084-6 T5-1)", () => {
  it("spec with ordinal=84 exports human_id SPEC-084 (zero-padded, matches the legacy allocator's own convention) and a matching file_path", async () => {
    const store = new InMemoryStore();
    const service = makeExportService(store);
    const projectDir = makeTempProjectDir();

    const docId = "01J0000000000000000000T5S1";
    await insertDoc(store, makeDoc({
      id: docId,
      type: "spec",
      title: "Ordinal Allocated Feature",
      slug: "spec-ordinal-allocated-feature",
      ordinal: 84,
    }));

    const result = await service.exportDocs({ projectDir, dryRun: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const index = readExportIndex(projectDir);
    expect(index.mappings[docId]!.human_id).toBe("SPEC-084");
    // Zero-padded to 3 digits (task-unify-mirror-identifiers..., 2026-08-11) — matches the
    // legacy allocator's own convention below, and the mirror's filename convention.
    expect(index.mappings[docId]!.human_id).not.toBe("SPEC-84");
    expect(index.mappings[docId]!.file_path).toMatch(/^docs\/requirements\/spec\/SPEC-084-/);

    const filePath = result.value.created[0]!;
    const content = readFileSync(join(projectDir, filePath), "utf8");
    const fm = parseFrontmatterScalars(content);
    expect(fm["id"]).toBe("SPEC-084");

    // A doc with an allocated ordinal never hits the legacy fallback — no warning.
    expect(result.value.ordinal_warnings).toHaveLength(0);
  });

  it("adr with ordinal=3 exports human_id ADR-003 (zero-padded) via the same column-derived branch", async () => {
    const store = new InMemoryStore();
    const service = makeExportService(store);
    const projectDir = makeTempProjectDir();

    const docId = "01J0000000000000000000T5A1";
    await insertDoc(store, makeDoc({
      id: docId,
      type: "adr",
      title: "Adopt Ordinal Allocation",
      slug: "adr-adopt-ordinal-allocation",
      ordinal: 3,
      extra: { decision_status: "accepted" },
    }));

    const result = await service.exportDocs({ projectDir, dryRun: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const index = readExportIndex(projectDir);
    expect(index.mappings[docId]!.human_id).toBe("ADR-003");
    expect(index.mappings[docId]!.file_path).toMatch(/^docs\/requirements\/adr\/ADR-003-/);
    expect(result.value.ordinal_warnings).toHaveLength(0);
  });

  it("re-exporting an ordinal-derived doc twice converges (idempotent, skipped_clean second run)", async () => {
    const store = new InMemoryStore();
    const service = makeExportService(store);
    const projectDir = makeTempProjectDir();

    const docId = "01J0000000000000000000T5S2";
    await insertDoc(store, makeDoc({
      id: docId,
      type: "spec",
      title: "Stable Ordinal Spec",
      slug: "spec-stable-ordinal-spec",
      ordinal: 12,
      content: "# Stable\n\nUnchanged body.",
    }));

    const first = await service.exportDocs({ projectDir, dryRun: false });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.created).toHaveLength(1);
    expect(first.value.repaired).toHaveLength(0);

    const second = await service.exportDocs({ projectDir, dryRun: false });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.created).toHaveLength(0);
    expect(second.value.skipped_clean).toHaveLength(1);
    expect(second.value.repaired).toHaveLength(0);
    expect(second.value.ordinal_warnings).toHaveLength(0);
  });
});

describe("NEGATIVE — numbered-type doc with a NULL ordinal falls back to the legacy path with a loud report warning (AC-084-6 T5-2)", () => {
  it("spec with no ordinal column value gets the legacy zero-padded id AND a named ordinal_warnings entry", async () => {
    const store = new InMemoryStore();
    const service = makeExportService(store);
    const projectDir = makeTempProjectDir();

    const docId = "01J0000000000000000000T5W1";
    await insertDoc(store, makeDoc({
      id: docId,
      type: "spec",
      title: "Unmigrated Legacy Spec",
      slug: "spec-unmigrated-legacy-spec",
      // ordinal deliberately omitted — simulates a pre-`lore migrate ordinals` doc.
    }));

    const result = await service.exportDocs({ projectDir, dryRun: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const index = readExportIndex(projectDir);
    // Legacy path still allocates — zero-padded, sequential — never blocked, never a
    // fabricated ordinal-shaped id.
    expect(index.mappings[docId]!.human_id).toBe("SPEC-001");

    // But the gap is named loudly, not silently perpetuated.
    expect(result.value.ordinal_warnings).toHaveLength(1);
    expect(result.value.ordinal_warnings[0]).toContain(docId);
    expect(result.value.ordinal_warnings[0]).toContain("Unmigrated Legacy Spec");
    expect(result.value.ordinal_warnings[0]).toContain("lore migrate ordinals");
  });

  it("adr with no ordinal column value also warns (adr has no kind-exemption at all)", async () => {
    const store = new InMemoryStore();
    const service = makeExportService(store);
    const projectDir = makeTempProjectDir();

    const docId = "01J0000000000000000000T5W2";
    await insertDoc(store, makeDoc({
      id: docId,
      type: "adr",
      title: "Unmigrated Legacy Decision",
      slug: "adr-unmigrated-legacy-decision",
      extra: { decision_status: "proposed" },
    }));

    const result = await service.exportDocs({ projectDir, dryRun: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.ordinal_warnings).toHaveLength(1);
    expect(result.value.ordinal_warnings[0]).toContain(docId);
    expect(result.value.ordinal_warnings[0]).toContain("lore migrate ordinals");
  });
});

describe("BOUNDARY — a permanently kind-exempt numbered-type doc (domain-overview) never warns (AC-084-6 T5-3)", () => {
  it("a domain-overview spec with a NULL ordinal takes the legacy path silently — no ordinal_warnings entry", async () => {
    const store = new InMemoryStore();
    const service = makeExportService(store);
    const projectDir = makeTempProjectDir();

    const docId = "01J0000000000000000000T5E1";
    await insertDoc(store, makeDoc({
      id: docId,
      type: "spec",
      title: "Domain Overview Doc",
      slug: "spec-domain-overview-doc",
      extra: { spec_kind: "domain-overview" },
      // ordinal omitted — domain-overview specs are PERMANENTLY exempt (never allocated),
      // not merely "not yet migrated" — so this must never trigger a warning.
    }));

    const result = await service.exportDocs({ projectDir, dryRun: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Still gets an id via the legacy allocator (exempt docs still need SOME file identity).
    const index = readExportIndex(projectDir);
    expect(index.mappings[docId]!.human_id).toBe("SPEC-001");

    // No warning — this is a permanent, by-design NULL, not a migration gap.
    expect(result.value.ordinal_warnings).toHaveLength(0);
  });
});

describe("REGRESSION — a non-numbered type is byte-identical even if an ordinal-shaped field is present (AC-084-6 T5-4)", () => {
  it("a plan doc (not in ORDINAL_REGISTRY) with an ordinal value set is completely ignored by both new branches", async () => {
    const store = new InMemoryStore();
    const service = makeExportService(store);
    const projectDir = makeTempProjectDir();

    const docId = "01J0000000000000000000T5R1";
    await insertDoc(store, makeDoc({
      id: docId,
      type: "plan",
      title: "Plan With Stray Ordinal Field",
      slug: "plan-with-stray-ordinal-field",
      // "plan" is not a numbered type at all — ORDINAL_REGISTRY has no entry for it, so
      // this value must never influence allocation, and must never trigger a warning.
      ordinal: 999,
    }));

    const result = await service.exportDocs({ projectDir, dryRun: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const index = readExportIndex(projectDir);
    // Plain sequential PLAN-001 — the stray ordinal:999 never surfaces anywhere.
    expect(index.mappings[docId]!.human_id).toBe("PLAN-001");
    expect(index.mappings[docId]!.human_id).not.toContain("999");
    expect(index.mappings[docId]!.file_path).not.toContain("999");
    expect(result.value.ordinal_warnings).toHaveLength(0);
  });
});

describe("STATE — an existing export-index mapping for a numbered doc reconciles to the column on the next export run (AC-084-6 T5-5)", () => {
  it("a doc previously exported under a legacy allocation, now carrying an allocated ordinal, is reconciled + logged in repaired[]", async () => {
    const store = new InMemoryStore();
    const service = makeExportService(store);
    const projectDir = makeTempProjectDir();

    const docId = "01J0000000000000000000T5R2";
    await insertDoc(store, makeDoc({
      id: docId,
      type: "spec",
      title: "Since Migrated Spec",
      slug: "spec-since-migrated-spec",
      // The store now carries a real allocated ordinal — as if `lore migrate ordinals`
      // ran after this doc's LAST export under the legacy allocator below.
      ordinal: 40,
    }));

    // Pre-seed export-index.json + an on-disk file reflecting the STALE legacy mapping
    // (as if a prior export run happened before the ordinal column was backfilled).
    const staleFilePath = "docs/requirements/spec/SPEC-007-since-migrated-spec.md";
    writeExportIndex(projectDir, {
      version: 1,
      mappings: {
        [docId]: { human_id: "SPEC-007", file_path: staleFilePath },
      },
    });
    mkdirSync(join(projectDir, "docs/requirements/spec"), { recursive: true });
    writeFileSync(join(projectDir, staleFilePath), "---\nid: SPEC-007\n---\n\nstale legacy body\n", "utf8");

    const result = await service.exportDocs({ projectDir, dryRun: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Loud, repaired-family log entry — mirrors repairCollisions' loudness contract.
    expect(result.value.repaired).toHaveLength(1);
    expect(result.value.repaired[0]).toContain("ordinal-reconcile");
    expect(result.value.repaired[0]).toContain(docId);

    const index = readExportIndex(projectDir);
    // ⛔ RE-BASELINE (task-unify-mirror-identifiers-on-zero-padded-form-export-all, 2026-08-11):
    // was `.toBe("SPEC-40")` / `/^docs\/requirements\/spec\/SPEC-40-/` (unpadded) — see the
    // "AC-084-6 T5-1" describe block's header comment above for why zero-padding this
    // column-derived branch is the correction, not a weakening.
    expect(index.mappings[docId]!.human_id).toBe("SPEC-040");
    expect(index.mappings[docId]!.file_path).toMatch(/^docs\/requirements\/spec\/SPEC-040-/);
    expect(index.mappings[docId]!.file_path).not.toBe(staleFilePath);

    // A fresh file is written at the corrected path...
    expect(existsSync(join(projectDir, index.mappings[docId]!.file_path))).toBe(true);
    // ...and the stale file from the legacy allocation is left on disk, untouched — this
    // module never silently deletes a file it previously wrote.
    expect(existsSync(join(projectDir, staleFilePath))).toBe(true);
    expect(readFileSync(join(projectDir, staleFilePath), "utf8")).toContain("stale legacy body");

    // Second run: already converged — no further reconcile, no repeat warning.
    const second = await service.exportDocs({ projectDir, dryRun: false });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.repaired).toHaveLength(0);
    expect(second.value.ordinal_warnings).toHaveLength(0);
  });
});

// ─── SPEC-084 T5 + task-unify-mirror-identifiers-on-zero-padded-form-export-all ──────
//
// Live-corpus mechanism, measured 2026-08-11: `OrdinalMigrationService`'s step 3 patches ONLY
// `human_id` in `.lore/export-index.json` (`{...mapping, human_id: expectedHumanId}`), NEVER
// `file_path` — Scope-Alt, by that service's own design. When a doc's ORIGINAL file was written
// under the (already zero-padded) legacy allocator BEFORE its ordinal was backfilled, `file_path`
// already correctly embeds the padded form (e.g. `SPEC-021-*.md`) — only `human_id` gets
// corrupted to the unpadded `formatDocDisplayId` output (`"SPEC-21"`). Reconciling THAT mapping
// recomputes the SAME `file_path` (same padded id, same kebab title) — so without the
// `identity_repaired` bypass, the write loop's body-only drift check finds "file exists, body
// unchanged" and reports `skipped_clean`, NEVER refreshing the stale `id:` frontmatter line. This
// is the exact defect that left 31 cross-type references broken on the live corpus even after the
// column-derived branch itself was fixed to zero-pad.

describe("STATE — a reconciled mapping that recomputes the SAME file_path as its stale entry is unconditionally rewritten (identity_repaired, not skipped_clean)", () => {
  it("frontmatter id: refreshes from the stale unpadded form to the padded one, even though the file already existed at the correct path", async () => {
    const store = new InMemoryStore();
    const service = makeExportService(store);
    const projectDir = makeTempProjectDir();

    const docId = "01J0000000000000000000T5S9";
    await insertDoc(store, makeDoc({
      id: docId,
      type: "spec",
      title: "Legacy Padded Spec",
      slug: "spec-legacy-padded-spec",
      // Ordinal IS allocated (post-`lore migrate ordinals`) — this doc is squarely in the
      // column-derived branch, same as every AC-084-6 T5-1 case above.
      ordinal: 21,
    }));

    // Pre-seed export-index.json with the EXACT corruption signature measured on the live
    // corpus (SPEC-21-sync-docs-reverse.md incident): human_id UNPADDED, file_path ALREADY
    // padded and matching what the corrected human_id would itself resolve to.
    const stalePaddedFilePath = "docs/requirements/spec/SPEC-021-legacy-padded-spec.md";
    writeExportIndex(projectDir, {
      version: 1,
      mappings: {
        [docId]: { human_id: "SPEC-21", file_path: stalePaddedFilePath },
      },
    });
    mkdirSync(join(projectDir, "docs/requirements/spec"), { recursive: true });
    // On-disk file ALREADY at the (correct) padded path, but with the STALE unpadded id: line
    // — this is what a prior export run wrote before `human_id` was corrupted in the index.
    writeFileSync(
      join(projectDir, stalePaddedFilePath),
      "---\nid: SPEC-21\ntype: spec\n---\n\nUnchanged body content.\n",
      "utf8",
    );

    const result = await service.exportDocs({ projectDir, dryRun: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Reconciled + logged, same loudness contract as AC-084-6 T5-5.
    expect(result.value.repaired).toHaveLength(1);
    expect(result.value.repaired[0]).toContain("ordinal-reconcile");
    expect(result.value.repaired[0]).toContain(docId);

    // The critical assertion this test exists for: the file is reported as identity_repaired,
    // NEVER as skipped_clean (which is what a body-only drift check would have said, since the
    // body text here is unchanged and the recomputed path is identical to the stale one).
    expect(result.value.identity_repaired).toEqual([stalePaddedFilePath]);
    expect(result.value.skipped_clean).not.toContain(stalePaddedFilePath);
    expect(result.value.created).toHaveLength(0);
    expect(result.value.drift).toHaveLength(0);
    expect(result.value.overwritten).toHaveLength(0);

    const index = readExportIndex(projectDir);
    expect(index.mappings[docId]!.human_id).toBe("SPEC-021");
    expect(index.mappings[docId]!.file_path).toBe(stalePaddedFilePath);

    // The file's frontmatter id: is now refreshed to the padded form — this is the exact
    // "frontmatter disagrees with its own filename forever" corruption this task fixes.
    const rewritten = readFileSync(join(projectDir, stalePaddedFilePath), "utf8");
    const fm = parseFrontmatterScalars(rewritten);
    expect(fm["id"]).toBe("SPEC-021");
    // identity_repaired is a FULL rebuild from the corpus (frontmatter AND body), same as a
    // force-overwrite — it does not selectively patch just the id: line, nor does it preserve
    // whatever the stale on-disk file happened to contain. The stale fixture body ("Unchanged
    // body content.") is GONE, replaced by the corpus doc's own current content
    // ("makeDoc"'s default, since this test never overrides it).
    expect(rewritten).not.toContain("Unchanged body content.");
    expect(rewritten).toContain("Content body.");

    // Second run: already converged — no further reconcile, no repeat identity_repaired entry.
    const second = await service.exportDocs({ projectDir, dryRun: false });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.repaired).toHaveLength(0);
    expect(second.value.identity_repaired).toHaveLength(0);
    expect(second.value.skipped_clean).toEqual([stalePaddedFilePath]);
  });

  it("catches the SAME staleness even with NO reconcile this run — the index already agrees with the column, only the on-disk file lags (measured on the live corpus: an earlier run's reconcile had already corrected the index, but the file was never revisited)", async () => {
    const store = new InMemoryStore();
    const service = makeExportService(store);
    const projectDir = makeTempProjectDir();

    const docId = "01J0000000000000000000T5SA";
    await insertDoc(store, makeDoc({
      id: docId,
      type: "spec",
      title: "Index Already Fixed Spec",
      slug: "spec-index-already-fixed-spec",
      ordinal: 2,
    }));

    // The index mapping is ALREADY the correct padded form — reconcileOrdinalMappings will find
    // NOTHING to reconcile here (mapping.human_id === formatMirrorHumanId(doc) already), so
    // `reconciledDocIds` will NOT contain this doc. Only the on-disk file itself is stale.
    const filePath = "docs/requirements/spec/SPEC-002-index-already-fixed-spec.md";
    writeExportIndex(projectDir, {
      version: 1,
      mappings: {
        [docId]: { human_id: "SPEC-002", file_path: filePath },
      },
    });
    mkdirSync(join(projectDir, "docs/requirements/spec"), { recursive: true });
    writeFileSync(
      join(projectDir, filePath),
      "---\nid: SPEC-2\ntype: spec\n---\n\nContent body.\n",
      "utf8",
    );

    const result = await service.exportDocs({ projectDir, dryRun: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // No reconcile log entry — the index never diverged this run.
    expect(result.value.repaired).toHaveLength(0);
    // Yet the file's stale frontmatter is still caught and fixed, never silently skipped_clean.
    expect(result.value.identity_repaired).toEqual([filePath]);
    expect(result.value.skipped_clean).not.toContain(filePath);

    const rewritten = readFileSync(join(projectDir, filePath), "utf8");
    const fm = parseFrontmatterScalars(rewritten);
    expect(fm["id"]).toBe("SPEC-002");
  });

  it("catches CITING-side staleness too: doc B's own id/body never changed, but its links: entry still names doc A's OLD id string after A's own id was corrected (the exact class of bug that left cross-type links_broken non-zero on the live corpus)", async () => {
    const store = new InMemoryStore();
    const service = makeExportService(store);
    const projectDir = makeTempProjectDir();

    const docAId = "01J0000000000000000000T5AA";
    const docBId = "01J0000000000000000000T5BB";
    await insertDoc(store, makeDoc({
      id: docAId,
      type: "adr",
      title: "Cited Decision",
      slug: "adr-cited-decision",
      extra: { decision_status: "accepted" },
      // A's identity is ALREADY correct (index already padded — same "index converged, file
      // lags" shape as the previous test) — this test is entirely about B's citation of A.
    }));
    await insertDoc(store, makeDoc({
      id: docBId,
      type: "spec",
      title: "Citing Spec",
      slug: "spec-citing-spec",
    }));
    const linkResult = await store.addLink({
      from_id: docBId,
      to_id: docAId,
      link_type: "relates-to",
      created_at: "2024-01-15T10:00:00.000Z",
      created_by: "test-agent",
    });
    expect(linkResult.ok).toBe(true);

    const aFilePath = "docs/requirements/adr/ADR-001-cited-decision.md";
    const bFilePath = "docs/requirements/spec/SPEC-001-citing-spec.md";
    writeExportIndex(projectDir, {
      version: 1,
      mappings: {
        [docAId]: { human_id: "ADR-001", file_path: aFilePath },
        [docBId]: { human_id: "SPEC-001", file_path: bFilePath },
      },
    });
    mkdirSync(join(projectDir, "docs/requirements/adr"), { recursive: true });
    mkdirSync(join(projectDir, "docs/requirements/spec"), { recursive: true });
    writeFileSync(join(projectDir, aFilePath), "---\nid: ADR-001\ntype: adr\n---\n\nA's content.\n", "utf8");
    // B's OWN id/body is fine — only its links: entry is stale, citing A's OLD unpadded form.
    writeFileSync(
      join(projectDir, bFilePath),
      "---\nid: SPEC-001\ntype: spec\nlinks:\n  - {id: ADR-1, type: relates-to}\n---\n\nB's content.\n",
      "utf8",
    );

    const result = await service.exportDocs({ projectDir, dryRun: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // A's own id already matched — never reconciled (A's index mapping never diverged).
    expect(result.value.repaired).toHaveLength(0);
    // B is caught by the CITING-side (links) staleness signal, never skipped_clean.
    expect(result.value.identity_repaired).toContain(bFilePath);
    expect(result.value.skipped_clean).not.toContain(bFilePath);

    const rewrittenB = readFileSync(join(projectDir, bFilePath), "utf8");
    expect(rewrittenB).toContain("id: ADR-001");
    expect(rewrittenB).not.toContain("id: ADR-1,");
  });
});

// ─── task-unify-mirror-identifiers-on-zero-padded-form-export-all: NUL-byte sanitization ─────
//
// Measured live (2026-08-11): widening the export to ALL SIX types (this task's own deliverable)
// exported `task` docs for the first time, which surfaced a real corpus doc
// (TASK-434-literal-nul-bytes-in-two-scripts-source-files-one) whose body INTENTIONALLY quotes a
// raw NUL byte (`const KEY_SEP = "\x00"`, as a before/after contrast against its own escaped
// fix) — and immediately failed `scripts/check-no-nul-bytes.ts`'s `bun run test`-wired gate,
// because a raw NUL inside git's binary-sniff window makes the whole mirror file unreviewable.

describe("REGRESSION — a raw NUL byte in a doc's body is sanitized in the exported mirror, never in the corpus (task-unify-mirror-identifiers-on-zero-padded-form-export-all)", () => {
  it("a doc whose content contains a literal NUL character exports with the byte replaced by the visible \\u0000 escape, and the export never touches doc.content itself", async () => {
    const store = new InMemoryStore();
    const service = makeExportService(store);
    const projectDir = makeTempProjectDir();

    const docId = "01J0000000000000000000NUL1";
    const rawNulContent = 'Before the fix:\n\n```ts\nconst KEY_SEP = "\u0000";\n```\n\nAfter the fix: `\\0`.\n';
    await insertDoc(store, makeDoc({
      id: docId,
      type: "knowledge",
      title: "Nul Byte Retro",
      slug: "knowledge-nul-byte-retro",
      content: rawNulContent,
      extra: { sub_type: "retro" },
    }));

    const result = await service.exportDocs({ projectDir, dryRun: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.errors).toHaveLength(0);
    expect(result.value.created).toHaveLength(1);

    const filePath = result.value.created[0]!;
    const written = readFileSync(join(projectDir, filePath), "utf8");

    // The exported mirror file contains ZERO raw NUL bytes — the exact property
    // scripts/check-no-nul-bytes.ts asserts against every git-tracked text-source file.
    expect(written.includes("\u0000")).toBe(false);
    // The escape is visible and reversible — the original byte's presence is still legible.
    expect(written).toContain('const KEY_SEP = "\\u0000";');

    // The corpus doc's OWN content is untouched — sanitization is export-boundary-only,
    // never a silent rewrite of the source of truth.
    const reFetched = await store.find(docId);
    expect(reFetched.ok).toBe(true);
    if (reFetched.ok && reFetched.value !== null) {
      expect(reFetched.value.content.includes("\u0000")).toBe(true);
      expect(reFetched.value.content).toBe(rawNulContent);
    }
  });

  it("re-exporting an already-sanitized file converges (idempotent, skipped_clean second run) — the drift comparison uses the SAME sanitized value both sides", async () => {
    const store = new InMemoryStore();
    const service = makeExportService(store);
    const projectDir = makeTempProjectDir();

    const docId = "01J0000000000000000000NUL2";
    await insertDoc(store, makeDoc({
      id: docId,
      type: "knowledge",
      title: "Nul Byte Retro Two",
      slug: "knowledge-nul-byte-retro-two",
      content: 'A literal NUL: "\u0000" end.\n',
      extra: { sub_type: "retro" },
    }));

    const first = await service.exportDocs({ projectDir, dryRun: false });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.created).toHaveLength(1);

    const second = await service.exportDocs({ projectDir, dryRun: false });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.created).toHaveLength(0);
    expect(second.value.skipped_clean).toHaveLength(1);
    expect(second.value.drift).toHaveLength(0);
  });
});
