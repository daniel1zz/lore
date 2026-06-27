/**
 * @spec_ref AC-E2E-001
 *
 * End-to-end CLI integration tests — subprocess-level black-box verification.
 *
 * Covers all AC items from SPEC-003 §7.2 (end-to-end perspective):
 *   AC-E2E-001.01  lore init creates .lore/ with lore.db and config.yaml
 *   AC-E2E-001.02  lore get <slug> displays doc with navigation footer
 *   AC-E2E-001.03  lore get <slug> --json outputs structured JSON envelope
 *   AC-E2E-001.N01 lore get NONEXISTENT exits code 3
 *   AC-E2E-001.04  lore create <type> creates document, returns slug
 *   AC-E2E-001.05  lore list --type <t> returns only matching documents
 *   AC-E2E-001.06  lore list --json is jq-composable (each doc has extractable id)
 *   AC-E2E-001.07  lore delete without --confirm exits code 4
 *   AC-E2E-001.08  lore pending → approve removes doc from pending
 *   AC-E2E-001.09  lore log / diff show version history after update
 *   AC-E2E-001.10  lore status --json returns corpus counts
 *   AC-E2E-001.11  lore tree --json shows parent-child hierarchy
 *
 * Uses Bun.spawnSync — each test suite gets an isolated temp directory.
 * Run with: bun test tests/e2e/
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, existsSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// ─── Types ──────────────────────────────────────────────────────────────────

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

interface JsonEnvelope<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const PROJECT_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PROJECT_ROOT, "src", "index.ts");

/**
 * Create a module-level fake editor script that writes "test content" to its first arg.
 * reason: lore create now opens $EDITOR when --content is absent (SPEC-003 §3.1).
 * E2e tests run as subprocesses (no TTY) so vi would fail. We provide a deterministic
 * fake editor via EDITOR env var injected in runLore to avoid blocking on a real editor.
 * The script is created once and reused across all e2e tests.
 */
const FAKE_EDITOR_DIR = join(tmpdir(), "lore-e2e-fake-editor");
mkdirSync(FAKE_EDITOR_DIR, { recursive: true });
const FAKE_EDITOR_PATH = join(FAKE_EDITOR_DIR, "editor.sh");
writeFileSync(
  FAKE_EDITOR_PATH,
  "#!/bin/sh\nprintf 'test content' > \"$1\"\n",
  { mode: 0o755 },
);

/**
 * Run `bun run src/index.ts ...args` in `cwd`.
 * HOME is overridden to `cwd` to isolate global config files.
 * EDITOR is set to a fake script so lore create's editor flow works in non-interactive mode.
 */
function runLore(args: string[], cwd: string): RunResult {
  const proc = Bun.spawnSync(["bun", "run", INDEX_TS, ...args], {
    cwd,
    env: { ...process.env, HOME: cwd, EDITOR: FAKE_EDITOR_PATH },
  });
  return {
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    exitCode: proc.exitCode ?? 1,
  };
}

/** Parse stdout as a JSON envelope, throwing with context on failure. */
function parseJson<T = unknown>(result: RunResult): JsonEnvelope<T> {
  try {
    return JSON.parse(result.stdout) as JsonEnvelope<T>;
  } catch {
    throw new Error(
      `Expected JSON in stdout but got:\n${result.stdout}\nstderr: ${result.stderr}`,
    );
  }
}

/** Create a unique temp directory for an isolated test. */
function makeTempDir(label: string): string {
  const dir = join(tmpdir(), `lore-e2e-${label}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Remove a temp directory, ignoring errors (best-effort cleanup). */
function cleanupDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

// ─── Scenario 1: Init flow (AC-E2E-001.01) ───────────────────────────────────

describe("Scenario 1: init flow", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir("init");
  });

  afterEach(() => {
    cleanupDir(tmpDir);
  });

  it("HAPPY: creates .lore/lore.db and config.yaml (AC-E2E-001.01)", () => {
    const result = runLore(["init"], tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Initialised Lore project");
    expect(existsSync(join(tmpDir, ".lore", "lore.db"))).toBe(true);
    expect(existsSync(join(tmpDir, ".lore", "config.yaml"))).toBe(true);
  });

  it("HAPPY: init --json outputs valid JSON with path info", () => {
    const result = runLore(["init", "--json"], tmpDir);

    expect(result.exitCode).toBe(0);
    const json = parseJson<{ path: string; project: string; author: string }>(result);
    expect(json.ok).toBe(true);
    expect(json.data!.path).toContain(".lore");
    expect(typeof json.data!.project).toBe("string");
  });

  it("NEGATIVE: running init twice exits non-zero with 'already initialised' (AC-E2E-001.01)", () => {
    // First init succeeds
    const first = runLore(["init"], tmpDir);
    expect(first.exitCode).toBe(0);

    // Second init should fail
    const second = runLore(["init"], tmpDir);
    expect(second.exitCode).not.toBe(0);
    expect(second.stderr + second.stdout).toContain("already initialised");
  });

  it("NEGATIVE: any command before init exits 1 with helpful message", () => {
    const result = runLore(["list"], tmpDir);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("No Lore database found");
    expect(result.stderr).toContain("lore init");
  });

  // BOUNDARY: N/A — init has no numeric/collection params
  // ERROR: N/A — filesystem permission errors require OS-level mocking
  // STATE: N/A — filesystem is the state; tested via existence checks
  // REGRESSION: N/A — no known regressions
});

// ─── Scenario 2: Full CRUD lifecycle (AC-E2E-001.02..04, AC-E2E-001.07) ──────

describe("Scenario 2: full CRUD lifecycle", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir("crud");
    runLore(["init"], tmpDir);
  });

  afterEach(() => {
    cleanupDir(tmpDir);
  });

  it("HAPPY: create → get → set → delete full lifecycle", () => {
    // Create (AC-E2E-001.04)
    const createResult = runLore(["create", "prd", "--title", "Test PRD", "--json"], tmpDir);
    expect(createResult.exitCode).toBe(0);
    const created = parseJson<{ id: string; slug: string; title: string; status: string }>(
      createResult,
    );
    expect(created.ok).toBe(true);
    expect(created.data!.slug).toBe("prd-test-prd");
    expect(created.data!.status).toBe("draft");

    const slug = created.data!.slug;

    // Get by slug — human-readable (AC-E2E-001.02)
    const getResult = runLore(["get", slug], tmpDir);
    expect(getResult.exitCode).toBe(0);
    expect(getResult.stdout).toContain("Test PRD");
    expect(getResult.stdout).toContain("Navigation");

    // Get --json (AC-E2E-001.03)
    const getJsonResult = runLore(["get", slug, "--json"], tmpDir);
    expect(getJsonResult.exitCode).toBe(0);
    const getJson = parseJson<{ doc: { title: string }; navigation: unknown }>(getJsonResult);
    expect(getJson.ok).toBe(true);
    expect(getJson.data!.doc.title).toBe("Test PRD");
    expect(getJson.data!.navigation).toBeDefined();

    // Set title
    const setResult = runLore(["set", slug, "--title", "Updated Title"], tmpDir);
    expect(setResult.exitCode).toBe(0);
    expect(setResult.stdout).toContain("Updated");

    // Verify updated title persisted
    const getAfterSetResult = runLore(["get", slug, "--json"], tmpDir);
    const afterSet = parseJson<{ doc: { title: string } }>(getAfterSetResult);
    expect(afterSet.data!.doc.title).toBe("Updated Title");

    // Delete without --confirm (AC-E2E-001.07) — must fail with code 4
    const deleteNoConfirm = runLore(["delete", slug], tmpDir);
    expect(deleteNoConfirm.exitCode).toBe(4);
    expect(deleteNoConfirm.stderr).toContain("requires confirmation");
    expect(deleteNoConfirm.stderr).toContain("--confirm");

    // Delete with --confirm
    const deleteResult = runLore(["delete", slug, "--confirm"], tmpDir);
    expect(deleteResult.exitCode).toBe(0);
    expect(deleteResult.stdout).toContain("Deleted");
  });

  it("HAPPY: create outputs slug in human-readable mode", () => {
    const result = runLore(["create", "prd", "--title", "My Document"], tmpDir);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("prd-my-document");
    expect(result.stdout).toContain("Created prd document");
  });

  it("HAPPY: create spec with --parent links to parent", () => {
    const prdResult = runLore(["create", "prd", "--title", "Parent PRD", "--json"], tmpDir);
    const prd = parseJson<{ id: string; slug: string }>(prdResult).data!;

    const specResult = runLore(
      ["create", "spec", "--title", "Child Spec", "--parent", prd.slug, "--json"],
      tmpDir,
    );
    expect(specResult.exitCode).toBe(0);
    const spec = parseJson<{ parent_id: string }>(specResult).data!;
    expect(spec.parent_id).toBe(prd.id);
  });

  it("NEGATIVE: get nonexistent doc exits code 3 with error message (AC-E2E-001.N01)", () => {
    const result = runLore(["get", "nonexistent-slug"], tmpDir);
    expect(result.exitCode).toBe(3);
    expect(result.stderr).toContain("not found");
  });

  it("NEGATIVE: create without --title exits code 2", () => {
    const result = runLore(["create", "prd"], tmpDir);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--title");
  });

  it("NEGATIVE: create with invalid type exits code 2", () => {
    const result = runLore(["create", "foobar", "--title", "X"], tmpDir);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("Invalid type");
  });

  it("HAPPY: set with --content flag updates the content field", () => {
    // reason: lore set <id> with no flags now opens $EDITOR (SPEC-003 §3.1 AC-SET-1).
    // The old "exits code 2 when no flags" behaviour is gone; editor-flow is tested in
    // unit/adapters/cli-editor-integration.bun.test.ts. This e2e test verifies the
    // --content flag path still works correctly in the subprocess context.
    const createResult = runLore(["create", "prd", "--title", "Setme", "--json"], tmpDir);
    const slug = parseJson<{ slug: string }>(createResult).data!.slug;

    const result = runLore(["set", slug, "--content", "updated body"], tmpDir);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Updated");
  });

  it("BOUNDARY: title with special characters round-trips correctly", () => {
    const result = runLore(["create", "prd", "--title", "Test: Edge & Cases", "--json"], tmpDir);
    expect(result.exitCode).toBe(0);
    const doc = parseJson<{ title: string }>(result).data!;
    expect(doc.title).toBe("Test: Edge & Cases");
  });

  // ERROR: N/A — DB errors require controlled storage mocking
  // STATE: delete without confirm is a state guard — covered above
  // REGRESSION: N/A — no known regressions
});

// ─── Scenario 3: Spec with parent + tree (AC-E2E-001.11) ─────────────────────

describe("Scenario 3: spec with parent and tree hierarchy", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir("parent");
    runLore(["init"], tmpDir);
  });

  afterEach(() => {
    cleanupDir(tmpDir);
  });

  it("HAPPY: tree --json shows PRD with spec as child (AC-E2E-001.11)", () => {
    const prdResult = runLore(["create", "prd", "--title", "Parent PRD", "--json"], tmpDir);
    const prd = parseJson<{ id: string; slug: string }>(prdResult).data!;

    runLore(["create", "spec", "--title", "Auth Spec", "--parent", prd.slug], tmpDir);

    const treeResult = runLore(["tree", "--json"], tmpDir);
    expect(treeResult.exitCode).toBe(0);
    const treeJson = parseJson<{
      doc: { slug: string };
      children: Array<{ doc: { slug: string } }>;
    }>(treeResult);
    expect(treeJson.data!.doc.slug).toBe(prd.slug);
    expect(treeJson.data!.children).toHaveLength(1);
    expect(treeJson.data!.children[0]!.doc.slug).toBe("spec-auth-spec");
  });

  it("HAPPY: tree human-readable output contains parent and child titles", () => {
    const prdResult = runLore(["create", "prd", "--title", "Root Doc", "--json"], tmpDir);
    const prd = parseJson<{ slug: string }>(prdResult).data!;
    runLore(["create", "spec", "--title", "Child Spec", "--parent", prd.slug], tmpDir);

    const treeResult = runLore(["tree"], tmpDir);
    expect(treeResult.exitCode).toBe(0);
    expect(treeResult.stdout).toContain("Root Doc");
    expect(treeResult.stdout).toContain("Child Spec");
  });

  // NEGATIVE: N/A — standalone documents are valid
  // BOUNDARY: N/A — depth param has no hard boundary in spec
  // ERROR: N/A — DB errors require controlled environment
  // STATE: N/A — parent-child is structural linkage, not a state machine
  // REGRESSION: N/A — no known regressions
});

// ─── Scenario 4: Discovery — list + search (AC-E2E-001.05, AC-E2E-001.06) ────

describe("Scenario 4: discovery (list + search)", () => {
  let tmpDir: string;
  let prdSlug: string;

  beforeEach(() => {
    tmpDir = makeTempDir("discovery");
    runLore(["init"], tmpDir);

    // Seed 3 docs of different types (prd, spec, plan — no extra fields required)
    const prdResult = runLore(["create", "prd", "--title", "My PRD", "--json"], tmpDir);
    prdSlug = parseJson<{ slug: string }>(prdResult).data!.slug;
    runLore(["create", "spec", "--title", "Auth Feature Spec", "--parent", prdSlug], tmpDir);
    runLore(["create", "plan", "--title", "General Plan"], tmpDir);
  });

  afterEach(() => {
    cleanupDir(tmpDir);
  });

  it("HAPPY: list returns all 3 documents", () => {
    const result = runLore(["list", "--json"], tmpDir);
    expect(result.exitCode).toBe(0);
    const json = parseJson<{ docs: unknown[]; total: number }>(result);
    // prd + spec + plan = 3 (knowledge/adr require extra fields, plan does not)
    expect(json.data!.total).toBe(3);
  });

  it("HAPPY: list --type spec returns only spec documents (AC-E2E-001.05)", () => {
    const result = runLore(["list", "--type", "spec", "--json"], tmpDir);
    expect(result.exitCode).toBe(0);
    const json = parseJson<{ docs: Array<{ type: string }>; total: number }>(result);
    expect(json.data!.total).toBe(1);
    expect(json.data!.docs[0]!.type).toBe("spec");
  });

  it("HAPPY: list --type prd returns only prd documents", () => {
    const result = runLore(["list", "--type", "prd", "--json"], tmpDir);
    const json = parseJson<{ docs: Array<{ type: string }>; total: number }>(result);
    expect(json.data!.total).toBe(1);
    expect(json.data!.docs[0]!.type).toBe("prd");
  });

  it("HAPPY: list --json is pipe-composable — each doc has extractable id (AC-E2E-001.06)", () => {
    const result = runLore(["list", "--json"], tmpDir);
    expect(result.exitCode).toBe(0);
    // Simulate: lore list --json | jq '.data.docs[].id'
    const json = parseJson<{ docs: Array<{ id: string }>; total: number }>(result);
    expect(json.data!.total).toBeGreaterThan(0);
    const ids = json.data!.docs.map((d) => d.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.every((id) => typeof id === "string" && id.length > 0)).toBe(true);
  });

  it("HAPPY: search 'Auth' finds the auth spec", () => {
    const result = runLore(["search", "Auth", "--json"], tmpDir);
    expect(result.exitCode).toBe(0);
    const json = parseJson<{ results: Array<{ title: string }> }>(result);
    const found = json.data!.results.some((r) => r.title.toLowerCase().includes("auth"));
    expect(found).toBe(true);
  });

  it("HAPPY: list human-readable shows table headers and data", () => {
    const result = runLore(["list"], tmpDir);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Title");
    expect(result.stdout).toContain("My PRD");
  });

  it("NEGATIVE: search with no matches prints 'No results'", () => {
    const result = runLore(["search", "xyznonexistent123"], tmpDir);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("No results");
  });

  it("BOUNDARY: list on empty corpus shows 'No documents found'", () => {
    const emptyDir = makeTempDir("empty-list");
    runLore(["init"], emptyDir);
    const result = runLore(["list"], emptyDir);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("No documents found");
    cleanupDir(emptyDir);
  });

  // ERROR: N/A — DB errors require controlled environment
  // STATE: N/A — list/search are read-only
  // REGRESSION: N/A — no known regressions
});

// ─── Scenario 5: Review workflow (AC-E2E-001.08) ─────────────────────────────

describe("Scenario 5: review workflow (pending → approve)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir("review");
    runLore(["init"], tmpDir);
  });

  afterEach(() => {
    cleanupDir(tmpDir);
  });

  it("HAPPY: pending shows draft, approve removes it from pending (AC-E2E-001.08)", () => {
    // Create draft
    const createResult = runLore(["create", "prd", "--title", "Review Me", "--json"], tmpDir);
    const doc = parseJson<{ id: string }>(createResult).data!;

    // Pending shows it
    const pendingResult = runLore(["pending", "--json"], tmpDir);
    expect(pendingResult.exitCode).toBe(0);
    const pendingJson = parseJson<{ docs: Array<{ id: string }> }>(pendingResult);
    expect(pendingJson.data!.docs.some((d) => d.id === doc.id)).toBe(true);

    // Approve by ID
    const approveResult = runLore(["approve", doc.id, "--json"], tmpDir);
    expect(approveResult.exitCode).toBe(0);
    const approveJson = parseJson<{ status: string }>(approveResult);
    expect(approveJson.data!.status).toBe("approved");

    // No longer in pending
    const pendingAfterResult = runLore(["pending", "--json"], tmpDir);
    const pendingAfterJson = parseJson<{ docs: Array<{ id: string }> }>(pendingAfterResult);
    expect(pendingAfterJson.data!.docs.some((d) => d.id === doc.id)).toBe(false);
  });

  it("HAPPY: pending on empty corpus shows 'No pending documents'", () => {
    const result = runLore(["pending"], tmpDir);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("No pending documents");
  });

  it("HAPPY: pending --json returns well-formed envelope with draft docs", () => {
    runLore(["create", "prd", "--title", "Draft Doc"], tmpDir);
    const result = runLore(["pending", "--json"], tmpDir);
    expect(result.exitCode).toBe(0);
    const json = parseJson<{ docs: Array<{ status: string }> }>(result);
    expect(json.ok).toBe(true);
    expect(Array.isArray(json.data!.docs)).toBe(true);
    expect(json.data!.docs[0]!.status).toBe("draft");
  });

  it("NEGATIVE: approve nonexistent doc exits code 3", () => {
    const result = runLore(["approve", "01FAKEIDNOTEXIST00000000000"], tmpDir);
    expect(result.exitCode).toBe(3);
    expect(result.stderr).toContain("not found");
  });

  // BOUNDARY: N/A — approve has no numeric bounds
  // ERROR: N/A — DB errors require controlled environment
  // STATE: draft → approved transition is the primary test
  // REGRESSION: N/A — no known regressions
});

// ─── Scenario 6: Version history (AC-E2E-001.09) ─────────────────────────────

describe("Scenario 6: version history (log + diff)", () => {
  let tmpDir: string;
  let docId: string;
  let docSlug: string;

  beforeEach(() => {
    tmpDir = makeTempDir("version");
    runLore(["init"], tmpDir);

    // Create doc (v1) then update (v2)
    const createResult = runLore(["create", "prd", "--title", "Version Test", "--json"], tmpDir);
    const doc = parseJson<{ id: string; slug: string }>(createResult).data!;
    docId = doc.id;
    docSlug = doc.slug;
    runLore(["set", docSlug, "--title", "Version Test Updated"], tmpDir);
  });

  afterEach(() => {
    cleanupDir(tmpDir);
  });

  it("HAPPY: log --json shows 2 entries after one update (AC-E2E-001.09)", () => {
    const result = runLore(["log", docId, "--json"], tmpDir);
    expect(result.exitCode).toBe(0);
    const json = parseJson<{ entries: Array<unknown>; total: number }>(result);
    expect(json.data!.entries.length).toBe(2);
  });

  it("HAPPY: log human-readable output shows v1 and v2 entries", () => {
    const result = runLore(["log", docId], tmpDir);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("v1");
    expect(result.stdout).toContain("v2");
  });

  it("HAPPY: diff shows from/to version line (AC-E2E-001.09)", () => {
    const result = runLore(["diff", docId], tmpDir);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("v1");
    expect(result.stdout).toContain("v2");
  });

  it("NEGATIVE: log for nonexistent doc returns DOC_NOT_FOUND error", () => {
    const result = runLore(["log", "01FAKEIDNOTEXIST00000000000"], tmpDir);
    expect(result.exitCode).toBe(3);
  });

  it("BOUNDARY: log --limit 1 returns only 1 entry", () => {
    const result = runLore(["log", docId, "--limit", "1", "--json"], tmpDir);
    expect(result.exitCode).toBe(0);
    const json = parseJson<{ entries: Array<unknown> }>(result);
    expect(json.data!.entries.length).toBe(1);
  });

  // ERROR: N/A — DB errors require controlled environment
  // STATE: N/A — version history is append-only
  // REGRESSION: N/A — no known regressions
});

// ─── Scenario 7: Error handling — exit codes ─────────────────────────────────

describe("Scenario 7: error handling and exit codes", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir("errors");
    runLore(["init"], tmpDir);
  });

  afterEach(() => {
    cleanupDir(tmpDir);
  });

  it("HAPPY: exit code 0 on successful read command", () => {
    const result = runLore(["status"], tmpDir);
    expect(result.exitCode).toBe(0);
  });

  it("HAPPY: get nonexistent → exit code 3", () => {
    const result = runLore(["get", "no-such-slug"], tmpDir);
    expect(result.exitCode).toBe(3);
    expect(result.stderr).toContain("not found");
  });

  it("HAPPY: delete without --confirm → exit code 4 (AC-E2E-001.07)", () => {
    const createResult = runLore(["create", "prd", "--title", "DeleteMe", "--json"], tmpDir);
    const slug = parseJson<{ slug: string }>(createResult).data!.slug;

    const result = runLore(["delete", slug], tmpDir);
    expect(result.exitCode).toBe(4);
  });

  it("NEGATIVE: invalid type arg → exit code 2", () => {
    const result = runLore(["create", "badtype", "--title", "X"], tmpDir);
    expect(result.exitCode).toBe(2);
  });

  it("NEGATIVE: missing required --title → exit code 2", () => {
    const result = runLore(["create", "prd"], tmpDir);
    expect(result.exitCode).toBe(2);
  });

  // BOUNDARY: Exit codes are exact integers — numeric boundary N/A
  // ERROR: N/A — code 1 internal errors require DB-level mocking
  // STATE: N/A — error responses are stateless
  // REGRESSION: N/A — no known regressions
});

// ─── Scenario 8: JSON output composability (AC-E2E-001.03, AC-E2E-001.06) ────

describe("Scenario 8: JSON output composability", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir("json");
    runLore(["init"], tmpDir);
    runLore(["create", "prd", "--title", "JSON PRD"], tmpDir);
    // plan requires no extra fields (knowledge/adr require extra.sub_type/decision_status)
    runLore(["create", "plan", "--title", "JSON Plan"], tmpDir);
  });

  afterEach(() => {
    cleanupDir(tmpDir);
  });

  it("HAPPY: list --json produces ok:true with docs array and numeric total", () => {
    const result = runLore(["list", "--json"], tmpDir);
    expect(result.exitCode).toBe(0);
    const json = parseJson<{ docs: unknown[]; total: number }>(result);
    expect(json.ok).toBe(true);
    expect(Array.isArray(json.data!.docs)).toBe(true);
    expect(typeof json.data!.total).toBe("number");
  });

  it("HAPPY: status --json produces ok:true with corpus counts (AC-E2E-001.10)", () => {
    const result = runLore(["status", "--json"], tmpDir);
    expect(result.exitCode).toBe(0);
    const json = parseJson<{
      total_docs: number;
      by_type: Record<string, number>;
      last_updated: string;
    }>(result);
    expect(json.ok).toBe(true);
    expect(json.data!.total_docs).toBe(2);
    expect(json.data!.by_type["prd"]).toBe(1);
    // plan is the second type (knowledge/adr require extra fields)
    expect(json.data!.by_type["plan"]).toBe(1);
  });

  it("HAPPY: create --json returns doc envelope with all required fields", () => {
    // Use plan type — no parent or extra fields required (spec/adr/knowledge/task all have requirements)
    const result = runLore(["create", "plan", "--title", "Extra Plan", "--json"], tmpDir);
    expect(result.exitCode).toBe(0);
    const json = parseJson<{
      id: string;
      slug: string;
      type: string;
      status: string;
      version: number;
    }>(result);
    expect(json.ok).toBe(true);
    expect(json.data!.type).toBe("plan");
    expect(json.data!.status).toBe("draft");
    expect(json.data!.version).toBe(1);
    expect(typeof json.data!.id).toBe("string");
    expect(json.data!.id.length).toBeGreaterThan(0);
  });

  it("HAPPY: get --json returns envelope with doc and navigation sub-objects (AC-E2E-001.03)", () => {
    const createResult = runLore(["create", "prd", "--title", "Nav Test PRD", "--json"], tmpDir);
    const slug = parseJson<{ slug: string }>(createResult).data!.slug;

    const result = runLore(["get", slug, "--json"], tmpDir);
    expect(result.exitCode).toBe(0);
    const json = parseJson<{ doc: { title: string; type: string }; navigation: unknown }>(result);
    expect(json.data!.doc.title).toBe("Nav Test PRD");
    expect(json.data!.navigation).toBeDefined();
  });

  it("BOUNDARY: JSON stdout is parseable to EOF without trailing garbage", () => {
    const result = runLore(["list", "--json"], tmpDir);
    // Full stdout must parse in one shot
    expect(() => JSON.parse(result.stdout)).not.toThrow();
  });

  // ERROR: N/A — error JSON format is separately tested in error scenarios
  // STATE: N/A — JSON output is stateless
  // REGRESSION: N/A — no known regressions
});

// ─── Scenario 9: status command (AC-E2E-001.10) ──────────────────────────────

describe("Scenario 9: status command", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir("status");
    runLore(["init"], tmpDir);
  });

  afterEach(() => {
    cleanupDir(tmpDir);
  });

  it("HAPPY: status on fresh project shows 0 documents", () => {
    const result = runLore(["status", "--json"], tmpDir);
    expect(result.exitCode).toBe(0);
    const json = parseJson<{ total_docs: number }>(result);
    expect(json.data!.total_docs).toBe(0);
  });

  it("HAPPY: status after creating docs reflects count by type (AC-E2E-001.10)", () => {
    runLore(["create", "prd", "--title", "PRD 1"], tmpDir);
    // plan requires no extra fields (knowledge requires extra.sub_type)
    runLore(["create", "plan", "--title", "Plan 1"], tmpDir);

    const result = runLore(["status", "--json"], tmpDir);
    expect(result.exitCode).toBe(0);
    const json = parseJson<{ total_docs: number; by_type: Record<string, number> }>(result);
    expect(json.data!.total_docs).toBe(2);
    expect(json.data!.by_type["prd"]).toBe(1);
    expect(json.data!.by_type["plan"]).toBe(1);
  });

  it("HAPPY: status human-readable output shows section headers", () => {
    runLore(["create", "prd", "--title", "Status PRD"], tmpDir);
    const result = runLore(["status"], tmpDir);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Corpus Status");
    expect(result.stdout).toContain("Total documents");
  });

  // NEGATIVE: N/A — status has no failure modes under normal operation
  // BOUNDARY: N/A — status has no input parameters
  // ERROR: N/A — DB errors require controlled environment
  // STATE: N/A — status is read-only
  // REGRESSION: N/A — no known regressions
});
