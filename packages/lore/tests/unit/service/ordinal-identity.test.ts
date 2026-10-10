/**
 * SPEC-084 service+resolution unit suite: ordinal auto-allocation on
 * create, title-purity rejection on BOTH write paths (create + set/rename),
 * `resolveDoc` ordinal resolution + SPEC-065 id-prefix regression, and the
 * formatter import-graph pin (no `SPEC-`/`ADR-` composition outside core's
 * dedicated formatter module).
 *
 * RED STATE (2026-07-26): the top-level import below pulls `ORDINAL_REGISTRY`
 * / `formatDocDisplayId` / `composeDocDisplayTitle` / `parseOrdinalRef` from
 * `@lore/core` — NONE of these exist yet (T3's not-yet-written core module).
 * A static ESM import of a nonexistent named export fails the WHOLE file at
 * module-load time ("does not provide an export named ..."), which is the
 * canonical, unambiguous missing-implementation-class RED signal for this
 * AC — never a self-inflicted assertion bug in the `it()` blocks below.
 * Once T3 lands the core module and T2/service wiring lands, this import
 * resolves and the individual scenarios below become the real oracle.
 *
 * @spec_ref AC-084-3
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { CreateDocInput, DocRecord } from "@lore/core";
// eslint-disable-next-line import/no-unresolved -- RED oracle: these exports do not exist yet (SPEC-084 T3).
import {
  ORDINAL_REGISTRY,
  formatDocDisplayId,
  composeDocDisplayTitle,
  parseOrdinalRef,
} from "@lore/core";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { resolveDoc } from "../../../src/service/resolve.js";

// ─── Test helpers ───────────────────────────────────────────────────────────

function makeStore() {
  return new InMemoryStore();
}

function makeService(store = makeStore()) {
  return { service: new CorpusService(store), store };
}

function prdInput(title = "My Product"): CreateDocInput {
  return { type: "prd", title };
}

function specInput(parentId: string, title = "My Spec"): CreateDocInput {
  return { type: "spec", title};
}

async function makeParentPrd(service: CorpusService): Promise<string> {
  const result = await service.create(prdInput());
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("failed to create parent PRD fixture");
  return result.value.id;
}

// ─── Ordinal auto-allocation on create ─────────────────────────────────────

describe("CorpusService.create — ordinal auto-allocation (AC-084-3 HAPPY)", () => {
  it("first spec ever created for this store gets ordinal 1", async () => {
    const { service } = makeService();
    const parentId = await makeParentPrd(service);

    const result = await service.create(specInput(parentId, "First Numbered Spec"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const doc = result.value as unknown as { ordinal: unknown };
    expect(doc.ordinal).toBe(1);
  });

  it("a second spec created afterward gets ordinal 2, not reusing 1", async () => {
    const { service } = makeService();
    const parentId = await makeParentPrd(service);

    const first = await service.create(specInput(parentId, "Spec One"));
    expect(first.ok).toBe(true);
    const second = await service.create(specInput(parentId, "Spec Two"));
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    const doc = second.value as unknown as { ordinal: unknown };
    expect(doc.ordinal).toBe(2);
  });

  it("a domain-overview kind spec (exempt) gets a NULL ordinal, never a number", async () => {
    const { service } = makeService();
    const parentId = await makeParentPrd(service);

    const result = await service.create({
      type: "spec",
      title: "Domain Detail Doc",
      extra: { spec_kind: "domain-overview" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const doc = result.value as unknown as { ordinal: unknown };
    expect(doc.ordinal).toBeNull();
  });
});

// ─── Title purity — create path (schema superRefine) ───────────────────────

describe("createDocInputSchema — title purity (AC-084-3 NEGATIVE, create path)", () => {
  it("rejects a spec title self-declaring 'SPEC-99' with VALIDATION_ERROR", async () => {
    const { service } = makeService();
    const parentId = await makeParentPrd(service);

    const result = await service.create(specInput(parentId, "SPEC-99 — Self Declared Number"));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects an adr title self-declaring 'ADR-7' with VALIDATION_ERROR", async () => {
    const { service } = makeService();

    const result = await service.create({
      type: "adr",
      title: "ADR-7 — Self Declared Number",
      extra: { decision_status: "proposed" },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });
});

// ─── Title purity — set/rename path (service-level guard) ──────────────────

describe("CorpusService.set — title purity on rename (AC-084-3 NEGATIVE, update path)", () => {
  it("rejects renaming an existing spec's title to self-declare 'SPEC-099'", async () => {
    const { service } = makeService();
    const parentId = await makeParentPrd(service);

    const created = await service.create(specInput(parentId, "Innocuous Title"));
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const renamed = await service.set(created.value.id, { title: "SPEC-099 — Renamed" });
    expect(renamed.ok).toBe(false);
    if (renamed.ok) return;
    expect(renamed.error.code).toBe("VALIDATION_ERROR");
  });
});

// ─── resolveDoc — ordinal resolution + SPEC-065 regression ────────────────

describe("resolveDoc — ordinal-ref resolution (AC-084-3 HAPPY + BOUNDARY)", () => {
  async function seedNumberedSpec(store: InMemoryStore, ordinal: number): Promise<DocRecord> {
    const doc = {
      id: `01HORDRES${String(ordinal).padStart(17, "0")}`,
      slug: `spec-numbered-fixture-${ordinal}`,
      type: "spec" as const,
      role: "requirement" as const,
      title: `Numbered Fixture ${ordinal}`,
      status: "draft" as const,
      priority: "medium" as const,
      content: "Fixture body",
      parent_id: null,
      extra: {},
      tags: [],
      version: 1,
      created_at: "2026-07-26T00:00:00.000Z",
      updated_at: "2026-07-26T00:00:00.000Z",
      created_by: "agent:test",
      deleted_at: null,
      ordinal,
    } as unknown as DocRecord;
    const result = await store.insert(doc);
    expect(result.ok).toBe(true);
    return doc;
  }

  it("'SPEC-84' resolves the spec whose ordinal is 84", async () => {
    const store = makeStore();
    const doc = await seedNumberedSpec(store, 84);

    const result = await resolveDoc(store, "SPEC-84");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.id).toBe(doc.id);
  });

  it("'spec-084' (lowercase, zero-padded) resolves the same doc", async () => {
    const store = makeStore();
    const doc = await seedNumberedSpec(store, 84);

    const result = await resolveDoc(store, "spec-084");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.id).toBe(doc.id);
  });

  it("'SPEC-084' (uppercase, zero-padded) resolves the same doc", async () => {
    const store = makeStore();
    const doc = await seedNumberedSpec(store, 84);

    const result = await resolveDoc(store, "SPEC-084");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.id).toBe(doc.id);
  });

  it("REGRESSION: a non-ordinal, id-prefix-shaped input still falls through to the SPEC-065 id-prefix path", async () => {
    const { service, store } = makeService();
    const parentId = await makeParentPrd(service);
    const created = await service.create(specInput(parentId, "Prefix Regression Fixture"));
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    // reason: ULID's first 10 chars are PURELY the 48-bit millisecond
    // timestamp — any two docs created in the same millisecond (e.g. this
    // fixture's own parent PRD, created microseconds earlier) share that
    // exact prefix, producing a spurious multi-candidate ambiguity. Slicing
    // further into the high-entropy random suffix (18 chars: 10 timestamp +
    // 8 random) keeps this deterministic regardless of test-run timing.
    const prefix = created.value.id.slice(0, 18);
    const result = await resolveDoc(store, prefix);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.id).toBe(created.value.id);
  });
});

// ─── Formatter import-graph pin ─────────────────────────────────────────────

describe("display-id composition — single-site import-graph pin (AC-084-3)", () => {
  const SEARCH_ROOTS = ["packages/core/src", "packages/lore/src"];
  // Matches template-literal or string-concat construction of a "SPEC-"/"ADR-"
  // display id, e.g. `` `SPEC-${n}` ``, `"ADR-" + n`. Deliberately loose — the
  // point is to catch ANY ad-hoc composition, not just one exact style.
  const COMPOSITION_PATTERN = /[`"'](SPEC|ADR)-(\$\{|"\s*\+|'\s*\+)/;

  function walk(dir: string, repoRoot: string): string[] {
    const abs = join(repoRoot, dir);
    let entries: string[];
    try {
      entries = readdirSync(abs);
    } catch {
      return [];
    }
    const files: string[] = [];
    for (const entry of entries) {
      const rel = join(dir, entry);
      const absEntry = join(repoRoot, rel);
      const st = statSync(absEntry);
      if (st.isDirectory()) {
        files.push(...walk(rel, repoRoot));
      } else if (
        entry.endsWith(".ts") &&
        !entry.endsWith(".test.ts") &&
        !entry.endsWith(".bun.test.ts")
      ) {
        files.push(rel);
      }
    }
    return files;
  }

  function findRepoRoot(): string {
    // tests run with cwd somewhere under the repo; walk up from this file's
    // known relative location (packages/lore/tests/unit/service/) to the root.
    return join(__dirname, "..", "..", "..", "..", "..");
  }

  it("exactly one core module composes SPEC-/ADR- display ids, and it defines formatDocDisplayId + composeDocDisplayTitle", () => {
    const repoRoot = findRepoRoot();
    const matchingFiles: string[] = [];

    for (const root of SEARCH_ROOTS) {
      for (const relFile of walk(root, repoRoot)) {
        const content = readFileSync(join(repoRoot, relFile), "utf8");
        if (COMPOSITION_PATTERN.test(content)) {
          matchingFiles.push(relFile);
        }
      }
    }

    expect(matchingFiles.length).toBe(1);
    const [formatterFile] = matchingFiles;
    if (formatterFile === undefined) return;
    const formatterContent = readFileSync(join(repoRoot, formatterFile), "utf8");
    expect(formatterContent).toContain("formatDocDisplayId");
    expect(formatterContent).toContain("composeDocDisplayTitle");
  });
});

// ─── Registry + parseOrdinalRef sanity (documents the expected contract) ───

describe("ORDINAL_REGISTRY + parseOrdinalRef (AC-084-3 BOUNDARY)", () => {
  it("ORDINAL_REGISTRY declares spec (exempt: domain-overview) and adr, nothing else", () => {
    expect(Object.keys(ORDINAL_REGISTRY).sort()).toEqual(["adr", "spec"]);
    expect(ORDINAL_REGISTRY.spec?.prefix).toBe("SPEC");
    expect(ORDINAL_REGISTRY.spec?.exemptKinds).toContain("domain-overview");
    expect(ORDINAL_REGISTRY.adr?.prefix).toBe("ADR");
  });

  it("parseOrdinalRef parses 'SPEC-84' / 'spec-084' and rejects non-ordinal input", () => {
    expect(parseOrdinalRef("SPEC-84")).toEqual({ type: "spec", ordinal: 84 });
    expect(parseOrdinalRef("spec-084")).toEqual({ type: "spec", ordinal: 84 });
    expect(parseOrdinalRef("ADR-7")).toEqual({ type: "adr", ordinal: 7 });
    expect(parseOrdinalRef("not-an-ordinal-ref")).toBeNull();
    expect(parseOrdinalRef("01HORDRES00000000000000084")).toBeNull();
  });

  it("formatDocDisplayId returns null for a doc with no ordinal, composed string for one that has it", () => {
    const numbered = { type: "spec", ordinal: 84 } as unknown as DocRecord;
    const unnumbered = { type: "spec", ordinal: null } as unknown as DocRecord;
    expect(formatDocDisplayId(numbered)).toBe("SPEC-84");
    expect(formatDocDisplayId(unnumbered)).toBeNull();
  });

  it("composeDocDisplayTitle prefixes the display id when present, bare title otherwise", () => {
    const numbered = { type: "spec", ordinal: 84, title: "Ordinal Identity" } as unknown as DocRecord;
    const unnumbered = { type: "spec", ordinal: null, title: "Domain Detail" } as unknown as DocRecord;
    expect(composeDocDisplayTitle(numbered)).toBe("SPEC-84 — Ordinal Identity");
    expect(composeDocDisplayTitle(unnumbered)).toBe("Domain Detail");
  });
});
