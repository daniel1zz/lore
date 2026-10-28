/**
 * R1 (#404) — a plan accepted with known defects records them in `extra.known_defects` (not `extra.issues`), so
 * archiving the plan closes none of them; a document that carries an issue itself still closes it
 * on archive (spec-github-owns-issue-report-state-no-mirror-task-work-carries D3).
 *
 * Real services over InMemoryStore + a RECORDING FAKE `IssueCloser` — nothing here can reach GitHub.
 *   HAPPY:      a plan archived with a known-defect record closes no issue; the record stays.
 *   NEGATIVE:   the retired known-defect link type is refused.
 *   REGRESSION: a plan that carries the same kind of issue itself still closes it on archive.
 */
import { describe, expect, it } from "vitest";
import { ok } from "@lore/core";
import type { CreateDocInput, DocRecord, LoreError, Result } from "@lore/core";

import { CorpusService } from "../../../src/service/corpus-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { IssueCloseOnArchive } from "../../../src/service/issue-close-on-archive.js";
import type { GithubIssueSnapshot, IssueCloser } from "../../../src/service/issue-closer-port.js";
import type { GithubIssueRef } from "../../../src/service/resolution-projector.js";
import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { actedStore } from "../../live-invocation.js";

import { ensureRequirementsDocId } from "../../helpers/parented-create.js";
class RecordingCloser implements IssueCloser {
  readonly calls: string[] = [];
  async readIssue(ref: GithubIssueRef): Promise<Result<GithubIssueSnapshot, LoreError>> {
    this.calls.push(`read:${ref.issueNumber}`);
    return ok({ state: "open", labels: [] });
  }
  async closeIssue(ref: GithubIssueRef): Promise<Result<{ alreadyClosed: boolean }, LoreError>> {
    this.calls.push(`close:${ref.issueNumber}`);
    return ok({ alreadyClosed: false });
  }
  async commentIssue(ref: GithubIssueRef, body: string): Promise<Result<void, LoreError>> {
    this.calls.push(`comment:${ref.issueNumber}:${body}`);
    return ok(undefined);
  }
  async labelIssue(ref: GithubIssueRef, label: string): Promise<Result<void, LoreError>> {
    this.calls.push(`label:${ref.issueNumber}:${label}`);
    return ok(undefined);
  }
}

async function must<T>(promise: Promise<Result<T, LoreError>>, what: string): Promise<T> {
  const result = await promise;
  if (!result.ok) throw new Error(`${what}: ${JSON.stringify(result.error)}`);
  return result.value;
}

async function build() {
  const store = actedStore(new InMemoryStore());
  const cs = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  const closer = new RecordingCloser();
  cs.setArchiveIssueClosePort(new IssueCloseOnArchive(store, closer, "acme/widget", () => "2026-10-12T10:00:00.000Z"));
  await must(cs.create({ type: "prd", title: "Root PRD", content: "root" } as CreateDocInput), "prd");
  const issue = await must(
    cs.create({
      type: "task",
      title: "Filed defect",
      extra: { adhoc: true, issues: [{ repo_id: 123, number: 7 }] },
    } as CreateDocInput),
    "issue",
  );
  const plan = await must(cs.create({ parent_id: await ensureRequirementsDocId(cs), type: "plan", title: "Accepted with defects", content: "body" } as CreateDocInput), "plan");
  return { store, cs, closer, issue, plan };
}

async function archive(cs: CorpusService, doc: DocRecord) {
  await must(cs.set(doc.id, { status: "approved" }), "approve");
  await must(cs.set(doc.id, { status: "active" }), "activate");
  return must(cs.set(doc.id, { status: "archived" }), "archive");
}

describe("known defects are not issues the plan carries", () => {
  it("HAPPY: archiving a plan that records a known defect closes no issue and keeps the record", async () => {
    const w = await build();
    await must(w.cs.set(w.plan.id, { extra: { known_defects: [{ repo_id: 123, number: 7, dimension: "regression", fingerprint: "f".repeat(64) }] } }), "record");

    await archive(w.cs, w.plan);

    expect(w.closer.calls.filter((c) => !c.startsWith("read:"))).toEqual([]);
    const stored = await must(w.store.find(w.plan.id), "plan");
    expect(JSON.stringify(stored?.extra)).toContain('"known_defects"');
  });

  it("NEGATIVE: a known-defect link is refused naming extra.known_defects (the type is retired)", async () => {
    const w = await build();
    const linked = await w.cs.link(w.plan.id, w.issue.id, "known-defect" as never);
    expect(linked.ok).toBe(false);
    if (!linked.ok) {
      expect(linked.error.code).toBe("VALIDATION_ERROR");
      expect(JSON.stringify(linked.error)).toContain("extra.known_defects");
    }
  });

  it("REGRESSION: a plan that carries the same kind of issue itself still closes it on archive", async () => {
    const w = await build();
    const carrierPlan = await must(
      w.cs.create({ parent_id: await ensureRequirementsDocId(w.cs), type: "plan", title: "Carries the issue", content: "body", extra: { issues: [{ repo_id: 123, number: 7 }] } } as CreateDocInput),
      "carrier plan",
    );

    await archive(w.cs, carrierPlan);

    expect(w.closer.calls).toContain("close:7");
  });
});
