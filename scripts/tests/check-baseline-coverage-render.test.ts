/**
 * check:baseline-coverage renders only the undeclared commands `lore baseline coverage --commands-only --json` states
 * (spec-baseline-coverage-refuses-only-undeclared-commands-a-site). Dimensions: HAPPY (an undeclared command with its fix
 * line and a count header) / NEGATIVE (none -> only the summary line, nothing that reads as a failure) / BOUNDARY (several
 * roots add up) / REGRESSION (no per-site gap, unmapped or unmeasured line exists any more).
 */
import { describe, expect, it } from "vitest";
import { type CoverageData, renderUndeclared } from "../check-baseline-coverage";

const data = (target: string, undeclared: CoverageData["undeclared_commands"] = []): CoverageData => ({ target, complete: undeclared.length === 0, undeclared_commands: undeclared });

describe("renderUndeclared", () => {
  it("HAPPY: an undeclared command prints with its fix line under a count header, then the summary", () => {
    expect(renderUndeclared([data("root", [{ command: "newcmd", fix: "lore baseline map <leaf> --command newcmd" }])])).toEqual([
      "check:baseline-coverage: 1 runnable command(s) no leaf declares:",
      "  undeclared   newcmd\n    fix: lore baseline map <leaf> --command newcmd",
      "check:baseline-coverage: root: 1 undeclared command(s)",
    ]);
  });

  it("NEGATIVE: nothing undeclared prints only the zero-count summary line", () => {
    expect(renderUndeclared([data("root")])).toEqual(["check:baseline-coverage: root: 0 undeclared command(s)"]);
  });

  it("BOUNDARY: two roots add their undeclared commands into one count", () => {
    const lines = renderUndeclared([data("r1", [{ command: "a", fix: "fa" }]), data("r2", [{ command: "b", fix: "fb" }])]);
    expect(lines[0]).toBe("check:baseline-coverage: 2 runnable command(s) no leaf declares:");
    expect(lines.at(-1)).toBe("check:baseline-coverage: r1, r2: 2 undeclared command(s)");
  });

  it("REGRESSION: no output line names a gap, unmapped site or unmeasured leaf", () => {
    expect(renderUndeclared([data("root", [{ command: "a", fix: "fa" }])]).join("\n")).not.toMatch(/gap|unmapped|unmeasured|not_measured/);
  });
});
