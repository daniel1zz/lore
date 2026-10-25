/**
 * @spec_ref spec-a-plan-s-known-defects-are-its-own-record-of-github-issues (AC-KD-3, BR-1372, BR-1421)
 *
 * Plan-close coverage reads the plan's `extra.known_defects` and each issue's live state BY NUMBER.
 *
 * Coverage dimensions:
 *   HAPPY:      both failed dimensions have an open entry -> covered
 *   NEGATIVE:   an entry covers only its own dimension; a closed issue does not cover and is named
 *   ERROR:      an unreadable issue refuses naming the issue and the read error, never a pass; no reader wired
 *   BOUNDARY:   an issue missing from the open listing but open by its own read covers; entries of dimensions that did
 *               not fail are never read; one issue under two dimensions is read once
 *   REGRESSION: a foreign repository id is refused, not read as covered
 */
import { describe, expect, it } from "vitest";
import { err, ok, type CreateDocInput, type DocRecord, type LoreError, type Result } from "@lore/core";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { coverFailedDimensions, type IssueRead } from "../../../src/service/milestone-review-inputs.js";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { actedStore } from "../../live-invocation.js";

const REPO_ID = 7;
const FP = "d".repeat(64);
const entry = (number: number, dimension: string, repo_id = REPO_ID) => ({ repo_id, number, dimension, fingerprint: FP });

type Reader = (n: number) => Result<IssueRead, LoreError>;

async function build(entries: unknown[], read: Reader) {
  const store = actedStore(new InMemoryStore());
  const cs = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  const created = await cs.create({ type: "prd", title: "Root", content: "r" } as CreateDocInput);
  if (!created.ok) throw new Error(JSON.stringify(created.error));
  const planResult = await cs.create({ type: "plan", title: "Cover plan", content: "p" } as CreateDocInput);
  if (!planResult.ok) throw new Error(JSON.stringify(planResult.error));
  const written = await cs.set(planResult.value.id, { extra: { known_defects: entries } });
  if (!written.ok) throw new Error(JSON.stringify(written.error));
  const reads: number[] = [];
  let listings = 0;
  cs.setPlanCloseIssuePort({
    // the listing never shows anything: coverage must not depend on it
    listOpenIssues: async () => {
      listings += 1;
      return ok({ repoId: REPO_ID, open: [] });
    },
    readIssue: async (n) => {
      reads.push(n);
      return read(n);
    },
  });
  return { cs, plan: planResult.value as DocRecord, reads, listings: () => listings };
}

const open: Reader = () => ok({ repoId: REPO_ID, state: "open" });

describe("AC-KD-3 plan-close coverage by dimension, per issue read by number", () => {
  it("regression #50 and security #51, both open -> covered", async () => {
    const w = await build([entry(50, "regression"), entry(51, "security")], open);
    const coverage = await w.cs.coverageOfFailedDimensions(w.plan.id, ["regression", "security"]);
    expect(coverage.ok && coverage.value.accepted).toBe(true);
    expect(coverage.ok && coverage.value.issues).toEqual([50, 51]);
    expect(w.listings()).toBe(0);
  });

  it("#50/regression only -> refused naming security even though #50 is open", async () => {
    const w = await build([entry(50, "regression")], open);
    const coverage = await w.cs.coverageOfFailedDimensions(w.plan.id, ["regression", "security"]);
    expect(coverage.ok && coverage.value.accepted).toBe(false);
    expect(coverage.ok && coverage.value.uncovered).toEqual(["security"]);
  });

  it("#51 closed -> refused naming #51", async () => {
    const w = await build([entry(50, "regression"), entry(51, "security")], (n) => ok({ repoId: REPO_ID, state: n === 51 ? "closed" : "open" }));
    const coverage = await w.cs.coverageOfFailedDimensions(w.plan.id, ["regression", "security"]);
    expect(coverage.ok && coverage.value.accepted).toBe(false);
    expect(coverage.ok && coverage.value.uncovered).toEqual(["security"]);
    expect(coverage.ok && coverage.value.closed).toEqual([51]);
    expect(coverage.ok && coverage.value.fixed).toEqual(["security"]);
  });

  it("#51 unreadable -> refused naming #51 and the error, never a pass", async () => {
    const w = await build([entry(50, "regression"), entry(51, "security")], (n) =>
      n === 51 ? err<LoreError>({ code: "STORE_ERROR", message: "gh: HTTP 502 bad gateway" }) : ok({ repoId: REPO_ID, state: "open" }),
    );
    const coverage = await w.cs.coverageOfFailedDimensions(w.plan.id, ["regression", "security"]);
    expect(coverage.ok).toBe(false);
    if (coverage.ok) return;
    expect(JSON.stringify(coverage.error)).toContain("#51");
    expect(JSON.stringify(coverage.error)).toContain("502 bad gateway");
  });

  it("#51 missing from the listing but open by its own read -> covered", async () => {
    const w = await build([entry(50, "regression"), entry(51, "security")], open);
    const listed = await w.cs.getPlanCloseIssuePort()!.listOpenIssues();
    expect(listed.ok && listed.value.open).toEqual([]);
    const coverage = await w.cs.coverageOfFailedDimensions(w.plan.id, ["regression", "security"]);
    expect(coverage.ok && coverage.value.accepted).toBe(true);
  });

  it("an entry of a dimension that did not fail is never read, and one issue under two dimensions is read once", async () => {
    const w = await build([entry(50, "regression"), entry(50, "security"), entry(52, "design_necessity")], open);
    const coverage = await w.cs.coverageOfFailedDimensions(w.plan.id, ["regression", "security"]);
    expect(coverage.ok && coverage.value.accepted).toBe(true);
    expect(w.reads).toEqual([50]);
  });

  it("an entry recorded for another repository id is refused, not read as covered", async () => {
    const w = await build([entry(50, "regression", 99)], open);
    const coverage = await w.cs.coverageOfFailedDimensions(w.plan.id, ["regression"]);
    expect(coverage.ok).toBe(false);
    if (!coverage.ok) expect(JSON.stringify(coverage.error)).toContain("#50");
  });

  it("no reader wired -> an error, never covered; no entries -> uncovered", async () => {
    const store = actedStore(new InMemoryStore());
    const cs = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    expect((await cs.coverageOfFailedDimensions("x", ["regression"])).ok).toBe(false);
    const w = await build([], open);
    const coverage = await w.cs.coverageOfFailedDimensions(w.plan.id, ["regression"]);
    expect(coverage.ok && coverage.value.accepted).toBe(false);
    expect(coverage.ok && coverage.value.uncovered).toEqual(["regression"]);
  });

  it("the pure predicate: no failed dimension is never accepted, an entry of the wrong dimension covers nothing", () => {
    expect(coverFailedDimensions([], [{ number: 1, dimension: "regression", state: "open" }]).accepted).toBe(false);
    expect(coverFailedDimensions(["security"], [{ number: 1, dimension: "regression", state: "open" }]).accepted).toBe(false);
  });
});
