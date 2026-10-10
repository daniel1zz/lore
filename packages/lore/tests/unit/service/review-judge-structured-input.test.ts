/**
 * RED-first tests for lore issue #107 — the review judge must see a document's STRUCTURED
 * parts (`extra`), not only its `content` (rule BR-960, baseline-judge-a-document).
 *
 * Spec (spec-the-review-judge-reads-the-document-as-stored-including, AC-RJI-1):
 *   - reviewing a baseline leaf puts every rule id + statement, and depends_on ids, in the judge input;
 *     glossary terms likewise (glossary lives on root|branch nodes — baselineExtraSchema forbids it
 *     on a leaf — so the glossary case reviews a branch);
 *   - reviewing a plan puts every acceptance criterion id + statement of its parent spec in the
 *     input, including one added after the spec body was written (body does not mention it);
 *   - a rule/criterion omitted by a size cap is COUNTED in the input, never silently dropped.
 *
 * Strategy: no mocks of the unit under test. Real InMemoryStore + real CorpusService.getReviewBundle
 * (the production bundle path) + real AIProviderService.judgeDoc; the only stand-in is the provider
 * boundary (InMemoryAIProvider), whose `calls[0].prompt` is the exact judge input.
 *
 * Negative controls: ids/statements that exist in OTHER documents must NOT appear in the input, so
 * a "dump the whole corpus" or hardcoded implementation cannot pass.
 *
 * @spec_ref AC-RJI-1
 */

import { describe, it, expect, vi } from "vitest";
import { ulid } from "ulidx";
import { DOC_TYPE_ROLE_MAP, runDeterministicChecks } from "@lore/core";
import type { AIProvider, AiGenerationEvent, DocId, DocRecord, Telemetry, TelemetryEvent } from "@lore/core";
import { AIProviderService } from "../../../src/service/ai-provider-service.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { InMemoryAIProvider } from "../../../src/ai/in-memory-provider.js";

// ─── Harness ─────────────────────────────────────────────────────────────────

const VALID_JSON = JSON.stringify({
  decision: "approve",
  confidence: 0.9,
  reasons: [{ dimension: "completeness", finding: "ok" }],
  blocking_questions: [],
});

async function insertDoc(
  store: InMemoryStore,
  over: Partial<DocRecord> & Pick<DocRecord, "type" | "slug">,
): Promise<DocRecord> {
  const now = new Date().toISOString();
  const doc = {
    id: ulid() as DocId,
    title: over.slug,
    status: "draft",
    priority: "medium",
    content: "body",
    parent_id: null,
    created_at: now,
    updated_at: now,
    created_by: "test",
    version: 1,
    deleted_at: null,
    tags: [],
    extra: {},
    role: DOC_TYPE_ROLE_MAP[over.type],
    ...over,
  } as DocRecord;
  const r = await store.insert(doc);
  if (!r.ok) throw new Error(`insert failed: ${JSON.stringify(r.error)}`);
  return doc;
}

/** Runs the production review path for `slug` and returns the exact prompt the judge received. */
async function judgeInputFor(store: InMemoryStore, slug: string): Promise<string> {
  const bundleResult = await new CorpusService(store).getReviewBundle(slug);
  if (!bundleResult.ok) throw new Error(`getReviewBundle failed: ${JSON.stringify(bundleResult.error)}`);
  const checks = runDeterministicChecks(bundleResult.value);

  // MOCK RISK: provider boundary only — hides real model behaviour, but the prompt it records is
  // byte-for-byte what judgeDoc sends.
  const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: VALID_JSON });
  const telemetry: Telemetry = {
    record: vi.fn((_e: TelemetryEvent) => {}),
    emit: vi.fn((_e: AiGenerationEvent) => {}),
    close: vi.fn(),
  };
  const service = new AIProviderService(
    new Map([[provider.name, provider]]) as unknown as ReadonlyMap<string, AIProvider>,
    provider.name,
    {},
    telemetry,
    false,
    8000,
    { max_plan_chars: 8000, max_spec_chars: 12000, max_task_chars: 4000, max_diff_chars: 24000 },
    // production defaults (config.ai.review.*)
    { max_doc_chars: 12000, max_context_chars: 8000 },
  );
  const judged = await service.judgeDoc(bundleResult.value, checks, {});
  if (!judged.ok) throw new Error(`judgeDoc failed: ${JSON.stringify(judged.error)}`);
  expect(provider.calls.length).toBeGreaterThanOrEqual(1);
  return provider.calls[0]!.prompt;
}

function rule(id: string, statement: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    statement,
    confidence: "established",
    enforced_by: "both",
    examples: ["example"],
    lifecycle: "live",
    ...extra,
  };
}

function criterion(id: string, statement: string) {
  return { id, statement, verify: { mode: "script", oracle: "test", command: "bun test x" }, cites: [] };
}

/** Asserts: every id present in `prompt`, OR an `omitted` line naming `noun` states exactly how many are missing. */
function expectAllOrCountedOmission(prompt: string, ids: string[], noun: string): void {
  // an id counts as present only as a whole token (BR-1 must not match inside BR-15)
  const missing = ids.filter((id) => !new RegExp(`${id}(?![0-9])`).test(prompt));
  if (missing.length === 0) return;
  const omittedLines = prompt.split("\n").filter((l) => /omitted/i.test(l) && l.toLowerCase().includes(noun));
  expect(
    omittedLines.length,
    `${missing.length} ${noun}(s) absent from the judge input with no "omitted" line naming them`,
  ).toBeGreaterThan(0);
  expect(
    omittedLines.some((l) => new RegExp(`\\b${missing.length}\\b`).test(l)),
    `omitted line must state the exact count ${missing.length}; got: ${omittedLines.join(" | ")}`,
  ).toBe(true);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("review judge sees structured parts (#107)", () => {
  describe("baseline node (HAPPY)", () => {
    async function leafWorld() {
      const store = new InMemoryStore();
      await insertDoc(store, {
        type: "baseline",
        slug: "baseline-orders",
        content: "Orders leaf. Prose only; the behavioural rules live in structured data.",
        extra: {
          node: "leaf",
          label: "Order handling",
          depends_on: ["BR-77"],
          rules: [
            rule("BR-1", "Orders must be idempotent per client token"),
            rule("BR-2", "Refunds above the threshold require approval"),
            rule("BR-3", "A cancelled order never re-opens"),
          ],
        },
      });
      // negative control: a different leaf whose rules must not leak into this review
      await insertDoc(store, {
        type: "baseline",
        slug: "baseline-other",
        content: "Other leaf.",
        extra: { node: "leaf", rules: [rule("BR-900", "Unrelated shipping rule about parcels")] },
      });
      return store;
    }

    it("puts every rule id of the leaf in the judge input", async () => {
      const prompt = await judgeInputFor(await leafWorld(), "baseline-orders");
      for (const id of ["BR-1", "BR-2", "BR-3"]) expect(prompt).toContain(id);
    });

    it("puts every rule statement of the leaf in the judge input, verbatim", async () => {
      const prompt = await judgeInputFor(await leafWorld(), "baseline-orders");
      expect(prompt).toContain("Orders must be idempotent per client token");
      expect(prompt).toContain("Refunds above the threshold require approval");
      expect(prompt).toContain("A cancelled order never re-opens");
    });

    it("puts the depends_on id in the judge input", async () => {
      const prompt = await judgeInputFor(await leafWorld(), "baseline-orders");
      expect(prompt).toContain("BR-77");
    });

    it("does not leak another leaf's rules into the input (negative control)", async () => {
      const prompt = await judgeInputFor(await leafWorld(), "baseline-orders");
      expect(prompt).not.toContain("BR-900");
      expect(prompt).not.toContain("Unrelated shipping rule about parcels");
    });

    it("different leaves yield different rule blocks (defeats a hardcoded block)", async () => {
      const prompt = await judgeInputFor(await leafWorld(), "baseline-other");
      expect(prompt).toContain("BR-900");
      expect(prompt).toContain("Unrelated shipping rule about parcels");
      expect(prompt).not.toContain("Orders must be idempotent per client token");
    });

    it("puts each rule's confidence and lifecycle in the input (spec: id, statement, confidence, lifecycle)", async () => {
      const store = new InMemoryStore();
      await insertDoc(store, {
        type: "baseline",
        slug: "baseline-states",
        content: "prose",
        extra: {
          node: "leaf",
          rules: [
            rule("BR-1", "Live and unconfirmed thing", { confidence: "unconfirmed" }),
            rule("BR-2", "Deprecated observed thing", { confidence: "observed", lifecycle: "deprecated" }),
          ],
        },
      });
      const prompt = await judgeInputFor(store, "baseline-states");
      expect(prompt).toContain("unconfirmed");
      expect(prompt).toContain("deprecated");
    });

    it("puts every glossary term of a branch node in the judge input (glossary is not allowed on leaves)", async () => {
      const store = new InMemoryStore();
      await insertDoc(store, {
        type: "baseline",
        slug: "baseline-branch",
        content: "Branch prose with no glossary section.",
        extra: {
          node: "branch",
          label: "Commerce",
          glossary: [
            { term: "Idempotency token", meaning: "client-supplied dedupe key" },
            { term: "Settlement window", meaning: "hours before funds release" },
          ],
        },
      });
      const prompt = await judgeInputFor(store, "baseline-branch");
      expect(prompt).toContain("Idempotency token");
      expect(prompt).toContain("client-supplied dedupe key");
      expect(prompt).toContain("Settlement window");
      expect(prompt).toContain("hours before funds release");
    });
  });

  describe("plan review sees the parent spec's structured acceptance criteria (HAPPY)", () => {
    async function planWorld() {
      const store = new InMemoryStore();
      const spec = await insertDoc(store, {
        type: "spec",
        slug: "spec-parent",
        // body deliberately mentions neither criterion nor their ids
        content: "# Parent spec\n\nProse describing the feature only.\n",
        extra: {
          acceptance_criteria: [
            criterion("AC-PAR-1", "Exports finish within 200 ms at P95"),
            // added after the body was written; the body says nothing about it
            criterion("AC-PAR-2", "Exports are refused for archived projects"),
          ],
        },
      });
      await insertDoc(store, {
        type: "plan",
        slug: "plan-child",
        content: "# Plan\n\nSteps to build the export.\n",
        parent_id: spec.id,
        extra: {},
      });
      // negative control: criteria of an unrelated spec
      await insertDoc(store, {
        type: "spec",
        slug: "spec-unrelated",
        content: "Unrelated.",
        extra: { acceptance_criteria: [criterion("AC-UNR-1", "Unrelated billing criterion")] },
      });
      return store;
    }

    it("puts both parent-spec criterion ids in the judge input", async () => {
      const prompt = await judgeInputFor(await planWorld(), "plan-child");
      expect(prompt).toContain("AC-PAR-1");
      expect(prompt).toContain("AC-PAR-2");
    });

    it("puts both parent-spec criterion statements in the judge input, including the one the body never mentions", async () => {
      const prompt = await judgeInputFor(await planWorld(), "plan-child");
      expect(prompt).toContain("Exports finish within 200 ms at P95");
      expect(prompt).toContain("Exports are refused for archived projects");
    });

    it("does not include an unrelated spec's criteria (negative control)", async () => {
      const prompt = await judgeInputFor(await planWorld(), "plan-child");
      expect(prompt).not.toContain("AC-UNR-1");
    });
  });

  describe("size caps never drop content silently (BOUNDARY)", () => {
    it("a leaf with far more rules than any prompt budget shows all of them or counts the omitted ones", async () => {
      const store = new InMemoryStore();
      const rules = Array.from({ length: 150 }, (_, i) =>
        rule(`BR-${i + 1}`, `Rule number ${i + 1}: ${"x".repeat(380)}`),
      );
      await insertDoc(store, { type: "baseline", slug: "baseline-huge", content: "prose", extra: { node: "leaf", rules } });
      const prompt = await judgeInputFor(store, "baseline-huge");
      // the structured block must exist at all, else the omitted-accounting below is vacuous
      expect(prompt).toContain("Rule number 1:");
      expectAllOrCountedOmission(
        prompt,
        rules.map((r) => r.id),
        "rule",
      );
    });

    it("a plan whose parent spec has a huge criteria list shows every criterion or counts the omitted ones", async () => {
      const store = new InMemoryStore();
      const acs = Array.from({ length: 120 }, (_, i) =>
        criterion(`AC-BIG-${i + 1}`, `Criterion ${i + 1}: ${"y".repeat(300)}`),
      );
      const spec = await insertDoc(store, { type: "spec", slug: "spec-big", content: "prose", extra: { acceptance_criteria: acs } });
      await insertDoc(store, { type: "plan", slug: "plan-big", content: "plan", parent_id: spec.id, extra: {} });
      const prompt = await judgeInputFor(store, "plan-big");
      expect(prompt).toContain("Criterion 1:");
      expectAllOrCountedOmission(
        prompt,
        acs.map((a) => a.id),
        "criteri",
      );
    });
  });
});
