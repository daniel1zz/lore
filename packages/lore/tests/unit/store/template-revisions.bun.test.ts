/**
 * Store contract for judging per template dimension (migration-048): per-dimension verdict rows, the single pending revision
 * of a template, proposals with finding-derived counts, and atomic approval. Runs against InMemoryStore and SQLiteStore (bun:sqlite).
 *
 * Coverage:
 *   HAPPY:      a judgment's verdicts round-trip through findJudgmentDimensions; template_ref and missing_dimensions round-trip on the judgment
 *   NEGATIVE:   a second pending revision for one template is refused; a proposal on a closed revision is refused; approving twice is refused
 *   BOUNDARY:   two templates each hold one pending revision; a proposal's count is its number of findings and its sources are de-duplicated
 *   STATE:      approval records each decision and closes the revision (a new one may then open); a decision for an unknown proposal changes nothing
 *   REGRESSION: a v1-v8 judgment (no template) has no verdict rows and reads back without template_ref
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DocRecord, ReviewJudgment } from "@lore/core";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { SQLiteStore } from "../../../src/store/sqlite-store.js";
import type { StoreInterface } from "../../../src/store/store-interface.js";
import { actedStore } from "../../live-invocation.js";

const STAMP = "2026-11-01T00:00:00.000Z";

function doc(): DocRecord {
  return {
    id: "01HM048DOC00000000000001",
    slug: "spec-judged",
    type: "knowledge",
    role: "knowledge",
    title: "Judged",
    status: "draft",
    priority: "medium",
    content: "body",
    parent_id: null,
    extra: { sub_type: "reference" },
    tags: [],
    version: 1,
    created_at: STAMP,
    updated_at: STAMP,
    created_by: "test",
    deleted_at: null,
  } as unknown as DocRecord;
}

function judgment(id: string, extra: Partial<ReviewJudgment> = {}): ReviewJudgment {
  return {
    id,
    doc_id: "01HM048DOC00000000000001",
    doc_version: 1,
    decision: "approve",
    confidence: 0.9,
    reasons: [{ dimension: "completeness", finding: "fine" }],
    checks: [],
    blocking_questions: [],
    judge: { provider: "stub", model: "stub", prompt_version: "v9" },
    kind: "review",
    created_at: STAMP,
    created_by: "ai:stub:stub:v9",
    ...extra,
  };
}

let dir = "";
const opened: { store: StoreInterface; close: () => void }[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lore-template-revisions-"));
});
afterEach(() => {
  for (const { close } of opened.splice(0)) close();
  rmSync(dir, { recursive: true, force: true });
});

const FACTORIES: [string, () => StoreInterface][] = [
  ["InMemoryStore", () => actedStore(new InMemoryStore())],
  [
    "SQLiteStore",
    () => {
      const sqlite = new SQLiteStore(join(dir, "lore.db"));
      opened.push({ store: sqlite, close: () => sqlite.close() });
      return actedStore(sqlite);
    },
  ],
];

describe.each(FACTORIES)("%s: judging per template dimension", (_name, make) => {
  async function seeded(): Promise<StoreInterface> {
    const store = make();
    const inserted = await store.insert(doc());
    if (!inserted.ok) throw new Error(JSON.stringify(inserted.error));
    return store;
  }

  async function open(store: StoreInterface, id: string, slug: string): Promise<void> {
    const r = await store.insertTemplateRevision({ id, template_slug: slug, base_version: 1, created_at: STAMP });
    if (!r.ok) throw new Error(JSON.stringify(r.error));
  }

  it("HAPPY: verdict rows, template_ref and missing_dimensions round-trip", async () => {
    const store = await seeded();
    const verdicts = [
      { dimension_id: "a", verdict: "pass" as const, reason: "ra", evidence: "ea" },
      { dimension_id: "b", verdict: "unclear" as const, reason: "rb", evidence: "" },
    ];
    const r = await store.insertJudgment(
      judgment("j1", { template_ref: "tpl@2", dimension_verdicts: verdicts, missing_dimensions: [{ question: "Q?" }] }),
    );
    expect(r.ok).toBe(true);
    const dims = await store.findJudgmentDimensions("j1");
    expect(dims.ok && dims.value).toEqual(verdicts);
    const read = await store.latestJudgment("01HM048DOC00000000000001", "review");
    expect(read.ok && read.value?.template_ref).toBe("tpl@2");
    expect(read.ok && read.value?.missing_dimensions).toEqual([{ question: "Q?" }]);
    expect(read.ok && read.value?.dimension_verdicts).toBeUndefined();
  });

  it("REGRESSION: a judgment with no template has no verdict rows and no template_ref", async () => {
    const store = await seeded();
    await store.insertJudgment(judgment("j0"));
    const dims = await store.findJudgmentDimensions("j0");
    expect(dims.ok && dims.value).toEqual([]);
    const read = await store.latestJudgment("01HM048DOC00000000000001", "review");
    expect(read.ok && read.value && "template_ref" in read.value).toBe(false);
  });

  it("NEGATIVE: a second pending revision for one template is refused; another template may open its own", async () => {
    const store = await seeded();
    await open(store, "rev-1", "tpl-a");
    const second = await store.insertTemplateRevision({ id: "rev-2", template_slug: "tpl-a", base_version: 1, created_at: STAMP });
    expect(second.ok).toBe(false);
    await open(store, "rev-3", "tpl-b");
    const a = await store.findPendingTemplateRevision("tpl-a");
    const b = await store.findPendingTemplateRevision("tpl-b");
    expect(a.ok && a.value?.id).toBe("rev-1");
    expect(b.ok && b.value?.id).toBe("rev-3");
  });

  it("BOUNDARY: a proposal's count is its finding rows and its sources are de-duplicated", async () => {
    const store = await seeded();
    await store.insertJudgment(judgment("j1"));
    await store.insertJudgment(judgment("j2"));
    await open(store, "rev-1", "tpl-a");
    await store.insertTemplateProposal({ id: "p1", revision_id: "rev-1", question: "Q1?", judgment_id: "j1", created_at: STAMP });
    await store.insertTemplateProposalFinding({ proposal_id: "p1", judgment_id: "j2", created_at: STAMP });
    await store.insertTemplateProposalFinding({ proposal_id: "p1", judgment_id: "j2", created_at: STAMP });
    const pending = await store.findPendingTemplateRevision("tpl-a");
    expect(pending.ok && pending.value?.proposals).toEqual([{ id: "p1", question: "Q1?", source_judgment_ids: ["j1", "j2"], count: 3 }]);
  });

  it("STATE: approval records each decision, closes the revision and lets a new one open", async () => {
    const store = await seeded();
    await store.insertJudgment(judgment("j1"));
    await open(store, "rev-1", "tpl-a");
    await store.insertTemplateProposal({ id: "p1", revision_id: "rev-1", question: "Q1?", judgment_id: "j1", created_at: STAMP });
    await store.insertTemplateProposal({ id: "p2", revision_id: "rev-1", question: "Q2?", judgment_id: "j1", created_at: STAMP });

    const unknown = await store.approveTemplateRevision({
      id: "rev-1",
      resolved_at: STAMP,
      resolved_by: "human",
      decisions: [{ proposal_id: "p1", decision: "accepted", dimension_id: "q-one" }, { proposal_id: "nope", decision: "dropped", reason: "x" }],
    });
    expect(unknown.ok).toBe(false);
    const still = await store.findPendingTemplateRevision("tpl-a");
    expect(still.ok && still.value?.proposals.every((p) => p.decision === undefined)).toBe(true);

    const approved = await store.approveTemplateRevision({
      id: "rev-1",
      resolved_at: STAMP,
      resolved_by: "human",
      decisions: [{ proposal_id: "p1", decision: "accepted", dimension_id: "q-one" }, { proposal_id: "p2", decision: "dropped", reason: "not a gap" }],
    });
    expect(approved.ok).toBe(true);
    expect((await store.findPendingTemplateRevision("tpl-a")).ok).toBe(true);
    const all = await store.findTemplateRevisions("tpl-a");
    expect(all.ok && all.value[0]).toMatchObject({
      id: "rev-1",
      status: "approved",
      resolved_by: "human",
      proposals: [
        { id: "p1", decision: "accepted", dimension_id: "q-one" },
        { id: "p2", decision: "dropped", drop_reason: "not a gap" },
      ],
    });
    const pending = await store.findPendingTemplateRevision("tpl-a");
    expect(pending.ok && pending.value).toBeNull();

    expect((await store.approveTemplateRevision({ id: "rev-1", resolved_at: STAMP, resolved_by: "human", decisions: [] })).ok).toBe(false);
    expect((await store.insertTemplateProposal({ id: "p3", revision_id: "rev-1", question: "late", judgment_id: "j1", created_at: STAMP })).ok).toBe(false);
    await open(store, "rev-2", "tpl-a");
  });
});
