/**
 * AC-AP-1 (issues #65 #50, BR-1071) — `corpusService.set(doc, { status: "approved" })` gives the
 * same verdict as `reviewService.approve(doc)`.
 *
 * Every case builds an identical TWIN pair of documents on a `createApp`-composed throwaway SQLite
 * corpus (mkdtemp; never the repo's own `.lore/`): twin A is driven by `set`, twin B by `approve`.
 * The two outcomes are compared on error code, field and message (with each twin's own id / slug /
 * title masked), and the version-row and audit-row counts are read back before and after.
 *
 * Dimension mapping:
 *   HAPPY:      (d) judged spec, (e) prd, (f2) echoed values on a judged spec
 *   NEGATIVE:   (a) unjudged adr, (b) unjudged spec citing a live rule, (c) plan under a draft spec,
 *               (h) spec citing no live rule
 *   BOUNDARY:   (g) already approved; (f2) echoed stored values are not a change (D4)
 *   ERROR:      (f) a changed field next to `approved`
 *   STATE:      version and audit row counts before / after on every refusal
 *   REGRESSION: (g) the already-approved no-op keeps its behaviour
 *
 * @spec_ref spec-approval-and-plan-closure-go-through-the-same-checks-on AC-AP-1
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { CreateDocInput, DocRecord, LoreError, NewReviewJudgment, Result } from "@lore/core";
import { createApp, type App } from "../../src/app.js";
import { SQLiteStore } from "../../src/store/sqlite-store.js";
import { citeSpecWithLiveRule } from "../helpers/app-live-rule.js";

// ─── Rig ─────────────────────────────────────────────────────────────────────

let dir: string;
let app: App;
/** A second read-side connection to the same SQLite file, for row counts. */
let reader: SQLiteStore;
let counter = 0;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "lore-set-approval-parity-"));
  mkdirSync(join(dir, ".lore"), { recursive: true });
  const dbPath = join(dir, ".lore", "lore.db");
  app = createApp(dbPath);
  reader = new SQLiteStore(dbPath);
  // One PRD for the live-rule fixture's baseline root to hang under.
  await must(app.corpusService.create({ type: "prd", title: "Parity root PRD", content: "root" } as CreateDocInput));
});

afterAll(() => {
  reader.close();
  app.close();
  rmSync(dir, { recursive: true, force: true });
});

async function must<T>(p: Promise<Result<T, LoreError>>): Promise<T> {
  const r = await p;
  if (!r.ok) throw new Error(`fixture step failed: ${JSON.stringify(r.error)}`);
  return r.value;
}

function next(label: string): string {
  counter += 1;
  return `${label} ${counter}`;
}

interface Rows {
  readonly versions: number;
  readonly audits: number;
  readonly approveVersions: number;
  readonly approveAudits: number;
  readonly updateAudits: number;
  readonly newestVersionAction: string | undefined;
}

async function rows(docId: string): Promise<Rows> {
  const v = await must(reader.findVersions(docId as never));
  const a = await must(reader.queryAudit({ doc_id: docId as never }));
  return {
    versions: v.length,
    audits: a.length,
    approveVersions: v.filter((x) => x.action === "approve").length,
    approveAudits: a.filter((x) => x.action === "approve").length,
    updateAudits: a.filter((x) => x.action === "update").length,
    newestVersionAction: v[0]?.action,
  };
}

const AC_ID = "AC-PAR-1";

/** A spec with one criterion; optionally citing the corpus's live rule. Returns its current record. */
async function makeSpec(label: string, opts: { cite: boolean }): Promise<DocRecord> {
  const created = await must(
    app.corpusService.create({
      type: "spec",
      title: next(label),
      content: "## Overview\n\nParity body.\n",
    } as CreateDocInput),
  );
  if (app.acService === undefined) throw new Error("AcService not wired");
  await must(
    app.acService.addCriterion(created.id, {
      id: AC_ID,
      statement: "The gated behaviour works as declared.",
      verify: { mode: "human" },
    }),
  );
  if (opts.cite) await citeSpecWithLiveRule(app, created.id, AC_ID);
  return must(app.corpusService.get(created.id)).then((g) => g.doc);
}

async function makeAdr(label: string): Promise<DocRecord> {
  return must(
    app.corpusService.create({
      type: "adr",
      title: next(label),
      content: "body",
      extra: { decision_status: "accepted" },
    } as CreateDocInput),
  );
}

/** Records an approve judgment of the doc's CURRENT version (re-read, since fixtures bump versions). */
async function judge(docId: string): Promise<void> {
  const current = (await must(app.corpusService.get(docId))).doc;
  const judgment: NewReviewJudgment = {
    doc_id: current.id,
    doc_version: current.version,
    decision: "approve",
    confidence: 0.9,
    reasons: [{ dimension: "completeness", finding: "All good" }],
    checks: [{ check: "schema", outcome: "pass" }],
    blocking_questions: [],
    judge: { provider: "test-provider", model: "test-model", prompt_version: "v1" },
  };
  await must(app.judgmentService.record(judgment));
}

/** Masks a twin's own identifiers so two refusals about different (but identical) docs compare equal. */
function mask(error: LoreError, doc: DocRecord): unknown {
  let text = JSON.stringify(error);
  for (const token of [doc.id, doc.slug, doc.title]) text = text.split(token).join("<doc>");
  return JSON.parse(text);
}

/**
 * Drives twin A through `set` and twin B through `approve`, requires both refused, and checks that a
 * refusal wrote no version row and no approval. `auditUnchanged` is true when the refusing gate is the
 * first one the approve path runs (an earlier PASSING gate leaves its own `gate_passed` trace row, so
 * for (h) parity - set writes the same audit rows approve does - is the contract instead).
 */
async function bothRefused(
  a: DocRecord,
  b: DocRecord,
  opts: { auditUnchanged: boolean },
): Promise<{ setErr: LoreError; approveErr: LoreError }> {
  const beforeA = await rows(a.id);
  const beforeB = await rows(b.id);
  const viaSet = await app.corpusService.set(a.id, { status: "approved" });
  const viaApprove = await app.reviewService.approve(b.id, { reviewer: "agent:parity" });
  // The reference path must itself refuse, or the twin pair is not testing what it claims.
  expect(viaApprove.ok).toBe(false);
  if (viaApprove.ok) throw new Error("approve unexpectedly succeeded on the control twin");
  const afterB = await rows(b.id);
  // STATE: a refusal writes no version row and no approval, through either path.
  expect(afterB.versions).toBe(beforeB.versions);
  expect(afterB.approveVersions).toBe(beforeB.approveVersions);
  expect(afterB.approveAudits).toBe(beforeB.approveAudits);
  if (opts.auditUnchanged) expect(afterB.audits).toBe(beforeB.audits);
  expect(viaSet.ok).toBe(false);
  if (viaSet.ok) throw new Error("set approved a document that approve refuses (the #65 / #50 bypass)");
  const afterA = await rows(a.id);
  expect(afterA.versions).toBe(beforeA.versions);
  expect(afterA.approveVersions).toBe(beforeA.approveVersions);
  expect(afterA.approveAudits).toBe(beforeA.approveAudits);
  expect(afterA.audits - beforeA.audits).toBe(afterB.audits - beforeB.audits);
  return { setErr: viaSet.error, approveErr: viaApprove.error };
}

// ─── NEGATIVE: refusals are the approve path's refusals ──────────────────────

describe("AC-AP-1 set to approved is refused exactly as approve is", () => {
  it("(a) adr with no judgment: same code and message, no version row, no audit row", async () => {
    const a = await makeAdr("Parity adr A");
    const b = await makeAdr("Parity adr B");
    const { setErr, approveErr } = await bothRefused(a, b, { auditUnchanged: true });
    expect(setErr.code).toBe(approveErr.code);
    expect(mask(setErr, a)).toEqual(mask(approveErr, b));
  });

  it("(b) spec citing a live rule, no judgment: same code and message, no version row, no audit row", async () => {
    const a = await makeSpec("Parity spec cited A", { cite: true });
    const b = await makeSpec("Parity spec cited B", { cite: true });
    const { setErr, approveErr } = await bothRefused(a, b, { auditUnchanged: true });
    expect(setErr.code).toBe(approveErr.code);
    expect(mask(setErr, a)).toEqual(mask(approveErr, b));
  });

  it("(c) plan whose governing spec is draft: both refused by plan-promote with the same code", async () => {
    const spec = await makeSpec("Parity governing spec", { cite: true });
    const mk = async (label: string): Promise<DocRecord> =>
      must(
        app.corpusService.create({
          type: "plan",
          title: next(label),
          parent_id: spec.id,
          content: "Plan body.",
        } as CreateDocInput),
      );
    const a = await mk("Parity plan A");
    const b = await mk("Parity plan B");
    const { setErr, approveErr } = await bothRefused(a, b, { auditUnchanged: true });
    expect(setErr.code).toBe(approveErr.code);
    expect((setErr as { field?: string }).field).toBe("gate:plan-promote");
    expect(mask(setErr, a)).toEqual(mask(approveErr, b));
  });

  it("(h) spec whose criteria cite no live rule, with an approve judgment: both refused with the same BR-1007 field", async () => {
    const a = await makeSpec("Parity uncited A", { cite: false });
    const b = await makeSpec("Parity uncited B", { cite: false });
    await judge(a.id);
    await judge(b.id);
    const { setErr, approveErr } = await bothRefused(a, b, { auditUnchanged: false });
    expect(setErr.code).toBe(approveErr.code);
    expect((setErr as { field?: string }).field).toBe("acceptance_criteria");
    expect((approveErr as { field?: string }).field).toBe("acceptance_criteria");
    expect(mask(setErr, a)).toEqual(mask(approveErr, b));
  });
});

// ─── HAPPY: an accepted set is recorded as an approval ───────────────────────

describe("AC-AP-1 set to approved that passes is recorded as an approval", () => {
  it("(d) judged spec citing a live rule: set ok, newest version action 'approve', exactly one approve audit row and no update row", async () => {
    const a = await makeSpec("Parity judged A", { cite: true });
    const b = await makeSpec("Parity judged B", { cite: true });
    await judge(a.id);
    await judge(b.id);
    const beforeA = await rows(a.id);
    const beforeB = await rows(b.id);

    const viaSet = await app.corpusService.set(a.id, { status: "approved" });
    const viaApprove = await app.reviewService.approve(b.id, { reviewer: "agent:parity" });
    expect(viaApprove.ok).toBe(true);
    expect(viaSet.ok).toBe(true);

    const afterA = await rows(a.id);
    const afterB = await rows(b.id);
    // Control: what approve wrote is what set must write.
    expect(afterB.newestVersionAction).toBe("approve");
    expect(afterA.newestVersionAction).toBe("approve");
    expect(afterA.versions - beforeA.versions).toBe(afterB.versions - beforeB.versions);
    expect(afterA.approveAudits - beforeA.approveAudits).toBe(1);
    expect(afterA.updateAudits - beforeA.updateAudits).toBe(0);
    expect(afterA.audits - beforeA.audits).toBe(afterB.audits - beforeB.audits);
  });

  it("(e) prd (a type that is not judged): set ok and the newest version action is 'approve'", async () => {
    const mk = async (label: string): Promise<DocRecord> =>
      must(app.corpusService.create({ type: "prd", title: next(label), content: "body" } as CreateDocInput));
    const a = await mk("Parity prd A");
    const b = await mk("Parity prd B");
    const viaSet = await app.corpusService.set(a.id, { status: "approved" });
    const viaApprove = await app.reviewService.approve(b.id, { reviewer: "agent:parity" });
    expect(viaApprove.ok).toBe(true);
    expect(viaSet.ok).toBe(true);
    expect((await rows(b.id)).newestVersionAction).toBe("approve");
    const afterA = await rows(a.id);
    expect(afterA.newestVersionAction).toBe("approve");
    expect(afterA.approveAudits).toBe(1);
  });
});

// ─── ERROR / BOUNDARY: approved plus another field (D4) ──────────────────────

describe("AC-AP-1 approved together with another field (D4)", () => {
  it("(f) a changed title next to status approved: VALIDATION_ERROR on field 'status', zero new version rows, zero new audit rows", async () => {
    const spec = await makeSpec("Parity changed field", { cite: true });
    await judge(spec.id);
    const before = await rows(spec.id);

    const r = await app.corpusService.set(spec.id, { status: "approved", title: next("A different title") });

    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("set accepted an edit-and-approve in one call");
    expect(r.error.code).toBe("VALIDATION_ERROR");
    expect((r.error as { field?: string }).field).toBe("status");
    expect(await rows(spec.id)).toEqual(before);
    const after = (await must(app.corpusService.get(spec.id))).doc;
    expect(after.title).toBe(spec.title);
    expect(after.status).toBe("draft");
  });

  it("(f2) the stored title and content echoed next to status approved on a judged spec: a pure approval, action 'approve'", async () => {
    const spec = await makeSpec("Parity echoed values", { cite: true });
    await judge(spec.id);
    const stored = (await must(app.corpusService.get(spec.id))).doc;

    const r = await app.corpusService.set(spec.id, {
      status: "approved",
      title: stored.title,
      content: stored.content,
    });

    if (!r.ok) throw new Error(`echoed values were treated as a change: ${JSON.stringify(r.error)}`);
    expect(r.value.status).toBe("approved");
    const after = await rows(spec.id);
    expect(after.newestVersionAction).toBe("approve");
    expect(after.approveAudits).toBe(1);
  });
});

// ─── BOUNDARY / REGRESSION: already approved ─────────────────────────────────

describe("AC-AP-1 set on an already-approved document", () => {
  it("(g) {status:'approved'} on an approved doc writes no approve row and does not change the status", async () => {
    const doc = await must(
      app.corpusService.create({ type: "prd", title: next("Parity already approved"), content: "body" } as CreateDocInput),
    );
    await must(app.reviewService.approve(doc.id, { reviewer: "agent:parity" }));
    const before = await rows(doc.id);

    await app.corpusService.set(doc.id, { status: "approved" });

    const after = await rows(doc.id);
    // No second approval is recorded, in the version history or the audit trail.
    expect(after.approveVersions).toBe(before.approveVersions);
    expect(after.approveAudits).toBe(before.approveAudits);
    expect((await must(app.corpusService.get(doc.id))).doc.status).toBe("approved");
  });
});
