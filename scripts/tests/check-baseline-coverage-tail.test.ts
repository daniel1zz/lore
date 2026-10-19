/**
 * task-coverage-floor-prints-failing-pairs-last-so-a-bounded-tail-always-shows-what-to-fix:
 * the floor prints informational output first (stale rows collapsed to one counted line) and every unaccounted pair
 * with its fix line last, right before the summary line, so a bounded tail (run-chain keeps 40 lines) carries them.
 */
import { describe, expect, it } from "vitest";
import { type CoverageData, type DebtLedger, judgeAgainstLedger, renderReport } from "../check-baseline-coverage";

const leaf = (slug: string, gaps: string[]): CoverageData["leaves"][number] => ({
  slug,
  commands: ["c"],
  gaps,
  not_measured: [],
  unresolved_imports: [],
  fix_commands: gaps.map((g) => `lore baseline map ${slug} --site ${g} --rule <BR-n>`),
  absent_commands: [{ command: "gone", fix: `lore baseline map ${slug} --remove-command gone` }],
  measured_by: "commands",
  ok: gaps.length === 0,
});
const unaccounted = ["a.ts#one", "b.ts#two", "c.ts#three", "d.ts#four"];
const data: CoverageData = { target: "root", complete: false, leaves: [leaf("leaf-x", unaccounted)], undeclared_commands: [] };
const ledger: DebtLedger = { adr: "a", reason: "r", rows: Array.from({ length: 327 }, (_, i) => ({ leaf: "old", site: `s${i}.ts#x`, kind: "gap" as const })) };

describe("task-coverage-floor-prints-failing-pairs-last", () => {
  const verdict = judgeAgainstLedger([data], ledger);
  const out = renderReport([data], verdict, { listStale: false });
  const tail = out.slice(-40).join("\n");

  it("HAPPY: the last 40 lines hold all 4 unaccounted pairs and their fix lines", () => {
    for (const site of unaccounted) {
      expect(tail).toContain(`  gap          ${site}`);
      expect(tail).toContain(`    fix: lore baseline map leaf-x --site ${site} --rule <BR-n>`);
    }
  });

  it("BOUNDARY: 327 stale rows collapse to one counted line naming --list-stale; summary line is last and keeps its format", () => {
    expect(out.filter((l) => l.includes("stale debt row (remove it)"))).toEqual([]);
    expect(out.filter((l) => l.includes("--list-stale"))).toHaveLength(1);
    expect(out.at(-1)).toBe("check:baseline-coverage: root: 0 ledgered (debt), 4 unaccounted, 327 stale (informational)");
  });

  it("STATE: unaccounted lines come after every informational line", () => {
    const lastInfo = Math.max(...out.map((l, i) => (l.includes("absent (informational") || l.includes("--list-stale") ? i : -1)));
    expect(out.findIndex((l) => l.includes("INCOMPLETE"))).toBeGreaterThan(lastInfo);
  });

  it("STATE: --list-stale expands every stale row, still before the unaccounted block", () => {
    const full = renderReport([data], verdict, { listStale: true });
    expect(full.filter((l) => l.includes("stale debt row (remove it)"))).toHaveLength(327);
    expect(full.slice(-40).join("\n")).toContain("  gap          d.ts#four");
  });

  it("NEGATIVE: a complete tree prints no INCOMPLETE header", () => {
    const ok = judgeAgainstLedger([{ ...data, leaves: [leaf("leaf-x", [])], complete: true }], ledger);
    expect(renderReport([data], ok, { listStale: false }).join("\n")).not.toContain("INCOMPLETE");
  });
});
