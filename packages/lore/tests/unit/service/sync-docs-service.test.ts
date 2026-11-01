// @reads assets/templates/**
/**
 * Unit tests for SyncDocsService.
 * Uses InMemoryStore + Node.js temp directories with fixture spec files.
 * No SQLite dependency — runs under vitest.
 *
 * Coverage: AC-SD-1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15
 * Techniques: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION
 *
 * @spec_ref SPEC-018 §5
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { SyncDocsService } from "../../../src/service/sync-docs-service.js";
import type { CreateDocInput } from "@lore/core";
import { actedStore, liveWarn } from "../../live-invocation.js";
import { fillTemplate, wireStructuredCorpus } from "../../helpers/structured-corpus-wiring.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeServices() {
  const store = actedStore(new InMemoryStore());
  const corpus = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  const sync = new SyncDocsService(corpus);
  return { store, corpus, sync };
}

/** The structured content a synced spec file carries in its front matter (BR-1528), filled from the seeded `spec/feature` template. */
interface StructuredSpec {
  readonly fields: Record<string, unknown>;
  readonly dimensions: unknown[];
}

/** `makeServices` over a corpus armed with the template write path and the seeded templates, plus a valid `spec/feature` content. */
async function makeStructuredServices() {
  const services = makeServices();
  await wireStructuredCorpus(services.corpus, services.store);
  const resolved = await services.corpus.templateReader?.resolveTemplate("spec", "feature");
  if (resolved === undefined || !resolved.ok) throw new Error(`spec/feature template did not resolve: ${JSON.stringify(resolved)}`);
  const spec: StructuredSpec = fillTemplate(resolved.value.template, "feature");
  return { ...services, spec };
}

/** Create an isolated temp directory for spec files. Cleaned up after each test. */
const tmpDirs: string[] = [];
function makeTempDir(): string {
  const dir = join(tmpdir(), `lore-sync-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

/** Write a spec file with the given frontmatter fields and body. */
function writeSpecFile(
  dir: string,
  filename: string,
  opts: {
    type?: string;
    title?: string;
    parent?: string;
    tags?: string[];
    priority?: string;
    body?: string;
    /** A structured file: the content is the front matter's `fields:` / `dimensions:` (JSON is YAML) and the body is empty. */
    structured?: StructuredSpec;
    rawContent?: string; // override the entire file content
  },
): string {
  const filePath = join(dir, filename);
  if (opts.rawContent !== undefined) {
    writeFileSync(filePath, opts.rawContent, "utf8");
    return filePath;
  }

  const fm: string[] = ["---"];
  if (opts.type !== undefined) fm.push(`type: ${opts.type}`);
  if (opts.title !== undefined) fm.push(`title: "${opts.title}"`);
  if (opts.parent !== undefined) fm.push(`parent: "${opts.parent}"`);
  if (opts.priority !== undefined) fm.push(`priority: ${opts.priority}`);
  if (opts.tags !== undefined) fm.push(`tags: [${opts.tags.map((t) => `"${t}"`).join(", ")}]`);
  if (opts.structured !== undefined) {
    fm.push(`fields: ${JSON.stringify(opts.structured.fields)}`);
    fm.push(`dimensions: ${JSON.stringify(opts.structured.dimensions)}`);
  }
  fm.push("---");
  const body = opts.structured !== undefined ? "" : (opts.body ?? `# ${opts.title ?? "Spec"}\n\nSpec body content here.`);
  writeFileSync(filePath, fm.join("\n") + "\n" + body, "utf8");
  return filePath;
}

/** Create a PRD in the corpus and return its id. */
async function createPrd(corpus: CorpusService, title = "Product Requirements Document") {
  const input: CreateDocInput = { type: "prd", title };
  const result = await corpus.create(input);
  if (!result.ok) throw new Error(`Failed to create PRD: ${result.error.code}`);
  return result.value;
}

/** Create a spec in the corpus and return its record. */
async function createSpec(corpus: CorpusService, parentId: string, title: string, content = "spec body") {
  const input: CreateDocInput = { type: "spec", title,content };
  const result = await corpus.create(input);
  if (!result.ok) throw new Error(`Failed to create spec: ${result.error.code}`);
  return result.value;
}

// ─── AC-SD-1: creates new specs, exits 0 ─────────────────────────────────────

describe("spec-lore-sync-docs-backfill-new-spec-files-into-corpus#AC-SD-1 HAPPY — creates missing specs from files", () => {
  it("4 spec files, 0 in corpus → creates 4 rows", async () => {
    const { corpus, sync, spec } = await makeStructuredServices();
    const prd = await createPrd(corpus);
    const dir = makeTempDir();

    for (let i = 1; i <= 4; i++) {
      writeSpecFile(dir, `SPEC-00${i}-feature.md`, {
        type: "spec",
        title: `Feature Spec ${i}`,
        parent: prd.title,
        structured: spec,
      });
    }

    const result = await sync.run({ fromDir: dir, dryRun: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.scanned).toBe(4);
    expect(result.value.created).toHaveLength(4);
    expect(result.value.errors).toHaveLength(0);
    expect(result.value.matched_clean).toHaveLength(0);
  });

  it("newly created specs have the correct title in corpus", async () => {
    const { corpus, sync, spec } = await makeStructuredServices();
    const prd = await createPrd(corpus);
    const dir = makeTempDir();

    writeSpecFile(dir, "SPEC-001-auth.md", {
      type: "spec",
      title: "Auth Feature",
      parent: prd.title,
      structured: spec,
    });

    const result = await sync.run({ fromDir: dir, dryRun: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.created).toHaveLength(1);

    // Verify it's queryable by title
    const listResult = await corpus.list({ type: "spec" });
    expect(listResult.ok).toBe(true);
    if (!listResult.ok) return;
    const titles = listResult.value.docs.map((d) => d.title);
    expect(titles).toContain("Auth Feature");
  });
});

// ─── AC-SD-2: --dry-run creates 0 rows ───────────────────────────────────────

describe("spec-lore-sync-docs-backfill-new-spec-files-into-corpus#AC-SD-2 HAPPY — dry-run creates 0 rows", () => {
  it("dry-run reports created but writes nothing", async () => {
    const { corpus, sync, spec } = await makeStructuredServices();
    const prd = await createPrd(corpus);
    const dir = makeTempDir();

    writeSpecFile(dir, "SPEC-001-dry.md", {
      type: "spec",
      title: "Dry Run Spec",
      parent: prd.title,
      structured: spec,
    });

    const result = await sync.run({ fromDir: dir, dryRun: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Dry-run still reports "created" entries with "(dry-run)" slug
    expect(result.value.created).toHaveLength(1);
    expect(result.value.created[0]?.slug).toBe("(dry-run)");

    // But corpus should still be empty (no specs)
    const listResult = await corpus.list({ type: "spec" });
    expect(listResult.ok).toBe(true);
    if (!listResult.ok) return;
    expect(listResult.value.docs).toHaveLength(0);
  });
});

// ─── AC-SD-3: empty dir → 0 files, exit 0 ────────────────────────────────────

describe("spec-lore-sync-docs-backfill-new-spec-files-into-corpus#AC-SD-3 BOUNDARY — empty directory scans 0 files", () => {
  it("empty dir → scanned=0, no errors", async () => {
    const { sync } = makeServices();
    const dir = makeTempDir();

    const result = await sync.run({ fromDir: dir, dryRun: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.scanned).toBe(0);
    expect(result.value.created).toHaveLength(0);
    expect(result.value.errors).toHaveLength(0);
  });

  it("non-existent dir → scanned=0, no errors (spec-lore-sync-docs-backfill-new-spec-files-into-corpus#AC-SD-3 boundary)", async () => {
    const { sync } = makeServices();
    const result = await sync.run({ fromDir: "/nonexistent/path/xyz123", dryRun: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.scanned).toBe(0);
    expect(result.value.errors).toHaveLength(0);
  });
});

// ─── AC-SD-4: idempotency — re-running creates 0 rows ────────────────────────

describe("spec-lore-sync-docs-backfill-new-spec-files-into-corpus#AC-SD-4 STATE — idempotency: re-run creates 0 rows", () => {
  it("run twice on same files → second run creates 0, all matched_clean", async () => {
    const { corpus, sync, spec } = await makeStructuredServices();
    const prd = await createPrd(corpus);
    const dir = makeTempDir();

    writeSpecFile(dir, "SPEC-001.md", {
      type: "spec",
      title: "My Spec",
      parent: prd.title,
      structured: spec,
    });

    // First run
    const first = await sync.run({ fromDir: dir, dryRun: false });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.created).toHaveLength(1);

    // Second run — must create 0
    const second = await sync.run({ fromDir: dir, dryRun: false });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.created).toHaveLength(0);
    expect(second.value.matched_clean).toHaveLength(1);
    expect(second.value.errors).toHaveLength(0);
  });
});

// ─── AC-SD-6: drift detected, corpus body unchanged ──────────────────────────

describe("spec-lore-sync-docs-backfill-new-spec-files-into-corpus#AC-SD-6 STATE — drift reported but corpus body unchanged", () => {
  it("file body differs from corpus → matched_drift, corpus content unchanged", async () => {
    const { corpus, sync } = makeServices();
    const prd = await createPrd(corpus);
    // reason: canonicaliseBody is applied on write — corpus always stores body + "\n".
    const originalBody = "# Original Content\n\nThis is the original spec body.";
    const spec = await createSpec(corpus, prd.id, "Drifted Spec", originalBody);

    const dir = makeTempDir();
    writeSpecFile(dir, "SPEC-drifted.md", {
      type: "spec",
      title: "Drifted Spec",
      parent: prd.title,
      body: "# Drifted Content\n\nThis body is DIFFERENT from corpus.",
    });

    const result = await sync.run({ fromDir: dir, dryRun: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.matched_drift).toHaveLength(1);
    expect(result.value.matched_clean).toHaveLength(0);
    expect(result.value.created).toHaveLength(0);

    // Corpus body must be unchanged — canonicaliseBody is applied on write so stored value ends with "\n".
    const getResult = await corpus.get(spec.slug);
    expect(getResult.ok).toBe(true);
    if (!getResult.ok) return;
    expect(getResult.value.doc.content).toBe(originalBody + "\n");
  });

  it("drift comparison normalizes CRLF → LF on both sides (no false drift)", async () => {
    const { corpus, sync } = makeServices();
    const prd = await createPrd(corpus);
    // Corpus stored with LF
    const lfBody = "# Spec\n\nLF line endings.";
    await createSpec(corpus, prd.id, "CRLF Spec", lfBody);

    const dir = makeTempDir();
    // File written with CRLF
    const crlfBody = "# Spec\r\n\r\nLF line endings.";
    writeSpecFile(dir, "SPEC-crlf.md", {
      type: "spec",
      title: "CRLF Spec",
      parent: prd.title,
      body: crlfBody,
    });

    const result = await sync.run({ fromDir: dir, dryRun: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // After normalization, CRLF file matches LF corpus — should be clean, not drift
    expect(result.value.matched_clean).toHaveLength(1);
    expect(result.value.matched_drift).toHaveLength(0);
  });
});

// ─── AC-SD-7..10: a synced spec takes NO parent (BR-789, BR-2) ───────────────
//
// re-baseline (BR-789, BR-2): these four ACs used to pin PRD-parent resolution (single PRD →
// auto-parent, 2 PRDs → match the frontmatter title, no match / 0 PRDs → per-file error). A spec now
// takes no parent — it relates to the trees through criterion citations — so the sync creates every
// spec parentless and a frontmatter `parent:` is ignored with one stderr note. The PRD count of the
// corpus is irrelevant, so the ambiguity and no-PRD errors no longer exist.

/** Reads one created spec back through the corpus and returns its parent_id. */
async function parentIdOfSlug(corpus: CorpusService, slug: string): Promise<string | null> {
  const got = await corpus.get(slug);
  if (!got.ok) throw new Error(`get ${slug} failed: ${got.error.code}`);
  return got.value.doc.parent_id;
}

describe("spec-lore-sync-docs-backfill-new-spec-files-into-corpus#AC-SD-7 HAPPY — single PRD in corpus is NOT used as a parent", () => {
  it("1 PRD → the spec is created with parent_id null, whatever the frontmatter says", async () => {
    const { corpus, sync, spec } = await makeStructuredServices();
    await createPrd(corpus, "The Only PRD");
    const dir = makeTempDir();

    writeSpecFile(dir, "SPEC-001.md", {
      type: "spec",
      title: "Auth Spec",
      parent: "The Only PRD",
      structured: spec,
    });

    const result = await sync.run({ fromDir: dir, dryRun: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.created).toHaveLength(1);
    expect(result.value.errors).toHaveLength(0);

    const listResult = await corpus.list({ type: "spec" });
    expect(listResult.ok).toBe(true);
    if (!listResult.ok) return;
    expect(listResult.value.docs[0]?.title).toBe("Auth Spec");
    expect(await parentIdOfSlug(corpus, listResult.value.docs[0]!.slug)).toBeNull();
  });
});

describe("spec-lore-sync-docs-backfill-new-spec-files-into-corpus#AC-SD-8 HAPPY — 2 PRDs, a matching frontmatter parent is ignored", () => {
  it("2 PRDs and a matching parent hint → parentless spec, one stderr note", async () => {
    const { corpus, sync, spec } = await makeStructuredServices();
    await createPrd(corpus, "PRD-001");
    await createPrd(corpus, "PRD-002");
    const dir = makeTempDir();

    writeSpecFile(dir, "SPEC-001.md", {
      type: "spec",
      title: "Scoped Spec",
      parent: "PRD-001",
      structured: spec,
    });

    const notes: string[] = [];
    const realWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array): boolean => {
      notes.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    let result;
    try {
      result = await sync.run({ fromDir: dir, dryRun: false, warn: liveWarn() });
    } finally {
      process.stderr.write = realWrite;
    }
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.created).toHaveLength(1);
    expect(result.value.errors).toHaveLength(0);
    expect(await parentIdOfSlug(corpus, "spec-scoped-spec")).toBeNull();
    expect(notes.filter((n) => n.includes("ignoring frontmatter parent"))).toHaveLength(1);
  });
});

describe("spec-lore-sync-docs-backfill-new-spec-files-into-corpus#AC-SD-9 NEGATIVE — 2 PRDs and an unmatched parent is no longer an error", () => {
  it("2 PRDs + a hint matching neither → both files are created parentless, no error", async () => {
    const { corpus, sync, spec } = await makeStructuredServices();
    await createPrd(corpus, "PRD-001");
    await createPrd(corpus, "PRD-002");
    const dir = makeTempDir();

    writeSpecFile(dir, "SPEC-ambiguous.md", {
      type: "spec",
      title: "Ambiguous Spec",
      parent: "ghost",
      structured: spec,
    });
    writeSpecFile(dir, "SPEC-valid.md", {
      type: "spec",
      title: "Valid Spec",
      parent: "PRD-001",
      structured: spec,
    });

    const result = await sync.run({ fromDir: dir, dryRun: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.errors).toHaveLength(0);
    expect(result.value.created).toHaveLength(2);
    for (const entry of result.value.created) {
      expect(await parentIdOfSlug(corpus, entry.slug)).toBeNull();
    }
  });
});

describe("spec-lore-sync-docs-backfill-new-spec-files-into-corpus#AC-SD-10 BOUNDARY — a corpus with 0 PRDs still accepts synced specs", () => {
  it("no PRD in corpus → the spec is created parentless, no error", async () => {
    const { corpus, sync, spec } = await makeStructuredServices();
    const dir = makeTempDir();

    writeSpecFile(dir, "SPEC-001.md", {
      type: "spec",
      title: "Standalone Spec",
      structured: spec,
    });

    const result = await sync.run({ fromDir: dir, dryRun: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.errors).toHaveLength(0);
    expect(result.value.created).toHaveLength(1);
    expect(await parentIdOfSlug(corpus, result.value.created[0]!.slug)).toBeNull();
  });
});

// ─── AC-SD-11: missing frontmatter → VALIDATION_ERROR ────────────────────────

describe("spec-lore-sync-docs-backfill-new-spec-files-into-corpus#AC-SD-11 ERROR — file without frontmatter → error, others still process", () => {
  it("file without --- delimiters → error for that file", async () => {
    const { corpus, sync, spec } = await makeStructuredServices();
    const prd = await createPrd(corpus);
    const dir = makeTempDir();

    // File without frontmatter
    writeFileSync(join(dir, "SPEC-nofm.md"), "# No Frontmatter\n\nJust content.\n", "utf8");

    // Valid spec
    writeSpecFile(dir, "SPEC-valid.md", {
      type: "spec",
      title: "Valid Spec",
      parent: prd.title,
      structured: spec,
    });

    const result = await sync.run({ fromDir: dir, dryRun: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // One error, one created
    expect(result.value.errors).toHaveLength(1);
    expect(result.value.errors[0]?.file).toContain("SPEC-nofm.md");
    expect(result.value.created).toHaveLength(1);
  });
});

// ─── AC-SD-12: type != "spec" → VALIDATION_ERROR ─────────────────────────────

describe("spec-lore-sync-docs-backfill-new-spec-files-into-corpus#AC-SD-12 ERROR — type=knowledge skips file with error", () => {
  it("file with type: knowledge → VALIDATION_ERROR", async () => {
    const { corpus, sync } = makeServices();
    await createPrd(corpus);
    const dir = makeTempDir();

    writeSpecFile(dir, "SPEC-knowledge.md", {
      type: "knowledge",
      title: "A Knowledge Doc",
      body: "# Knowledge\n\nBody.",
    });

    const result = await sync.run({ fromDir: dir, dryRun: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.errors).toHaveLength(1);
    expect(result.value.errors[0]?.error).toContain("type=");
    expect(result.value.created).toHaveLength(0);
  });
});

// ─── AC-SD-13: malformed YAML → VALIDATION_ERROR ─────────────────────────────

describe("spec-lore-sync-docs-backfill-new-spec-files-into-corpus#AC-SD-13 ERROR — malformed YAML frontmatter → error, others still process", () => {
  it("invalid YAML → error for that file", async () => {
    const { corpus, sync, spec } = await makeStructuredServices();
    const prd = await createPrd(corpus);
    const dir = makeTempDir();

    // Malformed YAML: unmatched colon without space, bracket mismatch, etc.
    writeSpecFile(dir, "SPEC-bad-yaml.md", {
      rawContent: "---\ntype: spec\ntitle: \"Broken YAML\nparent: [unclosed\n---\n# Broken\n\nBody.",
    });

    // Valid spec
    writeSpecFile(dir, "SPEC-good.md", {
      type: "spec",
      title: "Good Spec",
      parent: prd.title,
      structured: spec,
    });

    const result = await sync.run({ fromDir: dir, dryRun: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.errors).toHaveLength(1);
    expect(result.value.errors[0]?.file).toContain("SPEC-bad-yaml.md");
    expect(result.value.created).toHaveLength(1);
  });
});

// ─── AC-SD-14: SyncDocsService constructor takes only CorpusService ──────────

describe("spec-lore-sync-docs-backfill-new-spec-files-into-corpus#AC-SD-14 BOUNDARY — SyncDocsService accepts only CorpusService", () => {
  it("constructor has exactly one parameter: CorpusService", () => {
    const store = actedStore(new InMemoryStore());
    const corpus = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    // If this compiles and constructs, the invariant holds
    const service = new SyncDocsService(corpus);
    expect(service).toBeDefined();
    expect(typeof service.run).toBe("function");
  });
});

// ─── AC-SD-15: sync-docs does NOT call aiProviderService ─────────────────────

describe("spec-lore-sync-docs-backfill-new-spec-files-into-corpus#AC-SD-15 BOUNDARY — sync-docs does not invoke aiProviderService", () => {
  it("grep: sync-docs-service.ts must not call or import AIProviderService", () => {
    // Structural assertion per AC-SD-15: verify no code calls or imports the AI provider.
    // Comments that document the invariant (mentioning the field name) are intentionally
    // excluded from this check — we grep for actual call/import patterns only.
    const { readFileSync: readFile } = require("fs");
    const { join: pathJoin } = require("path");
    // Navigate from tests/unit/service/ to src/service/
    const serviceFile = pathJoin(
      import.meta.dirname,
      "../../../src/service/sync-docs-service.ts",
    );
    const content: string = readFile(serviceFile, "utf8");
    // Must not import AIProviderService
    expect(content).not.toMatch(/import.*AIProviderService/);
    // Must not call or access aiProviderService on any object
    expect(content).not.toMatch(/\.\s*aiProviderService/);
    // Must not call AI generate / completion methods
    expect(content).not.toMatch(/\.generate\(|\.complete\(|buildProviderRegistry/);
  });
});

// ─── REGRESSION — non-.md files in the directory are ignored ────────────────

describe("REGRESSION — non-.md files are ignored", () => {
  it("txt and json files in scan dir are skipped", async () => {
    const { corpus, sync, spec } = await makeStructuredServices();
    const prd = await createPrd(corpus);
    const dir = makeTempDir();

    writeFileSync(join(dir, "README.txt"), "just text\n", "utf8");
    writeFileSync(join(dir, "config.json"), '{"key":"val"}', "utf8");
    writeSpecFile(dir, "SPEC-001.md", {
      type: "spec",
      title: "Only Spec",
      parent: prd.title,
      structured: spec,
    });

    const result = await sync.run({ fromDir: dir, dryRun: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Only the .md file is scanned
    expect(result.value.scanned).toBe(1);
    expect(result.value.created).toHaveLength(1);
  });
});

// ─── BR-1528: a new spec is created structured; a free-body file is refused loudly ─────────────────────────────────

describe("spec-every-document-is-stored-as-structured-fields-validated-by#BR-1528 sync-docs creates structured specs only", () => {
  it("NEGATIVE: a new file with no `fields:` is a per-file error, dry-run included, and nothing is created", async () => {
    const { corpus, sync } = await makeStructuredServices();
    const dir = makeTempDir();
    writeSpecFile(dir, "SPEC-free.md", { type: "spec", title: "Free Body Spec", body: "# Free\n\nA free body." });

    for (const dryRun of [true, false]) {
      const result = await sync.run({ fromDir: dir, dryRun });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.created).toHaveLength(0);
      expect(result.value.errors).toHaveLength(1);
      expect(result.value.errors[0]?.error).toContain("no `fields:`");
    }
    const listed = await corpus.list({ type: "spec" });
    expect(listed.ok && listed.value.docs).toHaveLength(0);
  });

  it("NEGATIVE: a file with `fields:` AND a markdown body is refused (the body is rendered, never supplied)", async () => {
    const { sync, spec } = await makeStructuredServices();
    const dir = makeTempDir();
    writeSpecFile(dir, "SPEC-both.md", { type: "spec", title: "Both Spec", structured: spec });
    // a hand-built file: same front matter plus a body
    const path = join(dir, "SPEC-both.md");
    writeFileSync(path, `${(await import("fs")).readFileSync(path, "utf8")}\n# Hand written\n`, "utf8");

    const result = await sync.run({ fromDir: dir, dryRun: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.created).toHaveLength(0);
    expect(result.value.errors[0]?.error).toContain("body must be empty");
  });

  it("ERROR: invalid fields are refused by the template with every problem named, nothing is created", async () => {
    const { corpus, sync, spec } = await makeStructuredServices();
    const dir = makeTempDir();
    writeSpecFile(dir, "SPEC-bad.md", { type: "spec", title: "Bad Fields Spec", structured: { fields: { goal: "not an object" }, dimensions: spec.dimensions } });

    const result = await sync.run({ fromDir: dir, dryRun: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.created).toHaveLength(0);
    expect(result.value.errors[0]?.error).toContain("does not satisfy");
    const listed = await corpus.list({ type: "spec" });
    expect(listed.ok && listed.value.docs).toHaveLength(0);
  });

  it("STATE: the created spec pins the approved template and a re-run against changed fields reports drift", async () => {
    const { corpus, sync, spec } = await makeStructuredServices();
    const dir = makeTempDir();
    writeSpecFile(dir, "SPEC-pin.md", { type: "spec", title: "Pinned Spec", structured: spec });
    const first = await sync.run({ fromDir: dir, dryRun: false });
    expect(first.ok && first.value.created).toHaveLength(1);
    const slug = first.ok ? first.value.created[0]!.slug : "";
    const got = await corpus.get(slug);
    expect(got.ok && (got.value.doc.extra as { template_ref?: string }).template_ref).toBe("spec-feature-template@2");

    writeSpecFile(dir, "SPEC-pin.md", { type: "spec", title: "Pinned Spec", structured: { fields: { ...spec.fields, goal: { statement: "A changed goal", measure: "changed" } }, dimensions: spec.dimensions } });
    const second = await sync.run({ fromDir: dir, dryRun: false });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.created).toHaveLength(0);
    expect(second.value.matched_drift).toHaveLength(1);
  });
});
