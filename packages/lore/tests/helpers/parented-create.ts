/**
 * Test fixture helper: a parent for fixtures that create a knowledge record, a decision record (adr) or a plan
 * and have no natural parent of their own.
 *
 * Purpose: spec-documents-that-need-a-parent-are-refused-without-one-an-ad D6 — creating those three types without a
 *   parent is refused, so every fixture that is not ABOUT a particular parent passes the requirements document this
 *   helper ensures. A tests-only default (spec D1): the product never picks a parent for the caller.
 * Public surface: {@link ensureRequirementsDocId}, {@link insertRequirementsDocWithoutHistory}, {@link ensureRequirementsDocSlug}, {@link ensureRequirementsDocSlugAsync},
 *   {@link asCliRun}, {@link CorpusParentSource}, {@link CliRunner}.
 * Invariants: at most one fixture requirements document ({@link FIXTURE_REQUIREMENTS_TITLE}) exists per corpus; a
 *   corpus that already holds any requirements document (prd) reuses the first one rather than adding another; every
 *   failing service call throws (a fixture fault, never a silent fallback).
 * Side-effect class: IO (may write one requirements document into the corpus behind `service`, always a throwaway one).
 *   It spawns nothing: the entry-point twin lives in parented-create-via-entry.ts so importing this file never reaches a spawn.
 */

import { DOC_TYPE_ROLE_MAP } from "@lore/core";
import type { CreateDocInput, DocId, DocRecord } from "@lore/core";
import { ulid } from "ulidx";

/** Title of the requirements document the helper creates when the corpus holds none. */
export const FIXTURE_REQUIREMENTS_TITLE = "Fixture Requirements";

/**
 * The slice of `CorpusService` the helper needs (so `app.corpusService` and a bare `CorpusService` both fit).
 * `list` and `create` are the real methods; only the fields read here are named.
 */
export interface CorpusParentSource {
  list(filter: { type: "prd" }): Promise<
    | { ok: true; value: { docs: ReadonlyArray<{ id: string }> } }
    | { ok: false; error: unknown }
  >;
  create(input: CreateDocInput): Promise<{ ok: true; value: { id: string } } | { ok: false; error: unknown }>;
}

/** What one spawned `lore` produced: the slice of a runner's result the CLI variant reads. */
export interface CliRunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
}

/** Runs `lore <args>` in the test's corpus directory and returns what it printed (synchronously). */
export type CliRunner = (args: string[]) => CliRunResult;

/** Async twin of {@link CliRunner}, for suites whose `lore` driver returns a promise. */
export type AsyncCliRunner = (args: string[]) => Promise<CliRunResult>;

/** Adapt a driver result that names its exit code `code` (not `exitCode`) to {@link CliRunResult}. */
export function asCliRun(result: { readonly stdout: string; readonly stderr: string; readonly code: number }): CliRunResult {
  return { stdout: result.stdout, stderr: result.stderr, exitCode: result.code };
}

const LIST_PRD_ARGS = ["list", "--type", "prd", "--json"];
const CREATE_PRD_ARGS = [
  "create", "prd", "--title", FIXTURE_REQUIREMENTS_TITLE, "--no-ai", "--json",
  "--content", "Fixture requirements document: the parent for fixtures with no natural parent.",
];

function slugFromList(listed: CliRunResult): string | undefined {
  if (listed.exitCode !== 0) throw new Error(`list prd failed (exit ${String(listed.exitCode)}): ${listed.stderr}`);
  const parsed = JSON.parse(listed.stdout) as { data?: { docs?: Array<{ slug: string }> } };
  return parsed.data?.docs?.[0]?.slug;
}

function slugFromCreate(made: CliRunResult): string {
  if (made.exitCode !== 0) throw new Error(`create fixture prd failed (exit ${String(made.exitCode)}): ${made.stderr}`);
  const slug = (JSON.parse(made.stdout) as { data?: { slug?: string } }).data?.slug;
  if (slug === undefined) throw new Error(`create fixture prd printed no slug: ${made.stdout}`);
  return slug;
}

/**
 * CLI twin of {@link ensureRequirementsDocId}: the slug of a requirements document in the corpus the runner drives,
 * created through `lore create prd` on first use. Pass it as `--parent` of a knowledge, adr or plan create.
 *
 * @param run - Runs `lore <args>` against the throwaway corpus (the test's own `runLore` bound to its directory).
 * @returns The requirements document's slug.
 * @throws Error when the list or create command fails or prints no slug (a fixture fault).
 * @example
 *   const parent = ensureRequirementsDocSlug((args) => runLore(args, tmpDir));
 *   runLore(["create", "plan", "--title", "P", "--parent", parent, "--no-ai"], tmpDir);
 */
export function ensureRequirementsDocSlug(run: CliRunner): string {
  return slugFromList(run(LIST_PRD_ARGS)) ?? slugFromCreate(run(CREATE_PRD_ARGS));
}

/** {@link ensureRequirementsDocSlug} for an async `lore` driver. */
export async function ensureRequirementsDocSlugAsync(run: AsyncCliRunner): Promise<string> {
  return slugFromList(await run(LIST_PRD_ARGS)) ?? slugFromCreate(await run(CREATE_PRD_ARGS));
}

/**
 * Return the id of a requirements document in the corpus behind `service`, creating a fixture one on first use.
 *
 * @param service - The corpus service (or `app.corpusService`) of a throwaway test corpus.
 * @returns The document id, usable as `parent_id` of a knowledge, adr or plan create.
 * @throws Error when the corpus cannot be listed or the fixture document cannot be created (a fixture fault).
 * @example
 *   const parent_id = await ensureRequirementsDocId(app.corpusService);
 *   await app.corpusService.create({ type: "knowledge", title: "K", content: "c", parent_id });
 */
export async function ensureRequirementsDocId(service: CorpusParentSource): Promise<string> {
  const existing = await service.list({ type: "prd" });
  if (!existing.ok) throw new Error(`list prd failed: ${JSON.stringify(existing.error)}`);
  const first = existing.value.docs[0];
  if (first !== undefined) return first.id;
  const made = await service.create({
    type: "prd",
    title: FIXTURE_REQUIREMENTS_TITLE,
    content: "Fixture requirements document: the parent for fixtures with no natural parent.",
  } as CreateDocInput);
  if (!made.ok) throw new Error(`create fixture prd failed: ${JSON.stringify(made.error)}`);
  return made.value.id;
}

/** The slice of a store the history-free insert needs. */
export interface DocInsertStore {
  insert(doc: DocRecord): Promise<{ ok: true; value: DocRecord } | { ok: false; error: unknown }>;
}

/**
 * Insert a requirements document straight into the store, bypassing the service: no version row, no audit row and no
 * identity are written. For suites whose assertions count or attribute every create/audit row, where a service create of
 * the parent would change what they measure. Everything else uses {@link ensureRequirementsDocId}.
 *
 * @param store - A store of a throwaway test corpus (a `SQLiteStore` or `InMemoryStore`).
 * @returns The inserted document's id, usable as `parent_id`.
 * @throws Error when the insert fails (a fixture fault).
 */
export async function insertRequirementsDocWithoutHistory(store: DocInsertStore): Promise<DocId> {
  const id = ulid() as DocId;
  const now = new Date().toISOString();
  const inserted = await store.insert({
    id,
    slug: `prd-fixture-requirements-${id.slice(-6).toLowerCase()}`,
    type: "prd",
    role: DOC_TYPE_ROLE_MAP["prd"],
    title: FIXTURE_REQUIREMENTS_TITLE,
    status: "draft",
    priority: "medium",
    content: "",
    parent_id: null,
    created_at: now,
    updated_at: now,
    created_by: "test",
    version: 1,
    deleted_at: null,
    tags: [],
    extra: {},
  });
  if (!inserted.ok) throw new Error(`insert fixture prd failed: ${JSON.stringify(inserted.error)}`);
  return id;
}
