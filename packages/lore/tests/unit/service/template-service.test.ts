/**
 * Unit tests for TemplateService (structured-documents T2): the `template` document type, version
 * resolution (`<slug>@<version>`), latest-approved resolution, render / validate / checks.
 *
 * Uses InMemoryStore + CorpusService; the templated document under test is a plain DocRecord literal because
 * the service only reads `type`, `slug` and `extra`.
 *
 * Coverage:
 *   HAPPY:      latest approved resolves; a pinned ref resolves; render / validate / checks work on a pinned doc
 *   NEGATIVE:   no approved template names the missing template (type and kind); a draft-only template is not "approved";
 *               an unknown / malformed pin is refused naming the ref; a document with no pin is refused
 *   BOUNDARY:   kind-less vs kinded templates are separate slots (no silent fallback); version 1 stays resolvable
 *   STATE:      after a revision to @2 is approved, `@1` still returns the @1 template while latest returns @2; a pending
 *               (draft) revision does not become "latest approved"
 *   ERROR:      a template whose extra.template breaks the meta-schema is refused at create and at set, listing every issue
 *   REGRESSION: an `unknown check id` and a `render path not in fields` are BOTH named in one refusal
 *
 * @spec_ref spec-every-document-is-stored-as-structured-fields-validated-by
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { CreateDocInput, DocRecord } from "@lore/core";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { TemplateService } from "../../../src/service/template-service.js";
import { actedStore } from "../../live-invocation.js";

function templateBody(version: number, extraDimension = false): Record<string, unknown> {
  return {
    doc_type: "spec",
    kind: "tech",
    version,
    fields: {
      type: "object",
      required: ["summary"],
      properties: {
        summary: { type: "string", minLength: 1 },
        refusals: {
          type: "array",
          items: { type: "object", properties: { id: { type: "string" }, acs: { type: "array", items: { type: "string" } } } },
          "x-refusal-list": true,
        },
      },
    },
    dimensions: [
      { id: "scope", question: "What is in scope?" },
      { id: "risks", question: "What can go wrong?", needs_refs: true },
      ...(extraDimension ? [{ id: "rollback", question: "How is it rolled back?" }] : []),
    ],
    checks: ["refusal-has-ac"],
    render: [{ heading: "Summary", fields: ["summary"] }, { heading: "Refusals", fields: ["refusals"] }],
  };
}

function setup() {
  const store = actedStore(new InMemoryStore());
  const corpus = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  return { store, corpus, service: new TemplateService(store) };
}

async function createTemplate(corpus: CorpusService, title: string, body: Record<string, unknown>): Promise<DocRecord> {
  const created = await corpus.create({ type: "template", title, extra: { template: body } } as CreateDocInput);
  if (!created.ok) throw new Error(`create template: ${JSON.stringify(created.error)}`);
  return created.value;
}

async function setStatus(corpus: CorpusService, id: string, status: "approved" | "draft"): Promise<void> {
  const current = await corpus.get(id);
  if (!current.ok) throw new Error(JSON.stringify(current.error));
  const done = await corpus.set(id, { status, version: current.value.doc.version } as never);
  if (!done.ok) throw new Error(`set ${status}: ${JSON.stringify(done.error)}`);
}

async function reviseTemplate(corpus: CorpusService, id: string, body: Record<string, unknown>): Promise<void> {
  const current = await corpus.get(id);
  if (!current.ok) throw new Error(JSON.stringify(current.error));
  const done = await corpus.set(id, { extra: { template: body }, version: current.value.doc.version } as never);
  if (!done.ok) throw new Error(`revise: ${JSON.stringify(done.error)}`);
}

function templatedDoc(ref: string, extra: Record<string, unknown> = {}): DocRecord {
  return {
    id: "01ARZ3DOC00000000000001",
    slug: "spec-under-test",
    type: "spec",
    extra: {
      spec_kind: "tech",
      template_ref: ref,
      fields: { summary: "does the thing", refusals: [{ id: "refuse-x" }] },
      dimensions: [
        { id: "scope", status: "handled", answer: "the module", refs: [] },
        { id: "risks", status: "handled", answer: "see AC", refs: ["AC-T-1"] },
      ],
      acceptance_criteria: [{ id: "AC-T-1", statement: "x", verify: { mode: "human", note: "n" }, cites: [] }],
      ...extra,
    },
  } as unknown as DocRecord;
}

describe("template document type", () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  it("creates a parentless template document (HAPPY)", async () => {
    const doc = await createTemplate(ctx.corpus, "Tech spec template", templateBody(1));
    expect(doc.type).toBe("template");
    expect(doc.parent_id ?? null).toBeNull();
  });

  it("refuses a template that breaks the meta-schema, listing every issue (ERROR, REGRESSION)", async () => {
    const bad = { ...templateBody(1), checks: ["no-such-check"], render: [{ heading: "H", fields: ["absent"] }] };
    const created = await ctx.corpus.create({ type: "template", title: "Bad", extra: { template: bad } } as CreateDocInput);
    expect(created.ok).toBe(false);
    if (created.ok) return;
    const text = JSON.stringify(created.error);
    expect(created.error.code).toBe("VALIDATION_ERROR");
    expect(text).toContain("no-such-check");
    expect(text).toContain("absent");
    const listed = await ctx.store.findMany({ type: "template" });
    expect(listed.ok && listed.value.length).toBe(0);
  });

  it("refuses a create with no extra.template (NEGATIVE)", async () => {
    const created = await ctx.corpus.create({ type: "template", title: "Empty", extra: {} } as CreateDocInput);
    expect(created.ok).toBe(false);
  });

  it("refuses a set that breaks the meta-schema and keeps the stored template (ERROR)", async () => {
    const doc = await createTemplate(ctx.corpus, "Tech spec template", templateBody(1));
    const bad = { ...templateBody(1), checks: ["no-such-check"] };
    const done = await ctx.corpus.set(doc.id, { extra: { template: bad }, version: doc.version } as never);
    expect(done.ok).toBe(false);
    if (!done.ok) expect(JSON.stringify(done.error)).toContain("no-such-check");
    const after = await ctx.corpus.get(doc.id);
    expect(after.ok && (after.value.doc.extra["template"] as { checks: string[] }).checks).toEqual(["refusal-has-ac"]);
  });
});

describe("TemplateService.resolveTemplate", () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  it("names the missing template when none exists (NEGATIVE)", async () => {
    const found = await ctx.service.resolveTemplate("spec", "tech");
    expect(found.ok).toBe(false);
    if (!found.ok) {
      expect(found.error.code).toBe("VALIDATION_ERROR");
      expect(JSON.stringify(found.error)).toContain("spec/tech");
    }
  });

  it("does not treat a draft-only template as approved (NEGATIVE)", async () => {
    await createTemplate(ctx.corpus, "Tech spec template", templateBody(1));
    const found = await ctx.service.resolveTemplate("spec", "tech");
    expect(found.ok).toBe(false);
  });

  it("returns the approved template with its slug, version and pin (HAPPY)", async () => {
    const doc = await createTemplate(ctx.corpus, "Tech spec template", templateBody(1));
    await setStatus(ctx.corpus, doc.id, "approved");
    const found = await ctx.service.resolveTemplate("spec", "tech");
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.value.slug).toBe(doc.slug);
    expect(found.value.version).toBe(1);
    expect(found.value.ref).toBe(`${doc.slug}@1`);
    expect(found.value.template.dimensions.map((d) => d.id)).toEqual(["scope", "risks"]);
  });

  it("keeps kinded and kind-less templates as separate slots (BOUNDARY)", async () => {
    const doc = await createTemplate(ctx.corpus, "Tech spec template", templateBody(1));
    await setStatus(ctx.corpus, doc.id, "approved");
    const kindless = await ctx.service.resolveTemplate("spec");
    expect(kindless.ok).toBe(false);
    const other = await ctx.service.resolveTemplate("spec", "design");
    expect(other.ok).toBe(false);
    if (!other.ok) expect(JSON.stringify(other.error)).toContain("spec/design");
  });

  it("returns the latest approved version and ignores a pending draft revision (STATE)", async () => {
    const doc = await createTemplate(ctx.corpus, "Tech spec template", templateBody(1));
    await setStatus(ctx.corpus, doc.id, "approved");
    await reviseTemplate(ctx.corpus, doc.id, templateBody(2, true));
    const whilePending = await ctx.service.resolveTemplate("spec", "tech");
    expect(whilePending.ok && whilePending.value.version).toBe(1);
    await setStatus(ctx.corpus, doc.id, "approved");
    const afterApproval = await ctx.service.resolveTemplate("spec", "tech");
    expect(afterApproval.ok && afterApproval.value.version).toBe(2);
    expect(afterApproval.ok && afterApproval.value.template.dimensions.length).toBe(3);
  });
});

describe("template revision lifecycle", () => {
  it("demotes an approved template to draft on a real edit, not on a re-save of the same template (STATE, BOUNDARY)", async () => {
    const ctx = setup();
    const doc = await createTemplate(ctx.corpus, "Tech spec template", templateBody(1));
    await setStatus(ctx.corpus, doc.id, "approved");

    // same template, keys written in another order: not an edit
    const reordered = Object.fromEntries(Object.entries(templateBody(1)).reverse());
    await reviseTemplate(ctx.corpus, doc.id, reordered);
    const same = await ctx.corpus.get(doc.id);
    expect(same.ok && same.value.doc.status).toBe("approved");

    await reviseTemplate(ctx.corpus, doc.id, templateBody(2, true));
    const edited = await ctx.corpus.get(doc.id);
    expect(edited.ok && edited.value.doc.status).toBe("draft");
  });
});

describe("TemplateService.resolvePinned", () => {
  let ctx: ReturnType<typeof setup>;
  let slug: string;
  beforeEach(async () => {
    ctx = setup();
    const doc = await createTemplate(ctx.corpus, "Tech spec template", templateBody(1));
    slug = doc.slug;
    await setStatus(ctx.corpus, doc.id, "approved");
    await reviseTemplate(ctx.corpus, doc.id, templateBody(2, true));
    await setStatus(ctx.corpus, doc.id, "approved");
  });

  it("returns exactly the pinned version after a later revision (STATE, REGRESSION)", async () => {
    const v1 = await ctx.service.resolvePinned(`${slug}@1`);
    const v2 = await ctx.service.resolvePinned(`${slug}@2`);
    expect(v1.ok && v1.value.dimensions.length).toBe(2);
    expect(v2.ok && v2.value.dimensions.length).toBe(3);
    expect(v1.ok && v1.value.version).toBe(1);
  });

  it("refuses a version that was never approved, naming the ref (NEGATIVE)", async () => {
    const found = await ctx.service.resolvePinned(`${slug}@3`);
    expect(found.ok).toBe(false);
    if (!found.ok) expect(JSON.stringify(found.error)).toContain(`${slug}@3`);
  });

  it("refuses an unknown slug and a malformed ref (NEGATIVE, BOUNDARY)", async () => {
    const unknown = await ctx.service.resolvePinned("no-such-template@1");
    expect(unknown.ok).toBe(false);
    for (const raw of ["", slug, `${slug}@0`, `${slug}@x`, `${slug}@1.5`]) {
      const malformed = await ctx.service.resolvePinned(raw);
      expect(malformed.ok, raw).toBe(false);
    }
  });
});

describe("TemplateService.render / validate / checks", () => {
  let ctx: ReturnType<typeof setup>;
  let slug: string;
  beforeEach(async () => {
    ctx = setup();
    const doc = await createTemplate(ctx.corpus, "Tech spec template", templateBody(1));
    slug = doc.slug;
    await setStatus(ctx.corpus, doc.id, "approved");
    await reviseTemplate(ctx.corpus, doc.id, templateBody(2, true));
    await setStatus(ctx.corpus, doc.id, "approved");
  });

  it("renders the pinned template's sections, identically each time (HAPPY)", async () => {
    const first = await ctx.service.render(templatedDoc(`${slug}@1`));
    const second = await ctx.service.render(templatedDoc(`${slug}@1`));
    expect(first.ok && first.value).toContain("## Summary");
    expect(first.ok && first.value).toContain("does the thing");
    expect(first).toEqual(second);
  });

  it("validates a document against its PINNED version, not the latest (REGRESSION)", async () => {
    const pinned = await ctx.service.validate(templatedDoc(`${slug}@1`));
    expect(pinned.ok && pinned.value).toEqual([]);
    const latest = await ctx.service.validate(templatedDoc(`${slug}@2`));
    expect(latest.ok).toBe(true);
    if (latest.ok) expect(latest.value.map((problem) => problem.code)).toEqual(["missing-dimension"]);
  });

  it("reports every problem at once (NEGATIVE)", async () => {
    const broken = templatedDoc(`${slug}@1`, { fields: {}, dimensions: [{ id: "scope", status: "na", answer: "" }] });
    const problems = await ctx.service.validate(broken);
    expect(problems.ok).toBe(true);
    if (!problems.ok) return;
    const codes = problems.value.map((problem) => problem.code);
    expect(codes).toContain("schema-violation");
    expect(codes).toContain("empty-answer");
    expect(codes).toContain("missing-dimension");
  });

  it("refuses a document with no template_ref (NEGATIVE)", async () => {
    const doc = templatedDoc(`${slug}@1`);
    const { template_ref: _unpinned, ...extra } = doc.extra as Record<string, unknown>;
    const unpinned = { ...doc, extra } as DocRecord;
    const results = [await ctx.service.render(unpinned), await ctx.service.validate(unpinned), await ctx.service.checks(unpinned)];
    for (const result of results) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(JSON.stringify(result.error)).toContain("template_ref");
    }
  });

  it("reports a refusal entry that names no existing criterion, and none once it names one (checks, STATE)", async () => {
    const unnamed = await ctx.service.checks(templatedDoc(`${slug}@1`));
    expect(unnamed.ok).toBe(true);
    if (!unnamed.ok) return;
    expect(unnamed.value.some((finding) => finding.check === "refusal-has-ac" && finding.entry.includes("refuse-x"))).toBe(true);

    // an AC whose `cites` names the refusal does NOT cover it (cites takes rule ids only): the refusal names its own acs
    const citedOnly = await ctx.service.checks(
      templatedDoc(`${slug}@1`, {
        acceptance_criteria: [{ id: "AC-T-1", statement: "x", verify: { mode: "human", note: "n" }, cites: ["refuse-x"] }],
      }),
    );
    expect(citedOnly.ok && citedOnly.value.some((finding) => finding.check === "refusal-has-ac")).toBe(true);

    const named = await ctx.service.checks(
      templatedDoc(`${slug}@1`, { fields: { summary: "does the thing", refusals: [{ id: "refuse-x", acs: ["AC-T-1"] }] } }),
    );
    expect(named.ok && named.value).toEqual([]);

    const ghost = await ctx.service.checks(
      templatedDoc(`${slug}@1`, { fields: { summary: "does the thing", refusals: [{ id: "refuse-x", acs: ["AC-NOPE"] }] } }),
    );
    expect(ghost.ok && ghost.value.map((finding) => finding.problem).join(" ")).toContain("AC-NOPE");
  });
});
