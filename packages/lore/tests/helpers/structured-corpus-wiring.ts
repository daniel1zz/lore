/**
 * Runtime-neutral wiring of the template write path for unit-test corpora (spec-every-document-is-stored-as-structured-fields-validated-by, BR-1528).
 *
 * Purpose: arm a bare in-memory `CorpusService` with the template write path and the shipped templates, so a generator that
 *   creates structured documents works against it, and hand out a seeded `TemplateService` for a subject that only reads templates.
 *   Kept apart from `structured-docs.ts` because that file reaches the composition root (`bun:sqlite`), which a Node-run test file
 *   must not import; this file imports only services, the in-memory store and the shipped-seed reader.
 * Public surface: {@link wireStructuredCorpus}, {@link seededTemplateReader}.
 * Invariants:
 *   - Seeds come from the repository's `assets/templates/`; a test using either function declares `// @reads assets/templates/**`.
 *   - A refused fixture write throws with the error; it never continues.
 * Side-effect class: IO (reads the shipped seeds; writes template documents into the corpus it is given).
 */

import { fileURLToPath } from "node:url";
import type { LoreError, Result } from "@lore/core";
import { readShippedTemplateSeeds } from "../../src/adapters/cli/template-seeds.js";
import { CorpusService } from "../../src/service/corpus-service.js";
import { GateEnforcer } from "../../src/service/gate-enforcer.js";
import { RecordLockService } from "../../src/service/record-lock-service.js";
import { TemplateSeedService } from "../../src/service/template-seed-service.js";
import { TemplateService } from "../../src/service/template-service.js";
import { InMemoryStore } from "../../src/store/in-memory-store.js";
import type { StoreInterface } from "../../src/store/store-interface.js";
import { actedStore } from "../live-invocation.js";

async function must<T>(result: Promise<Result<T, LoreError>>, what: string): Promise<T> {
  const done = await result;
  if (!done.ok) throw new Error(`${what}: ${JSON.stringify(done.error)}`);
  return done.value;
}

/**
 * Arm a bare `CorpusService` (the unit-test construction over an in-memory store) with the template write path and seed
 * the shipped templates into it.
 *
 * @param corpus - the service under test
 * @param store - the store it was built over (the template reader reads the same store)
 * @param options - `requireCreate` arms the create switch (default off)
 * @throws when a seed is invalid or a write is refused
 */
export async function wireStructuredCorpus(corpus: CorpusService, store: StoreInterface, options: { requireCreate?: boolean } = {}): Promise<void> {
  const templates = new TemplateService(store);
  corpus.setStructuredWrite({ templates, requireStructuredCreate: options.requireCreate === true });
  const seeds = readShippedTemplateSeeds(fileURLToPath(new URL("../../../../assets", import.meta.url)));
  if (!seeds.ok) throw new Error(`wireStructuredCorpus: ${JSON.stringify(seeds.error)}`);
  await must(new TemplateSeedService(templates, corpus).apply(seeds.value), "seed templates");
}

/**
 * A template reader over a throwaway in-memory corpus that holds every shipped template, for a test whose subject takes a
 * `TemplateService` (or a `CorpusService.templateReader`) but writes no document of its own.
 *
 * @returns the seeded reader
 * @throws when seeding fails
 */
export async function seededTemplateReader(): Promise<TemplateService> {
  const store = actedStore(new InMemoryStore());
  const corpus = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  await wireStructuredCorpus(corpus, store);
  const reader = corpus.templateReader;
  if (reader === undefined) throw new Error("seededTemplateReader: the corpus has no template reader after wiring");
  return reader;
}
