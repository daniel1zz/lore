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

import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { SyncDocsService } from "../../../src/service/sync-docs-service.js";
import type { CreateDocInput } from "@lore/core";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeServices() {
  const store = new InMemoryStore();
  const corpus = new CorpusService(store);
  const sync = new SyncDocsService(corpus);
  return { store, corpus, sync };
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
  fm.push("---");
  const body = opts.body ?? `# ${opts.title ?? "Spec"}\n\nSpec body content here.`;
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
  const input: CreateDocInput = { type: "spec", title, parent_id: parentId, content };
  const result = await corpus.create(input);
  if (!result.ok) throw new Error(`Failed to create spec: ${result.error.code}`);
  return result.value;
}

// ─── AC-SD-1: creates new specs, exits 0 ─────────────────────────────────────

describe("AC-SD-1 HAPPY — creates missing specs from files", () => {
  it("4 spec files, 0 in corpus → creates 4 rows", async () => {
    const { corpus, sync } = makeServices();
    const prd = await createPrd(corpus);
    const dir = makeTempDir();

    for (let i = 1; i <= 4; i++) {
      writeSpecFile(dir, `SPEC-00${i}-feature.md`, {
        type: "spec",
        title: `Feature Spec ${i}`,
        parent: prd.title,
        body: `# Feature Spec ${i}\n\nBody content.`,
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
    const { corpus, sync } = makeServices();
    const prd = await createPrd(corpus);
    const dir = makeTempDir();

    writeSpecFile(dir, "SPEC-001-auth.md", {
      type: "spec",
      title: "Auth Feature",
      parent: prd.title,
      body: "# Auth Feature\n\nBody here.",
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

describe("AC-SD-2 HAPPY — dry-run creates 0 rows", () => {
  it("dry-run reports created but writes nothing", async () => {
    const { corpus, sync } = makeServices();
    const prd = await createPrd(corpus);
    const dir = makeTempDir();

    writeSpecFile(dir, "SPEC-001-dry.md", {
      type: "spec",
      title: "Dry Run Spec",
      parent: prd.title,
      body: "# Dry Run Spec\n\nBody.",
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

describe("AC-SD-3 BOUNDARY — empty directory scans 0 files", () => {
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

  it("non-existent dir → scanned=0, no errors (AC-SD-3 boundary)", async () => {
    const { sync } = makeServices();
    const result = await sync.run({ fromDir: "/nonexistent/path/xyz123", dryRun: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.scanned).toBe(0);
    expect(result.value.errors).toHaveLength(0);
  });
});

// ─── AC-SD-4: idempotency — re-running creates 0 rows ────────────────────────

describe("AC-SD-4 STATE — idempotency: re-run creates 0 rows", () => {
  it("run twice on same files → second run creates 0, all matched_clean", async () => {
    const { corpus, sync } = makeServices();
    const prd = await createPrd(corpus);
    const dir = makeTempDir();
    const body = "# My Spec\n\nBody content.";

    writeSpecFile(dir, "SPEC-001.md", {
      type: "spec",
      title: "My Spec",
      parent: prd.title,
      body,
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

describe("AC-SD-6 STATE — drift reported but corpus body unchanged", () => {
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

// ─── AC-SD-7: exactly 1 PRD → use it for all synced specs ───────────────────

describe("AC-SD-7 HAPPY — single PRD in corpus used for all specs", () => {
  it("1 PRD → specs created with that PRD as parent regardless of frontmatter", async () => {
    const { corpus, sync } = makeServices();
    const prd = await createPrd(corpus, "The Only PRD");
    const dir = makeTempDir();

    // Frontmatter parent doesn't match PRD title — but with single PRD it's ignored
    writeSpecFile(dir, "SPEC-001.md", {
      type: "spec",
      title: "Auth Spec",
      parent: "Some Other PRD Title",
      body: "# Auth Spec\n\nBody.",
    });

    const result = await sync.run({ fromDir: dir, dryRun: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.created).toHaveLength(1);
    expect(result.value.errors).toHaveLength(0);

    // Verify the created spec has the PRD as parent
    const listResult = await corpus.list({ type: "spec" });
    expect(listResult.ok).toBe(true);
    if (!listResult.ok) return;
    expect(listResult.value.docs[0]?.title).toBe("Auth Spec");

    const getResult = await corpus.get(listResult.value.docs[0]!.slug);
    expect(getResult.ok).toBe(true);
    if (!getResult.ok) return;
    expect(getResult.value.doc.parent_id).toBe(prd.id);
  });
});

// ─── AC-SD-8: ≥2 PRDs, frontmatter parent matches one PRD title ─────────────

describe("AC-SD-8 HAPPY — 2 PRDs, frontmatter parent matches one by title", () => {
  it("2 PRDs and matching parent hint → correct PRD selected", async () => {
    const { corpus, sync } = makeServices();
    const prd1 = await createPrd(corpus, "PRD-001");
    await createPrd(corpus, "PRD-002");
    const dir = makeTempDir();

    writeSpecFile(dir, "SPEC-001.md", {
      type: "spec",
      title: "Scoped Spec",
      parent: "PRD-001",
      body: "# Scoped Spec\n\nBody.",
    });

    const result = await sync.run({ fromDir: dir, dryRun: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.created).toHaveLength(1);
    expect(result.value.errors).toHaveLength(0);

    // Verify spec has prd1 as parent
    const getResult = await corpus.get("spec-scoped-spec");
    expect(getResult.ok).toBe(true);
    if (!getResult.ok) return;
    expect(getResult.value.doc.parent_id).toBe(prd1.id);
  });
});

// ─── AC-SD-9: ≥2 PRDs, frontmatter parent matches none → VALIDATION_ERROR ───

describe("AC-SD-9 NEGATIVE — 2 PRDs, no matching parent → error for that file, others process", () => {
  it("2 PRDs + ambiguous parent → error for that file; second valid file still created", async () => {
    const { corpus, sync } = makeServices();
    await createPrd(corpus, "PRD-001");
    await createPrd(corpus, "PRD-002");
    const dir = makeTempDir();

    // Ambiguous — parent doesn't match either PRD title
    writeSpecFile(dir, "SPEC-ambiguous.md", {
      type: "spec",
      title: "Ambiguous Spec",
      parent: "ghost",
      body: "# Ambiguous\n\nBody.",
    });

    // Valid — parent matches PRD-001
    writeSpecFile(dir, "SPEC-valid.md", {
      type: "spec",
      title: "Valid Spec",
      parent: "PRD-001",
      body: "# Valid\n\nBody.",
    });

    const result = await sync.run({ fromDir: dir, dryRun: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Valid file created, ambiguous file reported as error
    expect(result.value.errors).toHaveLength(1);
    expect(result.value.errors[0]?.file).toContain("SPEC-ambiguous.md");
    expect(result.value.created).toHaveLength(1);
    expect(result.value.created[0]?.slug).not.toContain("ambiguous");
  });
});

// ─── AC-SD-10: 0 PRDs → VALIDATION_ERROR ────────────────────────────────────

describe("AC-SD-10 NEGATIVE — 0 PRDs in corpus → error per file", () => {
  it("no PRD in corpus → each spec file gets VALIDATION_ERROR in errors", async () => {
    const { sync } = makeServices();
    const dir = makeTempDir();

    writeSpecFile(dir, "SPEC-001.md", {
      type: "spec",
      title: "Orphan Spec",
      body: "# Orphan\n\nBody.",
    });

    const result = await sync.run({ fromDir: dir, dryRun: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.errors).toHaveLength(1);
    expect(result.value.errors[0]?.error).toContain("no PRD in corpus");
    expect(result.value.created).toHaveLength(0);
  });
});

// ─── AC-SD-11: missing frontmatter → VALIDATION_ERROR ────────────────────────

describe("AC-SD-11 ERROR — file without frontmatter → error, others still process", () => {
  it("file without --- delimiters → error for that file", async () => {
    const { corpus, sync } = makeServices();
    const prd = await createPrd(corpus);
    const dir = makeTempDir();

    // File without frontmatter
    writeFileSync(join(dir, "SPEC-nofm.md"), "# No Frontmatter\n\nJust content.\n", "utf8");

    // Valid spec
    writeSpecFile(dir, "SPEC-valid.md", {
      type: "spec",
      title: "Valid Spec",
      parent: prd.title,
      body: "# Valid\n\nBody.",
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

describe("AC-SD-12 ERROR — type=knowledge skips file with error", () => {
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

describe("AC-SD-13 ERROR — malformed YAML frontmatter → error, others still process", () => {
  it("invalid YAML → error for that file", async () => {
    const { corpus, sync } = makeServices();
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
      body: "# Good\n\nBody.",
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

describe("AC-SD-14 BOUNDARY — SyncDocsService accepts only CorpusService", () => {
  it("constructor has exactly one parameter: CorpusService", () => {
    const store = new InMemoryStore();
    const corpus = new CorpusService(store);
    // If this compiles and constructs, the invariant holds
    const service = new SyncDocsService(corpus);
    expect(service).toBeDefined();
    expect(typeof service.run).toBe("function");
  });
});

// ─── AC-SD-15: sync-docs does NOT call aiProviderService ─────────────────────

describe("AC-SD-15 BOUNDARY — sync-docs does not invoke aiProviderService", () => {
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
    const { corpus, sync } = makeServices();
    const prd = await createPrd(corpus);
    const dir = makeTempDir();

    writeFileSync(join(dir, "README.txt"), "just text\n", "utf8");
    writeFileSync(join(dir, "config.json"), '{"key":"val"}', "utf8");
    writeSpecFile(dir, "SPEC-001.md", {
      type: "spec",
      title: "Only Spec",
      parent: prd.title,
      body: "# Only Spec\n\nBody.",
    });

    const result = await sync.run({ fromDir: dir, dryRun: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Only the .md file is scanned
    expect(result.value.scanned).toBe(1);
    expect(result.value.created).toHaveLength(1);
  });
});
