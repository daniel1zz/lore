// @spawns packages/lore/src/index.ts
// @reads packages/lore/src/service/**
/**
 * `lore autonomy set <class> --tier milestone` and `lore autonomy set <class> --retire` (BR-1370 follow-up).
 *
 * A corpus seeded BEFORE the class-table change still holds override-judgment as `normal` and `report-issue` as
 * human-always. This oracle rebuilds exactly that record in a THROWAWAY corpus (mkdtemp + `lore init`, never the
 * repo's own `.lore/`) through the real threshold service, then drives the real CLI:
 *   (1) `--tier milestone` is a LOOSENING: exit 4, a pending governance-loosen decision, the record unchanged; after
 *       the human accepts through the real `lore decide` flow, the same command applies it;
 *   (2) `--retire` of a human-always class the code table no longer has is a loosening with the same escalation;
 *   (3) controls: retiring a class the code table still has, an unknown class, or combining --retire with an edit
 *       flag exits 4 and changes nothing; retiring a NON-human-always stale class is a tightening that applies at once.
 */
import { afterAll, describe, expect, it } from "vitest";
import { OPERATION_CLASS_REGISTRY, type GovernedThresholds } from "@lore/core";
import { lore, newCorpus, removeCorpora, runDecide, withService, type Corpus } from "./fixtures/autonomy-calibration-helpers.js";

afterAll(removeCorpora);

interface ShownClass {
  readonly tier: string;
}

function shownClasses(corpus: Corpus): Record<string, ShownClass> {
  const shown = lore(corpus, ["autonomy", "show", "--json"]);
  expect(shown.exitCode, shown.stderr).toBe(0);
  return (JSON.parse(shown.stdout) as { data: { record: GovernedThresholds } }).data.record.classes;
}

function pendingIdOf(stderr: string): number {
  const id = Number(/Pending decision (\d+) created/.exec(stderr)?.[1]);
  expect(id, stderr).toBeGreaterThan(0);
  return id;
}

/** A corpus whose governed record is the OLD table: override-judgment normal, report-issue human-always, plus a stale normal class. */
async function newStaleCorpus(prefix: string): Promise<Corpus> {
  const corpus = newCorpus(prefix);
  await withService(corpus, async (service) => {
    const thresholds = service.thresholds();
    const seeded = await thresholds.ensureSeeded();
    if (!seeded.ok) throw new Error(`ensureSeeded failed: ${JSON.stringify(seeded.error)}`);
    const stale: GovernedThresholds = {
      ...seeded.value.record,
      classes: {
        ...seeded.value.record.classes,
        "override-judgment": { tier: "normal", declaredRecoverability: "reversible", threshold: 0.8, priorConfidence: 0.5, usesJudge: false },
        "report-issue": { tier: "human-always", usesJudge: false },
        "old-normal": { tier: "normal", declaredRecoverability: "reversible", threshold: 0.8, priorConfidence: 0.9, usesJudge: false },
      },
    };
    const proposed = await thresholds.propose(stale, service);
    // adding human-always / normal->milestone reversal / a class: the first two tighten, the added normal class LOOSENS
    if (!proposed.ok) throw new Error(`propose failed: ${JSON.stringify(proposed.error)}`);
    if (proposed.value.kind === "escalated") {
      const accepted = await runDecide(corpus, proposed.value.pending_id, "accept");
      if (accepted.code !== 0) throw new Error(`fixture accept failed: ${accepted.stderr}`);
      const applied = await thresholds.propose(stale, service);
      if (!applied.ok || applied.value.kind !== "applied") throw new Error(`fixture re-propose failed: ${JSON.stringify(applied)}`);
    }
  });
  return corpus;
}

describe("autonomy set --tier milestone / --retire: loosenings wait for a human", () => {
  it("fixture sanity: the stale corpus holds the OLD tiers", async () => {
    const corpus = await newStaleCorpus("lore-tier-fx-");
    const classes = shownClasses(corpus);
    expect(classes["override-judgment"]?.tier).toBe("normal");
    expect(classes["report-issue"]?.tier).toBe("human-always");
  }, 120_000);

  it("--tier milestone: exit 4 + pending decision, nothing applied; after `lore decide` accepts, the same command applies it", async () => {
    const corpus = await newStaleCorpus("lore-tier-ms-");
    const first = lore(corpus, ["autonomy", "set", "override-judgment", "--tier", "milestone"]);
    expect(first.exitCode, first.stderr).toBe(4);
    expect(first.stderr).toContain("LOOSENS governance");
    const pendingId = pendingIdOf(first.stderr);
    expect(shownClasses(corpus)["override-judgment"]?.tier).toBe("normal"); // nothing applied

    const accepted = await runDecide(corpus, pendingId, "accept");
    expect(accepted.code, accepted.stderr).toBe(0);
    const applied = lore(corpus, ["autonomy", "set", "override-judgment", "--tier", "milestone"]);
    expect(applied.exitCode, applied.stderr).toBe(0);
    expect(shownClasses(corpus)["override-judgment"]?.tier).toBe("milestone");
  }, 180_000);

  it("a human REJECT keeps the class normal: the same command stays refused", async () => {
    const corpus = await newStaleCorpus("lore-tier-rej-");
    const first = lore(corpus, ["autonomy", "set", "override-judgment", "--tier", "milestone"]);
    const rejected = await runDecide(corpus, pendingIdOf(first.stderr), "reject");
    expect(rejected.code, rejected.stderr).toBe(0);
    const again = lore(corpus, ["autonomy", "set", "override-judgment", "--tier", "milestone"]);
    expect(again.exitCode).not.toBe(0);
    expect(shownClasses(corpus)["override-judgment"]?.tier).toBe("normal");
  }, 180_000);

  it("--retire of a human-always class the code table no longer has: pending decision, nothing applied until accepted", async () => {
    expect(Object.keys(OPERATION_CLASS_REGISTRY)).not.toContain("report-issue");
    const corpus = await newStaleCorpus("lore-retire-");
    const first = lore(corpus, ["autonomy", "set", "report-issue", "--retire"]);
    expect(first.exitCode, first.stderr).toBe(4);
    expect(first.stderr).toContain("class removed");
    const pendingId = pendingIdOf(first.stderr);
    expect(shownClasses(corpus)["report-issue"]?.tier).toBe("human-always"); // still there

    const accepted = await runDecide(corpus, pendingId, "accept");
    expect(accepted.code, accepted.stderr).toBe(0);
    const applied = lore(corpus, ["autonomy", "set", "report-issue", "--retire"]);
    expect(applied.exitCode, applied.stderr).toBe(0);
    expect(Object.keys(shownClasses(corpus))).not.toContain("report-issue");
  }, 180_000);

  it("CONTROLS: retiring a class the code table still has, an unknown class, or --retire with an edit flag exits 4 and changes nothing", async () => {
    const corpus = await newStaleCorpus("lore-retire-ctl-");
    const before = Object.keys(shownClasses(corpus)).sort();
    const live = lore(corpus, ["autonomy", "set", "push-force", "--retire"]);
    expect(live.exitCode).toBe(4);
    expect(live.stderr).toContain("still in the code class table");
    const unknown = lore(corpus, ["autonomy", "set", "no-such-class", "--retire"]);
    expect(unknown.exitCode).toBe(4);
    expect(unknown.stderr).toContain("unknown class");
    const mixed = lore(corpus, ["autonomy", "set", "report-issue", "--retire", "--tier", "normal"]);
    expect(mixed.exitCode).toBe(4);
    expect(mixed.stderr).toContain("--retire takes no other edit flag");
    const bad = lore(corpus, ["autonomy", "set", "override-judgment", "--tier", "bogus"]);
    expect(bad.exitCode).toBe(4);
    expect(bad.stderr).toContain("normal, human-always or milestone");
    expect(Object.keys(shownClasses(corpus)).sort()).toEqual(before);
  }, 180_000);

  it("retiring a stale class that is NOT human-always is a tightening: it applies at once", async () => {
    const corpus = await newStaleCorpus("lore-retire-norm-");
    const retired = lore(corpus, ["autonomy", "set", "old-normal", "--retire"]);
    expect(retired.exitCode, retired.stderr).toBe(0);
    expect(Object.keys(shownClasses(corpus))).not.toContain("old-normal");
  }, 120_000);

  // an approval binds to the changed class entry, not the whole record version.
  for (const order of [["override-judgment", "report-issue"], ["report-issue", "override-judgment"]] as const) {
    it(`two approved loosenings of different classes both apply, order ${order.join(" then ")}`, async () => {
      const corpus = await newStaleCorpus("lore-batch-");
      const argsOf = (id: string): string[] => (id === "report-issue" ? ["autonomy", "set", id, "--retire"] : ["autonomy", "set", id, "--tier", "milestone"]);
      const pending = order.map((id) => {
        const first = lore(corpus, argsOf(id));
        expect(first.exitCode, first.stderr).toBe(4);
        return pendingIdOf(first.stderr);
      });
      for (const id of pending) expect((await runDecide(corpus, id, "accept")).code).toBe(0);
      for (const id of order) {
        const applied = lore(corpus, argsOf(id));
        expect(applied.exitCode, `${id}: ${applied.stderr}`).toBe(0);
        expect(applied.stdout).toContain("approved by human decision record");
      }
      const classes = shownClasses(corpus);
      expect(classes["override-judgment"]?.tier).toBe("milestone");
      expect(Object.keys(classes)).not.toContain("report-issue");
      const audit = lore(corpus, ["audit", "--verify"]);
      expect(audit.exitCode, audit.stderr + audit.stdout).toBe(0);
    }, 300_000);
  }

  it("a loosening whose SAME class entry changed after approval is refused as stale (new pending decision)", async () => {
    const corpus = await newStaleCorpus("lore-batch-stale-");
    const first = lore(corpus, ["autonomy", "set", "override-judgment", "--tier", "milestone"]);
    expect((await runDecide(corpus, pendingIdOf(first.stderr), "accept")).code).toBe(0);
    // the same class entry changes (a tightening applies at once) before the approved command is re-run
    const tighten = lore(corpus, ["autonomy", "set", "override-judgment", "--threshold", "0.95"]);
    expect(tighten.exitCode, tighten.stderr).toBe(0);
    const rerun = lore(corpus, ["autonomy", "set", "override-judgment", "--tier", "milestone"]);
    expect(rerun.exitCode, rerun.stdout + rerun.stderr).toBe(4);
    expect(pendingIdOf(rerun.stderr)).toBeGreaterThan(0);
    expect(shownClasses(corpus)["override-judgment"]?.tier).toBe("normal");
  }, 240_000);
});
