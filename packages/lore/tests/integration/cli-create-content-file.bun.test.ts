/**
 * Integration tests for `lore create --content-file` flag (Bug A fix).
 *
 * Uses real subprocess invocations against isolated temp directories so the
 * mri argv parser is exercised — the whole point is to verify content starting
 * with `---` is correctly stored via --content-file even though `--content "---…"`
 * would be silently dropped by mri's option-terminator handling.
 *
 * Coverage:
 *   HAPPY:    --content-file with content starting with `---` stores content verbatim.
 *   MUTEX:    --content + --content-file together → exit 2 with clear error.
 *   MISSING:  --content-file pointing to non-existent path → exit 4.
 *   STATE:    get --json shows the file content exactly (no truncation, no stripping).
 *
 * @spec_ref SPEC-003 §3.1 (create command content decision tree), SPEC-017 §3.11
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// ─── Types ────────────────────────────────────────────────────────────────────

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PROJECT_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PROJECT_ROOT, "src", "index.ts");

/**
 * Run `bun run src/index.ts ...args` in `cwd`.
 * HOME is overridden to `cwd` to isolate global config files.
 * EDITOR=true prevents any test that inadvertently triggers an editor from blocking.
 */
function runLore(args: string[], cwd: string): RunResult {
  const proc = Bun.spawnSync(["bun", "run", INDEX_TS, ...args], {
    cwd,
    env: { ...process.env, HOME: cwd, EDITOR: "true" },
  });
  return {
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    exitCode: proc.exitCode ?? 1,
  };
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

let tmpDir: string;
let prdSlug: string;

beforeEach(() => {
  tmpDir = join(
    tmpdir(),
    `lore-create-cf-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(tmpDir, { recursive: true });

  // Bootstrap lore corpus
  const init = runLore(["init"], tmpDir);
  if (init.exitCode !== 0) {
    throw new Error(`lore init failed: ${init.stderr}`);
  }

  // Create a PRD parent (required for spec children)
  const prdResult = runLore(
    ["create", "prd", "--title", "Parent PRD", "--content", "PRD body", "--no-ai"],
    tmpDir,
  );
  if (prdResult.exitCode !== 0) {
    throw new Error(`create prd failed: ${prdResult.stderr}`);
  }

  // Resolve PRD slug
  const listResult = runLore(["list", "--type", "prd", "--json"], tmpDir);
  const parsed = JSON.parse(listResult.stdout) as {
    data?: { docs?: Array<{ slug: string }> };
  };
  const slug = parsed.data?.docs?.[0]?.slug;
  if (!slug) throw new Error("Could not resolve prd slug");
  prdSlug = slug;
});

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

// ─── HAPPY path: content starting with `---` stored verbatim ─────────────────

describe("lore create --content-file — HAPPY path", () => {
  it("stores file content verbatim for prd, including leading --- (Bug A fix)", () => {
    const contentFile = join(tmpDir, "body.md");
    const expectedContent =
      "---\ntitle: Frontmatter-like header\nstatus: draft\n---\n\n# Real body starts here";
    writeFileSync(contentFile, expectedContent, "utf8");

    const createResult = runLore(
      [
        "create",
        "prd",
        "--title",
        "PRD with dash content",
        "--content-file",
        contentFile,
        "--no-ai",
      ],
      tmpDir,
    );
    expect(createResult.exitCode).toBe(0);
    expect(createResult.stdout).toContain("Created prd document");

    // Extract slug from output
    const slugMatch = createResult.stdout.match(/Slug:\s+(\S+)/);
    const slug = slugMatch?.[1];
    expect(slug).toBeTruthy();

    const getResult = runLore(["get", slug!, "--json"], tmpDir);
    const parsed = JSON.parse(getResult.stdout) as {
      data?: { doc?: { content?: string } };
    };
    // reason: canonicaliseBody applied on write — stored content ends with exactly one "\n".
    // The key invariant (--- prefix survives the mri argv-terminator bug) is still validated.
    expect(parsed.data?.doc?.content).toBe(expectedContent + "\n");
  });

  it("stores file content verbatim for spec (requires --parent)", () => {
    const contentFile = join(tmpDir, "spec-body.md");
    // reason: `## ` (not `# `) — spec-create's GateEnforcer checkpoint (retro
    // follow-up item 8) requires a level-2 skeleton heading; the verbatim-storage
    // assertion below is unaffected by which heading level the body uses.
    const expectedContent = "---\nstatus: proposed\n---\n\n## Spec content with dashes";
    writeFileSync(contentFile, expectedContent, "utf8");

    const createResult = runLore(
      [
        "create",
        "spec",
        "--title",
        "Spec with dashes",
        "--content-file",
        contentFile,
        "--no-ai",
      ],
      tmpDir,
    );
    expect(createResult.exitCode).toBe(0);
    expect(createResult.stdout).toContain("Created spec document");

    const slugMatch = createResult.stdout.match(/Slug:\s+(\S+)/);
    const slug = slugMatch?.[1];
    expect(slug).toBeTruthy();

    const getResult = runLore(["get", slug!, "--json"], tmpDir);
    const parsed = JSON.parse(getResult.stdout) as {
      data?: { doc?: { content?: string } };
    };
    // reason: canonicaliseBody applied on write — trailing "\n" always normalised to exactly one.
    expect(parsed.data?.doc?.content).toBe(expectedContent + "\n");
  });

  it("--content-file skips AI and editor paths (no spinner, no editor invocation)", () => {
    // reason: the test doesn't set ANTHROPIC_API_KEY and sets EDITOR=true (no-op script),
    // so if either AI or editor path were taken, the result would be empty content (true
    // writes nothing) or an API error. A successful create with file content confirms
    // --content-file bypasses both paths.
    const contentFile = join(tmpDir, "no-ai-body.md");
    writeFileSync(contentFile, "This content came from a file", "utf8");

    const createResult = runLore(
      [
        "create",
        "prd",
        "--title",
        "File Content PRD",
        "--content-file",
        contentFile,
        // No --no-ai: --content-file should bypass AI regardless of args.ai
      ],
      tmpDir,
    );
    expect(createResult.exitCode).toBe(0);

    const slugMatch = createResult.stdout.match(/Slug:\s+(\S+)/);
    const slug = slugMatch?.[1];
    expect(slug).toBeTruthy();

    const getResult = runLore(["get", slug!, "--json"], tmpDir);
    const parsed = JSON.parse(getResult.stdout) as {
      data?: { doc?: { content?: string } };
    };
    // reason: canonicaliseBody applied on write — stored content ends with exactly one "\n".
    expect(parsed.data?.doc?.content).toBe("This content came from a file\n");
  });
});

// ─── MUTEX: both --content and --content-file → exit 2 ───────────────────────

describe("lore create --content-file — MUTEX guard", () => {
  it("exits 2 when both --content and --content-file are passed", () => {
    const contentFile = join(tmpDir, "dummy.md");
    writeFileSync(contentFile, "dummy body", "utf8");

    const result = runLore(
      [
        "create",
        "prd",
        "--title",
        "Mutex Test PRD",
        "--content",
        "inline body",
        "--content-file",
        contentFile,
        "--no-ai",
      ],
      tmpDir,
    );
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("mutually exclusive");
  });
});

// ─── MISSING file → exit 4 ───────────────────────────────────────────────────

describe("lore create --content-file — MISSING file", () => {
  it("exits 4 when --content-file points to a non-existent path", () => {
    const result = runLore(
      [
        "create",
        "prd",
        "--title",
        "Missing File PRD",
        "--content-file",
        join(tmpDir, "nonexistent-file.md"),
        "--no-ai",
      ],
      tmpDir,
    );
    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain("cannot read --content-file");
  });
});
