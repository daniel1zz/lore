/**
 * Unit tests for the pieces behind AC-ST-7 (spec-every-document-is-stored-as-structured-fields-validated-by): the legacy
 * freeze guard, the completed/open rule, the draft prompt and parser, and `ConversionService` driven by the in-memory AI
 * double through the real `AIProviderService`.
 *
 * Coverage:
 *   HAPPY:      a locked spec with all plans archived is completed; a conversion stores what the draft says
 *   NEGATIVE:   a frozen doc refuses content/title/criteria/anchor writes; a completed, templated or deleted doc is not converted
 *   BOUNDARY:   a locked spec with no plan, or with one open plan, is open; the marker can be added once and never edited
 *   ERROR:      a provider failure, prose instead of JSON and a draft without `dimensions` write nothing
 *   REGRESSION: lifecycle keys (validity) and status changes stay allowed on a frozen doc
 *
 * @spec_ref spec-every-document-is-stored-as-structured-fields-validated-by
 */

import { describe, expect, it } from "vitest";
import { ok, type DocRecord, type LoreError, type Result } from "@lore/core";
import { InMemoryAIProvider } from "../../../src/ai/in-memory-provider.js";
import { ConversionService, buildConversionPrompt, parseConversionDraft } from "../../../src/service/conversion-service.js";
import { AIProviderService } from "../../../src/service/ai-provider-service.js";
import { buildLegacyMarker, guardLegacyFrozenWrite } from "../../../src/service/legacy-freeze.js";
import { isCompletedDocument } from "../../../src/service/legacy-classification-service.js";
import type { ResolvedTemplate } from "../../../src/service/template-service.js";

function doc(over: Partial<DocRecord> = {}): DocRecord {
  return {
    id: "01DOC",
    slug: "spec-a",
    type: "spec",
    role: "design",
    title: "A",
    status: "draft",
    priority: "medium",
    content: "## Goal\n\nold body",
    parent_id: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    created_by: "owner",
    version: 3,
    deleted_at: null,
    tags: [],
    extra: { spec_kind: "tech" },
    ...over,
  } as DocRecord;
}

const frozen = (): DocRecord => doc({ status: "archived", extra: { spec_kind: "tech", legacy: buildLegacyMarker("2026-02-01T00:00:00.000Z") } });
const plan = (status: string): DocRecord => doc({ id: "01PLAN", slug: "plan-a", type: "plan", status: status as DocRecord["status"], parent_id: "01DOC" });

describe("guardLegacyFrozenWrite", () => {
  it("passes every write for a document that is not frozen", () => {
    expect(guardLegacyFrozenWrite(doc(), { content: "new" }, "set").ok).toBe(true);
  });

  it("refuses content, title, priority, tags and slug changes on the set surface, naming the freeze", () => {
    for (const patch of [{ content: "new" }, { title: "B" }, { priority: "high" }, { tags: ["x"] }, { slug: "spec-b" }]) {
      const result = guardLegacyFrozenWrite(frozen(), patch, "set");
      expect(result.ok, JSON.stringify(patch)).toBe(false);
      if (!result.ok && result.error.code === "VALIDATION_ERROR") expect(result.error.message).toContain("legacy-frozen");
    }
  });

  it("is not tripped by a resend of the stored values or a status-only write", () => {
    const stored = frozen();
    expect(guardLegacyFrozenWrite(stored, { content: stored.content, title: stored.title, extra: stored.extra }, "set").ok).toBe(true);
    expect(guardLegacyFrozenWrite(stored, {}, "set").ok).toBe(true);
  });

  it("the row route refuses criteria, anchors and fields but lets other metadata and lifecycle keys through", () => {
    const stored = frozen();
    for (const key of ["acceptance_criteria", "file_anchors", "code_anchors", "fields", "dimensions", "template_ref"]) {
      expect(guardLegacyFrozenWrite(stored, { extra: { ...stored.extra, [key]: [] } }, "row").ok, key).toBe(false);
    }
    expect(guardLegacyFrozenWrite(stored, { extra: { ...stored.extra, drift_checked_at: "now" } }, "row").ok).toBe(true);
    expect(guardLegacyFrozenWrite(stored, { extra: { ...stored.extra, validity: { invalid_at: "now" } } }, "row").ok).toBe(true);
    expect(guardLegacyFrozenWrite(stored, { extra: { ...stored.extra, validity: { invalid_at: "now" } } }, "set").ok).toBe(true);
    expect(guardLegacyFrozenWrite(stored, { extra: { ...stored.extra, drift_checked_at: "now" } }, "set").ok).toBe(false);
  });

  it("the marker cannot be edited or dropped once present, but can be added to an open document", () => {
    const stored = frozen();
    const { legacy: _dropped, ...withoutMarker } = stored.extra;
    expect(guardLegacyFrozenWrite(stored, { extra: withoutMarker }, "row").ok).toBe(false);
    expect(guardLegacyFrozenWrite(stored, { extra: { ...stored.extra, legacy: buildLegacyMarker("2027-01-01T00:00:00.000Z") } }, "row").ok).toBe(false);
    expect(guardLegacyFrozenWrite(doc(), { extra: { spec_kind: "tech", legacy: buildLegacyMarker("2026-02-01T00:00:00.000Z") } }, "row").ok).toBe(true);
  });
});

describe("isCompletedDocument", () => {
  it("archived and deprecated documents are completed whatever their type", () => {
    expect(isCompletedDocument(doc({ status: "archived" }), [])).toBe(true);
    expect(isCompletedDocument(doc({ status: "deprecated", type: "knowledge" }), [])).toBe(true);
  });

  it("a locked spec/adr with at least one plan, every plan archived, is completed", () => {
    expect(isCompletedDocument(doc({ status: "approved" }), [plan("archived"), plan("archived")])).toBe(true);
    expect(isCompletedDocument(doc({ status: "approved", type: "adr" }), [plan("archived")])).toBe(true);
  });

  it("a locked spec with NO plan, or with one open or deprecated plan, is open", () => {
    expect(isCompletedDocument(doc({ status: "approved" }), [])).toBe(false);
    expect(isCompletedDocument(doc({ status: "approved" }), [plan("archived"), plan("approved")])).toBe(false);
    expect(isCompletedDocument(doc({ status: "approved" }), [plan("deprecated")])).toBe(false);
  });

  it("drafts, other types and unlocked records are open however many archived plans they have", () => {
    expect(isCompletedDocument(doc({ status: "draft" }), [plan("archived")])).toBe(false);
    expect(isCompletedDocument(doc({ status: "approved", type: "plan" }), [plan("archived")])).toBe(false);
  });
});

describe("parseConversionDraft", () => {
  it("reads a JSON object inside a code fence or prose", () => {
    const parsed = parseConversionDraft('Here you go:\n```json\n{"fields":{"summary":"s"},"dimensions":[]}\n```', "spec-a");
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.fields).toEqual({ summary: "s" });
  });

  it("refuses prose, broken JSON and a draft without fields or dimensions", () => {
    for (const text of ["no json here", "{not json}", '{"fields":{}}', '{"dimensions":[]}', '{"fields":[],"dimensions":[]}']) {
      const parsed = parseConversionDraft(text, "spec-a");
      expect(parsed.ok, text).toBe(false);
      if (!parsed.ok) expect(parsed.error.code).toBe("VALIDATION_ERROR");
    }
  });
});

const TEMPLATE: ResolvedTemplate = {
  slug: "spec-tech-template",
  version: 2,
  ref: "spec-tech-template@2",
  template: {
    doc_type: "spec",
    kind: "tech",
    version: 2,
    fields: { type: "object", properties: { summary: { type: "string" } } },
    dimensions: [{ id: "scope", question: "What does it cover?" }],
    checks: [],
    render: [{ heading: "Summary", fields: ["summary"] }],
  },
};

interface Rig {
  readonly service: ConversionService;
  readonly provider: InMemoryAIProvider;
  readonly writes: { id: string; patch: { extra: Record<string, unknown> }; opts: Record<string, unknown> }[];
}

function rig(stored: DocRecord, opts: { locked?: boolean; completed?: boolean; resolveError?: LoreError } = {}): Rig {
  const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: '{"fields":{"summary":"s"},"dimensions":[{"id":"scope","status":"handled","answer":"a","refs":[]}]}' });
  const ai = new AIProviderService(
    new Map([["in-memory", provider]]) as unknown as ReadonlyMap<string, import("@lore/core").AIProvider>,
    "in-memory",
    {},
    { emit: () => undefined } as never,
    false,
    8000,
    { max_diff_chars: 24000 },
  );
  const writes: Rig["writes"] = [];
  const service = new ConversionService({
    corpus: {
      get: async () => ok({ doc: stored }),
      set: async (id, patch, setOpts) => {
        writes.push({ id, patch, opts: { ...setOpts } });
        return ok({ ...stored, version: stored.version + 1, extra: patch.extra });
      },
    },
    templates: { resolveTemplate: async (): Promise<Result<ResolvedTemplate, LoreError>> => (opts.resolveError !== undefined ? { ok: false, error: opts.resolveError } : ok(TEMPLATE)) },
    classification: { isCompleted: async () => ok(opts.completed === true) },
    isLockedRecord: async () => ok(opts.locked === true),
    draft: ai,
  });
  return { service, provider, writes };
}

describe("ConversionService.convert", () => {
  it("drafts through the AI provider, writes fields and dimensions once, guarded by the version it read", async () => {
    const r = rig(doc());
    const result = await r.service.convert("spec-a", { by: "agent:x" });
    expect(result.ok).toBe(true);
    expect(r.provider.calls).toHaveLength(1);
    expect(r.writes).toHaveLength(1);
    expect(r.writes[0]!.opts).toMatchObject({ expectedVersion: 3, convertToTemplate: true, by: "agent:x" });
    expect(r.writes[0]!.opts["correction"]).toBeUndefined();
    expect(r.writes[0]!.patch.extra["fields"]).toEqual({ summary: "s" });
    expect(r.writes[0]!.patch.extra["spec_kind"], "the document's other extra survives").toBe("tech");
    if (result.ok) expect(result.value).toMatchObject({ template_ref: "spec-tech-template@2", version: 4, correction: false });
  });

  it("a locked record is written through a correction and carries the supplied decision", async () => {
    const r = rig(doc({ status: "approved" }), { locked: true });
    const decision = { reason: "convert" };
    const result = await r.service.convert("spec-a", { decision });
    expect(result.ok).toBe(true);
    expect(r.writes[0]!.opts["correction"]).toMatchObject({ reason: expect.stringContaining("spec-tech-template@2") });
    expect(r.writes[0]!.opts["decision"]).toBe(decision);
  });

  it("the prompt carries the template's fields, its dimensions and the document body", () => {
    const prompt = buildConversionPrompt(TEMPLATE, doc());
    expect(prompt).toContain("spec-tech-template@2");
    expect(prompt).toContain('"id": "scope"');
    expect(prompt).toContain("old body");
  });

  it("refuses a completed, frozen, already templated, deleted or template document before calling the AI", async () => {
    const cases: [string, DocRecord, { completed?: boolean }][] = [
      ["completed", doc(), { completed: true }],
      ["frozen", frozen(), {}],
      ["templated", doc({ extra: { template_ref: "spec-tech-template@1" } }), {}],
      ["deleted", doc({ deleted_at: "2026-03-01T00:00:00.000Z" }), {}],
      ["template", doc({ type: "template" }), {}],
    ];
    for (const [label, stored, flags] of cases) {
      const r = rig(stored, flags);
      const result = await r.service.convert("spec-a");
      expect(result.ok, label).toBe(false);
      if (!result.ok) expect(result.error.code, label).toBe("VALIDATION_ERROR");
      expect(r.provider.calls, label).toHaveLength(0);
      expect(r.writes, label).toHaveLength(0);
    }
  });

  it("writes nothing when the template is missing, the provider fails, or the draft is unusable", async () => {
    const missing = rig(doc(), { resolveError: { code: "VALIDATION_ERROR", field: "template", message: "no approved template for spec/tech" } });
    expect((await missing.service.convert("spec-a")).ok).toBe(false);
    expect(missing.provider.calls).toHaveLength(0);

    const failing = rig(doc());
    failing.provider.setMode({ kind: "err", error: { code: "AI_PROVIDER_ERROR", message: "down", provider: "in-memory" } });
    const failed = await failing.service.convert("spec-a");
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.error.code).toBe("AI_PROVIDER_ERROR");
    expect(failing.writes).toHaveLength(0);

    const prose = rig(doc());
    prose.provider.setMode({ kind: "ok", content: "sorry, I cannot" });
    expect((await prose.service.convert("spec-a")).ok).toBe(false);
    expect(prose.writes).toHaveLength(0);

    const partial = rig(doc());
    partial.provider.setMode({ kind: "ok", content: '{"fields":{"summary":"s"}}' });
    expect((await partial.service.convert("spec-a")).ok).toBe(false);
    expect(partial.writes).toHaveLength(0);
  });
});
