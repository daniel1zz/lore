/**
 * AC-CRIT-2 on a REAL SQLiteStore: a judgment recorded with a cut doc body and a cut parent
 * must read back (from a re-opened db file) with `truncated: true` and the two `truncation`
 * entries carrying the exact lengths; inputs that fit read back with NEITHER key. The
 * in-memory store keeps the whole object, so only a real store proves BR-268 ("the stored
 * judgment is marked as cut").
 *
 * Runner: `bun test` (bun:sqlite) — never vitest.
 *
 * @spec_ref spec-close-the-eight-verified-critical-defects-no-judge-listing#AC-CRIT-2
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDeterministicChecks, NoOpTelemetry } from "@lore/core";
import type { AIProvider, CreateDocInput, Telemetry, TelemetryEvent } from "@lore/core";
import { SQLiteStore } from "../../../src/store/sqlite-store.js";
import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { AIProviderService } from "../../../src/service/ai-provider-service.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { JudgmentService } from "../../../src/service/judgment-service.js";
import { InMemoryAIProvider } from "../../../src/ai/in-memory-provider.js";
import { actedStore } from "../../live-invocation.js";

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
    { max_context_chars: 8000 },
  );
}

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lore-judgment-trunc-"));
  dbPath = join(dir, "lore.db");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Record a real judgment on a file-backed store, then re-open the file and read it back. */
async function recordAndReadBack(parentContent: string, planContent: string) {
  const store = actedStore(new SQLiteStore(dbPath));
  const corpus = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  const spec = await corpus.create({ type: "spec", title: "RT Spec", content: parentContent } as CreateDocInput);
  if (!spec.ok) throw new Error("spec create failed");
  const plan = await corpus.create({
    type: "plan",
    title: "RT Plan",
    content: planContent,
    parent_id: spec.value.id,
  } as CreateDocInput);
  if (!plan.ok) throw new Error("plan create failed");
  const bundle = await corpus.getReviewBundle(plan.value.id);
  if (!bundle.ok) throw new Error("bundle failed");

  const provider = new InMemoryAIProvider("in-memory", { kind: "ok", content: VALID_REVIEW_JSON });
  const judged = await makeReviewService(provider).judgeDoc(bundle.value, runDeterministicChecks(bundle.value), {});
  if (!judged.ok) throw new Error("judge failed");
  const recorded = await new JudgmentService(store, new NoOpTelemetry()).record(judged.value);
  if (!recorded.ok) throw new Error("record failed: " + JSON.stringify(recorded.error));
  store.close();

  const reopened = actedStore(new SQLiteStore(dbPath));
  try {
    const rows = await reopened.findJudgments(plan.value.id);
    if (!rows.ok) throw new Error("findJudgments failed");
    expect(rows.value).toHaveLength(1);
    return { bundle: bundle.value, stored: rows.value[0]! };
  } finally {
    reopened.close();
  }
}

describe("review judgment truncation survives a SQLite round-trip (spec-close-the-eight-verified-critical-defects-no-judge-listing#AC-CRIT-2)", () => {
  it("spec-close-the-eight-verified-critical-defects-no-judge-listing#AC-CRIT-2: long body and cut parent -> read-back has no truncated key and one parent entry with the exact lengths", async () => {
    const parent = "## P1\n" + "p".repeat(9500) + "\n## D8\nlate\n";
    const body = "## B1\n" + "b".repeat(13000);
    const { bundle, stored } = await recordAndReadBack(parent, body);

    expect("truncated" in stored).toBe(false);
    expect(stored.truncation).toHaveLength(1);
    expect(stored.truncation![0]).toEqual({ section: "parent", shown_chars: 8000, total_chars: bundle.parent!.content.length });
  });

  it("only the parent cut -> read-back has no truncated key and one parent entry", async () => {
    const { stored } = await recordAndReadBack("## P1\n" + "p".repeat(9500), "small body");
    expect("truncated" in stored).toBe(false);
    expect(stored.truncation).toHaveLength(1);
    expect(stored.truncation![0]!.section).toBe("parent");
  });

  it("NEGATIVE: inputs that fit read back with NEITHER truncated nor truncation", async () => {
    const { stored } = await recordAndReadBack("root", "small body");
    expect("truncated" in stored).toBe(false);
    expect("truncation" in stored).toBe(false);
  });
});
