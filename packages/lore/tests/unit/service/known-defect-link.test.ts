/**
 * R1 (#404) — a plan accepted with known defects links its defect issues with `known-defect`, never `resolves`,
 * so archiving the plan closes none of them; real fixes (`resolves`) keep closing on archive.
 *
 * Real services over InMemoryStore + a RECORDING FAKE `IssueCloser` — nothing here can reach GitHub.
 *   HAPPY:      a plan archived with a known-defect link closes no issue; the issue stays linked as a known defect.
 *   NEGATIVE:   a known-defect link to a non-issue target is refused.
 *   REGRESSION: a plan that `resolves` the same kind of issue still closes it on archive.
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
      extra: {
        adhoc: true,
        issue_report: {
          reporter_project: "consumer", reporter_actor: "agent:x", lore_version: "0.0.0", expected: "exit 0", actual: "exit 4",
          reported_at: "2026-01-01T00:00:00.000Z", github: { repo: "acme/widget", number: 7, repo_id: 123 },
        },
      },
    } as CreateDocInput),
    "issue",
  );
  const plan = await must(cs.create({ type: "plan", title: "Accepted with defects", content: "body" } as CreateDocInput), "plan");
  return { store, cs, closer, issue, plan };
}

async function archive(cs: CorpusService, doc: DocRecord) {
  await must(cs.set(doc.id, { status: "approved" }), "approve");
  await must(cs.set(doc.id, { status: "active" }), "activate");
  return must(cs.set(doc.id, { status: "archived" }), "archive");
}

describe("known-defect links", () => {
  it("HAPPY: archiving a plan that links an issue as a known defect closes no issue and keeps the link", async () => {
    const w = await build();
    await must(w.cs.link(w.plan.id, w.issue.id, "known-defect"), "link");

    await archive(w.cs, w.plan);

    expect(w.closer.calls.filter((c) => !c.startsWith("read:"))).toEqual([]);
    const links = await must(w.store.findLinks(w.plan.id, "out"), "links");
    expect(links.map((l) => [l.to_id, l.link_type])).toEqual([[w.issue.id, "known-defect"]]);
  });

  it("NEGATIVE: a known-defect link whose target carries no issue_report is refused", async () => {
    const w = await build();
    const other = await must(w.cs.create({ type: "plan", title: "Not an issue", content: "b" } as CreateDocInput), "other");
    const linked = await w.cs.link(w.plan.id, other.id, "known-defect");
    expect(linked.ok).toBe(false);
    if (!linked.ok) expect(linked.error.code).toBe("VALIDATION_ERROR");
  });

  it("REGRESSION: a plan that resolves the same kind of issue still closes it on archive", async () => {
    const w = await build();
    await must(w.cs.link(w.plan.id, w.issue.id, "resolves"), "link");

    await archive(w.cs, w.plan);

    expect(w.closer.calls).toContain("close:7");
  });
});
