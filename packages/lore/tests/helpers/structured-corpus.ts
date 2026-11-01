/**
 * A throwaway corpus for the structured-documents suites (spec-every-document-is-stored-as-structured-fields-validated-by).
 *
 * Purpose: `mkdtemp` + `lore init` (never the repository's own `.lore/`), a live in-process `App` over the same
 *   database for fixtures, spec/tech and knowledge/reference templates, and fields-file writers. The surfaces under test
 *   (CLI, HTTP, `CorpusService`) are driven by the suites; this file only builds the rig.
 * Public surface: {@link createStructuredRig}, {@link StructuredRig}, {@link specTechTemplate}, {@link validSpecFiles},
 *   {@link installTemplate}, {@link reviseTemplate}, {@link writeFieldsFile}.
 * Invariants:
 *   - Fixtures never fail silently: a refused fixture write throws with the error.
 *   - Nothing here reads or writes any path outside the rig's two temp directories.
 * Side-effect class: IO (temp directories, one corpus database, in-process CLI runs).
 */

import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import type { LoreConfig, LoreError, Result } from "@lore/core";
import type { App } from "../../src/app.js";
import { createLiveApp } from "./live-app.js";
import { runLoreInProcess } from "./run-lore-in-process.js";

/** One rig: a corpus directory, its home, and the helpers that drive it. */
export interface StructuredRig {
  readonly dir: string;
  readonly home: string;
  readonly dbPath: string;
  /** Run one CLI command in the corpus. */
  lore(args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }>;
  /** Run `body` against a live in-process app over the corpus (optionally with a config), then close it. */
  withApp<T>(body: (app: App) => Promise<T>, config?: LoreConfig): Promise<T>;
  /** Total document rows right now (what "writes nothing" is measured against). */
  countDocs(): Promise<number>;
  cleanup(): void;
}

/**
 * Unwrap a fixture `Result`.
 *
 * @param result - the service result
 * @param what - the fixture step, named in the failure
 * @returns the value
 */
export async function must<T>(result: Promise<Result<T, LoreError>>, what: string): Promise<T> {
  const done = await result;
  if (!done.ok) throw new Error(`${what}: ${JSON.stringify(done.error)}`);
  return done.value;
}

/**
 * Build a corpus with `lore init`.
 *
 * @returns the rig
 */
export async function createStructuredRig(prefix = "lore-structured"): Promise<StructuredRig> {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), `${prefix}-`)));
  const home = realpathSync(mkdtempSync(join(tmpdir(), `${prefix}-home-`)));
  const dbPath = join(dir, ".lore", "lore.db");
  const lore = (args: string[]) => runLoreInProcess(args, { cwd: dir, home });
  const init = await lore(["init"]);
  if (init.exitCode !== 0) throw new Error(`lore init failed: ${init.stderr}`);
  const withApp = async <T>(body: (app: App) => Promise<T>, config?: LoreConfig): Promise<T> => {
    const app = createLiveApp(dbPath, config);
    try {
      return await body(app);
    } finally {
      app.close();
    }
  };
  return {
    dir,
    home,
    dbPath,
    lore,
    withApp,
    countDocs: () => withApp(async (app) => (await must(app.corpusService.list({} as never), "list")).total),
    cleanup: () => {
      rmSync(dir, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    },
  };
}

/**
 * A spec/tech template: a required `summary`, optional `risks` and `refusals`, three dimensions (one needs refs), and a
 * revision `version` that can add a fourth required dimension.
 *
 * @param version - the template version number
 * @param extraDimension - add the `rollback` dimension (what @2 does)
 * @returns the `extra.template` body
 */
export function specTechTemplate(version: number, extraDimension = false): Record<string, unknown> {
  return {
    doc_type: "spec",
    kind: "tech",
    version,
    fields: {
      type: "object",
      required: ["summary"],
      properties: {
        summary: { type: "string", minLength: 1, description: "One-paragraph summary" },
        risks: { type: "array", items: { type: "string" } },
        refusals: { type: "array", items: { type: "string" }, "x-refusal-list": true },
      },
    },
    dimensions: [
      { id: "edge-cases", question: "Which edge cases does it handle?" },
      { id: "failure-modes", question: "How does it fail?" },
      { id: "evidence", question: "What proves it?", needs_refs: true },
      ...(extraDimension ? [{ id: "rollback", question: "How is it undone?" }] : []),
    ],
    checks: [],
    render: [
      { heading: "Summary", fields: ["summary"] },
      { heading: "Risks", fields: ["risks"] },
    ],
  };
}

/** Valid `fields` and `dimensions` for {@link specTechTemplate}; `refs` name an AC that is declared later. */
export function validSpecFiles(summary = "A tech spec about caching layers"): { fields: Record<string, unknown>; dimensions: Record<string, unknown>[] } {
  return {
    fields: { summary, risks: ["stale reads"] },
    dimensions: [
      { id: "edge-cases", status: "handled", answer: "empty cache and full cache are both covered", refs: [] },
      { id: "failure-modes", status: "na", answer: "no failure mode: pure read path", refs: [] },
      { id: "evidence", status: "handled", answer: "the criterion proves it", refs: ["AC-NOTYET-1"] },
    ],
  };
}

/**
 * Write a fields file into the rig's directory.
 *
 * @param rig - the rig
 * @param name - file name (`.yaml` or `.json`)
 * @param content - the file object
 * @returns the absolute path
 */
export function writeFieldsFile(rig: StructuredRig, name: string, content: unknown): string {
  const path = join(rig.dir, name);
  writeFileSync(path, name.endsWith(".json") ? JSON.stringify(content, null, 2) : stringify(content));
  return path;
}

/**
 * Create a template document and approve it.
 *
 * @param rig - the rig
 * @param title - the template document's title (its slug derives from it)
 * @param body - the `extra.template` body
 * @returns the template document's id and slug
 */
export async function installTemplate(rig: StructuredRig, title: string, body: Record<string, unknown>): Promise<{ id: string; slug: string }> {
  return await rig.withApp(async (app) => {
    const created = await must(app.corpusService.create({ type: "template", title, extra: { template: body } } as never), `create template ${title}`);
    const current = await must(app.corpusService.get(created.id), "get template");
    await must(app.corpusService.set(created.id, { status: "approved", version: current.doc.version } as never), `approve template ${title}`);
    return { id: created.id, slug: created.slug };
  });
}

/**
 * Revise an approved template to a new version and approve it (the prior version stays resolvable as `slug@N`).
 *
 * @param rig - the rig
 * @param id - the template document id
 * @param body - the new `extra.template` body
 */
export async function reviseTemplate(rig: StructuredRig, id: string, body: Record<string, unknown>): Promise<void> {
  await rig.withApp(async (app) => {
    const current = await must(app.corpusService.get(id), "get template");
    await must(app.corpusService.set(id, { extra: { template: body }, version: current.doc.version } as never), "revise template");
    const revised = await must(app.corpusService.get(id), "get revised template");
    await must(app.corpusService.set(id, { status: "approved", version: revised.doc.version } as never), "approve revised template");
  });
}
