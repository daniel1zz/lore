/**
 * @spec_ref spec-a-judged-finding-keeps-one-root-cause-while-the-code-and (O2, S7; BR-1552)
 *
 * Close detaches the stale entries of every unit-keyed gate: under an accepted security gate, a fixed file's entry and an
 * old cites-keyed entry leave the plan and their issues close; the still-failing file's entry stays.
 */
import { describe, expect, it } from "vitest";
import { ulid } from "ulidx";
import {
  DOC_TYPE_ROLE_MAP,
  MILESTONE_DIMENSIONS,
  ok,
  partitionKnownDefectsAtClose,
  readKnownDefects,
  renderMilestoneReviewContent,
  type DocId,
  type DocRecord,
  type MilestoneDimension,
  type MilestoneReview,
} from "@lore/core";
import { CorpusService } from "../../src/service/corpus-service.js";
import { GateEnforcer } from "../../src/service/gate-enforcer.js";
import { MILESTONE_REVIEW_SUB_TYPE, planStateFingerprint } from "../../src/service/milestone-review.js";
import { RecordLockService } from "../../src/service/record-lock-service.js";
import { rootCausesOf } from "../../src/service/root-cause-fingerprint.js";
import { InMemoryStore } from "../../src/store/in-memory-store.js";
import { actedStore } from "../live-invocation.js";
import { humanAcceptGate } from "../helpers/gate-acceptance-log.js";

const REPO_ID = 7;
const FILE_A = "packages/x/src/a.ts";
const FILE_B = "packages/x/src/b.ts";

function unitCause(file: string) {
  return { key: `unit:${file}:h-${file}`, label: file, units: [{ id: file, input_sha256: `h-${file}` }] };
}

/** The fingerprint the current code gives a per-unit judged cause of `dimension` for `file`. */
function fingerprintOfUnit(dimension: MilestoneDimension, file: string): string {
  const found = rootCausesOf({ plan: "p", dimension, reason: "r", reference: "", reviewSlug: "rv", causes: { judged: { [dimension]: [unitCause(file)] } } });
  if (!found.ok) throw new Error("fixture cause");
  return found.value[0]?.fingerprint ?? "";
}

function fingerprintOfCites(dimension: MilestoneDimension, cite: string): string {
  const found = rootCausesOf({ plan: "p", dimension, reason: "old finding", reference: "", reviewSlug: "rv", cites: [cite] });
  if (!found.ok) throw new Error("fixture cites cause");
  return found.value[0]?.fingerprint ?? "";
}

function docOf(type: DocRecord["type"], title: string, extra: Record<string, unknown>, status: DocRecord["status"], parentId: DocId | null = null): DocRecord {
  const id = ulid() as DocId;
  const now = new Date().toISOString();
  return { id, slug: `${type}-${title.toLowerCase().replace(/\s+/g, "-")}-${id.slice(-6).toLowerCase()}`, type, role: DOC_TYPE_ROLE_MAP[type], title, status, priority: "medium", content: "", parent_id: parentId, created_at: now, updated_at: now, created_by: "t", version: 1, deleted_at: null, tags: [], extra };
}

async function seed(store: InMemoryStore, doc: DocRecord): Promise<DocRecord> {
  const inserted = await store.insertWithProvenance(
    doc,
    { doc_id: doc.id, version: 1, content: doc.content, extra: doc.extra, status: doc.status, title: doc.title, action: "create", created_at: doc.created_at, created_by: "t", slug: doc.slug },
    { timestamp: doc.created_at, actor: "t", session_id: doc.id, action: "create", doc_id: doc.id, details: { version: 1 } },
  );
  if (!inserted.ok) throw new Error(`seed failed: ${JSON.stringify(inserted.error)}`);
  return inserted.value;
}

describe("close detaches stale entries of every unit-keyed gate (O2)", () => {
  it("O2 STATE: an accepted security gate with a fixed file a and a still-failing b detaches a's entry and an old cites-keyed entry, and closes their issues", async () => {
    const store = actedStore(new InMemoryStore());
    const corpus = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)), undefined, undefined, new GateEnforcer(undefined));
    const known = [
      { repo_id: REPO_ID, number: 1, dimension: "security", fingerprint: fingerprintOfUnit("security", FILE_A) },
      { repo_id: REPO_ID, number: 2, dimension: "security", fingerprint: fingerprintOfUnit("security", FILE_B) },
      { repo_id: REPO_ID, number: 3, dimension: "security", fingerprint: fingerprintOfCites("security", "src/old.ts:10") },
    ];
    const plan = await seed(store, docOf("plan", "Security plan", { known_defects: known }, "approved"));
    await seed(store, docOf("task", "Landed task", { plan_id: plan.id }, "archived", plan.id));
    const bundle = await corpus.getPlanBundle(plan.id);
    if (!bundle.ok) throw new Error(JSON.stringify(bundle.error));
    const dimensions = Object.fromEntries(
      MILESTONE_DIMENSIONS.map((d) => [d, d === "security" ? { verdict: "fail", reason: "b is unsafe", reference: "r" } : { verdict: "pass", reason: `${d} pass`, reference: "r" }]),
    ) as MilestoneReview["dimensions"];
    const review: MilestoneReview = {
      plan_id: plan.id,
      fingerprint: planStateFingerprint(bundle.value.plan, bundle.value.tasks, bundle.value.spec),
      overall: "fail",
      dimensions,
      causes: { judged: { security: [unitCause(FILE_B)] } },
      decisions: [],
      prompt_version: "test",
      diff_source: "test",
    };
    const doc = await corpus.createMilestoneReviewDoc({ type: "knowledge", title: "Review of security plan", parent_id: plan.id, extra: { sub_type: MILESTONE_REVIEW_SUB_TYPE, milestone_review: review }, content: renderMilestoneReviewContent(review) });
    if (!doc.ok) throw new Error(JSON.stringify(doc.error));
    const informs = await corpus.link(doc.value.id, plan.id, "informs");
    if (!informs.ok) throw new Error(JSON.stringify(informs.error));
    const closed: number[] = [];
    corpus.setPlanCloseIssuePort({
      listOpenIssues: async () => ok({ repoId: REPO_ID, open: [] }),
      readIssue: async () => ok({ repoId: REPO_ID, state: "open" as const }),
    });
    corpus.setKnownDefectIssueWriter({
      commentIssue: async () => ok(undefined),
      closeIssue: async (issue) => {
        closed.push(issue);
        return ok(undefined);
      },
    });
    await humanAcceptGate(store, plan.id, "security", fingerprintOfUnit("security", FILE_B));

    const result = await corpus.set(plan.id, { status: "archived" }, { by: "t" });
    expect(result.ok).toBe(true);
    const reloaded = await store.find(plan.id);
    if (!reloaded.ok || reloaded.value === null) throw new Error("plan missing");
    expect(readKnownDefects(reloaded.value.extra).map((e) => e.number)).toEqual([2]);
    expect([...closed].sort()).toEqual([1, 3]);
  });

  it("O2 NEGATIVE: an accepted gate whose failing fingerprints are unknown keeps its entries (not measured is never fixed)", () => {
    const entries = [{ repo_id: REPO_ID, number: 1, dimension: "security" as const, fingerprint: "X" }];
    const split = partitionKnownDefectsAtClose(entries, { security: { verdict: "fail", failingFingerprints: [] } }, ["security"]);
    expect(split.kept.map((e) => e.number)).toEqual([1]);
  });

  it.each(["security", "concurrency_safety", "spec_conformance", "design_necessity", "correctness_vs_acs"] as const)(
    "O2 BOUNDARY: an accepted %s gate detaches an entry whose fingerprint no longer fails",
    (dimension) => {
      const entries = [{ repo_id: REPO_ID, number: 1, dimension, fingerprint: "OLD" }];
      const split = partitionKnownDefectsAtClose(entries, { [dimension]: { verdict: "fail", failingFingerprints: ["NEW"] } }, [dimension]);
      expect(split.detached.map((d) => d.entry.number)).toEqual([1]);
    },
  );

  it("O2 REGRESSION: a snapshot_accuracy gate (one measured cause) still keeps its accepted entry", () => {
    const entries = [{ repo_id: REPO_ID, number: 1, dimension: "snapshot_accuracy" as const, fingerprint: "OLD" }];
    const split = partitionKnownDefectsAtClose(entries, { snapshot_accuracy: { verdict: "fail", failingFingerprints: ["NEW"] } }, ["snapshot_accuracy"]);
    expect(split.kept.map((e) => e.number)).toEqual([1]);
  });
});
