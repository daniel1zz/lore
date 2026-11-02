// @spawns packages/lore/src/index.ts
/**
 * Integration tests for `lore set --content-file` flag (Bug A fix).
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
 * @spec_ref SPEC-003 §3.1 (set command non-editor flow)
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { templatedFieldsArgs } from "../helpers/templated-create.js";

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

beforeEach(() => {
  tmpDir = join(
    tmpdir(),
    `lore-set-cf-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(tmpDir, { recursive: true });

  // Bootstrap lore corpus
  const init = runLore(["init"], tmpDir);
  if (init.exitCode !== 0) {
    throw new Error(`lore init failed: ${init.stderr}`);
  }

  // Create a prd to serve as test document target
  const prd = runLore(
    ["create", "prd", "--title", "Test PRD", ...templatedFieldsArgs("prd", { refTarget: "problem" }), "--no-ai"],
    tmpDir,
  );
  if (prd.exitCode !== 0) {
    throw new Error(`create prd failed: ${prd.stderr}`);
  }
});

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

/** Resolve the slug of the PRD created in beforeEach. */
function getPrdSlug(): string {
  const listResult = runLore(["list", "--type", "prd", "--json"], tmpDir);
  const parsed = JSON.parse(listResult.stdout) as {
    data?: { docs?: Array<{ slug: string }> };
  };
  const slug = parsed.data?.docs?.[0]?.slug;
  if (!slug) throw new Error("Could not resolve prd slug");
  return slug;
}

// ─── HAPPY path: content starting with `---` stored verbatim ─────────────────

describe("lore set --content-file — HAPPY path", () => {
  it("stores file content verbatim, including leading --- lines (Bug A fix)", () => {
    const slug = getPrdSlug();

    // Write a file whose content starts with --- (the mri argv-terminator character)
    const contentFile = join(tmpDir, "test-content.md");
    const expectedContent =
      "---\ntitle: Some frontmatter\nstatus: draft\n---\n\n# Body starts here\n\nMore content.";
    writeFileSync(contentFile, expectedContent, "utf8");

    const setResult = runLore(
      ["set", slug, "--content-file", contentFile],
      tmpDir,
    );
    expect(setResult.exitCode).toBe(0);
    expect(setResult.stdout).toContain("Updated");

    // Retrieve the doc and verify content is stored exactly
    const getResult = runLore(["get", slug, "--json"], tmpDir);
    expect(getResult.exitCode).toBe(0);

    const parsed = JSON.parse(getResult.stdout) as {
      data?: { doc?: { content?: string } };
    };
    // reason: canonicaliseBody applied on write — stored content ends with exactly one "\n".
    // The key invariant (--- prefix survives the mri argv-terminator bug) is still validated.
    expect(parsed.data?.doc?.content).toBe(expectedContent + "\n");
  });

  it("stores multi-line file content without modification", () => {
    const slug = getPrdSlug();

    const contentFile = join(tmpDir, "multiline.md");
    const expectedContent = "Line 1\nLine 2\nLine 3\n\nParagraph break.";
    writeFileSync(contentFile, expectedContent, "utf8");

    const setResult = runLore(
      ["set", slug, "--content-file", contentFile],
      tmpDir,
    );
    expect(setResult.exitCode).toBe(0);

    const getResult = runLore(["get", slug, "--json"], tmpDir);
    const parsed = JSON.parse(getResult.stdout) as {
      data?: { doc?: { content?: string } };
    };
    // reason: canonicaliseBody applied on write — trailing "\n" always normalised to exactly one.
    expect(parsed.data?.doc?.content).toBe(expectedContent + "\n");
  });

  it("stores empty file content as empty string", () => {
    const slug = getPrdSlug();

    const contentFile = join(tmpDir, "empty.md");
    writeFileSync(contentFile, "", "utf8");

    const setResult = runLore(
      ["set", slug, "--content-file", contentFile],
      tmpDir,
    );
    expect(setResult.exitCode).toBe(0);

    const getResult = runLore(["get", slug, "--json"], tmpDir);
    const parsed = JSON.parse(getResult.stdout) as {
      data?: { doc?: { content?: string } };
    };
    expect(parsed.data?.doc?.content).toBe("");
  });
});

// ─── MUTEX: both --content and --content-file → exit 2 ───────────────────────

describe("lore set --content-file — MUTEX guard", () => {
  it("exits 2 when both --content and --content-file are passed", () => {
    const slug = getPrdSlug();

    const contentFile = join(tmpDir, "dummy.md");
    writeFileSync(contentFile, "dummy body", "utf8");

    const result = runLore(
      ["set", slug, "--content", "inline body", "--content-file", contentFile],
      tmpDir,
    );
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("mutually exclusive");
  });
});

// ─── MISSING file → exit 4 ───────────────────────────────────────────────────

describe("lore set --content-file — MISSING file", () => {
  it("exits 4 when --content-file points to a non-existent path", () => {
    const slug = getPrdSlug();

    const result = runLore(
      ["set", slug, "--content-file", join(tmpDir, "nonexistent-file.md")],
      tmpDir,
    );
    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain("cannot read --content-file");
  });
});
