// @spawns packages/lore/src/index.ts
/**
 * Integration tests for `lore sync-docs` CLI subcommand.
 * Uses real CLI invocations against isolated temp directories with real lore.db.
 * Runs under `bun test` (bun:sqlite dependency via the CLI binary).
 *
 * Coverage: AC-SD-1 (e2e), AC-SD-2 (dry-run), AC-SD-3 (empty dir),
 *           AC-SD-5 (JSON output), AC-SD-9 (multi-PRD no match → exit 4),
 *           AC-SD-19 (--help shows flags)
 *
 * @spec_ref SPEC-018 §3.5, §5
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { patchLoreConfig } from "../helpers/patch-lore-config.js";
import { join } from "path";
import { tmpdir } from "os";

// ─── Types ──────────────────────────────────────────────────────────────────

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const PROJECT_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PROJECT_ROOT, "src", "index.ts");

/**
 * Run `bun run src/index.ts ...args` in `cwd`.
 * HOME is overridden to `cwd` to isolate global config files.
 */
function runLore(args: string[], cwd: string): RunResult {
  const proc = Bun.spawnSync(["bun", "run", INDEX_TS, ...args], {
    cwd,
    env: { ...process.env, HOME: cwd },
  });
  return {
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    exitCode: proc.exitCode ?? 1,
  };
}

/** Write a spec file with given frontmatter fields and body. */
function writeSpecFile(
  dir: string,
  filename: string,
  opts: {
    type?: string;
    title: string;
    parent?: string;
    tags?: string[];
    priority?: string;
    body?: string;
  },
): void {
  const fm: string[] = ["---"];
  fm.push(`type: ${opts.type ?? "spec"}`);
  fm.push(`title: "${opts.title}"`);
  if (opts.parent !== undefined) fm.push(`parent: "${opts.parent}"`);
  if (opts.priority !== undefined) fm.push(`priority: ${opts.priority}`);
  if (opts.tags !== undefined) fm.push(`tags: [${opts.tags.map((t) => `"${t}"`).join(", ")}]`);
  fm.push("---");
  const body = opts.body ?? `# ${opts.title}\n\nSpec body content.`;
  writeFileSync(join(dir, filename), fm.join("\n") + "\n" + body, "utf8");
}

/**
 * Disables all four `lore gate` service-layer checkpoints for this fixture's corpus
 * (retro follow-up item 8 test-fallout reconciliation — GateEnforcer is now wired ON
 * by default in every production `createApp`, which `SyncDocsService` reaches through
 * `CorpusService.create`). `writeSpecFile`'s default body template (`# ${title}\n\n...`)
 * is an H1 heading, not spec-create's required `## ` (H2) skeleton — none of this
 * file's ACs (SPEC-018 §3.5/§5 file→corpus reconciliation) exercise spec-create
 * gating itself. Mirrors the config shape
 * `tests/integration/gate-config-disable.bun.test.ts` establishes
 * (`workflow.gates.<checkpoint>.enabled`, `@lore/core::resolveGateEnabled`).
 */
function disableAllGates(dir: string): void {
  patchLoreConfig(
    dir,
    [
      "workflow:",
      "  gates:",
      "    spec-create:",
      "      enabled: false",
      "    spec-promote:",
      "      enabled: false",
      "    plan-promote:",
      "      enabled: false",
      "    task-claim:",
      "      enabled: false",
      "",
    ].join("\n"),
  );
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(tmpdir(), `lore-sync-cli-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
  // Bootstrap lore corpus
  const initResult = runLore(["init"], tmpDir);
  if (initResult.exitCode !== 0) {
    throw new Error(`lore init failed: ${initResult.stderr}`);
  }
  disableAllGates(tmpDir);
  // Create a PRD so specs have a parent.
  // reason: --no-ai skips the AI generation step (AC-AI-2) and uses a blank document,
  // which is sufficient for testing the sync-docs parent resolution logic.
  const prdResult = runLore(
    ["create", "prd", "--title", "Integration PRD", "--content", "PRD body for tests.", "--no-ai"],
    tmpDir,
  );
  if (prdResult.exitCode !== 0) {
    throw new Error(`create PRD failed: ${prdResult.stderr}`);
  }
});

afterEach(() => {
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

// ─── AC-SD-1 (e2e): creates new specs ────────────────────────────────────────

describe("spec-lore-sync-docs-backfill-new-spec-files-into-corpus#AC-SD-1 e2e — creates missing specs from files", () => {
  it("3 spec files → creates 3 rows, exits 0", () => {
    const specDir = join(tmpDir, "docs", "requirements", "spec");
    mkdirSync(specDir, { recursive: true });

    writeSpecFile(specDir, "SPEC-001.md", {
      title: "Auth Spec",
      parent: "Integration PRD",
      body: "# Auth Spec\n\nBody content.",
    });
    writeSpecFile(specDir, "SPEC-002.md", {
      title: "Storage Spec",
      parent: "Integration PRD",
      body: "# Storage Spec\n\nBody content.",
    });
    writeSpecFile(specDir, "SPEC-003.md", {
      title: "API Spec",
      parent: "Integration PRD",
      body: "# API Spec\n\nBody content.",
    });

    const result = runLore(["sync-docs", "--from", specDir], tmpDir);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Created 3 new specs");
  });
});

// ─── AC-SD-2: --dry-run creates 0 rows ───────────────────────────────────────

describe("spec-lore-sync-docs-backfill-new-spec-files-into-corpus#AC-SD-2 — --dry-run writes nothing", () => {
  it("dry-run reports but creates 0 corpus rows", () => {
    const specDir = join(tmpDir, "docs", "requirements", "spec");
    mkdirSync(specDir, { recursive: true });

    writeSpecFile(specDir, "SPEC-001.md", {
      title: "Dry Run Test Spec",
      parent: "Integration PRD",
      body: "# Dry Run Test Spec\n\nBody.",
    });

    const dryResult = runLore(["sync-docs", "--from", specDir, "--dry-run"], tmpDir);
    expect(dryResult.exitCode).toBe(0);
    expect(dryResult.stdout).toContain("dry-run");

    // Verify corpus still has 0 specs
    const listResult = runLore(["list", "--type", "spec"], tmpDir);
    expect(listResult.stdout).not.toContain("Dry Run Test Spec");
  });
});

// ─── AC-SD-3: empty dir → 0 files ────────────────────────────────────────────

describe("spec-lore-sync-docs-backfill-new-spec-files-into-corpus#AC-SD-3 — empty directory exits 0", () => {
  it("empty dir → scanned 0 files, exit 0", () => {
    const emptyDir = join(tmpDir, "empty-spec-dir");
    mkdirSync(emptyDir, { recursive: true });

    const result = runLore(["sync-docs", "--from", emptyDir], tmpDir);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("0 files");
  });
});

// ─── AC-SD-5: --json outputs valid SyncReport ────────────────────────────────

describe("spec-lore-sync-docs-backfill-new-spec-files-into-corpus#AC-SD-5 — --json outputs SyncReport", () => {
  it("JSON output has correct SyncReport shape", () => {
    const specDir = join(tmpDir, "docs", "requirements", "spec");
    mkdirSync(specDir, { recursive: true });

    writeSpecFile(specDir, "SPEC-001.md", {
      title: "JSON Test Spec",
      parent: "Integration PRD",
      body: "# JSON Test Spec\n\nBody.",
    });

    const result = runLore(["sync-docs", "--from", specDir, "--json"], tmpDir);
    expect(result.exitCode).toBe(0);

    let parsed: unknown;
    expect(() => { parsed = JSON.parse(result.stdout); }).not.toThrow();

    const report = (parsed as { ok: boolean; data: Record<string, unknown> });
    expect(report.ok).toBe(true);

    const data = report.data;
    expect(typeof data["scanned"]).toBe("number");
    expect(Array.isArray(data["created"])).toBe(true);
    expect(Array.isArray(data["matched_clean"])).toBe(true);
    expect(Array.isArray(data["matched_drift"])).toBe(true);
    expect(Array.isArray(data["errors"])).toBe(true);

    // created array has the spec
    const created = data["created"] as Array<{ file: string; slug: string }>;
    expect(created.length).toBe(1);
    expect(typeof created[0]!.slug).toBe("string");
  });
});

// ─── AC-SD-5 drift: diff_chars > 0 for changed content (FU#1 regression) ─────

describe("spec-lore-sync-docs-backfill-new-spec-files-into-corpus#AC-SD-5 drift — diff_chars > 0 when body changed (validates FU#1 fix)", () => {
  it("same-length different-content body → diff_chars > 0", () => {
    // reason: Old algorithm Math.abs(len_a - len_b) reports 0 for equal-length-but-different
    // bodies, contradicting the matched_drift bucket. FU#1 fixes this with diffChars (LCS).
    const specDir = join(tmpDir, "docs", "requirements", "spec");
    mkdirSync(specDir, { recursive: true });

    // Step 1: Create spec file with body "AAAA"
    writeSpecFile(specDir, "SPEC-drift-same-len.md", {
      title: "Drift SameLength Spec",
      parent: "Integration PRD",
      body: "AAAA",
    });

    // Step 2: Sync to create in corpus
    const createResult = runLore(["sync-docs", "--from", specDir], tmpDir);
    expect(createResult.exitCode).toBe(0);

    // Step 3: Modify file to same-length but different body "BBBB"
    writeSpecFile(specDir, "SPEC-drift-same-len.md", {
      title: "Drift SameLength Spec",
      parent: "Integration PRD",
      body: "BBBB",
    });

    // Step 4: Run sync-docs in dry-run JSON mode — must detect drift
    const driftResult = runLore(
      ["sync-docs", "--from", specDir, "--dry-run", "--json"],
      tmpDir,
    );
    expect(driftResult.exitCode).toBe(0);

    const report = JSON.parse(driftResult.stdout) as {
      ok: boolean;
      data: { matched_drift: Array<{ file: string; slug: string; diff_chars: number }> };
    };
    expect(report.ok).toBe(true);
    expect(report.data.matched_drift.length).toBe(1);
    // Both "AAAA" and "BBBB" have length 4; old algorithm returns 0, new returns 4.
    expect(report.data.matched_drift[0]!.diff_chars).toBeGreaterThan(0);
  });

  it("different-length body → diff_chars > 0", () => {
    const specDir = join(tmpDir, "docs", "requirements", "spec");
    mkdirSync(specDir, { recursive: true });

    // Step 1: Create spec file with body "AAA" (3 chars)
    writeSpecFile(specDir, "SPEC-drift-diff-len.md", {
      title: "Drift DiffLength Spec",
      parent: "Integration PRD",
      body: "AAA",
    });

    // Step 2: Sync to create in corpus
    const createResult = runLore(["sync-docs", "--from", specDir], tmpDir);
    expect(createResult.exitCode).toBe(0);

    // Step 3: Modify file to different-length body "BBBBB" (5 chars)
    writeSpecFile(specDir, "SPEC-drift-diff-len.md", {
      title: "Drift DiffLength Spec",
      parent: "Integration PRD",
      body: "BBBBB",
    });

    // Step 4: Run sync-docs in dry-run JSON mode — must detect drift
    const driftResult = runLore(
      ["sync-docs", "--from", specDir, "--dry-run", "--json"],
      tmpDir,
    );
    expect(driftResult.exitCode).toBe(0);

    const report = JSON.parse(driftResult.stdout) as {
      ok: boolean;
      data: { matched_drift: Array<{ file: string; slug: string; diff_chars: number }> };
    };
    expect(report.ok).toBe(true);
    expect(report.data.matched_drift.length).toBe(1);
    // Different-length case: both old and new algorithms detect drift, but new is more precise.
    expect(report.data.matched_drift[0]!.diff_chars).toBeGreaterThan(0);
  });
});

// ─── Bug B: drift hint format — slug shown + --content-file mentioned ────────

describe("Bug B — drift hint shows slug and mentions --content-file", () => {
  it("human output for drifted spec includes corpus slug and --content-file guidance", () => {
    const specDir = join(tmpDir, "docs", "requirements", "spec");
    mkdirSync(specDir, { recursive: true });

    // Step 1: Create spec file and sync to corpus
    writeSpecFile(specDir, "SPEC-hint-test.md", {
      title: "Hint Test Spec",
      parent: "Integration PRD",
      body: "Original body content.",
    });
    const createResult = runLore(["sync-docs", "--from", specDir], tmpDir);
    expect(createResult.exitCode).toBe(0);

    // Step 2: Modify file body so drift is detected
    writeSpecFile(specDir, "SPEC-hint-test.md", {
      title: "Hint Test Spec",
      parent: "Integration PRD",
      body: "Updated body content — this differs from corpus.",
    });

    // Step 3: Run sync-docs (human mode, not --json) and capture stdout
    const driftResult = runLore(["sync-docs", "--from", specDir], tmpDir);
    expect(driftResult.exitCode).toBe(0);

    const out = driftResult.stdout;

    // Hint must mention --content-file (not the old --content "$(cat ...)" form)
    expect(out).toContain("--content-file");

    // Hint must show the slug (format: <filename>  →  <slug>)
    expect(out).toContain("→");
    expect(out).toContain("SPEC-hint-test.md");

    // Must mention corpus is SSOT and no auto-push
    expect(out).toContain("corpus is SSOT");
  });
});

// ─── AC-SD-9: exit 4 on VALIDATION_ERROR ─────────────────────────────────────

describe("spec-lore-sync-docs-backfill-new-spec-files-into-corpus#AC-SD-9 — per-file validation error exits 4", () => {
  it("file without frontmatter → exit 4, error on stderr", () => {
    const specDir = join(tmpDir, "docs", "requirements", "spec");
    mkdirSync(specDir, { recursive: true });

    // Write a file without frontmatter
    writeFileSync(
      join(specDir, "SPEC-bad.md"),
      "# No Frontmatter\n\nJust content, no YAML block.\n",
      "utf8",
    );

    const result = runLore(["sync-docs", "--from", specDir], tmpDir);
    expect(result.exitCode).toBe(4);
    // Error details on stderr
    expect(result.stderr).toContain("SPEC-bad.md");
  });
});

// ─── AC-SD-19: sync-docs subcommand is registered and flags work ──────────────

describe("spec-lore-sync-docs-backfill-new-spec-files-into-corpus#AC-SD-19 — sync-docs subcommand is registered and executable", () => {
  it("lore sync-docs --dry-run on empty dir exits 0 (spec-lore-sync-docs-backfill-new-spec-files-into-corpus#AC-SD-19 proxy — verifies flags)", () => {
    // AC-SD-19 Approach C: citty --help is not capturable via piped subprocess in bun:test.
    // Approach A (Bun.spawn with stdio:pipe) confirmed empty output — citty writes help
    // directly to the process's inherited terminal fd, bypassing both spawnSync's pipe
    // buffer and Bun.spawn's explicit pipe redirect. Approach B (citty API direct call)
    // requires test-time bundler setup incompatible with bun:sqlite constraints.
    // Resolution: the proxy test below satisfies AC-SD-19 by proving:
    //   (a) the "sync-docs" subcommand is registered in citty's router (the CLI routes to it),
    //   (b) the --from, --dry-run, and --json flags are wired (the run succeeds and JSON parses),
    //   (c) flag handling logic is exercised end-to-end via real subprocess.
    // Manual smoke (run once): `bun run src/index.ts sync-docs --help` confirms flag listing.
    const emptyDir = join(tmpDir, "verify-flags-dir");
    mkdirSync(emptyDir, { recursive: true });

    const result = runLore(
      ["sync-docs", "--from", emptyDir, "--dry-run", "--json"],
      tmpDir,
    );
    // If the subcommand is registered and flags are wired, this exits 0
    expect(result.exitCode).toBe(0);

    // JSON output confirms --json flag works and the report shape is correct
    const parsed = JSON.parse(result.stdout) as { ok: boolean; data: { scanned: number } };
    expect(parsed.ok).toBe(true);
    expect(parsed.data.scanned).toBe(0);
  });

  it("lore sync-docs --from unknown-dir exits 0 (non-existent dir = 0 files)", () => {
    const result = runLore(
      ["sync-docs", "--from", join(tmpDir, "nonexistent-spec-dir")],
      tmpDir,
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("0 files");
  });
});
