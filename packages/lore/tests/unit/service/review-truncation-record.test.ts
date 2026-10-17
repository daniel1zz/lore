// @layer service-review-truncation-record
/**
 * AC-CRIT-2 — every cut section (doc body AND parent) is RECORDED on the stored judgment as
 * `truncation: [{section, shown_chars, total_chars}]` with the real lengths, `truncated: true`
 * stays for a cut body (AC-ADF-8), inputs that fit store NO `truncation` key, and the CLI
 * prints one line per cut section.
 *
 * @spec_ref AC-CRIT-2
 */
import { describe, it, expect } from "vitest";
import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { AIProviderService } from "../../../src/service/ai-provider-service.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { JudgmentService } from "../../../src/service/judgment-service.js";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { InMemoryAIProvider } from "../../../src/ai/in-memory-provider.js";
import { renderTruncationBlock } from "../../../src/adapters/cli/review-render.js";
import { runDeterministicChecks, NoOpTelemetry } from "@lore/core";
import type { AIProvider, CreateDocInput, Telemetry, TelemetryEvent } from "@lore/core";

const VALID_REVIEW_JSON = JSON.stringify({
  decision: "approve",
  confidence: 0.9,
  reasons: [{ dimension: "completeness", finding: "Looks good" }],
  blocking_questions: [],
});

function makeReviewService(provider: InMemoryAIProvider) {
  const telemetry: Telemetry = { record: (_e: TelemetryEvent) => {}, emit: () => {}, close: () => {} };
  const providers = new Map([[provider.name, provider]]) as unknown as ReadonlyMap<string, AIProvider>;
  return new AIProviderService(
    providers,
    provider.name,
    {},
    telemetry,
    false,
    8000,
    { max_plan_chars: 8000, max_spec_chars: 12000, max_task_chars: 4000, max_diff_chars: 24000 },
    { max_doc_chars: 12000, max_context_chars: 8000 },
  );
}

async function makeBundle(store: InMemoryStore, parentContent: string, specContent: string) {
  const corpus = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  const spec = await corpus.create({ type: "spec", title: "Trunc Record Spec", content: parentContent } as CreateDocInput);
  if (!spec.ok) throw new Error("spec create failed");
  const plan = await corpus.create({
    type: "plan",
    title: "Trunc Record Plan",
    content: specContent,
    parent_id: spec.value.id,
  } as CreateDocInput);
  if (!plan.ok) throw new Error("plan create failed: " + JSON.stringify(plan.error));
  const bundle = await corpus.getReviewBundle(plan.value.id);
  if (!bundle.ok) throw new Error("bundle failed");
  return bundle.value;
}

async function judgeAndRecord(parentContent: string, specContent: string) {
  const store = new InMemoryStore();
  const bundle = await makeBundle(store, parentContent, specContent);
  const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: VALID_REVIEW_JSON });
  const judged = await makeReviewService(provider).judgeDoc(bundle, runDeterministicChecks(bundle), {});
  if (!judged.ok) throw new Error("judge failed");
  const recorded = await new JudgmentService(store, new NoOpTelemetry()).record(judged.value);
  if (!recorded.ok) throw new Error("record failed: " + JSON.stringify(recorded.error));
  return { bundle, judgment: recorded.value };
}

describe("review judgment — truncation record (AC-CRIT-2)", () => {
  it("AC-CRIT-2: body and parent both cut -> truncated stays true, two entries with the REAL lengths, two CLI lines", async () => {
    const parent = "## P1\n" + "p".repeat(9500) + "\n## D8\nlate\n";
    const body = "## B1\n" + "b".repeat(13000);
    const { bundle, judgment } = await judgeAndRecord(parent, body);

    expect(judgment.truncated).toBe(true);
    expect(judgment.truncation).toHaveLength(2);
    const doc = judgment.truncation!.find((t) => t.section === "doc")!;
    const par = judgment.truncation!.find((t) => t.section === "parent")!;
    expect(doc.total_chars).toBe(bundle.doc.content.length);
    expect(doc.shown_chars).toBe(12000);
    expect(par.total_chars).toBe(bundle.parent!.content.length);
    expect(par.shown_chars).toBe(8000);

    const block = renderTruncationBlock(judgment);
    expect(block.split("\n").filter((l) => l.includes(" cut: "))).toHaveLength(2);
    expect(block).toContain(`doc cut: showed 12000 of ${bundle.doc.content.length} chars`);
    expect(block).toContain(`parent cut: showed 8000 of ${bundle.parent!.content.length} chars`);
  });

  it("only the parent cut -> no truncated flag, one parent entry (AC-ADF-8 flag stays doc-only)", async () => {
    const { judgment } = await judgeAndRecord("## P1\n" + "p".repeat(9500), "small body");
    expect(judgment.truncated).toBeUndefined();
    expect(judgment.truncation).toHaveLength(1);
    expect(judgment.truncation![0]!.section).toBe("parent");
  });

  it("NEGATIVE: inputs that fit store NO truncation key and print nothing", async () => {
    const { judgment } = await judgeAndRecord("root", "small body");
    expect("truncation" in judgment).toBe(false);
    expect(renderTruncationBlock(judgment)).toBe("");
  });
});
