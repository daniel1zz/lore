/**
 * check:baseline-coverage renders only what `lore baseline coverage --json` states
 * (task-integrate-floor-failure-shows-the-failing-step-s-own). Six dimensions: HAPPY (gap with its fix line) /
 * NEGATIVE (a command-less leaf measured by owned sites prints nothing) / BOUNDARY (absent command is informational) /
 * ERROR (measured_by none is the CLI's own unmeasured state) / STATE (undeclared command) / REGRESSION (no "no command declared").
 */
import { describe, expect, it } from "vitest";
import { type CoverageData, INFORMATIONAL_PREFIX, renderMissing } from "../check-baseline-coverage";

const leaf = (over: Partial<CoverageData["leaves"][number]> & { slug: string }): CoverageData["leaves"][number] => ({
  commands: [],
  gaps: [],
  not_measured: [],
  unresolved_imports: [],
  fix_commands: [],
  absent_commands: [],
  measured_by: "commands",
  ok: true,
  ...over,
});
const data = (leaves: CoverageData["leaves"], undeclared: CoverageData["undeclared_commands"] = []): CoverageData => ({ target: "root", complete: false, leaves, undeclared_commands: undeclared });

describe("renderMissing", () => {
  it("NEGATIVE/REGRESSION: a command-less leaf measured_by owned_sites with ok true prints nothing (no 'no command declared')", () => {
    expect(renderMissing(data([leaf({ slug: "cross-cutting", commands: [], measured_by: "owned_sites", ok: true })]))).toEqual([]);
  });

  it("HAPPY: a gap and a not_measured key print with the CLI's per-leaf fix_commands verbatim", () => {
    const lines = renderMissing(data([leaf({ slug: "l1", commands: ["a"], gaps: ["f.ts#g"], not_measured: ["f.ts#n"], fix_commands: ["lore baseline map l1 --site f.ts#g --rule <BR-n>", "lore baseline map l1 --site f.ts#n --rule <BR-n>"], ok: false })]));
    expect(lines).toEqual([
      "  gap          f.ts#g",
      "  not_measured f.ts#n",
      "    fix: lore baseline map l1 --site f.ts#g --rule <BR-n>",
      "    fix: lore baseline map l1 --site f.ts#n --rule <BR-n>",
    ]);
  });

  it("BOUNDARY: an absent command is printed as informational, ok leaf otherwise silent", () => {
    const lines = renderMissing(data([leaf({ slug: "l2", commands: ["gone"], measured_by: "absent", absent_commands: [{ command: "gone", fix: "lore baseline map l2 --remove-command gone" }], ok: true })]));
    expect(lines).toEqual([`${INFORMATIONAL_PREFIX} gone (l2: declared command not in this tree; pending or stale)\n    if stale: lore baseline map l2 --remove-command gone`]);
    expect(lines[0]).toContain("not failing");
  });

  it("ERROR: measured_by none is the CLI's own unmeasured state and names its fix", () => {
    expect(renderMissing(data([leaf({ slug: "l3", measured_by: "none", ok: false })]))).toEqual([
      "  unmeasured   l3: measured_by none (no command declared and no owned site)\n    fix: lore baseline map l3 --command <name>",
    ]);
  });

  it("STATE: undeclared commands and unresolved imports are rendered from the payload", () => {
    const lines = renderMissing(data([leaf({ slug: "l4", unresolved_imports: ["x.ts"], ok: false })], [{ command: "newcmd", fix: "lore baseline map <leaf> --command newcmd" }]));
    expect(lines).toEqual(["  unresolved   x.ts (l4: census incomplete behind this import)", "  undeclared   newcmd\n    fix: lore baseline map <leaf> --command newcmd"]);
  });
});
