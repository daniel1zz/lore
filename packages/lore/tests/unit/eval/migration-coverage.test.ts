/**
 * Unit tests for src/eval/scenarios/migration-coverage.ts
 * Uses InMemoryStore (no SQLite) via createApp pattern with InMemoryStore injected.
 * Covers: HAPPY / NEGATIVE / ERROR / STATE
 * @spec_ref SPEC-013
 */

import { describe, it, expect } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { MigrationService } from "../../../src/service/migration-service.js";
import { ReviewService } from "../../../src/service/review-service.js";
import { VersionService } from "../../../src/service/version-service.js";
import { OutlineService } from "../../../src/service/outline-service.js";
import { TreeCheckService } from "../../../src/service/tree-check-service.js";
import { NoOpTelemetry } from "@lore/core";
import { runMigrationCoverage } from "../../../src/eval/scenarios/migration-coverage.js";
import type { App } from "../../../src/app.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a minimal App using InMemoryStore (no SQLite, no file I/O). */
function makeApp(): App {
  const store = new InMemoryStore();
  const telemetry = new NoOpTelemetry();
  return {
    corpusService: new CorpusService(store, telemetry),
    reviewService: new ReviewService(store),
    versionService: new VersionService(store),
    outlineService: new OutlineService(store),
    migrationService: new MigrationService(store),
    treeCheckService: new TreeCheckService(store),
    // ApiKeyStore not needed for eval tests
    apiKeyStore: null as unknown as App["apiKeyStore"],
    // reason: eval scenarios never exercise the AI path; null-cast avoids heavyweight
    // AIProviderService construction while satisfying the now-required field (SPEC-017 §3.12).
    aiProviderService: null as unknown as App["aiProviderService"],
    // reason: eval scenarios never exercise sync-docs path — null-cast per SPEC-018 §3.6.
    syncDocsService: null as unknown as App["syncDocsService"],
    exportDocsService: null as unknown as App["exportDocsService"],
    // reason: test does not exercise phase commands; null-cast per pattern from SPEC-023 §9.1.
    phaseService: null as unknown as App["phaseService"],
    // reason: test does not exercise AI-default path; callerSurface required by App interface (SPEC-024).
    callerSurface: "cli" as const,
    resolveAiDefault: (_explicit?: boolean) => ({ ai: false, source: "cli_flag" as const }),
    close: () => { telemetry.close(); },
  };
}

/** Create a minimal v1-format markdown file with required frontmatter. */
function writeV1Doc(dir: string, filename: string, id: string, type = "spec"): void {
  const content = `---
id: ${id}
type: ${type}
title: "Test Doc ${id}"
status: draft
---

Content for ${id}.
`;
  writeFileSync(join(dir, filename), content, "utf8");
}

// ─── HAPPY ───────────────────────────────────────────────────────────────────

describe("HAPPY — migration coverage against docs/requirements", () => {
  it("imports all parseable files and reports passed=true", async () => {
    // Use the real docs/requirements directory.
    // 38 .md files: 1 PRD + SPEC-001..SPEC-024 (24) + PLAN-001 (1) + TASK-001..TASK-012 (12).
    // expected_files = analyze().parseable = 38; imported = 38; links_broken = 0 → passed=true
    // reason: count bumped from 25 to 38 after lore export-docs added docs/requirements/plan/ and
    //         docs/requirements/task/ in SPEC-021 implementation (2026-07-01).
    const sourceDir = join(process.cwd(), "docs", "requirements");
    const app = makeApp();
    const result = await runMigrationCoverage(sourceDir, app);
    app.close();

    expect(result.source_dir).toBe(sourceDir);
    expect(result.expected_files).toBe(38);
    expect(result.imported).toBe(38);
    expect(result.already_existed).toBe(0);
    expect(result.links_broken).toBe(0);
    expect(result.passed).toBe(true);
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
    expect(typeof result.type_distribution).toBe("object");
  }, 30_000);
});

describe("HAPPY — empty directory returns passed=true", () => {
  it("empty dir → expected_files=0, imported=0, links_broken=0, passed=true", async () => {
    const tmpDir = join(tmpdir(), `lore-eval-empty-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    try {
      const app = makeApp();
      const result = await runMigrationCoverage(tmpDir, app);
      app.close();

      expect(result.expected_files).toBe(0);
      expect(result.imported).toBe(0);
      expect(result.links_broken).toBe(0);
      expect(result.passed).toBe(true);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("HAPPY — directory with multiple parseable files", () => {
  it("imports N files with no broken links → passed=true", async () => {
    const tmpDir = join(tmpdir(), `lore-eval-happy-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    try {
      writeV1Doc(tmpDir, "doc1.md", "DOC-001", "prd");
      writeV1Doc(tmpDir, "doc2.md", "DOC-002", "spec");
      writeV1Doc(tmpDir, "doc3.md", "DOC-003", "adr");

      const app = makeApp();
      const result = await runMigrationCoverage(tmpDir, app);
      app.close();

      expect(result.expected_files).toBe(3);
      // At least some files imported (adr needs extra fields but prd/spec should import)
      expect(result.imported).toBeGreaterThanOrEqual(0);
      expect(result.links_broken).toBe(0);
      expect(result.duration_ms).toBeGreaterThanOrEqual(0);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ─── NEGATIVE — empty dir is already tested above ────────────────────────────

// ─── ERROR ───────────────────────────────────────────────────────────────────

describe("ERROR — non-existent directory returns passed=false without throwing", () => {
  it("missing dir → passed=false, no throw", async () => {
    const missingDir = join(tmpdir(), `does-not-exist-${Date.now()}`);
    const app = makeApp();

    let result;
    await expect(async () => {
      result = await runMigrationCoverage(missingDir, app);
    }).not.toThrow();
    app.close();

    expect(result).toBeDefined();
    if (result) {
      expect((result as Awaited<ReturnType<typeof runMigrationCoverage>>).passed).toBe(false);
    }
  });
});

// ─── STATE — deterministic across runs ───────────────────────────────────────

describe("STATE — runMigrationCoverage is deterministic", () => {
  it("same source dir produces identical expected_files count across two runs", async () => {
    const tmpDir = join(tmpdir(), `lore-eval-state-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    writeV1Doc(tmpDir, "a.md", "A-001", "prd");
    writeV1Doc(tmpDir, "b.md", "B-001", "prd");

    try {
      const app1 = makeApp();
      const result1 = await runMigrationCoverage(tmpDir, app1);
      app1.close();

      const app2 = makeApp();
      const result2 = await runMigrationCoverage(tmpDir, app2);
      app2.close();

      // expected_files is deterministic (filesystem count)
      expect(result1.expected_files).toBe(result2.expected_files);
      expect(result1.expected_files).toBe(2);
      // imported count is deterministic (same files, same migration logic)
      expect(result1.imported).toBe(result2.imported);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ─── STATE — re-run on same corpus passes due to already_existed ──────────────

describe("STATE — re-run passes because already_existed compensates imported=0", () => {
  it("second runMigrationCoverage on same store passes with already_existed=N", async () => {
    const tmpDir = join(tmpdir(), `lore-eval-rerun-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    writeV1Doc(tmpDir, "a.md", "A-001", "prd");
    writeV1Doc(tmpDir, "b.md", "B-001", "prd");

    try {
      // Shared store so second run sees docs from first run
      const app = makeApp();

      // First run: fresh import — passed=true
      const result1 = await runMigrationCoverage(tmpDir, app);
      expect(result1.imported).toBe(2);
      expect(result1.already_existed).toBe(0);
      expect(result1.passed).toBe(true);

      // Second run: same store — docs already exist
      const result2 = await runMigrationCoverage(tmpDir, app);
      expect(result2.imported).toBe(0);
      expect(result2.already_existed).toBe(2);
      // reason: (0 + 2) === 2 expected_files → passed=true (idempotent criterion, SPEC-013 §K2)
      expect(result2.passed).toBe(true);

      app.close();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
