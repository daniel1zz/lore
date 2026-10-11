/**
 * The `DriftRow` identity is doc-flavoured end to end — `doc_id`/`doc_status`
 * (alongside the already-renamed `doc_slug`/`doc_type`) — and the RETIRED
 * spec-flavoured id/status field spellings this interface used to carry never
 * coexist with their successors in the code universe (M2 of
 * `spec-a-write-side-fact-with-no-read-side-address-counts-with-no`, AC-RR-10).
 *
 * ⛔ This docstring, every test title, and every in-file comment deliberately
 * NEVER spells out the retired field names or the residual sentence verbatim —
 * this file sits INSIDE the census's own scan universe (below), so a literal
 * occurrence here would make the census match itself (AC-RR-8 precedent,
 * `drift-population-reporting.test.ts`). Read "the retired id/status spelling"
 * throughout as: the two spec-flavoured field names this module's own git history
 * shows `DriftRow` used to declare, now `doc_id`/`doc_status`.
 *
 * Three halves, per the AC, ALL in this one file:
 *   (a) BEHAVIOUR — `DriftCheckService.checkDrift`, run over a fixture where a
 *       KNOWLEDGE doc breaches AND a SPEC breaches in the SAME call, emits a row
 *       per doc whose `doc_id`/`doc_status` equal THAT doc's OWN id/status — never
 *       the other doc's — so a rename that hard-codes one doc type (e.g. "always
 *       copy the spec's id/status") goes RED.
 *   (b) PRODUCTION RENDER — the two renderers `lore status --check-drift` actually
 *       ships, `renderDriftRepairHint` and `renderDriftSectionLines` (BOTH
 *       `flows/drift-flow.ts` — the latter is `commands/status.ts`'s
 *       `renderDriftSection`'s ONLY line-building logic, extracted there because
 *       `status.ts` transitively imports `loader.ts` → `app.ts` → `bun:sqlite` and
 *       is unresolvable under vitest; see that function's own doc comment), are
 *       called with the REAL knowledge row `checkDrift` produced in (a) — never a
 *       hand-rolled literal — and their output is asserted. A rename that stops at
 *       the type definition leaves this half red (the old field names would no
 *       longer type-check as present, and the rendered text would still say
 *       "[spec]" for a knowledge row under a hard-coded implementation).
 *   (c) CENSUS — zero WORD-BOUNDARY occurrences of the three retired identity
 *       field spellings, and zero occurrences of the residual note that recorded
 *       the gap, across `packages/core/src`, `packages/lore/src`, and both test
 *       trees (`packages/core/tests`, `packages/lore/tests`). Scoped to `.ts`/
 *       `.tsx` files — the AC's concern is a TypeScript field spelling coexisting
 *       in code that KEYS on it, not an English-prose mention of the retired name
 *       (a markdown module doc citing the old spelling to explain history is not
 *       "the spelling coexisting" in the operative sense; the FIRST assertion
 *       below still requires the successor spelling to be PRESENT, so a walker
 *       that visits nothing can't vacuously pass).
 *
 * Six-dimension coverage:
 *   HAPPY:      a knowledge breach and a spec breach in the same run each carry
 *               their own doc_id/doc_status/doc_slug/doc_type (a)
 *   NEGATIVE:   n/a — no CLI-usage mutex on this behaviour (mirrors AC-RR-8's note)
 *   BOUNDARY:   the census's needle construction never appears verbatim in THIS
 *               file (AC-RR-8 precedent) — the positive-trace assertion proves the
 *               walk actually visited files rather than vacuously matching zero
 *   ERROR:      n/a — computeDrift's error-path classifications are AC-RR-1..9's
 *               territory; this AC is about field SPELLING, not classification
 *   STATE:      n/a
 *   REGRESSION: the census (c), including an empirical word-boundary check that
 *               `\bspec_id\b` does NOT false-hit the unrelated identifier
 *               `shared_fake_parent_spec_id` (phase-migration.bun.test.ts)
 *
 * @spec_ref spec-a-write-side-fact-with-no-read-side-address-counts-with-no §M2, AC-RR-10
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { readFileSync, readdirSync } from "fs";
import { join, relative, sep } from "path";
import { describe, expect, it } from "vitest";
import type { CreateDocInput } from "@lore/core";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { DriftCheckService, type FsProbe } from "../../../src/service/drift-check-service.js";
import { renderDriftRepairHint, renderDriftSectionLines, runDrift } from "../../../src/flows/drift-flow.js";

// ─── Fixture helpers (mirrors drift-population-reporting.test.ts's AC-RR-8 shape) ──

function makeServices() {
  const store = new InMemoryStore();
  return { corpusService: new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined))), driftCheckService: new DriftCheckService(store) };
}

async function createDoc(corpusService: CorpusService, input: CreateDocInput): Promise<string> {
  const result = await corpusService.create(input);
  if (!result.ok) throw new Error(`create ${input.type} failed: ${JSON.stringify(result.error)}`);
  return result.value.id;
}

async function createPrd(corpusService: CorpusService): Promise<string> {
  return createDoc(corpusService, { type: "prd", title: "Doc Identity PRD", content: "root" } as CreateDocInput);
}

async function createSpec(
  corpusService: CorpusService,
  parentId: string,
  title: string,
  codeAnchors: string[],
): Promise<string> {
  return createDoc(corpusService, {
    type: "spec",
    title,
    content: "spec body",
    extra: { code_anchors: codeAnchors },
  } as CreateDocInput);
}

async function createKnowledge(
  corpusService: CorpusService,
  parentId: string,
  title: string,
  codeAnchors: string[],
): Promise<string> {
  return createDoc(corpusService, {
    type: "knowledge",
    title,
    parent_id: parentId,
    content: "fact body",
    extra: { sub_type: "reference", code_anchors: codeAnchors },
  } as CreateDocInput);
}

/** Every declared path is missing — both fixtures breach with kind file_missing. */
const ALL_MISSING: FsProbe = {
  stat: () => "missing",
  readFile: () => null,
  listDir: () => null,
};

// ─── (a) BEHAVIOUR — service-layer doc identity, never cross-attributed ──────

describe("HAPPY — DriftCheckService.checkDrift: doc_id/doc_status are per-doc, never cross-attributed", () => {
  it("a knowledge breach and a spec breach in the SAME run each carry their OWN id/status/slug/type", async () => {
    const { corpusService, driftCheckService } = makeServices();
    const prdId = await createPrd(corpusService);
    const specId = await createSpec(corpusService, prdId, "ZzzDocIdentitySpec", ["never/exists-spec.ts"]);
    const knowledgeId = await createKnowledge(corpusService, prdId, "ZzzDocIdentityKnowledge", [
      "never/exists-knowledge.ts",
    ]);

    const specDoc = await corpusService.get(specId);
    const knowledgeDoc = await corpusService.get(knowledgeId);
    expect(specDoc.ok).toBe(true);
    expect(knowledgeDoc.ok).toBe(true);
    if (!specDoc.ok || !knowledgeDoc.ok) return;

    const result = await driftCheckService.checkDrift(ALL_MISSING);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.drifts).toHaveLength(2);

    const specRow = result.value.drifts.find((d) => d.doc_type === "spec");
    const knowledgeRow = result.value.drifts.find((d) => d.doc_type === "knowledge");
    expect(specRow).toBeDefined();
    expect(knowledgeRow).toBeDefined();
    if (specRow === undefined || knowledgeRow === undefined) return;

    // The positive assertions: each row equals its OWN doc.
    expect(knowledgeRow.doc_id).toBe(knowledgeDoc.value.doc.id);
    expect(knowledgeRow.doc_status).toBe(knowledgeDoc.value.doc.status);
    expect(knowledgeRow.doc_slug).toBe(knowledgeDoc.value.doc.slug);
    expect(specRow.doc_id).toBe(specDoc.value.doc.id);
    expect(specRow.doc_status).toBe(specDoc.value.doc.status);
    expect(specRow.doc_slug).toBe(specDoc.value.doc.slug);

    // The cross-negative: a rename that hard-codes one doc type (e.g. "every row
    // copies the spec's id/status") would make the KNOWLEDGE row equal the SPEC's
    // own values — assert it does NOT, in both directions.
    expect(knowledgeRow.doc_id).not.toBe(specDoc.value.doc.id);
    expect(specRow.doc_id).not.toBe(knowledgeDoc.value.doc.id);
  });
});

// ─── (b) PRODUCTION RENDER — the two shipped renderers, called with the REAL row ──

describe("PRODUCTION RENDER — the shipped drift renderers are called with the REAL knowledge row", () => {
  it("renderDriftRepairHint (flows/drift-flow.ts) is called with the real row and names the knowledge doc's own slug", async () => {
    const { corpusService, driftCheckService } = makeServices();
    const prdId = await createPrd(corpusService);
    const knowledgeId = await createKnowledge(corpusService, prdId, "ZzzRenderRepairKnowledge", [
      "never/exists-render-repair.ts",
    ]);
    const knowledgeDoc = await corpusService.get(knowledgeId);
    expect(knowledgeDoc.ok).toBe(true);
    if (!knowledgeDoc.ok) return;

    const result = await driftCheckService.checkDrift(ALL_MISSING);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const row = result.value.drifts.find((d) => d.doc_slug === knowledgeDoc.value.doc.slug);
    expect(row).toBeDefined();
    if (row === undefined) return;

    // Reading doc_id/doc_status off the REAL row proves the renderer's input is a
    // fully doc-flavoured DriftRow — a rename stopping at the type definition would
    // fail to compile a caller still reading the old field names.
    expect(row.doc_id).toBe(knowledgeDoc.value.doc.id);
    expect(row.doc_status).toBe(knowledgeDoc.value.doc.status);
    expect(row.doc_type).toBe("knowledge");

    const hint = renderDriftRepairHint(row);
    expect(hint).toBe(
      `fix: lore anchor rm ${knowledgeDoc.value.doc.slug} 'never/exists-render-repair.ts' (or update the path/export)`,
    );
  });

  it("renderDriftSectionLines (commands/status.ts's ONLY line-building logic) labels the knowledge row [knowledge], never [spec]", async () => {
    const { corpusService, driftCheckService } = makeServices();
    const prdId = await createPrd(corpusService);
    await createSpec(corpusService, prdId, "ZzzRenderSectionSpec", ["never/exists-section-spec.ts"]);
    const knowledgeId = await createKnowledge(corpusService, prdId, "ZzzRenderSectionKnowledge", [
      "never/exists-section-knowledge.ts",
    ]);
    const knowledgeDoc = await corpusService.get(knowledgeId);
    expect(knowledgeDoc.ok).toBe(true);
    if (!knowledgeDoc.ok) return;

    const payload = await runDrift(
      { checkDrift: (probe) => driftCheckService.checkDrift(probe), listSpecs: async () => ({ ok: true, value: [] }) },
      ALL_MISSING,
    );
    expect(payload.ok).toBe(true);
    if (!payload.ok) return;

    // This is the EXACT function commands/status.ts::renderDriftSection calls to
    // build every printed line — never re-derived here.
    const lines = renderDriftSectionLines(payload.value);

    const knowledgeLine = lines.find((line) => line.includes(knowledgeDoc.value.doc.slug));
    expect(knowledgeLine).toBeDefined();
    expect(knowledgeLine).toContain("[knowledge]");
    expect(knowledgeLine).not.toContain("[spec]");
    // The spec row is ALSO present in the SAME run, still correctly labelled — a
    // per-row discriminator, not a single global label applied to the whole section.
    expect(lines.some((line) => line.includes("[spec]"))).toBe(true);
  });
});

// ─── (c) CENSUS — the retired spellings never coexist with their successors ──

/**
 * The retired `DriftRow` field spellings, assembled at runtime.
 *
 * reason: this file is INSIDE the scan universe below, so writing any of these as
 * a literal here would make the census match itself and it could never report
 * zero (AC-RR-8 precedent, `drift-population-reporting.test.ts`). ⛔ Never inline.
 */
const RETIRED_SPELLINGS = [
  ["spec", "id"].join("_"),
  ["spec", "status"].join("_"),
  ["spec", "slug"].join("_"),
];

/** The successor spelling — asserted PRESENT, so a zero-hit census can't be a broken walker. */
const CURRENT_ID_FIELD = ["doc", "id"].join("_");

/** The residual note that recorded the gap — assembled the same way, same reason. */
const RESIDUAL_NOTE = ["keep their historical", "SPEC-045", "names"].join(" ");

/**
 * An UNRELATED identifier that legitimately contains the retired id spelling as a
 * SUBSTRING (never as its own token) — the false-hit trap named by the AC, modeled
 * on `packages/lore/tests/unit/service/phase-migration.bun.test.ts`'s
 * `shared_fake_parent_...` fixture identifier.
 */
const UNRELATED_IDENTIFIER_CONTAINING_RETIRED_ID = ["shared_fake_parent", RETIRED_SPELLINGS[0]].join("_");

const REPO_ROOT = new URL("../../../../../", import.meta.url).pathname.replace(/\/$/, "");

const SCANNED_DIRS = [
  join(REPO_ROOT, "packages", "core", "src"),
  join(REPO_ROOT, "packages", "lore", "src"),
  join(REPO_ROOT, "packages", "core", "tests"),
  join(REPO_ROOT, "packages", "lore", "tests"),
];

const SKIP_DIRS = new Set(["node_modules", "dist", "worktrees", ".git", ".turbo", "coverage"]);

/** TypeScript source only — the AC's concern is a field spelling coexisting in code that KEYS on it. */
const SCANNED_EXTENSIONS = [".ts", ".tsx"];

/** Recursively collects every scannable TS file under `dir`. Pure read, no writes. */
function collectTsFiles(dir: string, into: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      collectTsFiles(join(dir, entry.name), into);
      continue;
    }
    if (!entry.isFile()) continue;
    if (SCANNED_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) into.push(join(dir, entry.name));
  }
  return into;
}

/** Word-boundary search — `\bneedle\b`, never a contiguous-substring match (D2 anti-pattern). */
function wordBoundaryMatches(text: string, needle: string): boolean {
  return new RegExp(`\\b${needle}\\b`).test(text);
}

function filesMatching(files: readonly string[], needle: string, wordBoundary: boolean): string[] {
  return files
    .filter((file) => {
      const text = readFileSync(file, "utf8");
      return wordBoundary ? wordBoundaryMatches(text, needle) : text.includes(needle);
    })
    .map((file) => relative(REPO_ROOT, file).split(sep).join("/"));
}

describe("REGRESSION — word-boundary anchoring does NOT false-hit an unrelated identifier", () => {
  it(`a \\b<retired-id>\\b probe does not match an identifier merely ending in it, but DOES match a bare occurrence of it`, () => {
    expect(wordBoundaryMatches(UNRELATED_IDENTIFIER_CONTAINING_RETIRED_ID, RETIRED_SPELLINGS[0] as string)).toBe(
      false,
    );
    expect(wordBoundaryMatches(`const x = { ${RETIRED_SPELLINGS[0]}: 1 };`, RETIRED_SPELLINGS[0] as string)).toBe(
      true,
    );
  });
});

describe("CENSUS — the retired DriftRow identity spellings do not coexist with their doc-flavoured successors", () => {
  it(`zero WORD-BOUNDARY occurrences of ${RETIRED_SPELLINGS.join(" / ")} across the scanned trees, and the successor IS present`, () => {
    const files = SCANNED_DIRS.flatMap((dir) => collectTsFiles(dir));

    // Positive trace of execution first: an empty file list would make every
    // zero-hit assertion below vacuously true.
    expect(files.length).toBeGreaterThan(100);
    expect(filesMatching(files, CURRENT_ID_FIELD, true)).toContain("packages/core/src/code-anchors.ts");

    for (const retired of RETIRED_SPELLINGS) {
      expect(filesMatching(files, retired, true)).toEqual([]);
    }
  });

  it(`zero occurrences of the residual note that recorded the gap ('${RESIDUAL_NOTE}')`, () => {
    const files = SCANNED_DIRS.flatMap((dir) => collectTsFiles(dir));
    expect(files.length).toBeGreaterThan(100);
    expect(filesMatching(files, RESIDUAL_NOTE, false)).toEqual([]);
  });
});
