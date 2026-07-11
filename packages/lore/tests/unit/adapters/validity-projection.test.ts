/**
 * SPEC-043 D4 invalidation-banner projection tests — `lore get` non-raw + export-docs
 * wiring sites (T2). Both consumers ultimately call the SAME shared renderer
 * (`resolveValidityBanner`/`renderValidityBanner`, T1) via:
 *   - `renderDocMarkdown` (`flows/feed-flow.ts`) — the exact function `commands/get.ts`
 *     delegates to for its non-raw display body (get.ts itself is bun-only —
 *     transitively imports `loader.ts` → `bun:sqlite` — so it cannot be imported here;
 *     testing the shared function it calls is the vitest-reachable equivalent).
 *   - `ExportDocsService.exportDocs` — banner now folded directly into `resolvedBody`
 *     inside the service (T2 deviation, see export-docs-service.ts module header) via
 *     the SAME standalone `resolveValidityBanner` function.
 *
 * Uses InMemoryStore — no file I/O for the renderDocMarkdown half; real temp
 * filesystem for the export-docs half (mirrors export-docs-service.test.ts).
 *
 * Coverage:
 *   HAPPY:      reason + a resolvable successor → banner carries both parts, no
 *               dangling separators
 *   NEGATIVE:   invalidated_by points to a NONEXISTENT doc → banner omits the
 *               "— superseded by" clause gracefully (never throws)
 *   BOUNDARY:   no reason, no successor → bare banner line only (pinned format: no
 *               dangling separator)
 *   ERROR:      malformed `extra.validity` (wrong-typed field) degrades to "doc is
 *               NOT invalidated" (no banner) rather than throwing — extractValidity's
 *               safeParse degrade path is honored by the projection seam too
 *   STATE:      a soft-deleted successor still resolves to its slug, with a
 *               " (deleted)" suffix
 *   REGRESSION: a currently-valid doc (no `invalid_at`) renders NO banner on either
 *               wiring site; export-docs' second run on an unchanged invalidated doc
 *               reports skipped_clean, not drift (same-value-both-sides invariant)
 *
 * @spec_ref SPEC-043 §Acceptance Criteria AC-MH-7
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { OutlineService, renderResolvedToMarkdown } from "../../../src/service/outline-service.js";
import { ExportDocsService, type ResolveDocBody } from "../../../src/service/export-docs-service.js";
import { renderDocMarkdown } from "../../../src/flows/feed-flow.js";
import { ok, DOC_TYPE_ROLE_MAP, NoOpTelemetry } from "@lore/core";
import type { App } from "../../../src/app.js";
import type { DocRecord, Slug } from "@lore/core";

const NOW_ISO = "2026-07-11T00:00:00.000Z";
const PAST_ISO = "2026-07-01T00:00:00.000Z";
const FUTURE_ISO = "2026-08-01T00:00:00.000Z";

// ─── Fixtures ───────────────────────────────────────────────────────────────

function makeDoc(overrides: Partial<DocRecord> & { id: string; type: DocRecord["type"]; title: string; slug: string }): DocRecord {
  return {
    id: overrides.id,
    slug: overrides.slug as Slug,
    type: overrides.type,
    role: DOC_TYPE_ROLE_MAP[overrides.type],
    title: overrides.title,
    status: overrides.status ?? "approved",
    priority: overrides.priority ?? "medium",
    content: overrides.content ?? "# Doc\n\nBody.",
    parent_id: overrides.parent_id ?? null,
    created_at: overrides.created_at ?? PAST_ISO,
    updated_at: overrides.updated_at ?? PAST_ISO,
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

/** Minimal App stub — only `corpusService`/`outlineService` are real (mirrors
 *  validity-feed-and-judge.test.ts's makeApp). */
function makeApp(corpusService: CorpusService, outlineService: OutlineService): App {
  return {
    corpusService,
    reviewService: null as unknown as App["reviewService"],
    versionService: null as unknown as App["versionService"],
    outlineService,
    migrationService: null as unknown as App["migrationService"],
    treeCheckService: null as unknown as App["treeCheckService"],
    apiKeyStore: null as unknown as App["apiKeyStore"],
    aiProviderService: null as unknown as App["aiProviderService"],
    syncDocsService: null as unknown as App["syncDocsService"],
    exportDocsService: null as unknown as App["exportDocsService"],
    phaseService: null as unknown as App["phaseService"],
    taskWorkflowService: null as unknown as App["taskWorkflowService"],
    specKindService: null as unknown as App["specKindService"],
    judgmentService: null as unknown as App["judgmentService"],
    auditService: null as unknown as App["auditService"],
    callerSurface: "cli" as const,
    resolveAiDefault: () => ({ ai: false, source: "cli_flag" as const }),
    telemetry: new NoOpTelemetry(),
    close: () => undefined,
  };
}

function makeExportService(store: InMemoryStore): ExportDocsService {
  const outlineService = new OutlineService(store);
  const resolveDocBody: ResolveDocBody = async (doc) => {
    const resolved = await outlineService.resolve(doc);
    if (!resolved.ok) return resolved;
    return ok(renderResolvedToMarkdown(resolved.value));
  };
  return new ExportDocsService(store, resolveDocBody);
}

const tmpDirs: string[] = [];
function makeTempProjectDir(): string {
  const dir = join(tmpdir(), `lore-validity-projection-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(dir, ".lore"), { recursive: true });
  tmpDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore cleanup errors */
    }
  }
});

function extractBody(mdContent: string): string {
  const normalized = mdContent.replace(/\r\n/g, "\n");
  const match = normalized.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
  return match ? (match[1] ?? "") : normalized;
}

// ─── HAPPY: reason + resolvable successor ────────────────────────────────────

describe("renderDocMarkdown — HAPPY (reason + resolvable successor)", () => {
  it("banner carries both the successor slug and the reason, no dangling separators", async () => {
    const store = new InMemoryStore();
    const corpusService = new CorpusService(store);
    const outlineService = new OutlineService(store);
    const app = makeApp(corpusService, outlineService);

    const successor = await insertDoc(
      store,
      makeDoc({ id: "01J0000000000000000000SUCC", type: "knowledge", title: "Successor", slug: "knowledge-successor" }),
    );
    const doc = await insertDoc(
      store,
      makeDoc({
        id: "01J0000000000000000000OLD1",
        type: "knowledge",
        title: "Old Doc",
        slug: "knowledge-old",
        extra: { validity: { invalid_at: PAST_ISO, invalidated_by: successor.id, reason: "obsolete" } },
      }),
    );

    const rendered = await renderDocMarkdown(app, doc, () => NOW_ISO);
    expect(rendered).toContain(`> ⚠ INVALIDATED ${PAST_ISO}`);
    expect(rendered).toContain("— superseded by knowledge-successor");
    expect(rendered).toContain("; obsolete");
    expect(rendered.startsWith(">")).toBe(true);
    expect(rendered).toContain(doc.content);
  });
});

// ─── NEGATIVE: unresolvable successor ────────────────────────────────────────

describe("renderDocMarkdown — NEGATIVE (unresolvable successor)", () => {
  it("invalidated_by pointing to a nonexistent doc omits the superseded-by clause, never throws", async () => {
    const store = new InMemoryStore();
    const corpusService = new CorpusService(store);
    const outlineService = new OutlineService(store);
    const app = makeApp(corpusService, outlineService);

    const doc = await insertDoc(
      store,
      makeDoc({
        id: "01J0000000000000000000OLD2",
        type: "knowledge",
        title: "Old Doc 2",
        slug: "knowledge-old-2",
        extra: { validity: { invalid_at: PAST_ISO, invalidated_by: "01J0000000000000000NONEXIST" } },
      }),
    );

    const rendered = await renderDocMarkdown(app, doc, () => NOW_ISO);
    expect(rendered).toContain(`> ⚠ INVALIDATED ${PAST_ISO}`);
    expect(rendered).not.toContain("superseded by");
  });
});

// ─── BOUNDARY: no reason, no successor ───────────────────────────────────────

describe("renderDocMarkdown — BOUNDARY (bare banner)", () => {
  it("no reason and no successor → bare banner line, no dangling separator", async () => {
    const store = new InMemoryStore();
    const corpusService = new CorpusService(store);
    const outlineService = new OutlineService(store);
    const app = makeApp(corpusService, outlineService);

    const doc = await insertDoc(
      store,
      makeDoc({
        id: "01J0000000000000000000OLD3",
        type: "knowledge",
        title: "Old Doc 3",
        slug: "knowledge-old-3",
        extra: { validity: { invalid_at: PAST_ISO } },
      }),
    );

    const rendered = await renderDocMarkdown(app, doc, () => NOW_ISO);
    const bannerLine = rendered.split("\n\n")[0]!;
    expect(bannerLine).toBe(`> ⚠ INVALIDATED ${PAST_ISO}`);
    expect(bannerLine.endsWith("—")).toBe(false);
    expect(bannerLine.endsWith(";")).toBe(false);
  });
});

// ─── ERROR: malformed extra.validity degrades, never throws ─────────────────

describe("renderDocMarkdown — ERROR (malformed extra.validity)", () => {
  it("a wrong-typed invalid_at fails schema parsing and degrades to 'not invalidated' — no banner, no throw", async () => {
    const store = new InMemoryStore();
    const corpusService = new CorpusService(store);
    const outlineService = new OutlineService(store);
    const app = makeApp(corpusService, outlineService);

    const doc = await insertDoc(
      store,
      makeDoc({
        id: "01J0000000000000000000OLD4",
        type: "knowledge",
        title: "Old Doc 4",
        slug: "knowledge-old-4",
        // reason: invalid_at must be a string per validitySchema — a number fails
        // safeParse, so extractValidity (defensive degrade contract) returns
        // undefined, and isInvalidated treats the doc as currently valid.
        extra: { validity: { invalid_at: 12345 } },
      }),
    );

    await expect(renderDocMarkdown(app, doc, () => NOW_ISO)).resolves.not.toThrow;
    const rendered = await renderDocMarkdown(app, doc, () => NOW_ISO);
    expect(rendered).not.toContain("INVALIDATED");
    expect(rendered).toBe(doc.content);
  });
});

// ─── STATE: soft-deleted successor ───────────────────────────────────────────

describe("renderDocMarkdown — STATE (soft-deleted successor)", () => {
  it("a soft-deleted successor still resolves to its slug, with a (deleted) suffix", async () => {
    const store = new InMemoryStore();
    const corpusService = new CorpusService(store);
    const outlineService = new OutlineService(store);
    const app = makeApp(corpusService, outlineService);

    const successor = await insertDoc(
      store,
      makeDoc({
        id: "01J0000000000000000SUCCDEL",
        type: "knowledge",
        title: "Deleted Successor",
        slug: "knowledge-deleted-successor",
        deleted_at: NOW_ISO,
      }),
    );
    const doc = await insertDoc(
      store,
      makeDoc({
        id: "01J0000000000000000000OLD5",
        type: "knowledge",
        title: "Old Doc 5",
        slug: "knowledge-old-5",
        extra: { validity: { invalid_at: PAST_ISO, invalidated_by: successor.id } },
      }),
    );

    const rendered = await renderDocMarkdown(app, doc, () => NOW_ISO);
    expect(rendered).toContain("— superseded by knowledge-deleted-successor (deleted)");
  });
});

// ─── REGRESSION: valid doc → no banner (renderDocMarkdown) ──────────────────

describe("renderDocMarkdown — REGRESSION (valid doc)", () => {
  it("a doc with no extra.validity at all renders unchanged, no banner", async () => {
    const store = new InMemoryStore();
    const corpusService = new CorpusService(store);
    const outlineService = new OutlineService(store);
    const app = makeApp(corpusService, outlineService);

    const doc = await insertDoc(
      store,
      makeDoc({ id: "01J0000000000000000000VAL1", type: "knowledge", title: "Valid Doc", slug: "knowledge-valid" }),
    );

    const rendered = await renderDocMarkdown(app, doc, () => NOW_ISO);
    expect(rendered).toBe(doc.content);
    expect(rendered).not.toContain("INVALIDATED");
  });

  it("a FUTURE valid_at (not yet invalid) still renders unchanged — only invalid_at gates the banner", async () => {
    const store = new InMemoryStore();
    const corpusService = new CorpusService(store);
    const outlineService = new OutlineService(store);
    const app = makeApp(corpusService, outlineService);

    const doc = await insertDoc(
      store,
      makeDoc({
        id: "01J0000000000000000000VAL2",
        type: "knowledge",
        title: "Future Valid Doc",
        slug: "knowledge-future-valid",
        extra: { validity: { valid_at: FUTURE_ISO } },
      }),
    );

    const rendered = await renderDocMarkdown(app, doc, () => NOW_ISO);
    expect(rendered).toBe(doc.content);
  });
});

// ─── export-docs body: HAPPY + REGRESSION (T2 wiring site 2/3) ──────────────

describe("ExportDocsService — HAPPY (invalidated doc's written body carries the banner)", () => {
  it("the banner is prepended to the on-disk .md file body", async () => {
    const store = new InMemoryStore();
    const service = makeExportService(store);
    const projectDir = makeTempProjectDir();

    await insertDoc(
      store,
      makeDoc({
        id: "01J0000000000000000000EXP1",
        type: "knowledge",
        title: "Exported Invalidated Doc",
        slug: "knowledge-exported-invalidated",
        content: "# Body\n\nSome content.",
        extra: { validity: { invalid_at: PAST_ISO, reason: "superseded elsewhere" } },
      }),
    );

    const result = await service.exportDocs({ projectDir, dryRun: false }, () => NOW_ISO);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.created).toHaveLength(1);

    const filePath = join(projectDir, result.value.created[0]!);
    const fileMd = readFileSync(filePath, "utf8");
    const body = extractBody(fileMd);
    expect(body.startsWith(`> ⚠ INVALIDATED ${PAST_ISO}; superseded elsewhere`)).toBe(true);
    expect(body).toContain("Some content.");
  });
});

describe("ExportDocsService — REGRESSION (valid doc → no banner, idempotent re-run)", () => {
  it("a currently-valid doc's written body carries no banner, and a second run reports skipped_clean", async () => {
    const store = new InMemoryStore();
    const service = makeExportService(store);
    const projectDir = makeTempProjectDir();

    await insertDoc(
      store,
      makeDoc({
        id: "01J0000000000000000000EXP2",
        type: "knowledge",
        title: "Exported Valid Doc",
        slug: "knowledge-exported-valid",
        content: "# Body\n\nValid content.",
      }),
    );

    const firstRun = await service.exportDocs({ projectDir, dryRun: false }, () => NOW_ISO);
    expect(firstRun.ok).toBe(true);
    if (!firstRun.ok) return;
    expect(firstRun.value.created).toHaveLength(1);
    const filePath = join(projectDir, firstRun.value.created[0]!);
    const fileMd = readFileSync(filePath, "utf8");
    expect(extractBody(fileMd)).not.toContain("INVALIDATED");

    // Same-value-both-sides invariant (module header): re-running against an
    // unchanged doc must never report drift.
    const secondRun = await service.exportDocs({ projectDir, dryRun: false }, () => NOW_ISO);
    expect(secondRun.ok).toBe(true);
    if (!secondRun.ok) return;
    expect(secondRun.value.skipped_clean).toHaveLength(1);
    expect(secondRun.value.drift).toHaveLength(0);
  });
});
