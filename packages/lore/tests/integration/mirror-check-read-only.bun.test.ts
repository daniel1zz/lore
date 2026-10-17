// @spawns packages/lore/src/index.ts
/**
 * AC-MIS-5 (`spec-mirror-identifier-ssot-one-writer-for-export-index-human`, D5) —
 * `runCheck` (`scripts/export-spec-mirror.ts:167-200`) claims in its OWN JSDoc that it
 * "NEVER calls `exportDocs` and never writes a byte" and that "running this twice in a
 * row against the same on-disk state MUST report the identical verdict both times". This
 * file turns that prose claim into an assertion: a check that repairs what it checks can
 * never fail, so every test below hashes the export index and every mirror file BEFORE
 * calling `runCheck` and asserts byte-for-byte equality AFTER — never merely "the reported
 * verdict looks right".
 *
 * ## Why a throwaway corpus, never the live tree
 *
 * `runCheck(app, repoRoot)`'s signature already takes `repoRoot` explicitly (this file
 * needed no source edit) — every test below builds a fresh `mkdtempSync` corpus (`lore
 * init` + direct `corpusService.create` seeding, the SAME two-step pattern
 * `packages/dashboard/tests/e2e/global-setup.ts` uses for its own throwaway corpus), passes
 * that directory as `repoRoot`, and never touches this repo's own `.lore/` or
 * `docs/requirements/**` — the project CLAUDE.md hard rule this whole test file exists to
 * honor while ALSO exercising the exact function that is supposed to guarantee it never
 * writes. This file must never spawn `bun run check:spec-mirror` against the live tree —
 * that command's own end-to-end coverage lives in `scripts/tests/spec-mirror-export.test.ts`
 * (explicitly out of scope for this task).
 *
 * ## The two independent drift vectors (`driftCorpus`)
 *
 * `computeMirrorParity` (the pure function `runCheck` delegates to, per-{@link
 * MirrorDocType}) only ever inspects TWO things per mapping: whether one exists, and
 * whether `fileExists(mapping.file_path)` — it never reads `human_id`'s own format (see
 * its own doc comment: "NOT CHECKED: file CONTENT"). So a corrupted `human_id` alone is
 * INVISIBLE to `computeMirrorParity`'s verdict, while a renamed mirror file IS visible
 * (its mapping's `file_path` no longer resolves → `file_absent`). `driftCorpus` induces
 * BOTH, on two different docs, so this file's core NEGATIVE test can assert two
 * independent things at once: (a) the verdict goes `ok:false`, driven by the vector the
 * check's own logic actually inspects (the rename), and (b) the vector the check's logic
 * is BLIND to (the human_id corruption) survives byte-for-byte anyway — proving `runCheck`
 * never opportunistically "normalizes" a field it happens to be reading past, not merely
 * that it does nothing about the drift it explicitly reports.
 *
 * ## Red-first verification (recorded separately at the moment it went red)
 *
 * Before this file was finalized, the NEGATIVE test's step-5 call was temporarily pointed
 * at `runExport` (the writing sibling) instead of `runCheck` and confirmed to fail the
 * byte-identity assertion — proving the assertion can actually discriminate a writer from
 * a reader. That probe was reverted immediately; its permanent, always-run replacement is
 * this file's own REGRESSION test below (`runExport` really does rewrite the drifted
 * corpus), which keeps that discriminating power under regression rather than relying on
 * a one-time manual check.
 *
 * Six-dimension coverage:
 *   HAPPY:      a clean (undrifted) throwaway corpus reports `ok:true` for every type and
 *               `runCheck` still writes nothing.
 *   NEGATIVE:   the core AC-MIS-5 assertion — see "two independent drift vectors" above.
 *   BOUNDARY:   an ORPHAN mirror file (no export-index mapping at all) fails parity via
 *               the count-only half of `ok` (`missing` stays empty) — pruning an orphan is
 *               `runExport`-only behaviour (`pruneOrphanMirrorFiles`), so `runCheck` must
 *               leave it on disk, byte-for-byte, same as every other file.
 *   ERROR:      a genuinely corrupt (invalid JSON) `.lore/export-index.json` makes
 *               `runCheck` THROW `SpecMirrorError("index_invalid_json")` rather than
 *               silently swallowing or "fixing" it — and the corrupt file itself is
 *               untouched even on the throwing path.
 *   STATE:      calling `runCheck` twice in a row over the SAME unchanged drifted state
 *               reports the IDENTICAL verdict both times (the JSDoc's own explicit claim).
 *   REGRESSION: the reverse control — `runExport` (never `runCheck`) on the SAME drifted
 *               corpus DOES rewrite the export index/mirror files, proving the byte-hash
 *               comparator used throughout this file is not vacuously "always equal".
 *
 * @spec_ref spec-mirror-identifier-ssot-one-writer-for-export-index-human D5, AC-MIS-5
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { CreateDocInput } from "@lore/core";
import { createApp, type App } from "../../src/app.js";

// ─── Loading scripts/export-spec-mirror.ts WITHOUT a static cross-package import ──
//
// `packages/lore/tsconfig.tests.json` pins `rootDir: "."` (= `packages/lore`) — a
// STATIC `import ... from "../../../../scripts/export-spec-mirror.js"` pulls that file
// (and its own `export-spec-mirror-core.ts` import) into the SAME tsc program and trips
// TS6059 ("File is not under 'rootDir'"). `tsconfig.tests.json` is shared infrastructure
// outside this task's own file anchor, so it is not this task's to edit. The fix is the
// SAME one `adhoc-claim-and-feed.bun.test.ts` (this exact directory) already uses for its
// own in-process command imports: a dynamic `import(modulePath)` behind a `string`-typed
// FUNCTION PARAMETER, never a literal specifier — TypeScript cannot statically resolve a
// widened `string`, so the target file is never pulled into this program's rootDir check
// at all, while Bun's module cache still returns the SAME live module object a static
// import would (so `instanceof SpecMirrorError` below still holds real class identity).
//
// Local types below describe only the subset of that module's runtime surface this file
// actually calls — never a re-declaration of its full public API.

type MirrorDocType = "prd" | "spec" | "adr" | "knowledge" | "plan" | "task";

interface MirrorParityMissingLocal {
  readonly slug: string;
  readonly reason: "no_mapping" | "file_absent";
}

interface MirrorParityResultLocal {
  readonly corpusSpecCount: number;
  readonly fileCountOnDisk: number;
  readonly missing: readonly MirrorParityMissingLocal[];
  readonly ok: boolean;
}

interface MirrorParityAllTypesResultLocal {
  readonly perType: Readonly<Record<MirrorDocType, MirrorParityResultLocal>>;
  readonly ok: boolean;
}

interface MirrorExportResultLocal {
  readonly parity: MirrorParityAllTypesResultLocal;
}

interface SpecMirrorErrorClass {
  new (code: string, message: string, context?: Record<string, unknown>): Error & {
    readonly code: string;
    readonly context?: Record<string, unknown>;
  };
}

interface MirrorScriptModule {
  readonly runCheck: (app: App, repoRoot: string) => Promise<MirrorParityAllTypesResultLocal>;
  readonly runExport: (app: App, repoRoot: string) => Promise<MirrorExportResultLocal>;
  readonly SpecMirrorError: SpecMirrorErrorClass;
  readonly MIRROR_TYPES: readonly MirrorDocType[];
  readonly mirrorDirRelative: (type: MirrorDocType) => string;
}

async function loadMirrorScriptModule(modulePath: string): Promise<MirrorScriptModule> {
  const mod = await import(modulePath);
  return mod as MirrorScriptModule;
}

const MIRROR_SCRIPT_PATH = "../../../../scripts/export-spec-mirror.js";

/** Populated once by the top-level `beforeAll` below — every helper/test reads this, never re-imports. */
let mirrorMod: MirrorScriptModule;

// ─── CLI subprocess helper — `lore init` only, mirrors
// packages/lore/tests/integration/prd-budget-check.bun.test.ts's own `runLore`/`initCorpus` ──

const PROJECT_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PROJECT_ROOT, "src", "index.ts");

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

function runLoreCli(args: string[], cwd: string): RunResult {
  const proc = Bun.spawnSync(["bun", "run", INDEX_TS, ...args], {
    cwd,
    env: { ...process.env, HOME: cwd, CLAUDECODE: "1" },
  });
  return {
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    exitCode: proc.exitCode ?? 1,
  };
}

// ─── Fixture types ────────────────────────────────────────────────────────────

interface SeededDoc {
  readonly id: string;
  readonly slug: string;
  readonly type: MirrorDocType;
}

interface ThrowawayCorpus {
  readonly tmpRoot: string;
  readonly dbPath: string;
  readonly docs: readonly SeededDoc[];
}

/**
 * Builds a THROWAWAY corpus (`mkdtemp` + `lore init`, never this repo's own `.lore/`),
 * seeds docs across THREE mirrored types (prd/spec/plan — parity across a single type
 * would be trivial), and runs the real `runExport` once so the mirror + export-index
 * start CONVERGED — the baseline every test's own drift is measured against.
 */
async function setupCleanExportedCorpus(): Promise<ThrowawayCorpus> {
  const tmpRoot = mkdtempSync(join(tmpdir(), "lore-mirror-check-ro-"));
  const initResult = runLoreCli(["init", "--author", "mirror-check-ro-test"], tmpRoot);
  if (initResult.exitCode !== 0) {
    throw new Error(`test setup: lore init failed (exit ${initResult.exitCode}): ${initResult.stderr}`);
  }
  const dbPath = join(tmpRoot, ".lore", "lore.db");

  const docs: SeededDoc[] = [];
  const app = createApp(dbPath);
  try {
    const prdResult = await app.corpusService.create({
      type: "prd",
      title: "Mirror Check Read-Only Root PRD",
      content: "## Overview\n\nRoot PRD seeded for AC-MIS-5's throwaway corpus.\n",
    } as CreateDocInput);
    if (!prdResult.ok) throw new Error(`test setup: prd create failed: ${JSON.stringify(prdResult.error)}`);
    docs.push({ id: prdResult.value.id, slug: prdResult.value.slug, type: "prd" });

    for (const title of ["Mirror Check Spec Alpha", "Mirror Check Spec Beta"]) {
      const specResult = await app.corpusService.create({
        type: "spec",
        title,
        content: `## Overview\n\n${title} body.\n`,
      } as CreateDocInput);
      if (!specResult.ok) throw new Error(`test setup: spec create failed: ${JSON.stringify(specResult.error)}`);
      docs.push({ id: specResult.value.id, slug: specResult.value.slug, type: "spec" });
    }

    for (const title of ["Mirror Check Plan Alpha", "Mirror Check Plan Beta"]) {
      const planResult = await app.corpusService.create({
        type: "plan",
        title,
        content: `## Overview\n\n${title} body.\n`,
      } as CreateDocInput);
      if (!planResult.ok) throw new Error(`test setup: plan create failed: ${JSON.stringify(planResult.error)}`);
      docs.push({ id: planResult.value.id, slug: planResult.value.slug, type: "plan" });
    }

    const exportResult = await mirrorMod.runExport(app, tmpRoot);
    if (!exportResult.parity.ok) {
      throw new Error(`test setup: baseline runExport did not reach parity: ${JSON.stringify(exportResult.parity)}`);
    }
  } finally {
    app.close();
  }

  return { tmpRoot, dbPath, docs };
}

function cleanupCorpus(tmpRoot: string): void {
  try {
    rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    // best-effort — never fail a test over leftover tmp dir cleanup
  }
}

// ─── Hashing — byte-for-byte snapshot of the export index + every mirror file ──

function sha256(buf: Buffer | string): string {
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * Repo-relative path -> sha256 hash for `.lore/export-index.json` PLUS every `.md` file
 * directly under each {@link MIRROR_TYPES} directory (non-recursive, matches
 * `countMdFilesFlat`'s own flat assumption — verified true of this repo's real mirror
 * dirs, and equally true of a freshly-exported throwaway one). Comparing two snapshots
 * with `toEqual` catches EVERY shape of unwanted write: content changes, additions,
 * deletions, AND renames (a rename changes the key set, not just a value).
 */
function snapshotMirrorBytes(repoRoot: string): Record<string, string> {
  const snapshot: Record<string, string> = {};
  const indexPath = join(repoRoot, ".lore", "export-index.json");
  if (existsSync(indexPath)) {
    snapshot[".lore/export-index.json"] = sha256(readFileSync(indexPath));
  }
  for (const type of mirrorMod.MIRROR_TYPES) {
    const dirRel = mirrorMod.mirrorDirRelative(type);
    const dirAbs = join(repoRoot, dirRel);
    if (!existsSync(dirAbs)) continue;
    for (const entry of readdirSync(dirAbs, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      const relPath = `${dirRel}/${entry.name}`;
      snapshot[relPath] = sha256(readFileSync(join(repoRoot, relPath)));
    }
  }
  return snapshot;
}

// ─── Drift injection — two INDEPENDENT vectors (see module header) ────────────

interface DriftInfo {
  readonly corruptedDocId: string;
  readonly corruptedSlug: string;
  readonly corruptedType: MirrorDocType;
  readonly corruptedHumanId: string;
  readonly renamedDocId: string;
  readonly renamedSlug: string;
  readonly renamedType: MirrorDocType;
  readonly renamedFromRel: string;
  readonly renamedToRel: string;
}

/**
 * Vector 1: rewrites `corruptTarget`'s export-index mapping `human_id` from its padded
 * form (e.g. `"SPEC-021"`) to the unpadded form (`"SPEC-21"`) — a mutation
 * `computeMirrorParity` never inspects at all (see module header), so it is the half of
 * this file's drift that specifically stress-tests "never opportunistically repairs a
 * field it happens to be reading past".
 *
 * Vector 2: renames `renameTarget`'s mirror `.md` file ON DISK, so its recorded
 * `file_path` no longer resolves — the half `computeMirrorParity` DOES detect
 * (`file_absent`), driving the reportable `ok:false` verdict.
 */
function driftCorpus(tmpRoot: string, corruptTarget: SeededDoc, renameTarget: SeededDoc): DriftInfo {
  const indexPath = join(tmpRoot, ".lore", "export-index.json");
  const raw = JSON.parse(readFileSync(indexPath, "utf8")) as {
    version: 1;
    mappings: Record<string, { human_id: string; file_path: string }>;
  };

  const corruptMapping = raw.mappings[corruptTarget.id];
  if (corruptMapping === undefined) {
    throw new Error(`test setup: no export-index mapping for ${corruptTarget.slug} — cannot induce human_id drift`);
  }
  const unpaddedHumanId = corruptMapping.human_id.replace(/-0+(\d)/, "-$1");
  if (unpaddedHumanId === corruptMapping.human_id) {
    throw new Error(
      `test setup: "${corruptMapping.human_id}" has no zero-padding to strip — drift vector 1 would be a no-op`,
    );
  }
  raw.mappings[corruptTarget.id] = { ...corruptMapping, human_id: unpaddedHumanId };

  const renameMapping = raw.mappings[renameTarget.id];
  if (renameMapping === undefined) {
    throw new Error(`test setup: no export-index mapping for ${renameTarget.slug} — cannot induce file-rename drift`);
  }
  const fromRel = renameMapping.file_path;
  const toRel = fromRel.replace(/\.md$/, "-drift-renamed.md");
  if (toRel === fromRel) {
    throw new Error(`test setup: "${fromRel}" did not end in .md — drift vector 2 would be a no-op`);
  }

  // Write the mutated index ONLY after both mappings were read successfully — never a
  // partial write if either lookup above had thrown.
  writeFileSync(indexPath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
  renameSync(join(tmpRoot, fromRel), join(tmpRoot, toRel));

  return {
    corruptedDocId: corruptTarget.id,
    corruptedSlug: corruptTarget.slug,
    corruptedType: corruptTarget.type,
    corruptedHumanId: unpaddedHumanId,
    renamedDocId: renameTarget.id,
    renamedSlug: renameTarget.slug,
    renamedType: renameTarget.type,
    renamedFromRel: fromRel,
    renamedToRel: toRel,
  };
}

function findByType(docs: readonly SeededDoc[], type: MirrorDocType): SeededDoc {
  const found = docs.find((d) => d.type === type);
  if (found === undefined) throw new Error(`test setup: fixture has no seeded doc of type "${type}"`);
  return found;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("mirror-check-read-only (AC-MIS-5): runCheck reports drift on a throwaway corpus and never writes a byte", () => {
  let corpus: ThrowawayCorpus;

  beforeAll(async () => {
    mirrorMod = await loadMirrorScriptModule(MIRROR_SCRIPT_PATH);
  });

  beforeEach(async () => {
    corpus = await setupCleanExportedCorpus();
  });

  afterEach(() => {
    cleanupCorpus(corpus.tmpRoot);
  });

  it("HAPPY: a freshly exported, undrifted throwaway corpus reports ok:true for every mirrored type, and runCheck still writes nothing", async () => {
    const before = snapshotMirrorBytes(corpus.tmpRoot);
    expect(Object.keys(before).length).toBeGreaterThan(0); // sanity floor: never a vacuous empty-corpus pass

    const app = createApp(corpus.dbPath);
    let parity: MirrorParityAllTypesResultLocal;
    try {
      parity = await mirrorMod.runCheck(app, corpus.tmpRoot);
    } finally {
      app.close();
    }

    expect(parity.ok).toBe(true);
    for (const type of mirrorMod.MIRROR_TYPES) {
      expect(parity.perType[type].missing).toEqual([]);
    }

    const after = snapshotMirrorBytes(corpus.tmpRoot);
    expect(after).toEqual(before);
  });

  it(
    "NEGATIVE (the core AC-MIS-5 assertion): a corpus deliberately drifted on TWO independent vectors " +
      "(an unpadded human_id on one mapping, plus a renamed mirror file on another) makes runCheck report " +
      "a nonzero/ok:false verdict naming the drifted type, and leaves the export index and every mirror " +
      "file byte-identical — including the human_id corruption computeMirrorParity never even inspects",
    async () => {
      const specTarget = findByType(corpus.docs, "spec");
      const planTarget = findByType(corpus.docs, "plan");
      const drift = driftCorpus(corpus.tmpRoot, specTarget, planTarget);

      const before = snapshotMirrorBytes(corpus.tmpRoot);

      const app = createApp(corpus.dbPath);
      let parity: MirrorParityAllTypesResultLocal;
      try {
        parity = await mirrorMod.runCheck(app, corpus.tmpRoot);
      } finally {
        app.close();
      }

      // (a) reports the drift — naming the drifted type, never a silent pass.
      expect(parity.ok).toBe(false);
      expect(parity.perType[drift.renamedType].ok).toBe(false);
      expect(parity.perType[drift.renamedType].missing).toContainEqual({
        slug: drift.renamedSlug,
        reason: "file_absent",
      });
      // The OTHER type (the human_id-only corruption) reports healthy parity — proving
      // computeMirrorParity truly never inspects human_id, so vector 1's survival below
      // is a genuine "runCheck never touches a field even when it can't see it's wrong",
      // not an artifact of vector 1 also tripping the reported verdict.
      expect(parity.perType[drift.corruptedType].ok).toBe(true);

      // (b) never writes a byte — every hash from BEFORE this call is unchanged AFTER,
      // across the whole export index and every mirror file (not just the ones named above).
      const after = snapshotMirrorBytes(corpus.tmpRoot);
      expect(after).toEqual(before);

      // Independently re-derive the human_id field itself (not just its hash) to make the
      // "vector 1 survives" claim legible on its own, without requiring the reader to trust
      // the whole-file hash comparison above.
      const indexRaw = JSON.parse(
        readFileSync(join(corpus.tmpRoot, ".lore", "export-index.json"), "utf8"),
      ) as { mappings: Record<string, { human_id: string }> };
      expect(indexRaw.mappings[drift.corruptedDocId]?.human_id).toBe(drift.corruptedHumanId);
    },
  );

  it(
    "BOUNDARY: an orphan mirror file with NO export-index mapping at all inflates the on-disk count and " +
      "fails parity even though 'missing' stays empty for that type — and runCheck leaves the orphan " +
      "(and everything else) on disk untouched, since pruning is runExport-only behaviour",
    async () => {
      const orphanRelPath = `${mirrorMod.mirrorDirRelative("plan")}/PLAN-ORPHAN-drift-boundary.md`;
      const orphanAbsPath = join(corpus.tmpRoot, orphanRelPath);
      writeFileSync(orphanAbsPath, "---\nid: PLAN-999\ntitle: Orphan\n---\n\nOrphan body, no mapping.\n", "utf8");

      const before = snapshotMirrorBytes(corpus.tmpRoot);
      expect(before[orphanRelPath]).toBeDefined(); // sanity: the orphan is really there before we check

      const app = createApp(corpus.dbPath);
      let parity: MirrorParityAllTypesResultLocal;
      try {
        parity = await mirrorMod.runCheck(app, corpus.tmpRoot);
      } finally {
        app.close();
      }

      expect(parity.perType.plan.missing).toEqual([]);
      expect(parity.perType.plan.fileCountOnDisk).toBeGreaterThan(parity.perType.plan.corpusSpecCount);
      expect(parity.perType.plan.ok).toBe(false);
      expect(parity.ok).toBe(false);

      const after = snapshotMirrorBytes(corpus.tmpRoot);
      expect(after).toEqual(before);
    },
  );

  it(
    "ERROR: a genuinely corrupt (invalid JSON) export-index.json makes runCheck THROW " +
      "SpecMirrorError('index_invalid_json') rather than silently swallowing or repairing it, " +
      "and the corrupt file itself is untouched even on the throwing path",
    async () => {
      const indexPath = join(corpus.tmpRoot, ".lore", "export-index.json");
      writeFileSync(indexPath, "{ this is not valid JSON !!!", "utf8");
      const beforeHash = sha256(readFileSync(indexPath));

      const app = createApp(corpus.dbPath);
      let caught: unknown;
      try {
        await mirrorMod.runCheck(app, corpus.tmpRoot);
      } catch (e) {
        caught = e;
      } finally {
        app.close();
      }

      expect(caught).toBeInstanceOf(mirrorMod.SpecMirrorError);
      expect((caught as Error & { code: string }).code).toBe("index_invalid_json");

      const afterHash = sha256(readFileSync(indexPath));
      expect(afterHash).toBe(beforeHash);
    },
  );

  it(
    "STATE: calling runCheck twice in a row over the SAME unchanged drifted state reports the IDENTICAL " +
      "verdict both times — its own JSDoc's explicit no-self-healing-between-runs contract",
    async () => {
      const specTarget = findByType(corpus.docs, "spec");
      const planTarget = findByType(corpus.docs, "plan");
      driftCorpus(corpus.tmpRoot, specTarget, planTarget);

      const app = createApp(corpus.dbPath);
      let first: MirrorParityAllTypesResultLocal;
      let second: MirrorParityAllTypesResultLocal;
      try {
        first = await mirrorMod.runCheck(app, corpus.tmpRoot);
        second = await mirrorMod.runCheck(app, corpus.tmpRoot);
      } finally {
        app.close();
      }

      expect(first.ok).toBe(false); // sanity floor: never a vacuous pass comparing two trivial oks
      expect(second).toEqual(first);
    },
  );

  it(
    "REGRESSION (reverse control): runExport — deliberately the WRITING sibling, never runCheck — on the " +
      "SAME drifted corpus DOES rewrite the export index and mirror files, proving the byte-hash comparator " +
      "used throughout this file actually discriminates a writer from a reader rather than always passing",
    async () => {
      const specTarget = findByType(corpus.docs, "spec");
      const planTarget = findByType(corpus.docs, "plan");
      driftCorpus(corpus.tmpRoot, specTarget, planTarget);

      const before = snapshotMirrorBytes(corpus.tmpRoot);

      const app = createApp(corpus.dbPath);
      try {
        await mirrorMod.runExport(app, corpus.tmpRoot);
      } finally {
        app.close();
      }

      const after = snapshotMirrorBytes(corpus.tmpRoot);
      expect(after).not.toEqual(before);
    },
  );
});
