/**
 * TemplateService.checks resolves a templated document's AC refs (a task's `ac_scope`) against the criteria of the
 * spec its `spec_ref` names, not only the document's own criteria.
 *
 * Coverage:
 *   HAPPY:      a task citing a real AC of its spec is clean
 *   NEGATIVE:   a task citing an AC the spec does not declare gets a finding naming that id
 *   ERROR:      a task whose spec_ref names no document gets a loud finding naming the spec (and its AC refs fail too)
 *   BOUNDARY:   a spec_ref naming a non-spec document contributes no criteria; a spec's superseded AC still resolves
 *   REGRESSION: a task with no spec_ref cannot resolve a spec AC (no silent plan/global search by AC id)
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

const TASK_TEMPLATE = {
  doc_type: "task",
  version: 1,
  fields: {
    type: "object",
    required: ["objective"],
    properties: {
      objective: { type: "string", minLength: 1 },
      spec_ref: { type: "string", "x-ref": true },
      ac_scope: { type: "array", items: { type: "string" }, "x-ref-list": true },
    },
  },
  dimensions: [{ id: "scope", question: "What is in scope?" }],
  checks: ["refs-resolve"],
  render: [{ heading: "Objective", fields: ["objective"] }],
};

function criterion(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { id, statement: `statement ${id}`, verify: { mode: "human", note: "n" }, cites: [], ...extra };
}

function setup() {
  const store = actedStore(new InMemoryStore());
  const corpus = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  return { store, corpus, service: new TemplateService(store) };
}

async function createApprovedTaskTemplate(corpus: CorpusService): Promise<string> {
  const created = await corpus.create({ type: "template", title: "Task template", extra: { template: TASK_TEMPLATE } } as CreateDocInput);
  if (!created.ok) throw new Error(`create template: ${JSON.stringify(created.error)}`);
  const done = await corpus.set(created.value.id, { status: "approved", version: created.value.version } as never);
  if (!done.ok) throw new Error(`approve template: ${JSON.stringify(done.error)}`);
  return created.value.slug;
}

async function createSpec(corpus: CorpusService, title: string, criteria: Record<string, unknown>[]): Promise<DocRecord> {
  const created = await corpus.create({ type: "spec", title, extra: { acceptance_criteria: criteria } } as CreateDocInput);
  if (!created.ok) throw new Error(`create spec: ${JSON.stringify(created.error)}`);
  return created.value;
}

function task(templateSlug: string, fields: Record<string, unknown>): DocRecord {
  return {
    id: "01ARZ3TASK0000000000001",
    slug: "task-under-test",
    type: "task",
    extra: {
      template_ref: `${templateSlug}@1`,
      fields: { objective: "do it", ...fields },
      dimensions: [{ id: "scope", status: "handled", answer: "a", refs: [] }],
    },
  } as unknown as DocRecord;
}

describe("TemplateService.checks resolves ac_scope against the governing spec", () => {
  let ctx: ReturnType<typeof setup>;
  let templateSlug: string;
  beforeEach(async () => {
    ctx = setup();
    templateSlug = await createApprovedTaskTemplate(ctx.corpus);
  });

  it("HAPPY: a task citing a real spec AC is clean", async () => {
    const spec = await createSpec(ctx.corpus, "Governing spec", [criterion("AC-G-1"), criterion("AC-G-2")]);
    const result = await ctx.service.checks(task(templateSlug, { spec_ref: spec.slug, ac_scope: ["AC-G-1", "AC-G-2"] }));
    expect(result).toEqual({ ok: true, value: [] });
  });

  it("NEGATIVE: a task citing a nonexistent AC id gets a finding naming it, and only it", async () => {
    const spec = await createSpec(ctx.corpus, "Governing spec", [criterion("AC-G-1")]);
    const result = await ctx.service.checks(task(templateSlug, { spec_ref: spec.slug, ac_scope: ["AC-G-1", "AC-G-9"] }));
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    expect(result.value.map((f) => f.entry)).toEqual(["ac_scope: AC-G-9"]);
  });

  it("ERROR: a spec_ref naming no document is a loud finding naming the spec; its AC refs fail too", async () => {
    const result = await ctx.service.checks(task(templateSlug, { spec_ref: "spec-does-not-exist", ac_scope: ["AC-G-1"] }));
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    const entries = result.value.map((f) => f.entry);
    expect(entries).toContain("spec_ref: spec-does-not-exist");
    expect(entries).toContain("ac_scope: AC-G-1");
  });

  it("BOUNDARY: a spec's superseded criterion still resolves (archived tasks stay addressable)", async () => {
    const spec = await createSpec(ctx.corpus, "Governing spec", [criterion("AC-G-1", { superseded_by: { spec: "spec-x", ac: "AC-X-1", reason: "moved", by: "agent:test", at: "2026-11-01T00:00:00Z" } })]);
    const result = await ctx.service.checks(task(templateSlug, { spec_ref: spec.slug, ac_scope: ["AC-G-1"] }));
    expect(result).toEqual({ ok: true, value: [] });
  });

  it("BOUNDARY: a spec_ref naming a non-spec document contributes no criteria", async () => {
    const created = await ctx.corpus.create({ type: "prd", title: "Not a spec" } as CreateDocInput);
    if (!created.ok) throw new Error(JSON.stringify(created.error));
    const result = await ctx.service.checks(task(templateSlug, { spec_ref: created.value.slug, ac_scope: ["AC-G-1"] }));
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    expect(result.value.map((f) => f.entry)).toEqual(["ac_scope: AC-G-1"]);
  });

  it("REGRESSION: with no spec_ref, a spec AC is not found by searching every spec", async () => {
    await createSpec(ctx.corpus, "Some spec", [criterion("AC-G-1")]);
    const result = await ctx.service.checks(task(templateSlug, { ac_scope: ["AC-G-1"] }));
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    expect(result.value.map((f) => f.entry)).toEqual(["ac_scope: AC-G-1"]);
  });
});
