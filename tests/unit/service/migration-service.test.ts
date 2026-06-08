/** @spec_ref AC-MIG-001 */
/**
 * Tests for MigrationService — DocMan v1 corpus import.
 * Spec: SPEC-007, SPEC-LORE-MIG-001
 *
 * AC-MIG-001: analyze() reports correct doc count, type mapping, link stats, secret warnings
 * AC-MIG-002: execute() imports all docs and creates link records
 * AC-MIG-003: execute() dry run writes nothing to store
 * AC-MIG-004: execute() skips already-imported docs on re-run (idempotency)
 * AC-MIG-005: secret scan blocks import when secrets detected and skipSecretScan=false
 * AC-MIG-006: unknown v1 type imported as knowledge with warning
 *
 * Test design:
 *   EP: valid corpus / invalid YAML / unknown type / re-run (idempotency)
 *   BVA: empty directory, single file, files with/without links
 *   Decision Table: dryRun=true|false, skipSecretScan=true|false, secrets present|absent
 *   State Transition: fresh import → idempotent re-import (skips existing)
 *   Error: unreadable directory, unparseable YAML
 *   Regression: unknown v1 type must produce warning not crash
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { InMemoryStore } from "@store/in-memory-store";
import { MigrationService } from "@service/migration-service";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makePrdFile(id: string, title: string, extraLinks: string[] = []): string {
  const linksYaml =
    extraLinks.length > 0
      ? `links:\n${extraLinks.map((l) => `  - "${l}"`).join("\n")}`
      : "links: []";
  return `---
id: "${id}"
type: prd
status: published
priority: high
created: "2025-01-01"
updated: "2025-06-01"
tags: [product, v1]
${linksYaml}
---

# ${title}

This is the product requirements document.
`;
}

function makeSpecFile(id: string, title: string, prdId: string): string {
  return `---
id: "${id}"
type: feature-spec
status: draft
priority: medium
created: "2025-02-01"
updated: "2025-05-01"
tags: [spec]
links:
  - "${prdId}"
title: "${title}"
---

## Overview

Feature specification content.
`;
}

function makeKnowledgeFile(id: string): string {
  return `---
id: "${id}"
type: knowledge
status: published
priority: low
created: "2025-03-01"
updated: "2025-04-01"
tags: []
links: []
title: "Some Knowledge"
---

Knowledge content here.
`;
}

function makeUnknownTypeFile(id: string): string {
  return `---
id: "${id}"
type: custom-note
status: draft
priority: low
created: "2025-01-01"
updated: "2025-01-01"
tags: []
links: []
title: "Custom Note"
---

Custom note content.
`;
}

function makeFileWithAwsKey(id: string): string {
  return `---
id: "${id}"
type: knowledge
status: draft
priority: low
created: "2025-01-01"
updated: "2025-01-01"
tags: []
links: []
title: "Secret Doc"
---

Here is my aws_key = AKIAIOSFODNN7EXAMPLE and it should not be here.
`;
}

function makeInvalidYamlFile(): string {
  return `---
id: "valid-id"
type: prd
invalid yaml: [unclosed bracket
---

Content here.
`;
}

function makeMissingIdFile(): string {
  return `---
type: prd
status: draft
---

No id field.
`;
}

// ─── Test Suite ───────────────────────────────────────────────────────────────

describe("MigrationService", () => {
  let tempDir: string;
  let store: InMemoryStore;
  let service: MigrationService;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "lore-migration-test-"));
    store = new InMemoryStore();
    service = new MigrationService(store);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  // ─── analyze() ─────────────────────────────────────────────────────────────

  describe("analyze()", () => {
    describe("happy path", () => {
      it("reports 3 parseable docs from valid corpus", () => {
        writeFileSync(join(tempDir, "prd.md"), makePrdFile("PRD-001", "My PRD"));
        writeFileSync(join(tempDir, "spec.md"), makeSpecFile("SPEC-001", "Auth Spec", "PRD-001"));
        writeFileSync(join(tempDir, "knowledge.md"), makeKnowledgeFile("KNOW-001"));

        const result = service.analyze(tempDir);

        expect(result.ok).toBe(true);
        if (!result.ok) return;

        expect(result.value.total_files).toBe(3);
        expect(result.value.parseable).toBe(3);
        expect(result.value.unparseable).toHaveLength(0);
        expect(result.value.source_path).toBe(tempDir);
      });

      it("produces correct type_mapping entries", () => {
        writeFileSync(join(tempDir, "prd.md"), makePrdFile("PRD-001", "My PRD"));
        writeFileSync(join(tempDir, "spec.md"), makeSpecFile("SPEC-001", "Auth Spec", "PRD-001"));
        writeFileSync(join(tempDir, "knowledge.md"), makeKnowledgeFile("KNOW-001"));

        const result = service.analyze(tempDir);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const mapping = result.value.type_mapping;
        const prdEntry = mapping.find((m) => m.v1Type === "prd");
        const specEntry = mapping.find((m) => m.v1Type === "feature-spec");
        const knowEntry = mapping.find((m) => m.v1Type === "knowledge");

        expect(prdEntry?.v2Type).toBe("prd");
        expect(prdEntry?.count).toBe(1);
        expect(specEntry?.v2Type).toBe("spec");
        expect(specEntry?.count).toBe(1);
        expect(knowEntry?.v2Type).toBe("knowledge");
        expect(knowEntry?.count).toBe(1);
      });

      it("computes link_mapping correctly when links are resolvable", () => {
        writeFileSync(join(tempDir, "prd.md"), makePrdFile("PRD-001", "My PRD"));
        writeFileSync(
          join(tempDir, "spec.md"),
          makeSpecFile("SPEC-001", "Auth Spec", "PRD-001"),
        );

        const result = service.analyze(tempDir);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        expect(result.value.link_mapping.total).toBe(1);
        expect(result.value.link_mapping.resolvable).toBe(1);
        expect(result.value.link_mapping.broken).toBe(0);
      });

      it("reports broken links when target does not exist in corpus", () => {
        // SPEC links to a PRD that is NOT in the corpus
        writeFileSync(
          join(tempDir, "spec.md"),
          makeSpecFile("SPEC-001", "Auth Spec", "PRD-MISSING"),
        );

        const result = service.analyze(tempDir);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        expect(result.value.link_mapping.total).toBe(1);
        expect(result.value.link_mapping.broken).toBe(1);
        expect(result.value.link_mapping.resolvable).toBe(0);
      });

      it("scans recursive subdirectories for .md files", () => {
        const subDir = join(tempDir, "sub");
        mkdirSync(subDir);
        writeFileSync(join(subDir, "nested.md"), makeKnowledgeFile("KNOW-NESTED"));
        writeFileSync(join(tempDir, "prd.md"), makePrdFile("PRD-001", "Root PRD"));

        const result = service.analyze(tempDir);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        expect(result.value.total_files).toBe(2);
        expect(result.value.parseable).toBe(2);
      });

      it("returns empty report for empty directory", () => {
        const result = service.analyze(tempDir);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        expect(result.value.total_files).toBe(0);
        expect(result.value.parseable).toBe(0);
        expect(result.value.unparseable).toHaveLength(0);
      });
    });

    describe("negative cases", () => {
      it("lists file with invalid YAML in unparseable", () => {
        writeFileSync(join(tempDir, "bad.md"), makeInvalidYamlFile());
        writeFileSync(join(tempDir, "good.md"), makeKnowledgeFile("KNOW-001"));

        const result = service.analyze(tempDir);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        expect(result.value.parseable).toBe(1);
        expect(result.value.unparseable).toHaveLength(1);
        expect(result.value.unparseable[0]?.file).toContain("bad.md");
      });

      it("lists file missing id field in unparseable", () => {
        writeFileSync(join(tempDir, "noid.md"), makeMissingIdFile());

        const result = service.analyze(tempDir);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        expect(result.value.unparseable).toHaveLength(1);
        expect(result.value.unparseable[0]?.error).toContain("id");
      });

      it("returns STORE_ERROR for non-existent source path", () => {
        const result = service.analyze("/tmp/does-not-exist-lore-test-xyz");
        expect(result.ok).toBe(false);
        if (result.ok) return;

        expect(result.error.code).toBe("STORE_ERROR");
      });
    });

    describe("secret detection", () => {
      it("reports AWS key pattern as secret warning", () => {
        writeFileSync(join(tempDir, "secret.md"), makeFileWithAwsKey("SECRET-001"));

        const result = service.analyze(tempDir);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        expect(result.value.secret_warnings).toHaveLength(1);
        const w = result.value.secret_warnings[0];
        expect(w?.pattern).toContain("AWS");
        expect(w?.file).toContain("secret.md");
        expect(w?.line).toBeGreaterThan(0);
        // Snippet must be redacted — no raw key
        expect(w?.snippet).not.toContain("AKIAIOSFODNN7EXAMPLE");
      });

      it("reports private key block pattern", () => {
        const fileContent = `---
id: "PK-001"
type: knowledge
status: draft
priority: low
created: "2025-01-01"
updated: "2025-01-01"
tags: []
links: []
title: "PK Doc"
---

-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA...
-----END RSA PRIVATE KEY-----
`;
        writeFileSync(join(tempDir, "privkey.md"), fileContent);

        const result = service.analyze(tempDir);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        expect(result.value.secret_warnings.length).toBeGreaterThan(0);
        const patterns = result.value.secret_warnings.map((w) => w.pattern);
        expect(patterns).toContain("Private Key Block");
      });

      it("reports no warnings for clean files", () => {
        writeFileSync(join(tempDir, "clean.md"), makeKnowledgeFile("KNOW-001"));

        const result = service.analyze(tempDir);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        expect(result.value.secret_warnings).toHaveLength(0);
      });
    });

    describe("boundary values", () => {
      it("handles file with no links gracefully", () => {
        writeFileSync(join(tempDir, "nolnk.md"), makeKnowledgeFile("KNOW-001"));

        const result = service.analyze(tempDir);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        expect(result.value.link_mapping.total).toBe(0);
        expect(result.value.link_mapping.broken).toBe(0);
      });

      it("handles file with non-.md extension — ignored", () => {
        writeFileSync(join(tempDir, "ignored.txt"), "just text");
        writeFileSync(join(tempDir, "also.json"), "{}");
        writeFileSync(join(tempDir, "real.md"), makeKnowledgeFile("KNOW-001"));

        const result = service.analyze(tempDir);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        expect(result.value.total_files).toBe(1);
      });
    });
  });

  // ─── execute() ─────────────────────────────────────────────────────────────

  describe("execute()", () => {
    const defaultOpts = {
      dryRun: false,
      skipSecretScan: false,
      idStrategy: "remap" as const,
    };

    describe("happy path — import", () => {
      it("imports 3 docs → findMany returns 3 docs", async () => {
        writeFileSync(join(tempDir, "prd.md"), makePrdFile("PRD-001", "My PRD"));
        writeFileSync(
          join(tempDir, "spec.md"),
          makeSpecFile("SPEC-001", "Auth Spec", "PRD-001"),
        );
        writeFileSync(join(tempDir, "knowledge.md"), makeKnowledgeFile("KNOW-001"));

        const result = await service.execute(tempDir, defaultOpts);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        expect(result.value.imported).toBe(3);
        expect(result.value.skipped).toBe(0);

        const findResult = await store.findMany({});
        expect(findResult.ok).toBe(true);
        if (!findResult.ok) return;
        expect(findResult.value).toHaveLength(3);
      });

      it("generates slugs for imported docs", async () => {
        writeFileSync(join(tempDir, "prd.md"), makePrdFile("PRD-001", "My PRD Title"));

        const result = await service.execute(tempDir, defaultOpts);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const findResult = await store.findMany({});
        expect(findResult.ok).toBe(true);
        if (!findResult.ok) return;

        const doc = findResult.value[0];
        expect(doc?.slug).toMatch(/^prd-/);
        expect(doc?.slug).toContain("my-prd-title");
      });

      it("maps v1 spec doc → imported as type=spec", async () => {
        writeFileSync(
          join(tempDir, "spec.md"),
          makeSpecFile("SPEC-001", "Auth Spec", "PRD-001"),
        );

        const result = await service.execute(tempDir, defaultOpts);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const findResult = await store.findMany({ type: "spec" });
        expect(findResult.ok).toBe(true);
        if (!findResult.ok) return;
        expect(findResult.value).toHaveLength(1);
        expect(findResult.value[0]?.type).toBe("spec");
      });

      it("maps v1 prd → imported as type=prd with role=intent", async () => {
        writeFileSync(join(tempDir, "prd.md"), makePrdFile("PRD-001", "My PRD"));

        await service.execute(tempDir, defaultOpts);

        const findResult = await store.findMany({ type: "prd" });
        expect(findResult.ok).toBe(true);
        if (!findResult.ok) return;
        expect(findResult.value[0]?.role).toBe("intent");
      });

      it("stores v1_original_id in extra field", async () => {
        writeFileSync(join(tempDir, "prd.md"), makePrdFile("PRD-001", "My PRD"));

        await service.execute(tempDir, defaultOpts);

        const findResult = await store.findMany({});
        expect(findResult.ok).toBe(true);
        if (!findResult.ok) return;
        expect(findResult.value[0]?.extra?.["v1_original_id"]).toBe("PRD-001");
      });

      it("maps v1 'published' status → 'approved'", async () => {
        writeFileSync(join(tempDir, "prd.md"), makePrdFile("PRD-001", "My PRD"));

        await service.execute(tempDir, defaultOpts);

        const findResult = await store.findMany({});
        expect(findResult.ok).toBe(true);
        if (!findResult.ok) return;
        expect(findResult.value[0]?.status).toBe("approved");
      });
    });

    describe("v1 unknown type → knowledge with warning", () => {
      it("imports custom-note as knowledge type", async () => {
        writeFileSync(join(tempDir, "custom.md"), makeUnknownTypeFile("CUSTOM-001"));

        const result = await service.execute(tempDir, defaultOpts);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        expect(result.value.imported).toBe(1);
        expect(result.value.warnings.length).toBeGreaterThan(0);
        expect(result.value.warnings[0]).toContain("custom-note");

        const findResult = await store.findMany({ type: "knowledge" });
        expect(findResult.ok).toBe(true);
        if (!findResult.ok) return;
        expect(findResult.value).toHaveLength(1);
      });
    });

    describe("v1 links → link records created", () => {
      it("creates relates-to link records between imported docs", async () => {
        writeFileSync(join(tempDir, "prd.md"), makePrdFile("PRD-001", "My PRD"));
        writeFileSync(
          join(tempDir, "spec.md"),
          makeSpecFile("SPEC-001", "Auth Spec", "PRD-001"),
        );

        const result = await service.execute(tempDir, defaultOpts);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        expect(result.value.link_resolution.created).toBe(1);
        expect(result.value.link_resolution.broken).toBe(0);
      });

      it("logs broken links when target not imported", async () => {
        // SPEC links to PRD-MISSING which is not in corpus
        writeFileSync(
          join(tempDir, "spec.md"),
          makeSpecFile("SPEC-001", "Auth Spec", "PRD-MISSING"),
        );

        const result = await service.execute(tempDir, defaultOpts);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        expect(result.value.link_resolution.broken).toBe(1);
        expect(result.value.link_resolution.created).toBe(0);
      });
    });

    describe("dry run", () => {
      it("dry run → no docs written to store", async () => {
        writeFileSync(join(tempDir, "prd.md"), makePrdFile("PRD-001", "My PRD"));
        writeFileSync(join(tempDir, "spec.md"), makeSpecFile("SPEC-001", "Auth Spec", "PRD-001"));

        const result = await service.execute(tempDir, { ...defaultOpts, dryRun: true });
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        expect(result.value.imported).toBe(0);
        expect(result.value.warnings[0]).toContain("dry-run");

        const findResult = await store.findMany({});
        expect(findResult.ok).toBe(true);
        if (!findResult.ok) return;
        expect(findResult.value).toHaveLength(0);
      });
    });

    describe("idempotency — re-run skips existing docs", () => {
      it("second run on same corpus skips already-imported docs", async () => {
        writeFileSync(join(tempDir, "prd.md"), makePrdFile("PRD-001", "My PRD"));
        writeFileSync(join(tempDir, "spec.md"), makeSpecFile("SPEC-001", "Auth Spec", "PRD-001"));

        // First run
        const first = await service.execute(tempDir, defaultOpts);
        expect(first.ok).toBe(true);
        if (!first.ok) return;
        expect(first.value.imported).toBe(2);
        expect(first.value.skipped).toBe(0);

        // Second run — same corpus
        const second = await service.execute(tempDir, defaultOpts);
        expect(second.ok).toBe(true);
        if (!second.ok) return;
        expect(second.value.imported).toBe(0);
        expect(second.value.skipped).toBe(2);

        // Store still has exactly 2 docs
        const findResult = await store.findMany({});
        expect(findResult.ok).toBe(true);
        if (!findResult.ok) return;
        expect(findResult.value).toHaveLength(2);
      });
    });

    describe("secret scan blocking", () => {
      it("blocks import when secrets found and skipSecretScan=false", async () => {
        writeFileSync(join(tempDir, "secret.md"), makeFileWithAwsKey("SECRET-001"));

        const result = await service.execute(tempDir, {
          ...defaultOpts,
          skipSecretScan: false,
        });

        expect(result.ok).toBe(false);
        if (result.ok) return;

        expect(result.error.code).toBe("VALIDATION_ERROR");
        if (result.error.code !== "VALIDATION_ERROR") return;
        expect(result.error.message).toContain("secret");

        // Nothing imported
        const findResult = await store.findMany({});
        expect(findResult.ok).toBe(true);
        if (!findResult.ok) return;
        expect(findResult.value).toHaveLength(0);
      });

      it("proceeds when secrets found but skipSecretScan=true", async () => {
        writeFileSync(join(tempDir, "secret.md"), makeFileWithAwsKey("SECRET-001"));

        const result = await service.execute(tempDir, {
          ...defaultOpts,
          skipSecretScan: true,
        });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.imported).toBe(1);
      });

      it("proceeds normally when no secrets present", async () => {
        writeFileSync(join(tempDir, "clean.md"), makeKnowledgeFile("KNOW-001"));

        const result = await service.execute(tempDir, defaultOpts);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.imported).toBe(1);
      });
    });

    describe("idStrategy — preserve v1 IDs", () => {
      it("preserves original v1 ULID when idStrategy=preserve", async () => {
        writeFileSync(join(tempDir, "prd.md"), makePrdFile("PRD-ORIG-001", "My PRD"));

        await service.execute(tempDir, { ...defaultOpts, idStrategy: "preserve" });

        const docResult = await store.find("PRD-ORIG-001");
        expect(docResult.ok).toBe(true);
        if (!docResult.ok) return;
        expect(docResult.value).not.toBeNull();
        expect(docResult.value?.id).toBe("PRD-ORIG-001");
      });

      it("generates new ULID when idStrategy=remap", async () => {
        writeFileSync(join(tempDir, "prd.md"), makePrdFile("PRD-ORIG-001", "My PRD"));

        await service.execute(tempDir, { ...defaultOpts, idStrategy: "remap" });

        const findResult = await store.findMany({});
        expect(findResult.ok).toBe(true);
        if (!findResult.ok) return;
        expect(findResult.value[0]?.id).not.toBe("PRD-ORIG-001");
      });
    });

    describe("error handling", () => {
      it("returns STORE_ERROR for non-existent source directory", async () => {
        const result = await service.execute(
          "/tmp/nonexistent-lore-migration-test-xyz",
          defaultOpts,
        );
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.code).toBe("STORE_ERROR");
      });

      it("records unparseable files in errors array without crashing", async () => {
        writeFileSync(join(tempDir, "bad.md"), makeInvalidYamlFile());
        writeFileSync(join(tempDir, "good.md"), makeKnowledgeFile("KNOW-001"));

        const result = await service.execute(tempDir, defaultOpts);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        expect(result.value.imported).toBe(1);
        expect(result.value.errors).toHaveLength(1);
        expect(result.value.errors[0]?.file).toContain("bad.md");
      });
    });

    // N/A: stateless service — state transition tests covered in idempotency section
    // N/A: regression — no known prior bugs at time of writing
  });
});
