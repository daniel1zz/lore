/**
 * `DriftCheckResult` reports the KNOWLEDGE scanned population as its own field,
 * independent of `specs_checked`, and the retired `DriftRow` slug spelling is gone
 * from the code universe (M2 of
 * `spec-a-write-side-fact-with-no-read-side-address-counts-with-no`, AC-RR-8).
 *
 * Pure vitest — `InMemoryStore` + `CorpusService` (fixture builder) + a hand-built
 * `FsProbe` stub. No `bun:sqlite`, no real filesystem for the drift scans (the
 * repo-source census below does read files, but only to grep the working tree).
 *
 * Six-dimension coverage:
 *   HAPPY:      N knowledge docs declaring zero anchors → `knowledge_checked` exactly
 *               0 while `specs_checked` keeps its own independent value; after one
 *               declares an anchor → exactly 1, `specs_checked` unmoved
 *   NEGATIVE:   the anchor RMW verbs still refuse a doc that is neither spec nor
 *               knowledge, naming both accepted types; malformed grammar on a
 *               knowledge target is rejected without mutating the doc
 *   BOUNDARY:   a knowledge doc whose `code_anchors` is an EMPTY array is NOT armed;
 *               a corpus armed ONLY by knowledge still reports `armed: true` with
 *               `specs_checked: 0`
 *   ERROR:      a knowledge anchor whose probe throws becomes a `probe_error` row
 *               still attributed to `doc_type: "knowledge"`
 *   STATE:      a soft-deleted armed knowledge doc leaves `knowledge_checked`
 *               (the count is over NON-DELETED docs only)
 *   REGRESSION: the retired `DriftRow` slug field spelling has zero occurrences in
 *               `packages/**` + `scripts/**`, and every occurrence anywhere else in
 *               the repo is dated governance prose under `docs/`; every sibling
 *               `extra` key survives a knowledge anchor write; the count reaches the
 *               `CodeDriftPayload` both the CLI and MCP surfaces actually return
 *
 * @spec_ref spec-a-write-side-fact-with-no-read-side-address-counts-with-no §M2, AC-RR-8
 */

import { readFileSync, readdirSync } from "fs";
import { join, relative, sep } from "path";
import { describe, expect, it } from "vitest";
import type { CreateDocInput } from "@lore/core";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { DriftCheckService, type FsProbe } from "../../../src/service/drift-check-service.js";
import { disabledCodeDriftPayload, runDrift } from "../../../src/flows/drift-flow.js";

// ─── Fixture helpers ──────────────────────────────────────────────────────────

function makeServices() {
  const store = new InMemoryStore();
  return { store, corpusService: new CorpusService(store), driftCheckService: new DriftCheckService(store) };
}

async function createDoc(corpusService: CorpusService, input: CreateDocInput): Promise<string> {
  const result = await corpusService.create(input);
  if (!result.ok) throw new Error(`create ${input.type} failed: ${JSON.stringify(result.error)}`);
  return result.value.id;
}

async function createPrd(corpusService: CorpusService): Promise<string> {
  return createDoc(corpusService, { type: "prd", title: "Population PRD", content: "root" } as CreateDocInput);
}

async function createSpec(
  corpusService: CorpusService,
  parentId: string,
  title: string,
  codeAnchors?: string[],
): Promise<string> {
  return createDoc(corpusService, {
    type: "spec",
    title,
    parent_id: parentId,
    content: "spec body",
    ...(codeAnchors === undefined ? {} : { extra: { code_anchors: codeAnchors } }),
  } as CreateDocInput);
}

async function createKnowledge(
  corpusService: CorpusService,
  parentId: string,
  title: string,
  extra: Record<string, unknown> = {},
): Promise<string> {
  return createDoc(corpusService, {
    type: "knowledge",
    title,
    parent_id: parentId,
    content: "fact body",
    extra: { sub_type: "reference", ...extra },
  } as CreateDocInput);
}

/** A deterministic FsProbe stub — `present` paths resolve, everything else is missing. */
function makeProbe(present: Record<string, { kind: "file" | "dir"; content?: string; children?: string[] }>): FsProbe {
  return {
    stat: (path) => present[path]?.kind ?? "missing",
    readFile: (path) => present[path]?.content ?? null,
    listDir: (path) => present[path]?.children ?? null,
  };
}

/** The always-resolving fixture file both populations anchor at. */
const RESOLVING = { "src/suspension.ts": { kind: "file" as const, content: "export function isSuspended() {}\n" } };

// ─── HAPPY / STATE — the two populations are counted independently ────────────

describe("HAPPY — knowledge_checked is its own field, independent of specs_checked", () => {
  it("three knowledge docs declaring zero anchors → knowledge_checked exactly 0, specs_checked exactly 2", async () => {
    const { corpusService, driftCheckService } = makeServices();
    const prdId = await createPrd(corpusService);
    await createSpec(corpusService, prdId, "Armed Spec One", ["src/suspension.ts"]);
    await createSpec(corpusService, prdId, "Armed Spec Two", ["src/suspension.ts"]);
    await createKnowledge(corpusService, prdId, "Unarmed Fact One");
    await createKnowledge(corpusService, prdId, "Unarmed Fact Two");
    await createKnowledge(corpusService, prdId, "Unarmed Fact Three");

    const result = await driftCheckService.checkDrift(makeProbe(RESOLVING));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.knowledge_checked).toBe(0);
    expect(result.value.specs_checked).toBe(2);
    expect(result.value.consistent).toBe(true);
  });

  it("after ONE of those knowledge docs declares an anchor → knowledge_checked exactly 1, specs_checked unmoved at 2", async () => {
    const { corpusService, driftCheckService } = makeServices();
    const prdId = await createPrd(corpusService);
    await createSpec(corpusService, prdId, "Armed Spec One", ["src/suspension.ts"]);
    await createSpec(corpusService, prdId, "Armed Spec Two", ["src/suspension.ts"]);
    const factId = await createKnowledge(corpusService, prdId, "Fact That Declares");
    await createKnowledge(corpusService, prdId, "Fact That Does Not");

    const added = await driftCheckService.addCodeAnchors(factId, ["src/suspension.ts#isSuspended"]);
    expect(added.ok).toBe(true);

    const result = await driftCheckService.checkDrift(makeProbe(RESOLVING));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.knowledge_checked).toBe(1);
    expect(result.value.specs_checked).toBe(2);
    expect(result.value.consistent).toBe(true);
  });
});

// ─── BOUNDARY ────────────────────────────────────────────────────────────────

describe("BOUNDARY — arming edges of the knowledge population", () => {
  it("a knowledge doc whose code_anchors is an EMPTY array is NOT armed", async () => {
    const { corpusService, driftCheckService } = makeServices();
    const prdId = await createPrd(corpusService);
    await createKnowledge(corpusService, prdId, "Empty Anchor Array Fact", { code_anchors: [] });

    const result = await driftCheckService.checkDrift(makeProbe(RESOLVING));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.knowledge_checked).toBe(0);
    expect(result.value.armed).toBe(false);
  });

  it("a corpus armed ONLY by a knowledge doc reports armed:true with specs_checked 0 and knowledge_checked 1", async () => {
    const { corpusService, driftCheckService } = makeServices();
    const prdId = await createPrd(corpusService);
    await createSpec(corpusService, prdId, "Unarmed Spec");
    await createKnowledge(corpusService, prdId, "Only Armed Doc", { code_anchors: ["src/gone.ts"] });

    const result = await driftCheckService.checkDrift(makeProbe(RESOLVING));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.armed).toBe(true);
    expect(result.value.specs_checked).toBe(0);
    expect(result.value.knowledge_checked).toBe(1);
    expect(result.value.consistent).toBe(false);
    expect(result.value.drifts).toHaveLength(1);
    expect(result.value.drifts[0]).toMatchObject({ doc_type: "knowledge", kind: "file_missing" });
  });
});

// ─── ERROR ───────────────────────────────────────────────────────────────────

describe("ERROR — a throwing probe on a knowledge anchor", () => {
  it("becomes a probe_error row still attributed to doc_type 'knowledge'", async () => {
    const { corpusService, driftCheckService } = makeServices();
    const prdId = await createPrd(corpusService);
    const factId = await createKnowledge(corpusService, prdId, "Probe Error Fact", {
      code_anchors: ["src/unreadable.ts"],
    });
    const docResult = await corpusService.get(factId);
    expect(docResult.ok).toBe(true);
    if (!docResult.ok) return;

    const throwingProbe: FsProbe = {
      stat: () => {
        throw new Error("EACCES: permission denied");
      },
      readFile: () => null,
      listDir: () => null,
    };

    const result = await driftCheckService.checkDrift(throwingProbe);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.drifts).toHaveLength(1);
    expect(result.value.drifts[0]).toMatchObject({
      doc_type: "knowledge",
      doc_slug: docResult.value.doc.slug,
      kind: "probe_error",
    });
    expect(result.value.drifts[0]?.detail).toContain("EACCES");
  });
});

// ─── NEGATIVE ────────────────────────────────────────────────────────────────

describe("NEGATIVE — the anchor RMW verbs' accepted target types", () => {
  it("a plan target is still refused, and the refusal names both accepted types", async () => {
    const { corpusService, driftCheckService } = makeServices();
    const prdId = await createPrd(corpusService);
    const planId = await createDoc(corpusService, {
      type: "plan",
      title: "Not An Anchor Target",
      parent_id: prdId,
      content: "plan body",
    } as CreateDocInput);

    const result = await driftCheckService.addCodeAnchors(planId, ["src/suspension.ts"]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    if (result.error.code !== "VALIDATION_ERROR") return;
    expect(result.error.message).toContain("spec");
    expect(result.error.message).toContain("knowledge");
    expect(result.error.message).toContain("plan");
  });

  it("malformed anchor grammar on a knowledge target is rejected without mutating the doc", async () => {
    const { corpusService, driftCheckService } = makeServices();
    const prdId = await createPrd(corpusService);
    const factId = await createKnowledge(corpusService, prdId, "Grammar Guard Fact", {
      code_anchors: ["src/suspension.ts"],
    });

    const result = await driftCheckService.addCodeAnchors(factId, ["../escapes/the/repo.ts"]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");

    const after = await corpusService.get(factId);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.value.doc.extra["code_anchors"]).toEqual(["src/suspension.ts"]);
    // Every sibling extra key survives the rejected write AND is preserved by the
    // spread on the accepted one (`{...doc.extra, code_anchors: ...}`).
    expect(after.value.doc.extra["sub_type"]).toBe("reference");
  });

  it("an accepted knowledge anchor write preserves every sibling extra key", async () => {
    const { corpusService, driftCheckService } = makeServices();
    const prdId = await createPrd(corpusService);
    const factId = await createKnowledge(corpusService, prdId, "Sibling Key Fact", { tags_note: "keep me" });

    const added = await driftCheckService.addCodeAnchors(factId, ["src/suspension.ts#isSuspended"]);
    expect(added.ok).toBe(true);

    const after = await corpusService.get(factId);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.value.doc.extra["sub_type"]).toBe("reference");
    expect(after.value.doc.extra["tags_note"]).toBe("keep me");
    expect(after.value.doc.extra["code_anchors"]).toEqual(["src/suspension.ts#isSuspended"]);
  });
});

// ─── STATE ───────────────────────────────────────────────────────────────────

describe("STATE — the knowledge population counts NON-DELETED docs only", () => {
  it("soft-deleting the only armed knowledge doc drops knowledge_checked back to 0", async () => {
    const { corpusService, driftCheckService } = makeServices();
    const prdId = await createPrd(corpusService);
    const factId = await createKnowledge(corpusService, prdId, "Soon Deleted Fact", {
      code_anchors: ["src/suspension.ts"],
    });

    const before = await driftCheckService.checkDrift(makeProbe(RESOLVING));
    expect(before.ok && before.value.knowledge_checked).toBe(1);

    const deleted = await corpusService.delete(factId, true);
    expect(deleted.ok).toBe(true);

    const after = await driftCheckService.checkDrift(makeProbe(RESOLVING));
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.value.knowledge_checked).toBe(0);
    expect(after.value.armed).toBe(false);
  });
});

// ─── REGRESSION — the count reaches the payload both adapters return ─────────

describe("REGRESSION — knowledge_checked reaches the CodeDriftPayload the CLI and MCP return", () => {
  it("runDrift carries knowledge_checked through from the service result", async () => {
    const { corpusService, driftCheckService } = makeServices();
    const prdId = await createPrd(corpusService);
    await createSpec(corpusService, prdId, "Payload Spec", ["src/suspension.ts"]);
    await createKnowledge(corpusService, prdId, "Payload Fact", { code_anchors: ["src/suspension.ts"] });

    const payload = await runDrift(
      { checkDrift: (probe) => driftCheckService.checkDrift(probe), listSpecs: async () => ({ ok: true, value: [] }) },
      makeProbe(RESOLVING),
    );
    expect(payload.ok).toBe(true);
    if (!payload.ok) return;
    expect(payload.value.knowledge_checked).toBe(1);
    expect(payload.value.specs_checked).toBe(1);
  });

  it("the workflow.drift.enabled:false LOUD-skip payload declares knowledge_checked 0 rather than omitting it", () => {
    expect(disabledCodeDriftPayload().knowledge_checked).toBe(0);
  });
});

// ─── REGRESSION — the retired slug spelling is gone from the code universe ────

/**
 * The retired `DriftRow` field name, assembled at runtime.
 *
 * reason: this file is INSIDE the scan universe below, so writing the retired
 * spelling as a literal here would make the census match itself and it could never
 * report zero. ⛔ Never inline it.
 */
const RETIRED_SLUG_FIELD = ["spec", "slug"].join("_");

/** The successor spelling — asserted PRESENT, so a zero-hit census can't be a broken walker. */
const CURRENT_SLUG_FIELD = ["doc", "slug"].join("_");

const REPO_ROOT = new URL("../../../../../", import.meta.url).pathname.replace(/\/$/, "");

/**
 * Directory names never descended into. `worktrees` is load-bearing: the main
 * checkout holds concurrent agent worktrees under `.claude/worktrees/`, and
 * descending into them would make this census's verdict depend on peers' work in
 * progress rather than on this tree.
 */
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "worktrees",
  ".git",
  ".lore",
  ".lore-bootstrap",
  ".serena",
  "coverage",
  "test-results",
  "playwright-report",
  ".turbo",
]);

const SCANNED_EXTENSIONS = [".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".yaml", ".yml", ".md", ".sh"];

/** Recursively collects every scannable text file under `dir`. Pure read, no writes. */
function collectTextFiles(dir: string, into: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      collectTextFiles(join(dir, entry.name), into);
      continue;
    }
    if (!entry.isFile()) continue;
    if (SCANNED_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) into.push(join(dir, entry.name));
  }
  return into;
}

function filesContaining(files: readonly string[], needle: string): string[] {
  return files
    .filter((file) => readFileSync(file, "utf8").includes(needle))
    .map((file) => relative(REPO_ROOT, file).split(sep).join("/"));
}

describe("REGRESSION — the retired DriftRow slug spelling does not coexist with its successor", () => {
  it("zero occurrences across packages/** and scripts/** — and the successor spelling IS present there", () => {
    const codeFiles = [...collectTextFiles(join(REPO_ROOT, "packages")), ...collectTextFiles(join(REPO_ROOT, "scripts"))];

    // Positive trace of execution first: an empty file list would make the
    // zero-hit assertion below vacuously true (the "an EMPTY artifact is the same
    // shape as a clean one" failure mode).
    expect(codeFiles.length).toBeGreaterThan(500);
    expect(filesContaining(codeFiles, CURRENT_SLUG_FIELD)).toContain("packages/core/src/code-anchors.ts");

    expect(filesContaining(codeFiles, RETIRED_SLUG_FIELD)).toEqual([]);
  });

  it("every remaining repo-wide occurrence is dated governance prose under docs/ — nothing in hooks/, assets/, or configs", () => {
    // ⛔ Literal repo-wide zero is UNREACHABLE by construction: the governing spec,
    // this task, and the frozen pre-2026-07-22 archive all NAME the retired spelling
    // in order to record the rename, and `docs/requirements/**` is a generated mirror
    // of that corpus (`bun run mirror:export`) — rewriting it would falsify a dated
    // record and desynchronize the mirror from its SSOT. So the assertion is: the
    // identifier survives ONLY as prose under docs/, never in a file any runtime,
    // hook, or shipped asset reads.
    const repoFiles = collectTextFiles(REPO_ROOT).map((file) => relative(REPO_ROOT, file).split(sep).join("/"));

    // Positive trace that the walk left packages/ and scripts/ behind — otherwise
    // "nothing outside docs/" would hold for a walk that never reached anything.
    expect(repoFiles).toContain("CLAUDE.md");
    expect(repoFiles.some((path) => path.startsWith("docs/"))).toBe(true);
    expect(repoFiles.some((path) => path.startsWith("hooks/"))).toBe(true);
    expect(repoFiles.some((path) => path.startsWith("assets/"))).toBe(true);

    const survivors = filesContaining(collectTextFiles(REPO_ROOT), RETIRED_SLUG_FIELD);
    expect(survivors.filter((path) => !path.startsWith("docs/"))).toEqual([]);
  });
});
