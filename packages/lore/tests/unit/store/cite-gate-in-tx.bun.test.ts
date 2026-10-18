/**
 * @spec_ref spec-baseline-slice-2-completeness-census-per-branch-citation#AC-BLS2-3
 *
 * Deterministic companion to cite-retire-race.bun.test.ts (D6 / QA-2 of
 * spec-baseline-slice-2-completeness-census-per-branch-citation): the citing write re-reads the
 * rule's `rule_registry.lifecycle` INSIDE its own transaction. The 9-process race cannot prove this
 * (a cite that lands on a just-retired rule is still counted as "flagged", so that test is green with
 * or without the in-transaction read). Here the retire is committed by a SECOND connection in the exact
 * window between the gate's early liveness read and the write — the check-then-write window D6 closes.
 *
 * Runner: `bun test` (bun:sqlite) - never vitest.
 *
 * Dimensions: HAPPY (live rule, armed -> lands), NEGATIVE (retired inside the window -> refused,
 * nothing written, pack attached), BOUNDARY (unarmed branch -> lands, flagged), STATE (spec row,
 * version log and audit untouched on refusal).
 *
 * FALSIFIED 2026-10-08: with `require_live_rules` withheld from `updateWithProvenance` in
 * `AcService.writeCriteria`, the two refusal tests below go red (2 fail / 2 pass); restored, 4 pass.
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CreateDocInput, DocRecord } from "@lore/core";
import { AcService } from "../../../src/service/ac-service.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { RuleService } from "../../../src/service/rule-service.js";
import { SQLiteStore } from "../../../src/store/sqlite-store.js";
import type { StoreFilters } from "../../../src/store/store-interface.js";
import { makeRuleService } from "../../helpers/make-rule-service.js";
import { actedStore } from "../../live-invocation.js";

const BRANCH_SLUG = "baseline-window-branch";
const AC_ID = "AC-W-1";

async function must<T>(r: { ok: boolean; value?: T; error?: unknown }, what: string): Promise<T> {
  if (!r.ok) throw new Error(`fixture ${what} failed: ${JSON.stringify(r.error)}`);
  return r.value as T;
}

/**
 * Runs `hook` once, right after the GATE's early liveness read returns. `citeCriterion` reads the baseline
 * leaves twice before it writes — first for its report-only cite warnings (`checkCites`), then for the gate
 * (`admitAcWrite`) — so the hook fires after the second unlimited baseline read. A change in that read
 * count makes the "retire committed between the early read and the write" test fail loudly (the retire
 * would then land before the gate reads), never pass vacuously.
 */
const GATE_READ_ORDINAL = 2;

class WindowStore extends SQLiteStore {
  hook: (() => Promise<void>) | undefined;
  private baselineReads = 0;
  override async findMany(filters: StoreFilters) {
    const result = await super.findMany(filters);
    if (filters.type === "baseline" && filters.limit === undefined && this.hook !== undefined) {
      this.baselineReads += 1;
      if (this.baselineReads === GATE_READ_ORDINAL) {
        const run = this.hook;
        this.hook = undefined;
        await run();
      }
    }
    return result;
  }
}

interface Fixture {
  dbPath: string;
  specId: string;
}

async function seed(dir: string): Promise<Fixture> {
  const dbPath = join(dir, "corpus.db");
  const store = actedStore(new SQLiteStore(dbPath));
  const cs = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  const rules = makeRuleService(store);
  const ac = new AcService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  const prd = await must(await cs.create({ type: "prd", title: "Window product", content: "root" } as CreateDocInput), "prd");
  const root = await must(await rules.addNode(prd.id, { node: "root", label: "Root", title: "Window root", content: "r" }, { by: "agent:seed" }), "root");
  const branch = await must(
    await cs.create({
      type: "baseline", title: "Window branch", slug: BRANCH_SLUG, content: "b", parent_id: root.id,
      extra: { node: "branch", label: "Window branch", glossary: [{ term: "Window", meaning: "Between read and write" }] },
    } as CreateDocInput),
    "branch",
  );
  const leaf = await must(await rules.addNode(branch.id, { node: "leaf", label: "Window leaf", title: "Window leaf", content: "l" }, { by: "agent:seed" }), "leaf");
  await must(
    await rules.addRule(leaf.id, {
      statement: "A rule retired mid-write is never cited unflagged",
      confidence: "established",
      enforced_by: "guaranteed",
      examples: ["the write transaction re-reads liveness"],
    }, { by: "agent:seed" }),
    "rule",
  );
  const spec = await must(await cs.create({ type: "spec", title: "Window spec", content: "s"} as CreateDocInput), "spec");
  await must(
    await ac.addCriterion(spec.id, {
      id: AC_ID,
      statement: "Criterion W does one observable thing",
      verify: { mode: "script", oracle: "test", command: "bun test x" },
    }),
    "criterion",
  );
  store.close();
  return { dbPath, specId: spec.id };
}

async function retireOnSecondConnection(dbPath: string): Promise<void> {
  const other = actedStore(new SQLiteStore(dbPath));
  try {
    await must(await makeRuleService(other).setRule("BR-1", { lifecycle: "retired", note: "retired inside the window" }, { by: "agent:retirer" }), "retire");
  } finally {
    other.close();
  }
}

function gatedService(store: WindowStore, armed: string[]): AcService {
  return new AcService(store, new RecordLockService(store, new GateEnforcer(undefined)), { citeGate: { mode: "enforce", armed_branches: armed } });
}

async function spec(dbPath: string, id: string): Promise<{ doc: DocRecord; versions: number; audit: number }> {
  const store = actedStore(new SQLiteStore(dbPath));
  try {
    const d = await must(await store.find(id as never), "find");
    const v = await must(await store.findVersions(id as never), "versions");
    const a = await must(await store.queryAudit({ doc_id: id }), "audit");
    return { doc: d as DocRecord, versions: v.length, audit: a.length };
  } finally {
    store.close();
  }
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cite-gate-in-tx-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("liveness is re-read inside the citing write's transaction (D6)", () => {
  it("a live rule on an armed branch is cited and the write lands (control)", async () => {
    const fx = await seed(dir);
    const store = actedStore(new WindowStore(fx.dbPath));
    const res = await gatedService(store, [BRANCH_SLUG]).citeCriterion(fx.specId, AC_ID, ["BR-1"], {}, { by: "agent:citer" });
    store.close();
    expect(res.ok).toBe(true);
  });

  it("a retire committed between the early read and the write is refused with the gate's code", async () => {
    const fx = await seed(dir);
    const store = actedStore(new WindowStore(fx.dbPath));
    store.hook = () => retireOnSecondConnection(fx.dbPath);
    const res = await gatedService(store, [BRANCH_SLUG]).citeCriterion(fx.specId, AC_ID, ["BR-1"], {}, { by: "agent:citer" });
    store.close();
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe("AC_CITE_REQUIRED");
      if (res.error.code === "AC_CITE_REQUIRED") {
        expect(res.error.violations).toEqual([{ ac_id: AC_ID, rule_id: "BR-1", reason: "retired" }]);
        expect(res.error.feeding_pack?.cite_line).toContain(`lore ac cite`);
      }
    }
  });

  it("the refused write leaves the spec's extra, version log and audit untouched", async () => {
    const fx = await seed(dir);
    const before = await spec(fx.dbPath, fx.specId);
    const store = actedStore(new WindowStore(fx.dbPath));
    store.hook = () => retireOnSecondConnection(fx.dbPath);
    await gatedService(store, [BRANCH_SLUG]).citeCriterion(fx.specId, AC_ID, ["BR-1"], {}, { by: "agent:citer" });
    store.close();
    const after = await spec(fx.dbPath, fx.specId);
    expect(after.doc.extra).toEqual(before.doc.extra);
    expect(after.doc.version).toBe(before.doc.version);
    expect([after.versions, after.audit]).toEqual([before.versions, before.audit]);
  });

  it("the same window on a branch that is NOT armed lets the cite land (gate scope is per armed branch)", async () => {
    const fx = await seed(dir);
    const store = actedStore(new WindowStore(fx.dbPath));
    store.hook = () => retireOnSecondConnection(fx.dbPath);
    const res = await gatedService(store, ["some-other-branch"]).citeCriterion(fx.specId, AC_ID, ["BR-1"], {}, { by: "agent:citer" });
    store.close();
    expect(res.ok).toBe(true);
  });
});
