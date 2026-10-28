// @reads assets/governance/write-spec-rule.md
/**
 * Tests for scripts/seed-write-spec-rule.ts — bun test (not vitest) because seeding
 * writes through a real SQLiteStore-backed App (`createApp`), which pulls in
 * `bun:sqlite` (vitest.config.ts marks it external — see project CLAUDE.md).
 *
 * ⛔ Every test uses a throwaway corpus (mkdtemp + createApp, mirroring
 * packages/lore/src/adapters/cli/commands/init.ts's own init sequence) — NEVER the
 * repo's own `.lore/` corpus (project CLAUDE.md hard rule; see the 2026-07-07
 * pollution incident documented there).
 *
 * Coverage dimensions: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp, type App } from "../../../src/app.js";
import { liveAmbient, liveWriteContext } from "../../live-invocation.js";

import { ensureRequirementsDocId } from "../../helpers/parented-create.js";
/**
 * `scripts/` lives outside `packages/lore/tsconfig.tests.json`'s `rootDir` (which is
 * scoped to the `@lore/lore` workspace package), so a static `import` of the script
 * would fail `tsc --noEmit` with TS6059 (file outside rootDir) even though bun's
 * runtime resolver handles the relative path fine. Building the specifier as a
 * runtime `string` (not a string-literal syntax form) makes TypeScript treat the
 * dynamic `import()` as `Promise<any>` and skip static module resolution entirely —
 * this is the standard TS escape hatch for a cross-project runtime-only import, not
 * a workaround for a bug. The module's actual shape is asserted immediately below.
 */
const SCRIPT_PATH: string = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
  "..",
  "scripts",
  "seed-write-spec-rule.ts",
);

type SeedOutcome = "created" | "upgraded" | "skipped";

interface SeedResult {
  slug: string;
  outcome: SeedOutcome;
}

interface SeedWriteSpecRuleModule {
  seedWriteSpecRule: (app: App) => Promise<SeedResult>;
  SeedWriteSpecRuleError: new (
    operation: "list" | "create" | "approve" | "upgrade",
    loreError: unknown,
  ) => Error & { operation: "list" | "create" | "approve" | "upgrade"; loreError: unknown };
  WRITE_SPEC_RULE_TITLE: string;
}

// reason: SCRIPT_PATH is a `string`-typed runtime value (see comment above), so this
// dynamic import is NOT statically resolved by tsc — the explicit cast below is the
// module's real, hand-verified export shape (mirrors gate-feeding.ts's contract style).
const seedModule = (await import(SCRIPT_PATH)) as unknown as SeedWriteSpecRuleModule;
const { seedWriteSpecRule, SeedWriteSpecRuleError, WRITE_SPEC_RULE_TITLE } = seedModule;

let tmpDir: string;
let app: App;

/** Mirrors `lore init`'s DB bootstrap (commands/init.ts) without the CLI/config plumbing. */
function openThrowawayApp(): App {
  const loreDir = join(tmpDir, ".lore");
  mkdirSync(loreDir, { recursive: true });
  return createApp(join(loreDir, "lore.db"), undefined, liveAmbient(), liveWriteContext());
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "lore-seed-test-"));
  app = openThrowawayApp();
});

afterEach(() => {
  app.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("seedWriteSpecRule", () => {
  // HAPPY
  it("creates exactly one approved knowledge/skill doc on first run", async () => {
    const result = await seedWriteSpecRule(app);
    expect(result.outcome).toBe("created");
    expect(typeof result.slug).toBe("string");
    expect(result.slug.length).toBeGreaterThan(0);

    const listResult = await app.corpusService.list({ type: "knowledge" });
    expect(listResult.ok).toBe(true);
    if (!listResult.ok) throw new Error("unreachable");
    expect(listResult.value.docs.length).toBe(1);

    const doc = listResult.value.docs[0];
    expect(doc?.title).toBe(WRITE_SPEC_RULE_TITLE);
    expect(doc?.status).toBe("approved");

    const fullResult = await app.corpusService.listFull({ type: "knowledge" });
    expect(fullResult.ok).toBe(true);
    if (!fullResult.ok) throw new Error("unreachable");
    const extra = fullResult.value.docs[0]?.extra ?? {};
    expect(extra["sub_type"]).toBe("skill");
    expect((extra["skill"] as { applies_to?: string } | undefined)?.applies_to).toBe("spec");
  });

  // STATE — idempotency: second run does not duplicate
  it("is idempotent — a second run (already skill) skips and yields no duplicate", async () => {
    const first = await seedWriteSpecRule(app);
    const second = await seedWriteSpecRule(app);

    expect(first.outcome).toBe("created");
    expect(second.outcome).toBe("skipped");
    expect(second.slug).toBe(first.slug);

    const listResult = await app.corpusService.list({ type: "knowledge" });
    expect(listResult.ok).toBe(true);
    if (!listResult.ok) throw new Error("unreachable");
    expect(listResult.value.docs.length).toBe(1);
  });

  // STATE — upgrade path: a pre-existing sub_type="reference" doc is upgraded in place
  it("upgrades an existing approved sub_type=reference doc to skill in place, without creating a duplicate", async () => {
    const manual = await app.corpusService.create({
      parent_id: await ensureRequirementsDocId(app.corpusService), type: "knowledge",
      title: WRITE_SPEC_RULE_TITLE,
      content: "legacy reference content",
      extra: { sub_type: "reference" },
    });
    expect(manual.ok).toBe(true);
    if (!manual.ok) throw new Error("unreachable");
    const approveManual = await app.corpusService.set(manual.value.id, { status: "approved" });
    expect(approveManual.ok).toBe(true);
    if (!approveManual.ok) throw new Error("unreachable");
    expect(approveManual.value.status).toBe("approved");

    const result = await seedWriteSpecRule(app);
    expect(result.outcome).toBe("upgraded");
    expect(result.slug).toBe(approveManual.value.slug);

    // exactly one knowledge doc — the existing doc was upgraded in place, not duplicated
    const listResult = await app.corpusService.list({ type: "knowledge" });
    expect(listResult.ok).toBe(true);
    if (!listResult.ok) throw new Error("unreachable");
    expect(listResult.value.docs.length).toBe(1);

    const fullResult = await app.corpusService.listFull({ type: "knowledge" });
    expect(fullResult.ok).toBe(true);
    if (!fullResult.ok) throw new Error("unreachable");
    const upgradedDoc = fullResult.value.docs[0];
    expect(upgradedDoc?.id).toBe(manual.value.id);
    expect(upgradedDoc?.status).toBe("approved");
    expect(upgradedDoc?.extra["sub_type"]).toBe("skill");
    expect((upgradedDoc?.extra["skill"] as { applies_to?: string } | undefined)?.applies_to).toBe(
      "spec",
    );

    // a further run on the now-upgraded doc is a no-op skip, not a re-upgrade
    const third = await seedWriteSpecRule(app);
    expect(third.outcome).toBe("skipped");
    expect(third.slug).toBe(result.slug);
    const finalList = await app.corpusService.list({ type: "knowledge" });
    expect(finalList.ok).toBe(true);
    if (!finalList.ok) throw new Error("unreachable");
    expect(finalList.value.docs.length).toBe(1);
  });

  // STATE — three runs still yields exactly one doc
  it("stays at exactly one doc across three consecutive runs", async () => {
    await seedWriteSpecRule(app);
    await seedWriteSpecRule(app);
    await seedWriteSpecRule(app);

    const listResult = await app.corpusService.list({ type: "knowledge" });
    expect(listResult.ok).toBe(true);
    if (!listResult.ok) throw new Error("unreachable");
    expect(listResult.value.docs.length).toBe(1);
  });

  // NEGATIVE — a differently-titled knowledge doc does not block seeding
  it("still seeds when an unrelated knowledge doc already exists", async () => {
    const unrelated = await app.corpusService.create({
      parent_id: await ensureRequirementsDocId(app.corpusService), type: "knowledge",
      title: "Some other reference doc",
      content: "unrelated",
      extra: { sub_type: "reference" },
    });
    expect(unrelated.ok).toBe(true);

    const result = await seedWriteSpecRule(app);
    expect(result.outcome).toBe("created");

    const listResult = await app.corpusService.list({ type: "knowledge" });
    expect(listResult.ok).toBe(true);
    if (!listResult.ok) throw new Error("unreachable");
    expect(listResult.value.docs.length).toBe(2);
  });

  // BOUNDARY — content carries the required skeleton headings the gate itself checks for
  it("seeds content containing the gate-relevant skeleton headings", async () => {
    await seedWriteSpecRule(app);
    const fullResult = await app.corpusService.listFull({ type: "knowledge" });
    expect(fullResult.ok).toBe(true);
    if (!fullResult.ok) throw new Error("unreachable");
    const content = fullResult.value.docs[0]?.content ?? "";
    expect(content).toContain("## Overview");
    expect(content).toContain("## Scope");
    expect(content).toContain("## Acceptance Criteria");
  });

  // ERROR — closed store surfaces a typed SeedWriteSpecRuleError, not a bare throw
  it("throws SeedWriteSpecRuleError with the failing operation when the store is closed", async () => {
    app.close();
    await expect(seedWriteSpecRule(app)).rejects.toThrow(SeedWriteSpecRuleError);
    try {
      await seedWriteSpecRule(app);
      throw new Error("expected seedWriteSpecRule to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(SeedWriteSpecRuleError);
      if (e instanceof SeedWriteSpecRuleError) {
        expect(e.operation).toBe("list");
        expect(e.loreError).toBeDefined();
      }
    }
    // Re-open so afterEach's app.close() (already-closed) doesn't itself throw.
    app = openThrowawayApp();
  });

  // REGRESSION — resulting slug is stable and resolvable via corpusService.get
  it("the returned slug resolves back to the same approved doc via corpusService.get", async () => {
    const result = await seedWriteSpecRule(app);
    const getResult = await app.corpusService.get(result.slug);
    expect(getResult.ok).toBe(true);
    if (!getResult.ok) throw new Error("unreachable");
    expect(getResult.value.doc.title).toBe(WRITE_SPEC_RULE_TITLE);
    expect(getResult.value.doc.status).toBe("approved");
  });
});
