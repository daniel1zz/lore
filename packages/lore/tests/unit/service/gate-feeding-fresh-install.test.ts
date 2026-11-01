/**
 * spec-governance-visibility-an-armed-gate-that-vacuously-passes §B3 — "a fresh consumer install receives an
 * empty feeding pack", as re-based by spec-every-document-is-stored-as-structured-fields-validated-by ("One source").
 *
 * `CorpusService._createImpl`'s spec-create gate enrichment (SPEC-049 §Design Decisions D3) threads a rule slice into
 * the denial's feeding pack as `ruleSource`/`ruleMarkdown`. That rule is the APPROVED TEMPLATE of the spec's kind: the
 * spec-rules corpus document, the compiled-in fallback text and the rule file shipped with the binary are retired.
 * This file proves, at the service layer (InMemoryStore, no subprocess), that the denial always carries a NAMED,
 * non-empty rule slice and never `[source: unknown]`:
 *
 *   HAPPY:      an approved spec/feature template exists -> `[source: template <slug>@<n>]` and its rule text
 *   NEGATIVE:   a skill doc scoped `applies_to: "spec"` does NOT feed it (the template is the one source), and an
 *               EMPTY corpus (no template) names the missing template instead of quoting an invented rule
 *   ERROR:      the template read fails (store.findMany errors) -> the pack still names the failed lookup, never
 *               throws, never `[source: unknown]`
 *   BOUNDARY:   the slice follows the spec's own kind (a `tech` spec quotes the tech template)
 *   STATE:      `workflow.gates.spec-create.enabled: false` -> the create simply passes
 *   REGRESSION: the retired fallback text never appears
 *
 * The denial is driven by the one content-level predicate a service-layer create can still trip: an unquantified
 * acceptance criterion (`acQuantifiable`); the heading-count predicate is retired (BR-4).
 *
 * @spec_ref spec-governance-visibility-an-armed-gate-that-vacuously-passes §B3, AC-GV-5
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { describe, it, expect } from "vitest";

import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { TemplateService } from "../../../src/service/template-service.js";
import type { StoreFilters } from "../../../src/store/store-interface.js";
import { err } from "@lore/core";
import type { CreateDocInput, DocRecord, LoreConfig, LoreError, Result } from "@lore/core";
import { actedStore } from "../../live-invocation.js";

import { ensureRequirementsDocId } from "../../helpers/parented-create.js";

const BODY = "a body with no headings anywhere";
/** An abstract-quality criterion with no threshold: the predicate that denies a service-layer spec create. */
const UNQUANTIFIED_AC = { id: "AC-VAGUE-1", statement: "the dashboard loads fast", verify: { mode: "human" as const } };
const RETIRED_FALLBACK_MARKERS = ["built-in fallback", "## Rules a candidate spec must satisfy", "shipped asset"];

/** Extracts the `[source: X, trust: Y]` header's `X` from a rendered feeding-pack message. */
function extractSource(message: string): string | null {
  const m = /\[source: ([^,]+), trust: [^\]]+\]/.exec(message);
  return m ? m[1] ?? null : null;
}

function makeGatedService(store: InMemoryStore = actedStore(new InMemoryStore()), enforcer: GateEnforcer = new GateEnforcer(undefined)) {
  const service = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)), undefined, undefined, enforcer);
  // reason: production wires this in `app.ts`; the rule slice reads the approved template through it.
  service.setStructuredWrite({ templates: new TemplateService(store), requireStructuredCreate: false });
  return { service, store };
}

async function createPrd(service: CorpusService, title: string): Promise<DocRecord> {
  const created = await service.create({ type: "prd", title, content: "PRD body" } as CreateDocInput);
  if (!created.ok) throw new Error(`prd create failed: ${JSON.stringify(created.error)}`);
  return created.value;
}

/** Creates and approves a minimal spec template of `kind`; returns its `slug@1` ref. */
async function installSpecTemplate(service: CorpusService, kind: string): Promise<string> {
  const body = {
    doc_type: "spec",
    kind,
    version: 1,
    fields: { type: "object", required: ["summary"], properties: { summary: { type: "string", minLength: 1 } } },
    dimensions: [{ id: "edge-cases", question: "Which edge cases does it handle?" }],
    checks: ["refs-resolve"],
    render: [{ heading: "Summary", fields: ["summary"] }],
  };
  const created = await service.create({ type: "template", title: `Fixture spec ${kind} template`, extra: { template: body } } as CreateDocInput);
  if (!created.ok) throw new Error(`template create failed: ${JSON.stringify(created.error)}`);
  const approved = await service.set(created.value.id, { status: "approved" });
  if (!approved.ok) throw new Error(`template approve failed: ${JSON.stringify(approved.error)}`);
  return `${created.value.slug}@1`;
}

function badSpec(title: string, kind?: string): CreateDocInput {
  return {
    type: "spec",
    title,
    content: BODY,
    extra: { ...(kind === undefined ? {} : { spec_kind: kind }), acceptance_criteria: [UNQUANTIFIED_AC] },
  } as CreateDocInput;
}

async function denialMessage(service: CorpusService, input: CreateDocInput): Promise<string> {
  const spec = await service.create(input);
  expect(spec.ok).toBe(false);
  if (spec.ok) return "";
  return (spec.error as { message?: string }).message ?? "";
}

describe("CorpusService spec-create rule slice — HAPPY", () => {
  it("an approved spec/feature template feeds the denial: its ref on the source line and its rule text", async () => {
    const { service } = makeGatedService();
    await createPrd(service, "Root PRD");
    const ref = await installSpecTemplate(service, "feature");

    const message = await denialMessage(service, badSpec("Bad Spec"));

    expect(extractSource(message)).toBe(`template ${ref}`);
    expect(message).toContain("What a spec feature must satisfy");
    expect(message).toContain("required: summary");
    expect(message).toContain("edge-cases");
    expect(message).toContain("lore template show spec --kind feature");
    for (const marker of RETIRED_FALLBACK_MARKERS) expect(message).not.toContain(marker);
  });
});

describe("CorpusService spec-create rule slice — BOUNDARY", () => {
  it("follows the spec's own kind: a tech spec quotes the tech template, not the feature one", async () => {
    const { service } = makeGatedService();
    await createPrd(service, "Root PRD");
    await installSpecTemplate(service, "feature");
    const techRef = await installSpecTemplate(service, "tech");

    const message = await denialMessage(service, badSpec("Bad Tech Spec", "tech"));

    expect(extractSource(message)).toBe(`template ${techRef}`);
    expect(message).toContain("What a spec tech must satisfy");
  });
});

describe("CorpusService spec-create rule slice — NEGATIVE", () => {
  it("a skill doc scoped applies_to=spec does NOT feed the denial: the template is the one source", async () => {
    const { service } = makeGatedService();
    await createPrd(service, "Root PRD");
    const ref = await installSpecTemplate(service, "feature");
    const skill = await service.create({
      parent_id: await ensureRequirementsDocId(service), type: "knowledge",
      title: "Team write-spec rules",
      content: "## Rule\n\nDistinctive team-authored rule text.",
      extra: { sub_type: "skill", skill: { applies_to: "spec" } },
    } as CreateDocInput);
    if (!skill.ok) throw new Error(`skill create failed: ${JSON.stringify(skill.error)}`);
    const approved = await service.set(skill.value.id, { status: "approved" });
    if (!approved.ok) throw new Error(`skill approve failed: ${JSON.stringify(approved.error)}`);

    const message = await denialMessage(service, badSpec("Bad Spec"));

    expect(extractSource(message)).toBe(`template ${ref}`);
    expect(message).not.toContain(approved.value.slug);
    expect(message).not.toContain("Distinctive team-authored rule text.");
  });

  it("an EMPTY corpus (no approved template) names the missing template, never [source: unknown] or an invented rule", async () => {
    const { service } = makeGatedService();
    await createPrd(service, "Root PRD");

    const message = await denialMessage(service, badSpec("Bad Spec"));

    expect(message).not.toContain("[source: unknown");
    expect(extractSource(message)).toBe("template lookup");
    expect(message).toContain("No rule could be read from an approved template");
    expect(message).toContain("no approved template for spec/feature");
    for (const marker of RETIRED_FALLBACK_MARKERS) expect(message).not.toContain(marker);
  });
});

describe("CorpusService spec-create rule slice — ERROR", () => {
  it("a failing template read (store.findMany errors) still names the failed lookup, never throws or degrades to [source: unknown]", async () => {
    class TemplateReadFailingStore extends InMemoryStore {
      override async findMany(filters: StoreFilters): Promise<Result<DocRecord[], LoreError>> {
        if (filters.type === "template") {
          return err({ code: "STORE_ERROR", message: "simulated findMany failure" });
        }
        return super.findMany(filters);
      }
    }

    const { service } = makeGatedService(actedStore(new TemplateReadFailingStore()));
    await createPrd(service, "Root PRD");

    const message = await denialMessage(service, badSpec("Bad Spec"));

    expect(message).not.toContain("[source: unknown");
    expect(extractSource(message)).toBe("template lookup");
    expect(message).toContain("simulated findMany failure");
  });
});

describe("CorpusService spec-create rule slice — STATE", () => {
  it("a DISABLED spec-create gate never reads the template — the create simply passes", async () => {
    const enforcer = new GateEnforcer({
      project: { name: "x", author: "owner" },
      workflow: { gates: { "spec-create": { enabled: false } } },
    } as unknown as LoreConfig);
    const { service } = makeGatedService(actedStore(new InMemoryStore()), enforcer);
    await createPrd(service, "Root PRD");

    const spec = await service.create(badSpec("Ungated Spec"));

    expect(spec.ok).toBe(true);
  });
});
