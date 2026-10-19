// @reads scripts/baseline-coverage-debt.json
/**
 * check:baseline-coverage debt ledger (adr-a-newly-armed-structural-oracle-enforces-from-a-baseline).
 * The three outcomes, plus the CLI-verdict boundary:
 *   HAPPY:      a ledgered pair does not fail, and is counted
 *   NEGATIVE:   a pair not in the ledger fails with its fix line
 *   STATE:      a ledger row that is now mapped / no longer reported fails as stale
 *   BOUNDARY:   a (leaf, site) pair is per leaf: the same site under another leaf is NOT exempt
 *   REGRESSION: the committed ledger is well-formed and sorted-unique
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type CoverageData, type DebtLedger, judgeAgainstLedger } from "../check-baseline-coverage";

const leaf = (over: Partial<CoverageData["leaves"][number]> & { slug: string }): CoverageData["leaves"][number] => ({
  commands: ["c"],
  gaps: [],
  not_measured: [],
  unresolved_imports: [],
  fix_commands: [],
  absent_commands: [],
  measured_by: "commands",
  ok: false,
  ...over,
});
const data = (leaves: CoverageData["leaves"]): CoverageData => ({ target: "root", complete: false, leaves, undeclared_commands: [] });
const ledger = (rows: DebtLedger["rows"]): DebtLedger => ({ adr: "adr", reason: "r", rows });

describe("judgeAgainstLedger", () => {
  it("HAPPY: a ledgered gap and not_measured pair pass and are counted", () => {
    const census = data([leaf({ slug: "l1", gaps: ["f.ts#g"], not_measured: ["f.ts#n#depth-bound"], fix_commands: ["fix g", "fix n"] })]);
    const verdict = judgeAgainstLedger([census], ledger([{ leaf: "l1", site: "f.ts#g", kind: "gap" }, { leaf: "l1", site: "f.ts#n#depth-bound", kind: "not_measured" }]));
    expect(verdict).toMatchObject({ ok: true, ledgered: 2, failingCount: 0, stale: [] });
    expect(verdict.failingLines).toEqual([]);
  });

  it("NEGATIVE: a pair missing from the ledger fails and keeps its own fix line, not the ledgered one's", () => {
    const census = data([leaf({ slug: "l1", gaps: ["f.ts#old", "f.ts#new"], fix_commands: ["fix old", "fix new"] })]);
    const verdict = judgeAgainstLedger([census], ledger([{ leaf: "l1", site: "f.ts#old", kind: "gap" }]));
    expect(verdict.ok).toBe(false);
    expect(verdict).toMatchObject({ ledgered: 1, failingCount: 1 });
    expect(verdict.failingLines).toEqual(["  gap          f.ts#new", "    fix: fix new"]);
  });

  it("STATE: a ledger row whose site is now mapped (no longer reported) fails as stale", () => {
    const census = data([leaf({ slug: "l1", gaps: [], ok: true })]);
    const verdict = judgeAgainstLedger([census], ledger([{ leaf: "l1", site: "f.ts#fixed", kind: "gap" }]));
    expect(verdict.ok).toBe(false);
    expect(verdict.stale).toEqual([{ leaf: "l1", site: "f.ts#fixed", kind: "gap" }]);
    expect(verdict.failingCount).toBe(0);
  });

  it("BOUNDARY: the same site under another leaf is not exempt", () => {
    const census = data([leaf({ slug: "l2", gaps: ["f.ts#g"], fix_commands: ["fix"] })]);
    const verdict = judgeAgainstLedger([census], ledger([{ leaf: "l1", site: "f.ts#g", kind: "gap" }]));
    expect(verdict.failingCount).toBe(1);
    expect(verdict.stale).toHaveLength(1);
  });

  it("BOUNDARY: a kind change (gap -> not_measured) is not covered by the old row", () => {
    const census = data([leaf({ slug: "l1", not_measured: ["f.ts#g"], fix_commands: ["fix"] })]);
    const verdict = judgeAgainstLedger([census], ledger([{ leaf: "l1", site: "f.ts#g", kind: "gap" }]));
    expect(verdict.ok).toBe(false);
    expect(verdict.failingCount).toBe(1);
  });

  it("ERROR: an unresolved import still fails whatever the ledger holds", () => {
    const census = data([leaf({ slug: "l1", unresolved_imports: ["x.ts>./y"] })]);
    expect(judgeAgainstLedger([census], ledger([])).failingCount).toBe(1);
  });
});

describe("the committed ledger", () => {
  it("REGRESSION: rows are unique, well-formed and never name the new refusal of baseline sites", () => {
    const file = JSON.parse(readFileSync(join(import.meta.dirname, "..", "baseline-coverage-debt.json"), "utf8")) as DebtLedger;
    expect(file.adr).toBe("adr-a-newly-armed-structural-oracle-enforces-from-a-baseline");
    const keys = file.rows.map((r) => `${r.kind}\t${r.leaf}\t${r.site}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(file.rows.every((r) => (r.kind === "gap" || r.kind === "not_measured") && r.leaf.length > 0 && r.site.includes("#"))).toBe(true);
    expect(file.rows.some((r) => r.site.endsWith("default.subCommands.sites.run#VALIDATION_ERROR#command"))).toBe(false);
  });
});
