/**
 * Wiring of the legacy classification and conversion services from an `App` (CLI surface).
 *
 * Purpose: `lore convert` and `lore migrate legacy` need the same two services built over the app's one
 *   `CorpusService`, `TemplateService`, record lock and AI provider; this is the single place that composes them.
 * Public surface: {@link buildLegacyServices}.
 * Invariants: composes only; a missing required service on the App is a loud refusal, never a degraded run.
 * Side-effect class: pure (construction only).
 */

import { err, ok, type LoreError, type Result } from "@lore/core";
import type { App } from "../../app.js";
import { ConversionService } from "../../service/conversion-service.js";
import { LegacyClassificationService } from "../../service/legacy-classification-service.js";

/** The two services, composed over one app. */
export interface LegacyServices {
  readonly classification: LegacyClassificationService;
  readonly conversion: ConversionService;
}

/**
 * @param app - a loaded app (templates and the record lock must be wired)
 * @returns the services, or an INTERNAL-style refusal naming the missing wiring
 */
export function buildLegacyServices(app: App): Result<LegacyServices, LoreError> {
  const templates = app.templateService;
  const lock = app.recordLockService;
  if (templates === undefined || lock === undefined) {
    return err({ code: "VALIDATION_ERROR", field: "app", message: "TemplateService / RecordLockService are not wired on this App" });
  }
  const corpus = app.corpusService;
  const classification = new LegacyClassificationService({
    listFull: (filters) => corpus.listFull(filters),
    writeDoc: (request) => corpus.writeDoc(request),
    templatedTypes: () => templates.templatedTypes(),
  });
  const conversion = new ConversionService({
    corpus: {
      get: async (idOrSlug) => {
        const got = await corpus.get(idOrSlug);
        return got.ok ? ok({ doc: got.value.doc }) : got;
      },
      set: async (idOrSlug, patch, opts) => {
        const written = await corpus.set(idOrSlug, patch, opts);
        return written.ok ? ok(written.value) : written;
      },
    },
    templates,
    classification,
    isLockedRecord: async (doc) => {
      const state = await lock.resolve(doc);
      return state.ok ? ok(state.value.standing === "record" && state.value.locked === true) : state;
    },
    draft: { draftText: (prompt, docType, title) => app.aiProviderService.draftText(prompt, docType, title) },
  });
  return ok({ classification, conversion });
}
